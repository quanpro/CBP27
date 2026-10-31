/**
 * Admin.gs · the "1% Planner" menu inside the private Sheet (specs/16). There is no admin
 * web page: Quân and HR L&D work here. Every write runs under the script lock; PINs are
 * shown once in a dialog and only their salted, peppered hashes are stored.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('1% Planner')
    .addItem('Set up / repair tabs', 'setupSheet')
    .addItem('Import items from CSV…', 'menuImportCsv')
    .addItem('Validate items / courses', 'menuValidate')
    .addItem('Seed episodes', 'menuSeedEpisodes')
    .addItem('Refresh cache (after editing Items, Courses or Config)', 'menuRefreshCache')
    .addSeparator()
    .addItem('Issue PINs for new roster rows', 'menuIssuePins')
    .addItem('Reset a PIN…', 'menuResetPin')
    .addItem('Clear a lock…', 'menuClearLock')
    .addItem('Unlock a retake…', 'menuUnlock')
    .addItem('Void an attempt…', 'menuVoidAttempt')
    .addSeparator()
    .addItem('Rebuild summaries', 'menuRebuildSummaries')
    .addItem('Install hourly summary trigger', 'menuInstallTrigger')
    .addItem('Course gate report', 'menuGateReport')
    .addItem('IDP export', 'menuIdpExport')
    .addItem('Recall due list', 'menuRecallDue')
    .addItem('Panel results', 'menuPanelResults')
    .addSeparator()
    .addItem('Baseline: open or close parts…', 'menuBaselineSwitches')
    .addItem('Assign a Part 1 form…', 'menuAssignP1Form')
    .addItem('Build baseline profiles', 'menuBuildProfiles')
    .addItem('Baseline v2 reports', 'menuBaselineReports')
    .addToUi();
}

// ---------------------------------------------------------------- UI helpers

function ui_() { return SpreadsheetApp.getUi(); }

function ask_(title, prompt) {
  var ui = ui_();
  var r = ui.prompt(title, prompt, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  return String(r.getResponseText() || '').trim();
}

function showHtml_(title, html, height) {
  var out = HtmlService.createHtmlOutput('<div style="font:14px/1.45 Arial,sans-serif;color:#051C2C">' + html + '</div>')
    .setWidth(640).setHeight(height || 420);
  ui_().showModalDialog(out, title);
}

function listHtml_(title, lines) {
  if (!lines.length) return '';
  return '<h3 style="margin:12px 0 4px">' + escapeHtml(title) + '</h3><ul style="margin:0;padding-left:18px">' +
    lines.map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join('') + '</ul>';
}

function adminRun_(action, fn) {
  resetRequest_();
  setLogAction_(action);
  setLoggable_();
  return withLock_(fn);
}

// ---------------------------------------------------------------- import and validate

function menuImportCsv() {
  var html = '<p>Paste the whole CSV file (with its header row), choose the tab and press Import. ' +
    '<b>Items</b>, <b>Cases</b>, <b>BaselineItems</b>, <b>Exhibits</b> and <b>BaselineText</b> are replaced; <b>Courses</b> rows are updated by code and keep your dates and Blink links.</p>' +
    '<select id="tab"><option>Items</option><option>Courses</option><option>Cases</option><option>BaselineItems</option><option>Exhibits</option><option>BaselineText</option></select> ' +
    '<button onclick="go()">Import</button><br><textarea id="csv" style="width:100%;height:230px;margin-top:8px"></textarea>' +
    '<pre id="out" style="white-space:pre-wrap"></pre>' +
    '<script>function go(){document.getElementById("out").textContent="Importing…";' +
    'google.script.run.withSuccessHandler(function(r){document.getElementById("out").textContent=r;})' +
    '.withFailureHandler(function(e){document.getElementById("out").textContent="Error: "+e.message;})' +
    '.adminImportCsv(document.getElementById("tab").value,document.getElementById("csv").value);}</script>';
  showHtml_('Import items from CSV', html, 480);
}

/** Called from the import dialog. Returns a plain-text report. */
function adminImportCsv(tab, csvText) {
  var keyCol = { Items: 'item_id', Courses: 'code', Cases: 'case_id', BaselineItems: 'item_id', Exhibits: 'exhibit_id', BaselineText: 'key' }[tab];
  if (!keyCol) throw new Error('Choose Items, Courses, Cases, BaselineItems, Exhibits or BaselineText');
  var rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one data row');
  var headers = rows[0].map(headerKey_);
  if (headers.indexOf(keyCol) < 0) throw new Error('The header row has no ' + keyCol + ' column: is this ' + tab + '.csv?');
  var report = [];
  adminRun_('admin_import', function () {
    var ss = ss_();
    ensureTab_(ss, tab, SCHEMA[tab], report);
    var data = rows.slice(1).map(function (r) {
      var o = {};
      headers.forEach(function (h, i) { if (h) o[h] = r[i] === undefined ? '' : String(r[i]); });
      return o;
    });
    var known = headersOf_(tab);
    var extra = headers.filter(function (h) { return h && known.indexOf(h) < 0; });
    if (extra.length) ensureTabColumns_(tab, extra, report);
    if (tab === 'Courses') {
      var t = readTable_('Courses'), byCode = {};
      t.rows.forEach(function (r) { byCode[normCode(r.code)] = r; });
      var add = [];
      data.forEach(function (o) {
        o.code = normCode(o.code);
        if (!o.code) return;
        if (byCode[o.code]) updateRow_('Courses', byCode[o.code]._row, o); else add.push(o);
      });
      if (add.length) appendRows_('Courses', add);
      seedCourses_(report);
    } else {
      var sh = sheet_(tab);
      var last = sh.getLastRow();
      if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
      invalidate_(tab);
      appendRows_(tab, data);
    }
    setLogInfo_('', tab + ' ' + data.length + ' rows');
    report.push(tab + ': imported ' + data.length + ' row(s).');
    clearCaches_();
  });
  var v = validateNow_();
  return report.concat(v.summary).join('\n');
}

