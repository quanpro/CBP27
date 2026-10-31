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

// ---------------------------------------------------------------- lockout (F2, hardened)

var LOCK_WINDOW_MS = 7 * DAY_MS;
var HARD_LOCK_AFTER = 3;
/** Roster.locked_until for a lock that only an admin can lift ("Reset a PIN…" / "Clear a lock…"). */
var HARD_LOCK_ISO = '2099-12-31T23:59:59+07:00';

/** Lock n within 7 days lasts 15 · 2^(n-1) minutes (15, 30, …). */
function lockMinutes(n) { return 15 * Math.pow(2, Math.max(1, n) - 1); }

/**
 * Next lock after the 5th wrong PIN. history = start times (ms) of earlier locks of this code.
 * Locks are counted over a rolling 7 days: 15 min, then 30; the 3rd lock within 7 days is
 * permanent until an admin clears it. → {history (≤ 3, newest last), count, hard, locked_until}
 */
function nextLock(history, nowMs) {
  var seen = {}, recent = [];
  (history || []).forEach(function (t) {
    t = typeof t === 'number' ? t : parseTime(t);
    if (isFinite(t) && !isNaN(t) && t > nowMs - LOCK_WINDOW_MS && t <= nowMs && !seen[t]) { seen[t] = true; recent.push(t); }
  });
  recent.sort(function (a, b) { return a - b; });
  recent.push(nowMs);
  var n = recent.length;
  var hard = n >= HARD_LOCK_AFTER;
  return { history: recent.slice(-HARD_LOCK_AFTER), count: n, hard: hard, locked_until: hard ? Infinity : nowMs + lockMinutes(n) * 60000 };
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
  var opts = optionsOf(row, seed);
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

/** Objectives with at least one miss, ascending. */
function weakObjectives(byObj) {
  var out = [];
  for (var k in byObj) {
    if (Object.prototype.hasOwnProperty.call(byObj, k) && byObj[k].correct < byObj[k].n) out.push(k);
  }
  out.sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || (a < b ? -1 : a > b ? 1 : 0); });
  return out.map(objectiveOut);
}

/** Spec 14 calibration flag (admin view; also the profile's "rates high, scores low"). */
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

/**
 * D5 (hardened): a checkpoint's correct options and "why" lines appear only once the learner
 * has passed that course. There is no time-based reveal: a late learner who could read both
 * keys would pass an unlocked attempt from memory.
 */
function revealKey(passedCourse) { return !!passedCourse; }

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
 * → [{group, n, avg: {metric: mean|null}, count: {metric: k}}] for "all" then the role groups.
 * - Managers, test users and inactive rows are never counted.
 * - Groups with n < minN are dropped; complementary rule: the people left out of the shown
 *   role groups number 0 or ≥ minN, so "all" minus the shown groups never singles anyone out.
 * - Per metric: count = people with a value; a metric with count < minN is null, and the same
 *   complementary rule runs on each metric's counts.
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
    return { group: name, n: members.length, avg: avg, count: counts };
  };
  var hide = function (total, list, size) {
    for (;;) {
      var shown = list.reduce(function (s, g) { return s + size(g); }, 0);
      var hidden = total - shown;
      if (hidden === 0 || hidden >= minN || !list.length) return list;
      var smallest = list.slice().sort(function (a, b) { return size(a) - size(b); })[0];
      list = list.filter(function (g) { return g !== smallest; });
    }
  };
  var all = build('all', kept);
  if (all.n < minN) return [];
  var groups = ROLE_GROUPS.map(function (g) {
    return build(g, kept.filter(function (r) { return str(r.group).toLowerCase() === g; }));
  });
  var visible = hide(all.n, groups.filter(function (g) { return g.n >= minN; }), function (g) { return g.n; });
  var shownGroups = [all].concat(groups.filter(function (g) { return visible.indexOf(g) >= 0; }));
  Object.keys(all.count).forEach(function (k) {
    var size = function (g) { return g.count[k] || 0; };
    shownGroups.forEach(function (g) { if (size(g) < minN) g.avg[k] = null; });
    var keep = hide(size(all), visible.filter(function (g) { return g.avg[k] !== null; }), size);
    visible.forEach(function (g) { if (keep.indexOf(g) < 0) g.avg[k] = null; });
  });
  return shownGroups;
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

var STREAK_PROGRAM_WEEKS = 52;
var STREAK_RECENT_WEEKS = 12;

/**
 * Weekly activity streak in +07:00 ISO weeks; multiplier = 1.01^active weeks, 2 dp.
 * skipWeeks: dates (any day of the week, e.g. its Monday) of weeks such as Tết that neither
 * break nor add to current_weeks. recent: the last 12 weeks, oldest first, this week last;
 * skipped weeks are false.
 */
