/**
 * Assess.gs · journey (me), episodes watched, assessments (start/save/submit/review),
 * team views, capstone and panel. Shapes follow specs/20_api_contract.md exactly.
 */

var ASSESSMENTS_ = ['baseline', 'predict', 'checkpoint', 'recall'];

// ---------------------------------------------------------------- attempts

function parseJson_(s, dflt) {
  if (s === null || s === undefined || String(s).trim() === '') return dflt;
  try { var v = JSON.parse(s); return v === null || v === undefined ? dflt : v; } catch (e) { return dflt; }
}

function parseAttempt_(r) {
  var score = String(r.score_pct || '').trim();
  return {
    _row: r._row,
    attempt_id: String(r.attempt_id || '').trim(),
    code: normCode(r.employee_code),
    assessment: String(r.assessment || '').trim().toLowerCase(),
    course: normCode(r.course),
    form: String(r.form || '').trim().toUpperCase(),
    attempt_no: toInt(r.attempt_no, 1),
    status: String(r.status || '').trim().toLowerCase(),
    started_at: r.started_at || '', last_saved_at: r.last_saved_at || '', submitted_at: r.submitted_at || '',
    started_ms: parseTime(r.started_at), submitted_ms: parseTime(r.submitted_at),
    served: parseJson_(r.served_items, []),
    answers: parseJson_(r.answers, {}),
    n_items: toInt(r.n_items, 0), n_correct: toInt(r.n_correct, 0),
    score_pct: score === '' ? null : toInt(score, 0),
    by_objective: parseJson_(r.by_objective, {}),
    by_course: parseJson_(r.by_course, {}),
    passed: toBool(r.passed),
    wave: normWave(r.wave),
    seed: r.seed || r.attempt_id,
    self_ratings: parseJson_(r.self_ratings, {}),
    graded: parseJson_(r.graded_answers, null)
  };
}

function isDone_(a) { return a.status === 'submitted' || a.status === 'expired'; }

/** The answers a submitted attempt was graded on (frozen at submit; a late autosave cannot change them). */
function gradedAnswers_(a) { return a.graded && typeof a.graded === 'object' ? a.graded : a.answers; }

/** Time order (started_at, then row), so a sorted Attempts tab changes nothing. */
function byStart_(a, b) {
  var x = isNaN(a.started_ms) ? 0 : a.started_ms, y = isNaN(b.started_ms) ? 0 : b.started_ms;
  return (x - y) || (a._row - b._row);
}

/** Every non-void attempt, oldest first. */
function allAttempts_() {
  return readTable_('Attempts').rows.map(parseAttempt_)
    .filter(function (a) { return a.attempt_id && a.status !== 'void'; }).sort(byStart_);
}

function userAttempts_(code) {
  return readTable_('Attempts').rows.filter(function (r) { return normCode(r.employee_code) === code; })
    .map(parseAttempt_).filter(function (a) { return a.attempt_id && a.status !== 'void'; }).sort(byStart_);
}

function findAttemptById_(id) {
  var rows = readTable_('Attempts').rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].attempt_id).trim() === id) return parseAttempt_(rows[i]);
  return null;
}

function newId_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 20); }

function createAttempt_(code, assessment, course, form, attemptNo, served, wave) {
  var now = nowMs_();
  var row = {
    attempt_id: newId_('at_'), employee_code: code, assessment: assessment, course: course, form: form,
    attempt_no: attemptNo, status: 'open', started_at: iso7(now), last_saved_at: '', submitted_at: '',
    served_items: JSON.stringify(served), answers: '{}', n_items: served.length, n_correct: '', score_pct: '',
    by_objective: '', by_course: '', passed: '', wave: wave || '', seed: Utilities.getUuid(), self_ratings: ''
  };
  var rowNum = appendRows_('Attempts', [row]);
  var parsed = parseAttempt_(Object.keys(row).reduce(function (o, k) { o[k] = toCell_(row[k]); return o; }, { _row: rowNum }));
  setLogInfo_(code, assessment + ' ' + (course || '') + ' ' + parsed.attempt_id);
  return parsed;
}

function itemsForAttempt_(att) {
  if (att.assessment === 'baseline') return baselineItems_();
  if (att.assessment === 'predict') return itemsFor_('predict', att.course, 'PR');
  return itemsFor_('checkpoint', att.course, att.form);
}

function indexItems_(items) {
  var m = {};
  items.forEach(function (it) { m[it.item_id] = it; });
  return m;
}

function byIdx_(a, b) { return a._idx - b._idx; }

function activeIds_(items) {
  return items.filter(function (i) { return i.active; }).sort(byIdx_).map(function (i) { return i.item_id; });
}

function orderedMap_(map, order) {
  var out = {};
  order.forEach(function (c) { if (map && Object.prototype.hasOwnProperty.call(map, c)) out[c] = map[c]; });
  Object.keys(map || {}).forEach(function (k) { if (!(k in out)) out[k] = map[k]; });
  return out;
}

// ---------------------------------------------------------------- baseline timing (F8)

function baselineHardEndMs_(att, cfg) {
  return att.started_ms + (cfg.baseline_minutes + cfg.baseline_grace_minutes) * 60000;
}

function staleBaselines_(code) {
  var cfg = config_(), now = nowMs_();
  return userAttempts_(code).filter(function (a) {
    return a.assessment === 'baseline' && a.status === 'open' && now > baselineHardEndMs_(a, cfg);
  });
}

/** Grades abandoned baselines from the last save (status expired). Lock required. */
function expireBaselines_(code) {
  var cfg = config_();
  staleBaselines_(code).forEach(function (a) {
    finalizeBaseline_(a, a.answers, a.self_ratings, 'expired', baselineHardEndMs_(a, cfg));
  });
}

function finalizeBaseline_(att, answers, selfRatings, status, submittedMs) {
  assertLocked_();
  var byId = indexItems_(baselineItems_());
  var served = att.served.filter(function (id) { return byId[id]; });
  var key = {}, obj = {}, crs = {};
  served.forEach(function (id) { key[id] = byId[id].answer; obj[id] = byId[id].objective; crs[id] = byId[id].course; });
  var clean = cleanAnswers(answers, served);
  var g = grade(served, clean, key, obj);
  var order = courseOrder_();
  var bc = orderedMap_(byCourse(served, clean, key, crs), order);
  var self = cleanSelfRatings(selfRatings, order);
  var at = iso7(submittedMs);
  updateRow_('Attempts', att._row, {
    status: status, submitted_at: at, answers: JSON.stringify(clean), graded_answers: JSON.stringify(clean), self_ratings: JSON.stringify(self),
    n_items: g.n_items, n_correct: g.n_correct, score_pct: g.score_pct,
    by_objective: JSON.stringify(g.by_objective), by_course: JSON.stringify(bc), passed: ''
  });
  var srRows = order.filter(function (c) { return c in self; }).map(function (c) {
    return { employee_code: att.code, wave: att.wave, course: c, level: self[c], submitted_at: at };
  });
  if (srRows.length) appendRows_('SelfRatings', srRows);
}

