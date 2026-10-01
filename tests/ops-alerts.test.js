// Two faults that only resolve if somebody is told.
//
// Both were found the same way: a customer meets a failure page at an
// unstaffed cabinet, and nothing anywhere else ever mentions it. The
// billing row with no Stripe customer cannot be charged at all; the
// unknown payment may or may not have taken the customer's money. In
// both cases the sheet looks ordinary afterwards.
const { makeSandbox, suite } = require('./lib/sandbox');

const RENTAL = {
  rental_id: 'RNT-0100', customer_id: 'CUS-0015', item_id: 'SFD-0938',
  status: 'pending', base_price: '5', start_date: new Date().toISOString(),
  base_paid_date: '', extra_charged: 0, notes: '',
};
const CUST = { customer_id: 'CUS-0015', customer_token: 'cus_x', display_name: 'Test',
               email: 't@x.com', payment_status: 'ok', stripe_customer_id: '', status: 'active' };
const ITEM = { item_id: 'SFD-0938', title: 'Some Film', rental_price: '5',
               replacement_cost: '20', in_rotation: 'TRUE', status: 'checked_out' };

function box(over) {
  const ctx = makeSandbox({
    Rentals: [Object.assign({}, RENTAL, (over || {}).rental)],
    Customers: [Object.assign({}, CUST, (over || {}).cust)],
    Catalog: [ITEM],
    Transactions: [],
    Settings: [],
  });
  ctx.getSettingValue = (k) => ((over || {}).settings || {})[k] || '';
  return ctx;
}

