/**
 * Data.gs · Sheet access, Config, cache, lock and API errors.
 * Every tab is read as strings (F5); every write goes to plain-text ('@') cells.
 * Appends and admin writes run inside withLock_(); `save` writes its own row without it (F4).
 */

/** Row 1 headers of every tab (specs/11 + specs/19). setupSheet() adds missing ones at the end. */
var SCHEMA = {
  Config: ['key', 'value', 'note'],
  Roster: ['employee_code', 'display_name', 'role_area', 'is_manager', 'manager_code', 'roles', 'pin_hash', 'pin_salt',
    'must_change_pin', 'failed_logins', 'locked_until', 'active', 'lang',
    'preferred_name', 'lock_count', 'session_ver', 'consent_at', 'certificate', 'lock_history', 'p3_module'],
  Courses: ['code', 'name_en', 'name_vi', 'self_en', 'self_vi',
    'obj1_en', 'obj1_vi', 'obj2_en', 'obj2_vi', 'obj3_en', 'obj3_vi', 'obj4_en', 'obj4_vi', 'obj5_en', 'obj5_vi', 'obj6_en', 'obj6_vi',
    'cycle', 'blink_url', 'online_from', 'checkpoint_close', 'forum_date', 'field_until', 'open', 'order'],
  Items: ['item_id', 'assessment', 'course', 'form', 'objective', 'case_id', 'stem_en', 'stem_vi',
    'a_en', 'a_vi', 'b_en', 'b_vi', 'c_en', 'c_vi', 'd_en', 'd_vi', 'answer', 'why_en', 'why_vi', 'active'],
  Cases: ['case_id', 'title_en', 'title_vi', 'context_en', 'context_vi'],
  Episodes: ['course', 'ep', 'title_en', 'minutes', 'blink_url', 'embed_url'],
  Watched: ['employee_code', 'course', 'ep', 'watched', 'updated_at'],
  Teams: ['team_id', 'project_title', 'members', 'sponsor_code', 'active'],
  Attempts: ['attempt_id', 'employee_code', 'assessment', 'course', 'form', 'attempt_no', 'status', 'started_at',
    'last_saved_at', 'submitted_at', 'served_items', 'answers', 'n_items', 'n_correct', 'score_pct', 'by_objective',
    'by_course', 'passed', 'wave', 'seed', 'self_ratings', 'graded_answers',
    'part', 'module', 'section_locks', 'raw_pct', 'scaled_pct', 'by_step', 'by_move', 'by_charter', 'by_level', 'by_gate',
    'time_used_s', 'section_pct', 'deadline_at'],
  SelfRatings: ['employee_code', 'wave', 'course', 'level', 'submitted_at'],
  Unlocks: ['employee_code', 'course', 'unlocked_by', 'unlocked_at', 'reason'],
  Recall: ['employee_code', 'course', 'due_date', 'day', 'status', 'score_pct', 'done_at', 'attempt_id'],
  Capstone: ['team_id', 'project_title', 'members', 'sponsor_code', 'soi_situation', 'soi_observation', 'soi_implication',
    'kpi_name', 'kpi_before', 'kpi_after', 'kpi_unit', 'evidence_url', 'value_vnd', 'value_basis', 'lessons',
    'submitted_by', 'submitted_at', 'stage'],
  PanelScores: ['team_id', 'stage', 'judge_code', 'c1_problem', 'c2_structure', 'c3_result', 'c4_value', 'c5_communication',
    'comment', 'scored_at'],
  Summary: ['wave_or_course', 'group', 'n', 'metric', 'course', 'value', 'updated_at', 'count'],
  Pulse: ['forum_date', 'nps', 'useful', 'will_use', 'change_next', 'submitted_at'],
  Log: ['ts', 'action', 'employee_code', 'ok', 'message'],
  // Baseline v2 (specs/22 §2)
  BaselineItems: ['item_id', 'assessment', 'part', 'section', 'module', 'item_type', 'form', 'order', 'case_id', 'exhibit_ids',
    'stem_en', 'stem_vi', 'a_en', 'a_vi', 'b_en', 'b_vi', 'c_en', 'c_vi', 'd_en', 'd_vi', 'answer', 'answer_most', 'answer_least',
    'why_en', 'why_vi', 'self_en', 'self_vi', 'mgr_en', 'mgr_vi', 'anchor1_en', 'anchor1_vi', 'anchor4_en', 'anchor4_vi',
    'allow_nr', 'step', 'move', 'objective', 'gate', 'level', 'charter', 'active'],
  Exhibits: ['exhibit_id', 'part', 'form', 'title_en', 'title_vi', 'md_en', 'md_vi'],
  BaselineText: ['key', 'en', 'vi'],
  Ratings: ['wave', 'ratee_code', 'rater_code', 'rater_role', 'item_id', 'value', 'saved_at'],
  Overrides: ['employee_code', 'wave', 'part', 'form', 'reason', 'by', 'at'],
  Profiles: ['employee_code', 'wave', 'built_at', 'json']
};