// ---------------------------------------------------------------- results

function reviewRow_(item, your, reveal) {
  var y = your && OPTION_LETTERS.indexOf(your) >= 0 ? your : null;
  return {
    item_id: item.item_id,
    course: item.course,
    objective: objectiveOut(item.objective),
    stem_en: item.stem_en,
    stem_vi: item.stem_vi,
    your: y ? optionOf(item, y) : null,
    correct: reveal ? optionOf(item, item.answer) : null,
    why_en: reveal ? item.why_en : '',
    why_vi: reveal ? item.why_vi : '',
    is_correct: !!y && y === item.answer
  };
}

function baselineSummary_(att) {
  var order = courseOrder_();
  var self = cleanSelfRatings(att.self_ratings, order);
  var bc = orderedMap_(att.by_course, order);
  return { score_pct: att.score_pct, by_course: bc, self: self, gaps: gaps(bc, self, order) };
}

/** Everything the gate needs for one person and course. */
function checkpointState_(code, courseCode, userAtts) {
  var cfg = config_(), now = nowMs_();
  var c = courseByCode_(courseCode);
  var atts = (userAtts || userAttempts_(code)).filter(function (a) { return a.assessment === 'checkpoint' && a.course === courseCode; });
  var done = atts.filter(isDone_);
  var open = atts.filter(function (a) { return a.status === 'open'; })[0] || null;
  var passedAtt = done.filter(function (a) { return a.passed; })[0] || null;
  var best = null;
  done.forEach(function (a) { if (a.score_pct !== null && (best === null || a.score_pct > best)) best = a.score_pct; });
  var last = done.length ? done[done.length - 1] : null;
  var lateUntil = lateUntil_(c);
  var lateMs = dayEnd7(lateUntil);
  var unlockRows = readTable_('Unlocks').rows.filter(function (u) {
    return normCode(u.employee_code) === code && normCode(u.course) === courseCode;
  }).length;
  var unused = Math.max(0, unlockRows - unlocksUsed(atts, cfg.max_free_attempts, lateMs));
  var nextNo = atts.filter(function (a) { return a.status !== 'open'; }).length + 1;
  var nextRetakeMs = last && !passedAtt ? last.submitted_ms + cfg.retake_hours * 3600000 : NaN;
  return {
    course: c, attempts: atts, done: done, open: open, passed: !!passedAtt, passed_att: passedAtt,
    best_pct: best, last: last, late_until: lateUntil, late_ms: lateMs, unused_unlocks: unused, next_no: nextNo,
    next_retake_ms: nextRetakeMs,
    needs_unlock: !passedAtt && !open && nextNo > cfg.max_free_attempts && unused < 1,
    gate_closed: !passedAtt && !isNaN(lateMs) && now > lateMs && unused < 1,
    status: passedAtt ? 'passed' : open ? 'in_progress' : done.length ? 'not_yet' : 'not_started'
  };
}

/**
 * A coaching chat (one Unlocks row) is needed before the next attempt: not passed, nothing in
 * progress, and either the free attempts are used up (attempts ≥ max_free + unlocks) or the
 * late window has closed without an unused unlock.
 */
function needsChat_(st) { return !st.passed && !st.open && (st.needs_unlock || st.gate_closed); }

function recallRowsFor_(code, courseCode) {
  return readTable_('Recall').rows.filter(function (r) {
    return normCode(r.employee_code) === code && normCode(r.course) === courseCode &&
      String(r.status || '').trim().toLowerCase() !== 'void';
  }).sort(function (a, b) { return toInt(a.day, 0) - toInt(b.day, 0); });
}

function checkpointResult_(att) {
  var cfg = config_(), now = nowMs_();
  var st = checkpointState_(att.code, att.course);
  var byId = indexItems_(itemsFor_('checkpoint', att.course, att.form));
  var served = att.served.filter(function (id) { return byId[id]; });
  var reveal = revealKey(st.passed);
  var graded = gradedAnswers_(att);
  var missed = served.filter(function (id) { return graded[id] !== byId[id].answer; })
    .map(function (id) { return reviewRow_(byId[id], graded[id], reveal); });
  var res = {
    assessment: 'checkpoint', course: att.course, form: att.form, attempt_no: att.attempt_no,
    n_items: att.n_items, n_correct: att.n_correct, score_pct: att.score_pct, passed: att.passed, reveal: reveal,
    by_objective: att.by_objective, weak_objectives: weakObjectives(att.by_objective), missed: missed,
    next_retake_at: att.passed || st.passed || isNaN(att.submitted_ms) ? null : iso7(att.submitted_ms + cfg.retake_hours * 3600000),
    needs_unlock: st.needs_unlock,
    forum_date: st.course ? st.course.forum_date : ''
  };
  if (att.passed) res.recall_dates = recallRowsFor_(att.code, att.course).map(function (r) { return normDate(r.due_date); });
  return res;
}

function recallRowForAttempt_(att) {
  var rows = readTable_('Recall').rows;
  for (var i = 0; i < rows.length; i++) if (String(rows[i].attempt_id).trim() === att.attempt_id) return rows[i];
  return null;
}

function reviewResult_(att) {
  var byId = indexItems_(itemsForAttempt_(att));
  var served = att.served.filter(function (id) { return byId[id]; });
  var graded = gradedAnswers_(att);
  var review = served.map(function (id) { return reviewRow_(byId[id], graded[id], true); });
  if (att.assessment === 'recall') {
    var rr = recallRowForAttempt_(att);
    return {
      assessment: 'recall', course: att.course, day: rr ? toInt(rr.day, 0) : null,
      n_items: att.n_items, n_correct: att.n_correct, score_pct: att.score_pct, review: review
    };
  }
  return { assessment: 'predict', course: att.course, n_items: att.n_items, n_correct: att.n_correct, score_pct: att.score_pct, review: review };
}

function resultFor_(att) {
  if (att.assessment === 'baseline') {
    var b = baselineSummary_(att);
    return { assessment: 'baseline', score_pct: b.score_pct, by_course: b.by_course, self: b.self, gaps: b.gaps };
  }
  if (att.assessment === 'checkpoint') return checkpointResult_(att);
  return reviewResult_(att);
}

// ---------------------------------------------------------------- me