function streak(activityMs, nowMs, skipWeeks) {
  var weeks = {}, skip = {};
  (activityMs || []).forEach(function (ms) {
    if (typeof ms === 'number' && isFinite(ms) && ms <= nowMs) weeks[weekIndex7(ms)] = true;
  });
  (skipWeeks || []).forEach(function (d) {
    var t = typeof d === 'number' ? d : parseTime(d);
    if (!isNaN(t)) skip[weekIndex7(t)] = true;
  });
  var total = Object.keys(weeks).length;
  var thisWeek = weekIndex7(nowMs);
  var activeNow = !!weeks[thisWeek];
  var cur = 0;
  for (var w = thisWeek, guard = 0; guard < 600; w--, guard++) {
    if (skip[w]) continue;                          // neither breaks nor adds
    if (weeks[w]) { cur++; continue; }
    if (w === thisWeek) continue;                   // this week is not over yet
    break;
  }
  var recent = [];
  for (var k = STREAK_RECENT_WEEKS - 1; k >= 0; k--) recent.push(!skip[thisWeek - k] && !!weeks[thisWeek - k]);
  return {
    current_weeks: cur,
    active_this_week: activeNow,
    active_weeks_total: total,
    multiplier: Math.round(Math.pow(1.01, total) * 100) / 100,
    weeks_total_program: STREAK_PROGRAM_WEEKS,
    recent: recent
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

  var seen = {}, counts = { predict: {}, checkpoint: {}, objectives: {}, old_baseline: 0 };
  (items || []).forEach(function (it, idx) {
    var id = str(it.item_id).trim();
    var where = 'Items row ' + (idx + 2) + (id ? ' (' + id + ')' : '');
    if (!id) { errors.push(where + ': item_id is empty'); return; }
    if (seen[id]) errors.push(where + ': duplicate item_id');
    seen[id] = true;
    var a = str(it.assessment).trim().toLowerCase();
    if (a === 'baseline') { counts.old_baseline++; return; } // v1 rows: ignored (Baseline v2 lives in BaselineItems)
    var form = str(it.form).trim().toUpperCase();
    var course = normCode(it.course);
    if (['predict', 'checkpoint'].indexOf(a) < 0) errors.push(where + ': assessment must be predict or checkpoint (the baseline lives in BaselineItems)');
    var wantForm = a === 'predict' ? ['PR'] : ['A', 'B'];
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
    var max = nObj[course] || 6;
    if (!/^\d+$/.test(obj) || +obj < 1 || +obj > max) errors.push(where + ': objective must be 1–' + max);
    var cid = str(it.case_id).trim();
    if (cid && !caseIds[cid]) errors.push(where + ': case_id ' + cid + ' is not in Cases');
    if (!str(it.why_en).trim()) warnings.push(where + ': why_en is empty');
    if (!toBool(it.active === undefined || str(it.active).trim() === '' ? 'TRUE' : it.active)) return;
    if (a === 'predict') counts.predict[course] = (counts.predict[course] || 0) + 1;
    else if (a === 'checkpoint') {
      var k = course + ':' + form;
      counts.checkpoint[k] = (counts.checkpoint[k] || 0) + 1;
      counts.objectives[k + ':' + obj] = true;
    }
  });
  Object.keys(codes).forEach(function (c) {
    if ((counts.predict[c] || 0) !== 3) warnings.push(c + ': ' + (counts.predict[c] || 0) + ' predict items (expected 3)');
    ['A', 'B'].forEach(function (f) {
      var n = counts.checkpoint[c + ':' + f] || 0;
      if (n !== 10) warnings.push(c + ' form ' + f + ': ' + n + ' checkpoint items (expected 10)');
      for (var o = 1; o <= (nObj[c] || 0); o++) {
        if (n && !counts.objectives[c + ':' + f + ':' + o]) warnings.push(c + ' form ' + f + ': objective ' + o + ' has no item');
      }
    });
  });
  if (counts.old_baseline) warnings.push('Items: ' + counts.old_baseline + ' old baseline row(s) are ignored (Baseline v2 uses the BaselineItems tab)');
  return { errors: errors, warnings: warnings, counts: counts };
}

// ---------------------------------------------------------------- Baseline v2 (specs/22)

var BL_ASSESSMENTS = ['baseline_p1', 'baseline_p2', 'baseline_p3'];
var BL_FORMS = ['A', 'B', 'C'];
var BL_MODULES = ['DP', 'SP', 'RPM', 'CS'];
var BL_LEVELS = ['BA', 'WK', 'FO', 'LE'];
var BL_CHARTERS = ['1', '2', '3', '4', '5', 'QWS'];
var BL_SECTIONS = { baseline_p1: ['A', 'B'], baseline_p2: ['SJT', 'RATE'], baseline_p3: ['CORE', 'MOD'] };
var BL_ROLE_MODULE = { demand: 'DP', supply: 'SP', materials: 'RPM', cs: 'CS' };
/** Course ← P3 module (P1 ← CORE; A1/A2/C1 come from Part 1; A3 has no score). */
var BL_MODULE_COURSES = { SP: ['P2'], RPM: ['P3', 'P5'], DP: ['P4'], CS: ['P6'] };
var BL_P1_COURSES = ['A1', 'A2', 'C1'];
/** Fields an item never leaves the server with, before or after a sitting (specs/22 §3 Privacy). */
var BL_PRIVATE_FIELDS = ['answer', 'answer_most', 'answer_least', 'why_en', 'why_vi', 'step', 'move', 'gate', 'level', 'charter'];

/** 1 | 2 | 3 for baseline_p1..p3, else 0. */
function blPart(assessment) { var i = BL_ASSESSMENTS.indexOf(str(assessment).trim().toLowerCase()); return i < 0 ? 0 : i + 1; }

function normCharter(v) {
  var s = str(v).trim().toUpperCase();
  if (s === 'QWS') return 'QWS';
  var n = toInt(s, 0);
  return n >= 1 && n <= 5 ? String(n) : '';
}

function letterOrEmpty_(v) { var l = str(v).trim().toLowerCase(); return OPTION_LETTERS.indexOf(l) >= 0 ? l : ''; }

/** One BaselineItems row (header-keyed strings) → the item the backend works with. */
function normBaselineItem(r, idx) {
  var assessment = str(r.assessment).trim().toLowerCase();
  var section = str(r.section).trim().toUpperCase();
  var type = str(r.item_type).trim().toLowerCase();
  if (!type) type = section === 'SJT' ? 'sjt' : section === 'RATE' ? 'rating' : 'mcq';
  var out = {
    _idx: idx,
    item_id: str(r.item_id).trim(),
    assessment: assessment,
    part: blPart(assessment) || toInt(r.part, 0),
    section: section,
    module: str(r.module).trim().toUpperCase(),
    item_type: type,
    form: str(r.form).trim().toUpperCase() || (assessment === 'baseline_p1' ? '' : 'ONE'),
    order: toInt(r.order, 9999),
    case_id: str(r.case_id).trim(),
    exhibit_ids: str(r.exhibit_ids).split(/[;,]/).map(function (x) { return x.trim(); }).filter(function (x) { return x; }),
    answer: letterOrEmpty_(r.answer),
    answer_most: letterOrEmpty_(r.answer_most),
    answer_least: letterOrEmpty_(r.answer_least),
    allow_nr: toBool(r.allow_nr),
    step: str(r.step).trim(),
    move: str(r.move).trim().toUpperCase().replace(/\s+/g, ' '),
    objective: str(r.objective).trim(),
    gate: str(r.gate).trim(),
    level: str(r.level).trim().toUpperCase(),
    charter: normCharter(r.charter),
    active: str(r.active).trim() === '' ? true : toBool(r.active)
  };
  ['stem', 'a', 'b', 'c', 'd', 'why', 'self', 'mgr', 'anchor1', 'anchor4'].forEach(function (k) {
    out[k + '_en'] = str(r[k + '_en']);
    out[k + '_vi'] = str(r[k + '_vi']);
  });
  return out;
}

/** Sort key inside a part: section (as listed in BL_SECTIONS), then order, then item_id. */
function blSortItems(items) {
  return items.slice().sort(function (a, b) {
    var sa = (BL_SECTIONS[a.assessment] || []).indexOf(a.section), sb = (BL_SECTIONS[b.assessment] || []).indexOf(b.section);
    return (sa - sb) || (a.order - b.order) || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0);
  });
}

