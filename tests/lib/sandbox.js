// Shared test harness for the Apps Script backend.
//
// The backend is NOT in this repo -- it holds API_KEY / SERVER_KEY /
// MAILER_KEY and this repo is public. Point SFD_BACKEND at a local copy
// (see tests/README.md). Everything here is secret-free.
//
// Why one shared harness instead of per-file mocks: the suites used to
// each declare their own, and they drifted. When doCustomerSignup gained
// a SpreadsheetApp.flush(), two unrelated suites broke with
// "SpreadsheetApp is not defined" -- a harness gap masquerading as a
// code failure. One sandbox means one place to teach about a new global.

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BACKEND = process.env.SFD_BACKEND ||
  path.join(__dirname, '..', '..', '..', 'sfd-backend.txt');

function backendSource() {
  if (!fs.existsSync(BACKEND)) {
    console.error('\nCannot find the Apps Script source at:\n  ' + BACKEND +
      '\n\nThese tests run against a local copy of the backend, which is not\n' +
      'committed here (it contains SERVER_KEY / MAILER_KEY and this repo is\n' +
      'public). Copy the script out of the Apps Script editor and either put\n' +
      'it at that path or set SFD_BACKEND=/path/to/it. See tests/README.md.\n');
    process.exit(2);
  }
  return fs.readFileSync(BACKEND, 'utf8');
}

