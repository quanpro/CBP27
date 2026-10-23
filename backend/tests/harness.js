// Node harness: loads every backend .gs file into one `vm` context with in-memory fakes of
// SpreadsheetApp, CacheService, LockService, PropertiesService, Utilities, ContentService,
// HtmlService, ScriptApp, Session and an injectable clock. No Google account needed.
//
//   const { createHarness } = require('./harness');
//   const h = createHarness({ now: Date.parse('2026-11-16T09:00:00+07:00') });
//   h.ctx.setupSheet();  h.call({ action: 'login', code: 'T001', pin: '246810' });
//
// The fake Sheet emulates the type coercion that bit earlier projects (F5): on cells that are
// not formatted '@', strings like '2026-11' or '2027-01-04' become Dates (midnight in the
// spreadsheet time zone), '00123' becomes 123 and 'TRUE' becomes true. A string that starts
// with '=' is treated as a formula.
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BACKEND = path.join(__dirname, '..');
const FIRST = ['Seed.gs', 'Logic.gs', 'Data.gs'];

function backendFiles() {
  const all = fs.readdirSync(BACKEND).filter((f) => f.endsWith('.gs')).sort();
  return FIRST.filter((f) => all.includes(f)).concat(all.filter((f) => !FIRST.includes(f))).map((f) => path.join(BACKEND, f));
}

// ---------------------------------------------------------------- time zone helpers
function tzOffsetMs(tz, ms) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = {};
  for (const x of dtf.formatToParts(new Date(ms))) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

function midnightIn(tz, y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(tz, guess);
  t = guess - tzOffsetMs(tz, t);
  return t;
}

function formatDate(date, tz, pattern) {
  const ms = date.getTime();
  const off = tzOffsetMs(tz, ms);
  const d = new Date(ms + off);
  const p2 = (n) => String(n).padStart(2, '0');
  const offMin = Math.round(off / 60000);
  const sign = offMin >= 0 ? '+' : '-';
  const oh = p2(Math.floor(Math.abs(offMin) / 60)), om = p2(Math.abs(offMin) % 60);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return pattern.replace(/yyyy|yy|MM|dd|HH|mm|ss|SSS|XXX|Z|EEE|'T'|T/g, (t) => ({
    yyyy: String(d.getUTCFullYear()), yy: String(d.getUTCFullYear()).slice(-2), MM: p2(d.getUTCMonth() + 1),
    dd: p2(d.getUTCDate()), HH: p2(d.getUTCHours()), mm: p2(d.getUTCMinutes()), ss: p2(d.getUTCSeconds()),
    SSS: String(d.getUTCMilliseconds()).padStart(3, '0'), XXX: sign + oh + ':' + om, Z: sign + oh + om,
    EEE: days[d.getUTCDay()], "'T'": 'T', T: 'T'
  })[t]);
}

// ---------------------------------------------------------------- byte helpers
const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(Array.from(v, (b) => b & 0xff)));
const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const isDateObj = (v) => Object.prototype.toString.call(v) === '[object Date]';

// ---------------------------------------------------------------- fake Sheets
const FORMULA = Symbol('formula');

