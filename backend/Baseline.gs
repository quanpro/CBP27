/**
 * Baseline.gs · Baseline v2 (specs/22): three parts opened by manual switches, once per part per
 * wave, one timer per part; the Part 2 SJT lock; manager rating (180°); scoring at submit; the
 * profile (built by buildProfiles(), published while results_open); team numbers.
 * Pure rules (form choice, scoring, equating, flags, level, gaps) live in Logic.gs.
 * Privacy: items leave only through serveBaselineItem / managerRatingItem (whitelists); keys,
 * explanations, step, move, gate, level and charter never do.
 */

var BL_SWITCH_ = { baseline_p1: 'p1_open', baseline_p2: 'p2_open', baseline_p3: 'p3_open' };
var BL_MINUTES_ = { baseline_p1: 'p1_minutes', baseline_p2: 'p2_minutes', baseline_p3: 'p3_minutes' };
/** Summary metric → team_summary baseline field. */
var BL_SUMMARY_METRICS_ = { bl2_p1_pct: 'p1_pct', bl2_p2_sjt_pct: 'p2_sjt_pct', bl2_p2_mgr_mean: 'p2_mgr_mean', bl2_p3_core_pct: 'p3_core_pct' };

function isBl_(a) { return !!a && blPart(a.assessment) > 0; }

function blDeadlineMs_(att, cfg) {
  var d = parseTime(att.deadline_at);
  return isNaN(d) ? att.started_ms + cfg[BL_MINUTES_[att.assessment]] * 60000 : d;
}

function blHardEndMs_(att, cfg) { return blDeadlineMs_(att, cfg) + cfg.grace_minutes * 60000; }

function sjtLock_(att) { return att.section_locks && att.section_locks.SJT ? att.section_locks.SJT : null; }

function blServed_(att, byId) { return att.served.filter(function (id) { return byId[id]; }); }

/**
 * The answers that count for an attempt, from raw client (or saved) answers: each cleaned for its
 * item type; Part 2 SJT answers come from the lock record once locked (frozen), and rating answers
 * are ignored before the lock (the statements were not sent yet).
 */
function blEffectiveAnswers_(att, raw, byId) {
  var served = blServed_(att, byId);
  var lock = att.assessment === 'baseline_p2' ? sjtLock_(att) : null;
  var ids = served.filter(function (id) {
    if (att.assessment !== 'baseline_p2') return true;
    return byId[id].section === 'SJT' ? !lock : !!lock;
  });
  var out = cleanBlAnswers(raw, ids, byId);
  if (lock) {
    var frozen = cleanBlAnswers(lock.answers || {}, served.filter(function (id) { return byId[id].section === 'SJT'; }), byId);
    Object.keys(frozen).forEach(function (id) { out[id] = frozen[id]; });
  }
  var ordered = {};
  served.forEach(function (id) { if (Object.prototype.hasOwnProperty.call(out, id)) ordered[id] = out[id]; });
  return ordered;
}

// ---------------------------------------------------------------- expiry

function staleBl_(code) {
  var cfg = config_(), now = nowMs_();
  return userAttempts_(code).filter(function (a) { return isBl_(a) && a.status === 'open' && now > blHardEndMs_(a, cfg); });
}

/** Auto-submits expired parts from the last save (status expired). Lock required. */
function expireBl_(code) {
  var cfg = config_();
  staleBl_(code).forEach(function (a) { finalizeBl_(a, a.answers, a.self_ratings, 'expired', blHardEndMs_(a, cfg)); });
}

function expireAllBl_() {
  var codes = {};
  allAttempts_().forEach(function (a) { if (isBl_(a) && a.status === 'open') codes[a.code] = true; });
  Object.keys(codes).forEach(expireBl_);
  invalidate_('Attempts');
}

// ---------------------------------------------------------------- start

function overrideFor_(code, wave, part) {
  var found = '';
  readTableOpt_('Overrides').rows.forEach(function (r) {
    if (normCode(r.employee_code) === code && normWave(r.wave) === wave && toInt(r.part, 0) === part) {
      var f = String(r.form || '').trim().toUpperCase();
      if (BL_FORMS.indexOf(f) >= 0) found = f; // the latest row wins
    }
  });
  return found;
}

