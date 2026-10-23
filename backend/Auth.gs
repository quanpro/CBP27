/**
 * Auth.gs · login, PIN change, logout, consent, language, stateless signed tokens (F1),
 * peppered PIN hashes and locks (F2), server-side must_change_pin (F3) and consent (F18).
 *
 * Wrong PINs are counted per code in CacheService for every code, known or not, so an
 * unknown code locks exactly like a real one (no "which codes exist" oracle) and a wrong
 * PIN costs no Sheet write and no script lock. Only when a real person gets locked is the
 * lock also written to Roster (locked_until, lock_count, lock_history), which keeps it
 * beyond CacheService's 6-hour limit. Locks: 15 min, then 30 within 7 days; the 3rd lock in
 * 7 days stays until an admin uses "Reset a PIN…" or "Clear a lock…".
 */

var AUTH_FAILED_MSG_ = 'Employee code or PIN is not correct.';
var DUMMY_SALT_ = 'no-such-user-salt-00000000000000';
var DUMMY_HASH_ = '0000000000000000000000000000000000000000000000000000000000000000';
var FAIL_TTL_S_ = 21600; // CacheService maximum (6 h)

// ---------------------------------------------------------------- secrets (cached, then Script Properties)

/** Secrets are cached in CacheService so forged tokens do not spend the Properties quota. */
function secret_(name, create) {
  var r = req_();
  if (r.secrets[name]) return r.secrets[name];
  var key = 'sec:' + name, s = null;
  try { s = CacheService.getScriptCache().get(key); } catch (e) { s = null; }
  if (!s) {
    var p = PropertiesService.getScriptProperties();
    s = p.getProperty(name);
    if (!s && create) { s = randomSecret_(); p.setProperty(name, s); }
    if (!s) throw new Error(name + ' is missing: run setupSheet once from the editor');
    try { CacheService.getScriptCache().put(key, s, 21600); } catch (e2) { /* optional */ }
  }
  r.secrets[name] = s;
  return s;
}

function tokenSecret_() { return secret_('TOKEN_SECRET', true); }

function pinPepper_() { return secret_('PIN_PEPPER', false); }

function randomSecret_() {
  var raw = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8)).replace(/=+$/, '') +
    Utilities.getUuid().replace(/-/g, '');
}

function pinDigest_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
}

function tokenHmac_(msg) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(msg, tokenSecret_())).replace(/=+$/, '');
}

function newSalt_() { return Utilities.getUuid().replace(/-/g, ''); }

/** {pin_salt, pin_hash} for a PIN (used by change_pin, Issue PINs, Reset a PIN). */
function makePinRecord_(pin) {
  var salt = newSalt_();
  return { pin_salt: salt, pin_hash: hashPin(pinPepper_(), salt, pin, pinDigest_) };
}

/** A random 6-digit PIN that passes pinProblem(). */
function randomPin_() {
  for (var i = 0; i < 50; i++) {
    var pin = pinFromHex(Utilities.getUuid());
    if (pin) return pin;
  }
  throw new Error('Could not generate a PIN');
}

/** Always one hash, whether or not the person exists (same work on both paths). */
function pinMatches_(row, pin) {
  var real = !!(row && row.pin_hash && row.pin_salt);
  var h = hashPin(pinPepper_(), real ? row.pin_salt : DUMMY_SALT_, String(pin), pinDigest_);
  var ok = constantTimeEqual(h, real ? String(row.pin_hash).trim().toLowerCase() : DUMMY_HASH_);
  return real && /^\d{6}$/.test(String(pin)) && ok;
}

// ---------------------------------------------------------------- failure counter and locks

function failKey_(code) {
  var c = normCode(code);
  return 'lf:' + (isValidCode(c) ? c : 'h' + hashString(c));
}

/** {f: wrong PINs since the last lock, h: lock start times (ms), u: locked until ms (-1 = until an admin clears it)} */
function failState_(code) {
  try {
    var v = CacheService.getScriptCache().get(failKey_(code));
    var st = v ? JSON.parse(v) : null;
    if (st && typeof st === 'object') return { f: toInt(st.f, 0), h: Array.isArray(st.h) ? st.h : [], u: toNum(st.u, 0) };
  } catch (e) { /* treat as empty */ }
  return { f: 0, h: [], u: 0 };
}