/** Config defaults: [key, value, note]. Written once by setupSheet(); never overwritten. */
function configDefaults_() {
  var b = (typeof SEED !== 'undefined' && SEED.program && SEED.program.baseline) || {};
  return [
    ['wave', b.wave || '2026-11', 'Baseline wave id (re-test: 2027-12)'],
    ['pass_mark', '0.8', 'Checkpoint pass mark (0.8 = 8/10)'],
    ['retake_hours', '24', 'Hours between checkpoint attempts'],
    ['max_free_attempts', '2', 'Attempts without an Unlocks row'],
    ['team_view_min_n', '3', 'Smallest group shown in team views'],
    ['session_hours', '6', 'Hours a login lasts'],
    ['recall_days', '2,7,30', 'Recall days after max(forum date, pass date)'],
    ['late_days', '7', 'Checkpoint stays open until forum_date + late_days'],
    ['pitch_deadline', '2027-06-21', 'Last day for Pitch Day submissions'],
    ['capstone_deadline', '2027-12-20', 'Last day for capstone submissions'],
    ['lock_failures', '5', 'Wrong PINs before a lock'],
    ['course_open_default', 'TRUE', 'Default for Courses.open when blank'],
    ['streak_skip_weeks', '2027-02-08', 'Mondays of weeks (comma-separated, e.g. Tết) that neither break nor add to the streak'],
    // Baseline v2 (specs/22): manual switches, no dates
    ['p1_open', 'FALSE', 'Baseline Part 1 open for everyone (menu: Baseline: open or close parts…)'],
    ['p2_open', 'FALSE', 'Baseline Part 2 open for everyone'],
    ['p3_open', 'FALSE', 'Baseline Part 3 open for everyone'],
    ['rating_open', 'FALSE', 'Managers and admins can rate their reports (Part 2, 180°)'],
    ['results_open', 'FALSE', 'Learners see their baseline profile; baseline team averages publish'],
    ['p1_live', 'B,C', 'Part 1 live forms (served automatically, balanced by role_area)'],
    ['p1_backup', 'A', 'Part 1 backup form (only through an Overrides row: Assign a Part 1 form…)'],
    ['p1_minutes', '65', 'Part 1 timer (both sections)'],
    ['p2_minutes', '35', 'Part 2 timer (SJT then self-rating)'],
    ['p3_minutes', '48', 'Part 3 timer (self-rating opener, core, module)'],
    ['grace_minutes', '5', 'Server grace after each part timer'],
    ['p2_w_sjt', '0.5', 'Charter index weight of the SJT'],
    ['p2_w_mgr', '0.5', 'Charter index weight of the manager rating'],
    ['equate_threshold_pts', '5', 'Equate Part 1 forms when live-form means differ by more than this (percentage points)']
  ];
}

// ---------------------------------------------------------------- errors

function apiError_(code, message, extra) {
  var e = new Error(message || code);
  e.apiCode = code;
  e.extra = extra || null;
  return e;
}

// ---------------------------------------------------------------- per-execution state

var REQ_ = null;
var LOCK_DEPTH_ = 0;

function resetRequest_() {
  REQ_ = { now: Date.now(), tables: {}, cfg: null, courses: null, gen: null, secrets: {}, logAction: '', logged: false, loggable: false, logCode: '', logMsg: '' };
  LOCK_DEPTH_ = 0;
  return REQ_;
}

function req_() { return REQ_ || resetRequest_(); }

function nowMs_() { return req_().now; }