function apiMe_(body) {
  var s = requireSession_(body, true);
  var cfg = config_(), now = nowMs_();
  if (staleBaselines_(s.code).length) withLock_(function () { expireBaselines_(s.code); });
  var atts = userAttempts_(s.code);

  // baseline
  var order = courseOrder_();
  var mineB = atts.filter(function (a) { return a.assessment === 'baseline'; });
  var cur = mineB.filter(function (a) { return a.wave === cfg.wave; });
  var openB = cur.filter(function (a) { return a.status === 'open'; })[0] || null;
  var doneB = cur.filter(isDone_)[0] || null;
  var baseline = {
    wave: cfg.wave, open_from: cfg.baseline_open_from, open_to: cfg.baseline_open_to,
    window: windowState(now, cfg.baseline_open_from, cfg.baseline_open_to),
    status: doneB ? 'submitted' : openB ? 'in_progress' : 'not_started'
  };
  if (doneB) {
    baseline.attempt_id = doneB.attempt_id;
    baseline.started_at = doneB.started_at;
    baseline.submitted_at = doneB.submitted_at;
    baseline.result = baselineSummary_(doneB);
  } else if (openB) {
    baseline.attempt_id = openB.attempt_id;
    baseline.started_at = openB.started_at;
    baseline.deadline_at = iso7(openB.started_ms + cfg.baseline_minutes * 60000);
  }
  var prev = mineB.filter(function (a) { return isDone_(a) && a.wave && a.wave < cfg.wave; })
    .sort(function (a, b) { return a.wave < b.wave ? 1 : a.wave > b.wave ? -1 : 0; })[0];
  if (prev) baseline.previous = { wave: prev.wave, score_pct: prev.score_pct, by_course: orderedMap_(prev.by_course, order) };

  // watched episodes
  var watchedRows = readTable_('Watched').rows.filter(function (w) { return normCode(w.employee_code) === s.code; });
  var watched = {};
  watchedRows.forEach(function (w) { if (toBool(w.watched)) watched[normCode(w.course) + ':' + toInt(w.ep, -1)] = true; });
  var eps = episodes_();

  var passedCount = 0;
  var courses = courses_().map(function (c) {
    var st = checkpointState_(s.code, c.code, atts);
    if (st.passed) passedCount++;
    var pred = atts.filter(function (a) { return a.assessment === 'predict' && a.course === c.code && isDone_(a); });
    var today = date7(now);
    return {
      code: c.code, order: c.order, cycle: c.cycle, open: courseIsOpen_(c, now),
      online_from: c.online_from, checkpoint_close: c.checkpoint_close, forum_date: c.forum_date,
      field_until: c.field_until, late_until: st.late_until, blink_url: c.blink_url,
      episodes: eps.filter(function (e) { return e.course === c.code; }).map(function (e) {
        return { ep: e.ep, minutes: e.minutes, blink_url: e.blink_url, embed_url: e.embed_url, watched: !!watched[c.code + ':' + e.ep] };
      }),
      predict: { done: pred.length > 0, attempts: pred.length, last_pct: pred.length ? pred[pred.length - 1].score_pct : null },
      checkpoint: {
        status: st.status, attempts: st.done.length, best_pct: st.best_pct,
        passed_at: st.passed_att ? st.passed_att.submitted_at : null,
        next_retake_at: st.status === 'not_yet' && !isNaN(st.next_retake_ms) ? iso7(st.next_retake_ms) : null,
        needs_unlock: st.needs_unlock, gate_closed: st.gate_closed,
        open_attempt_id: st.open ? st.open.attempt_id : null,
        last_attempt_id: st.last ? st.last.attempt_id : null
      },
      recall: recallRowsFor_(s.code, c.code).map(function (r) {
        var status = String(r.status || '').trim().toLowerCase();
        var due = normDate(r.due_date);
        return {
          day: toInt(r.day, 0), due_date: due,
          status: status === 'done' ? 'done' : (due && due <= today ? 'due' : 'upcoming'),
          score_pct: String(r.score_pct || '').trim() === '' ? null : toInt(r.score_pct, 0),
          attempt_id: r.attempt_id ? String(r.attempt_id) : null
        };
      })
    };
  });

  // capstone
  var team = teamFor_(s.code);
  var pitch = team ? submissionFor_(team.team_id, 'pitch') : null;
  var cap = team ? submissionFor_(team.team_id, 'capstone') : null;
  var capstone = {
    team_id: team ? team.team_id : null, project_title: team ? team.project_title : null,
    pitch_submitted_at: pitch ? pitch.submitted_at : null, capstone_submitted_at: cap ? cap.submitted_at : null,
    pitch_deadline: cfg.pitch_deadline, capstone_deadline: cfg.capstone_deadline
  };

  // streak (D9): submitted attempts, ticked episodes, capstone submissions by this person
  var activity = atts.filter(isDone_).map(function (a) { return a.submitted_ms; });
  watchedRows.forEach(function (w) { if (toBool(w.watched)) activity.push(parseTime(w.updated_at)); });
  readTable_('Capstone').rows.forEach(function (r) { if (normCode(r.submitted_by) === s.code) activity.push(parseTime(r.submitted_at)); });

  return {
    profile: profile_(s.user),
    baseline: baseline,
    courses: courses,
    capstone: capstone,
    streak: streak(activity, now, cfg.streak_skip_weeks),
    certificates: {
      level: s.user.certificate, checkpoints_passed: passedCount, checkpoints_total: courses.length,
      pitch_submitted: !!pitch, capstone_submitted: !!cap
    }
  };
}

// ---------------------------------------------------------------- watch

function apiWatch_(body) {
  var s = requireSession_(body);
  var c = courseByCode_(body.course);
  if (!c) throw apiError_('not_found', 'Unknown course');
  var ep = typeof body.ep === 'number' ? body.ep : (/^\d+$/.test(String(body.ep || '').trim()) ? parseInt(body.ep, 10) : -1);
  if (ep < 0 || ep !== Math.floor(ep)) throw apiError_('bad_request', 'ep must be an episode number');
  if (!episodes_().some(function (e) { return e.course === c.code && e.ep === ep; })) throw apiError_('not_found', 'Unknown episode');
  var on = body.watched === undefined ? true : toBool(body.watched);
  return withLock_(function () {
    var rows = readTable_('Watched').rows;
    var existing = null;
    rows.forEach(function (w) {
      if (!existing && normCode(w.employee_code) === s.code && normCode(w.course) === c.code && toInt(w.ep, -1) === ep) existing = w;
    });
    var at = iso7(nowMs_());
    if (existing) updateRow_('Watched', existing._row, { watched: on, updated_at: at });
    else appendRows_('Watched', [{ employee_code: s.code, course: c.code, ep: ep, watched: on, updated_at: at }]);
    var list = readTable_('Watched').rows.filter(function (w) {
      return normCode(w.employee_code) === s.code && normCode(w.course) === c.code && toBool(w.watched);
    }).map(function (w) { return toInt(w.ep, -1); });
    list.sort(function (a, b) { return a - b; });
    return { course: c.code, watched: list.filter(function (x, i) { return list.indexOf(x) === i; }) };
  });
}