function putFailState_(code, st) {
  try { CacheService.getScriptCache().put(failKey_(code), JSON.stringify(st), FAIL_TTL_S_); } catch (e) { /* best effort */ }
}

function clearFailState_(code) {
  try { CacheService.getScriptCache().remove(failKey_(code)); } catch (e) { /* best effort */ }
}

/** Current lock from the cache, and for a real person also from Roster. → {locked, until: ms | -1} */
function currentLock_(st, row) {
  var now = nowMs_();
  if (st.u === -1) return { locked: true, until: -1 };
  if (st.u > now) return { locked: true, until: st.u };
  if (row) {
    var t = parseTime(row.locked_until);
    if (!isNaN(t) && t >= parseTime(HARD_LOCK_ISO)) return { locked: true, until: -1 };
    if (!isNaN(t) && t > now) return { locked: true, until: t };
  }
  return { locked: false, until: 0 };
}

function lockedError_(until) {
  return until === -1
    ? apiError_('locked', 'Too many wrong PINs. Please ask HR to unlock your code.', { until: null })
    : apiError_('locked', 'Too many wrong PINs. Try again later.', { until: iso7(until) });
}

/**
 * One wrong PIN for `code`. row is the Roster row of a real, active person or null. Throws
 * auth_failed, or locked on the failure that reaches lock_failures. A Sheet write happens only
 * when a real person gets locked (Roster only; never the Log, never the script lock).
 */
function recordFailure_(code, row, st) {
  var cfg = config_(), now = nowMs_();
  st.f = toInt(st.f, 0) + 1;
  if (st.f < cfg.lock_failures) {
    putFailState_(code, st);
    throw apiError_('auth_failed', AUTH_FAILED_MSG_);
  }
  var past = (st.h || []).slice();
  if (row) String(row.lock_history || '').split(';').forEach(function (x) { if (x.trim()) past.push(parseTime(x.trim())); });
  var nl = nextLock(past, now);
  putFailState_(code, { f: 0, h: nl.history, u: nl.hard ? -1 : nl.locked_until });
  if (row) {
    updateRow_('Roster', row._row, {
      locked_until: nl.hard ? HARD_LOCK_ISO : iso7(nl.locked_until), lock_count: nl.count,
      lock_history: nl.history.map(iso7).join(';'), failed_logins: 0
    });
    // no Log row (anonymous request): Roster.lock_history is the record
  }
  throw lockedError_(nl.hard ? -1 : nl.locked_until);
}

/** Admin: lifts every lock on a code (Roster and cache). Also used by Reset a PIN. */
function clearLockFields_() { return { failed_logins: 0, locked_until: '', lock_count: 0, lock_history: '' }; }

// ---------------------------------------------------------------- tokens and sessions

function issueToken_(user) {
  var exp = nowMs_() + config_().session_hours * 3600000;
  return { token: signToken({ c: user.code, e: exp, v: user.session_ver }, tokenHmac_), expires_at: iso7(exp) };
}

/**
 * Checks the token and the Roster row (active, session_ver). Then, unless the action allows it:
 * pin_change_required while the issued PIN is unchanged (F3), and consent_required while the
 * privacy notice is not accepted (F18).
 * opts.pinOk: allowed before the PIN change (me, change_pin, logout).
 * opts.consentOk: allowed before consent (me, change_pin, logout, consent, set_lang).
 */
function requireSession_(body, opts) {
  opts = opts === true ? { pinOk: true, consentOk: true } : (opts || {});
  var v = verifyToken(body && body.token, nowMs_(), tokenHmac_);
  if (!v.ok) throw apiError_('session_expired', 'Please sign in again.');
  var row = findRosterRow_(v.payload.c);
  if (!row || !toBool(row.active) || toInt(row.session_ver, 0) !== toInt(v.payload.v, -1)) {
    throw apiError_('session_expired', 'Please sign in again.');
  }
  var user = userView_(row);
  setLoggable_();
  setLogInfo_(user.code, null);
  if (!opts.pinOk && user.must_change_pin) throw apiError_('pin_change_required', 'Please choose a new PIN first.');
  if (!opts.consentOk && !user.consent_at) throw apiError_('consent_required', 'Please read and accept the privacy notice first.');
  return { code: user.code, row: row, user: user };
}