function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet: the script must be bound to the "1pct-planner-data" Sheet');
  return ss;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab ' + name + ': run setupSheet');
  return sh;
}

// ---------------------------------------------------------------- lock

function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) {
    LOCK_DEPTH_++;
    try { return fn(); } finally { LOCK_DEPTH_--; }
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw apiError_('busy', 'The server is busy. Please try again.');
  LOCK_DEPTH_ = 1;
  req_().tables = {}; // fresh reads inside the lock
  var outcome = { ok: true, code: '' };
  try {
    return fn();
  } catch (e) {
    outcome.ok = false;
    outcome.code = e && e.apiCode ? e.apiCode : 'server_error';
    throw e;
  } finally {
    try { writeLogRow_(outcome); } catch (e1) { /* logging never breaks a request */ }
    try { SpreadsheetApp.flush(); } catch (e2) { /* ignore */ }
    LOCK_DEPTH_ = 0;
    lock.releaseLock();
  }
}

function assertLocked_() {
  if (LOCK_DEPTH_ < 1) throw new Error('Internal: write without the script lock');
}

// ---------------------------------------------------------------- tables

function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function headerKey_(h) { return String(h === null || h === undefined ? '' : h).trim().toLowerCase(); }

/** Reads a whole tab → {headers, col, rows:[{..., _row}]} (memoised for this execution). */
function readTable_(name) {
  var memo = req_().tables;
  if (memo[name]) return memo[name];
  var sh = sheet_(name);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var t = { name: name, headers: [], col: {}, rows: [] };
  if (lastRow >= 1 && lastCol >= 1) {
    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    t.headers = values[0].map(headerKey_);
    t.headers.forEach(function (h, i) { if (h && !(h in t.col)) t.col[h] = i; });
    for (var r = 1; r < values.length; r++) {
      var row = values[r], obj = { _row: r + 1 }, any = false;
      for (var c = 0; c < t.headers.length; c++) {
        var h = t.headers[c];
        if (!h || (h in obj)) continue;
        var s = cellToString(row[c]);
        obj[h] = s;
        if (s !== '') any = true;
      }
      if (any) t.rows.push(obj);
    }
  }
  memo[name] = t;
  return t;
}

/** Like readTable_, but a tab that does not exist yet reads as empty (the Baseline v2 tabs, before setupSheet runs on an updated deployment). */
function readTableOpt_(name) {
  if (!req_().tables[name] && !ss_().getSheetByName(name)) return { name: name, headers: [], col: {}, rows: [] };
  return readTable_(name);
}

function invalidate_(name) { delete req_().tables[name]; }

function headersOf_(name) {
  var memo = req_().tables[name];
  if (memo && memo.headers.length) return memo.headers;
  var sh = sheet_(name);
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(headerKey_);
}

/** Appends rows (objects keyed by header) in one write, as plain text. Lock required. */
function appendRows_(name, objs) {
  assertLocked_();
  if (!objs.length) return -1;
  var sh = sheet_(name);
  var headers = headersOf_(name);
  objs.forEach(function (o) {
    Object.keys(o).forEach(function (k) {
      if (headers.indexOf(k) < 0) throw new Error('Tab ' + name + ' has no column ' + k + ': run setupSheet');
    });
  });
  var rows = objs.map(function (o) {
    return headers.map(function (h) { return h && Object.prototype.hasOwnProperty.call(o, h) ? toCell_(o[h]) : ''; });
  });
  var start = sh.getLastRow() + 1;
  var need = start + rows.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 50);
  var range = sh.getRange(start, 1, rows.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(rows);
  invalidate_(name);
  return start;
}

/** Writes only the given columns of one row (contiguous runs in one call each). */
function updateRow_(name, rowNum, patch) {
  var sh = sheet_(name);
  var headers = headersOf_(name);
  var cols = [];
  Object.keys(patch).forEach(function (k) {
    var i = headers.indexOf(k);
    if (i < 0) throw new Error('Tab ' + name + ' has no column ' + k + ': run setupSheet');
    cols.push(i);
  });
  cols.sort(function (a, b) { return a - b; });
  var i = 0;
  while (i < cols.length) {
    var j = i;
    while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++;
    var vals = [];
    for (var c = cols[i]; c <= cols[j]; c++) vals.push(toCell_(patch[headers[c]]));
    sh.getRange(rowNum, cols[i] + 1, 1, vals.length).setValues([vals]);
    i = j + 1;
  }
  var memo = req_().tables[name];
  if (memo) {
    memo.rows.forEach(function (r) {
      if (r._row === rowNum) Object.keys(patch).forEach(function (k) { r[k] = toCell_(patch[k]); });
    });
  }
}