function ensureTabColumns_(tab, cols, report) {
  var sh = sheet_(tab);
  var lastCol = sh.getLastColumn();
  if (lastCol + cols.length > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), lastCol + cols.length - sh.getMaxColumns());
  sh.getRange(1, lastCol + 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  sh.getRange(1, lastCol + 1, 1, cols.length).setValues([cols]);
  invalidate_(tab);
  report.push(tab + ': kept extra column(s) ' + cols.join(', ') + '.');
}

/** Repairs Items/Courses/Cases and the baseline tabs (columns, plain text, default dates) and validates both banks. */
function validateNow_() {
  var report = [];
  adminRun_('', function () {
    var ss = ss_();
    ['Items', 'Courses', 'Cases', 'BaselineItems', 'Exhibits', 'BaselineText'].forEach(function (n) { ensureTab_(ss, n, SCHEMA[n], report); normaliseTab_(n, report); });
    seedCourses_(report);
    clearCaches_();
  });
  resetRequest_();
  var res = validateBank(readTable_('Items').rows, readTable_('Courses').rows, readTable_('Cases').rows);
  var cfg = config_();
  var bl = validateBaselineBank(readTable_('BaselineItems').rows, readTable_('Exhibits').rows, { live: cfg.p1_live, backup: cfg.p1_backup });
  res = { errors: res.errors.concat(bl.errors), warnings: res.warnings.concat(bl.warnings) };
  var summary = [
    (res.errors.length ? '✖ ' + res.errors.length + ' problem(s) to fix' : '✔ No problems') +
      (res.warnings.length ? ', ' + res.warnings.length + ' warning(s)' : '') + '.'
  ];
  res.errors.slice(0, 60).forEach(function (e) { summary.push('Problem: ' + e); });
  res.warnings.slice(0, 60).forEach(function (w) { summary.push('Warning: ' + w); });
  return { errors: res.errors, warnings: res.warnings, repairs: report, summary: summary };
}

function menuValidate() {
  var v = validateNow_();
  var html = '<p><b>' + escapeHtml(v.summary[0]) + '</b></p>' + listHtml_('Repairs', v.repairs) +
    listHtml_('Problems (fix in the Items / Courses / Cases / BaselineItems / Exhibits tab)', v.errors.slice(0, 100)) +
    listHtml_('Warnings (counts against the blueprint)', v.warnings.slice(0, 100));
  showHtml_('Validate items / courses', html, 480);
}

function menuSeedEpisodes() {
  var report = [];
  adminRun_('', function () { ensureTab_(ss_(), 'Episodes', SCHEMA.Episodes, report); seedEpisodes_(report); clearCaches_(); });
  notify_('Seed episodes', report.length ? report.join('\n') : 'Every episode row already exists.');
}

function menuRefreshCache() {
  resetRequest_();
  clearCaches_();
  notify_('Cache', 'Done: the Hub reads Items, Courses, Config, Episodes and the baseline tabs fresh from the Sheet now.');
}

// ---------------------------------------------------------------- PINs

/** PINs for active roster rows without a hash. Returns [{code, name, pin}] (shown once). */
function issuePins_() {
  var issued = [];
  adminRun_('admin_issue_pins', function () {
    rosterRows_().forEach(function (r) {
      var code = normCode(r.employee_code);
      if (!code || String(r.pin_hash || '').trim() || !toBool(r.active)) return;
      if (!isValidCode(code)) return;
      var pin = randomPin_();
      var rec = makePinRecord_(pin);
      updateRow_('Roster', r._row, Object.assign({
        employee_code: code, pin_hash: rec.pin_hash, pin_salt: rec.pin_salt, must_change_pin: 'TRUE',
        session_ver: toInt(r.session_ver, 0) + 1
      }, clearLockFields_()));
      clearFailState_(code);
      issued.push({ code: code, name: r.display_name || '', pin: pin });
    });
    setLogInfo_('', issued.length + ' issued');
  });
  return issued;
}

function pinTableHtml_(rows) {
  return '<p><b>Shown once.</b> Copy these onto the PIN cards now; the Sheet keeps only a hash. ' +
    'Each person must choose a new PIN at first login.</p><table style="border-collapse:collapse">' +
    '<tr><th align="left">Code</th><th align="left">Name</th><th align="left">PIN</th></tr>' +
    rows.map(function (r) {
      return '<tr><td style="padding:2px 12px 2px 0">' + escapeHtml(r.code) + '</td><td style="padding:2px 12px 2px 0">' +
        escapeHtml(r.name) + '</td><td style="font:16px monospace">' + escapeHtml(r.pin) + '</td></tr>';
    }).join('') + '</table>';
}

function menuIssuePins() {
  var issued = issuePins_();
  if (!issued.length) { notify_('Issue PINs', 'No active roster rows without a PIN (or the code is not 3–20 letters/digits).'); return; }
  showHtml_('New PINs (' + issued.length + ')', pinTableHtml_(issued), 480);
}

