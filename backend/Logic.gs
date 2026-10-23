/**
 * Logic.gs · pure functions for The 1% Planner Hub backend.
 *
 * Rules: no SpreadsheetApp, CacheService, Utilities or any other Google service in
 * this file. Anything that needs crypto or a clock receives it as an argument, so the
 * same file runs in Apps Script (V8) and in Node (`require('./Logic.gs')` via the tests).
 * Times: Vietnam is a fixed +07:00 (no daylight saving), so every date helper does plain
 * arithmetic on UTC milliseconds and never depends on the machine's time zone.
 */

var TZ_OFFSET_MS = 7 * 3600 * 1000;
var DAY_MS = 86400000;
var WEEK_MS = 7 * DAY_MS;
var OPTION_LETTERS = ['a', 'b', 'c', 'd'];
var ROLE_GROUPS = ['demand', 'supply', 'materials', 'cs'];
var KNOWN_ROLES = ['learner', 'manager', 'panel', 'admin'];

// ---------------------------------------------------------------- small helpers

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function str(v) { return v === null || v === undefined ? '' : String(v); }

/** Lenient boolean: TRUE, true, 1, yes, y, x, ✓ → true. */
function toBool(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'x' || s === '✓';
}

function toInt(v, dflt) {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v);
  var s = str(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  return dflt === undefined ? 0 : dflt;
}

function toNum(v, dflt) {
  if (typeof v === 'number' && isFinite(v)) return v;
  var s = str(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return dflt === undefined ? null : dflt;
}

function round1(x) { return Math.round(x * 10) / 10; }

function normCode(s) { return str(s).trim().toUpperCase(); }

/** Employee codes: 3–20 letters, digits, '-' or '_' (specs/19 "Still open"). */
function isValidCode(s) { return /^[A-Z0-9_-]{3,20}$/.test(normCode(s)); }

/** F12: preferred_name, else the LAST word of display_name (Vietnamese names). */
function firstName(displayName, preferredName) {
  var p = str(preferredName).trim();
  if (p) return p;
  var words = str(displayName).trim().split(/\s+/).filter(function (w) { return w; });
  return words.length ? words[words.length - 1] : '';
}

function parseRoles(s) {
  return str(s).toLowerCase().split(/[;,\s]+/).filter(function (r) { return r; });
}

/**
 * Roles shown to the page: only the four known roles; is_manager implies "manager" (and
 * "learner"); a row with no known role is a learner.
 */
function publicRoles(rolesStr, isManager) {
  var all = parseRoles(rolesStr);
  var out = KNOWN_ROLES.filter(function (r) { return all.indexOf(r) >= 0; });
  if (isManager && out.indexOf('manager') < 0) out.push('manager');
  if (isManager && out.indexOf('learner') < 0) out.push('learner');
  if (!out.length) out.push('learner');
  return KNOWN_ROLES.filter(function (r) { return out.indexOf(r) >= 0; });
}

function isTestRoles(rolesStr) { return /test/i.test(str(rolesStr)); }

/** Words in a text (for the SOI ≤ 60-word rule). */
function wordCount(s) {
  var t = str(s).trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(function (w) { return w; }).length;
}

/** Returns null when the PIN is acceptable, otherwise a short reason. */
function pinProblem(newPin, oldPin) {
  var p = str(newPin);
  if (!/^\d{6}$/.test(p)) return 'The PIN must be exactly 6 digits.';
  if (/^(\d)\1{5}$/.test(p)) return 'The PIN cannot be one digit repeated.';
  if (p === '123456' || p === '654321') return 'The PIN is too easy to guess.';
  if (oldPin !== undefined && oldPin !== null && p === str(oldPin)) return 'The new PIN must differ from the old PIN.';
  return null;
}

/** A 6-digit PIN from random hex (e.g. a UUID); returns null if the result is weak. */
function pinFromHex(hex) {
  var h = str(hex).replace(/[^0-9a-f]/gi, '').slice(0, 12);
  if (h.length < 8) return null;
  var n = parseInt(h, 16) % 1000000;
  var pin = ('000000' + n).slice(-6);
  return pinProblem(pin) ? null : pin;
}

function escapeHtml(s) {
  return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Free text written to the Sheet must never start a formula (=, +, -, @). */
function guardCell(s) {
  var t = str(s);
  return /^[=+\-@]/.test(t) ? ' ' + t : t;
}

function utf8Length(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

// ---------------------------------------------------------------- dates (+07:00)

/** ISO string with +07:00, e.g. 2026-11-16T09:30:00+07:00. */
function iso7(ms) {
  var d = new Date(ms + TZ_OFFSET_MS);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    'T' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds()) + '+07:00';
}

/** Date YYYY-MM-DD in Vietnam time. */
function date7(ms) { return iso7(ms).slice(0, 10); }

function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(str(s)); }

function dayStart7(dateStr) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(dateStr).trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ_OFFSET_MS;
}

