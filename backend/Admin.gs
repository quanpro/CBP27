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
    .addItem('Unlock a retake…', 'menuUnlock')
    .addItem('Void an attempt…', 'menuVoidAttempt')
    .addSeparator()
    .addItem('Rebuild summaries', 'menuRebuildSummaries')
    .addItem('Install hourly summary trigger', 'menuInstallTrigger')
    .addItem('Baseline heatmap', 'menuBaselineHeatmap')
    .addItem('Course gate report', 'menuGateReport')
    .addItem('IDP export', 'menuIdpExport')
    .addItem('Recall due list', 'menuRecallDue')
    .addItem('Panel results', 'menuPanelResults')
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
  return withLock_(fn);
}

// ---------------------------------------------------------------- import and validate

function menuImportCsv() {
  var html = '<p>Paste the whole CSV file (with its header row), choose the tab and press Import. ' +
    '<b>Items</b> and <b>Cases</b> are replaced; <b>Courses</b> rows are updated by code and keep your dates and Blink links.</p>' +
    '<select id="tab"><option>Items</option><option>Courses</option><option>Cases</option></select> ' +
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
  var keyCol = { Items: 'item_id', Courses: 'code', Cases: 'case_id' }[tab];
  if (!keyCol) throw new Error('Choose Items, Courses or Cases');
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

/** Repairs Items/Courses/Cases (columns, plain text, default dates) and validates the bank. */
function validateNow_() {
  var report = [];
  adminRun_('', function () {
    var ss = ss_();
    ['Items', 'Courses', 'Cases'].forEach(function (n) { ensureTab_(ss, n, SCHEMA[n], report); normaliseTab_(n, report); });
    seedCourses_(report);
    clearCaches_();
  });
  resetRequest_();
  var res = validateBank(readTable_('Items').rows, readTable_('Courses').rows, readTable_('Cases').rows);
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
    listHtml_('Problems (fix in the Items / Courses / Cases tab)', v.errors.slice(0, 100)) +
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
  notify_('Cache', 'Done: the Hub reads Items, Courses, Config and Episodes fresh from the Sheet now.');
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
      updateRow_('Roster', r._row, {
        employee_code: code, pin_hash: rec.pin_hash, pin_salt: rec.pin_salt, must_change_pin: 'TRUE',
        failed_logins: 0, locked_until: '', lock_count: 0, session_ver: toInt(r.session_ver, 0) + 1
      });
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
    updateRow_('Roster', r._row, {
      pin_hash: rec.pin_hash, pin_salt: rec.pin_salt, must_change_pin: 'TRUE', failed_logins: 0,
      locked_until: '', lock_count: 0, session_ver: toInt(r.session_ver, 0) + 1
    });
    setLogInfo_(c, 'reset');
    out = { code: c, name: r.display_name || '', pin: pin };
  });
  return out;
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
 * summaries, once-per-wave baseline). A voided pass also voids its pending recall rows;
 * a voided recall attempt makes that recall day available again.
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

