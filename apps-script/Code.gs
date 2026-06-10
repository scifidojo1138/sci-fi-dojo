/**
 * Sci-Fi Dojo — Pay-Per-Day Rental Backend (Google Apps Script)
 *
 * Backs rental.html. Storage is a Google Spreadsheet with four tabs
 * (Members, Catalog, Rentals, Config) — see apps-script/SETUP.md for
 * the exact column layout and deployment steps.
 *
 * Billing model:
 *   - Each catalog item has a daily rate (1, 2, or 3 dollars).
 *   - Day of rental counts as day 1; each calendar day after adds one
 *     billed day.
 *   - Billing stops at CAP_DAYS (Config) or when the disc is returned,
 *     whichever comes first.
 *
 * The front end POSTs JSON with an `action` field. Responses are
 * always JSON: { ok: true, ... } or { ok: false, error, auth? }.
 */

var DAY_MS = 86400000;
var SESSION_DAYS = 60; // session tokens expire after this many days

// ----------------------------------------------------------------
// ENTRY POINTS
// ----------------------------------------------------------------

function doGet() {
  return jsonOut({ ok: true, service: 'sfd-rentals', time: new Date().toISOString() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000); // serialize writes so two people can't rent the same disc
  try {
    var p = JSON.parse(e.postData.contents);
    var action = p.action;

    if (action === 'signup') return jsonOut(signup(p));
    if (action === 'login')  return jsonOut(login(p));

    // Everything below requires a valid session.
    var member = memberByToken(p.token);
    if (!member) return jsonOut({ ok: false, error: 'Session expired. Please sign in again.', auth: true });

    if (action === 'catalog') return jsonOut(getCatalog());
    if (action === 'rent')    return jsonOut(rentItem(member, p));
    if (action === 'return')  return jsonOut(returnItem(member, p));
    if (action === 'shelf')   return jsonOut(getShelf(member));
    if (action === 'logout')  return jsonOut(logout(member));

    return jsonOut({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: 'Server error: ' + err.message });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------------------
// SHEET HELPERS
// ----------------------------------------------------------------

function sheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

/** Read a sheet into objects keyed by its header row. */
function readRows(name) {
  var sh = sheet(name);
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _row: i + 1 }; // 1-based sheet row, for writes
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = values[i][j];
    rows.push(obj);
  }
  return rows;
}

function appendRow(name, obj) {
  var sh = sheet(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; }));
}

function updateCell(name, row, header, value) {
  var sh = sheet(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = headers.indexOf(header) + 1;
  if (col === 0) throw new Error('Unknown column ' + header + ' on ' + name);
  sh.getRange(row, col).setValue(value);
}

function config(key, fallback) {
  var rows = readRows('Config');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) return rows[i].value;
  }
  return fallback;
}

function capDays()   { return parseInt(config('cap_days', 14), 10); }
function maxActive() { return parseInt(config('max_active', 3), 10); }

// ----------------------------------------------------------------
// AUTH
// ----------------------------------------------------------------

function hashPassword(password, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password);
  return bytes.map(function(b) {
    var h = (b < 0 ? b + 256 : b).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

function newToken() { return Utilities.getUuid() + '-' + Date.now().toString(36); }

function signup(p) {
  var name = String(p.name || '').trim();
  var email = String(p.email || '').trim().toLowerCase();
  var password = String(p.password || '');
  if (!name || !email || email.indexOf('@') === -1) return { ok: false, error: 'Name and a valid email are required.' };
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };

  var members = readRows('Members');
  for (var i = 0; i < members.length; i++) {
    if (members[i].email === email) return { ok: false, error: 'An account with that email already exists. Sign in instead.' };
  }

  var salt = Utilities.getUuid();
  var token = newToken();
  appendRow('Members', {
    member_id: 'M-' + Date.now().toString(36),
    name: name,
    email: email,
    salt: salt,
    password_hash: hashPassword(password, salt),
    session_token: token,
    token_expires: new Date(Date.now() + SESSION_DAYS * DAY_MS).toISOString(),
    created_at: new Date().toISOString(),
    status: 'active'
  });
  return { ok: true, token: token, member: { name: name, email: email } };
}

function login(p) {
  var email = String(p.email || '').trim().toLowerCase();
  var password = String(p.password || '');
  var members = readRows('Members');
  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    if (m.email !== email) continue;
    if (m.status !== 'active') return { ok: false, error: 'This account is not active. Email us to sort it out.' };
    if (hashPassword(password, m.salt) !== m.password_hash) break;
    var token = newToken();
    updateCell('Members', m._row, 'session_token', token);
    updateCell('Members', m._row, 'token_expires', new Date(Date.now() + SESSION_DAYS * DAY_MS).toISOString());
    return { ok: true, token: token, member: { name: m.name, email: m.email } };
  }
  return { ok: false, error: 'Email or password did not match.' };
}

function memberByToken(token) {
  if (!token) return null;
  var members = readRows('Members');
  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    if (m.session_token === token && m.status === 'active' &&
        m.token_expires && new Date(m.token_expires).getTime() > Date.now()) {
      return m;
    }
  }
  return null;
}