/** Last millisecond of the day (window end 23:59:59 +07:00 inclusive). */
function dayEnd7(dateStr) {
  var s = dayStart7(dateStr);
  return isNaN(s) ? NaN : s + DAY_MS - 1;
}

function dayEndIso7(dateStr) { return isDateStr(dateStr) ? str(dateStr) + 'T23:59:59+07:00' : ''; }

function dayStartIso7(dateStr) { return isDateStr(dateStr) ? str(dateStr) + 'T00:00:00+07:00' : ''; }

function addDays(dateStr, n) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(dateStr).trim());
  if (!m) return '';
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/**
 * Milliseconds from an ISO string (with offset, or without = +07:00), a YYYY-MM-DD date
 * (start of day +07:00), a Date or a number. NaN when empty or unreadable.
 */
function parseTime(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (isDate(v)) return v.getTime();
  var s = String(v).trim();
  if (!s) return NaN;
  if (isDateStr(s)) return dayStart7(s);
  var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return NaN;
  var off = m[6] || '+07:00';
  if (/^[+-]\d{4}$/.test(off)) off = off.slice(0, 3) + ':' + off.slice(3);
  var t = Date.parse(m[1] + 'T' + m[2] + ':' + m[3] + ':' + (m[4] || '00') + (m[5] || '') + off);
  return isNaN(t) ? NaN : t;
}

/** "before" | "open" | "after" for a window of whole days in +07:00. */
function windowState(nowMs, fromDate, toDate) {
  var a = dayStart7(fromDate), b = dayEnd7(toDate);
  if (!isNaN(a) && nowMs < a) return 'before';
  if (!isNaN(b) && nowMs > b) return 'after';
  if (isNaN(a) && isNaN(b)) return 'after';
  return 'open';
}

/** Monday-based week number since the epoch, in +07:00. */
function weekIndex7(ms) { return Math.floor((ms + TZ_OFFSET_MS + 3 * DAY_MS) / WEEK_MS); }

/** ISO week key "YYYY-Www" in +07:00. */
function isoWeekKey(ms) {
  var d = new Date(ms + TZ_OFFSET_MS);
  var dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0
  var thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dayNum + 3);
  var year = new Date(thursday).getUTCFullYear();
  var jan4 = Date.UTC(year, 0, 4);
  var jan4Day = (new Date(jan4).getUTCDay() + 6) % 7;
  var week1Thursday = jan4 - jan4Day * DAY_MS + 3 * DAY_MS;
  var week = 1 + Math.round((thursday - week1Thursday) / WEEK_MS);
  return year + '-W' + pad2(week);
}

/** Normalise a Sheet cell to the string the backend works with (F5). */
function cellToString(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  if (isDate(v)) {
    var ms = v.getTime();
    if (isNaN(ms)) return '';
    return ((ms + TZ_OFFSET_MS) % DAY_MS === 0) ? date7(ms) : iso7(ms);
  }
  return String(v);
}

/** Date-ish cell → YYYY-MM-DD ('' if unreadable). */
function normDate(v) {
  if (isDate(v)) return date7(v.getTime());
  var s = str(v).trim();
  if (!s) return '';
  if (isDateStr(s)) return s;
  var t = parseTime(s);
  return isNaN(t) ? '' : date7(t);
}

/** Wave ids look like 2026-11; a coerced Sheet date 2026-11-01 maps back. */
function normWave(v) {
  if (isDate(v)) return date7(v.getTime()).slice(0, 7);
  var s = str(v).trim();
  var m = /^(\d{4})-(\d{2})(?:-01)?(?:T.*)?$/.exec(s);
  return m ? m[1] + '-' + m[2] : s;
}

function normObjective(v) {
  var s = str(v).trim();
  var m = /^[A-Za-z]*\s*(\d+)(?:\.0+)?$/.exec(s);
  return m ? String(parseInt(m[1], 10)) : s;
}

function objectiveOut(o) { return /^\d+$/.test(str(o)) ? parseInt(o, 10) : str(o); }

// ---------------------------------------------------------------- crypto helpers

function bytesToHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

/** F2: SHA-256(PIN_PEPPER + ":" + salt + ":" + pin) as lowercase hex. digestFn(string) → bytes. */
function hashPin(pepper, salt, pin, digestFn) {
  return bytesToHex(digestFn(str(pepper) + ':' + str(salt) + ':' + str(pin)));
}