function pickP1Form_(s, cfg) {
  var atts = allAttempts_();
  var people = {};
  rosterRows_().map(userView_).forEach(function (u) { people[u.code] = u; });
  var counts = {};
  cfg.p1_live.forEach(function (f) { counts[f] = 0; });
  atts.forEach(function (a) {
    if (a.assessment !== 'baseline_p1' || a.wave !== cfg.wave || !(a.form in counts)) return;
    var u = people[a.code];
    if (!u || u.is_test || u.role_area !== s.user.role_area) return;
    counts[a.form]++;
  });
  var prev = atts.filter(function (a) { return a.code === s.code && a.assessment === 'baseline_p1' && isDone_(a) && a.wave && a.wave < cfg.wave; })
    .sort(function (a, b) { return a.wave < b.wave ? 1 : a.wave > b.wave ? -1 : 0; })[0];
  var r = chooseP1Form({ override: overrideFor_(s.code, cfg.wave, 1), live: cfg.p1_live, counts: counts, previousForm: prev ? prev.form : '', code: s.code, wave: cfg.wave });
  if (!r.form) throw apiError_('not_found', 'Part 1 has no live form yet.');
  return r.form;
}

function startBl_(s, assessment) {
  var cfg = config_(), now = nowMs_();
  expireBl_(s.code);
  var mine = userAttempts_(s.code).filter(function (a) { return a.assessment === assessment && a.wave === cfg.wave; });
  var open = mine.filter(function (a) { return a.status === 'open'; })[0];
  if (open) { setLogInfo_(s.code, assessment + ' resume ' + open.attempt_id); return blStartPayload_(open, true); }
  if (mine.some(isDone_)) throw apiError_('already_submitted', 'You have already done this part in this wave.');
  if (!cfg[BL_SWITCH_[assessment]]) throw apiError_('not_open', 'This part of the baseline is not open.');
  var part = blPart(assessment), form = 'ONE', module = '', items;
  if (part === 1) {
    form = pickP1Form_(s, cfg);
    items = blGroup_('baseline_p1', form, '');
  } else if (part === 2) {
    items = blGroup_('baseline_p2', '', '');
  } else {
    module = p3ModuleFor(s.user.p3_module, s.user.role_area);
    if (!module) throw apiError_('not_found', 'No Part 3 module is set for you yet. Please ask HR.');
    items = blItemsForAttempt_({ assessment: assessment, module: module });
  }
  var served = blSortItems(items.filter(function (i) { return i.active; })).map(function (i) { return i.item_id; });
  if (!served.length) throw apiError_('not_found', 'This part has no questions yet.');
  var minutes = cfg[BL_MINUTES_[assessment]];
  var att = createAttempt_(s.code, assessment, '', form, 1, served, cfg.wave, {
    part: part, module: module, deadline_at: iso7(now + minutes * 60000), section_locks: ''
  });
  return blStartPayload_(att, false);
}

function blSection_(id, titleKey, introKey) {
  var t = blTextOf_(titleKey), i = introKey ? blTextOf_(introKey) : { en: '', vi: '' };
  return { id: id, title_en: t.en, title_vi: t.vi, intro_en: i.en, intro_vi: i.vi, locked: false, items: [] };
}

function blRateSection_(att, byId) {
  var sec = blSection_('RATE', 'p2_sec_RATE', 'p2_sec_RATE_intro');
  if (sjtLock_(att)) {
    sec.items = blServed_(att, byId).filter(function (id) { return byId[id].section === 'RATE'; })
      .map(function (id) { return serveBaselineItem(byId[id], att.seed + ':' + id); });
  }
  return sec;
}

function blScale4_(naKey) {
  var points = [1, 2, 3, 4].map(function (v) { var t = blTextOf_('p2_scale_' + v); return { v: v, en: t.en, vi: t.vi }; });
  var x = blTextOf_(naKey);
  return { points: points, extra: { en: x.en, vi: x.vi } };
}