/** New PIN for one code: must_change_pin TRUE, lock cleared, every session signed out. */
function resetPin_(code) {
  var c = normCode(code), out = null;
  adminRun_('admin_reset_pin', function () {
    var r = findRosterRow_(c);
    if (!r) throw new Error('No roster row for ' + c);
    var pin = randomPin_();
    var rec = makePinRecord_(pin);
    updateRow_('Roster', r._row, Object.assign({
      pin_hash: rec.pin_hash, pin_salt: rec.pin_salt, must_change_pin: 'TRUE', session_ver: toInt(r.session_ver, 0) + 1
    }, clearLockFields_()));
    clearFailState_(c);
    setLogInfo_(c, 'reset');
    out = { code: c, name: r.display_name || '', pin: pin };
  });
  return out;
}

/** Lifts every lock on a code (including the 3-locks-in-7-days lock); the PIN stays the same. */
function clearLock_(code) {
  var c = normCode(code);
  adminRun_('admin_clear_lock', function () {
    var r = findRosterRow_(c);
    if (!r) throw new Error('No roster row for ' + c);
    updateRow_('Roster', r._row, clearLockFields_());
    clearFailState_(c);
    setLogInfo_(c, 'lock cleared');
  });
  return true;
}

function menuClearLock() {
  var code = ask_('Clear a lock', 'Employee code (the PIN stays the same; use Reset a PIN… if it is forgotten):');
  if (!code) return;
  try { clearLock_(code); notify_('Clear a lock', 'Done: ' + normCode(code) + ' can sign in again.'); } catch (e) { notify_('Clear a lock', e.message); }
}

function menuResetPin() {
  var code = ask_('Reset a PIN', 'Employee code:');
  if (!code) return;
  try { showHtml_('New PIN', pinTableHtml_([resetPin_(code)]), 260); } catch (e) { notify_('Reset a PIN', e.message); }
}

// ---------------------------------------------------------------- unlock and void

function unlockRetake_(code, course, unlockedBy, reason) {
  var c = normCode(code), k = normCode(course);
  adminRun_('admin_unlock', function () {
    if (!findRosterRow_(c)) throw new Error('No roster row for ' + c);
    if (!courseByCode_(k)) throw new Error('Unknown course ' + k);
    appendRows_('Unlocks', [{ employee_code: c, course: k, unlocked_by: guardCell(unlockedBy || 'admin'), unlocked_at: iso7(nowMs_()), reason: guardCell(reason || '') }]);
    setLogInfo_(c, k);
  });
  return true;
}

function menuUnlock() {
  var code = ask_('Unlock a retake (1/4)', 'Employee code:'); if (!code) return;
  var course = ask_('Unlock a retake (2/4)', 'Course code (e.g. A2):'); if (!course) return;
  var by = ask_('Unlock a retake (3/4)', 'Who held the 15-minute coaching chat? (manager code or initials)'); if (by === null) return;
  var reason = ask_('Unlock a retake (4/4)', 'Note (date of the chat, what was covered):'); if (reason === null) return;
  try {
    unlockRetake_(code, course, by, reason);
    notify_('Unlock a retake', 'Done: ' + normCode(code) + ' can take one more ' + normCode(course) + ' attempt (after the 24-hour wait).');
  } catch (e) { notify_('Unlock a retake', e.message); }
}

/**
 * Marks an attempt void: it no longer counts anywhere (attempt numbers, forms, gate,
 * summaries, once-per-part-per-wave baseline: the person can sit that part again). A voided
 * pass also voids its pending recall rows; a voided recall attempt makes that recall day
 * available again; a voided Part 2 clears its self-ratings in Ratings.
 */
function voidAttempt_(attemptId, reason) {
  var id = String(attemptId || '').trim();
  var info = null;
  adminRun_('admin_void', function () {
    var att = findAttemptById_(id);
    if (!att) throw new Error('No attempt ' + id + ' (or it is already void)');
    updateRow_('Attempts', att._row, { status: 'void' });
    if (att.assessment === 'checkpoint' && att.passed) {
      var stillPassed = userAttempts_(att.code).some(function (a) { return a.assessment === 'checkpoint' && a.course === att.course && a.passed; });
      if (!stillPassed) {
        recallRowsFor_(att.code, att.course).forEach(function (r) {
          if (String(r.status).trim().toLowerCase() !== 'done') updateRow_('Recall', r._row, { status: 'void' });
        });
      }
    }
    if (att.assessment === 'baseline_p2') {
      readTable_('Ratings').rows.forEach(function (r) {
        if (normWave(r.wave) === att.wave && normCode(r.ratee_code) === att.code && normCode(r.rater_code) === att.code &&
          String(r.rater_role).trim().toLowerCase() === 'self' && String(r.value).trim() !== '') updateRow_('Ratings', r._row, { value: '' });
      });
    }
    if (att.assessment === 'recall') {
      var rr = recallRowForAttempt_(att);
      if (rr) updateRow_('Recall', rr._row, { status: 'due', score_pct: '', done_at: '', attempt_id: '' });
    }
    setLogInfo_(att.code, id + ' ' + String(reason || '').slice(0, 80));
    info = { code: att.code, assessment: att.assessment, course: att.course };
  });
  return info;
}

function menuVoidAttempt() {
  var id = ask_('Void an attempt (1/2)', 'attempt_id (column A of Attempts):'); if (!id) return;
  var reason = ask_('Void an attempt (2/2)', 'Reason (e.g. pilot, technical problem):'); if (reason === null) return;
  try {
    var r = voidAttempt_(id, reason);
    notify_('Void an attempt', 'Done: ' + r.assessment + ' ' + (r.course || '') + ' for ' + r.code + ' no longer counts.');
  } catch (e) { notify_('Void an attempt', e.message); }
}