function constantTimeEqual(a, b) {
  a = str(a); b = str(b);
  if (a.length !== b.length || !a.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

var B64URL_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Bytes_(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function utf8Decode_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length;) {
    var b = bytes[i++], c;
    if (b < 0x80) c = b;
    else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63);
    else if (b < 0xf0) c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else c = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    if (c > 0xffff) { c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); }
    else s += String.fromCharCode(c);
  }
  return s;
}

/** base64url without padding. */
function b64urlEncode(s) {
  var b = utf8Bytes_(str(s)), out = '';
  for (var i = 0; i < b.length; i += 3) {
    var n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += B64URL_[(n >> 18) & 63] + B64URL_[(n >> 12) & 63];
    if (i + 1 < b.length) out += B64URL_[(n >> 6) & 63];
    if (i + 2 < b.length) out += B64URL_[n & 63];
  }
  return out;
}

function b64urlDecode(s) {
  s = str(s).replace(/=+$/, '');
  if (/[^A-Za-z0-9_-]/.test(s)) return null;
  var bytes = [], bits = 0, acc = 0;
  for (var i = 0; i < s.length; i++) {
    acc = (acc << 6) | B64URL_.indexOf(s.charAt(i));
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
  }
  return utf8Decode_(bytes);
}

/** F1: "v1.<payload>.<sig>" where sig = hmacFn("v1.<payload>") (a base64url string). */
function signToken(payload, hmacFn) {
  var p = b64urlEncode(JSON.stringify(payload));
  return 'v1.' + p + '.' + hmacFn('v1.' + p);
}

/** → {ok:true, payload} | {ok:false, reason: malformed|bad_signature|expired}. */
function verifyToken(token, nowMs, hmacFn) {
  if (typeof token !== 'string' || token.length > 600) return { ok: false, reason: 'malformed' };
  var parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) return { ok: false, reason: 'malformed' };
  if (!constantTimeEqual(hmacFn('v1.' + parts[1]), parts[2])) return { ok: false, reason: 'bad_signature' };
  var payload;
  try { payload = JSON.parse(b64urlDecode(parts[1])); } catch (e) { return { ok: false, reason: 'malformed' }; }
  if (!payload || typeof payload.c !== 'string' || typeof payload.e !== 'number') return { ok: false, reason: 'malformed' };
  if (nowMs > payload.e) return { ok: false, reason: 'expired' };
  return { ok: true, payload: payload };
}

// ---------------------------------------------------------------- lockout (F2)

/** Lock n of the day lasts 15 · 2^(n-1) minutes, at most 24 h. */
function lockMinutes(n) { return Math.min(15 * Math.pow(2, Math.max(1, n) - 1), 1440); }

/**
 * Next lock after the 5th failure. A lock that started on the same +07:00 day as the
 * previous one doubles; a new day starts again at 15 minutes.
 */
function nextLockState(prevCount, prevLockedUntilMs, nowMs) {
  var n = 1;
  prevCount = toInt(prevCount, 0);
  if (prevCount > 0 && isFinite(prevLockedUntilMs) && !isNaN(prevLockedUntilMs)) {
    var prevStart = prevLockedUntilMs - lockMinutes(prevCount) * 60000;
    if (date7(prevStart) === date7(nowMs)) n = prevCount + 1;
  }
  return { lock_count: n, locked_until: nowMs + lockMinutes(n) * 60000 };
}

// ---------------------------------------------------------------- seeded shuffle