/** start/resume payload (specs/22 §4). */
function blStartPayload_(att, resumed) {
  var cfg = config_();
  var byId = indexItems_(blItemsForAttempt_(att));
  var served = blServed_(att, byId);
  var part = blPart(att.assessment);
  var deadline = blDeadlineMs_(att, cfg);
  var title = blTextOf_('p' + part + '_title'), intro = blTextOf_('p' + part + '_intro');
  var out = {
    attempt_id: att.attempt_id, assessment: att.assessment, part: part, form: att.form, module: att.module || '',
    started_at: att.started_at, deadline_at: iso7(deadline), time_limit_min: Math.round((deadline - att.started_ms) / 60000),
    resumed: !!resumed, title_en: title.en, title_vi: title.vi, intro_en: intro.en, intro_vi: intro.vi,
    answers: blEffectiveAnswers_(att, att.answers, byId)
  };
  var serve = function (sec) {
    return served.filter(function (id) { return byId[id].section === sec; }).map(function (id) { return serveBaselineItem(byId[id], att.seed + ':' + id); });
  };
  if (part === 1) {
    var a = blSection_('A', 'p1_sec_A', 'p1_sec_A_intro'), b = blSection_('B', 'p1_sec_B', 'p1_sec_B_intro_' + att.form);
    a.items = serve('A');
    b.items = serve('B');
    out.sections = [a, b];
  } else if (part === 2) {
    var sj = blSection_('SJT', 'p2_sec_SJT', 'p2_sec_SJT_intro');
    sj.items = serve('SJT');
    sj.locked = !!sjtLock_(att);
    out.sections = [sj, blRateSection_(att, byId)];
    var sc = blScale4_('p2_scale_nr');
    out.rating_scale = { points: sc.points, nr: sc.extra };
  } else {
    var core = blSection_('CORE', 'p3_sec_CORE', 'p3_sec_CORE_intro'), mod = blSection_('MOD', 'p3_sec_' + att.module, 'p3_sec_' + att.module + '_intro');
    core.items = serve('CORE');
    mod.items = serve('MOD');
    out.sections = [core, mod];
  }
  if (part === 1 || part === 3) {
    var ex = blExhibits_(), exOut = {};
    out.sections.forEach(function (sec) {
      sec.items.forEach(function (it) {
        (it.exhibit_ids || []).forEach(function (x) {
          if (ex[x] && !exOut[x]) exOut[x] = { title_en: ex[x].title_en, title_vi: ex[x].title_vi, md_en: ex[x].md_en, md_vi: ex[x].md_vi };
        });
      });
    });
    out.exhibits = exOut;
  }
  if (part === 1) {
    var cases = {};
    served.forEach(function (id) {
      var c = byId[id].case_id;
      if (c && !cases[c]) { var t = blTextOf_('p1_case_' + att.form + '_' + c); cases[c] = { title_en: t.en, title_vi: t.vi }; }
    });
    out.cases = cases;
  }
  if (part === 3) {
    var text = blText_(), lines = [];
    Object.keys(text).forEach(function (k) { var m = /^p3_glossary_(\d+)$/.exec(k); if (m) lines.push({ n: parseInt(m[1], 10), en: text[k].en, vi: text[k].vi || text[k].en }); });
    lines.sort(function (x, y) { return x.n - y.n; });
    out.glossary = { en: lines.map(function (l) { return l.en; }), vi: lines.map(function (l) { return l.vi; }) };
    out.self_ratings = cleanSelfRatings(att.self_ratings, courseOrder_());
    out.self = courses_().map(function (c) { return { course: c.code, en: c.self_en, vi: c.self_vi }; });
    out.scale = (SEED.scale || []).map(function (x) {
      var tail = x.abbr ? ' (' + x.abbr + ')' : '';
      return { level: x.level, en: x.level + ' · ' + x.en + tail, vi: x.level + ' · ' + x.vi + tail, desc_en: x.desc_en, desc_vi: x.desc_vi };
    });
  }
  return out;
}

// ---------------------------------------------------------------- save, SJT lock, submit

/** Patch for `save` (no lock, F4): answers per type and lock rules; Part 3 self-ratings. */
function blSavePatch_(att, body) {
  var cfg = config_();
  if (nowMs_() > blHardEndMs_(att, cfg)) throw apiError_('already_submitted', 'Time is up: this part is graded from your last save.');
  var byId = indexItems_(blItemsForAttempt_(att));
  var patch = {};
  if (body.answers !== undefined) patch.answers = JSON.stringify(blEffectiveAnswers_(att, body.answers, byId));
  if (att.assessment === 'baseline_p3' && body.self_ratings !== undefined) patch.self_ratings = JSON.stringify(cleanSelfRatings(body.self_ratings, courseOrder_()));
  return patch;
}

/**
 * baseline_next {token, attempt_id, answers} (Part 2) → {locked: ['SJT'], section: RATE with items}.
 * Saves the answers, requires every SJT item with two different picks, then freezes them.
 */
function apiBaselineNext_(body) {
  var s = requireSession_(body);
  var id = String(body.attempt_id || '').trim();
  if (!id) throw apiError_('bad_request', 'attempt_id is required');
  return withLock_(function () {
    var att = findAttemptById_(id);
    if (!att || att.code !== s.code || att.status === 'void') throw apiError_('not_found', 'Attempt not found');
    if (att.assessment !== 'baseline_p2') throw apiError_('bad_request', 'Only Part 2 has a next section.');
    setLogInfo_(s.code, 'baseline_p2 next ' + id);
    if (isDone_(att)) throw apiError_('already_submitted', 'This part is already submitted.');
    var cfg = config_(), now = nowMs_();
    if (now > blHardEndMs_(att, cfg)) {
      finalizeBl_(att, att.answers, att.self_ratings, 'expired', blHardEndMs_(att, cfg));
      throw apiError_('already_submitted', 'Time is up: this part is graded from your last save.');
    }
    var byId = indexItems_(blItemsForAttempt_(att));
    if (!sjtLock_(att)) {
      var answers = blEffectiveAnswers_(att, body.answers !== undefined ? body.answers : att.answers, byId);
      updateRow_('Attempts', att._row, { answers: JSON.stringify(answers), last_saved_at: iso7(now) });
      var sjtIds = blServed_(att, byId).filter(function (x) { return byId[x].section === 'SJT'; });
      var bad = sjtLockProblem(sjtIds, answers);
      if (bad) throw apiError_('bad_request', 'Choose one most and one different least effective option in every situation.', { field: bad });
      var frozen = {};
      sjtIds.forEach(function (x) { frozen[x] = answers[x]; });
      var locks = att.section_locks && typeof att.section_locks === 'object' ? att.section_locks : {};
      locks.SJT = { at: iso7(now), answers: frozen };
      updateRow_('Attempts', att._row, { section_locks: JSON.stringify(locks) });
      att.section_locks = locks;
    }
    return { locked: ['SJT'], section: blRateSection_(att, byId) };
  });
}