// ---------------------------------------------------------------- summaries and trigger

/** Rebuilds the Summary tab (team-view rules). Also the hourly trigger's handler: while results_open it also builds the baseline profiles. */
function buildSummary() {
  resetRequest_();
  var n = 0;
  withLock_(function () {
    if (config_().results_open) buildProfilesLocked_();
    var rows = buildSummaryRows_();
    replaceBody_('Summary', SCHEMA.Summary, rows);
    n = rows.length;
  });
  return n;
}

function menuRebuildSummaries() {
  var n = buildSummary();
  notify_('Rebuild summaries', 'Summary rebuilt: ' + n + ' row(s). Groups under the minimum size, managers and test users are left out.');
}

function installSummaryTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'buildSummary') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildSummary').timeBased().everyHours(1).create();
  return true;
}

function menuInstallTrigger() {
  installSummaryTrigger_();
  notify_('Hourly summary', 'Installed: the Summary tab is rebuilt every hour (and the baseline profiles while Results are open).');
}

// ---------------------------------------------------------------- dashboards

function writeDash_(name, header, rows, backgrounds) {
  var ss = ss_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  var width = header.length;
  var all = [header].concat(rows.map(function (r) {
    var row = r.slice(0, width);
    while (row.length < width) row.push('');
    return row.map(toCell_);
  }));
  if (all.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), all.length - sh.getMaxRows());
  if (width > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  var range = sh.getRange(1, 1, all.length, width);
  range.setNumberFormat('@');
  range.setValues(all);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (backgrounds && rows.length) sh.getRange(2, 1, rows.length, width).setBackgrounds(backgrounds);
  return sh;
}

function scoreColour_(pct) {
  if (typeof pct !== 'number') return '#ffffff';
  return pct >= 80 ? '#d9ead3' : pct >= 50 ? '#fff2cc' : '#f4cccc';
}

function adminPeople_() {
  return rosterRows_().map(userView_).filter(function (u) { return u.active && u.code && !u.is_test; });
}

/** Dash_Gate: per course pass status, first-try pass rate and the three most-missed items. */
function buildDashGate_() {
  var out = [];
  adminRun_('', function () {
    var people = adminPeople_().filter(function (u) { return u.roles.indexOf('learner') >= 0; });
    var codes = {};
    people.forEach(function (u) { codes[u.code] = u; });
    var atts = allAttempts_().filter(function (a) { return codes[a.code] && a.assessment === 'checkpoint' && isDone_(a); });
    var header = ['course', 'code', 'name', 'status', 'attempts', 'best_pct', 'passed_at', 'first_try_pass', 'most_missed'];
    courses_().forEach(function (c) {
      var mineAll = atts.filter(function (a) { return a.course === c.code; });
      var firstTry = 0, tried = 0, passed = 0;
      people.forEach(function (u) {
        var mine = mineAll.filter(function (a) { return a.code === u.code; });
        if (mine.length) { tried++; if (mine[0].passed) firstTry++; }
        var p = mine.filter(function (a) { return a.passed; })[0];
        if (p) passed++;
        var best = mine.reduce(function (m, a) { return Math.max(m, a.score_pct || 0); }, 0);
        out.push([c.code, u.code, u.display_name, p ? 'passed' : mine.length ? 'not yet' : 'not started', mine.length,
          mine.length ? best : '', p ? p.submitted_at : '', mine.length ? (mine[0].passed ? 'yes' : 'no') : '', '']);
      });
      // most-missed items for the forum's misconception slot
      var stats = {};
      var key = {};
      ['A', 'B'].forEach(function (f) { itemsFor_('checkpoint', c.code, f).forEach(function (it) { key[it.item_id] = it.answer; }); });
      mineAll.forEach(function (a) {
        a.served.forEach(function (id) {
          if (!key[id]) return;
          var s = stats[id] = stats[id] || { n: 0, k: 0, wrong: {} };
          s.n++;
          var y = gradedAnswers_(a)[id];
          if (y === key[id]) s.k++; else { var w = y || 'blank'; s.wrong[w] = (s.wrong[w] || 0) + 1; }
        });
      });
      var top = Object.keys(stats).sort(function (x, y) { return stats[x].k / stats[x].n - stats[y].k / stats[y].n || stats[y].n - stats[x].n; }).slice(0, 3)
        .map(function (id) {
          var s = stats[id];
          var common = Object.keys(s.wrong).sort(function (p, q) { return s.wrong[q] - s.wrong[p]; })[0] || '-';
          return id + ' (' + Math.round(100 * s.k / s.n) + '% right, common wrong: ' + common + ')';
        });
      out.push([c.code, 'TOTAL', people.length + ' learners', passed + ' passed', mineAll.length, '', '',
        tried ? Math.round(100 * firstTry / tried) + '%' : '', top.join(' · ')]);
    });
    writeDash_('Dash_Gate', header, out);
  });
  return out.length;
}