class FakeRange {
  constructor(sheet, row, col, nr, nc) {
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  _each(fn) { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) fn(this.row + r, this.col + c, r, c); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const row = [];
      for (let c = 0; c < this.nc; c++) row.push(this.sheet._read(this.row + r, this.col + c));
      out.push(row);
    }
    return out;
  }
  getDisplayValues() { return this.getValues().map((r) => r.map((v) => (isDateObj(v) ? v.toISOString() : String(v)))); }
  getValue() { return this.sheet._read(this.row, this.col); }
  getFormulas() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const row = [];
      for (let c = 0; c < this.nc; c++) { const v = this.sheet._raw(this.row + r, this.col + c); row.push(v && v[FORMULA] ? v[FORMULA] : ''); }
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.nr || values.some((r) => !Array.isArray(r) || r.length !== this.nc)) {
      throw new Error(`The number of rows or columns in the data does not match the range (${this.nr}x${this.nc}).`);
    }
    this.sheet.ss.stats.writes++;
    this._each((r, c, i, j) => this.sheet._write(r, c, values[i][j]));
    return this;
  }
  setValue(v) { this.sheet.ss.stats.writes++; this._each((r, c) => this.sheet._write(r, c, v)); return this; }
  setNumberFormat(f) { this._each((r, c) => this.sheet._setFmt(r, c, f)); return this; }
  setNumberFormats(f) { this._each((r, c, i, j) => this.sheet._setFmt(r, c, f[i][j])); return this; }
  getNumberFormat() { return this.sheet._fmt(this.row, this.col) || 'General'; }
  getNumberFormats() { const o = []; for (let r = 0; r < this.nr; r++) { const row = []; for (let c = 0; c < this.nc; c++) row.push(this.sheet._fmt(this.row + r, this.col + c) || 'General'); o.push(row); } return o; }
  clearContent() { this._each((r, c) => this.sheet._store(r, c, '')); return this; }
  clear() { this._each((r, c) => { this.sheet._store(r, c, ''); this.sheet._setFmt(r, c, ''); }); return this; }
  setBackgrounds(b) { this.sheet.backgrounds.push({ row: this.row, col: this.col, colors: b }); return this; }
  setBackground() { return this; }
  setFontWeight() { return this; }
  setFontWeights() { return this; }
  setFontColor() { return this; }
  setFontSize() { return this; }
  setWrap() { return this; }
  setHorizontalAlignment() { return this; }
  setVerticalAlignment() { return this; }
  setNote() { return this; }
  setBorder() { return this; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getLastRow() { return this.row + this.nr - 1; }
  getLastColumn() { return this.col + this.nc - 1; }
  getSheet() { return this.sheet; }
  getA1Notation() { const L = (c) => { let s = ''; while (c) { c--; s = String.fromCharCode(65 + (c % 26)) + s; c = Math.floor(c / 26); } return s; }; return `${L(this.col)}${this.row}:${L(this.col + this.nc - 1)}${this.row + this.nr - 1}`; }
}

