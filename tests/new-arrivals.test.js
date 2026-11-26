// New arrivals (added 2026-11-26): the "Newest" sort and NEW tag in the
// rent app's Browse screen and on /collection, and the backend date they
// both read. The date is the shop-local day a disc reached the shelf:
// Catalog `added_at` when set, else the label print date. Every case runs
// inside block(), so an unexpected throw counts as a failure instead of
// ending the suite.
const { makeSandbox, suite } = require('./lib/sandbox');
const { loadPage } = require('./lib/browser-stub');
const path = require('path');

const PIN = '1234';
const DAY = 86400000;
// Shop-local YYYY-MM-DD, offsetDays from today -- the same day string the
// backend produces and the pages compare against.
const shopDay = (offsetDays) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(Date.now() + offsetDays * DAY));
const noonUtc = (offsetDays) => shopDay(offsetDays) + 'T17:00:00.000Z';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

module.exports = async () => {
  // Build the two page contexts before the synchronous suite starts, since
  // /collection loads through a (resolved) fetch.
  const RENT = path.join(__dirname, '..', 'rent.html');
  const COLLECTION = path.join(__dirname, '..', 'collection.html');
  const publicItems = [
    { id: 'SFD-0010', title: 'Alien',      format: 'DVD', genre: [], avail: true,  added: shopDay(-200) },
    { id: 'SFD-1230', title: 'Singles',    format: 'DVD', genre: [], avail: true,  added: shopDay(-1) },
    { id: 'SFD-1229', title: 'Brazil',     format: 'DVD', genre: [], avail: false, added: shopDay(-1) },
    { id: 'SFD-0500', title: 'Zardoz',     format: 'DVD', genre: [], avail: true,  added: shopDay(-40) },
    { id: 'SFD-0001', title: 'Akira',      format: 'DVD', genre: [], avail: true },  // no date at all
  ];
  const col = loadPage(COLLECTION, '', {
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, catalog: publicItems }) }),
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();

  return suite('new arrivals: Newest sort and NEW tag', (t) => {
    const block = (fn) => {
      try { fn(); } catch (e) { t.ok('case threw unexpectedly: ' + e.message, false); }
    };

    // --- the date itself (backend) ---------------------------------------
    block(() => {
      const ctx = makeSandbox({});
      t.eq('added_at wins over the label date',
        ctx.itemAddedDay_({ added_at: '2026-11-20T15:00:00Z', label_printed_at: '2026-08-02T12:00:00Z' }), '2026-11-20');
      t.eq('blank added_at falls back to the label date (no backfill needed)',
        ctx.itemAddedDay_({ added_at: '', label_printed_at: '2026-08-02T12:00:00Z' }), '2026-08-02');
      t.eq('an evening label in Eastern time keeps its Eastern day, not the UTC one',
        ctx.itemAddedDay_({ label_printed_at: '2026-11-26T02:30:00Z' }), '2026-11-25');
      t.eq('a hand-typed date cell (a Date) works',
        ctx.itemAddedDay_({ added_at: new Date('2026-11-20T05:00:00Z') }), '2026-11-20');
      t.eq('MyMovies last_checked is never used', ctx.itemAddedDay_({ last_checked: '2017-03-11' }), '');
      t.eq('garbage reads as unknown, not a crash', ctx.itemAddedDay_({ added_at: 'soon' }), '');
    });

    // --- the two catalog payloads ----------------------------------------
    const CAT = [
      { item_id: 'SFD-0001', title: 'Alien', format: 'DVD', status: 'available', in_rotation: 'TRUE',
        collection: 'general', label_printed_at: '2026-08-02T12:00:00Z', added_at: '' },
      { item_id: 'SFD-0002', title: 'Brazil', format: 'DVD', status: 'available', in_rotation: 'TRUE',
        collection: 'general', label_printed_at: '', added_at: '' },
    ];
    block(() => {
      const ctx = makeSandbox({ Catalog: CAT.map((r) => Object.assign({}, r)),
        Members: [], Customers: [{ customer_id: 'CUS-0001', customer_token: 'cus_t', status: 'active' }] });
      ctx.getSettingValue = () => '';
      ctx.getActiveRentalPromo_ = () => null;
      const items = ctx.getCatalog('cus_t').catalog;
      t.eq('rent app catalog carries the arrival day', items[0].added, '2026-08-02');
      t.eq('  ...and blank when unknown', items[1].added, '');
    });
    block(() => {
      const ctx = makeSandbox({ Catalog: CAT.map((r) => Object.assign({}, r)) });
      ctx.getSettingValue = () => '';
      const items = ctx.getPublicCatalog().catalog;
      t.eq('/collection feed carries the arrival day', items[0].added, '2026-08-02');
      t.eq('  ...omitted when unknown, to keep the payload lean', 'added' in items[1], false);
      t.ok('  ...never a time of day', !/T/.test(items[0].added));
      t.eq('the cache key moved, so a cached payload without dates is not served', ctx.PUBLIC_CATALOG_CACHE_KEY, 'public_catalog_v2');
    });

    // --- where the date gets written ---------------------------------------
    block(() => {
      const ctx = makeSandbox({ Catalog: [{ item_id: 'SFD-0005' }], Retail: [], Transactions: [] });
      ctx.getSettingValue = (k) => (k === 'staff_pin' ? PIN : '');
      const res = ctx.doAddCatalogItem({ staff_pin: PIN, title: 'New', format: 'DVD', replacement_cost: 12 });
      const row = ctx.__store.Catalog.find((r) => r.item_id === res.item_id);
      t.ok('quick-receive stamps added_at', ISO.test(row.added_at || ''));
    });
    const activeCtx = (inRotation, addedAt) => {
      const ctx = makeSandbox({
        Catalog: [{ item_id: 'SFD-0007', title: 'Back', status: 'missing', in_rotation: inRotation, added_at: addedAt }],
        Rentals: [], Transactions: [],
      });
      ctx.getSettingValue = (k) => (k === 'staff_pin' ? PIN : '');
      ctx.doMarkItemActive({ staff_pin: PIN, item_id: 'SFD-0007' });
      return ctx.__store.Catalog[0];
    };
    block(() => {
      t.ok('mark-active bringing a disc back INTO rotation stamps it new', ISO.test(activeCtx('FALSE', '').added_at || ''));
      t.eq('re-shelving a disc already in rotation does not', activeCtx('TRUE', '2026-08-02T12:00:00Z').added_at, '2026-08-02T12:00:00Z');
    });
    const labelCtx = (rows, headers) => {
      const ctx = makeSandbox({ Catalog: rows });
      ctx.getSettingValue = (k) => (k === 'staff_pin' ? PIN : '');
      ctx.__setHeaders('Catalog', headers);
      return ctx;
    };
    block(() => {
      const ctx = labelCtx([
        { item_id: 'SFD-0001', label_printed_at: '', added_at: '' },                       // first print
        { item_id: 'SFD-0002', label_printed_at: '2026-08-02T12:00:00Z', added_at: '' },   // reprint, never stamped
        // Labelled in September, back into rotation via mark-active in October.
        { item_id: 'SFD-0003', label_printed_at: '2026-09-01T12:00:00Z', added_at: '2026-10-05T15:00:00Z' },
        { item_id: 'SFD-0004', label_printed_at: '', added_at: '' },                       // not in this batch
      ], ['item_id', 'label_printed_at', 'added_at']);
      ctx.doMarkLabelsPrinted({ staff_pin: PIN, item_ids: ['SFD-0001', 'SFD-0002', 'SFD-0003'] });
      const c = ctx.__store.Catalog;
      t.ok('a first label print stamps added_at', ISO.test(c[0].added_at || '') && c[0].added_at === c[0].label_printed_at);
      t.eq('a REPRINT keeps the original label date, so an old disc never looks new', c[1].added_at, '2026-08-02T12:00:00Z');
      t.eq('an existing added_at is never moved, even by a reprint', c[2].added_at, '2026-10-05T15:00:00Z');
      t.eq('a disc outside the batch is untouched', c[3].added_at, '');
    });
    block(() => {
      const ctx = labelCtx([{ item_id: 'SFD-0001', label_printed_at: '' }], ['item_id', 'label_printed_at']);
      const out = ctx.doMarkLabelsPrinted({ staff_pin: PIN, item_ids: ['SFD-0001'] });
      t.eq('without an added_at column, printing still works', out.stamped, 1);
      t.eq('  ...with a single write, as before', ctx.__log.writes, 1);
    });

    // --- rent app Browse ----------------------------------------------------
    const rent = loadPage(RENT, '');
    const r = rent.ctx;
    r.member = { member_id: 'CUS-0001', comp: false, rentals: [], return_pending: [], rental_history: [] };
    r.catalogCache = [
      { item_id: 'SFD-0010', title: 'Alien',   format: 'DVD', status: 'available', genre: [], added: shopDay(-200) },
      { item_id: 'SFD-1230', title: 'Singles', format: 'DVD', status: 'available', genre: [], added: shopDay(-1) },
      { item_id: 'SFD-1229', title: 'Brazil',  format: 'DVD', status: 'checked_out', genre: [], added: shopDay(-1) },
      { item_id: 'SFD-0500', title: 'Zardoz',  format: 'DVD', status: 'available', genre: [], added: shopDay(-40) },
      { item_id: 'SFD-0001', title: 'Akira',   format: 'DVD', status: 'available', genre: [], added: '' },
    ];
    const browseOrder = () => {
      const seen = [];
      (rent.els.browseList.innerHTML.match(/data-id="(SFD-\d+)"/g) || []).forEach((m) => {
        const id = m.slice(9, -1);
        if (seen.indexOf(id) === -1) seen.push(id);
      });
      return seen;
    };
    const rowFor = (id) => {
      const h = rent.els.browseList.innerHTML;
      const i = h.indexOf('data-id="' + id + '"');
      return i < 0 ? '' : h.slice(Math.max(0, h.lastIndexOf('<div class="rental-item', i)), h.indexOf('</div></div>', i) + 12);
    };
    block(() => {
      r.renderBrowseList();
      t.eq('Browse defaults to A-Z (available first), unchanged', browseOrder(),
        ['SFD-0001', 'SFD-0010', 'SFD-1230', 'SFD-0500', 'SFD-1229']);
      r.setBrowseSort('new');
      t.eq('Newest: newest first, same day by higher SFD number, undated last', browseOrder(),
        ['SFD-1230', 'SFD-1229', 'SFD-0500', 'SFD-0010', 'SFD-0001']);
      t.ok('a disc added yesterday is tagged NEW', /ri-tag-new">NEW</.test(rowFor('SFD-1230')));
      t.ok('a disc added 40 days ago is not', !/ri-tag-new/.test(rowFor('SFD-0500')));
      t.ok('an undated disc is not', !/ri-tag-new/.test(rowFor('SFD-0001')));
      t.ok('the NEW tag shows in A-Z too, not only under Newest',
        (r.setBrowseSort('az'), /ri-tag-new/.test(rowFor('SFD-1230'))));
    });
    block(() => {
      r.setBrowseSort('new');
      r.goBrowse();
      t.eq('opening Browse again starts back at A-Z', r.browseSort, 'az');
    });

    // --- /collection --------------------------------------------------------
    const gridOrder = () => (col.els.grid.innerHTML.match(/covers\/(SFD-\d+)\.jpg/g) || []).map((m) => m.slice(7, -4));
    const cardFor = (id) => {
      const h = col.els.grid.innerHTML;
      const i = h.indexOf('covers/' + id + '.jpg');
      return i < 0 ? '' : h.slice(h.lastIndexOf('<div class="card">', i), h.indexOf('<div class="t">', i));
    };
    block(() => {
      t.eq('/collection loaded', col.error, null);
      t.eq('/collection defaults to A-Z, unchanged', gridOrder(),
        ['SFD-0001', 'SFD-0010', 'SFD-1229', 'SFD-1230', 'SFD-0500']);
      const chips = col.els.sortChips.children;
      t.eq('a sort row is offered', chips.map((c) => c.textContent), ['A–Z', 'Newest']);
      t.eq('  ...with A-Z selected', chips[0].getAttribute('aria-pressed'), 'true');
      chips[1].__click();
      t.eq('Newest: newest first, same day by higher SFD number, undated last', gridOrder(),
        ['SFD-1230', 'SFD-1229', 'SFD-0500', 'SFD-0010', 'SFD-0001']);
      t.eq('  ...and Newest is now the selected chip',
        col.els.sortChips.children.map((c) => c.getAttribute('aria-pressed')), ['false', 'true']);
      t.ok('a disc added yesterday gets the New badge', /class="new">New</.test(cardFor('SFD-1230')));
      t.ok('  ...alongside Out when it is rented', /class="out"/.test(cardFor('SFD-1229')) && /class="new"/.test(cardFor('SFD-1229')));
      t.ok('a disc added 40 days ago does not', !/class="new"/.test(cardFor('SFD-0500')));
      t.ok('an undated disc does not', !/class="new"/.test(cardFor('SFD-0001')));
    });
  });
};