/** Dash_IDP: the two baseline gaps (specs/22 IDP areas), suggested goals and checkpoint status per person. */
function buildDashIdp_() {
  var out = [];
  adminRun_('', function () {
    var order = courseOrder_();
    var ctx = blProfileContext_();
    var atts = allAttempts_();
    var header = ['code', 'name', 'role_area', 'gap_1', 'gap_2', 'goal_1', 'goal_2', 'checkpoints_passed', 'checkpoint_status'];
    adminPeople_().forEach(function (u) {
      var mine = atts.filter(function (a) { return a.code === u.code; });
      var p = buildProfile_(u.code, ctx);
      var g = p ? p.gaps : [];
      var goal = function (x) { return x ? 'Raise ' + x.name_en + ' from ' + x.pct + '% by the Dec 2027 re-test (evidence: checkpoints passed, field sign-off, re-test score)' : ''; };
      var status = order.map(function (c) {
        var cp = mine.filter(function (a) { return a.assessment === 'checkpoint' && a.course === c && isDone_(a); });
        return c + ' ' + (cp.some(function (a) { return a.passed; }) ? '✓' : cp.length ? 'not yet' : '–');
      });
      var passedN = order.filter(function (c) { return mine.some(function (a) { return a.assessment === 'checkpoint' && a.course === c && a.passed; }); }).length;
      out.push([u.code, u.display_name, u.role_area, p ? (g[0] ? g[0].name_en + ' (' + g[0].pct + '%)' : '') : 'no baseline', g[1] ? g[1].name_en + ' (' + g[1].pct + '%)' : '',
        goal(g[0]), goal(g[1]), passedN + '/' + order.length, status.join(' · ')]);
    });
    writeDash_('Dash_IDP', header, out);
  });
  return out.length;
}

/** Dash_Recall: recall due this week (to Sunday) or overdue, for the Monday huddle. */
function buildDashRecall_() {
  var out = [];
  adminRun_('', function () {
    var now = nowMs_(), today = date7(now);
    var dow = (new Date(now + TZ_OFFSET_MS).getUTCDay() + 6) % 7;
    var sunday = addDays(today, 6 - dow);
    var people = {};
    adminPeople_().forEach(function (u) { people[u.code] = u; });
    readTable_('Recall').rows.forEach(function (r) {
      var code = normCode(r.employee_code), due = normDate(r.due_date);
      if (!people[code] || String(r.status).trim().toLowerCase() !== 'due' || !due || due > sunday) return;
      out.push([code, people[code].display_name, normCode(r.course), toInt(r.day, 0), due, due < today ? 'overdue' : 'this week']);
    });
    out.sort(function (a, b) { return a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0; });
    writeDash_('Dash_Recall', ['code', 'name', 'course', 'day', 'due_date', 'when'], out);
  });
  return out.length;
}

/** Dash_Panel: weighted team score per stage = mean of judges (F20). Admin only. */
function buildDashPanel_() {
  var out = [];
  adminRun_('', function () {
    var scores = readTable_('PanelScores').rows;
    ['pitch', 'capstone'].forEach(function (stage) {
      teams_().forEach(function (t) {
        var mine = scores.filter(function (r) { return String(r.team_id).trim() === t.team_id && String(r.stage).trim().toLowerCase() === stage; });
        if (!mine.length) return;
        var weighted = function (list) {
          var w = list.map(function (r) {
            return panelWeighted(stage, { c1: r.c1_problem, c2: r.c2_structure, c3: r.c3_result, c4: r.c4_value, c5: r.c5_communication });
          }).filter(function (x) { return x !== null; });
          return w.length ? Math.round(100 * w.reduce(function (s, x) { return s + x; }, 0) / w.length) / 100 : '';
        };
        var bySponsor = mine.filter(function (r) { return t.sponsor_code && normCode(r.judge_code) === t.sponsor_code; });
        var others = mine.filter(function (r) { return bySponsor.indexOf(r) < 0; });
        var avg = function (k) { return round1(mine.reduce(function (s, r) { return s + toNum(r[k], 0); }, 0) / mine.length); };
        var team = weighted(mine);
        out.push([stage, t.team_id, t.project_title, mine.length, avg('c1_problem'), avg('c2_structure'), avg('c3_result'), avg('c4_value'), avg('c5_communication'), team,
          bySponsor.length ? 'yes (' + t.sponsor_code + ')' : 'no', bySponsor.length ? weighted(others) : team]);
      });
    });
    writeDash_('Dash_Panel', ['stage', 'team_id', 'project_title', 'judges', 'c1', 'c2', 'c3', 'c4', 'c5', 'weighted_score', 'sponsor_scored', 'weighted_without_sponsor'], out);
  });
  return out.length;
}

function menuPanelResults() { var n = buildDashPanel_(); notify_('Panel results', 'Dash_Panel: ' + n + ' team score(s). Pitch Day weights communication double; the capstone weights result and value double.'); }

function menuGateReport() { buildDashGate_(); notify_('Course gate report', 'Dash_Gate is up to date.'); }
function menuIdpExport() { var n = buildDashIdp_(); notify_('IDP export', 'Dash_IDP: ' + n + ' person(s). Copy the goals into the HR system.'); }
function menuRecallDue() { var n = buildDashRecall_(); notify_('Recall due list', 'Dash_Recall: ' + n + ' recall(s) due this week or overdue.'); }

// ---------------------------------------------------------------- Baseline v2 (specs/22 §2)

var BL_SWITCHES_ = [
  ['p1_open', 'Part 1 · Problem solving with data'],
  ['p2_open', 'Part 2 · Leadership behaviours'],
  ['p3_open', 'Part 3 · Core planning'],
  ['rating_open', 'Manager rating'],
  ['results_open', 'Results (profiles and team averages)']
];

/** Current switches {p1_open: bool, …} read fresh from the Sheet. */
function adminGetBaselineSwitches() {
  resetRequest_();
  clearCaches_();
  var cfg = config_(), out = {};
  BL_SWITCHES_.forEach(function (x) { out[x[0]] = !!cfg[x[0]]; });
  return out;
}