module.exports = () => suite('ops alerts: faults nobody would otherwise see', (t) => {
  // --- a charge that cannot possibly happen -----------------------------
  {
    const ctx = box();
    const out = ctx.doRentChargeLookup({ rental_id: 'RNT-0100' });
    t.ok('the lookup still succeeds', out.ok === true);
    t.ok('  ...and does not throw over the anomaly', !!out.rental_id);
    t.eq('one alert was sent', ctx.__log.mails.length, 1);
    const m = ctx.__log.mails[0];
    t.ok('names the rental', /RNT-0100/.test(m.subject + m.body));
    t.ok('names the customer', /CUS-0015/.test(m.body));
    t.ok('states the contradiction', /BLANK stripe_customer_id/.test(m.body));
    t.ok('  ...alongside what the account claims', /payment_status "ok"/.test(m.body));
  }
  {
    // A comp account never charges, so a blank id is normal there.
    const ctx = box({ cust: { comp: 'TRUE' } });
    ctx.doRentChargeLookup({ rental_id: 'RNT-0100' });
    t.eq('a comp account does not alert', ctx.__log.mails.length, 0);
  }
  {
    const ctx = box({ cust: { stripe_customer_id: 'cus_live123' } });
    ctx.doRentChargeLookup({ rental_id: 'RNT-0100' });
    t.eq('a normal customer does not alert', ctx.__log.mails.length, 0);
  }
  {
    // owner_alerts mutes routine signup/rental activity. A fault must not
    // be silenced by it, or the quieter the shop gets the less you hear
    // about real problems.
    const ctx = box({ settings: { owner_alerts: 'off' } });
    ctx.doRentChargeLookup({ rental_id: 'RNT-0100' });
    t.eq('owner_alerts=off does NOT silence a fault', ctx.__log.mails.length, 1);
  }
  {
    // The alert is a side effect. It must never take down the charge path.
    const ctx = box();
    ctx.sendMail_ = () => { throw new Error('mailer down'); };
    t.noThrow('a failing mailer does not break the lookup',
      () => ctx.doRentChargeLookup({ rental_id: 'RNT-0100' }));
  }

  // --- nobody knows whether the money moved -----------------------------
  {
    const ctx = box();
    const out = ctx.doRentalPaymentUnknown({ rental_id: 'RNT-0100', error: 'network timeout' });
    t.ok('returns ok', out.ok === true);

    const row = ctx.__store.Rentals[0];
    // The whole point: record that it is unknown, assert nothing else.
    t.eq('status is left pending, not failed or void', row.status, 'pending');
    t.ok('a dated note lands on the rental', /Payment status UNKNOWN/.test(row.notes));
    t.ok('  ...carrying the reported reason', /network timeout/.test(row.notes));
    t.ok('  ...and warning against blind recharge', /Check Stripe before voiding/.test(row.notes));
    t.ok('no last_failure is stamped', !row.last_failure);
    t.eq('the customer is NOT blocked from renting',
      ctx.__store.Customers[0].payment_status, 'ok');

    t.eq('an audit row is written', ctx.__log.txns.length, 1);
    t.eq('  ...as its own action', ctx.__log.txns[0][4], 'rental_payment_unknown');

    const m = ctx.__log.mails[0];
    t.eq('one alert was sent', ctx.__log.mails.length, 1);
    t.ok('the alert names the rental', /RNT-0100/.test(m.subject));
    t.ok('  ...says it may have succeeded', /may have succeeded/.test(m.body));
    t.ok('  ...and that it often self-heals via the webhook', /webhook/.test(m.body));
    t.ok('  ...with a concrete next step if it does not', /search Stripe for RNT-0100/.test(m.body));
  }
  {
    const ctx = box({ rental: { notes: 'Existing note' } });
    ctx.doRentalPaymentUnknown({ rental_id: 'RNT-0100' });
    const notes = ctx.__store.Rentals[0].notes;
    t.ok('an existing note is preserved', /Existing note/.test(notes));
    t.ok('  ...with the new one appended', /Payment status UNKNOWN/.test(notes));
  }
  {
    const ctx = box();
    t.threw('an unknown rental id throws',
      () => ctx.doRentalPaymentUnknown({ rental_id: 'RNT-9999' }), 'Rental not found');
  }

  // --- a decline on the unattended billing sweep -------------------------
  // rental_payment_failed is called from two places: start-rental, for an
  // ordinary decline with the customer standing at the cabinet, and the
  // billing sweep, which runs at 9am with nobody watching. Only the second
  // should reach the owner. The caller says which via payload.source.
  {
    const ctx = box({ cust: { display_name: 'Melissa', email: 'm@x.com' } });
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-0100', error: 'insufficient_funds', source: 'sweep' });
    t.eq('a sweep decline alerts the owner', ctx.__log.mails.length, 1);
    const m = ctx.__log.mails[0] || { subject: '', body: '' };
    t.ok('  ...naming the rental', /RNT-0100/.test(m.subject));
    t.ok('  ...the customer, so they can be reached', /CUS-0015/.test(m.body) && /m@x\.com/.test(m.body));
    t.ok('  ...and the decline reason', /insufficient_funds/.test(m.body));
    // The record itself must be unchanged by the alert being added.
    t.eq('  ...and still blocks the account as before',
      ctx.__store.Customers[0].payment_status, 'failed');
    t.ok('  ...and still stamps last_failure', /insufficient_funds/.test(ctx.__store.Rentals[0].last_failure));
  }
  {
    // The case the source field exists for: a decline at the cabinet is
    // routine, the customer already sees it, and alerting on it would
    // bury the unattended case.
    const ctx = box();
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-0100', error: 'x', source: 'rental_start' });
    t.eq('a decline at the cabinet does NOT alert', ctx.__log.mails.length, 0);
  }
  {
    // Unlabelled callers stay quiet, so a new path never alerts by accident.
    const ctx = box();
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-0100', error: 'x' });
    t.eq('a missing source does NOT alert', ctx.__log.mails.length, 0);
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-0100', error: 'x', source: 'staff_charge' });
    t.eq('an unrecognised source does NOT alert', ctx.__log.mails.length, 0);
  }
  {
    // Per-RENTAL dedup, unlike the fault alerts: two customers declining
    // in the same run are two separate problems and both must arrive.
    const ctx = makeSandbox({
      Rentals: [Object.assign({}, RENTAL),
                Object.assign({}, RENTAL, { rental_id: 'RNT-0200', customer_id: 'CUS-0020', item_id: 'SFD-0001' })],
      Customers: [Object.assign({}, CUST),
                  Object.assign({}, CUST, { customer_id: 'CUS-0020', customer_token: 'cus_y' })],
      Catalog: [ITEM], Transactions: [], Settings: [],
    });
    ctx.getSettingValue = () => '';
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-0100', error: 'x', source: 'sweep' });
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-0200', error: 'x', source: 'sweep' });
    t.eq('two rentals declining in one run send TWO alerts', ctx.__log.mails.length, 2);
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-0100', error: 'x', source: 'sweep' });
    t.eq('  ...but a re-run on the same rental does not repeat', ctx.__log.mails.length, 2);
  }
  {
    const ctx = box({ settings: { owner_alerts: 'off' } });
    ctx.doRentalPaymentFailed({ rental_id: 'RNT-0100', error: 'x', source: 'sweep' });
    t.eq('owner_alerts=off does NOT silence a sweep decline', ctx.__log.mails.length, 1);
  }
  {
    const ctx = box();
    ctx.sendMail_ = () => { throw new Error('mailer down'); };
    t.noThrow('a dead mailer does not break recording the decline',
      () => ctx.doRentalPaymentFailed({ rental_id: 'RNT-0100', error: 'x', source: 'sweep' }));
    t.eq('  ...and the decline is still recorded', ctx.__store.Customers[0].payment_status, 'failed');
  }
  {
    // The alert looks the customer up for their name and email. That read
    // can throw (a displaced header trips the guard, Sheets can time out),
    // and it runs AFTER the decline is already recorded -- so an escaping
    // throw would tell the sweep a call failed that had in fact succeeded.
    // The dead-mailer case above cannot catch this: alertOps_ guards the
    // mailer itself, so it passed even with the outer guard deleted.
    const ctx = box();
    const real = ctx.sheetToObjects;
    ctx.sheetToObjects = (tab) => {
      if (tab === 'Customers') throw new Error('Required column missing on Customers');
      return real(tab);
    };
    let out;
    t.noThrow('a failing customer lookup does not break the call',
      () => { out = ctx.doRentalPaymentFailed({ rental_id: 'RNT-0100', error: 'x', source: 'sweep' }); });
    t.ok('  ...which still reports ok', !!(out && out.ok));
    t.eq('  ...and the decline is still recorded', ctx.__store.Customers[0].payment_status, 'failed');
  }

  // --- the gate ---------------------------------------------------------
  {
    const ctx = box();
    let called = false;
    ctx.doRentalPaymentUnknown = () => { called = true; return { ok: true }; };
    const res = ctx.doPost({ postData: { contents: JSON.stringify({
      action: 'rental_payment_unknown', rental_id: 'RNT-0100' }) } });
    t.ok('no SERVER_KEY is refused', /unauthorized/.test(res.getContent()));
    t.ok('  ...and the action never runs', !called);

    ctx.doPost({ postData: { contents: JSON.stringify({
      action: 'rental_payment_unknown', rental_id: 'RNT-0100', server_key: ctx.SERVER_KEY }) } });
    t.ok('a valid SERVER_KEY is accepted', called);
  }
});