/** FNV-1a 32-bit. */
function hashString(s) {
  s = str(s);
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates on a copy; the same seed always gives the same order. */
function shuffle(array, seed) {
  var a = array.slice();
  var rnd = mulberry32(hashString(str(seed)));
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// ---------------------------------------------------------------- items and grading

function optionOf(item, letter) {
  var l = str(letter).toLowerCase();
  if (OPTION_LETTERS.indexOf(l) < 0 || !item) return null;
  return { id: l, en: str(item[l + '_en']), vi: str(item[l + '_vi']) };
}

/**
 * The only shape an item leaves the server in before submission. Built from a
 * whitelist, so answer / why_* / any other column can never leak. Option ids keep the
 * original letters; their order comes from the seed (F9: same seed → same order).
 */
function serveItem(row, seed) {
  var opts = [];
  for (var i = 0; i < OPTION_LETTERS.length; i++) {
    var l = OPTION_LETTERS[i];
    if (str(row[l + '_en']).trim() !== '' || str(row[l + '_vi']).trim() !== '') {
      opts.push({ id: l, en: str(row[l + '_en']), vi: str(row[l + '_vi']) });
    }
  }
  if (seed !== undefined && seed !== null && seed !== '') opts = shuffle(opts, seed);
  return {
    item_id: str(row.item_id),
    course: str(row.course),
    objective: objectiveOut(normObjective(row.objective)),
    case_id: str(row.case_id),
    stem_en: str(row.stem_en),
    stem_vi: str(row.stem_vi),
    options: opts
  };
}

/** Keep only answers for served items with a valid letter. */
function cleanAnswers(answers, servedIds) {
  var out = {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return out;
  for (var i = 0; i < servedIds.length; i++) {
    var id = servedIds[i];
    if (Object.prototype.hasOwnProperty.call(answers, id)) {
      var l = str(answers[id]).trim().toLowerCase();
      if (OPTION_LETTERS.indexOf(l) >= 0) out[id] = l;
    }
  }
  return out;
}

/** Self-ratings {course: 0..4} for known course codes only. */
function cleanSelfRatings(ratings, courseCodes) {
  var out = {};
  if (!ratings || typeof ratings !== 'object' || Array.isArray(ratings)) return out;
  for (var i = 0; i < courseCodes.length; i++) {
    var c = courseCodes[i];
    if (Object.prototype.hasOwnProperty.call(ratings, c)) {
      var v = ratings[c];
      var n = typeof v === 'number' ? v : (/^\d$/.test(str(v).trim()) ? parseInt(v, 10) : NaN);
      if (n === Math.floor(n) && n >= 0 && n <= 4) out[c] = n;
    }
  }
  return out;
}

function byObjective(results, objectiveMap) {
  var out = {};
  for (var i = 0; i < results.length; i++) {
    var o = normObjective(objectiveMap[results[i].item_id]);
    if (!o) continue;
    if (!out[o]) out[o] = { n: 0, correct: 0 };
    out[o].n += 1;
    if (results[i].is_correct) out[o].correct += 1;
  }
  return out;
}

/**
 * Grades every served item (unanswered = wrong).
 * keyMap {item_id: 'a'..'d'}, objectiveMap {item_id: objective}.
 */
function grade(servedIds, answers, keyMap, objectiveMap) {
  var results = [], nCorrect = 0;
  answers = answers || {};
  for (var i = 0; i < servedIds.length; i++) {
    var id = servedIds[i];
    var your = OPTION_LETTERS.indexOf(str(answers[id]).toLowerCase()) >= 0 ? str(answers[id]).toLowerCase() : null;
    var key = str(keyMap[id]).trim().toLowerCase();
    var ok = your !== null && key !== '' && your === key;
    if (ok) nCorrect++;
    results.push({ item_id: id, your: your, correct: key || null, is_correct: ok });
  }
  var n = servedIds.length;
  return {
    n_items: n,
    n_correct: nCorrect,
    score_pct: n ? Math.round(100 * nCorrect / n) : 0,
    by_objective: byObjective(results, objectiveMap || {}),
    results: results
  };
}

/** Pass mark may be 0.8 or 80; compare in integers to avoid float error. */
function isPass(nCorrect, nItems, passMark) {
  var pm = toNum(passMark, 0.8);
  if (pm > 1) pm = pm / 100;
  return nItems > 0 && nCorrect * 1000 >= Math.round(pm * 1000) * nItems;
}

/** Baseline: % per course over Part B + case items (courseMap from Items.course). */
function byCourse(servedIds, answers, keyMap, courseMap) {
  var acc = {}, order = [];
  var g = grade(servedIds, answers, keyMap, {});
  for (var i = 0; i < g.results.length; i++) {
    var c = str(courseMap[g.results[i].item_id]);
    if (!c) continue;
    if (!acc[c]) { acc[c] = { n: 0, k: 0 }; order.push(c); }
    acc[c].n++;
    if (g.results[i].is_correct) acc[c].k++;
  }
  var out = {};
  for (var j = 0; j < order.length; j++) out[order[j]] = Math.round(100 * acc[order[j]].k / acc[order[j]].n);
  return out;
}

/** Objectives with at least one miss, ascending. */
function weakObjectives(byObj) {
  var out = [];
  for (var k in byObj) {
    if (Object.prototype.hasOwnProperty.call(byObj, k) && byObj[k].correct < byObj[k].n) out.push(k);
  }
  out.sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || (a < b ? -1 : a > b ? 1 : 0); });
  return out.map(objectiveOut);
}

/** Two largest gaps: lowest course score; tie → lower self-rating, then calendar order. */
function gaps(byCourseMap, selfMap, courseOrder) {
  selfMap = selfMap || {};
  courseOrder = courseOrder || [];
  var codes = Object.keys(byCourseMap || {});
  var pos = function (c) { var i = courseOrder.indexOf(c); return i < 0 ? 999 : i; };
  var self = function (c) { return typeof selfMap[c] === 'number' ? selfMap[c] : 99; };
  codes.sort(function (a, b) {
    return (byCourseMap[a] - byCourseMap[b]) || (self(a) - self(b)) || (pos(a) - pos(b));
  });
  return codes.slice(0, 2);
}

/** Spec 14 calibration flag (admin view only). */
function calibrationFlag(selfLevel, pct) {
  if (typeof selfLevel !== 'number' || typeof pct !== 'number') return '';
  if (selfLevel >= 3 && pct < 50) return 'rates high, scores low';
  if (selfLevel <= 1 && pct >= 80) return 'rates low, scores high';
  return '';
}

// ---------------------------------------------------------------- checkpoint gate

/**
 * F10: the first attempt goes to the form with fewer first attempts so far in that course;
 * a tie is broken by a hash of code + course. Later attempts alternate.
 * firstCounts {A: n, B: m}; previousForms = this person's earlier forms in this course, in order.
 */
function pickForm(firstCounts, previousForms, code, course) {
  previousForms = previousForms || [];
  if (previousForms.length) return previousForms[previousForms.length - 1] === 'A' ? 'B' : 'A';
  var a = toInt((firstCounts || {}).A, 0), b = toInt((firstCounts || {}).B, 0);
  if (a < b) return 'A';
  if (b < a) return 'B';
  return hashString(normCode(code) + '|' + str(course)) % 2 === 0 ? 'A' : 'B';
}

/** Spec 12 signature: retake wait, then the attempt ≥ 3 unlock rule. */
function canRetake(lastSubmittedAt, now, retakeHours, attemptNo, maxFree, hasUnlock) {
  var last = parseTime(lastSubmittedAt);
  var nowMs = typeof now === 'number' ? now : parseTime(now);
  if (!isNaN(last)) {
    var next = last + toNum(retakeHours, 24) * 3600000;
    if (nowMs < next) return { ok: false, code: 'retake_too_soon', next_retake_at: iso7(next) };
  }
  if (attemptNo > toInt(maxFree, 2) && !hasUnlock) return { ok: false, code: 'unlock_needed' };
  return { ok: true };
}

/**
 * Full gate for starting a checkpoint attempt (contract order):
 * already_passed → retake_too_soon → unlock_needed (attempt ≥ 3) → gate_closed (after late_until).
 * An attempt needs an unlock when attemptNo > maxFree or it starts after late_until;
 * each Unlocks row grants one such attempt.
 */
function checkpointGate(o) {
  if (o.passed) return { ok: false, code: 'already_passed' };
  var r = canRetake(o.lastSubmittedMs, o.nowMs, o.retakeHours, 0, o.maxFree, true);
  if (!r.ok) return r;
  var late = !isNaN(o.lateUntilMs) && o.lateUntilMs !== null && o.nowMs > o.lateUntilMs;
  var overFree = o.attemptNo > toInt(o.maxFree, 2);
  var needs = overFree || late;
  if (needs && toInt(o.unusedUnlocks, 0) < 1) return { ok: false, code: overFree ? 'unlock_needed' : 'gate_closed' };
  return { ok: true, uses_unlock: needs };
}

/** How many unlocks earlier attempts consumed (attempt_no > maxFree, or started after late_until). */
function unlocksUsed(attempts, maxFree, lateUntilMs) {
  var n = 0;
  for (var i = 0; i < attempts.length; i++) {
    var a = attempts[i];
    var late = !isNaN(lateUntilMs) && lateUntilMs !== null && toNum(a.started_ms, 0) > lateUntilMs;
    if (toInt(a.attempt_no, 0) > toInt(maxFree, 2) || late) n++;
  }
  return n;
}

/** D5: the key and why appear once the course is passed or after late_until. */
function revealKey(passedCourse, nowMs, lateUntilDate) {
  if (passedCourse) return true;
  var end = dayEnd7(lateUntilDate);
  return !isNaN(end) && nowMs > end;
}

// ---------------------------------------------------------------- spaced recall (F11)

function parseDays(s) {
  var out = str(s).split(/[,;\s]+/).map(function (x) { return toInt(x, -1); }).filter(function (n) { return n > 0; });
  return out.length ? out : [2, 7, 30];
}

/** max(forum_date, pass date) + each day. Dates are YYYY-MM-DD. */
function recallDates(forumDate, passDate, days) {
  if (Array.isArray(passDate) && days === undefined) { days = passDate; passDate = ''; }
  var f = normDate(forumDate), p = normDate(passDate);
  var base = f && p ? (p > f ? p : f) : (f || p);
  return (days || [2, 7, 30]).map(function (d) { return addDays(base, d); });
}

/**
 * Form for recall: the form not taken; if both taken, the one with fewer correct
 * answers (best attempt on each form); a tie goes to the form seen longer ago.
 * stats {A: {taken, best_correct, last_ms}, B: {...}}
 */
function recallForm(stats) {
  var A = (stats && stats.A) || {}, B = (stats && stats.B) || {};
  if (A.taken && !B.taken) return 'B';
  if (B.taken && !A.taken) return 'A';
  if (!A.taken && !B.taken) return 'A';
  if (toInt(A.best_correct, 0) !== toInt(B.best_correct, 0)) return toInt(A.best_correct, 0) < toInt(B.best_correct, 0) ? 'A' : 'B';
  return toNum(A.last_ms, 0) <= toNum(B.last_ms, 0) ? 'A' : 'B';
}

/** Three different items per recall day: one seeded order of the form, sliced by day. */
function recallItems(formItemIds, seed, dayIndex, perDay) {
  perDay = perDay || 3;
  var ids = shuffle(formItemIds.slice().sort(), seed);
  if (!ids.length) return [];
  var out = [];
  for (var i = 0; i < Math.min(perDay, ids.length); i++) out.push(ids[(dayIndex * perDay + i) % ids.length]);
  return out;
}

// ---------------------------------------------------------------- summaries

function excludedFromSummary(row) {
  if (toBool(row.is_manager)) return true;
  var roles = Array.isArray(row.roles) ? row.roles.join(';') : str(row.roles);
  if (isTestRoles(roles)) return true;
  if (parseRoles(roles).indexOf('manager') >= 0) return true;
  if (row.active === false) return true;
  return false;
}

/**
 * rows: [{group, is_manager, roles, values: {metric: number|null}}]
 * → [{group, n, avg: {metric: mean|null}}] for "all" then the role groups.
 * Managers, test users and inactive rows are never counted. Groups with n < minN are
 * dropped. Complementary rule: the people left out of the shown role groups must
 * themselves number 0 or ≥ minN, so "all" minus the shown groups never reveals a
 * smaller group (the next smallest role group is hidden until that holds).
 */
function summarise(rows, minN) {
  minN = toInt(minN, 3);
  var kept = rows.filter(function (r) { return !excludedFromSummary(r); });
  var build = function (name, members) {
    var sums = {}, counts = {};
    members.forEach(function (m) {
      var v = m.values || {};
      Object.keys(v).forEach(function (k) {
        if (!(k in sums)) { sums[k] = 0; counts[k] = 0; }
        if (typeof v[k] === 'number' && isFinite(v[k])) { sums[k] += v[k]; counts[k]++; }
      });
    });
    var avg = {};
    Object.keys(sums).forEach(function (k) { avg[k] = counts[k] ? sums[k] / counts[k] : null; });
    return { group: name, n: members.length, avg: avg };
  };
  var all = build('all', kept);
  if (all.n < minN) return [];
  var groups = ROLE_GROUPS.map(function (g) {
    return build(g, kept.filter(function (r) { return str(r.group).toLowerCase() === g; }));
  });
  var visible = groups.filter(function (g) { return g.n >= minN; });
  for (;;) {
    var shown = visible.reduce(function (s, g) { return s + g.n; }, 0);
    var hidden = all.n - shown;
    if (hidden === 0 || hidden >= minN || !visible.length) break;
    var smallest = visible.slice().sort(function (a, b) { return a.n - b.n; })[0];
    visible = visible.filter(function (g) { return g !== smallest; });
  }
  return [all].concat(groups.filter(function (g) { return visible.indexOf(g) >= 0; }));
}

// ---------------------------------------------------------------- panel weighting (F20)

/**
 * One judge's weighted score: Pitch Day (c1+c2+c3+c4+2·c5)/6, capstone (c1+c2+2·c3+2·c4+c5)/7.
 * Unrounded. Admin view only; never shown on the Hub.
 */
function panelWeighted(stage, s) {
  var c = [s.c1, s.c2, s.c3, s.c4, s.c5].map(function (x) { return toNum(x, NaN); });
  if (c.some(function (x) { return isNaN(x); })) return null;
  return stage === 'capstone' ? (c[0] + c[1] + 2 * c[2] + 2 * c[3] + c[4]) / 7 : (c[0] + c[1] + c[2] + c[3] + 2 * c[4]) / 6;
}

// ---------------------------------------------------------------- streak (D9)

/** Weekly activity streak in +07:00 ISO weeks; multiplier = 1.01^active weeks, 2 dp. */
function streak(activityMs, nowMs) {
  var weeks = {};
  (activityMs || []).forEach(function (ms) {
    if (typeof ms === 'number' && isFinite(ms) && ms <= nowMs) weeks[weekIndex7(ms)] = true;
  });
  var total = Object.keys(weeks).length;
  var thisWeek = weekIndex7(nowMs);
  var activeNow = !!weeks[thisWeek];
  var start = activeNow ? thisWeek : thisWeek - 1;
  var cur = 0;
  while (weeks[start - cur]) cur++;
  return {
    current_weeks: cur,
    active_this_week: activeNow,
    active_weeks_total: total,
    multiplier: Math.round(Math.pow(1.01, total) * 100) / 100
  };
}

// ---------------------------------------------------------------- CSV and bank validation

/** RFC 4180 CSV → array of rows (strings). Handles quotes, CRLF and a UTF-8 BOM. */
function parseCsv(text) {
  var s = str(text).replace(/^﻿/, '');
  var rows = [], row = [], field = '', q = false;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (q) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s.charAt(i + 1) === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (f) { return str(f).trim() !== ''; }); });
}