/** submit for a baseline part (inside the lock). Server-side expiry grades the last save without the checks. */
function blSubmit_(att, body) {
  var cfg = config_(), now = nowMs_();
  if (now > blHardEndMs_(att, cfg)) { finalizeBl_(att, att.answers, att.self_ratings, 'expired', blHardEndMs_(att, cfg)); return; }
  var byId = indexItems_(blItemsForAttempt_(att));
  var answers = blEffectiveAnswers_(att, body.answers !== undefined ? body.answers : att.answers, byId);
  var self = att.self_ratings;
  // Time is up (inside the grace period): grade what was sent, without the completeness checks.
  if (now >= blDeadlineMs_(att, cfg)) {
    if (att.assessment === 'baseline_p3') self = cleanSelfRatings(body.self_ratings !== undefined ? body.self_ratings : att.self_ratings, courseOrder_());
    finalizeBl_(att, answers, self, 'submitted', now);
    return;
  }
  if (att.assessment === 'baseline_p2') {
    if (!sjtLock_(att)) throw apiError_('bad_request', 'Finish and lock Part 2A first.', { field: 'SJT' });
    var missing = blServed_(att, byId).filter(function (x) { return byId[x].section === 'RATE' && answers[x] === undefined; })[0];
    if (missing) throw apiError_('bad_request', 'Please answer every statement.', { field: missing });
  }
  if (att.assessment === 'baseline_p3') {
    var order = courseOrder_();
    self = cleanSelfRatings(body.self_ratings !== undefined ? body.self_ratings : att.self_ratings, order);
    if (Object.keys(self).length < order.length) throw apiError_('bad_request', 'Please rate all ' + order.length + ' statements first.', { field: 'self_ratings' });
  }
  finalizeBl_(att, answers, self, 'submitted', now);
}

/** Scores a part and stores everything in its Attempts row (lock required). */
function finalizeBl_(att, rawAnswers, selfRatings, status, submittedMs) {
  assertLocked_();
  var cfg = config_();
  var byId = indexItems_(blItemsForAttempt_(att));
  var served = blServed_(att, byId);
  var answers = blEffectiveAnswers_(att, rawAnswers, byId);
  var deadline = blDeadlineMs_(att, cfg);
  var used = status === 'expired' ? deadline - att.started_ms : Math.min(submittedMs, blHardEndMs_(att, cfg)) - att.started_ms;
  var at = iso7(submittedMs);
  var patch = {
    status: status, submitted_at: at, answers: JSON.stringify(answers), graded_answers: JSON.stringify(answers),
    time_used_s: Math.max(0, Math.round(used / 1000)), passed: ''
  };
  if (att.assessment === 'baseline_p2') {
    var sj = scoreSjt(served, answers, byId);
    var rateItems = served.filter(function (x) { return byId[x].section === 'RATE'; }).map(function (x) { return byId[x]; });
    var means = ratingMeans(answers, rateItems);
    var byCharter = {};
    BL_CHARTERS.forEach(function (c) {
      var x = sj.by_charter[c], m = means.by_charter[c];
      if (!x && !m) return;
      byCharter[c] = { sjt_points: x ? x.sjt_points : 0, sjt_max: x ? x.sjt_max : 0, self_mean: m ? round1(m.mean) : null };
    });
    Object.assign(patch, {
      n_items: sj.max, n_correct: sj.points, score_pct: sj.pct, raw_pct: sj.pct, by_charter: JSON.stringify(byCharter),
      section_pct: JSON.stringify({ SJT: sj.pct })
    });
    updateRow_('Attempts', att._row, patch);
    var vals = {};
    rateItems.forEach(function (it) { vals[it.item_id] = answers[it.item_id] === undefined ? '' : answers[it.item_id]; });
    upsertRatings_(att.wave, att.code, att.code, 'self', vals, at);
    return;
  }
  var sc = scoreBlMcq(served, answers, byId);
  Object.assign(patch, { n_items: sc.n, n_correct: sc.correct, score_pct: sc.pct, raw_pct: sc.pct });
  if (att.assessment === 'baseline_p1') {
    Object.assign(patch, {
      scaled_pct: sc.pct, by_step: JSON.stringify(sc.by_step), by_move: JSON.stringify(sc.by_move),
      by_course: JSON.stringify(sc.by_course), section_pct: JSON.stringify({ A: pctOf(sc.by_section.A), B: pctOf(sc.by_section.B) })
    });
    updateRow_('Attempts', att._row, patch);
    return;
  }
  var order = courseOrder_();
  var self = cleanSelfRatings(selfRatings, order);
  Object.assign(patch, {
    by_level: JSON.stringify(sc.by_level), by_gate: JSON.stringify(sc.by_gate), self_ratings: JSON.stringify(self),
    section_pct: JSON.stringify({ CORE: pctOf(sc.by_section.CORE), MOD: pctOf(sc.by_section.MOD) })
  });
  updateRow_('Attempts', att._row, patch);
  var srRows = order.filter(function (c) { return c in self; }).map(function (c) {
    return { employee_code: att.code, wave: att.wave, course: c, level: self[c], submitted_at: at };
  });
  if (srRows.length) appendRows_('SelfRatings', srRows);
}

