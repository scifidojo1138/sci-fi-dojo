// Staff fee holds (added 2026-11-01). A goodwill pause on one active
// rental: held time never counts toward the extended rental fee, the
// billing sweep never charges it, and no reminder email goes out. The
// staff terminal (onboarding repo) calls rental_hold / rental_hold_release
// directly with the staff PIN. Every case here is about money a customer
// is or is not charged, so each runs inside block(): an unexpected throw
// counts as a failure instead of ending the suite.
const { makeSandbox, suite } = require('./lib/sandbox');

const PIN = '4321';
const DAY = 86400000;
// Every time is taken from one fixed NOW, a minute short of the stated
// age, so the milliseconds the suite takes to run can never tip a
// ceil-of-days count onto the next day.
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo + 60000).toISOString();
const shopDay = (offsetDays) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(Date.now() + offsetDays * DAY));

const ITEM = { item_id: 'SFD-0100', title: 'Solaris', rental_price: '3', replacement_cost: '50' };
const CUST = { customer_id: 'CUS-0001', customer_token: 'cus_tok', display_name: 'Rita', email: 'r@x.com', status: 'active', comp: '' };
// Out 20 days: $3 base + 12 extended days at $2 = $27 owed, base paid.
const BASE = {
  rental_id: 'RNT-1', customer_id: 'CUS-0001', item_id: 'SFD-0100', status: 'active',
  start_date: iso(20 * DAY), base_price: 3, daily_rate: '', base_paid_date: iso(20 * DAY),
  extra_charged: 0, last_charge_date: '', return_date: '', reminders_sent: '',
  hold_from: '', hold_until: '', hold_note: '', hold_paused_ms: '',
};

function ctxWith(rentalOver, opts) {
  const o = opts || {};
  const ctx = makeSandbox({
    Rentals: [Object.assign({}, BASE, rentalOver)],
    Catalog: [Object.assign({}, ITEM)],
    Customers: [Object.assign({}, CUST)],
    Transactions: [],
  });
  ctx.getSettingValue = (k) => (k === 'staff_pin' ? PIN : (o.settings && o.settings[k]) || '');
  return ctx;
}
const rental = (ctx) => ctx.__store.Rentals[0];
const accrue = (ctx) => ctx.computeAccrued_(rental(ctx), ITEM);
const billing = (ctx) => ctx.getRentalBilling().rentals[0];