// ---------------------------------------------------------------- start

function notOpenError_(c) {
  var now = nowMs_();
  var extra = c && c.open_flag && c.online_from && now < dayStart7(c.online_from) ? { opens_at: dayStartIso7(c.online_from) } : null;
  return apiError_('not_open', 'This course is not open yet.', extra);
}

function startPayload_(att, resumed) {
  var cfg = config_();
  var byId = indexItems_(itemsForAttempt_(att));
  var served = att.served.filter(function (id) { return byId[id]; });
  var out = {
    attempt_id: att.attempt_id, assessment: att.assessment, course: att.course, form: att.form,
    attempt_no: att.attempt_no, started_at: att.started_at, resumed: !!resumed
  };
  if (att.assessment === 'baseline') {
    out.deadline_at = iso7(att.started_ms + cfg.baseline_minutes * 60000);
    out.time_limit_min = cfg.baseline_minutes;
  }
  out.answers = cleanAnswers(att.answers, served);
  if (att.assessment === 'baseline') out.self_ratings = cleanSelfRatings(att.self_ratings, courseOrder_());
  out.items = served.map(function (id) { return serveItem(byId[id], att.seed + ':' + id); });
  if (att.assessment === 'baseline') {
    out.self = courses_().map(function (c) { return { course: c.code, en: c.self_en, vi: c.self_vi }; });
    // Labels as the page shows them, e.g. "1 · Basic (BA)" (same as the demo mock).
    out.scale = (SEED.scale || []).map(function (x) {
      var tail = x.abbr ? ' (' + x.abbr + ')' : '';
      return { level: x.level, en: x.level + ' · ' + x.en + tail, vi: x.level + ' · ' + x.vi + tail, desc_en: x.desc_en, desc_vi: x.desc_vi };
    });
    var caseId = '';
    served.forEach(function (id) { if (!caseId && byId[id].case_id) caseId = byId[id].case_id; });
    var cs = cases_().filter(function (x) { return x.case_id === caseId; })[0];
    if (cs) out['case'] = { case_id: cs.case_id, title_en: cs.title_en, title_vi: cs.title_vi, context_en: cs.context_en, context_vi: cs.context_vi };
    var nC = served.filter(function (id) { return byId[id].case_id; }).length;
    out.parts = { A: out.self.length, B: served.length - nC, C: nC };
  }
  return out;
}

function apiStart_(body) {
  var s = requireSession_(body);
  var assessment = String(body.assessment || '').trim().toLowerCase();
  if (ASSESSMENTS_.indexOf(assessment) < 0) throw apiError_('bad_request', 'Unknown assessment');
  var courseCode = normCode(body.course);
  if (assessment !== 'baseline' && !courseByCode_(courseCode)) throw apiError_('not_found', 'Unknown course');
  return withLock_(function () {
    if (assessment === 'baseline') return startBaseline_(s);
    if (assessment === 'predict') return startPredict_(s, courseCode);
    if (assessment === 'checkpoint') return startCheckpoint_(s, courseCode);
    return startRecall_(s, courseCode, body.day);
  });
}

function startBaseline_(s) {
  var cfg = config_(), now = nowMs_();
  expireBaselines_(s.code);
  var mine = userAttempts_(s.code).filter(function (a) { return a.assessment === 'baseline' && a.wave === cfg.wave; });
  var open = mine.filter(function (a) { return a.status === 'open'; })[0];
  if (open) { setLogInfo_(s.code, 'baseline resume ' + open.attempt_id); return startPayload_(open, true); }
  if (mine.some(isDone_)) throw apiError_('already_submitted', 'You have already taken the baseline in this wave.');
  var w = windowState(now, cfg.baseline_open_from, cfg.baseline_open_to);
  if (w !== 'open') {
    throw apiError_('not_open', 'The baseline window is not open.', w === 'before' ? { opens_at: dayStartIso7(cfg.baseline_open_from) } : null);
  }
  var items = baselineItems_().filter(function (i) { return i.active; });
  var seed = Utilities.getUuid();
  var partB = [];
  courseOrder_().forEach(function (code) {
    var ids = items.filter(function (i) { return i.course === code && !i.case_id; }).sort(byIdx_).map(function (i) { return i.item_id; });
    partB = partB.concat(shuffle(ids, seed + ':' + code));
  });
  var partC = items.filter(function (i) { return i.case_id; }).sort(byIdx_).map(function (i) { return i.item_id; });
  if (!partB.length) throw apiError_('not_found', 'The baseline has no items yet.');
  var att = createAttempt_(s.code, 'baseline', '', 'BL', 1, partB.concat(partC), cfg.wave);
  return startPayload_(att, false);
}

function startPredict_(s, code) {
  var c = courseByCode_(code);
  if (!courseIsOpen_(c, nowMs_())) throw notOpenError_(c);
  var atts = userAttempts_(s.code).filter(function (a) { return a.assessment === 'predict' && a.course === code; });
  var open = atts.filter(function (a) { return a.status === 'open'; })[0];
  if (open) return startPayload_(open, true);
  var ids = activeIds_(itemsFor_('predict', code, 'PR'));
  if (!ids.length) throw apiError_('not_found', 'No predict questions for this course yet.');
  var att = createAttempt_(s.code, 'predict', code, 'PR', atts.length + 1, shuffle(ids, Utilities.getUuid()), '');
  return startPayload_(att, false);
}

function firstAttemptCounts_(courseCode) {
  var counts = { A: 0, B: 0 };
  var seen = {};
  allAttempts_().forEach(function (a) {
    if (a.assessment !== 'checkpoint' || a.course !== courseCode || seen[a.code]) return;
    seen[a.code] = true; // first non-void attempt of each person
    if (a.form === 'A' || a.form === 'B') counts[a.form]++;
  });
  return counts;
}