/** Non-empty options in letter order, shuffled by seed (same seed → same order, F9). */
function optionsOf(row, seed) {
  var opts = [];
  for (var i = 0; i < OPTION_LETTERS.length; i++) {
    var l = OPTION_LETTERS[i];
    if (str(row[l + '_en']).trim() !== '' || str(row[l + '_vi']).trim() !== '') opts.push({ id: l, en: str(row[l + '_en']), vi: str(row[l + '_vi']) });
  }
  return seed !== undefined && seed !== null && seed !== '' ? shuffle(opts, seed) : opts;
}

/**
 * The only shapes a baseline item leaves the server in (specs/22 §4), built from a whitelist:
 * BMcq {item_id, type, section, case_id, exhibit_ids, stem_*, options} · BSjt {item_id, type, stem_*, options}
 * · BRating {item_id, type, text_* (self wording), anchor1_*, anchor4_*, allow_nr}.
 */
function serveBaselineItem(it, seed) {
  if (it.item_type === 'rating') {
    return {
      item_id: str(it.item_id), type: 'rating', text_en: str(it.self_en), text_vi: str(it.self_vi),
      anchor1_en: str(it.anchor1_en), anchor1_vi: str(it.anchor1_vi), anchor4_en: str(it.anchor4_en), anchor4_vi: str(it.anchor4_vi),
      allow_nr: !!it.allow_nr
    };
  }
  if (it.item_type === 'sjt') return { item_id: str(it.item_id), type: 'sjt', stem_en: str(it.stem_en), stem_vi: str(it.stem_vi), options: optionsOf(it, seed) };
  return {
    item_id: str(it.item_id), type: 'mcq', section: str(it.section), case_id: str(it.case_id),
    exhibit_ids: (it.exhibit_ids || []).slice(), stem_en: str(it.stem_en), stem_vi: str(it.stem_vi), options: optionsOf(it, seed)
  };
}

/** A rating statement in manager wording (rate_get). */
function managerRatingItem(it) {
  return {
    item_id: str(it.item_id), text_en: str(it.mgr_en), text_vi: str(it.mgr_vi),
    anchor1_en: str(it.anchor1_en), anchor1_vi: str(it.anchor1_vi), anchor4_en: str(it.anchor4_en), anchor4_vi: str(it.anchor4_vi)
  };
}

function ratingInt_(v) {
  var n = typeof v === 'number' ? v : (/^\s*[1-4]\s*$/.test(str(v)) ? parseInt(str(v), 10) : NaN);
  return n === Math.floor(n) && n >= 1 && n <= 4 ? n : null;
}

/**
 * One learner answer, cleaned for its item type, or undefined when it is not a valid answer:
 * mcq 'a'..'d' · sjt {most?, least?} (letters; partial picks are kept while saving) · rating 1..4,
 * or 'NR' where the statement allows "not my role".
 */
function cleanBlValue(item, v) {
  if (!item || v === null || v === undefined) return undefined;
  if (item.item_type === 'mcq') { var l = letterOrEmpty_(v); return l || undefined; }
  if (item.item_type === 'sjt') {
    if (typeof v !== 'object' || Array.isArray(v)) return undefined;
    var o = {}, m = letterOrEmpty_(v.most), le = letterOrEmpty_(v.least);
    if (m) o.most = m;
    if (le) o.least = le;
    return o.most || o.least ? o : undefined;
  }
  if (item.item_type === 'rating') {
    if (item.allow_nr && str(v).trim().toUpperCase() === 'NR') return 'NR';
    var n = ratingInt_(v);
    return n === null ? undefined : n;
  }
  return undefined;
}

/** {item_id: value} for the given ids only, each cleaned by cleanBlValue. */
function cleanBlAnswers(answers, ids, byId) {
  var out = {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return out;
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (!Object.prototype.hasOwnProperty.call(answers, id)) continue;
    var v = cleanBlValue(byId[id], answers[id]);
    if (v !== undefined) out[id] = v;
  }
  return out;
}

/** The first SJT item without both picks, or with most = least; null when every item is complete. */
function sjtLockProblem(sjtIds, answers) {
  answers = answers || {};
  for (var i = 0; i < sjtIds.length; i++) {
    var a = answers[sjtIds[i]];
    if (!a || !a.most || !a.least || a.most === a.least) return sjtIds[i];
  }
  return null;
}

/**
 * Part 1 form (specs/22 §3): an Overrides row wins (any of A/B/C, the only way to the backup);
 * re-test: the live form not taken last wave; else the live form with fewer non-void starts in the
 * person's role_area this wave; tie → hash(code + wave). Never the backup without an override.
 * o: {override, live: [..], counts: {form: n}, previousForm, code, wave} → {form, reason}
 */