/** Row number of the first row whose `header` equals value (reads one column only), or -1. */
function findRowNumber_(name, header, value) {
  var memo = req_().tables[name];
  if (memo) {
    for (var m = 0; m < memo.rows.length; m++) if (memo.rows[m][header] === value) return memo.rows[m]._row;
    return -1;
  }
  var sh = sheet_(name);
  var headers = headersOf_(name);
  var c = headers.indexOf(header);
  var last = sh.getLastRow();
  if (c < 0 || last < 2) return -1;
  var vals = sh.getRange(2, c + 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (cellToString(vals[i][0]) === value) return i + 2;
  return -1;
}

/** One row as an object (header-keyed strings). */
function readRow_(name, rowNum) {
  var sh = sheet_(name);
  var headers = headersOf_(name);
  var vals = sh.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  var obj = { _row: rowNum };
  headers.forEach(function (h, i) { if (h && !(h in obj)) obj[h] = cellToString(vals[i]); });
  return obj;
}

/** Replaces every data row of a tab (Summary, dashboards). Lock required. */
function replaceBody_(name, headers, rows) {
  assertLocked_();
  var sh = sheet_(name);
  var last = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), headers.length);
  if (last > 1) sh.getRange(2, 1, last - 1, lastCol).clearContent();
  sh.getRange(1, 1, 1, headers.length).setNumberFormat('@').setValues([headers]);
  if (rows.length) {
    var need = rows.length + 1;
    if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 20);
    var cells = rows.map(function (r) { return headers.map(function (h, i) { return toCell_(Array.isArray(r) ? r[i] : r[h]); }); });
    sh.getRange(2, 1, rows.length, headers.length).setNumberFormat('@').setValues(cells);
  }
  invalidate_(name);
}

// ---------------------------------------------------------------- cache (F6)

var CACHE_TTL_S_ = 600;

/** Cache generation: CacheService first, Script Properties as the fallback (keeps the Properties quota for real work). */
function cacheGen_() {
  var r = req_();
  if (r.gen === null) {
    var g = null;
    try { g = CacheService.getScriptCache().get('meta:cache_gen'); } catch (e) { g = null; }
    if (!g) {
      try { g = PropertiesService.getScriptProperties().getProperty('CACHE_GEN'); } catch (e2) { g = null; }
      g = g || '1';
      try { CacheService.getScriptCache().put('meta:cache_gen', g, 21600); } catch (e3) { /* optional */ }
    }
    r.gen = g;
  }
  return r.gen;
}

function cacheKey_(k) { return 'g' + cacheGen_() + ':' + k; }

