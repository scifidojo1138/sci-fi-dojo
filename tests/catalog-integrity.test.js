// Catalog data-integrity rules, all three prompted by one live incident
// on 2026-08-13: a hand-added Catalog row plus a header cell knocked out
// of place took a customer's rental down at an unstaffed cabinet.
//
//   1. a blank `status` cell means available, not unrentable
//   2. a missing key header fails loudly and by name
//   3. the three "cannot rent this" causes are told apart
const { makeSandbox, suite } = require('./lib/sandbox');

// A hand-added row: staff typed the id, title and in_rotation, and left
// everything else -- including status -- empty. This is the exact shape
// that broke, and it must be rentable.
const HAND_ADDED = {
  item_id: 'SFD-0934', title: 'Hand Added', format: 'Blu-ray',
  in_rotation: 'TRUE', status: '', collection: '', rental_price: '3',
  replacement_cost: '20',
};

const CUSTOMER = {
  customer_id: 'CUS-0010', customer_token: 'cus_tok', display_name: 'Nate',
  email: 'a@b.com', phone: '5550000000', status: 'active', payment_status: 'ok',
  rental_limit: '1', comp: '', free_rental_credits: '0',
};

const rentCtx = (catalog) => {
  const ctx = makeSandbox({
    Catalog: catalog.map((c) => Object.assign({}, c)),
    Customers: [Object.assign({}, CUSTOMER)],
    Rentals: [{ rental_id: '', customer_id: '', item_id: '', status: '' }],
    Transactions: [],
  });
  ctx.getSettingValue = (k) => (k === 'default_payoff_cost' ? '10'
    : k === 'sales_tax_rate' ? '6.625' : '');
  ctx.getActiveRentalPromo_ = () => null;
  return ctx;
};

