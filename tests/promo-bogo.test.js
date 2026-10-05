// Rent-one-get-one-free codes and promo-code dates (added 2026-10-03).
// Both are optional Promo Codes columns where blank means today's
// behaviour, so every free-rental card already in someone's wallet keeps
// the promise printed on it.
const { makeSandbox, suite } = require('./lib/sandbox');

const ITEM = { item_id: 'SFD-0100', title: 'Alien', format: 'Blu-ray', in_rotation: 'TRUE',
  status: 'available', collection: '', rental_price: '3', replacement_cost: '20' };
const ITEM2 = Object.assign({}, ITEM, { item_id: 'SFD-0101', title: 'Aliens' });

const CUST = { customer_id: 'CUS-0001', customer_token: 'cus_tok', display_name: 'Rita',
  email: 'r@x.com', phone: '5550000000', status: 'active', payment_status: 'ok',
  stripe_customer_id: 'cus_stripe', comp: '', rental_limit: 1,
  free_rental_credits: 0, promo_redeemed_date: '', credit_requires_paid_rental: '' };

// A confirmed rental the customer paid $3 for, and one a promo credit
// covered (base stamped at exactly 0 -- confirmed, but nothing paid).
const PAID = { rental_id: 'R-PAID', customer_id: 'CUS-0001', item_id: 'SFD-0101', status: 'closed',
  base_price: 3, base_paid_date: '2026-09-01T12:00:00Z', start_date: '2026-09-01T12:00:00Z' };
const FREE = Object.assign({}, PAID, { rental_id: 'R-FREE', base_price: 0 });
const PENDING = Object.assign({}, PAID, { rental_id: 'R-PEND', status: 'pending', base_paid_date: '' });

function ctxWith({ codes = [], cust = {}, rentals = [], today = '2026-10-15' } = {}) {
  const ctx = makeSandbox({
    Customers: [Object.assign({}, CUST, cust)],
    'Promo Codes': codes,
    Catalog: [Object.assign({}, ITEM), Object.assign({}, ITEM2)],
    Rentals: rentals.length ? rentals.map((r) => Object.assign({}, r))
      : [{ rental_id: '', customer_id: '', item_id: '', status: '' }],
    Transactions: [],
    Settings: [], 'Rental Promos': [],
  });
  ctx.getSettingValue = (k) => (k === 'owner_alerts' ? 'off' : '');
  ctx.getActiveRentalPromo_ = () => null;
  ctx.todayLocal_ = () => today;
  return ctx;
}
const cust = (ctx) => ctx.__store.Customers[0];
const BOGO = { code: 'rentone', active: 'TRUE', requires_paid_rental: 'TRUE' };