/** What a learner sees after a sitting: "Part N done" and time used (no score, no feedback). */
function blResult_(att) {
  return { assessment: att.assessment, part: blPart(att.assessment), submitted_at: att.submitted_at, time_used_s: att.time_used_s };
}

// ---------------------------------------------------------------- me, team_status

function blPartItemCount_(assessment, user, att) {
  var cfg = config_();
  var count = function (list) { return list.filter(function (i) { return i.active; }).length; };
  if (att) return att.served.length;
  if (assessment === 'baseline_p1') return count(blGroup_('baseline_p1', cfg.p1_live[0] || 'B', ''));
  if (assessment === 'baseline_p2') return count(blGroup_('baseline_p2', '', ''));
  var m = p3ModuleFor(user.p3_module, user.role_area);
  return count(blItemsForAttempt_({ assessment: 'baseline_p3', module: m }));
}

function canRate_(user) { return user.is_manager || user.roles.indexOf('admin') >= 0; }

/** me.baseline (specs/22 §4). */
function blMeState_(s, atts) {
  var cfg = config_();
  var parts = {}, anyDone = false;
  BL_ASSESSMENTS.forEach(function (a, i) {
    var cur = atts.filter(function (x) { return x.assessment === a && x.wave === cfg.wave; });
    var open = cur.filter(function (x) { return x.status === 'open'; })[0] || null;
    var done = cur.filter(isDone_)[0] || null;
    var st = {
      open: cfg[BL_SWITCH_[a]], status: done ? 'submitted' : open ? 'in_progress' : 'not_started',
      minutes: cfg[BL_MINUTES_[a]], n_items: blPartItemCount_(a, s.user, done || open)
    };
    var att = done || open;
    if (att) {
      st.attempt_id = att.attempt_id;
      st.started_at = att.started_at;
      if (done) st.submitted_at = att.submitted_at; else st.deadline_at = iso7(blDeadlineMs_(att, cfg));
      if (a === 'baseline_p1') st.form = att.form;
    }
    if (done) anyDone = true;
    parts['p' + (i + 1)] = st;
  });
  var out = { wave: cfg.wave, parts: parts, results_open: cfg.results_open, profile_ready: cfg.results_open && anyDone, rating: null };
  if (canRate_(s.user)) {
    var list = rateList_(s.code, cfg);
    out.rating = { open: cfg.rating_open, to_rate: list.length, done: list.filter(function (r) { return r.status === 'complete'; }).length };
  }
  var prevWaves = {};
  atts.forEach(function (a) { if (isBl_(a) && isDone_(a) && a.wave && a.wave < cfg.wave) (prevWaves[a.wave] = prevWaves[a.wave] || []).push(blPart(a.assessment)); });
  var pw = Object.keys(prevWaves).sort().pop();
  if (pw) out.previous = { wave: pw, parts_done: prevWaves[pw].filter(function (p, i, l) { return l.indexOf(p) === i; }).sort() };
  return out;
}

/** team_status baseline: {p1, p2, p3} = done | in_progress | not_done (no scores). */
function blTeamStatus_(mine, cfg) {
  var out = {};
  BL_ASSESSMENTS.forEach(function (a, i) {
    var cur = mine.filter(function (x) { return x.assessment === a && x.wave === cfg.wave; });
    out['p' + (i + 1)] = cur.some(isDone_) ? 'done' : cur.some(function (x) { return x.status === 'open'; }) ? 'in_progress' : 'not_done';
  });
  return out;
}

// ---------------------------------------------------------------- Ratings (180°)

