/**
 * Code.gs · web app entry points. Every response is JSON with server_now (F7, F16):
 *   {ok:true, server_now, ...data} | {ok:false, server_now, error:{code, message, ...extra}}
 * The client posts JSON as text/plain (no CORS preflight); nothing here ever returns HTML.
 */

var BACKEND_VERSION = '1.0.0';
var MAX_BODY_BYTES_ = 200000;

/** Actions that get one Log row (never with PINs, answers or tokens). */
var LOGGED_ACTIONS_ = {
  login: true, change_pin: true, consent: true, start: true, submit: true,
  capstone_submit: true, panel_score: true
};

function routes_() {
  return {
    login: apiLogin_,
    change_pin: apiChangePin_,
    consent: apiConsent_,
    set_lang: apiSetLang_,
    me: apiMe_,
    watch: apiWatch_,
    start: apiStart_,
    save: apiSave_,
    submit: apiSubmit_,
    review: apiReview_,
    team_summary: apiTeamSummary_,
    team_status: apiTeamStatus_,
    capstone_get: apiCapstoneGet_,
    capstone_submit: apiCapstoneSubmit_,
    panel_list: apiPanelList_,
    panel_score: apiPanelScore_
  };
}

function doPost(e) {
  var out;
  resetRequest_();
  var action = '';
  try {
    var body = parseBody_(e);
    action = typeof body.action === 'string' ? body.action : '';
    var handler = Object.prototype.hasOwnProperty.call(routes_(), action) ? routes_()[action] : null;
    if (!handler) throw apiError_('bad_request', 'Unknown action');
    if (LOGGED_ACTIONS_[action]) setLogAction_(action);
    var data = handler(body) || {};
    out = okBody_(data);
    writeLogNow_({ ok: true, code: '' });
  } catch (err) {
    out = errorBody_(err);
    writeLogNow_({ ok: false, code: out.error.code });
  }
  return jsonOut_(out);
}

/** Health check only: no data, no HTML. */
function doGet(e) {
  resetRequest_();
  return jsonOut_({ ok: true, server_now: iso7(nowMs_()), service: 'the-1pct-planner-hub', version: BACKEND_VERSION });
}

function parseBody_(e) {
  var raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  if (!raw) throw apiError_('bad_request', 'Empty request');
  if (raw.length > MAX_BODY_BYTES_) throw apiError_('bad_request', 'Request too large');
  var body;
  try { body = JSON.parse(raw); } catch (x) { throw apiError_('bad_request', 'Request is not JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError_('bad_request', 'Request is not a JSON object');
  return body;
}

function okBody_(data) {
  var out = { ok: true, server_now: iso7(nowMs_()) };
  Object.keys(data).forEach(function (k) { if (k !== 'ok' && k !== 'server_now') out[k] = data[k]; });
  return out;
}

function errorBody_(err) {
  var code = err && err.apiCode ? err.apiCode : 'server_error';
  var error = { code: code, message: err && err.apiCode ? String(err.message || code) : 'Something went wrong on the server. Please try again.' };
  if (err && err.extra) Object.keys(err.extra).forEach(function (k) { if (k !== 'code' && k !== 'message') error[k] = err.extra[k]; });
  if (!err || !err.apiCode) {
    try { console.error('server_error: ' + scrubLog_(err && err.stack ? err.stack : err)); } catch (x) { /* ignore */ }
    setLogInfo_(null, err && err.name ? err.name : 'Error');
  }
  return { ok: false, server_now: iso7(nowMs_()), error: error };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