module.exports = () => suite('fee holds: pause accrual, skip the sweep, skip reminders', (t) => {
  const block = (fn) => {
    try { fn(); } catch (e) { t.ok('case threw unexpectedly: ' + e.message, false); }
  };

  // --- accrual ----------------------------------------------------------
  block(() => {
    const ctx = ctxWith({});
    t.eq('baseline: 20 days out, no hold', accrue(ctx).days_out, 20);
    t.eq('  ...owes $27', accrue(ctx).owed_total_cents, 2700);
  });
  block(() => {
    // Held since day 10, hold still in force: the clock stopped at day 10.
    const ctx = ctxWith({ hold_from: iso(10 * DAY), hold_until: shopDay(5) });
    t.eq('an active hold stops the clock where it began', accrue(ctx).days_out, 10);
    t.eq('  ...so only 2 extended days are owed ($3 + $4)', accrue(ctx).owed_total_cents, 700);
  });
  block(() => {
    // Held from day 10 through 5 days ago: about 5 days paused, then the
    // clock resumed. Not exact to the day, because the hold ends at local
    // midnight rather than at a multiple of 24h from its start.
    const ctx = ctxWith({ hold_from: iso(10 * DAY), hold_until: shopDay(-5) });
    const d = accrue(ctx).days_out;
    t.ok('an expired hold keeps the days it paused (' + d + ')', d >= 14 && d <= 16);
  });
  block(() => {
    const ctx = ctxWith({ hold_paused_ms: 4 * DAY });
    t.eq('time banked from an earlier hold still counts', accrue(ctx).days_out, 16);
  });
  block(() => {
    // Logged a return 2 days into a hold: pause is clipped at the return.
    const ctx = ctxWith({ status: 'return_pending', return_date: iso(8 * DAY),
      hold_from: iso(10 * DAY), hold_until: shopDay(5) });
    t.eq('a hold never pauses time after the logged return', accrue(ctx).days_out, 10);
  });
  block(() => {
    const ctx = ctxWith({ hold_from: iso(10 * DAY), hold_until: shopDay(5) });
    const capped = ctx.computeAccrued_(rental(ctx), Object.assign({}, ITEM, { replacement_cost: '10' }));
    t.ok('the cap still applies, just later', capped.owed_total_cents <= 1000);
  });

  // --- the sweep ---------------------------------------------------------
  block(() => {
    const ctx = ctxWith({});
    t.eq('baseline: an unheld rental owing $24 is swept', billing(ctx).due_for_sweep, true);
  });
  block(() => {
    const ctx = ctxWith({ hold_from: iso(10 * DAY), hold_until: shopDay(5), hold_note: 'Away until the 8th' });
    const b = billing(ctx);
    t.eq('a held rental is never swept, even for what it already owed', b.due_for_sweep, false);
    t.ok('  ...though the balance is still shown', b.owed_now_cents > 0);
    t.eq('  ...and the terminal gets the date', b.hold_until, shopDay(5));
    t.eq('  ...and the note', b.hold_note, 'Away until the 8th');
  });
  block(() => {
    const ctx = ctxWith({ hold_from: iso(10 * DAY), hold_until: shopDay(0) });
    t.eq('the last day of a hold is still held (inclusive)', billing(ctx).due_for_sweep, false);
  });
  block(() => {
    const ctx = ctxWith({ hold_from: iso(10 * DAY), hold_until: shopDay(-1), hold_note: 'old' });
    const b = billing(ctx);
    t.eq('the day after a hold ends, it is swept again', b.due_for_sweep, true);
    t.ok('  ...and reads exactly like no hold', b.hold_until === '' && b.hold_note === '');
  });

  // --- reminders ---------------------------------------------------------
  block(() => {
    // Day 7 is the "due back today" email.
    const day7 = { start_date: iso(6.5 * DAY), base_paid_date: iso(6.5 * DAY) };
    const plain = ctxWith(day7);
    plain.sendRentalReminders();
    t.eq('baseline: a day-7 rental gets its reminder', plain.__log.mails.length, 1);
    const held = ctxWith(Object.assign({ hold_from: iso(DAY), hold_until: shopDay(3) }, day7));
    held.sendRentalReminders();
    t.eq('a held rental gets no reminder email', held.__log.mails.length, 0);
  });

  // --- rental_hold ---------------------------------------------------------
  const hold = (ctx, over) => ctx.doRentalHold(Object.assign(
    { staff_pin: PIN, rental_id: 'RNT-1', hold_until: shopDay(7), note: 'Away' }, over));
  block(() => {
    const ctx = ctxWith({});
    const res = hold(ctx);
    const r = rental(ctx);
    t.ok('a hold is recorded', res.ok && r.hold_until === shopDay(7) && r.hold_note === 'Away');
    t.ok('  ...starting now', Math.abs(new Date(r.hold_from).getTime() - Date.now()) < 5000);
    t.eq('  ...with nothing banked', r.hold_paused_ms, 0);
    const row = ctx.__log.txns[0];
    t.ok('  ...and audited', /^HO-/.test(row[0]) && row[4] === 'rental_fee_hold' && row.length === 10);
    t.eq('  ...and the sweep now skips it', billing(ctx).due_for_sweep, false);
  });
  block(() => {
    const ctx = ctxWith({});
    t.threw('a wrong PIN is refused', () => hold(ctx, { staff_pin: 'nope' }), 'PIN');
    t.threw('a past date is refused', () => hold(ctx, { hold_until: shopDay(-1) }), 'past');
    t.threw('more than 90 days is refused', () => hold(ctx, { hold_until: shopDay(92) }), '90 days');
    t.threw('a date that does not exist is refused', () => hold(ctx, { hold_until: '2026-02-31' }), 'real date');
    t.threw('a blank date is refused', () => hold(ctx, { hold_until: '' }), 'real date');
    t.eq('  ...and none of those wrote anything', rental(ctx).hold_until, '');
    t.eq('today is allowed', hold(ctx, { hold_until: shopDay(0) }).ok, true);
  });
  block(() => {
    const ctx = ctxWith({ status: 'return_pending', return_date: iso(DAY) });
    t.threw('a logged return is refused with the reason', () => hold(ctx), 'already stopped');
    const closed = ctxWith({ status: 'closed' });
    t.threw('a closed rental is refused', () => hold(closed), 'active');
  });
  block(() => {
    // Missing column: updateRowByKey_ would drop it and report success.
    const ctx = ctxWith({});
    delete ctx.__store.Rentals[0].hold_paused_ms;
    t.threw('a missing Rentals column refuses by name', () => hold(ctx), 'hold_paused_ms');
    t.eq('  ...and writes nothing', rental(ctx).hold_until, '');
  });
  block(() => {
    const started = iso(3 * DAY);
    const ctx = ctxWith({ hold_from: started, hold_until: shopDay(2), hold_note: 'a' });
    hold(ctx, { hold_until: shopDay(10), note: 'b' });
    t.eq('extending a hold in force keeps its start', rental(ctx).hold_from, started);
    t.eq('  ...and moves the end', rental(ctx).hold_until, shopDay(10));
  });
  block(() => {
    // Earlier hold ran ~5 days and expired; a new one must not lose it.
    const ctx = ctxWith({ hold_from: iso(10 * DAY), hold_until: shopDay(-5) });
    const before = accrue(ctx).days_out;
    hold(ctx);
    const banked = rental(ctx).hold_paused_ms;
    t.ok('a fresh hold banks the expired one (' + Math.round(banked / DAY) + ' days)', banked > 4 * DAY && banked < 6 * DAY);
    t.eq('  ...so the days owed do not jump back', accrue(ctx).days_out, before);
  });

  // --- rental_hold_release ----------------------------------------------
  block(() => {
    // Held from 10 days + 1 hour ago, so the count is not sitting exactly
    // on a day boundary when the clock resumes (that made this flaky).
    const ctx = ctxWith({ hold_from: iso(10 * DAY + 3600000), hold_until: shopDay(5), hold_note: 'x' });
    const before = accrue(ctx).days_out;
    ctx.doRentalHoldRelease({ staff_pin: PIN, rental_id: 'RNT-1' });
    const r = rental(ctx);
    t.ok('release clears the hold', r.hold_from === '' && r.hold_until === '' && r.hold_note === '');
    t.ok('  ...and banks the ~10 days it covered', Math.abs(r.hold_paused_ms - 10 * DAY - 3600000) < 120000);
    t.eq('  ...so nothing owed changes at the moment of release', accrue(ctx).days_out, before);
    t.eq('  ...and the sweep picks it up again', billing(ctx).due_for_sweep, true);
    t.ok('  ...audited', /^HR-/.test(ctx.__log.txns[0][0]));
  });
  block(() => {
    const ctx = ctxWith({});
    t.threw('releasing with no hold says so', () => ctx.doRentalHoldRelease({ staff_pin: PIN, rental_id: 'RNT-1' }), 'no fee hold');
  });

  // --- rent_charge_lookup: the second line of defence ---------------------
  // The Netlify charger trusts this lookup and charges what it reports, so
  // a held ACTIVE rental must report nothing owed however it got there.
  const lookup = (ctx) => ctx.doRentChargeLookup({ rental_id: 'RNT-1' });
  block(() => {
    const ctx = ctxWith({});
    const res = lookup(ctx);
    t.ok('baseline: an unheld active rental reports what it owes', res.owed_now_cents > 0 && res.held === false);
  });
  block(() => {
    const ctx = ctxWith({ hold_from: iso(10 * DAY), hold_until: shopDay(5) });
    const res = lookup(ctx);
    t.eq('an active rental under a hold reports nothing owed', res.owed_now_cents, 0);
    t.eq('  ...and no tax', res.tax_cents, 0);
    t.eq('  ...and says why', res.held, true);
  });
  block(() => {
    // Returned while the hold was still in date: CHARGE & CLOSE must still
    // collect the pre-hold balance. A hold pauses fees, never forgives them.
    const ctx = ctxWith({ status: 'return_pending', return_date: iso(DAY),
      hold_from: iso(10 * DAY), hold_until: shopDay(5) });
    const res = lookup(ctx);
    t.ok('a held rental that was RETURNED still reports its balance', res.owed_now_cents > 0);
    t.ok('  ...with tax', res.tax_cents > 0);
    t.eq('  ...and is not flagged held', res.held, false);
  });
  block(() => {
    const ctx = ctxWith({ hold_from: iso(10 * DAY), hold_until: shopDay(-1) });
    t.ok('an expired hold no longer zeroes the lookup', lookup(ctx).owed_now_cents > 0);
  });

  // --- the end of a hold is the end of the shop's day ---------------------
  block(() => {
    const ctx = ctxWith({});
    t.eq('summer: Jul 10 ends at 04:00Z on Jul 11', new Date(ctx.holdEndMs_('2026-07-10')).toISOString(), '2026-07-11T04:00:00.000Z');
    t.eq('winter: Dec 10 ends at 05:00Z on Dec 11', new Date(ctx.holdEndMs_('2026-12-10')).toISOString(), '2026-12-11T05:00:00.000Z');
  });
});