function chooseP1Form(o) {
  o = o || {};
  var ov = str(o.override).trim().toUpperCase();
  if (BL_FORMS.indexOf(ov) >= 0) return { form: ov, reason: 'override' };
  var live = [];
  (o.live || []).forEach(function (f) { f = str(f).trim().toUpperCase(); if (BL_FORMS.indexOf(f) >= 0 && live.indexOf(f) < 0) live.push(f); });
  if (!live.length) return { form: '', reason: 'no_live_form' };
  var prev = str(o.previousForm).trim().toUpperCase();
  var cands = live, retest = false;
  if (prev && live.indexOf(prev) >= 0 && live.length > 1) {
    cands = live.filter(function (f) { return f !== prev; });
    if (cands.length === 1) return { form: cands[0], reason: 'retest_swap' };
    retest = true;
  } else if (prev) retest = true;
  var counts = o.counts || {};
  var n = function (f) { return toInt(counts[f], 0); };
  var min = Math.min.apply(null, cands.map(n));
  var best = cands.filter(function (f) { return n(f) === min; });
  if (best.length === 1) return { form: best[0], reason: retest ? 'retest_balance' : 'balance' };
  return { form: best[hashString(normCode(o.code) + str(o.wave)) % best.length], reason: 'hash' };
}

/** Part 3 module: Roster.p3_module (DP|SP|RPM|CS) wins, else role_area; '' when neither gives one. */
function p3ModuleFor(p3Module, roleArea) {
  var m = str(p3Module).trim().toUpperCase();
  if (BL_MODULES.indexOf(m) >= 0) return m;
  return BL_ROLE_MODULE[str(roleArea).trim().toLowerCase()] || '';
}

function stepNumber(step) { var m = /^\s*(\d+)/.exec(str(step)); return m ? parseInt(m[1], 10) : null; }

function isRealMove_(m) { return !!m && !/^[—–\-]+$/.test(m); }

function pctOf(c) { return c && c.n ? Math.round(100 * c.correct / c.n) : null; }

function pctMap(counts) {
  var out = {};
  Object.keys(counts || {}).forEach(function (k) { out[k] = pctOf(counts[k]); });
  return out;
}

function bump_(map, key, ok) {
  if (!key) return;
  var c = map[key] = map[key] || { n: 0, correct: 0 };
  c.n++;
  if (ok) c.correct++;
}

/**
 * Multiple-choice part (Part 1, Part 3): unanswered = wrong. Counts {n, correct} by section, step,
 * move, level, gate and linked course (Part 1: A1 ← steps 1–4; A2 ← SHAPE, SIZE, CHECK; C1 ← SO WHAT
 * or step 6).
 */
function scoreBlMcq(servedIds, answers, byId) {
  answers = answers || {};
  var r = { n: 0, correct: 0, by_section: {}, by_step: {}, by_move: {}, by_level: {}, by_gate: {}, by_course: {} };
  servedIds.forEach(function (id) {
    var it = byId[id];
    if (!it || it.item_type !== 'mcq') return;
    var ok = !!it.answer && answers[id] === it.answer;
    r.n++;
    if (ok) r.correct++;
    bump_(r.by_section, it.section, ok);
    bump_(r.by_step, it.step, ok);
    if (isRealMove_(it.move)) bump_(r.by_move, it.move, ok);
    bump_(r.by_level, it.level, ok);
    bump_(r.by_gate, it.gate, ok);
    if (it.assessment === 'baseline_p1') {
      var sn = stepNumber(it.step);
      if (sn !== null && sn >= 1 && sn <= 4) bump_(r.by_course, 'A1', ok);
      if (['SHAPE', 'SIZE', 'CHECK'].indexOf(it.move) >= 0) bump_(r.by_course, 'A2', ok);
      if (it.move === 'SO WHAT' || sn === 6) bump_(r.by_course, 'C1', ok);
    }
  });
  r.pct = r.n ? Math.round(100 * r.correct / r.n) : 0;
  return r;
}

/** SJT: +1 most = key, +1 least = key (an item with most = least scores 0). By charter {sjt_points, sjt_max}. */
function scoreSjt(servedIds, answers, byId) {
  answers = answers || {};
  var r = { points: 0, max: 0, by_charter: {} };
  servedIds.forEach(function (id) {
    var it = byId[id];
    if (!it || it.item_type !== 'sjt') return;
    var a = answers[id] || {}, p = 0;
    if (!(a.most && a.least && a.most === a.least)) {
      if (a.most && a.most === it.answer_most) p++;
      if (a.least && a.least === it.answer_least) p++;
    }
    r.points += p;
    r.max += 2;
    if (it.charter) {
      var c = r.by_charter[it.charter] = r.by_charter[it.charter] || { sjt_points: 0, sjt_max: 0 };
      c.sjt_points += p;
      c.sjt_max += 2;
    }
  });
  r.pct = r.max ? Math.round(100 * r.points / r.max) : 0;
  return r;
}

function mean_(xs) { return xs.length ? xs.reduce(function (s, x) { return s + x; }, 0) / xs.length : null; }

/** Means of 1–4 ratings (NR and NA left out): overall and by charter → {mean, n, by_charter: {c: {mean, n}}}. */
function ratingMeans(values, items) {
  var all = [], by = {};
  (items || []).forEach(function (it) {
    var v = values ? values[it.item_id] : undefined;
    var n = typeof v === 'number' ? v : ratingInt_(v);
    if (n === null || n === undefined || isNaN(n)) return;
    all.push(n);
    if (it.charter) (by[it.charter] = by[it.charter] || []).push(n);
  });
  var out = { mean: mean_(all), n: all.length, by_charter: {} };
  Object.keys(by).forEach(function (c) { out.by_charter[c] = { mean: mean_(by[c]), n: by[c].length }; });
  return out;
}

/**
 * Validates rating values for one rater. role 'manager': 1–4 or 'NA'; role 'self': 1–4 or 'NR'
 * where allow_nr. null or '' clears a value. Unknown item ids are ignored.
 * → {values: {item_id: 1..4|'NA'|'NR'|''}, bad: item_id|null}
 */
