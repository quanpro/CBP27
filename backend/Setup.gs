/**
 * Setup.gs · setupSheet(): creates or repairs every tab (idempotent; never deletes data).
 * - spreadsheet time zone Asia/Ho_Chi_Minh and plain-text ('@') cells everywhere (F5)
 * - missing headers are added at the end of row 1
 * - cells the Sheet had already turned into dates/numbers/booleans are written back as text
 * - Config defaults, Courses order/date defaults and Episodes rows from Seed.gs (blanks only)
 * - Script Properties TOKEN_SECRET and PIN_PEPPER created once (never overwritten)
 */

var SETUP_SKIP_NORMALISE_ = { Log: true };

/** Run once from the editor (or menu ▸ Set up / repair tabs). Safe to run again at any time. */
function setupSheet() {
  resetRequest_();
  var report = [];
  withLock_(function () {
    var ss = ss_();
    // Cells the Sheet already turned into dates were made in its current zone: repair them first.
    Object.keys(SCHEMA).forEach(function (name) {
      if (!SETUP_SKIP_NORMALISE_[name] && ss.getSheetByName(name)) normaliseTab_(name, report);
    });
    if (ss.getSpreadsheetTimeZone() !== 'Asia/Ho_Chi_Minh') {
      ss.setSpreadsheetTimeZone('Asia/Ho_Chi_Minh');
      report.push('Time zone set to Asia/Ho_Chi_Minh.');
    }
    Object.keys(SCHEMA).forEach(function (name) { ensureTab_(ss, name, SCHEMA[name], report); });
    seedConfig_(report);
    seedCourses_(report);
    seedEpisodes_(report);
    ensureSecrets_(report);
    removeDefaultSheet_(ss, report);
    clearCaches_();
  });
  if (!report.length) report.push('Everything was already in place.');
  notify_('1% Planner · setup', report.join('\n'));
  return report;
}

function ensureTab_(ss, name, headers, report) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    report.push('Created tab ' + name + '.');
  }
  var lastCol = sh.getLastColumn();
  var existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(headerKey_) : [];
  var hasAny = existing.some(function (h) { return h; });
  var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
  var startCol = hasAny ? lastCol + 1 : 1;
  var toWrite = hasAny ? missing : headers;
  var totalCols = hasAny ? lastCol + missing.length : headers.length;
  if (totalCols > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), totalCols - sh.getMaxColumns());
  sh.getRange(1, 1, sh.getMaxRows(), totalCols).setNumberFormat('@');
  if (toWrite.length) {
    sh.getRange(1, startCol, 1, toWrite.length).setValues([toWrite]);
    if (hasAny) report.push(name + ': added column' + (toWrite.length > 1 ? 's ' : ' ') + toWrite.join(', ') + '.');
  }
  sh.getRange(1, 1, 1, totalCols).setFontWeight('bold');
  if (sh.getFrozenRows() !== 1) sh.setFrozenRows(1);
  invalidate_(name);
  return sh;
}

/** Writes back cells the Sheet had converted (dates, numbers, booleans) as plain text. */
function normaliseTab_(name, report) {
  var sh = sheet_(name);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return;
  var range = sh.getRange(1, 1, lastRow, lastCol);
  var values = range.getValues();
  var headers = values[0].map(headerKey_);
  var tz = ss_().getSpreadsheetTimeZone() || 'Asia/Ho_Chi_Minh';
  var keyCol = headers.indexOf('key');
  var changed = 0;
  var out = values.map(function (row, r) {
    return row.map(function (v, c) {
      if (r === 0 || typeof v === 'string') return v;
      var s = sheetCellToString_(v, tz);
      if (headers[c] === 'value' && keyCol >= 0 && String(values[r][keyCol]) === 'wave') s = normWave(s);
      changed++;
      return s;
    });
  });
  if (changed) {
    range.setNumberFormat('@');
    range.setValues(out);
    report.push(name + ': ' + changed + ' cell' + (changed > 1 ? 's' : '') + ' converted back to plain text.');
  }
  if (name === 'Roster') {
    var ci = headers.indexOf('employee_code');
    var digitsOnly = out.slice(1).filter(function (row) { return /^\d+$/.test(String(row[ci] || '')); }).length;
    if (ci >= 0 && digitsOnly) report.push('Roster: ' + digitsOnly + ' employee code(s) are digits only. If HR codes start with 0, re-type them (cells are plain text now).');
  }
  invalidate_(name);
}