class FakeSheet {
  constructor(ss, name) {
    this.ss = ss; this.name = name; this.maxRows = 1000; this.maxCols = 26;
    this.vals = []; this.fmts = []; this.frozen = 0; this.backgrounds = [];
  }
  _raw(r, c) { const row = this.vals[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ''; }
  _read(r, c) {
    const v = this._raw(r, c);
    if (v && typeof v === 'object' && v[FORMULA]) return '#FORMULA';
    if (isDateObj(v)) return new Date(v.getTime());
    return v === undefined || v === null ? '' : v;
  }
  _store(r, c, v) { (this.vals[r - 1] = this.vals[r - 1] || [])[c - 1] = v; }
  _fmt(r, c) { const row = this.fmts[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ''; }
  _setFmt(r, c, f) { (this.fmts[r - 1] = this.fmts[r - 1] || [])[c - 1] = f; }
  _write(r, c, v) { this._store(r, c, this.ss._coerce(v, this._fmt(r, c))); }
  _check(row, col, nr, nc) {
    if (!(row >= 1 && col >= 1 && nr >= 1 && nc >= 1) || row + nr - 1 > this.maxRows || col + nc - 1 > this.maxCols) {
      throw new Error(`The coordinates of the range are outside the dimensions of the sheet (${this.name} r${row} c${col} ${nr}x${nc}).`);
    }
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getSheetId() { return this.ss.sheets.indexOf(this) + 1; }
  getIndex() { return this.ss.sheets.indexOf(this) + 1; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getLastRow() {
    for (let r = this.vals.length; r >= 1; r--) {
      const row = this.vals[r - 1];
      if (row && row.some((v) => v !== '' && v !== undefined && v !== null)) return r;
    }
    return 0;
  }
  getLastColumn() {
    let m = 0;
    for (const row of this.vals) {
      if (!row) continue;
      for (let c = row.length; c > m; c--) if (row[c - 1] !== '' && row[c - 1] !== undefined && row[c - 1] !== null) { m = c; break; }
    }
    return m;
  }
  getRange(a, b, nr, nc) {
    if (typeof a === 'string') {
      const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a.replace(/\$/g, ''));
      if (!m) throw new Error('Unsupported A1 notation in the fake: ' + a);
      const col = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      const r1 = +m[2], c1 = col(m[1]), r2 = m[4] ? +m[4] : r1, c2 = m[3] ? col(m[3]) : c1;
      this._check(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
      return new FakeRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    nr = nr === undefined ? 1 : nr; nc = nc === undefined ? 1 : nc;
    this._check(a, b, nr, nc);
    this.ss.stats.ranges++;
    return new FakeRange(this, a, b, nr, nc);
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(values) {
    const r = this.getLastRow() + 1;
    if (r > this.maxRows) this.maxRows = r; // appended rows get default formatting
    if (values.length > this.maxCols) this.maxCols = values.length;
    values.forEach((v, i) => this._write(r, i + 1, v));
    this.ss.stats.writes++;
    return this;
  }
  insertRowsAfter(after, n) {
    const fmtAbove = (this.fmts[after - 1] || []).slice();
    this.vals.splice(after, 0, ...Array.from({ length: n }, () => []));
    this.fmts.splice(after, 0, ...Array.from({ length: n }, () => fmtAbove.slice()));
    this.maxRows += n;
    return this;
  }
  insertRowAfter(after) { return this.insertRowsAfter(after, 1); }
  insertColumnsAfter(after, n) {
    for (const arr of [this.vals, this.fmts]) for (const row of arr) if (row && row.length > after) row.splice(after, 0, ...Array(n).fill(''));
    this.maxCols += n;
    return this;
  }
  deleteRow(r) { this.vals.splice(r - 1, 1); this.fmts.splice(r - 1, 1); this.maxRows--; return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  getFrozenRows() { return this.frozen; }
  clear() { this.vals = []; this.fmts = []; this.backgrounds = []; return this; }
  clearContents() { this.vals = []; return this; }
  clearFormats() { this.fmts = []; return this; }
  activate() { return this; }
  setTabColor() { return this; }
  autoResizeColumns() { return this; }
  setColumnWidth() { return this; }
  setColumnWidths() { return this; }
  hideSheet() { return this; }
}

class FakeSpreadsheet {
  constructor() {
    this.sheets = [new FakeSheet(this, 'Sheet1')];
    this.tz = 'America/New_York'; // a new Sheet's zone is the owner's; setupSheet must fix it
    this.stats = { writes: 0, ranges: 0, flushes: 0 };
    this.toasts = [];
  }
  _coerce(v, fmt) {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'string') return v;
    if (v.startsWith("'")) return v.slice(1);
    if (v.startsWith('=')) return { [FORMULA]: v };
    if (fmt === '@') return v;
    let m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) return new Date(midnightIn(this.tz, +m[1], +m[2], +m[3]));
    if ((m = /^(\d{4})-(\d{2})$/.exec(v))) return new Date(midnightIn(this.tz, +m[1], +m[2], 1));
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
    return v;
  }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error(`A sheet with the name "${n}" already exists.`);
    const s = new FakeSheet(this, n);
    this.sheets.push(s);
    return s;
  }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  getSheets() { return this.sheets.slice(); }
  getActiveSheet() { return this.sheets[0]; }
  setActiveSheet(s) { return s; }
  getSpreadsheetTimeZone() { return this.tz; }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getName() { return '1pct-planner-data (fake)'; }
  getId() { return 'fake-spreadsheet-id'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/fake'; }
  toast(msg) { this.toasts.push(String(msg)); }
}

// ---------------------------------------------------------------- the harness
function createHarness(opts = {}) {
  const clock = {
    _t: opts.now === undefined ? Date.now() : opts.now,
    _real: !!opts.realClock,
    _offset: opts.offsetMs || 0,
    now() { return this._real ? Date.now() + this._offset : this._t; },
    set(ms) { this._real = false; this._t = ms; },
    advance(ms) { if (this._real) this._offset += ms; else this._t += ms; }
  };
  const ss = new FakeSpreadsheet();
  const logs = [];
  const say = (kind) => (...a) => { logs.push(kind + ': ' + a.join(' ')); if (process.env.HARNESS_DEBUG) console.log('[gas ' + kind + ']', ...a); };

  // UI (menu, alerts, prompts, dialogs)
  const ui = {
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO', CLOSE: 'CLOSE' },
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO', YES_NO_CANCEL: 'YES_NO_CANCEL' },
    menus: [], alerts: [], dialogs: [], prompts: [],
    createMenu(name) {
      const m = { name, items: [] };
      m.addItem = (label, fn) => { m.items.push({ label, fn }); return m; };
      m.addSeparator = () => { m.items.push({ separator: true }); return m; };
      m.addSubMenu = (sub) => { m.items.push({ sub }); return m; };
      m.addToUi = () => { ui.menus.push(m); };
      return m;
    },
    alert(a, b) { ui.alerts.push(b === undefined ? { title: '', message: String(a) } : { title: String(a), message: String(b) }); return 'OK'; },
    prompt(title, msg) {
      const next = ui.prompts.shift();
      return { getResponseText: () => (next === null || next === undefined ? '' : String(next)), getSelectedButton: () => (next === null || next === undefined ? 'CANCEL' : 'OK') };
    },
    showModalDialog(out, title) { ui.dialogs.push({ title, html: out.getContent() }); },
    showModelessDialog(out, title) { ui.dialogs.push({ title, html: out.getContent() }); },
    showSidebar(out) { ui.dialogs.push({ title: 'sidebar', html: out.getContent() }); }
  };
  const uiCtl = { available: opts.ui !== false };

  // CacheService
  const cacheStore = new Map();
  const cacheCtl = { forceEvict: false, puts: 0, gets: 0, evictAll() { cacheStore.clear(); }, store: cacheStore };
  const cache = {
    get(k) {
      cacheCtl.gets++;
      if (cacheCtl.forceEvict) return null;
      const e = cacheStore.get(k);
      if (!e) return null;
      if (clock.now() > e.exp) { cacheStore.delete(k); return null; }
      return e.v;
    },
    put(k, v, ttl) {
      v = String(v);
      if (String(k).length > 250) throw new Error('Argument too large: key');
      if (Buffer.byteLength(v, 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
      cacheStore.set(k, { v, exp: clock.now() + Math.min(ttl === undefined ? 600 : ttl, 21600) * 1000 });
      cacheCtl.puts++;
    },
    getAll(keys) { const o = {}; for (const k of keys) { const v = cache.get(k); if (v !== null) o[k] = v; } return o; },
    putAll(map, ttl) { for (const k of Object.keys(map)) cache.put(k, map[k], ttl); },
    remove(k) { cacheStore.delete(k); },
    removeAll(keys) { for (const k of keys) cacheStore.delete(k); }
  };

  // LockService
  const lockCtl = { contended: false, held: false, acquisitions: 0, attempts: 0 };
  const lock = {
    tryLock() { lockCtl.attempts++; if (lockCtl.contended || lockCtl.held) return false; lockCtl.held = true; lockCtl.acquisitions++; return true; },
    waitLock(ms) { if (!lock.tryLock(ms)) throw new Error('Lock timeout'); },
    releaseLock() { lockCtl.held = false; },
    hasLock() { return lockCtl.held; }
  };

  // PropertiesService
  const props = new Map(Object.entries(opts.properties || {}));
  const propStore = {
    getProperty: (k) => (props.has(k) ? props.get(k) : null),
    setProperty: (k, v) => { props.set(k, String(v)); return propStore; },
    deleteProperty: (k) => { props.delete(k); return propStore; },
    getProperties: () => Object.fromEntries(props),
    setProperties: (o) => { for (const k of Object.keys(o)) props.set(k, String(o[k])); return propStore; },
    getKeys: () => Array.from(props.keys())
  };

  // ScriptApp triggers
  const triggers = [];
  let trigId = 0;
  const ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    newTrigger: (fn) => {
      const spec = { fn };
      const make = () => { const id = 'trig' + ++trigId; const t = Object.assign({ getHandlerFunction: () => fn, getUniqueId: () => id }, spec); triggers.push(t); return t; };
      return {
        timeBased: () => ({
          everyHours: (n) => { spec.everyHours = n; return { create: make }; },
          everyMinutes: (n) => { spec.everyMinutes = n; return { create: make }; },
          everyDays: (n) => ({ atHour: (h) => { spec.everyDays = n; spec.atHour = h; return { create: make }; }, create: make })
        })
      };
    }
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256', SHA_1: 'sha1', MD5: 'md5', SHA_512: 'sha512' },
    Charset: { UTF_8: 'utf8', US_ASCII: 'ascii' },
    computeDigest: (alg, value) => signed(crypto.createHash(alg).update(toBuf(value)).digest()),
    computeHmacSha256Signature: (value, key) => signed(crypto.createHmac('sha256', toBuf(key)).update(toBuf(value)).digest()),
    base64Encode: (data) => toBuf(data).toString('base64'),
    base64EncodeWebSafe: (data) => toBuf(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: (s) => signed(Buffer.from(String(s), 'base64')),
    base64DecodeWebSafe: (s) => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    getUuid: () => crypto.randomUUID(),
    formatDate: (date, tz, pattern) => formatDate(date, tz, pattern),
    newBlob: (data) => ({ getDataAsString: () => toBuf(data).toString('utf8'), getBytes: () => signed(toBuf(data)) }),
    sleep: () => {}
  };

  const ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput: (s) => ({
      _c: String(s), _m: 'text/plain',
      setMimeType(m) { this._m = m; return this; },
      getContent() { return this._c; },
      getMimeType() { return this._m; }
    })
  };

  const HtmlService = {
    createHtmlOutput: (html) => {
      const o = { _h: String(html || '') };
      o.setWidth = () => o; o.setHeight = () => o; o.setTitle = () => o;
      o.append = (s) => { o._h += s; return o; };
      o.getContent = () => o._h;
      return o;
    }
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => ss,
    getActive: () => ss,
    flush: () => { ss.stats.flushes++; },
    getUi: () => { if (!uiCtl.available) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); return ui; }
  };

  const Session = {
    getScriptTimeZone: () => 'Asia/Ho_Chi_Minh',
    getActiveUser: () => ({ getEmail: () => '' }),
    getEffectiveUser: () => ({ getEmail: () => '' }),
    getTemporaryActiveUserKey: () => 'fake-user-key'
  };

  const sandbox = {
    SpreadsheetApp, CacheService: { getScriptCache: () => cache, getUserCache: () => cache, getDocumentCache: () => cache },
    LockService: { getScriptLock: () => lock, getDocumentLock: () => lock, getUserLock: () => lock },
    PropertiesService: { getScriptProperties: () => propStore, getUserProperties: () => propStore, getDocumentProperties: () => propStore },
    Utilities, ContentService, HtmlService, Session, ScriptApp,
    Logger: { log: say('log') },
    console: { log: say('log'), info: say('info'), warn: say('warn'), error: say('error') }
  };
  const ctx = vm.createContext(sandbox);
  const CtxDate = vm.runInContext('Date', ctx);
  ctx.Date = new Proxy(CtxDate, {
    construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [clock.now()], newTarget); },
    apply(target) { return new target(clock.now()).toString(); },
    get(target, prop, recv) { if (prop === 'now') return () => clock.now(); return Reflect.get(target, prop, recv); }
  });

  const files = opts.files || backendFiles();
  for (const f of files) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });

  function post(body) {
    const out = ctx.doPost({ postData: { contents: body, type: 'text/plain', length: body.length }, parameter: {}, parameters: {}, queryString: '' });
    if (lockCtl.held) throw new Error('harness: the script lock was not released');
    if (out.getMimeType() !== ContentService.MimeType.JSON) throw new Error('harness: response is not JSON');
    return out.getContent();
  }

  const h = {
    ctx, ss, clock, ui, uiCtl, logs, triggers,
    cache: cacheCtl, lock: lockCtl, props,
    /** POST a payload (object or raw string) through doPost → parsed JSON. */
    call(payload) { return JSON.parse(post(typeof payload === 'string' ? payload : JSON.stringify(payload))); },
    /** Raw response text (for the dev server). */
    postRaw(body) { return post(body); },
    get() { return JSON.parse(ctx.doGet({ parameter: {} }).getContent()); },
    /** Calls a backend function; object results are copied out of the vm realm (JSON). */
    run(fn, ...args) {
      const r = ctx[fn](...args);
      return r !== null && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r;
    },
    sheet(name) { return ss.getSheetByName(name); },
    /** Raw cell values of a tab as objects keyed by row-1 headers. */
    table(name) {
      const sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 1) return [];
      const v = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getValues();
      const hdr = v[0].map((x) => String(x).trim().toLowerCase());
      return v.slice(1).map((r) => { const o = {}; hdr.forEach((k, i) => { if (k) o[k] = r[i]; }); return o; });
    },
    /** Writes rows the way an admin would (into the formatted area, header-mapped). */
    appendObjects(name, objs) {
      const sh = ss.getSheetByName(name);
      const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((x) => String(x).trim().toLowerCase());
      const start = sh.getLastRow() + 1;
      const rows = objs.map((o) => hdr.map((k) => (o[k] === undefined || o[k] === null ? '' : String(o[k]))));
      if (start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), start + rows.length - sh.getMaxRows());
      if (rows.length) sh.getRange(start, 1, rows.length, hdr.length).setValues(rows);
    },
    /** Updates cells of every row where `key` equals value. */
    updateWhere(name, key, value, patch) {
      const sh = ss.getSheetByName(name);
      const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
      const hdr = v[0].map((x) => String(x).trim().toLowerCase());
      const ki = hdr.indexOf(key);
      let n = 0;
      for (let r = 1; r < v.length; r++) {
        if (String(v[r][ki]) !== String(value)) continue;
        for (const k of Object.keys(patch)) { const c = hdr.indexOf(k); if (c >= 0) sh.getRange(r + 1, c + 1).setValue(String(patch[k])); }
        n++;
      }
      return n;
    },
    setConfig(key, value) {
      if (!h.updateWhere('Config', 'key', key, { value })) h.appendObjects('Config', [{ key, value }]);
      h.run('resetRequest_'); h.run('clearCaches_');
    }
  };
  return h;
}

module.exports = { createHarness, backendFiles, tzOffsetMs, formatDate, FakeSpreadsheet };