function cleanRatingValues(values, items, role) {
  var out = {}, bad = null;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { values: out, bad: null };
  (items || []).forEach(function (it) {
    if (bad || !Object.prototype.hasOwnProperty.call(values, it.item_id)) return;
    var v = values[it.item_id];
    if (v === null || v === undefined || str(v).trim() === '') { out[it.item_id] = ''; return; }
    var up = str(v).trim().toUpperCase();
    if (role === 'manager' && up === 'NA') { out[it.item_id] = 'NA'; return; }
    if (role === 'self' && up === 'NR' && it.allow_nr) { out[it.item_id] = 'NR'; return; }
    var n = ratingInt_(v);
    if (n === null) { bad = it.item_id; return; }
    out[it.item_id] = n;
  });
  return { values: bad ? {} : out, bad: bad };
}

/** Mean and sample SD (n − 1); sd is null below two values. */
function meanSd(xs) {
  var v = (xs || []).filter(function (x) { return typeof x === 'number' && isFinite(x); });
  var m = mean_(v);
  if (v.length < 2) return { n: v.length, mean: m, sd: null };
  var ss = v.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0);
  return { n: v.length, mean: m, sd: Math.sqrt(ss / (v.length - 1)) };
}

/** Mean-sigma linear equating onto a reference scale, clamped 0–100 and rounded. */
function equateLinear(raw, from, to) {
  if (!from || !to || !from.sd || to.sd === null || to.sd === undefined) return raw;
  var x = to.mean + to.sd * (raw - from.mean) / from.sd;
  return Math.max(0, Math.min(100, Math.round(x)));
}

/**
 * Part 1 equating plan. scores {form: [raw_pct…]}. Applies when the live forms' means differ by
 * more than threshold points. Reference = Form A (the spec's scale) when it has ≥ 2 scores with a
 * spread; otherwise the pooled live-form scores (the backup is rarely sat). A form with fewer than
 * two scores, or no spread, keeps its raw scores.
 * → {apply, reference: 'A'|'pooled'|'', ref: {n, mean, sd}|null, stats: {form: {n, mean, sd}}, diff}
 */
function equatingPlan(scores, live, threshold, refForm) {
  refForm = refForm || 'A';
  var stats = {};
  Object.keys(scores || {}).forEach(function (f) { stats[f] = meanSd(scores[f]); });
  var liveWith = (live || []).filter(function (f) { return stats[f] && stats[f].n >= 1; });
  var means = liveWith.map(function (f) { return stats[f].mean; });
  var diff = means.length >= 2 ? Math.max.apply(null, means) - Math.min.apply(null, means) : 0;
  var plan = { apply: false, reference: '', ref: null, stats: stats, diff: Math.round(diff * 10) / 10 };
  if (means.length < 2 || !(diff > toNum(threshold, 5))) return plan;
  var good = function (s) { return s && s.n >= 2 && s.sd > 0; };
  if (good(stats[refForm])) { plan.reference = refForm; plan.ref = stats[refForm]; } else {
    var pooled = [];
    (live || []).forEach(function (f) { pooled = pooled.concat(scores[f] || []); });
    var ps = meanSd(pooled);
    if (!good(ps)) return plan;
    plan.reference = 'pooled';
    plan.ref = ps;
  }
  plan.apply = true;
  return plan;
}

function scaledFor(plan, form, raw) {
  if (!plan || !plan.apply || typeof raw !== 'number') return raw;
  if (plan.reference === form) return raw;
  var s = plan.stats[form];
  if (!s || s.n < 2 || !(s.sd > 0)) return raw;
  return equateLinear(raw, s, plan.ref);
}

/** Indicative level: the highest of BA < WK < FO < LE where it and every lower level are ≥ cut %. */
function blLevel(byLevel, cut) {
  cut = cut === undefined ? 70 : cut;
  var level = null;
  for (var i = 0; i < BL_LEVELS.length; i++) {
    var c = (byLevel || {})[BL_LEVELS[i]];
    if (!c || !c.n) continue;
    if (100 * c.correct / c.n >= cut) level = BL_LEVELS[i]; else break;
  }
  return level;
}

/** SJT % per charter as a band: low ≤ 33, high ≥ 83, else mid. */
function sjtBand(pct) {
  if (pct === null || pct === undefined) return null;
  return pct <= 33 ? 'low' : pct >= 83 ? 'high' : 'mid';
}

var EPS_ = 1e-9;

/**
 * One charter: index and flags. o = {sjt_points, sjt_max, self_mean, mgr_mean, mgr_n, min_rated, w_sjt, w_mgr}.
 * The manager mean counts only with ≥ min_rated statements rated. Index = w_sjt × SJT% + w_mgr ×
 * (mgr − 1) ÷ 3 × 100; a charter without SJT items (QWS) uses the manager part alone; no manager mean → null.
 */
function charterSummary(o) {
  var sjt = o.sjt_max ? Math.round(100 * o.sjt_points / o.sjt_max) : null;
  var mgr = typeof o.mgr_mean === 'number' && toInt(o.mgr_n, 0) >= toInt(o.min_rated, 2) ? o.mgr_mean : null;
  var self = typeof o.self_mean === 'number' ? o.self_mean : null;
  var index = null;
  if (mgr !== null) {
    var m = (mgr - 1) / 3 * 100;
    index = Math.round(sjt === null ? m : toNum(o.w_sjt, 0.5) * sjt + toNum(o.w_mgr, 0.5) * m);
  }
  var flags = [];
  if (self !== null && mgr !== null && self - mgr >= 1 - EPS_) flags.push('blind_spot');
  if (self !== null && mgr !== null && mgr - self >= 1 - EPS_) flags.push('hidden_strength');
  if (sjt !== null && sjt >= 67 && mgr !== null && mgr < 2.5) flags.push('knowing_doing');
  return { sjt_pct: sjt, sjt_band: sjtBand(sjt), self_mean: self, mgr_mean: mgr, index: index, flags: flags };
}

/**
 * The two statements with the lowest manager rating; tie → the larger self − manager gap, then
 * item order. mgr/self {item_id: number}; items in order.
 */