function rateItems_() {
  return blSortItems(blGroup_('baseline_p2', '', 'RATE').filter(function (i) { return i.active && i.section === 'RATE'; }));
}

/** Active, non-test people whose Roster.manager_code is the rater (managers included: Quân rates them). */
function ratees_(raterCode) {
  return rosterRows_().map(userView_).filter(function (u) { return u.active && u.code && !u.is_test && u.code !== raterCode && u.manager_code === raterCode; });
}

function ratingRows_(wave) {
  return readTableOpt_('Ratings').rows.filter(function (r) { return normWave(r.wave) === wave; });
}

/** Upserts one rater's values for one ratee (one row per wave, ratee, rater, role, item). Lock required. */
function upsertRatings_(wave, ratee, rater, role, values, at) {
  var existing = {};
  ratingRows_(wave).forEach(function (r) {
    if (normCode(r.ratee_code) === ratee && normCode(r.rater_code) === rater && String(r.rater_role).trim().toLowerCase() === role) existing[String(r.item_id).trim()] = r;
  });
  var add = [];
  Object.keys(values).forEach(function (id) {
    var v = values[id];
    if (existing[id]) {
      if (String(existing[id].value) !== String(v)) updateRow_('Ratings', existing[id]._row, { value: v, saved_at: at });
    } else if (v !== '') add.push({ wave: wave, ratee_code: ratee, rater_code: rater, rater_role: role, item_id: id, value: v, saved_at: at });
  });
  if (add.length) appendRows_('Ratings', add);
  invalidate_('Ratings');
}

function managerValues_(rows, ratee, rater) {
  var vals = {}, saved = '';
  rows.forEach(function (r) {
    if (normCode(r.ratee_code) !== ratee || normCode(r.rater_code) !== rater || String(r.rater_role).trim().toLowerCase() !== 'manager') return;
    var v = String(r.value || '').trim().toUpperCase();
    if (!v) return;
    vals[String(r.item_id).trim()] = v === 'NA' ? 'NA' : toInt(v, 0);
    if (r.saved_at && r.saved_at > saved) saved = r.saved_at;
  });
  return { values: vals, saved_at: saved || null };
}

function rateList_(raterCode, cfg) {
  var items = rateItems_(), rows = ratingRows_(cfg.wave);
  return ratees_(raterCode).map(function (u) {
    var mv = managerValues_(rows, u.code, raterCode);
    var n = items.filter(function (it) { return mv.values[it.item_id] !== undefined; }).length;
    return { code: u.code, first_name: u.first_name, role_area: u.role_area, status: !n ? 'not_started' : n >= items.length && items.length ? 'complete' : 'in_progress', saved_at: mv.saved_at };
  });
}

function requireRater_(s) {
  if (!canRate_(s.user)) throw apiError_('forbidden', 'Only managers can rate their team.');
}

function rateeFor_(s, code) {
  var c = normCode(code);
  var u = ratees_(s.code).filter(function (x) { return x.code === c; })[0];
  if (!u) throw apiError_('forbidden', 'You can rate only your own team members.');
  return u;
}

/** rate_list {token} → {open, wave, reports: [{code, first_name, role_area, status, saved_at}]} (manager/admin). */
function apiRateList_(body) {
  var s = requireSession_(body);
  requireRater_(s);
  var cfg = config_();
  return { open: cfg.rating_open, wave: cfg.wave, reports: rateList_(s.code, cfg) };
}

/**
 * rate_get {token, ratee} → manager wording, guide, scale (1–4 + N/A), saved values. Not before
 * rating opens: the statements describe what the Part 2 SJT rewards, and raters are learners too.
 */
function apiRateGet_(body) {
  var s = requireSession_(body);
  requireRater_(s);
  var cfg = config_();
  var u = rateeFor_(s, body.ratee);
  if (!cfg.rating_open) throw apiError_('not_open', 'Manager rating is not open yet.');
  var mv = managerValues_(ratingRows_(cfg.wave), u.code, s.code);
  var guide = blTextOf_('p2_rater_guide'), sc = blScale4_('p2_scale_na');
  return {
    open: cfg.rating_open, ratee: { code: u.code, first_name: u.first_name }, guide_en: guide.en, guide_vi: guide.vi,
    scale: { points: sc.points, na: sc.extra }, items: rateItems_().map(managerRatingItem), values: mv.values, saved_at: mv.saved_at
  };
}