/** Rebuilds the Summary tab (team-view rules). Also the hourly trigger's handler. */
function buildSummary() {
  resetRequest_();
  var n = 0;
  withLock_(function () {
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
  notify_('Hourly summary', 'Installed: the Summary tab is rebuilt every hour.');
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

/** Dash_Baseline: people × courses (score % and self-rating), calibration flags. */
function buildDashBaseline_() {
  var rowsOut = [], bgs = [];
  adminRun_('', function () {
    var cfg = config_(), order = courseOrder_();
    var atts = allAttempts_();
    var header = ['code', 'name', 'role_area', 'wave', 'overall_pct'];
    order.forEach(function (c) { header.push(c + ' %', c + ' self'); });
    header.push('flags');
    adminPeople_().forEach(function (u) {
      var a = atts.filter(function (x) { return x.code === u.code && x.assessment === 'baseline' && x.wave === cfg.wave && isDone_(x); })[0];
      if (!a) return;
      var self = cleanSelfRatings(a.self_ratings, order), flags = [];
      var row = [u.code, u.display_name, u.role_area, a.wave, a.score_pct], bg = ['#ffffff', '#ffffff', '#ffffff', '#ffffff', scoreColour_(a.score_pct)];
      order.forEach(function (c) {
        var pct = typeof a.by_course[c] === 'number' ? a.by_course[c] : '';
        var sv = c in self ? self[c] : '';
        row.push(pct, sv);
        bg.push(scoreColour_(pct), '#ffffff');
        var f = calibrationFlag(sv === '' ? null : sv, pct === '' ? null : pct);
        if (f) flags.push(c + ': ' + f);
      });
      row.push(flags.join('; '));
      bg.push(flags.length ? '#fce5cd' : '#ffffff');
      rowsOut.push(row);
      bgs.push(bg);
    });
    writeDash_('Dash_Baseline', header, rowsOut, bgs);
  });
  return rowsOut.length;
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
          var y = a.answers[id];
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

/** Dash_IDP: two largest gaps, suggested capability goals and checkpoint status per person. */
function buildDashIdp_() {
  var out = [];
  adminRun_('', function () {
    var cfg = config_(), order = courseOrder_();
    var scale = SEED.scale || [];
    var levelName = function (l) { var s = scale.filter(function (x) { return x.level === l; })[0]; return s ? s.en : String(l); };
    var atts = allAttempts_();
    var header = ['code', 'name', 'role_area', 'gap_1', 'gap_2', 'goal_1', 'goal_2', 'checkpoints_passed', 'checkpoint_status'];
    adminPeople_().forEach(function (u) {
      var mine = atts.filter(function (a) { return a.code === u.code; });
      var b = mine.filter(function (a) { return a.assessment === 'baseline' && a.wave === cfg.wave && isDone_(a); })[0];
      var g = b ? baselineSummary_(b) : null;
      var goal = function (code) {
        if (!code) return '';
        var c = courseByCode_(code);
        var cur = g.self[code];
        var target = Math.min(4, (typeof cur === 'number' ? cur : 0) + 1);
        return 'Reach ' + levelName(target) + ' in ' + code + (c && c.name_en ? ' ' + c.name_en : '') +
          ' by Mar 2028 (evidence: checkpoint passed, field sign-off, re-test score; baseline ' + g.by_course[code] + '%)';
      };
      var status = order.map(function (c) {
        var cp = mine.filter(function (a) { return a.assessment === 'checkpoint' && a.course === c && isDone_(a); });
        return c + ' ' + (cp.some(function (a) { return a.passed; }) ? '✓' : cp.length ? 'not yet' : '–');
      });
      var passedN = order.filter(function (c) { return mine.some(function (a) { return a.assessment === 'checkpoint' && a.course === c && a.passed; }); }).length;
      out.push([u.code, u.display_name, u.role_area, g ? g.gaps[0] || '' : 'no baseline', g ? g.gaps[1] || '' : '',
        g ? goal(g.gaps[0]) : '', g ? goal(g.gaps[1]) : '', passedN + '/' + order.length, status.join(' · ')]);
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
        var avg = function (k) { return round1(mine.reduce(function (s, r) { return s + toNum(r[k], 0); }, 0) / mine.length); };
        var w = mine.map(function (r) {
          return panelWeighted(stage, { c1: r.c1_problem, c2: r.c2_structure, c3: r.c3_result, c4: r.c4_value, c5: r.c5_communication });
        }).filter(function (x) { return x !== null; });
        var team = w.length ? Math.round(100 * w.reduce(function (s, x) { return s + x; }, 0) / w.length) / 100 : '';
        out.push([stage, t.team_id, t.project_title, mine.length, avg('c1_problem'), avg('c2_structure'), avg('c3_result'), avg('c4_value'), avg('c5_communication'), team]);
      });
    });
    writeDash_('Dash_Panel', ['stage', 'team_id', 'project_title', 'judges', 'c1', 'c2', 'c3', 'c4', 'c5', 'weighted_score'], out);
  });
  return out.length;
}

function menuPanelResults() { var n = buildDashPanel_(); notify_('Panel results', 'Dash_Panel: ' + n + ' team score(s). Pitch Day weights communication double; the capstone weights result and value double.'); }

function menuBaselineHeatmap() { var n = buildDashBaseline_(); notify_('Baseline heatmap', 'Dash_Baseline: ' + n + ' person(s).'); }
function menuGateReport() { buildDashGate_(); notify_('Course gate report', 'Dash_Gate is up to date.'); }
function menuIdpExport() { var n = buildDashIdp_(); notify_('IDP export', 'Dash_IDP: ' + n + ' person(s). Copy the goals into the HR system.'); }
function menuRecallDue() { var n = buildDashRecall_(); notify_('Recall due list', 'Dash_Recall: ' + n + ' recall(s) due this week or overdue.'); }