function profile_(user) {
  return {
    code: user.code,
    first_name: user.first_name,
    role_area: user.role_area,
    is_manager: user.is_manager,
    roles: user.roles,
    lang: user.lang,
    must_change_pin: user.must_change_pin,
    consent_needed: !user.consent_at,
    certificate: user.certificate
  };
}

// ---------------------------------------------------------------- actions

/**
 * login {code, pin} → {token, expires_at, profile}. No script lock: the failure counter lives
 * in CacheService; unknown, inactive and PIN-less codes take exactly the same path.
 */
function apiLogin_(body) {
  var code = normCode(body.code).slice(0, 64);
  var pin = body.pin === null || body.pin === undefined ? '' : String(body.pin).trim().slice(0, 32);
  var found = isValidCode(code) ? findRosterRow_(code) : null;
  var row = found && toBool(found.active) && found.pin_hash ? found : null;
  var st = failState_(code);
  var lock = currentLock_(st, row);
  if (lock.locked) throw lockedError_(lock.until);
  if (!pinMatches_(row, pin)) recordFailure_(code, row, st);
  if (st.f || st.u) putFailState_(code, { f: 0, h: st.h || [], u: 0 });
  var user = userView_(row);
  setLoggable_();
  setLogInfo_(user.code, null);
  var t = issueToken_(user);
  return { token: t.token, expires_at: t.expires_at, profile: profile_(user) };
}

/** change_pin {token, old_pin, new_pin} → {token, expires_at, profile}; bumps session_ver. */
function apiChangePin_(body) {
  var s = requireSession_(body, { pinOk: true, consentOk: true });
  var oldPin = body.old_pin === null || body.old_pin === undefined ? '' : String(body.old_pin).trim();
  var newPin = body.new_pin === null || body.new_pin === undefined ? '' : String(body.new_pin).trim();
  return withLock_(function () {
    var row = findRosterRow_(s.code);
    if (!row || toInt(row.session_ver, 0) !== s.user.session_ver) throw apiError_('session_expired', 'Please sign in again.');
    var st = failState_(s.code);
    var lock = currentLock_(st, row);
    if (lock.locked) throw lockedError_(lock.until);
    if (!pinMatches_(row, oldPin)) recordFailure_(s.code, row, st);
    var problem = pinProblem(newPin, oldPin);
    if (problem) throw apiError_('pin_weak', problem);
    var rec = makePinRecord_(newPin);
    var ver = toInt(row.session_ver, 0) + 1;
    updateRow_('Roster', row._row, {
      pin_hash: rec.pin_hash, pin_salt: rec.pin_salt, must_change_pin: 'FALSE',
      session_ver: ver, failed_logins: 0
    });
    if (st.f) putFailState_(s.code, { f: 0, h: st.h || [], u: 0 });
    var user = userView_(findRosterRow_(s.code));
    var t = issueToken_(user);
    return { token: t.token, expires_at: t.expires_at, profile: profile_(user) };
  });
}

/** logout {token} → {}: bumps session_ver, which signs out every device. */
function apiLogout_(body) {
  var s = requireSession_(body, { pinOk: true, consentOk: true });
  updateRow_('Roster', s.row._row, { session_ver: s.user.session_ver + 1 });
  return {};
}

/** consent {token} → {consent_at} (F18). Writes only the caller's own cell. */
function apiConsent_(body) {
  var s = requireSession_(body, { consentOk: true });
  var at = s.row.consent_at;
  if (!at) {
    at = iso7(nowMs_());
    updateRow_('Roster', s.row._row, { consent_at: at });
  }
  return { consent_at: at };
}

/** set_lang {token, lang} → {lang} */
function apiSetLang_(body) {
  var s = requireSession_(body, { consentOk: true });
  var lang = String(body.lang || '').trim().toLowerCase();
  if (lang !== 'en' && lang !== 'vi') throw apiError_('bad_request', 'lang must be en or vi');
  if (s.user.lang !== lang || String(s.row.lang || '') !== lang) updateRow_('Roster', s.row._row, { lang: lang });
  return { lang: lang };
}