function cacheGet_(k) {
  try {
    var v = CacheService.getScriptCache().get(cacheKey_(k));
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}

function cacheGetAll_(keys) {
  var out = {};
  try {
    var full = keys.map(cacheKey_);
    var got = CacheService.getScriptCache().getAll(full) || {};
    keys.forEach(function (k, i) { if (got[full[i]]) out[k] = JSON.parse(got[full[i]]); });
  } catch (e) { /* treat as a miss */ }
  return out;
}

/** Stores JSON values under 90 KB each (CacheService limit is 100 KB); bigger ones are skipped. */
function cachePutAll_(map) {
  var put = {};
  Object.keys(map).forEach(function (k) {
    var s = JSON.stringify(map[k]);
    if (utf8Length(s) < 90000) put[cacheKey_(k)] = s;
  });
  try { CacheService.getScriptCache().putAll(put, CACHE_TTL_S_); } catch (e) { /* cache is optional */ }
}

/** Invalidates every cached Items/Courses/Config/Episodes value (new generation). */
function clearCaches_() {
  var p = PropertiesService.getScriptProperties();
  var g = parseInt(p.getProperty('CACHE_GEN') || '1', 10) || 1;
  p.setProperty('CACHE_GEN', String(g + 1));
  try { CacheService.getScriptCache().put('meta:cache_gen', String(g + 1), 21600); } catch (e) { /* optional */ }
  req_().gen = null;
  req_().cfg = null;
  req_().courses = null;
}

// ---------------------------------------------------------------- Config

function config_() {
  var r = req_();
  if (r.cfg) return r.cfg;
  var raw = cacheGet_('config');
  if (!raw) {
    raw = {};
    readTable_('Config').rows.forEach(function (row) {
      var k = String(row.key || '').trim();
      if (k) raw[k] = row.value;
    });
    var put = {}; put.config = raw; cachePutAll_(put);
  }
  var d = {};
  configDefaults_().forEach(function (x) { d[x[0]] = x[1]; });
  var get = function (k) { var v = raw[k]; return v === undefined || String(v).trim() === '' ? d[k] : String(v).trim(); };
  var pm = toNum(get('pass_mark'), 0.8);
  r.cfg = {
    wave: normWave(get('wave')),
    pass_mark: pm > 1 ? pm / 100 : pm,
    retake_hours: toNum(get('retake_hours'), 24),
    max_free_attempts: toInt(get('max_free_attempts'), 2),
    team_view_min_n: Math.max(3, toInt(get('team_view_min_n'), 3)),
    session_hours: toNum(get('session_hours'), 6),
    recall_days: parseDays(get('recall_days')),
    late_days: toInt(get('late_days'), 7),
    pitch_deadline: normDate(get('pitch_deadline')),
    capstone_deadline: normDate(get('capstone_deadline')),
    lock_failures: Math.max(1, toInt(get('lock_failures'), 5)),
    course_open_default: toBool(get('course_open_default')),
    streak_skip_weeks: String(raw.streak_skip_weeks === undefined ? d.streak_skip_weeks : raw.streak_skip_weeks)
      .split(/[,;\s]+/).map(normDate).filter(function (x) { return x; }),
    p1_open: toBool(get('p1_open')),
    p2_open: toBool(get('p2_open')),
    p3_open: toBool(get('p3_open')),
    rating_open: toBool(get('rating_open')),
    results_open: toBool(get('results_open')),
    p1_live: formList_(get('p1_live')),
    p1_backup: formList_(get('p1_backup'))[0] || '',
    p1_minutes: Math.max(1, toInt(get('p1_minutes'), 65)),
    p2_minutes: Math.max(1, toInt(get('p2_minutes'), 35)),
    p3_minutes: Math.max(1, toInt(get('p3_minutes'), 48)),
    grace_minutes: Math.max(0, toInt(get('grace_minutes'), 5)),
    p2_w_sjt: toNum(get('p2_w_sjt'), 0.5),
    p2_w_mgr: toNum(get('p2_w_mgr'), 0.5),
    equate_threshold_pts: toNum(get('equate_threshold_pts'), 5)
  };
  return r.cfg;
}

function formList_(v) {
  var out = [];
  String(v || '').split(/[,;\s]+/).forEach(function (f) {
    f = f.trim().toUpperCase();
    if (BL_FORMS.indexOf(f) >= 0 && out.indexOf(f) < 0) out.push(f);
  });
  return out;
}

// ---------------------------------------------------------------- Courses, Items, Episodes, Cases

/** Courses in calendar order (Courses.order, F15). Cached 10 min. */
function courses_() {
  var r = req_();
  if (r.courses) return r.courses;
  var list = cacheGet_('courses');
  if (!list) {
    var defaultOpen = config_().course_open_default;
    list = readTable_('Courses').rows.filter(function (c) { return normCode(c.code); }).map(function (c) {
      return {
        code: normCode(c.code),
        order: toInt(c.order, 0),
        cycle: toInt(c.cycle, 0),
        name_en: c.name_en || '', name_vi: c.name_vi || '',
        self_en: c.self_en || '', self_vi: c.self_vi || '',
        n_objectives: courseObjectiveCount(c),
        blink_url: c.blink_url || '',
        online_from: normDate(c.online_from),
        checkpoint_close: normDate(c.checkpoint_close),
        forum_date: normDate(c.forum_date),
        field_until: normDate(c.field_until),
        open_flag: String(c.open || '').trim() === '' ? defaultOpen : toBool(c.open)
      };
    });
    list.sort(function (a, b) { return (a.order || 999) - (b.order || 999); });
    cachePutAll_({ courses: list });
  }
  r.courses = list;
  return list;
}

function courseByCode_(code) {
  var c = normCode(code);
  var list = courses_();
  for (var i = 0; i < list.length; i++) if (list[i].code === c) return list[i];
  return null;
}

function courseOrder_() { return courses_().map(function (c) { return c.code; }); }

/** open = the Courses flag is TRUE and today ≥ online_from. */
function courseIsOpen_(c, nowMs) {
  if (!c || !c.open_flag) return false;
  var from = dayStart7(c.online_from);
  return isNaN(from) || nowMs >= from;
}

function lateUntil_(c) {
  return c && c.forum_date ? addDays(c.forum_date, config_().late_days) : '';
}

function normItem_(r, idx) {
  return {
    _idx: idx,
    item_id: String(r.item_id || '').trim(),
    assessment: String(r.assessment || '').trim().toLowerCase(),
    course: normCode(r.course),
    form: String(r.form || '').trim().toUpperCase(),
    objective: normObjective(r.objective),
    case_id: String(r.case_id || '').trim(),
    stem_en: r.stem_en || '', stem_vi: r.stem_vi || '',
    a_en: r.a_en || '', a_vi: r.a_vi || '', b_en: r.b_en || '', b_vi: r.b_vi || '',
    c_en: r.c_en || '', c_vi: r.c_vi || '', d_en: r.d_en || '', d_vi: r.d_vi || '',
    answer: String(r.answer || '').trim().toLowerCase(),
    why_en: r.why_en || '', why_vi: r.why_vi || '',
    active: String(r.active || '').trim() === '' ? true : toBool(r.active)
  };
}

function itemGroupKey_(assessment, course, form) { return 'items:' + assessment + ':' + course + ':' + form; }

/** Every item group (assessment/course/form) from the Items tab; also refills the cache. */
function loadItemGroups_() {
  var groups = {};
  readTable_('Items').rows.forEach(function (r, i) {
    var it = normItem_(r, i);
    if (!it.item_id) return;
    var k = itemGroupKey_(it.assessment, it.course, it.form);
    (groups[k] = groups[k] || []).push(it);
  });
  courses_().forEach(function (c) {
    [['predict', 'PR'], ['checkpoint', 'A'], ['checkpoint', 'B']].forEach(function (p) {
      var k = itemGroupKey_(p[0], c.code, p[1]);
      if (!groups[k]) groups[k] = [];
    });
  });
  cachePutAll_(groups);
  return groups;
}

/** Items for several groups (including inactive ones, for grading). */
function itemGroups_(keys) {
  var got = cacheGetAll_(keys);
  var missing = keys.some(function (k) { return !got[k]; });
  if (missing) {
    var all = loadItemGroups_();
    keys.forEach(function (k) { got[k] = all[k] || []; });
  }
  return got;
}

function itemsFor_(assessment, course, form) {
  var k = itemGroupKey_(assessment, normCode(course), form);
  return itemGroups_([k])[k];
}

function episodes_() {
  var list = cacheGet_('episodes');
  if (!list) {
    list = readTable_('Episodes').rows.map(function (e) {
      return {
        course: normCode(e.course), ep: toInt(e.ep, -1),
        minutes: toNum(e.minutes, null),
        blink_url: e.blink_url || '', embed_url: e.embed_url || ''
      };
    }).filter(function (e) { return e.course && e.ep >= 0; });
    list.sort(function (a, b) { return a.ep - b.ep; });
    cachePutAll_({ episodes: list });
  }
  return list;
}

function cases_() {
  var list = cacheGet_('cases');
  if (!list) {
    list = readTable_('Cases').rows.map(function (c) {
      return {
        case_id: String(c.case_id || '').trim(), title_en: c.title_en || '', title_vi: c.title_vi || '',
        context_en: c.context_en || '', context_vi: c.context_vi || ''
      };
    }).filter(function (c) { return c.case_id; });
    cachePutAll_({ cases: list });
  }
  return list;
}

// ---------------------------------------------------------------- Baseline v2 items, exhibits, text (specs/22 §2)

/** Cache group of baseline items: Part 1 per form, Part 2 per section, Part 3 core and each module (each well under 90 KB). */
function blGroupKey_(assessment, form, module) { return 'bl:' + assessment + ':' + (form || '') + ':' + (module || ''); }

function blAllGroupKeys_() {
  var keys = BL_FORMS.map(function (f) { return blGroupKey_('baseline_p1', f, ''); });
  keys.push(blGroupKey_('baseline_p2', '', 'SJT'), blGroupKey_('baseline_p2', '', 'RATE'), blGroupKey_('baseline_p3', '', ''));
  BL_MODULES.forEach(function (m) { keys.push(blGroupKey_('baseline_p3', '', m)); });
  return keys;
}

function blItemGroupKeyOf_(it) {
  if (it.assessment === 'baseline_p1') return blGroupKey_('baseline_p1', it.form, '');
  if (it.assessment === 'baseline_p3') return blGroupKey_('baseline_p3', '', it.section === 'MOD' ? it.module : '');
  return blGroupKey_('baseline_p2', '', it.section === 'RATE' ? 'RATE' : 'SJT');
}

function loadBlGroups_() {
  var groups = {};
  blAllGroupKeys_().forEach(function (k) { groups[k] = []; });
  readTableOpt_('BaselineItems').rows.forEach(function (r, i) {
    var it = normBaselineItem(r, i);
    if (!it.item_id || !blPart(it.assessment)) return;
    var k = blItemGroupKeyOf_(it);
    if (groups[k]) groups[k].push(it);
  });
  cachePutAll_(groups);
  return groups;
}

/** Baseline items of the given groups (inactive ones included, for grading). */
function blGroups_(keys) {
  var got = cacheGetAll_(keys);
  if (keys.some(function (k) { return !got[k]; })) {
    var all = loadBlGroups_();
    keys.forEach(function (k) { got[k] = all[k] || []; });
  }
  return got;
}

function blGroup_(assessment, form, module) {
  if (assessment === 'baseline_p2' && !module) {
    var g = blGroups_([blGroupKey_('baseline_p2', '', 'SJT'), blGroupKey_('baseline_p2', '', 'RATE')]);
    return g[blGroupKey_('baseline_p2', '', 'SJT')].concat(g[blGroupKey_('baseline_p2', '', 'RATE')]);
  }
  var k = blGroupKey_(assessment, form, module);
  return blGroups_([k])[k];
}

/** Every item an attempt can refer to (Part 1: its form; Part 3: core + its module). */
function blItemsForAttempt_(att) {
  if (att.assessment === 'baseline_p1') return blGroup_('baseline_p1', att.form, '');
  if (att.assessment === 'baseline_p2') return blGroup_('baseline_p2', '', '');
  var g = blGroups_([blGroupKey_('baseline_p3', '', ''), blGroupKey_('baseline_p3', '', att.module)]);
  return g[blGroupKey_('baseline_p3', '', '')].concat(att.module ? g[blGroupKey_('baseline_p3', '', att.module)] : []);
}

/** Exhibits {exhibit_id: {part, form, title_en, title_vi, md_en, md_vi}}. Cached 10 min. */
function blExhibits_() {
  var map = cacheGet_('bl_exhibits');
  if (!map) {
    map = {};
    readTableOpt_('Exhibits').rows.forEach(function (e) {
      var id = String(e.exhibit_id || '').trim();
      if (id) map[id] = { part: String(e.part || '').trim(), form: String(e.form || '').trim().toUpperCase(), title_en: e.title_en || '', title_vi: e.title_vi || '', md_en: e.md_en || '', md_vi: e.md_vi || '' };
    });
    cachePutAll_({ bl_exhibits: map });
  }
  return map;
}

/** BaselineText {key: {en, vi}}. Cached 10 min. */
function blText_() {
  var map = cacheGet_('bl_text');
  if (!map) {
    map = {};
    readTableOpt_('BaselineText').rows.forEach(function (t) {
      var k = String(t.key || '').trim();
      if (k) map[k] = { en: t.en || '', vi: t.vi || '' };
    });
    cachePutAll_({ bl_text: map });
  }
  return map;
}

function blTextOf_(key) { var t = blText_()[key]; return t ? { en: t.en, vi: t.vi || t.en } : { en: '', vi: '' }; }

// ---------------------------------------------------------------- Roster

function rosterRows_() { return readTable_('Roster').rows; }

function findRosterRow_(code) {
  var c = normCode(code);
  if (!c) return null;
  var rows = rosterRows_();
  for (var i = 0; i < rows.length; i++) if (normCode(rows[i].employee_code) === c) return rows[i];
  return null;
}

function userView_(row) {
  var isManager = toBool(row.is_manager);
  return {
    code: normCode(row.employee_code),
    display_name: row.display_name || '',
    first_name: firstName(row.display_name, row.preferred_name),
    role_area: String(row.role_area || '').trim().toLowerCase(),
    is_manager: isManager || parseRoles(row.roles).indexOf('manager') >= 0,
    manager_code: normCode(row.manager_code),
    roles_raw: row.roles || '',
    roles: publicRoles(row.roles, isManager),
    is_test: isTestRoles(row.roles),
    active: toBool(row.active),
    lang: String(row.lang || '').trim().toLowerCase() === 'vi' ? 'vi' : 'en',
    must_change_pin: toBool(row.must_change_pin),
    consent_at: row.consent_at || '',
    certificate: normCertificate_(row.certificate),
    session_ver: toInt(row.session_ver, 0),
    p3_module: String(row.p3_module || '').trim().toUpperCase()
  };
}

function normCertificate_(v) {
  var s = String(v || '').trim().toLowerCase();
  return ['practitioner', 'expert', 'coach'].indexOf(s) >= 0 ? s : '';
}

// ---------------------------------------------------------------- Log

/**
 * doPost marks which actions are logged (setLogAction_); the handler adds the employee
 * code and a short message. Only "loggable" requests get a row: a valid session, a
 * successful login, a real person's lock, or an admin action. Anonymous failures (bad JSON,
 * forged token, unknown code, wrong PIN) never take the lock or write a row; they are only
 * counted in CacheService (countAnon_). The row is written once, while the lock is held, or
 * by writeLogNow_(). Never PINs, answers or tokens.
 */
function setLogAction_(action) { var r = req_(); r.logAction = action; r.logged = false; r.logCode = ''; r.logMsg = ''; }

/** Marks this request as one that may write a Log row. */
function setLoggable_() { req_().loggable = true; }

/** Counts unauthenticated failures per hour in CacheService (no Sheet work, no lock). */
function countAnon_() {
  try {
    var c = CacheService.getScriptCache();
    var k = 'stat:anon:' + iso7(nowMs_()).slice(0, 13);
    var n = parseInt(c.get(k) || '0', 10) || 0;
    c.put(k, String(n + 1), 21600);
  } catch (e) { /* counting is best effort */ }
}

function setLogInfo_(code, message) {
  var r = req_();
  if (code !== undefined && code !== null) r.logCode = code;
  if (message !== undefined && message !== null) r.logMsg = message;
}

function scrubLog_(s) {
  return String(s || '').replace(/v1\.[A-Za-z0-9_.-]+/g, '[token]')
    .replace(/(^|[^A-Za-z0-9_])\d{4,}(?![A-Za-z0-9_])/g, '$1#')
    .replace(/"[^"]*"/g, '"…"').replace(/[{}\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function writeLogRow_(outcome) {
  var r = req_();
  if (!r.logAction || r.logged || !r.loggable || LOCK_DEPTH_ < 1) return;
  r.logged = true;
  appendRows_('Log', [{
    ts: iso7(Date.now()), action: r.logAction, employee_code: r.logCode || '',
    ok: !!outcome.ok, message: scrubLog_(outcome.ok ? r.logMsg : (outcome.code + (r.logMsg ? ' ' + r.logMsg : '')))
  }]);
}

/** For requests that never took the lock: a short separate lock just for the Log row. */
function writeLogNow_(outcome) {
  var r = req_();
  if (!r.logAction || r.logged || !r.loggable) return;
  try {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) { r.logged = true; return; }
    LOCK_DEPTH_ = 1;
    try { writeLogRow_(outcome); } finally { LOCK_DEPTH_ = 0; lock.releaseLock(); }
  } catch (e) { r.logged = true; }
}