module.exports = () => suite('catalog integrity: blank status, headers, error causes', (t) => {
  // --- 1. a blank status cell means available ---------------------------
  {
    const ctx = rentCtx([HAND_ADDED]);
    let res = null;
    t.noThrow('a hand-added row with a blank status is rentable',
      () => { res = ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0934' }); });
    t.ok('  ...and really did create the pending rental', !!(res && res.rental_id));
    t.eq('  ...priced normally, not skipped', res && res.base_cents, 300);
  }
  {
    // The same rule has to hold on every surface that reads a status, or
    // the app and the rent check disagree about what is on the shelf.
    const ctx = rentCtx([HAND_ADDED]);
    t.eq('itemStatus_ maps blank to available', ctx.itemStatus_(''), 'available');
    t.eq('  ...and whitespace too', ctx.itemStatus_('   '), 'available');
    t.eq('  ...null/undefined are not "null"/"undefined"',
      [ctx.itemStatus_(null), ctx.itemStatus_(undefined)], ['available', 'available']);
    t.eq('a real status is passed through, lowercased and trimmed',
      [ctx.itemStatus_(' Checked_Out '), ctx.itemStatus_('MISSING')], ['checked_out', 'missing']);
    t.eq('the staff payload reports it as available',
      ctx.getCatalogStaff(true).catalog[0].status, 'available');
    t.eq('mapSheetItem agrees', ctx.mapSheetItem(HAND_ADDED).status, 'available');
  }
  {
    // /collection collapses status to a boolean; a blank cell must not
    // make a shelf-ready title look checked out to the public.
    const ctx = rentCtx([HAND_ADDED]);
    t.eq('the public feed shows it as available',
      ctx.getPublicCatalog().catalog[0].avail, true);
  }

  // --- 2. a missing key header fails loudly -----------------------------
  {
    // The live failure: item_id displaced, so every row's item_id read as
    // undefined and EVERY lookup failed at once with "Item not found",
    // which reads like one missing row rather than a broken column.
    const ctx = rentCtx([HAND_ADDED]);
    ctx.__setHeaders('Catalog', ['title', 'format', 'in_rotation', 'status']);
    t.threw('a Catalog missing item_id names the tab and the column',
      () => ctx.sheetToObjects('Catalog'), 'item_id');
    t.threw('  ...and says where to look', () => ctx.sheetToObjects('Catalog'), 'row 1');
    t.threw('  ...so renting fails with the real cause, not "Item not found"',
      () => ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0934' }), 'header column');
  }
  {
    // Drive the REAL sheetToObjects through the sheet mock. The two
    // assertions above go through the harness stub, which calls the guard
    // itself -- so on their own they prove the guard works but NOT that
    // sheetToObjects still invokes it. Deleting that one call left the
    // whole suite green until this case existed.
    const ctx = rentCtx([HAND_ADDED]);
    ctx.__setHeaders('Catalog', ['title', 'format', 'in_rotation', 'status']);
    t.threw('the real sheetToObjects invokes the guard, not just the harness',
      () => ctx.__realSheetToObjects('Catalog'), 'item_id');
    ctx.__setHeaders('Catalog', ['item_id', 'title', 'format', 'in_rotation', 'status']);
    t.noThrow('  ...and passes once the header is back',
      () => ctx.__realSheetToObjects('Catalog'));
    t.eq('  ...still mapping rows by header name',
      ctx.__realSheetToObjects('Catalog')[0].item_id, 'SFD-0934');
  }
  {
    const ctx = rentCtx([HAND_ADDED]);
    // customer_id is present, so the guard has to get past it and name
    // the one that is actually missing.
    ctx.__setHeaders('Customers', ['customer_id', 'display_name', 'email', 'status']);
    t.threw('a Customers tab missing customer_token throws by name',
      () => ctx.sheetToObjects('Customers'), 'customer_token');
  }
  {
    // Guarding only the key columns: an unlisted tab, and a listed tab
    // missing a NON-key column, must both still read fine.
    const ctx = rentCtx([HAND_ADDED]);
    t.noThrow('a tab with no required headers is unaffected',
      () => ctx.sheetToObjects('Transactions'));
    ctx.__setHeaders('Catalog', ['item_id', 'title']);
    t.noThrow('Catalog without the optional columns still reads',
      () => ctx.sheetToObjects('Catalog'));
  }

  // --- an unreadable Rentals tab must not silently unlock renting -------
  {
    // doRentStart reads Rentals for two guards: the mid-payment lock on
    // this disc, and the customer's rental limit. A bare catch left the
    // list empty, which passes BOTH -- so a broken header would quietly
    // allow two people to rent the same disc, and one customer to take
    // out any number at once. Empty must mean "no rentals", never
    // "could not tell".
    const brokenRentals = () => {
      const ctx = rentCtx([HAND_ADDED]);
      ctx.__store.Rentals = [{ customer_id: 'CUS-0010', item_id: 'SFD-0934', status: 'active' }];
      ctx.__setHeaders('Rentals', ['customer_id', 'item_id', 'status']); // rental_id displaced
      return ctx;
    };
    t.threw('an unreadable Rentals tab stops the rental instead of allowing it',
      () => brokenRentals().doRentStart({ token: 'cus_tok', item_id: 'SFD-0934' }), 'rental_id');
    const ctx = brokenRentals();
    try { ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0934' }); } catch(e) {}
    t.eq('  ...and no pending rental row is written', ctx.__store.Rentals.length, 1);
  }
  {
    // The limit check specifically: this customer is at their limit of 1,
    // and that fact lives in the tab that cannot be read.
    const ctx = rentCtx([HAND_ADDED]);
    ctx.__store.Rentals = [
      { rental_id: 'RNT-1', customer_id: 'CUS-0010', item_id: 'SFD-0001', status: 'active' },
    ];
    t.threw('a customer at their limit is refused when Rentals IS readable',
      () => ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0934' }), 'limit');
  }
  {
    // An absent tab stays tolerated: there are genuinely no rentals to
    // conflict with, which is the state of a brand new install.
    const ctx = rentCtx([HAND_ADDED]);
    delete ctx.__store.Rentals;
    t.noThrow('a missing Rentals tab does not block the first ever rental',
      () => ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0934' }));
  }

  // --- 3. the three causes are told apart -------------------------------
  {
    const cases = [
      ['a genuinely missing row', 'SFD-9999', [HAND_ADDED], 'not found'],
      ['out of rotation', 'SFD-0002',
        [{ item_id: 'SFD-0002', title: 'Retired', in_rotation: 'FALSE', status: 'available' }],
        'not in rotation'],
      ['already checked out', 'SFD-0003',
        [{ item_id: 'SFD-0003', title: 'Out', in_rotation: 'TRUE', status: 'checked_out' }],
        'checked_out'],
      ['damaged', 'SFD-0004',
        [{ item_id: 'SFD-0004', title: 'Broken', in_rotation: 'TRUE', status: 'damaged' }],
        'damaged'],
      ['a vault title', 'SFD-0005',
        [{ item_id: 'SFD-0005', title: 'Vault', in_rotation: 'TRUE', status: 'available',
           collection: 'vault' }],
        'vault'],
    ];
    cases.forEach(([label, id, catalog, want]) => {
      t.threw(`${label} says so: "${want}"`,
        () => rentCtx(catalog).doRentStart({ token: 'cus_tok', item_id: id }), want);
    });

    // The whole point: these used to be one shared message, so the alert
    // email never said which of them to go and look at.
    const msgs = cases.map(([, id, catalog]) => {
      try { rentCtx(catalog).doRentStart({ token: 'cus_tok', item_id: id }); return ''; }
      catch (e) { return String(e.message); }
    });
    t.eq('all five causes produce distinct messages', new Set(msgs).size, 5);
    t.ok('and every one still names the item id',
      msgs.every((m, i) => m.indexOf(cases[i][1]) !== -1));
  }
});