function startCheckpoint_(s, code) {
  var cfg = config_(), now = nowMs_();
  var c = courseByCode_(code);
  if (!courseIsOpen_(c, now)) throw notOpenError_(c);
  var st = checkpointState_(s.code, code);
  if (st.open) return startPayload_(st.open, true);
  var gate = checkpointGate({
    passed: st.passed, nowMs: now, lastSubmittedMs: st.last ? st.last.submitted_ms : NaN,
    retakeHours: cfg.retake_hours, attemptNo: st.next_no, maxFree: cfg.max_free_attempts,
    lateUntilMs: st.late_ms, unusedUnlocks: st.unused_unlocks
  });
  if (!gate.ok) {
    var msgs = {
      already_passed: 'You have already passed this checkpoint.',
      retake_too_soon: 'The retake opens 24 hours after your last attempt.',
      unlock_needed: 'A third attempt needs a 15-minute chat with your manager first.',
      gate_closed: 'This checkpoint has closed. Ask your manager to unlock a late attempt.'
    };
    throw apiError_(gate.code, msgs[gate.code] || gate.code, gate.code === 'retake_too_soon' ? { next_retake_at: gate.next_retake_at } : null);
  }
  var form = pickForm(firstAttemptCounts_(code), st.attempts.map(function (a) { return a.form; }), s.code, code);
  var ids = activeIds_(itemsFor_('checkpoint', code, form));
  if (!ids.length) throw apiError_('not_found', 'No checkpoint questions for this form yet.');
  var att = createAttempt_(s.code, 'checkpoint', code, form, st.next_no, shuffle(ids, Utilities.getUuid()), '');
  return startPayload_(att, false);
}

function startRecall_(s, code, dayRaw) {
  var cfg = config_(), now = nowMs_();
  var day = toInt(dayRaw, -1);
  var dayIdx = cfg.recall_days.indexOf(day);
  if (dayIdx < 0) throw apiError_('bad_request', 'day must be one of ' + cfg.recall_days.join(', '));
  var row = recallRowsFor_(s.code, code).filter(function (r) { return toInt(r.day, -1) === day; })[0];
  if (!row) throw apiError_('not_due', 'No recall is scheduled for this day.');
  if (row.attempt_id) {
    var a = findAttemptById_(String(row.attempt_id).trim());
    if (a && a.status === 'open' && a.code === s.code) return startPayload_(a, true);
  }
  var due = normDate(row.due_date);
  if (String(row.status || '').trim().toLowerCase() !== 'due') throw apiError_('not_due', 'This recall is already done.');
  if (!due || due > date7(now)) throw apiError_('not_due', 'This recall is not due yet.', { due_date: due });
  var stats = { A: { taken: false, best_correct: 0, last_ms: 0 }, B: { taken: false, best_correct: 0, last_ms: 0 } };
  userAttempts_(s.code).forEach(function (a) {
    if (a.assessment !== 'checkpoint' || a.course !== code || !isDone_(a) || !stats[a.form]) return;
    var f = stats[a.form];
    f.best_correct = f.taken ? Math.max(f.best_correct, a.n_correct) : a.n_correct;
    f.taken = true;
    f.last_ms = Math.max(f.last_ms, a.submitted_ms || 0);
  });
  var form = recallForm(stats);
  var ids = recallItems(activeIds_(itemsFor_('checkpoint', code, form)), s.code + ':' + code + ':recall', dayIdx);
  if (!ids.length) throw apiError_('not_found', 'No recall questions for this course yet.');
  var att = createAttempt_(s.code, 'recall', code, form, 1, ids, '');
  updateRow_('Recall', row._row, { attempt_id: att.attempt_id });
  return startPayload_(att, false);
}

// ---------------------------------------------------------------- save (no lock, F4)

function apiSave_(body) {
  var s = requireSession_(body);
  var id = String(body.attempt_id || '').trim();
  if (!id) throw apiError_('bad_request', 'attempt_id is required');
  var rowNum = findRowNumber_('Attempts', 'attempt_id', id);
  if (rowNum < 0) throw apiError_('not_found', 'Attempt not found');
  var att = parseAttempt_(readRow_('Attempts', rowNum));
  if (att.code !== s.code || att.status === 'void') throw apiError_('not_found', 'Attempt not found');
  if (att.status !== 'open') throw apiError_('already_submitted', 'This attempt is already submitted.');
  var cfg = config_(), now = nowMs_();
  if (att.assessment === 'baseline' && now > baselineHardEndMs_(att, cfg)) {
    throw apiError_('already_submitted', 'Time is up: this baseline is graded from your last save.');
  }
  var at = iso7(now);
  var patch = { answers: JSON.stringify(cleanAnswers(body.answers, att.served)), last_saved_at: at };
  if (att.assessment === 'baseline' && body.self_ratings !== undefined) {
    patch.self_ratings = JSON.stringify(cleanSelfRatings(body.self_ratings, courseOrder_()));
  }
  updateRow_('Attempts', rowNum, patch);
  return { saved_at: at };
}

// ---------------------------------------------------------------- submit / review

function apiSubmit_(body) {
  var s = requireSession_(body);
  var id = String(body.attempt_id || '').trim();
  if (!id) throw apiError_('bad_request', 'attempt_id is required');
  return withLock_(function () {
    var att = findAttemptById_(id);
    if (!att || att.code !== s.code || att.status === 'void') throw apiError_('not_found', 'Attempt not found');
    setLogInfo_(s.code, att.assessment + ' ' + att.course + ' ' + id);
    if (isDone_(att)) return resultFor_(att); // idempotent
    if (att.status !== 'open') throw apiError_('not_found', 'Attempt not found');
    var cfg = config_(), now = nowMs_();

    if (att.assessment === 'baseline') {
      if (now > baselineHardEndMs_(att, cfg)) {
        finalizeBaseline_(att, att.answers, att.self_ratings, 'expired', baselineHardEndMs_(att, cfg));
      } else {
        var order = courseOrder_();
        var self = cleanSelfRatings(body.self_ratings !== undefined ? body.self_ratings : att.self_ratings, order);
        if (Object.keys(self).length < order.length) {
          throw apiError_('bad_request', 'Please rate all ' + order.length + ' statements in Part A.', { field: 'self_ratings' });
        }
        finalizeBaseline_(att, body.answers !== undefined ? body.answers : att.answers, self, 'submitted', now);
      }
      return resultFor_(findAttemptById_(id));
    }

    var byId = indexItems_(itemsForAttempt_(att));
    var served = att.served.filter(function (x) { return byId[x]; });
    var answers = cleanAnswers(body.answers !== undefined ? body.answers : att.answers, served);
    var key = {}, obj = {};
    served.forEach(function (x) { key[x] = byId[x].answer; obj[x] = byId[x].objective; });
    var g = grade(served, answers, key, obj);
    var at = iso7(now);
    var patch = {
      status: 'submitted', submitted_at: at, last_saved_at: at, answers: JSON.stringify(answers), graded_answers: JSON.stringify(answers),
      n_items: g.n_items, n_correct: g.n_correct, score_pct: g.score_pct, by_objective: JSON.stringify(g.by_objective)
    };
    if (att.assessment === 'checkpoint') {
      var passed = isPass(g.n_correct, g.n_items, cfg.pass_mark);
      var before = checkpointState_(s.code, att.course);
      patch.passed = passed;
      updateRow_('Attempts', att._row, patch);
      if (passed && !before.passed && !recallRowsFor_(s.code, att.course).length) {
        var c = courseByCode_(att.course);
        var dates = recallDates(c ? c.forum_date : '', date7(now), cfg.recall_days);
        appendRows_('Recall', dates.map(function (d, i) {
          return { employee_code: s.code, course: att.course, due_date: d, day: cfg.recall_days[i], status: 'due', score_pct: '', done_at: '', attempt_id: '' };
        }));
      }
    } else {
      updateRow_('Attempts', att._row, patch);
      if (att.assessment === 'recall') {
        var rr = recallRowForAttempt_(att);
        if (rr) updateRow_('Recall', rr._row, { status: 'done', score_pct: g.score_pct, done_at: at });
      }
    }
    return resultFor_(findAttemptById_(id));
  });
}