/** Writes the given switches to Config (TRUE/FALSE), refreshes the cache, returns a plain-text report. */
function adminSetBaselineSwitches(values) {
  values = values || {};
  var changed = [];
  adminRun_('admin_baseline_switches', function () {
    var rows = readTable_('Config').rows, byKey = {};
    rows.forEach(function (r) { byKey[String(r.key || '').trim()] = r; });
    var add = [];
    BL_SWITCHES_.forEach(function (x) {
      if (!Object.prototype.hasOwnProperty.call(values, x[0])) return;
      var v = toBool(values[x[0]]) ? 'TRUE' : 'FALSE';
      var r = byKey[x[0]];
      if (r) { if (String(r.value).trim().toUpperCase() !== v) { updateRow_('Config', r._row, { value: v }); changed.push(x[1] + ': ' + (v === 'TRUE' ? 'open' : 'closed')); } }
      else { add.push({ key: x[0], value: v, note: x[1] }); changed.push(x[1] + ': ' + (v === 'TRUE' ? 'open' : 'closed')); }
    });
    if (add.length) appendRows_('Config', add);
    setLogInfo_('', changed.join('; ').slice(0, 120));
    clearCaches_();
  });
  var now = adminGetBaselineSwitches();
  return (changed.length ? 'Saved: ' + changed.join(' · ') + '.' : 'Nothing changed.') + '\n' +
    BL_SWITCHES_.map(function (x) { return x[1] + ': ' + (now[x[0]] ? 'OPEN' : 'closed'); }).join('\n');
}

function menuBaselineSwitches() {
  var st = adminGetBaselineSwitches();
  var rows = BL_SWITCHES_.map(function (x) {
    return '<label style="display:block;margin:6px 0"><input type="checkbox" id="' + x[0] + '"' + (st[x[0]] ? ' checked' : '') + '> ' +
      escapeHtml(x[1]) + ' <span style="color:#666">(now ' + (st[x[0]] ? 'open' : 'closed') + ')</span></label>';
  }).join('');
  var ids = JSON.stringify(BL_SWITCHES_.map(function (x) { return x[0]; }));
  var html = '<p>Tick a part to open it for everyone at once; untick to close it. Closing stops new starts; a sitting in progress can still be finished until its own timer ends. ' +
    '<b>Results</b> shows each learner their profile and publishes the baseline team averages.</p>' + rows +
    '<button onclick="go()" style="margin-top:8px">Save</button><pre id="out" style="white-space:pre-wrap"></pre>' +
    '<script>function go(){var v={};' + ids + '.forEach(function(k){v[k]=document.getElementById(k).checked;});' +
    'document.getElementById("out").textContent="Saving…";google.script.run.withSuccessHandler(function(r){document.getElementById("out").textContent=r;})' +
    '.withFailureHandler(function(e){document.getElementById("out").textContent="Error: "+e.message;}).adminSetBaselineSwitches(v);}</script>';
  showHtml_('Baseline: open or close parts', html, 380);
}

/** Writes an Overrides row: the Part 1 form this person gets at their next start in this wave. */
function assignP1Form_(code, form, reason, by) {
  var c = normCode(code), f = String(form || '').trim().toUpperCase(), msg = '';
  if (BL_FORMS.indexOf(f) < 0) throw new Error('Form must be A, B or C');
  adminRun_('admin_assign_form', function () {
    var cfg = config_();
    if (!findRosterRow_(c)) throw new Error('No roster row for ' + c);
    appendRows_('Overrides', [{ employee_code: c, wave: cfg.wave, part: 1, form: f, reason: guardCell(String(reason || '').slice(0, 200)), by: guardCell(by || 'admin'), at: iso7(nowMs_()) }]);
    var cur = userAttempts_(c).filter(function (a) { return a.assessment === 'baseline_p1' && a.wave === cfg.wave; })[0];
    msg = 'Done: ' + c + ' gets Part 1 form ' + f + ' at their next start in wave ' + cfg.wave + '.' +
      (cur ? ' They already have a Part 1 attempt (' + cur.attempt_id + ', form ' + cur.form + ', ' + cur.status + '): void it first (Void an attempt…) so they can sit again.' : '');
    setLogInfo_(c, 'form ' + f);
  });
  return msg;
}

function menuAssignP1Form() {
  var code = ask_('Assign a Part 1 form (1/3)', 'Employee code:'); if (!code) return;
  var form = ask_('Assign a Part 1 form (2/3)', 'Form A, B or C (A is the backup form):'); if (!form) return;
  var reason = ask_('Assign a Part 1 form (3/3)', 'Reason (e.g. saw a live form, re-sit after a technical problem):'); if (reason === null) return;
  var by = '';
  try { by = Session.getActiveUser().getEmail(); } catch (e) { by = ''; }
  try { notify_('Assign a Part 1 form', assignP1Form_(code, form, reason, by || 'admin')); } catch (e) { notify_('Assign a Part 1 form', e.message); }
}

function menuBuildProfiles() {
  var n = buildProfiles();
  notify_('Build baseline profiles', 'Profiles: ' + n + ' person(s) for wave ' + config_().wave + '. Learners see theirs only while Results are open.');
}

function pctCell_(v) { return typeof v === 'number' ? v : ''; }