function logout(member) {
  updateCell('Members', member._row, 'session_token', '');
  return { ok: true };
}

// ----------------------------------------------------------------
// BILLING
// ----------------------------------------------------------------

/** Day of rental = day 1; capped. Mirrors billedDays() in rental.html. */
function billedDays(rentedAtIso, asOfMs, cap) {
  var days = Math.floor((asOfMs - new Date(rentedAtIso).getTime()) / DAY_MS) + 1;
  if (days < 1) days = 1;
  if (days > cap) days = cap;
  return days;
}

// ----------------------------------------------------------------
// CATALOG / RENT / RETURN / SHELF
// ----------------------------------------------------------------

function getCatalog() {
  var items = readRows('Catalog').map(function(it) {
    return {
      item_id: it.item_id, title: it.title, year: it.year,
      format: it.format, edition: it.edition, blurb: it.blurb,
      rate: Number(it.rate), status: it.status
    };
  });
  return { ok: true, catalog: items, cap_days: capDays() };
}

function rentItem(member, p) {
  var items = readRows('Catalog');
  var item = null;
  for (var i = 0; i < items.length; i++) {
    if (items[i].item_id === p.item_id) { item = items[i]; break; }
  }
  if (!item) return { ok: false, error: 'That title was not found.' };
  if (item.status !== 'available') return { ok: false, error: 'Sorry — that disc just went out. Check back soon.' };

  var rentals = readRows('Rentals');
  var activeCount = rentals.filter(function(r) {
    return r.member_id === member.member_id && r.status === 'active';
  }).length;
  if (activeCount >= maxActive()) {
    return { ok: false, error: 'You already have ' + maxActive() + ' discs out. Return one first.' };
  }

  var rate = Number(item.rate);
  var cap = capDays();
  var rentalId = 'R-' + Date.now().toString(36);

  updateCell('Catalog', item._row, 'status', 'rented');
  appendRow('Rentals', {
    rental_id: rentalId,
    member_id: member.member_id,
    item_id: item.item_id,
    rate: rate,
    rented_at: new Date().toISOString(),
    status: 'active',
    returned_at: '',
    days_billed: '',
    amount: ''
  });

  return {
    ok: true,
    rental_id: rentalId,
    title: item.title,
    rate: rate,
    cap_days: cap,
    max_charge: rate * cap,
    cabinet_code: config('cabinet_code', '00-00-00')
  };
}

function returnItem(member, p) {
  var rentals = readRows('Rentals');
  var rental = null;
  for (var i = 0; i < rentals.length; i++) {
    if (rentals[i].rental_id === p.rental_id && rentals[i].member_id === member.member_id) {
      rental = rentals[i]; break;
    }
  }
  if (!rental) return { ok: false, error: 'Rental not found on your account.' };
  if (rental.status !== 'active') return { ok: false, error: 'That rental was already closed out.' };

  var days = billedDays(rental.rented_at, Date.now(), capDays());
  var amount = days * Number(rental.rate);

  updateCell('Rentals', rental._row, 'status', 'returned');
  updateCell('Rentals', rental._row, 'returned_at', new Date().toISOString());
  updateCell('Rentals', rental._row, 'days_billed', days);
  updateCell('Rentals', rental._row, 'amount', amount);

  // Put the disc back in circulation.
  var items = readRows('Catalog');
  for (var j = 0; j < items.length; j++) {
    if (items[j].item_id === rental.item_id) {
      updateCell('Catalog', items[j]._row, 'status', 'available');
      break;
    }
  }

  return { ok: true, days_billed: days, amount: amount };
}

function getShelf(member) {
  var cap = capDays();
  var nowMs = Date.now();
  var items = readRows('Catalog');
  var byId = {};
  items.forEach(function(it) { byId[it.item_id] = it; });

  var active = [], history = [], totalSpent = 0;
  readRows('Rentals').forEach(function(r) {
    if (r.member_id !== member.member_id) return;
    var it = byId[r.item_id] || {};
    var rec = {
      rental_id: r.rental_id,
      item_id: r.item_id,
      title: it.title || r.item_id,
      year: it.year, format: it.format, edition: it.edition,
      rate: Number(r.rate),
      rented_at: new Date(r.rented_at).getTime(),
      status: r.status
    };
    if (r.status === 'active') {
      rec.days_billed = billedDays(r.rented_at, nowMs, cap);
      rec.accrued = rec.days_billed * rec.rate;
      active.push(rec);
    } else if (r.status === 'returned') {
      rec.returned_at = new Date(r.returned_at).getTime();
      rec.days_billed = Number(r.days_billed);
      rec.amount = Number(r.amount);
      history.push(rec);
      totalSpent += rec.amount;
    }
  });
  history.sort(function(a, b) { return b.returned_at - a.returned_at; });

  return {
    ok: true,
    member: { name: member.name, email: member.email, created_at: member.created_at },
    active: active,
    history: history,
    total_spent: totalSpent,
    cabinet_code: active.length ? config('cabinet_code', '00-00-00') : null,
    cap_days: cap,
    max_active: maxActive()
  };
}