/** rate_save {token, ratee, values} → {saved_at, complete}. Partial saves are fine; null or '' clears a value. */
function apiRateSave_(body) {
  var s = requireSession_(body);
  requireRater_(s);
  var cfg = config_();
  if (!cfg.rating_open) throw apiError_('not_open', 'Manager rating is not open.');
  var u = rateeFor_(s, body.ratee);
  var items = rateItems_();
  var cv = cleanRatingValues(body.values, items, 'manager');
  if (cv.bad) throw apiError_('bad_request', 'Ratings are 1–4 or N/A.', { field: cv.bad });
  return withLock_(function () {
    var at = iso7(nowMs_());
    setLogInfo_(s.code, 'rate ' + u.code);
    upsertRatings_(cfg.wave, u.code, s.code, 'manager', cv.values, at);
    var mv = managerValues_(ratingRows_(cfg.wave), u.code, s.code);
    return { saved_at: at, complete: items.length > 0 && items.every(function (it) { return mv.values[it.item_id] !== undefined; }) };
  });
}

// ---------------------------------------------------------------- profiles

/** Everything buildProfile_ needs, read once. */
function blProfileContext_() {
  var cfg = config_();
  var byCode = {};
  allAttempts_().forEach(function (a) { if (isBl_(a) && isDone_(a) && a.wave === cfg.wave) (byCode[a.code] = byCode[a.code] || {})[a.assessment] = a; });
  var mgr = {};
  ratingRows_(cfg.wave).forEach(function (r) {
    if (String(r.rater_role).trim().toLowerCase() !== 'manager') return;
    var v = toInt(r.value, 0);
    if (v < 1 || v > 4) return;
    var c = normCode(r.ratee_code), id = String(r.item_id).trim();
    var m = (mgr[c] = mgr[c] || {});
    (m[id] = m[id] || []).push(v);
  });
  var text = blText_(), names = {};
  ['p1_A', 'p1_B'].forEach(function (k) { names[k] = text['p1_sec_' + k.slice(3)]; });
  names.p3_CORE = text.p3_sec_CORE;
  BL_MODULES.forEach(function (m) { names['p3_' + m] = text['p3_sec_' + m]; });
  BL_CHARTERS.forEach(function (c) { names['charter_' + c] = text['p2_charter_' + c]; });
  return { cfg: cfg, byCode: byCode, mgr: mgr, names: names, rateItems: rateItems_(), order: courseOrder_() };
}

/** One person's profile, or null when they have no submitted part and no manager rating. */
function buildProfile_(code, ctx) {
  var cfg = ctx.cfg, mine = ctx.byCode[code] || {};
  var p1 = mine.baseline_p1, p2 = mine.baseline_p2, p3 = mine.baseline_p3;
  var mgrRaw = ctx.mgr[code] || {}, mgr = {};
  Object.keys(mgrRaw).forEach(function (id) { mgr[id] = mgrRaw[id].reduce(function (s, x) { return s + x; }, 0) / mgrRaw[id].length; });
  if (!p1 && !p2 && !p3 && !Object.keys(mgr).length) return null;
  var counts = function (att) {
    var byId = indexItems_(blItemsForAttempt_(att));
    return scoreBlMcq(blServed_(att, byId), gradedAnswers_(att), byId);
  };
  var inp = {
    wave: cfg.wave, built_at: iso7(nowMs_()), order: ctx.order, w_sjt: cfg.p2_w_sjt, w_mgr: cfg.p2_w_mgr, names: ctx.names,
    self_courses: p3 ? cleanSelfRatings(p3.self_ratings, ctx.order) : {}, p1: null, p2: null, p3: null
  };
  if (p1) {
    var c1 = counts(p1);
    inp.p1 = { form: p1.form, raw_pct: p1.raw_pct, scaled_pct: p1.scaled_pct, by_section: c1.by_section, by_step: c1.by_step, by_move: c1.by_move, by_course: c1.by_course };
  }
  if (p2 || Object.keys(mgr).length) {
    var self = {}, sj = { points: 0, max: 0, by_charter: {} };
    if (p2) {
      var byId2 = indexItems_(blItemsForAttempt_(p2));
      var g2 = gradedAnswers_(p2);
      sj = scoreSjt(blServed_(p2, byId2), g2, byId2);
      ctx.rateItems.forEach(function (it) { if (g2[it.item_id] !== undefined) self[it.item_id] = g2[it.item_id]; });
    }
    inp.p2 = { by_charter: sj.by_charter, points: sj.points, max: p2 ? sj.max : 0, items: ctx.rateItems, self: self, mgr: mgr };
  }
  if (p3) {
    var c3 = counts(p3);
    inp.p3 = { module: p3.module, total_pct: p3.raw_pct, core_pct: pctOf(c3.by_section.CORE), module_pct: pctOf(c3.by_section.MOD), by_level: c3.by_level, by_gate: c3.by_gate };
  }
  return buildBaselineProfile(inp);
}

