/**
 * Auth.gs · login, PIN change, consent, language, stateless signed tokens (F1),
 * peppered PIN hashes and escalating locks (F2), server-side must_change_pin (F3).
 */

var AUTH_FAILED_MSG_ = 'Employee code or PIN is not correct.';

// ---------------------------------------------------------------- secrets (Script Properties)

function tokenSecret_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('TOKEN_SECRET');
  if (!s) {
    s = randomSecret_();
    p.setProperty('TOKEN_SECRET', s);
  }
  return s;
}

function pinPepper_() {
  var s = PropertiesService.getScriptProperties().getProperty('PIN_PEPPER');
  if (!s) throw new Error('PIN_PEPPER is missing: run setupSheet once from the editor');
  return s;
}

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

function pinMatches_(row, pin) {
  if (!/^\d{6}$/.test(String(pin)) || !row.pin_hash || !row.pin_salt) return false;
  return constantTimeEqual(hashPin(pinPepper_(), row.pin_salt, pin, pinDigest_), String(row.pin_hash).trim().toLowerCase());
}

// ---------------------------------------------------------------- tokens

function issueToken_(user) {
  var exp = nowMs_() + config_().session_hours * 3600000;
  return { token: signToken({ c: user.code, e: exp, v: user.session_ver }, tokenHmac_), expires_at: iso7(exp) };
}

/**
 * Checks the token and the Roster row (active, session_ver). Unless allowMustChange,
 * a learner who still has to change the issued PIN gets pin_change_required (F3).
 */
function requireSession_(body, allowMustChange) {
  var v = verifyToken(body && body.token, nowMs_(), tokenHmac_);
  if (!v.ok) throw apiError_('session_expired', 'Please sign in again.');
  var row = findRosterRow_(v.payload.c);
  if (!row || !toBool(row.active) || toInt(row.session_ver, 0) !== toInt(v.payload.v, -1)) {
    throw apiError_('session_expired', 'Please sign in again.');
  }
  var user = userView_(row);
  setLogInfo_(user.code, null);
  if (!allowMustChange && user.must_change_pin) throw apiError_('pin_change_required', 'Please choose a new PIN first.');
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

// ---------------------------------------------------------------- failures and locks

/** Records one wrong PIN (lock already held); throws auth_failed or locked. */
function recordFailure_(row) {
  assertLocked_();
  var cfg = config_(), now = nowMs_();
  var fails = toInt(row.failed_logins, 0) + 1;
  if (fails >= cfg.lock_failures) {
    var st = nextLockState(toInt(row.lock_count, 0), parseTime(row.locked_until), now);
    updateRow_('Roster', row._row, { failed_logins: 0, locked_until: iso7(st.locked_until), lock_count: st.lock_count });
    setLogInfo_(null, 'lock ' + st.lock_count);
    throw apiError_('locked', 'Too many wrong PINs. Try again later.', { until: iso7(st.locked_until) });
  }
  updateRow_('Roster', row._row, { failed_logins: fails });
  throw apiError_('auth_failed', AUTH_FAILED_MSG_);
}

function throwIfLocked_(row) {
  var until = parseTime(row.locked_until);
  if (!isNaN(until) && nowMs_() < until) {
    throw apiError_('locked', 'Too many wrong PINs. Try again later.', { until: iso7(until) });
  }
}

// ---------------------------------------------------------------- actions

/** login {code, pin} → {token, expires_at, profile} */
function apiLogin_(body) {
  var code = normCode(body.code);
  var pin = body.pin === null || body.pin === undefined ? '' : String(body.pin).trim();
  return withLock_(function () {
    var row = isValidCode(code) ? findRosterRow_(code) : null;
    if (!row || !toBool(row.active) || !row.pin_hash) {
      hashPin('x', 'y', pin, pinDigest_); // same work as a real check (no timing hint)
      throw apiError_('auth_failed', AUTH_FAILED_MSG_);
    }
    setLogInfo_(normCode(row.employee_code), null);
    throwIfLocked_(row);
    if (!pinMatches_(row, pin)) recordFailure_(row);
    if (toInt(row.failed_logins, 0) !== 0) updateRow_('Roster', row._row, { failed_logins: 0 });
    var user = userView_(row);
    var t = issueToken_(user);
    return { token: t.token, expires_at: t.expires_at, profile: profile_(user) };
  });
}

/** change_pin {token, old_pin, new_pin} → {token, expires_at, profile}; bumps session_ver. */
function apiChangePin_(body) {
  var s = requireSession_(body, true);
  var oldPin = body.old_pin === null || body.old_pin === undefined ? '' : String(body.old_pin).trim();
  var newPin = body.new_pin === null || body.new_pin === undefined ? '' : String(body.new_pin).trim();
  return withLock_(function () {
    var row = findRosterRow_(s.code);
    if (!row || toInt(row.session_ver, 0) !== s.user.session_ver) throw apiError_('session_expired', 'Please sign in again.');
    throwIfLocked_(row);
    if (!pinMatches_(row, oldPin)) recordFailure_(row);
    var problem = pinProblem(newPin, oldPin);
    if (problem) throw apiError_('pin_weak', problem);
    var rec = makePinRecord_(newPin);
    var ver = toInt(row.session_ver, 0) + 1;
    updateRow_('Roster', row._row, {
      pin_hash: rec.pin_hash, pin_salt: rec.pin_salt, must_change_pin: 'FALSE',
      session_ver: ver, failed_logins: 0
    });
    var user = userView_(findRosterRow_(s.code));
    var t = issueToken_(user);
    return { token: t.token, expires_at: t.expires_at, profile: profile_(user) };
  });
}

/** consent {token} → {consent_at} (F18). Writes only the caller's own cell. */
function apiConsent_(body) {
  var s = requireSession_(body);
  var at = s.row.consent_at;
  if (!at) {
    at = iso7(nowMs_());
    updateRow_('Roster', s.row._row, { consent_at: at });
  }
  return { consent_at: at };
}

/** set_lang {token, lang} → {lang} */
function apiSetLang_(body) {
  var s = requireSession_(body);
  var lang = String(body.lang || '').trim().toLowerCase();
  if (lang !== 'en' && lang !== 'vi') throw apiError_('bad_request', 'lang must be en or vi');
  if (s.user.lang !== lang || String(s.row.lang || '') !== lang) updateRow_('Roster', s.row._row, { lang: lang });
  return { lang: lang };
}