/** The five Baseline v2 dashboards (admin only, never on the Hub). Returns row counts. */
function buildBaselineReports_() {
  var counts = {};
  adminRun_('', function () {
    var cfg = config_();
    expireAllBl_();
    applyEquating_(cfg);
    var ctx = blProfileContext_();
    var people = adminPeople_();
    var peopleByCode = {};
    people.forEach(function (u) { peopleByCode[u.code] = u; });
    var profiles = {};
    people.forEach(function (u) { profiles[u.code] = buildProfile_(u.code, ctx); });

    // Dash_BL2_Heatmap: person × area
    var heatHeader = ['code', 'name', 'role_area', 'p1_form', 'p1_raw', 'p1_scaled', 'p1_A', 'p1_B', 'p2_sjt'];
    BL_CHARTERS.forEach(function (c) { heatHeader.push('charter_' + c + '_index'); });
    heatHeader.push('p3_module', 'p3_core', 'p3_module_pct', 'p3_level');
    var heat = [], heatBg = [];
    people.forEach(function (u) {
      var p = profiles[u.code];
      if (!p) return;
      var row = [u.code, u.display_name, u.role_area, p.p1 ? p.p1.form : '', p.p1 ? p.p1.raw_pct : '', p.p1 ? p.p1.scaled_pct : '',
        p.p1 ? pctCell_(p.p1.section_A_pct) : '', p.p1 ? pctCell_(p.p1.section_B_pct) : '', p.p2 ? pctCell_(p.p2.sjt_pct) : ''];
      BL_CHARTERS.forEach(function (c) { var x = p.p2 && p.p2.by_charter[c]; row.push(x && x.index !== null ? x.index : ''); });
      row.push(p.p3 ? p.p3.module : '', p.p3 ? pctCell_(p.p3.core_pct) : '', p.p3 ? pctCell_(p.p3.module_pct) : '', p.p3 ? p.p3.level || '' : '');
      heat.push(row);
      heatBg.push(row.map(function (v, i) { return i >= 4 && typeof v === 'number' ? scoreColour_(v) : '#ffffff'; }));
    });
    writeDash_('Dash_BL2_Heatmap', heatHeader, heat, heatBg);
    counts.heatmap = heat.length;

    // Dash_BL2_Items: p-value, point-biserial (item vs rest of the part), distractor %
    var itemsOut = [];
    var addStats = function (att, byId) {
      var served = blServed_(att, byId), g = gradedAnswers_(att);
      var total = 0, scores = {};
      served.forEach(function (id) {
        var it = byId[id], sc = 0;
        if (it.item_type === 'mcq') sc = g[id] === it.answer ? 1 : 0;
        else if (it.item_type === 'sjt') { var a = g[id] || {}; if (!(a.most && a.most === a.least)) sc = (a.most === it.answer_most ? 1 : 0) + (a.least === it.answer_least ? 1 : 0); }
        else return;
        scores[id] = sc;
        total += sc;
      });
      return { scores: scores, total: total, g: g, served: served };
    };
    var stat = {};
    BL_ASSESSMENTS.forEach(function (asmt) {
      Object.keys(ctx.byCode).forEach(function (code) {
        var att = ctx.byCode[code][asmt];
        if (!att || !peopleByCode[code]) return;
        var byId = indexItems_(blItemsForAttempt_(att));
        var r = addStats(att, byId);
        r.served.forEach(function (id) {
          var it = byId[id], s = stat[id] = stat[id] || { it: it, rows: [], least: [], ratings: [] };
          if (it.item_type === 'rating') { s.ratings.push(r.g[id]); return; }
          var pick = it.item_type === 'sjt' ? ((r.g[id] || {}).most || '') : (r.g[id] || '');
          s.rows.push({ score: r.scores[id], max: it.item_type === 'sjt' ? 2 : 1, total: r.total, pick: pick });
          if (it.item_type === 'sjt') s.least.push((r.g[id] || {}).least || '');
        });
      });
    });
    var mgrAll = {};
    Object.keys(ctx.mgr).forEach(function (code) { if (!peopleByCode[code]) return; Object.keys(ctx.mgr[code]).forEach(function (id) { mgrAll[id] = (mgrAll[id] || []).concat(ctx.mgr[code][id]); }); });
    Object.keys(stat).sort().forEach(function (id) {
      var s = stat[id], it = s.it;
      if (it.item_type === 'rating') {
        var nums = s.ratings.filter(function (v) { return typeof v === 'number'; });
        var m = meanSd(nums), mg = meanSd(mgrAll[id] || []);
        itemsOut.push([id, it.assessment, it.form, it.section, it.item_type, s.ratings.length, m.mean === null ? '' : round1(m.mean), '', '',
          'self NR ' + (s.ratings.length ? Math.round(100 * (s.ratings.length - nums.length) / s.ratings.length) : 0) + '% · manager mean ' + (mg.mean === null ? '–' : round1(mg.mean)) + ' (n ' + mg.n + ')']);
        return;
      }
      var a = itemAnalysis(s.rows);
      var dist = 'a ' + a.dist.a + '% · b ' + a.dist.b + '% · c ' + a.dist.c + '% · d ' + a.dist.d + '% · blank ' + a.dist.blank + '%';
      if (it.item_type === 'sjt') {
        var ld = itemAnalysis(s.least.map(function (l) { return { score: 0, max: 1, total: 0, pick: l }; })).dist;
        dist = 'most: ' + dist + ' | least: a ' + ld.a + '% · b ' + ld.b + '% · c ' + ld.c + '% · d ' + ld.d + '% · blank ' + ld.blank + '%';
      }
      itemsOut.push([id, it.assessment, it.form, it.section, it.item_type, a.n, a.p_value === null ? '' : a.p_value, a.point_biserial === null ? '' : a.point_biserial,
        it.item_type === 'sjt' ? 'most ' + it.answer_most + ' / least ' + it.answer_least : it.answer, dist]);
    });
    writeDash_('Dash_BL2_Items', ['item_id', 'assessment', 'form', 'section', 'type', 'n', 'p_value_or_mean', 'point_biserial', 'key', 'distribution'], itemsOut);
    counts.items = itemsOut.length;

    // Dash_BL2_Forms: starts and mean per Part 1 form
    var p1All = allAttempts_().filter(function (a) { return a.assessment === 'baseline_p1' && a.wave === cfg.wave && peopleByCode[a.code]; });
    var forms = BL_FORMS.map(function (f) {
      var mine = p1All.filter(function (a) { return a.form === f; });
      var done = mine.filter(isDone_);
      var raw = meanSd(done.map(function (a) { return a.raw_pct; })), sc = meanSd(done.map(function (a) { return a.scaled_pct === null ? a.raw_pct : a.scaled_pct; }));
      var byRole = ROLE_GROUPS.map(function (g) { return g + ' ' + mine.filter(function (a) { return peopleByCode[a.code].role_area === g; }).length; }).join(' · ');
      return [f, cfg.p1_live.indexOf(f) >= 0 ? 'live' : f === cfg.p1_backup ? 'backup' : 'off', mine.length, done.length,
        raw.mean === null ? '' : round1(raw.mean), raw.sd === null ? '' : round1(raw.sd), sc.mean === null ? '' : round1(sc.mean), byRole];
    });
    var plan = equatingPlan((function () { var o = {}; p1All.filter(isDone_).forEach(function (a) { (o[a.form] = o[a.form] || []).push(a.raw_pct); }); return o; })(), cfg.p1_live, cfg.equate_threshold_pts, 'A');
    forms.push(['equating', plan.apply ? 'applied (reference ' + plan.reference + ')' : 'not applied', '', '', '', '', '', 'live-form mean difference ' + plan.diff + ' pts (threshold ' + cfg.equate_threshold_pts + ')']);
    writeDash_('Dash_BL2_Forms', ['form', 'use', 'starts', 'submitted', 'mean_raw', 'sd_raw', 'mean_scaled', 'starts_by_role'], forms);
    counts.forms = forms.length;

    // Dash_BL2_Raters: mean and spread per rater (leniency)
    var raters = {};
    ratingRows_(cfg.wave).forEach(function (r) {
      if (String(r.rater_role).trim().toLowerCase() !== 'manager') return;
      var rc = normCode(r.rater_code), x = raters[rc] = raters[rc] || { ratees: {}, vals: [], na: 0, n: 0 };
      var v = String(r.value || '').trim().toUpperCase();
      if (!v) return;
      x.n++;
      x.ratees[normCode(r.ratee_code)] = true;
      if (v === 'NA') x.na++; else x.vals.push(toInt(v, 0));
    });
    var raterOut = Object.keys(raters).sort().map(function (rc) {
      var x = raters[rc], m = meanSd(x.vals);
      var selfMeans = Object.keys(x.ratees).map(function (c) { var p = profiles[c] || buildProfile_(c, ctx); return p && p.p2 ? p.p2.self_mean : null; }).filter(function (v) { return typeof v === 'number'; });
      var row = findRosterRow_(rc);
      return [rc, row ? row.display_name : '', Object.keys(x.ratees).length, x.n, m.mean === null ? '' : round1(m.mean), m.sd === null ? '' : round1(m.sd),
        x.n ? Math.round(100 * x.na / x.n) : 0, selfMeans.length ? round1(meanSd(selfMeans).mean) : ''];
    });
    writeDash_('Dash_BL2_Raters', ['rater_code', 'name', 'ratees', 'ratings', 'mean', 'sd', 'na_pct', 'ratees_self_mean'], raterOut);
    counts.raters = raterOut.length;

    // Dash_BL2_Flags: blind spot / hidden strength / knowing–doing / rates high, scores low
    var flags = [];
    people.forEach(function (u) {
      var p = profiles[u.code];
      if (!p) return;
      if (p.p2) Object.keys(p.p2.by_charter).forEach(function (c) {
        var x = p.p2.by_charter[c];
        x.flags.forEach(function (f) { flags.push([u.code, u.display_name, u.role_area, 'charter ' + c, f, 'self ' + x.self_mean + ' · manager ' + x.mgr_mean + ' · SJT ' + (x.sjt_band || '–')]); });
      });
      Object.keys(p.courses).forEach(function (k) {
        var x = p.courses[k];
        if (x.flag) flags.push([u.code, u.display_name, u.role_area, k, 'rates_high_scores_low', 'self ' + x.self + ' · score ' + x.score_pct + '%']);
      });
    });
    writeDash_('Dash_BL2_Flags', ['code', 'name', 'role_area', 'area', 'flag', 'detail'], flags);
    counts.flags = flags.length;
  });
  return counts;
}

function menuBaselineReports() {
  var c = buildBaselineReports_();
  notify_('Baseline v2 reports', 'Dash_BL2_Heatmap ' + c.heatmap + ' person(s) · Dash_BL2_Items ' + c.items + ' item(s) · Dash_BL2_Forms · Dash_BL2_Raters ' + c.raters +
    ' rater(s) · Dash_BL2_Flags ' + c.flags + ' flag(s). Admin only: never shown on the Hub.');
}