/** Part 1 equating (mean-sigma, specs/22 §3): writes scaled_pct on every submitted Part 1 attempt. Lock required. */
function applyEquating_(cfg) {
  var people = {};
  rosterRows_().map(userView_).forEach(function (u) { people[u.code] = u; });
  var atts = allAttempts_().filter(function (a) { return a.assessment === 'baseline_p1' && a.wave === cfg.wave && isDone_(a) && a.raw_pct !== null; });
  var scores = {};
  atts.forEach(function (a) {
    var u = people[a.code];
    if (!u || u.is_test || !u.active) return;
    (scores[a.form] = scores[a.form] || []).push(a.raw_pct);
  });
  var plan = equatingPlan(scores, cfg.p1_live, cfg.equate_threshold_pts, 'A');
  atts.forEach(function (a) {
    var sc = scaledFor(plan, a.form, a.raw_pct);
    if (sc !== a.scaled_pct) updateRow_('Attempts', a._row, { scaled_pct: sc });
  });
  invalidate_('Attempts');
  return plan;
}

/** buildProfiles(): expiry, equating, then one Profiles row per person for the current wave (menu + hourly while results_open). */
function buildProfiles() {
  resetRequest_();
  var n = 0;
  withLock_(function () { n = buildProfilesLocked_(); });
  return n;
}

function buildProfilesLocked_() {
  var cfg = config_();
  expireAllBl_();
  applyEquating_(cfg);
  var ctx = blProfileContext_();
  var at = iso7(nowMs_());
  var rows = [];
  rosterRows_().map(userView_).forEach(function (u) {
    if (!u.code || !u.active) return;
    var p = buildProfile_(u.code, ctx);
    if (p) rows.push({ employee_code: u.code, wave: cfg.wave, built_at: at, json: JSON.stringify(p) });
  });
  var keep = readTableOpt_('Profiles').rows.filter(function (r) { return normWave(r.wave) !== cfg.wave; })
    .map(function (r) { return { employee_code: r.employee_code, wave: r.wave, built_at: r.built_at, json: r.json }; });
  replaceBody_('Profiles', SCHEMA.Profiles, keep.concat(rows));
  setLogInfo_('', 'profiles ' + rows.length);
  return rows.length;
}

/** profile {token} → the learner's own profile; not_open until results_open. */
function apiProfile_(body) {
  var s = requireSession_(body);
  var cfg = config_();
  if (!cfg.results_open) throw apiError_('not_open', 'Your baseline profile is not ready yet.');
  var row = null;
  readTableOpt_('Profiles').rows.forEach(function (r) { if (normCode(r.employee_code) === s.code && normWave(r.wave) === cfg.wave) row = r; });
  var p = row ? parseJson_(row.json, null) : null;
  if (!p) {
    if (staleBl_(s.code).length) withLock_(function () { expireBl_(s.code); });
    invalidate_('Attempts');
    p = buildProfile_(s.code, blProfileContext_()); // not built yet (the hourly job will write it)
  }
  if (!p) throw apiError_('not_found', 'You have not taken a baseline part in this wave.');
  return p;
}

// ---------------------------------------------------------------- team numbers (Summary rows)

/** Baseline team averages for the Summary tab (only called while results_open; graded fresh after expiry). */
function blSummaryRows_(people, minN, emit) {
  var cfg = config_();
  expireAllBl_();
  var fresh = {};
  allAttempts_().forEach(function (a) { if (isBl_(a) && isDone_(a) && a.wave === cfg.wave) (fresh[a.code] = fresh[a.code] || {})[a.assessment] = a; });
  var ctx = blProfileContext_();
  var rows = people.map(function (u) {
    var m = fresh[u.code] || {}, mg = ctx.mgr[u.code] || {}, all = [];
    Object.keys(mg).forEach(function (id) { all = all.concat(mg[id]); });
    var p1 = m.baseline_p1, p3 = m.baseline_p3;
    return {
      group: u.role_area, is_manager: u.is_manager, roles: u.roles_raw,
      values: {
        bl2_p1_pct: p1 ? (p1.scaled_pct !== null ? p1.scaled_pct : p1.raw_pct) : null,
        bl2_p2_sjt_pct: m.baseline_p2 ? m.baseline_p2.raw_pct : null,
        bl2_p2_mgr_mean: all.length ? all.reduce(function (s, x) { return s + x; }, 0) / all.length : null,
        bl2_p3_core_pct: p3 && p3.section_pct && typeof p3.section_pct.CORE === 'number' ? p3.section_pct.CORE : null
      }
    };
  }).filter(function (r) { return Object.keys(r.values).some(function (k) { return r.values[k] !== null; }); });
  summarise(rows, minN).forEach(function (g) {
    Object.keys(BL_SUMMARY_METRICS_).forEach(function (k) {
      var v = g.avg[k];
      emit(cfg.wave, g, k, 'BL2', v === null || v === undefined ? '' : (k === 'bl2_p2_mgr_mean' ? round1(v) : Math.round(v)), g.count[k] || 0);
    });
  });
}
