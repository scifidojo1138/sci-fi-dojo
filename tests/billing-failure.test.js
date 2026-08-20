// The decline reason on a failed charge, and who may read the billing
// feed. Both exist for the automated sweep: it runs unattended, so a
// failure has to be legible after the fact and the job needs a
// credential that is not a human's PIN.
const { makeSandbox, suite } = require('./lib/sandbox');

const PIN = '4321';
const ctxWith = (rentals) => {
  const ctx = makeSandbox({
    Rentals: rentals,
    Customers: [{ customer_id: 'CUS-0008', customer_token: 't', display_name: 'Eva',
                  email: 'e@x.com', payment_status: 'ok', status: 'active' }],
    Catalog: [{ item_id: 'SFD-0917', title: 'Mystery Men', replacement_cost: '15',
                rental_price: '3', in_rotation: 'TRUE', status: 'checked_out' }],
    Transactions: [],
  });
  ctx.getSettingValue = (k) => (k === 'staff_pin' ? PIN
    : k === 'default_payoff_cost' ? '10' : '');
  ctx.getActiveRentalPromo_ = () => null;
  return ctx;
};
const RENTAL = () => ({ rental_id: 'RNT-1', customer_id: 'CUS-0008', item_id: 'SFD-0917',
  status: 'active', start_date: new Date(Date.now() - 13 * 86400000 + 60000).toISOString(),
  base_price: '3', daily_rate: '1', base_paid_date: new Date(Date.now() - 13 * 86400000).toISOString(),
  extra_charged: 0, last_failure: '' });

module.exports = () => suite('billing: failure reason + sweep access', (t) => {
  // --- the reason lands on the RENTAL, not only in Transactions ---------
  {
    const ctx = ctxWith([RENTAL()]);
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-1', error: 'Your card has expired.' });
    const row = ctx.__store.Rentals[0];
    t.ok('the reason is stamped on the rental', /Your card has expired\./.test(row.last_failure));
    t.ok('  ...dated, so staff can see how stale it is', /^\d{4}-\d{2}-\d{2}: /.test(row.last_failure));
    t.eq('the customer is flagged for the app banner',
      ctx.__store.Customers[0].payment_status, 'failed');
    t.ok('and the audit row is still written',
      ctx.__log.txns.length === 1 && /^RF-/.test(ctx.__log.txns[0][0]));

    // Previously the only record was a Transactions row carrying
    // customer_id + item_id but no rental_id, so a customer who rented the
    // same disc twice could not be tied back to the right rental.
    t.ok('the audit row still cannot identify the rental on its own',
      ctx.__log.txns[0].indexOf('RNT-1') === -1);
  }
  {
    const ctx = ctxWith([RENTAL()]);
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-1' });   // no error supplied
    t.ok('a missing reason still records something legible',
      /Charge failed/.test(ctx.__store.Rentals[0].last_failure));
  }

  // --- it reaches the terminal, and clears when the charge succeeds -----
  {
    const ctx = ctxWith([RENTAL()]);
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-1', error: 'card_declined' });
    const feed = ctx.getRentalBilling({});
    const row = feed.rentals.find((r) => r.rental_id === 'RNT-1');
    t.ok('rental_billing carries the reason', /card_declined/.test(row.last_failure));
    t.ok('  ...alongside what is owed', row.owed_now_cents > 0);

    ctx.doRentChargeRecorded({ rental_id: 'RNT-1', amount_cents: 500 });
    t.eq('a successful charge clears it', ctx.__store.Rentals[0].last_failure, '');
    const after = ctx.getRentalBilling({}).rentals.find((r) => r.rental_id === 'RNT-1');
    t.ok('  ...so the terminal stops showing a resolved failure',
      !after || !after.last_failure);
  }
  {
    // A sheet without the column must not break anything.
    const ctx = ctxWith([RENTAL()]);
    ctx.__setHeaders('Rentals', ['rental_id', 'customer_id', 'item_id', 'status',
      'start_date', 'base_price', 'daily_rate', 'base_paid_date', 'extra_charged']);
    t.noThrow('a Rentals tab with no last_failure column still records the failure',
      () => ctx.doRentalPaymentFailed({ rental_id: 'RNT-1', error: 'x' }));
    t.eq('  ...and the customer is still flagged',
      ctx.__store.Customers[0].payment_status, 'failed');
  }

  // --- who may read the billing feed -----------------------------------
  // Driven through doGet rather than asserted against the source. An
  // earlier version of this checked that "server_key" appeared before
  // "checkStaffPin_" in the text, which passed even with the operands
  // swapped -- the name still occurs first in the var declaration. Only
  // running it proves which one is actually evaluated.
  const gateCtx = () => {
    const ctx = ctxWith([RENTAL()]);
    ctx.SERVER_KEY = 'srv_secret';
    ctx.pinChecks = 0;
    const realPin = ctx.checkStaffPin_;
    ctx.checkStaffPin_ = function (pin) { ctx.pinChecks++; return realPin.call(ctx, pin); };
    return ctx;
  };
  const call = (ctx, params) => JSON.parse(
    ctx.doGet({ parameter: Object.assign({ action: 'rental_billing' }, params) }).getContent());
  {
    const ctx = gateCtx();
    const res = call(ctx, { server_key: 'srv_secret' });
    t.ok('the sweep gets in with SERVER_KEY alone', res.ok === true);
    t.ok('  ...and it really returned the billing feed', Array.isArray(res.rentals));
    // The point of the ordering: checkStaffPin_ counts failures toward a
    // GLOBAL lockout, so a daily job sending no PIN would lock real staff
    // out of the terminal within a few runs.
    t.eq('  ...without ever consulting the PIN (which would count a failure)',
      ctx.pinChecks, 0);
  }
  {
    const ctx = gateCtx();
    t.ok('the staff PIN still works', call(ctx, { pin: PIN }).ok === true);
    t.eq('  ...and that path does check it', ctx.pinChecks, 1);
  }
  {
    const ctx = gateCtx();
    t.eq('neither credential is refused', call(ctx, {}).ok, false);
    t.eq('a wrong key is refused', call(ctx, { server_key: 'nope' }).ok, false);
  }
});