// A sandbox with every Apps Script global the backend touches, plus an
// in-memory sheet layer. `tabs` maps tab name -> array of row objects.
function makeSandbox(tabs) {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(backendSource(), ctx);

  const store = {};
  Object.keys(tabs || {}).forEach((k) => { store[k] = tabs[k].map((r) => Object.assign({}, r)); });

  const log = {
    mails: [],          // {to, subject, body}
    txns: [],           // appended Transactions rows
    reads: {},          // tab -> full-read count
    writes: 0,          // setValues calls
    lockHeld: false,
    appendsWhileUnlocked: 0,
    // Per-tab, because "read outside the lock" is only a defect for the
    // tab being mutated. doCustomerSignup deliberately reads Blacklist
    // and Settings before taking the lock, to keep the serialized
    // section short -- only the Customers read has to be inside it.
    readsWhileUnlocked: {},
    rowUpdates: {},   // updateRowByKey_ calls -- each is a full read in reality
    flushes: 0,
  };

  const rowsOf = (tab) => (store[tab] = store[tab] || []);

  ctx.sheetToObjects = (tab) => {
    log.reads[tab] = (log.reads[tab] || 0) + 1;
    if (!log.lockHeld) log.readsWhileUnlocked[tab] = (log.readsWhileUnlocked[tab] || 0) + 1;
    if (!(tab in store)) throw new Error('Tab not found: ' + tab);
    return rowsOf(tab);
  };

  // Counted separately from `reads`, because the REAL updateRowByKey_
  // does a full getDataRange().getValues() on every call. Without this
  // counter a suite can assert "one read" while the code under test
  // actually loops the helper N times -- a mutation test caught exactly
  // that hole in the mark_labels_printed coverage.
  ctx.updateRowByKey_ = (tab, keyHeader, keyValue, updates) => {
    log.rowUpdates[tab] = (log.rowUpdates[tab] || 0) + 1;
    const row = rowsOf(tab).find(
      (r) => String(r[keyHeader] || '').trim() === String(keyValue).trim());
    if (!row) return false;
    Object.assign(row, updates);
    return true;
  };

  ctx.appendRowByHeaders_ = (tab, obj) => {
    if (!log.lockHeld) log.appendsWhileUnlocked++;
    rowsOf(tab).push(Object.assign({}, obj));
  };

  // Raw-sheet surface, for the few functions that bypass the helpers
  // (doMarkLabelsPrinted reads/writes a whole column directly).
  ctx.getSheet = (tab) => ({
    appendRow: (row) => { if (tab === ctx.TAB.transactions) log.txns.push(row); },
    getDataRange: () => {
      log.reads[tab] = (log.reads[tab] || 0) + 1;
      const rows = rowsOf(tab);
      const headers = store.__headers && store.__headers[tab]
        ? store.__headers[tab]
        : Object.keys(rows[0] || {});
      return { getValues: () => [headers].concat(rows.map((r) => headers.map((h) => (h in r ? r[h] : '')))) };
    },
    getRange: (r0, c0, n) => ({
      setValues: (vals) => {
        log.writes++;
        const rows = rowsOf(tab);
        const headers = store.__headers && store.__headers[tab]
          ? store.__headers[tab]
          : Object.keys(rows[0] || {});
        vals.forEach((v, i) => { rows[r0 - 2 + i][headers[c0 - 1]] = v[0]; });
      },
    }),
  });

  ctx.LockService = { getScriptLock: () => ({
    waitLock: () => { log.lockHeld = true; },
    releaseLock: () => { log.lockHeld = false; },
  }) };
  ctx.SpreadsheetApp = {
    flush: () => { log.flushes++; },
    getActiveSpreadsheet: () => ({ getSheetByName: () => null, insertSheet: () => null }),
  };
  // Models CacheService faithfully enough to catch real failures: the
  // 100KB-per-value cap is enforced, because a payload that silently
  // exceeded it would make the cache a no-op in production.
  ctx.CacheService = (() => {
    const c = {};
    const CAP = 100 * 1024;
    const put = (k, v) => {
      if (String(v).length > CAP) throw new Error('Argument too large: value');
      c[k] = String(v);
    };
    return { getScriptCache: () => ({
      get: (k) => (k in c ? c[k] : null),
      getAll: (keys) => { const o = {}; keys.forEach((k) => { if (k in c) o[k] = c[k]; }); return o; },
      put,
      putAll: (obj) => { Object.keys(obj).forEach((k) => put(k, obj[k])); },
      remove: (k) => { delete c[k]; },
    }) };
  })();
  ctx.Utilities = {
    getUuid: () => '11111111-1111-1111-1111-111111111111',
    formatDate: (d, tz, fmt) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
    sleep: () => {},
  };
  ctx.UrlFetchApp = { fetch: () => ({ getContentText: () => JSON.stringify({ ok: true }) }) };
  ctx.ContentService = {
    createTextOutput: (s) => ({ setMimeType: () => ({ getContent: () => s }), getContent: () => s }),
    MimeType: { JSON: 'application/json' },
  };

  // Capture mail at the relay boundary so sendOwnerAlert_ /
  // sendAccountLinkEmail_ still execute for real.
  ctx.sendMail_ = (to, subject, body) => { log.mails.push({ to, subject, body }); return true; };

  ctx.__log = log;
  ctx.__store = store;
  ctx.__setHeaders = (tab, headers) => {
    store.__headers = store.__headers || {};
    store.__headers[tab] = headers;
  };
  return ctx;
}

// Minimal assertion runner. Each suite exports run(t).
function suite(name, fn) {
  let pass = 0; const failures = [];
  const t = {
    ok(label, cond) {
      if (cond) { pass++; } else { failures.push(label); }
      console.log((cond ? '  ok   ' : '  FAIL ') + label);
    },
    eq(label, actual, expected) {
      const cond = JSON.stringify(actual) === JSON.stringify(expected);
      this.ok(label + (cond ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`), cond);
    },
    threw(label, fn2, matcher) {
      let msg = null;
      try { fn2(); } catch (e) { msg = e.message; }
      const cond = msg !== null && (!matcher || new RegExp(matcher).test(msg));
      this.ok(label + (msg === null ? ' (did not throw)' : ''), cond);
      return msg;
    },
    noThrow(label, fn2) {
      let msg = null;
      try { fn2(); } catch (e) { msg = e.message; }
      this.ok(label + (msg ? ` (threw: ${msg})` : ''), msg === null);
    },
  };
  console.log('\n' + name);
  fn(t);
  return { name, pass, failures };
}

module.exports = { makeSandbox, suite, BACKEND };