module.exports = () => suite('promo codes: rent one get one free + code dates', (t) => {
  // Each case runs inside block(): a call expected to succeed that THROWS
  // instead (which is what most regressions here look like) must count as
  // a failure and let the remaining cases run. Unguarded, one throw ended
  // the suite and a broken date check reported zero failures.
  const block = (fn) => {
    try { fn(); } catch (e) { t.ok('case threw unexpectedly: ' + e.message, false); }
  };
  // --- dates -------------------------------------------------------------
  block(() => {
    const ctx = ctxWith({ codes: [{ code: 'fall', active: 'TRUE', date_start: '2026-10-01', date_end: '2026-10-31' }] });
    t.eq('a code inside its dates redeems', ctx.doRedeemPromo({ token: 'cus_tok', code: 'fall' }).free_rental_credits, 1);
  });
  block(() => {
    const on = (today) => ctxWith({ today, codes: [{ code: 'fall', active: 'TRUE', date_start: '2026-10-01', date_end: '2026-10-31' }] });
    t.eq('the first day counts (inclusive start)', on('2026-10-01').doRedeemPromo({ token: 'cus_tok', code: 'fall' }).ok, true);
    t.eq('the last day counts (inclusive end)', on('2026-10-31').doRedeemPromo({ token: 'cus_tok', code: 'fall' }).ok, true);
    t.threw('the day after, it says EXPIRED with the date, not "not valid"',
      () => on('2026-11-01').doRedeemPromo({ token: 'cus_tok', code: 'fall' }), '^That code expired on October 31\\.$');
    t.threw('before it starts, it says when it starts',
      () => on('2026-09-30').doRedeemPromo({ token: 'cus_tok', code: 'fall' }), '^That code starts on October 1\\.$');
    const late = on('2026-11-01');
    try { late.doRedeemPromo({ token: 'cus_tok', code: 'fall' }); } catch (e) {}
    t.ok('an expired code grants nothing and burns nothing',
      cust(late).free_rental_credits === 0 && !cust(late).promo_redeemed_date);
  });
  block(() => {
    // A sheet date cell arrives as a Date at local midnight. Oct 31
    // 00:00 Eastern is 04:00Z the same day, so it must still read Oct 31.
    const ctx = ctxWith({ today: '2026-11-01',
      codes: [{ code: 'fall', active: 'TRUE', date_end: new Date('2026-10-31T04:00:00Z') }] });
    t.threw('a real Date cell from the sheet is handled', () => ctx.doRedeemPromo({ token: 'cus_tok', code: 'fall' }), 'October 31');
  });
  block(() => {
    const ctx = ctxWith({ today: '2030-01-01', codes: [{ code: 'usetheforce', active: 'TRUE', date_start: '', date_end: '' }] });
    t.eq('blank dates never expire (every existing card keeps working)',
      ctx.doRedeemPromo({ token: 'cus_tok', code: 'usetheforce' }).free_rental_credits, 1);
  });
  block(() => {
    const ctx = ctxWith({ today: '2026-11-01', codes: [{ code: 'fall', active: 'FALSE', date_end: '2026-10-31' }] });
    t.threw('an inactive code stays generic, even past its date (revoking does not explain itself)',
      () => ctx.doRedeemPromo({ token: 'cus_tok', code: 'fall' }), '^That code is not valid\\.$');
  });
  block(() => {
    // Reusing a word for a new season: an expired row and a live row with
    // the same code. The live one must win, wherever it sits in the tab.
    const ctx = ctxWith({ today: '2026-11-05', codes: [
      { code: 'movienight', active: 'TRUE', date_end: '2026-10-31' },
      { code: 'movienight', active: 'TRUE', date_start: '2026-11-01', requires_paid_rental: 'TRUE' },
    ] });
    const out = ctx.doRedeemPromo({ token: 'cus_tok', code: 'movienight' });
    t.ok('a live row beats an expired row with the same code', out.ok && out.requires_paid_rental === true);
  });

  // --- redeeming a BOGO code --------------------------------------------
  block(() => {
    const ctx = ctxWith({ codes: [BOGO] });
    const out = ctx.doRedeemPromo({ token: 'cus_tok', code: 'rentone' });
    t.eq('a BOGO code still grants the credit up front', cust(ctx).free_rental_credits, 1);
    t.eq('and marks the customer, not just the code', cust(ctx).credit_requires_paid_rental, 'TRUE');
    t.ok('and reports it is not usable yet', out.requires_paid_rental === true && out.free_rental_ready === false);
    t.ok('the audit row says which kind it was', /rent one get one/.test(ctx.__log.txns[0][7]));
  });
  block(() => {
    const ctx = ctxWith({ codes: [BOGO], rentals: [PAID] });
    t.eq('a customer who already paid for a rental is ready at once',
      ctx.doRedeemPromo({ token: 'cus_tok', code: 'rentone' }).free_rental_ready, true);
  });
  block(() => {
    const ctx = ctxWith({ codes: [{ code: 'usetheforce', active: 'TRUE' }] });
    const out = ctx.doRedeemPromo({ token: 'cus_tok', code: 'usetheforce' });
    t.ok('a plain code is NOT marked and is ready at once',
      !cust(ctx).credit_requires_paid_rental && out.free_rental_ready === true && out.requires_paid_rental === false);
  });
  block(() => {
    // Without the column, updateRowByKey_ would drop the flag silently and
    // a BOGO credit would become an immediate free rental -- the exact
    // gap BOGO exists to close. Refuse before writing anything.
    const ctx = ctxWith({ codes: [BOGO] });
    delete ctx.__store.Customers[0].credit_requires_paid_rental;
    t.threw('a missing Customers column refuses a BOGO redemption by name',
      () => ctx.doRedeemPromo({ token: 'cus_tok', code: 'rentone' }), 'credit_requires_paid_rental');
    t.ok('  ...and nothing was granted or stamped',
      cust(ctx).free_rental_credits === 0 && !cust(ctx).promo_redeemed_date);
    const ctx2 = ctxWith({ codes: [{ code: 'usetheforce', active: 'TRUE' }] });
    delete ctx2.__store.Customers[0].credit_requires_paid_rental;
    t.eq('  ...but a plain code still works without that column',
      ctx2.doRedeemPromo({ token: 'cus_tok', code: 'usetheforce' }).free_rental_credits, 1);
  });

  // --- applying the credit (doRentStart) --------------------------------
  const bogoHolder = { free_rental_credits: 1, promo_redeemed_date: '2026-10-01', credit_requires_paid_rental: 'TRUE' };
  block(() => {
    const ctx = ctxWith({ cust: bogoHolder });
    const res = ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0100' });
    t.eq('BOGO with no paid rental: the first rental is charged in full', res.base_cents, 300);
    t.eq('  ...and is not flagged free to start-rental', res.free_credit, false);
    const row = ctx.__store.Rentals.find((r) => r.rental_id === res.rental_id);
    t.ok('  ...stamped at the real price, so confirm will not spend the credit', row.base_price === 3);
  });
  block(() => {
    const ctx = ctxWith({ cust: bogoHolder, rentals: [FREE] });
    t.eq('a FREE rental does not unlock the next free one',
      ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0100' }).base_cents, 300);
  });
  block(() => {
    const ctx = ctxWith({ cust: bogoHolder, rentals: [PENDING] });
    t.eq('an unconfirmed (pending) rental does not count as paid',
      ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0100' }).base_cents, 300);
  });
  block(() => {
    const ctx = ctxWith({ cust: bogoHolder, rentals: [PAID] });
    const res = ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0100' });
    t.eq('after a paid rental, the next one is free', res.base_cents, 0);
    t.eq('  ...and flagged free', res.free_credit, true);
  });
  block(() => {
    const someoneElse = Object.assign({}, PAID, { customer_id: 'CUS-0099' });
    const ctx = ctxWith({ cust: bogoHolder, rentals: [someoneElse] });
    t.eq("another customer's paid rental does not count",
      ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0100' }).base_cents, 300);
  });
  block(() => {
    const ctx = ctxWith({ cust: { free_rental_credits: 1, promo_redeemed_date: '2026-10-01' } });
    t.eq('an old free-rental card still gives a free FIRST rental (unchanged)',
      ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0100' }).base_cents, 0);
  });

  // --- the whole loop, through confirm ----------------------------------
  block(() => {
    const ctx = ctxWith({ codes: [BOGO] });
    ctx.doRedeemPromo({ token: 'cus_tok', code: 'rentone' });
    const first = ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0100' });
    ctx.doRentConfirm({ rental_id: first.rental_id });
    t.eq('confirming the paid rental keeps the credit banked', cust(ctx).free_rental_credits, 1);
    // Return and close it so the limit of 1 frees up.
    ctx.__store.Rentals.find((r) => r.rental_id === first.rental_id).status = 'closed';
    ctx.__store.Catalog.find((c) => c.item_id === 'SFD-0100').status = 'available';
    const second = ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0100' });
    t.eq('the second rental is free', second.base_cents, 0);
    ctx.doRentConfirm({ rental_id: second.rental_id });
    t.eq('and confirming it spends the credit', cust(ctx).free_rental_credits, 0);
    ctx.__store.Rentals.find((r) => r.rental_id === second.rental_id).status = 'closed';
    ctx.__store.Catalog.find((c) => c.item_id === 'SFD-0100').status = 'available';
    t.eq('the third is charged again', ctx.doRentStart({ token: 'cus_tok', item_id: 'SFD-0100' }).base_cents, 300);
  });

  // --- the account payload the app reads --------------------------------
  block(() => {
    const flag = (custOver, rentals) =>
      ctxWith({ cust: custOver, rentals }).getCustomer('cus_tok').customer.free_rental_ready;
    t.eq('payload: BOGO credit with no paid rental is not ready', flag(bogoHolder, []), false);
    t.eq('payload: BOGO credit after a paid rental is ready', flag(bogoHolder, [PAID]), true);
    t.eq('payload: a plain credit is ready', flag({ free_rental_credits: 1 }, []), true);
    t.eq('payload: no credit at all never reads as restricted', flag({}, []), true);
  });
});