function topDevelopment(mgr, self, items, k) {
  k = k === undefined ? 2 : k;
  var list = (items || []).filter(function (it) { return typeof (mgr || {})[it.item_id] === 'number'; });
  var gap = function (it) { var s = (self || {})[it.item_id]; return typeof s === 'number' ? s - mgr[it.item_id] : -99; };
  list = list.map(function (it, i) { return { it: it, i: i }; });
  list.sort(function (a, b) { return (mgr[a.it.item_id] - mgr[b.it.item_id]) || (gap(b.it) - gap(a.it)) || (a.i - b.i); });
  return list.slice(0, k).map(function (x) { return x.it; });
}

/**
 * Course self-rating next to the linked score (specs/22 §3). p1Course {A1|A2|C1: {n, correct}},
 * p3 {core_pct, module, module_pct}. flag = self ≥ 3 and score < 50 ("rates high, scores low").
 */
function courseLinks(selfMap, p1Course, p3, order) {
  var score = {};
  BL_P1_COURSES.forEach(function (c) { score[c] = p1Course ? pctOf(p1Course[c]) : null; });
  score.P1 = p3 && typeof p3.core_pct === 'number' ? p3.core_pct : null;
  Object.keys(BL_MODULE_COURSES).forEach(function (m) {
    BL_MODULE_COURSES[m].forEach(function (c) { score[c] = p3 && p3.module === m && typeof p3.module_pct === 'number' ? p3.module_pct : null; });
  });
  score.A3 = null;
  var out = {};
  (order || []).forEach(function (c) {
    var s = selfMap && typeof selfMap[c] === 'number' ? selfMap[c] : null;
    var sc = score[c] === undefined ? null : score[c];
    out[c] = { self: s, score_pct: sc, flag: calibrationFlag(s, sc) === 'rates high, scores low' };
  });
  return out;
}

/**
 * The two lowest areas for the IDP. areas (in the listed order): [{area, name_en, name_vi, pct, self}]
 * where self is 0–1 (null = unknown, sorts last). Tie → lower self, then the listed order.
 */
function idpGaps(areas, k) {
  k = k === undefined ? 2 : k;
  var list = (areas || []).filter(function (a) { return typeof a.pct === 'number'; }).map(function (a, i) { return { a: a, i: i }; });
  var sv = function (a) { return typeof a.self === 'number' ? a.self : 99; };
  list.sort(function (x, y) { return (x.a.pct - y.a.pct) || (sv(x.a) - sv(y.a)) || (x.i - y.i); });
  return list.slice(0, k).map(function (x) { return { area: x.a.area, name_en: x.a.name_en, name_vi: x.a.name_vi, pct: x.a.pct }; });
}

function round1n_(x) { return typeof x === 'number' ? round1(x) : null; }

/**
 * Assembles one learner's profile (specs/22 §4 `profile`) from already-scored parts.
 * inp = { wave, built_at, order, w_sjt, w_mgr, names: {p1_A, p1_B, p3_CORE, p3_DP…, charters: {c: {en, vi}}},
 *   p1: {form, raw_pct, scaled_pct, by_section, by_step, by_move, by_course} | null,
 *   p2: {by_charter: {c: {sjt_points, sjt_max}}, points, max, items: [rating items], self: {id: v}, mgr: {id: mean}} | null,
 *   p3: {module, total_pct, core_pct, module_pct, by_level, by_gate} | null,
 *   self_courses: {A2: 0..4} }
 */
function buildBaselineProfile(inp) {
  var names = inp.names || {};
  var nm = function (k, en) { var x = names[k] || {}; return { en: x.en || en, vi: x.vi || x.en || en }; };
  var selfC = inp.self_courses || {};
  var selfOf = function (codes) {
    var v = codes.map(function (c) { return selfC[c]; }).filter(function (x) { return typeof x === 'number'; });
    return v.length ? mean_(v) / 4 : null;
  };
  var out = { wave: inp.wave, built_at: inp.built_at, p1: null, p2: null, p3: null, courses: {}, gaps: [] };
  var areas = [];

  if (inp.p1) {
    var p = inp.p1, sec = p.by_section || {};
    out.p1 = {
      form: p.form, raw_pct: p.raw_pct, scaled_pct: typeof p.scaled_pct === 'number' ? p.scaled_pct : p.raw_pct,
      section_A_pct: pctOf(sec.A), section_B_pct: pctOf(sec.B), by_step: pctMap(p.by_step), by_move: pctMap(p.by_move)
    };
    var a = nm('p1_A', 'Part 1 · Section A'), b = nm('p1_B', 'Part 1 · Section B');
    areas.push({ area: 'p1_A', name_en: a.en, name_vi: a.vi, pct: out.p1.section_A_pct, self: selfOf(BL_P1_COURSES) });
    areas.push({ area: 'p1_B', name_en: b.en, name_vi: b.vi, pct: out.p1.section_B_pct, self: selfOf(BL_P1_COURSES) });
  }

  if (inp.p2) {
    var q = inp.p2, items = q.items || [];
    var sm = ratingMeans(q.self || {}, items), mm = ratingMeans(q.mgr || {}, items);
    var charters = BL_CHARTERS.filter(function (c) {
      return (q.by_charter && q.by_charter[c]) || items.some(function (it) { return it.charter === c; });
    });
    var byC = {};
    charters.forEach(function (c) {
      var sj = (q.by_charter || {})[c] || { sjt_points: 0, sjt_max: 0 };
      var cs = charterSummary({
        sjt_points: sj.sjt_points, sjt_max: sj.sjt_max,
        self_mean: sm.by_charter[c] ? sm.by_charter[c].mean : null,
        mgr_mean: mm.by_charter[c] ? mm.by_charter[c].mean : null, mgr_n: mm.by_charter[c] ? mm.by_charter[c].n : 0,
        min_rated: c === 'QWS' ? 3 : 2, w_sjt: inp.w_sjt, w_mgr: inp.w_mgr
      });
      var n = nm('charter_' + c, c === 'QWS' ? 'QWS' : 'Charter ' + c);
      byC[c] = { name_en: n.en, name_vi: n.vi, sjt_band: cs.sjt_band, self_mean: round1n_(cs.self_mean), mgr_mean: round1n_(cs.mgr_mean), index: cs.index, flags: cs.flags };
      var areaPct = cs.index !== null ? cs.index : cs.sjt_pct;
      areas.push({ area: 'p2_' + c, name_en: n.en, name_vi: n.vi, pct: areaPct, self: cs.self_mean === null ? null : (cs.self_mean - 1) / 3 });
    });
    var dev = topDevelopment(q.mgr || {}, q.self || {}, items).map(function (it) {
      return { item_id: it.item_id, text_en: str(it.self_en), text_vi: str(it.self_vi) };
    });
    out.p2 = {
      sjt_pct: q.max ? Math.round(100 * q.points / q.max) : null,
      self_mean: round1n_(sm.mean), mgr_mean: round1n_(mm.mean), by_charter: byC, top_dev: dev
    };
  }

  if (inp.p3) {
    var r = inp.p3;
    out.p3 = {
      module: r.module, total_pct: r.total_pct, core_pct: r.core_pct, module_pct: r.module_pct,
      by_level: pctMap(r.by_level), by_gate: pctMap(r.by_gate), level: blLevel(r.by_level)
    };
    var core = nm('p3_CORE', 'Part 3 · Core'), mod = nm('p3_' + r.module, 'Part 3 · ' + r.module);
    areas.push({ area: 'p3_core', name_en: core.en, name_vi: core.vi, pct: r.core_pct, self: selfOf(['P1']) });
    areas.push({ area: 'p3_mod', name_en: mod.en, name_vi: mod.vi, pct: r.module_pct, self: selfOf(BL_MODULE_COURSES[r.module] || []) });
  }

  out.courses = courseLinks(selfC, inp.p1 ? inp.p1.by_course : null, out.p3, inp.order || []);
  out.gaps = idpGaps(areas);
  return out;
}

