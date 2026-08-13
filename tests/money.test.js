// The accrual math -- the single most consequential code in the backend,
// since it decides what every customer is actually charged.
const { makeSandbox, suite } = require('./lib/sandbox');

// Nudged one minute INSIDE the boundary, deliberately. Exactly n days ago
// is a coin flip: computeAccrued_ evaluates ceil((now - start)/1day) a few
// milliseconds after this timestamp is built, so the quotient lands at
// n.0000001 and ceil returns n+1. The assertion then silently becomes a
// day-(n+1) test and fails by one day's rate, intermittently and with no
// relation to whatever was actually changed. The minute keeps every
// daysAgo(n) firmly on day n without moving any boundary being tested.
const daysAgo = (n) => new Date(Date.now() - n * 86400000 + 60000).toISOString();
const item = (o) => Object.assign({ item_id: 'SFD-0001', rental_price: '3', replacement_cost: '' }, o);

module.exports = () => suite('money: computeAccrued_ / caps / grace', (t) => {
  const ctx = makeSandbox({ Settings: [] });
  ctx.getSettingValue = (k) => (k === 'default_payoff_cost' ? '10' : '');
  const acc = (rental, it) => ctx.computeAccrued_(rental, it);

  // --- included window -------------------------------------------------
  const fresh = acc({ base_price: '3', start_date: daysAgo(1), base_paid_date: daysAgo(1) }, item());
  t.eq('day 1: owes just the base', fresh.owed_total_cents, 300);
  t.eq('day 1: nothing further owed once base is paid', fresh.owed_now_cents, 0);

  const day7 = acc({ base_price: '3', start_date: daysAgo(7), base_paid_date: daysAgo(7) }, item());
  t.eq('day 7 (last included day): still just the base', day7.owed_total_cents, 300);

  // --- the unadvertised grace day --------------------------------------
  const day8 = acc({ base_price: '3', start_date: daysAgo(8), base_paid_date: daysAgo(8) }, item());
  t.eq('day 8 (advertised fee day) still costs nothing -- grace', day8.owed_total_cents, 300);
  const day9 = acc({ base_price: '3', start_date: daysAgo(9), base_paid_date: daysAgo(9) }, item());
  t.eq('day 9: first extended day actually bills', day9.owed_total_cents, 500);
  const day10 = acc({ base_price: '3', start_date: daysAgo(10), base_paid_date: daysAgo(10) }, item());
  t.eq('day 10: two extended days', day10.owed_total_cents, 700);

  // --- the cap is a hard ceiling ---------------------------------------
  const runaway = acc({ base_price: '3', start_date: daysAgo(400), base_paid_date: daysAgo(400) }, item());
  t.eq('a disc kept a year never exceeds the cap', runaway.owed_total_cents, 1000);
  t.ok('and reports cap_reached once fully paid',
    acc({ base_price: '3', start_date: daysAgo(400), base_paid_date: daysAgo(400), extra_charged: 7 }, item()).cap_reached);
  t.eq('an explicit replacement_cost overrides the $10 default',
    acc({ base_price: '3', start_date: daysAgo(400) }, item({ replacement_cost: '35' })).cap_cents, 3500);

  // --- per-rental locked-in daily rate ---------------------------------
  t.eq('blank daily_rate falls back to the standard $2',
    acc({ base_price: '3', start_date: daysAgo(9), daily_rate: '' }, item()).daily_cents, 200);
  t.eq('a stamped promo rate is honoured after the promo ends',
    acc({ base_price: '3', start_date: daysAgo(9), daily_rate: '1' }, item()).daily_cents, 100);
  t.eq('...and it is the rate actually charged',
    acc({ base_price: '3', start_date: daysAgo(10), daily_rate: '1', base_paid_date: daysAgo(10) }, item()).owed_total_cents, 500);

  // --- blank vs explicit zero base (the free-rental bug) ---------------
  t.eq('blank base_price falls back to the item price',
    acc({ base_price: '', start_date: daysAgo(1) }, item()).base_cents, 300);
  t.eq('an explicit 0 stays free (promo credit) and is NOT read as blank',
    acc({ base_price: 0, start_date: daysAgo(1) }, item()).base_cents, 0);
  t.eq('a "0" string is free too', acc({ base_price: '0', start_date: daysAgo(1) }, item()).base_cents, 0);

  // --- returned rentals freeze -----------------------------------------
  const returned = acc({
    base_price: '3', start_date: daysAgo(30), base_paid_date: daysAgo(30), return_date: daysAgo(28),
  }, item());
  t.eq('accrual stops at return_date, not now', returned.days_out, 2);
  t.eq('so a disc logged back on day 2 owes only the base', returned.owed_total_cents, 300);

  // --- tax is Stripe-side only -----------------------------------------
  ctx.getSettingValue = (k) => (k === 'sales_tax_rate' ? '6.625' : (k === 'default_payoff_cost' ? '10' : ''));
  t.eq('tax computes at the NJ rate', ctx.taxCents_(300), 20);
  t.eq('tax never folds into the accrual itself',
    ctx.computeAccrued_({ base_price: '3', start_date: daysAgo(1) }, item()).owed_total_cents, 300);
});