function apiReview_(body) {
  var s = requireSession_(body);
  var id = String(body.attempt_id || '').trim();
  var att = id ? findAttemptById_(id) : null;
  if (!att || att.code !== s.code || att.status === 'void') throw apiError_('not_found', 'Attempt not found');
  if (!isDone_(att)) throw apiError_('bad_request', 'This attempt is not submitted yet.');
  return resultFor_(att);
}

// ---------------------------------------------------------------- team views

/** Baseline averages are published only once nobody can still add to them (window + timer + grace). */
function baselinePublishMs_(cfg) {
  var end = dayEnd7(cfg.baseline_open_to);
  return isNaN(end) ? NaN : end + (cfg.baseline_minutes + cfg.baseline_grace_minutes) * 60000;
}

/** A course's checkpoint metrics are published only after its late window (late_until) has closed. */
function checkpointPublishMs_(c) { return dayEnd7(lateUntil_(c)); }

/** Grades every abandoned baseline (all people) so a published average never moves later. Lock required. */
function expireAllStaleBaselines_() {
  var codes = {};
  allAttempts_().forEach(function (a) { if (a.assessment === 'baseline' && a.status === 'open') codes[a.code] = true; });
  Object.keys(codes).forEach(function (c) { expireBaselines_(c); });
}

/**
 * Rows for the Summary tab, built only by buildSummary() (menu or hourly trigger), never on a
 * request. Managers and test users are never counted; small groups and small per-metric counts
 * are suppressed (summarise); nothing is published while it could still change, so two
 * snapshots cannot be subtracted to reveal one person.
 */
function buildSummaryRows_() {
  var cfg = config_(), now = nowMs_(), updated = iso7(now);
  var minN = cfg.team_view_min_n;
  var order = courseOrder_();
  var courses = courses_();
  expireAllStaleBaselines_();
  var people = rosterRows_().map(userView_).filter(function (u) { return u.active && u.code; });
  var atts = allAttempts_();
  var byCode = {};
  atts.forEach(function (a) { (byCode[a.code] = byCode[a.code] || []).push(a); });
  var out = [];
  var emit = function (key, g, metric, course, value, count) {
    out.push({ wave_or_course: key, group: g.group, n: g.n, metric: metric, course: course, value: value, updated_at: updated, count: count });
  };

  if (now > baselinePublishMs_(cfg)) {
    var baseRows = [];
    people.forEach(function (u) {
      var a = (byCode[u.code] || []).filter(function (x) { return x.assessment === 'baseline' && x.wave === cfg.wave && isDone_(x); })[0];
      if (!a) return;
      var self = cleanSelfRatings(a.self_ratings, order), values = {};
      order.forEach(function (c) {
        values['pct:' + c] = typeof a.by_course[c] === 'number' ? a.by_course[c] : null;
        values['self:' + c] = c in self ? self[c] : null;
      });
      baseRows.push({ group: u.role_area, is_manager: u.is_manager, roles: u.roles_raw, values: values });
    });
    summarise(baseRows, minN).forEach(function (g) {
      order.forEach(function (c) {
        var sv = g.avg['self:' + c], pv = g.avg['pct:' + c];
        emit(cfg.wave, g, 'self', c, sv === null || sv === undefined ? '' : round1(sv), g.count['self:' + c] || 0);
        emit(cfg.wave, g, 'baseline_pct', c, pv === null || pv === undefined ? '' : Math.round(pv), g.count['pct:' + c] || 0);
      });
    });
  }

  var published = courses.filter(function (c) { return now > checkpointPublishMs_(c); });
  if (published.length) {
    var cpRows = people.filter(function (u) { return u.roles.indexOf('learner') >= 0; }).map(function (u) {
      var values = {};
      published.forEach(function (c) {
        var lateEnd = checkpointPublishMs_(c), forumEnd = dayEnd7(c.forum_date);
        var mine = (byCode[u.code] || []).filter(function (x) {
          return x.assessment === 'checkpoint' && x.course === c.code && isDone_(x) && x.submitted_ms <= lateEnd;
        });
        values['ftp:' + c.code] = mine.length ? (mine[0].passed ? 1 : 0) : null;
        values['pbf:' + c.code] = mine.some(function (x) { return x.passed && x.submitted_ms <= forumEnd; }) ? 1 : 0;
      });
      return { group: u.role_area, is_manager: u.is_manager, roles: u.roles_raw, values: values };
    });
    summarise(cpRows, minN).forEach(function (g) {
      published.forEach(function (c) {
        var f = g.avg['ftp:' + c.code], p = g.avg['pbf:' + c.code];
        emit(c.code, g, 'checkpoint_first_try_pass', c.code, f === null || f === undefined ? '' : Math.round(f * 100), g.count['ftp:' + c.code] || 0);
        emit(c.code, g, 'checkpoint_pass_by_forum', c.code, p === null || p === undefined ? '' : Math.round(p * 100), g.count['pbf:' + c.code] || 0);
      });
    });
  }
  return out;
}

/**
 * team_summary {token} → {updated_at, min_n, wave, baseline_published, baseline_publish_after,
 * baseline: [{group, n, courses: {A2: {self, pct}}}],
 * checkpoints: [{group, n, courses: {A2: {first_try_pass, passed_by_forum, n_first_try, n_by_forum}}}]}
 * Reads the Summary tab only (never computed on a request). Groups are empty until published.
 */