/** Pearson correlation; null when either side has no spread. */
function pearson(xs, ys) {
  var n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  var mx = mean_(xs.slice(0, n)), my = mean_(ys.slice(0, n)), sxy = 0, sxx = 0, syy = 0;
  for (var i = 0; i < n; i++) { var dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/**
 * Item statistics for one item over the people who were served it.
 * rows [{score, max, total, pick}] (total = the person's part score including this item; pick
 * 'a'..'d' or '' for blank). → {n, p_value (0–1), point_biserial (item vs rest of the part), dist {a,b,c,d,blank} %}
 */
function itemAnalysis(rows) {
  var n = rows.length;
  var dist = { a: 0, b: 0, c: 0, d: 0, blank: 0 };
  rows.forEach(function (r) { var k = OPTION_LETTERS.indexOf(r.pick) >= 0 ? r.pick : 'blank'; dist[k]++; });
  Object.keys(dist).forEach(function (k) { dist[k] = n ? Math.round(100 * dist[k] / n) : 0; });
  var max = rows.length ? rows[0].max || 1 : 1;
  var p = n ? mean_(rows.map(function (r) { return r.score / max; })) : null;
  var pb = pearson(rows.map(function (r) { return r.score; }), rows.map(function (r) { return r.total - r.score; }));
  return { n: n, p_value: p === null ? null : Math.round(p * 100) / 100, point_biserial: pb === null ? null : Math.round(pb * 100) / 100, dist: dist };
}

/**
 * Validates the BaselineItems and Exhibits tabs (row objects keyed by header).
 * opts {live: ['B','C'], backup: 'A'}. Structural problems are errors; blueprint counts are warnings.
 */
function validateBaselineBank(items, exhibits, opts) {
  opts = opts || {};
  var errors = [], warnings = [];
  var exIds = {};
  (exhibits || []).forEach(function (e, i) {
    var id = str(e.exhibit_id).trim();
    if (!id) { errors.push('Exhibits row ' + (i + 2) + ': exhibit_id is empty'); return; }
    if (exIds[id]) errors.push('Exhibits row ' + (i + 2) + ' (' + id + '): duplicate exhibit_id');
    exIds[id] = true;
    if (!str(e.md_en).trim()) errors.push('Exhibits ' + id + ': md_en is empty');
    else if (!str(e.md_vi).trim()) warnings.push('Exhibits ' + id + ': md_vi is empty');
  });
  var seen = {}, counts = {};
  var count = function (k) { counts[k] = (counts[k] || 0) + 1; };
  (items || []).forEach(function (raw, idx) {
    var it = normBaselineItem(raw, idx);
    var where = 'BaselineItems row ' + (idx + 2) + (it.item_id ? ' (' + it.item_id + ')' : '');
    if (!it.item_id) { errors.push(where + ': item_id is empty'); return; }
    if (seen[it.item_id]) errors.push(where + ': duplicate item_id');
    seen[it.item_id] = true;
    if (!blPart(it.assessment)) { errors.push(where + ': assessment must be baseline_p1, baseline_p2 or baseline_p3'); return; }
    var secs = BL_SECTIONS[it.assessment];
    if (secs.indexOf(it.section) < 0) errors.push(where + ': section must be ' + secs.join(' or '));
    if (it.assessment === 'baseline_p1' && BL_FORMS.indexOf(it.form) < 0) errors.push(where + ': form must be A, B or C');
    if (it.assessment !== 'baseline_p1' && it.form !== 'ONE') errors.push(where + ': form must be ONE');
    if (it.assessment === 'baseline_p3' && it.section === 'MOD' && BL_MODULES.indexOf(it.module) < 0) errors.push(where + ': module must be DP, SP, RPM or CS');
    var wantType = it.section === 'SJT' ? 'sjt' : it.section === 'RATE' ? 'rating' : 'mcq';
    if (it.item_type !== wantType) errors.push(where + ': item_type must be ' + wantType + ' in section ' + it.section);
    if (it.item_type === 'mcq' || it.item_type === 'sjt') {
      if (!it.stem_en.trim()) errors.push(where + ': stem_en is empty');
      else if (!it.stem_vi.trim()) warnings.push(where + ': stem_vi is empty');
      OPTION_LETTERS.forEach(function (l) {
        if (!it[l + '_en'].trim()) errors.push(where + ': option ' + l + '_en is empty');
        else if (!it[l + '_vi'].trim()) warnings.push(where + ': option ' + l + '_vi is empty');
      });
    }
    if (it.item_type === 'mcq' && !it.answer) errors.push(where + ': answer must be a, b, c or d');
    if (it.item_type === 'sjt') {
      if (!it.answer_most || !it.answer_least) errors.push(where + ': answer_most and answer_least must both be a, b, c or d');
      else if (it.answer_most === it.answer_least) errors.push(where + ': answer_most and answer_least must differ');
    }
    if (it.item_type === 'rating') {
      if (!it.self_en.trim() || !it.mgr_en.trim()) errors.push(where + ': a rating needs self_en and mgr_en');
      if (!it.self_vi.trim() || !it.mgr_vi.trim()) warnings.push(where + ': self_vi or mgr_vi is empty');
    } else if (it.allow_nr) warnings.push(where + ': allow_nr only applies to rating statements');
    if (it.assessment === 'baseline_p2' && !it.charter) errors.push(where + ': charter must be 1–5 or QWS');
    it.exhibit_ids.forEach(function (x) { if (!exIds[x]) errors.push(where + ': exhibit ' + x + ' is not in Exhibits'); });
    if (!it.active) return;
    if (it.assessment === 'baseline_p1') count('p1:' + it.form + ':' + it.section);
    else if (it.assessment === 'baseline_p2') count('p2:' + it.section);
    else count('p3:' + (it.section === 'MOD' ? it.module : 'CORE'));
  });
  var live = (opts.live || ['B', 'C']).map(function (f) { return str(f).trim().toUpperCase(); });
  var backup = str(opts.backup === undefined ? 'A' : opts.backup).trim().toUpperCase();
  BL_FORMS.forEach(function (f) {
    var a = counts['p1:' + f + ':A'] || 0, b = counts['p1:' + f + ':B'] || 0;
    var msg = 'Part 1 form ' + f + ': ' + (a + b) + ' active items (expected 32: 22 in Section A, 10 in Section B; now ' + a + ' + ' + b + ')';
    if (live.indexOf(f) >= 0 && a + b !== 32) errors.push(msg + ' · this form is live');
    else if (f === backup && a + b !== 32) warnings.push(msg + ' · backup form');
    else if (live.indexOf(f) >= 0 && (a !== 22 || b !== 10)) warnings.push(msg);
  });
  [['p2:SJT', 15, 'Part 2 SJT'], ['p2:RATE', 23, 'Part 2 rating statements'], ['p3:CORE', 10, 'Part 3 core']].forEach(function (x) {
    if ((counts[x[0]] || 0) !== x[1]) warnings.push(x[2] + ': ' + (counts[x[0]] || 0) + ' active items (expected ' + x[1] + ')');
  });
  BL_MODULES.forEach(function (m) {
    if ((counts['p3:' + m] || 0) !== 18) warnings.push('Part 3 module ' + m + ': ' + (counts['p3:' + m] || 0) + ' active items (expected 18)');
  });
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
    LOCK_WINDOW_MS: LOCK_WINDOW_MS, HARD_LOCK_AFTER: HARD_LOCK_AFTER, HARD_LOCK_ISO: HARD_LOCK_ISO,
    lockMinutes: lockMinutes, nextLock: nextLock,
    hashString: hashString, mulberry32: mulberry32, shuffle: shuffle,
    optionOf: optionOf, serveItem: serveItem, cleanAnswers: cleanAnswers, cleanSelfRatings: cleanSelfRatings,
    byObjective: byObjective, grade: grade, isPass: isPass, weakObjectives: weakObjectives,
    calibrationFlag: calibrationFlag,
    pickForm: pickForm, canRetake: canRetake, checkpointGate: checkpointGate, unlocksUsed: unlocksUsed,
    revealKey: revealKey, parseDays: parseDays, recallDates: recallDates, recallForm: recallForm,
    recallItems: recallItems, excludedFromSummary: excludedFromSummary, summarise: summarise, streak: streak, panelWeighted: panelWeighted,
    parseCsv: parseCsv, courseObjectiveCount: courseObjectiveCount, validateBank: validateBank,
    BL_ASSESSMENTS: BL_ASSESSMENTS, BL_FORMS: BL_FORMS, BL_MODULES: BL_MODULES, BL_LEVELS: BL_LEVELS, BL_CHARTERS: BL_CHARTERS,
    BL_SECTIONS: BL_SECTIONS, BL_PRIVATE_FIELDS: BL_PRIVATE_FIELDS, blPart: blPart, normCharter: normCharter,
    normBaselineItem: normBaselineItem, blSortItems: blSortItems, optionsOf: optionsOf, serveBaselineItem: serveBaselineItem,
    managerRatingItem: managerRatingItem, cleanBlValue: cleanBlValue, cleanBlAnswers: cleanBlAnswers, sjtLockProblem: sjtLockProblem,
    chooseP1Form: chooseP1Form, p3ModuleFor: p3ModuleFor, stepNumber: stepNumber, pctOf: pctOf, pctMap: pctMap,
    scoreBlMcq: scoreBlMcq, scoreSjt: scoreSjt, ratingMeans: ratingMeans, cleanRatingValues: cleanRatingValues,
    meanSd: meanSd, equateLinear: equateLinear, equatingPlan: equatingPlan, scaledFor: scaledFor, blLevel: blLevel,
    sjtBand: sjtBand, charterSummary: charterSummary, topDevelopment: topDevelopment, courseLinks: courseLinks,
    idpGaps: idpGaps, buildBaselineProfile: buildBaselineProfile, pearson: pearson, itemAnalysis: itemAnalysis,
    validateBaselineBank: validateBaselineBank
  };
}
