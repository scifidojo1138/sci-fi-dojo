// Staff catalog actions: the quick-receive pricing fix, the label
// printer's batching + match counts, and the staff catalog payload.
const { makeSandbox, suite } = require('./lib/sandbox');

const PIN = '1234';
const withPin = (ctx) => { ctx.getSettingValue = (k) => (k === 'staff_pin' ? PIN : (k === 'default_payoff_cost' ? '10' : '')); return ctx; };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

module.exports = () => suite('catalog: quick-receive, label printer, staff payload', (t) => {
  // --- getCatalogStaff --------------------------------------------------
  {
    const ctx = withPin(makeSandbox({ Catalog: [
      { item_id: 'SFD-0001', title: 'Alien', format: 'Blu-ray', status: 'Available',
        in_rotation: 'TRUE', barcode: '012345678905', label_printed_at: '2026-07-30T10:00:00.000Z' },
      { item_id: 'SFD-0002', title: 'Dune', format: '4K UHD', status: 'Checked_Out', in_rotation: 'FALSE' },
    ] }));
    const res = ctx.getCatalogStaff(true); // include the out-of-rotation row
    t.eq('status is lowercased for the UI', res.catalog[0].status, 'available');
    t.eq('in_rotation is a real boolean', res.catalog[0].in_rotation, true);
    t.eq('barcode passes through', res.catalog[0].barcode, '012345678905');
    t.eq('label_printed_at passes through', res.catalog[0].label_printed_at, '2026-07-30T10:00:00.000Z');
    t.eq('unset fields are "" not undefined',
      [res.catalog[1].barcode, res.catalog[1].label_printed_at], ['', '']);
    t.eq('default hides out-of-rotation items', ctx.getCatalogStaff().catalog.length, 1);
    t.eq('all=true includes them (for pre-printing labels)', res.catalog.length, 2);
  }

  // --- add_catalog_item: replacement_cost is required -------------------
  {
    const ctx = withPin(makeSandbox({ Catalog: [], Transactions: [] }));
    t.threw('a missing replacement_cost is rejected',
      () => ctx.doAddCatalogItem({ staff_pin: PIN, title: 'Dune', format: '4K UHD' }), 'replacement_cost');
    t.threw('blank is rejected',
      () => ctx.doAddCatalogItem({ staff_pin: PIN, title: 'D', format: '4K', replacement_cost: '' }));
    t.threw('non-numeric is rejected',
      () => ctx.doAddCatalogItem({ staff_pin: PIN, title: 'D', format: '4K', replacement_cost: 'lots' }));
    t.threw('zero is rejected',
      () => ctx.doAddCatalogItem({ staff_pin: PIN, title: 'D', format: '4K', replacement_cost: 0 }));
    t.eq('nothing was written on any rejection', ctx.__store.Catalog.length, 0);

    // The point of the fix: the cap must be the real value, not $10.
    ctx.doAddCatalogItem({ staff_pin: PIN, title: 'Dune Part Two', format: '4K UHD', barcode: '099', replacement_cost: 35 });
    const row = ctx.__store.Catalog[0];
    t.eq('replacement_cost is written', row.replacement_cost, 35);
    t.eq('payoff cap resolves to $35, NOT the $10 default', ctx.payoffCapCents_(row), 3500);
    t.eq('rentable immediately', [row.status, row.in_rotation, row.disc_count], ['available', 'TRUE', 1]);
    t.ok('audit row logged with the AI prefix',
      ctx.__log.txns.length === 1 && /^AI-/.test(ctx.__log.txns[0][0]) && ctx.__log.txns[0][4] === 'catalog_item_added');
    t.eq('audit row matches the 10-column Transactions schema', ctx.__log.txns[0].length, 10);
    t.threw('a bad staff PIN is rejected',
      () => ctx.doAddCatalogItem({ staff_pin: 'nope', title: 'X', format: 'DVD', replacement_cost: 5 }), 'PIN');
  }

  // --- mark_labels_printed ---------------------------------------------
  const labelCtx = (n) => {
    const rows = [];
    for (let i = 1; i <= n; i++) rows.push({ item_id: 'SFD-' + String(i).padStart(4, '0'), title: 'T', label_printed_at: '' });
    const ctx = withPin(makeSandbox({ Catalog: rows }));
    ctx.__setHeaders('Catalog', ['item_id', 'title', 'label_printed_at']);
    return ctx;
  };
  {
    const ctx = labelCtx(3);
    const out = ctx.doMarkLabelsPrinted({ staff_pin: PIN, item_ids: ['SFD-0001', 'SFD-0002'] });
    t.eq('reports requested + stamped', [out.requested, out.stamped], [2, 2]);
    t.ok('targets stamped with an ISO timestamp',
      ISO.test(ctx.__store.Catalog[0].label_printed_at) && ISO.test(ctx.__store.Catalog[1].label_printed_at));
    t.eq('a row outside the batch is untouched', ctx.__store.Catalog[2].label_printed_at, '');
  }
  {
    // The reason this was rewritten: it used to be one full-sheet read
    // PER LABEL, which is what forced the staff app to chunk batches.
    [1, 40, 300].forEach((n) => {
      const ctx = labelCtx(700);
      const ids = ctx.__store.Catalog.slice(0, n).map((r) => r.item_id);
      const out = ctx.doMarkLabelsPrinted({ staff_pin: PIN, item_ids: ids });
      t.eq(`batch of ${n} over 700 rows: 1 read + 1 write`,
        [ctx.__log.reads.Catalog, ctx.__log.writes], [1, 1]);
      t.eq(`  ...and zero per-item updateRowByKey_ calls (each is a full read)`,
        ctx.__log.rowUpdates.Catalog || 0, 0);
      t.eq(`  ...and stamps all ${n}`, out.stamped, n);
    });
  }
  {
    const ctx = labelCtx(2);
    const missed = ctx.doMarkLabelsPrinted({ staff_pin: PIN, item_ids: ['SFD-9998', 'SFD-9999'] });
    t.eq('a batch where every id missed is now visible (was indistinguishable from success)',
      [missed.requested, missed.stamped], [2, 0]);
    const partial = ctx.doMarkLabelsPrinted({ staff_pin: PIN, item_ids: ['SFD-0001', 'SFD-9999'] });
    t.eq('a partial match is visible too', [partial.requested, partial.stamped], [2, 1]);
    t.eq('duplicate ids in one batch are not double-counted',
      ctx.doMarkLabelsPrinted({ staff_pin: PIN, item_ids: ['SFD-0001', 'SFD-0001'] }).stamped, 1);
    t.eq('an empty batch is a harmless no-op',
      [ctx.doMarkLabelsPrinted({ staff_pin: PIN, item_ids: [] }).stamped,
       ctx.doMarkLabelsPrinted({ staff_pin: PIN }).stamped], [0, 0]);
    t.threw('a bad PIN is rejected', () => ctx.doMarkLabelsPrinted({ staff_pin: 'x', item_ids: ['SFD-0001'] }), 'PIN');
  }
  {
    // If the sheet column is missing this must SHOUT, not silently
    // report success forever while stamping nothing.
    const ctx = withPin(makeSandbox({ Catalog: [{ item_id: 'SFD-0001', title: 'T' }] }));
    ctx.__setHeaders('Catalog', ['item_id', 'title']);
    t.threw('a missing label_printed_at column throws by name',
      () => ctx.doMarkLabelsPrinted({ staff_pin: PIN, item_ids: ['SFD-0001'] }), 'label_printed_at');
  }

  // --- mark_item_active -------------------------------------------------
  {
    const ctx = withPin(makeSandbox({
      Catalog: [
        { item_id: 'SFD-0001', title: 'Alien', status: 'missing', in_rotation: 'FALSE', current_holder_member_id: 'CUS-9', due_date: '2026-01-01' },
        { item_id: 'SFD-0002', title: 'Dune', status: 'checked_out', in_rotation: 'TRUE' },
      ],
      Rentals: [{ rental_id: 'R-OPEN', item_id: 'SFD-0002', status: 'active' }],
      Transactions: [],
    }));
    const out = ctx.doMarkItemActive({ staff_pin: PIN, item_id: 'SFD-0001' });
    t.eq('re-shelving returns the title for the scanner echo', out.title, 'Alien');
    t.eq('back on the shelf', [ctx.__store.Catalog[0].status, ctx.__store.Catalog[0].in_rotation], ['available', 'TRUE']);
    t.eq('and the stale holder/due date are cleared',
      [ctx.__store.Catalog[0].current_holder_member_id, ctx.__store.Catalog[0].due_date], ['', '']);
    t.threw('an item with an OPEN rental is refused (would allow double-renting)',
      () => ctx.doMarkItemActive({ staff_pin: PIN, item_id: 'SFD-0002' }), 'open rental');
  }
});