function apiTeamSummary_(body) {
  requireSession_(body);
  var cfg = config_(), now = nowMs_();
  var minN = cfg.team_view_min_n;
  var order = courseOrder_();
  var basePublished = now > baselinePublishMs_(cfg);
  var cpOpen = {};
  courses_().forEach(function (c) { cpOpen[c.code] = now > checkpointPublishMs_(c); });
  var groupsOrder = ['all'].concat(ROLE_GROUPS);
  var base = {}, cps = {}, updated = '';
  var val = function (v) { var x = String(v === undefined ? '' : v).trim(); return x === '' ? null : toNum(x, null); };
  readTable_('Summary').rows.forEach(function (r) {
    var g = String(r.group || '').trim().toLowerCase(), n = toInt(r.n, 0), c = normCode(r.course), m = String(r.metric || '').trim();
    var k = toInt(r.count, 0);
    if (groupsOrder.indexOf(g) < 0 || n < minN || !c || order.indexOf(c) < 0) return;
    var v = k >= minN ? val(r.value) : null; // defence in depth: small counts never shown
    if ((m === 'self' || m === 'baseline_pct') && normWave(r.wave_or_course) === cfg.wave) {
      if (!basePublished) return;
      var b = base[g] = base[g] || { group: g, n: n, courses: {} };
      var bc = b.courses[c] = b.courses[c] || { self: null, pct: null };
      if (m === 'self') bc.self = v; else bc.pct = v;
    } else if (m === 'checkpoint_first_try_pass' || m === 'checkpoint_pass_by_forum') {
      if (!cpOpen[c]) return;
      var p = cps[g] = cps[g] || { group: g, n: n, courses: {} };
      var pc = p.courses[c] = p.courses[c] || { first_try_pass: null, passed_by_forum: null, n_first_try: 0, n_by_forum: 0 };
      if (m === 'checkpoint_first_try_pass') { pc.first_try_pass = v; pc.n_first_try = k; } else { pc.passed_by_forum = v; pc.n_by_forum = k; }
    } else return;
    if (r.updated_at && r.updated_at > updated) updated = r.updated_at;
  });
  var finish = function (map, empty) {
    return groupsOrder.filter(function (g) { return map[g]; }).map(function (g) {
      var full = {};
      order.forEach(function (c) { full[c] = map[g].courses[c] || empty(); });
      map[g].courses = full;
      return map[g];
    });
  };
  return {
    updated_at: updated || null, min_n: minN, wave: cfg.wave,
    baseline_published: basePublished, baseline_publish_after: cfg.baseline_open_to,
    baseline: finish(base, function () { return { self: null, pct: null }; }),
    checkpoints: finish(cps, function () { return { first_try_pass: null, passed_by_forum: null, n_first_try: 0, n_by_forum: 0 }; })
  };
}

function apiTeamStatus_(body) {
  var s = requireSession_(body);
  if (!s.user.is_manager) throw apiError_('forbidden', 'Only managers can see team status.');
  var cfg = config_();
  var atts = allAttempts_();
  var reports = rosterRows_().map(userView_).filter(function (u) {
    // managers' own results are visible only to themselves, Quân and HR
    return u.active && u.manager_code === s.code && u.code !== s.code && !u.is_test && !u.is_manager;
  });
  return {
    reports: reports.map(function (u) {
      var mine = atts.filter(function (a) { return a.code === u.code; });
      var courses = {};
      courseOrder_().forEach(function (c) {
        var st = checkpointState_(u.code, c, mine);
        courses[c] = st.passed ? 'passed' : needsChat_(st) ? 'needs_chat' : st.attempts.length ? 'not_yet' : 'not_started';
      });
      var done = mine.some(function (a) { return a.assessment === 'baseline' && a.wave === cfg.wave && isDone_(a); });
      return { code: u.code, first_name: u.first_name, baseline: done ? 'done' : 'not_done', courses: courses };
    })
  };
}

/**
 * unlock_retake {token, code, course, note} → {unlocked_at}. A manager records the 15-minute
 * coaching chat for a direct report (not a manager) whose checkpoint needs one; this writes one
 * Unlocks row (= one more attempt). The note is stored, never logged.
 */
function apiUnlockRetake_(body) {
  var s = requireSession_(body);
  if (!s.user.is_manager) throw apiError_('forbidden', 'Only managers can unlock a retake.');
  var code = normCode(body.code);
  var courseCode = normCode(body.course);
  var note = String(body.note === null || body.note === undefined ? '' : body.note).trim().slice(0, 300);
  return withLock_(function () {
    var row = isValidCode(code) ? findRosterRow_(code) : null;
    var u = row ? userView_(row) : null;
    if (!u || !u.active || u.code === s.code || u.manager_code !== s.code || u.is_manager) {
      throw apiError_('forbidden', 'You can unlock retakes only for your own team members.');
    }
    if (!courseByCode_(courseCode)) throw apiError_('bad_request', 'Unknown course', { field: 'course' });
    if (!needsChat_(checkpointState_(u.code, courseCode))) {
      throw apiError_('bad_request', 'This checkpoint does not need a coaching chat now.', { field: 'course' });
    }
    var at = iso7(nowMs_());
    appendRows_('Unlocks', [{ employee_code: u.code, course: courseCode, unlocked_by: s.code, unlocked_at: at, reason: guardCell(note).slice(0, 300) }]);
    setLogInfo_(s.code, 'unlock ' + u.code + ' ' + courseCode);
    return { unlocked_at: at };
  });
}

// ---------------------------------------------------------------- capstone (F14)

var SUBMISSION_FIELDS_ = ['project_title', 'soi_situation', 'soi_observation', 'soi_implication', 'kpi_name', 'kpi_before',
  'kpi_after', 'kpi_unit', 'evidence_url', 'value_vnd', 'value_basis', 'lessons'];
var FIELD_MAX_CHARS_ = {
  project_title: 200, soi_situation: 1000, soi_observation: 1000, soi_implication: 1000, kpi_name: 200, kpi_before: 60,
  kpi_after: 60, kpi_unit: 40, evidence_url: 500, value_vnd: 20, value_basis: 1500, lessons: 3000
};

function splitCodes_(s) {
  return String(s || '').split(/[;,\s]+/).map(normCode).filter(function (c) { return c; });
}

function teams_() {
  return readTable_('Teams').rows.filter(function (t) {
    return String(t.team_id || '').trim() && (String(t.active || '').trim() === '' || toBool(t.active));
  }).map(function (t) {
    return { team_id: String(t.team_id).trim(), project_title: t.project_title || '', members: splitCodes_(t.members), sponsor_code: normCode(t.sponsor_code) };
  });
}

function teamFor_(code) {
  return teams_().filter(function (t) { return t.members.indexOf(code) >= 0; })[0] || null;
}

function submissionFor_(teamId, stage) {
  var found = null;
  readTable_('Capstone').rows.forEach(function (r) {
    if (String(r.team_id).trim() === teamId && String(r.stage).trim().toLowerCase() === stage) found = r;
  });
  if (!found) return null;
  var sub = {};
  SUBMISSION_FIELDS_.forEach(function (f) { sub[f] = String(found[f] || '').trim(); });
  sub.submitted_by = normCode(found.submitted_by);
  sub.submitted_at = found.submitted_at || '';
  sub.stage = stage;
  return sub;
}

function personRef_(code) {
  var row = code ? findRosterRow_(code) : null;
  return code ? { code: code, first_name: row ? firstName(row.display_name, row.preferred_name) : '' } : null;
}