/** Like cellToString, but a Sheet date is read in the zone it was created in (midnight there = a date). */
function sheetCellToString_(v, tz) {
  if (isDate(v) && !isNaN(v.getTime())) {
    if (Utilities.formatDate(v, tz, 'HH:mm:ss') === '00:00:00') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return iso7(v.getTime());
  }
  return cellToString(v);
}

function seedConfig_(report) {
  var have = {};
  readTable_('Config').rows.forEach(function (r) { have[String(r.key || '').trim()] = true; });
  var add = configDefaults_().filter(function (d) { return !have[d[0]]; })
    .map(function (d) { return { key: d[0], value: d[1], note: d[2] }; });
  if (add.length) {
    appendRows_('Config', add);
    report.push('Config: added ' + add.map(function (a) { return a.key; }).join(', ') + '.');
  }
}

/** Adds missing course rows and fills blank order/cycle/date/open cells from Seed.gs. */
function seedCourses_(report) {
  var t = readTable_('Courses');
  var byCode = {};
  t.rows.forEach(function (r) { byCode[normCode(r.code)] = r; });
  var fill = ['order', 'cycle', 'online_from', 'checkpoint_close', 'forum_date', 'field_until'];
  var added = [], filled = 0;
  SEED.courses.forEach(function (sc) {
    var r = byCode[sc.code];
    if (!r) {
      added.push({ code: sc.code, order: sc.order, cycle: sc.cycle, online_from: sc.online_from, checkpoint_close: sc.checkpoint_close,
        forum_date: sc.forum_date, field_until: sc.field_until, open: 'TRUE' });
      return;
    }
    var patch = {};
    fill.forEach(function (k) { if (String(r[k] || '').trim() === '' && sc[k] !== '' && sc[k] !== undefined) patch[k] = sc[k]; });
    if (String(r.open || '').trim() === '') patch.open = 'TRUE';
    if (Object.keys(patch).length) { updateRow_('Courses', r._row, patch); filled++; }
  });
  if (added.length) { appendRows_('Courses', added); report.push('Courses: added rows for ' + added.map(function (a) { return a.code; }).join(', ') + ' (names and objectives come from Courses.csv).'); }
  if (filled) report.push('Courses: filled default order/dates on ' + filled + ' row(s).');
}

function seedEpisodes_(report) {
  var have = {};
  readTable_('Episodes').rows.forEach(function (r) { have[normCode(r.course) + ':' + toInt(r.ep, -1)] = true; });
  var add = SEED.episodes.filter(function (e) { return !have[e.course + ':' + e.ep]; })
    .map(function (e) { return { course: e.course, ep: e.ep, title_en: e.title_en, minutes: '', blink_url: '', embed_url: '' }; });
  if (add.length) {
    appendRows_('Episodes', add);
    report.push('Episodes: added ' + add.length + ' row(s); paste the Blink links into blink_url / embed_url.');
  }
  return add.length;
}

function ensureSecrets_(report) {
  var p = PropertiesService.getScriptProperties();
  ['TOKEN_SECRET', 'PIN_PEPPER'].forEach(function (k) {
    if (!p.getProperty(k)) {
      p.setProperty(k, randomSecret_());
      report.push('Script property ' + k + ' created (keep it; never share or delete it).');
    }
  });
}

/** A new Sheet starts with an empty "Sheet1"; remove it once our tabs exist. */
function removeDefaultSheet_(ss, report) {
  ['Sheet1', 'Trang tính1'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) {
      try { ss.deleteSheet(sh); report.push('Removed the empty ' + n + ' tab.'); } catch (e) { /* keep it */ }
    }
  });
}

/** Shows a message when a UI exists (menu), otherwise logs it (editor run, trigger, tests). */
function notify_(title, message) {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert(title, message, ui.ButtonSet.OK);
  } catch (e) {
    console.log(title + '\n' + message);
  }
}