/** Number of objectives a course row defines (obj1_en … obj6_en). */
function courseObjectiveCount(course) {
  var n = 0;
  for (var i = 1; i <= 6; i++) if (str(course['obj' + i + '_en']).trim()) n = i;
  return n;
}

/**
 * Validates the private bank once imported. items/courses/cases are row objects keyed by
 * header. Structural problems are errors; count mismatches against the blueprint are warnings.
 */
function validateBank(items, courses, cases) {
  var errors = [], warnings = [];
  var codes = {}, nObj = {};
  (courses || []).forEach(function (c) {
    var code = normCode(c.code);
    if (!code) return;
    if (codes[code]) errors.push('Courses: duplicate code ' + code);
    codes[code] = true;
    nObj[code] = courseObjectiveCount(c);
    if (!str(c.self_en).trim()) warnings.push('Courses ' + code + ': self_en is empty');
    if (!nObj[code]) warnings.push('Courses ' + code + ': no objectives (obj1_en…)');
    ['online_from', 'checkpoint_close', 'forum_date', 'field_until'].forEach(function (k) {
      var v = str(c[k]).trim();
      if (!v) warnings.push('Courses ' + code + ': ' + k + ' is empty');
      else if (!isDateStr(normDate(c[k]))) errors.push('Courses ' + code + ': ' + k + ' is not a date (YYYY-MM-DD)');
    });
    if (str(c.order).trim() && toInt(c.order, -1) < 1) errors.push('Courses ' + code + ': order must be a number');
  });
  var orders = {};
  (courses || []).forEach(function (c) {
    var o = toInt(c.order, -1);
    if (o > 0) { if (orders[o]) errors.push('Courses: order ' + o + ' used twice'); orders[o] = true; }
  });
  var caseIds = {};
  (cases || []).forEach(function (c) { if (str(c.case_id).trim()) caseIds[str(c.case_id).trim()] = true; });

  var seen = {}, counts = { baseline_b: {}, baseline_c: 0, predict: {}, checkpoint: {}, objectives: {} };
  (items || []).forEach(function (it, idx) {
    var id = str(it.item_id).trim();
    var where = 'Items row ' + (idx + 2) + (id ? ' (' + id + ')' : '');
    if (!id) { errors.push(where + ': item_id is empty'); return; }
    if (seen[id]) errors.push(where + ': duplicate item_id');
    seen[id] = true;
    var a = str(it.assessment).trim().toLowerCase();
    var form = str(it.form).trim().toUpperCase();
    var course = normCode(it.course);
    if (['baseline', 'predict', 'checkpoint'].indexOf(a) < 0) errors.push(where + ': assessment must be baseline, predict or checkpoint');
    var wantForm = a === 'baseline' ? ['BL'] : a === 'predict' ? ['PR'] : ['A', 'B'];
    if (wantForm.indexOf(form) < 0) errors.push(where + ': form must be ' + wantForm.join(' or ') + ' for ' + a);
    if (!course || !codes[course]) errors.push(where + ': course ' + (course || '(empty)') + ' is not in Courses');
    if (!str(it.stem_en).trim()) errors.push(where + ': stem_en is empty');
    if (!str(it.stem_vi).trim()) warnings.push(where + ': stem_vi is empty');
    OPTION_LETTERS.forEach(function (l) {
      if (!str(it[l + '_en']).trim()) errors.push(where + ': option ' + l + '_en is empty');
      else if (!str(it[l + '_vi']).trim()) warnings.push(where + ': option ' + l + '_vi is empty');
    });
    var key = str(it.answer).trim().toLowerCase();
    if (OPTION_LETTERS.indexOf(key) < 0) errors.push(where + ': answer must be a, b, c or d');
    var obj = normObjective(it.objective);
    if (a !== 'baseline' || obj) {
      var max = nObj[course] || 6;
      if (!/^\d+$/.test(obj) || +obj < 1 || +obj > max) errors.push(where + ': objective must be 1–' + max);
    }
    var cid = str(it.case_id).trim();
    if (cid && !caseIds[cid]) errors.push(where + ': case_id ' + cid + ' is not in Cases');
    if ((a === 'predict' || a === 'checkpoint') && !str(it.why_en).trim()) warnings.push(where + ': why_en is empty');
    if (!toBool(it.active === undefined || str(it.active).trim() === '' ? 'TRUE' : it.active)) return;
    if (a === 'baseline') {
      if (cid) counts.baseline_c++;
      else counts.baseline_b[course] = (counts.baseline_b[course] || 0) + 1;
    } else if (a === 'predict') counts.predict[course] = (counts.predict[course] || 0) + 1;
    else if (a === 'checkpoint') {
      var k = course + ':' + form;
      counts.checkpoint[k] = (counts.checkpoint[k] || 0) + 1;
      counts.objectives[k + ':' + obj] = true;
    }
  });
  Object.keys(codes).forEach(function (c) {
    if ((counts.baseline_b[c] || 0) !== 4) warnings.push(c + ': ' + (counts.baseline_b[c] || 0) + ' baseline Part B items (expected 4)');
    if ((counts.predict[c] || 0) !== 3) warnings.push(c + ': ' + (counts.predict[c] || 0) + ' predict items (expected 3)');
    ['A', 'B'].forEach(function (f) {
      var n = counts.checkpoint[c + ':' + f] || 0;
      if (n !== 10) warnings.push(c + ' form ' + f + ': ' + n + ' checkpoint items (expected 10)');
      for (var o = 1; o <= (nObj[c] || 0); o++) {
        if (n && !counts.objectives[c + ':' + f + ':' + o]) warnings.push(c + ' form ' + f + ': objective ' + o + ' has no item');
      }
    });
  });
  if (counts.baseline_c !== 6) warnings.push('Baseline Part C: ' + counts.baseline_c + ' case items (expected 6)');
  return { errors: errors, warnings: warnings, counts: counts };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TZ_OFFSET_MS: TZ_OFFSET_MS, DAY_MS: DAY_MS, ROLE_GROUPS: ROLE_GROUPS,
    pad2: pad2, isDate: isDate, str: str, toBool: toBool, toInt: toInt, toNum: toNum, round1: round1,
    normCode: normCode, isValidCode: isValidCode, firstName: firstName, parseRoles: parseRoles,
    publicRoles: publicRoles, isTestRoles: isTestRoles, wordCount: wordCount, pinProblem: pinProblem,
    pinFromHex: pinFromHex, escapeHtml: escapeHtml, guardCell: guardCell, utf8Length: utf8Length,
    iso7: iso7, date7: date7, isDateStr: isDateStr, dayStart7: dayStart7, dayEnd7: dayEnd7,
    dayEndIso7: dayEndIso7, dayStartIso7: dayStartIso7, addDays: addDays, parseTime: parseTime,
    windowState: windowState, weekIndex7: weekIndex7, isoWeekKey: isoWeekKey, cellToString: cellToString,
    normDate: normDate, normWave: normWave, normObjective: normObjective, objectiveOut: objectiveOut,
    bytesToHex: bytesToHex, hashPin: hashPin, constantTimeEqual: constantTimeEqual,
    b64urlEncode: b64urlEncode, b64urlDecode: b64urlDecode, signToken: signToken, verifyToken: verifyToken,
    lockMinutes: lockMinutes, nextLockState: nextLockState,
    hashString: hashString, mulberry32: mulberry32, shuffle: shuffle,
    optionOf: optionOf, serveItem: serveItem, cleanAnswers: cleanAnswers, cleanSelfRatings: cleanSelfRatings,
    byObjective: byObjective, grade: grade, isPass: isPass, byCourse: byCourse, weakObjectives: weakObjectives,
    gaps: gaps, calibrationFlag: calibrationFlag,
    pickForm: pickForm, canRetake: canRetake, checkpointGate: checkpointGate, unlocksUsed: unlocksUsed,
    revealKey: revealKey, parseDays: parseDays, recallDates: recallDates, recallForm: recallForm,
    recallItems: recallItems, excludedFromSummary: excludedFromSummary, summarise: summarise, streak: streak, panelWeighted: panelWeighted,
    parseCsv: parseCsv, courseObjectiveCount: courseObjectiveCount, validateBank: validateBank
  };
}