function apiCapstoneGet_(body) {
  var s = requireSession_(body);
  var cfg = config_();
  var team = teamFor_(s.code);
  return {
    team: team ? {
      team_id: team.team_id, project_title: team.project_title,
      members: team.members.map(personRef_), sponsor: personRef_(team.sponsor_code)
    } : null,
    submissions: { pitch: team ? submissionFor_(team.team_id, 'pitch') : null, capstone: team ? submissionFor_(team.team_id, 'capstone') : null },
    deadlines: { pitch: cfg.pitch_deadline, capstone: cfg.capstone_deadline }
  };
}

function cleanStage_(v) {
  var stage = String(v || '').trim().toLowerCase();
  if (stage !== 'pitch' && stage !== 'capstone') throw apiError_('bad_request', 'stage must be pitch or capstone', { field: 'stage' });
  return stage;
}

function apiCapstoneSubmit_(body) {
  var s = requireSession_(body);
  var stage = cleanStage_(body.stage);
  var teamId = String(body.team_id || '').trim();
  var f = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : {};
  var clean = {};
  SUBMISSION_FIELDS_.forEach(function (k) {
    var v = f[k] === null || f[k] === undefined ? '' : String(f[k]).trim();
    if (v.length > FIELD_MAX_CHARS_[k]) throw apiError_('bad_request', k + ' is too long', { field: k });
    clean[k] = v;
  });
  ['soi_situation', 'soi_observation', 'soi_implication'].forEach(function (k) {
    if (wordCount(clean[k]) > 60) throw apiError_('bad_request', k + ' must be 60 words or fewer', { field: k });
  });
  if (clean.evidence_url && !/^https:\/\/[^\s"<>]+$/i.test(clean.evidence_url)) {
    throw apiError_('bad_request', 'evidence_url must start with https://', { field: 'evidence_url' });
  }
  if (clean.value_vnd && !/^\d+$/.test(clean.value_vnd)) throw apiError_('bad_request', 'value_vnd must be digits only', { field: 'value_vnd' });
  return withLock_(function () {
    var cfg = config_(), now = nowMs_();
    var team = teams_().filter(function (t) { return t.team_id === teamId; })[0];
    if (!team) throw apiError_('not_found', 'Team not found');
    if (team.members.indexOf(s.code) < 0) throw apiError_('forbidden', 'Only team members can submit for this team.');
    var deadline = stage === 'pitch' ? cfg.pitch_deadline : cfg.capstone_deadline;
    if (deadline && now > dayEnd7(deadline)) throw apiError_('gate_closed', 'The ' + stage + ' deadline has passed.', { deadline: deadline });
    setLogInfo_(s.code, stage + ' ' + teamId);
    var at = iso7(now);
    var row = { team_id: teamId, members: team.members.join(';'), sponsor_code: team.sponsor_code, submitted_by: s.code, submitted_at: at, stage: stage };
    SUBMISSION_FIELDS_.forEach(function (k) { row[k] = guardCell(clean[k]); });
    if (!clean.project_title) row.project_title = guardCell(team.project_title);
    var existing = null;
    readTable_('Capstone').rows.forEach(function (r) {
      if (String(r.team_id).trim() === teamId && String(r.stage).trim().toLowerCase() === stage) existing = r;
    });
    if (existing) updateRow_('Capstone', existing._row, row);
    else appendRows_('Capstone', [row]);
    invalidate_('Capstone');
    return { submitted_at: at, submission: submissionFor_(teamId, stage) };
  });
}

// ---------------------------------------------------------------- panel

function requirePanel_(s) {
  if (s.user.roles.indexOf('panel') < 0 && s.user.roles.indexOf('admin') < 0) throw apiError_('forbidden', 'Only panel judges can see this.');
}

function apiPanelList_(body) {
  var s = requireSession_(body);
  requirePanel_(s);
  var stage = cleanStage_(body.stage);
  var mine = {};
  readTable_('PanelScores').rows.forEach(function (r) {
    if (String(r.stage).trim().toLowerCase() === stage && normCode(r.judge_code) === s.code) mine[String(r.team_id).trim()] = r;
  });
  return {
    stage: stage,
    teams: teams_().map(function (t) {
      var r = mine[t.team_id];
      return {
        team_id: t.team_id, project_title: t.project_title, is_sponsor: t.sponsor_code === s.code,
        submission: submissionFor_(t.team_id, stage),
        my_score: r ? {
          c1: toInt(r.c1_problem, 0), c2: toInt(r.c2_structure, 0), c3: toInt(r.c3_result, 0), c4: toInt(r.c4_value, 0),
          c5: toInt(r.c5_communication, 0), comment: String(r.comment || '').trim(), scored_at: r.scored_at || ''
        } : null
      };
    })
  };
}

function apiPanelScore_(body) {
  var s = requireSession_(body);
  requirePanel_(s);
  var stage = cleanStage_(body.stage);
  var teamId = String(body.team_id || '').trim();
  var sc = body.scores && typeof body.scores === 'object' ? body.scores : {};
  var vals = {};
  ['c1', 'c2', 'c3', 'c4', 'c5'].forEach(function (k) {
    var v = sc[k];
    var n = typeof v === 'number' ? v : (/^\d$/.test(String(v || '').trim()) ? parseInt(v, 10) : NaN);
    if (!(n >= 1 && n <= 5 && n === Math.floor(n))) throw apiError_('bad_request', k + ' must be a whole number 1–5', { field: k });
    vals[k] = n;
  });
  var comment = body.comment === null || body.comment === undefined ? '' : String(body.comment).trim();
  if (comment.length > 2000) throw apiError_('bad_request', 'comment is too long', { field: 'comment' });
  return withLock_(function () {
    var team = teams_().filter(function (t) { return t.team_id === teamId; })[0];
    if (!team) throw apiError_('not_found', 'Team not found');
    if (team.members.indexOf(s.code) >= 0) throw apiError_('forbidden', 'Judges cannot score their own team.');
    setLogInfo_(s.code, stage + ' ' + teamId);
    var at = iso7(nowMs_());
    var row = {
      team_id: teamId, stage: stage, judge_code: s.code, c1_problem: vals.c1, c2_structure: vals.c2, c3_result: vals.c3,
      c4_value: vals.c4, c5_communication: vals.c5, comment: guardCell(comment), scored_at: at
    };
    var existing = null;
    readTable_('PanelScores').rows.forEach(function (r) {
      if (String(r.team_id).trim() === teamId && String(r.stage).trim().toLowerCase() === stage && normCode(r.judge_code) === s.code) existing = r;
    });
    if (existing) updateRow_('PanelScores', existing._row, row);
    else appendRows_('PanelScores', [row]);
    return { scored_at: at };
  });
}
