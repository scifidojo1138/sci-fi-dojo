// Owner alerts (and their crash-safety), plus the getCustomer payload
// field that lets receipts quote each rental's own locked-in day rate.
const { makeSandbox, suite } = require('./lib/sandbox');

const CUST = { customer_id: 'CUS-0002', customer_token: 'cus_tok', display_name: 'Nate P',
  email: 'n@x.com', phone: '5551212', status: 'active', comp: '', free_rental_credits: 0 };
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function rentCtx(over) {
  const ctx = makeSandbox(Object.assign({
    Customers: [Object.assign({}, CUST)],
    Catalog: [{ item_id: 'SFD-0001', title: 'Alien', format: 'Blu-ray', rental_price: '3', replacement_cost: '' }],
    Rentals: [{ rental_id: 'R1', customer_id: 'CUS-0002', item_id: 'SFD-0001', status: 'pending', base_price: '3' }],
    Settings: [], Transactions: [], 'Rental Promos': [], Blacklist: [],
  }, over));
  ctx.getSettingValue = () => '';
  return ctx;
}

module.exports = () => suite('alerts + customer payload', (t) => {
  // --- owner alerts fire on the real transitions only -------------------
  {
    const ctx = rentCtx();
    ctx.doRentConfirm({ rental_id: 'R1' });
    t.eq('a confirmed rental alerts once', ctx.__log.mails.length, 1);
    t.ok('subject names the item', /New rental/.test(ctx.__log.mails[0].subject) && /Alien/.test(ctx.__log.mails[0].subject));
    t.eq('and the rental went active', ctx.__store.Rentals[0].status, 'active');
  }
  {
    const ctx = rentCtx({ Rentals: [{ rental_id: 'R1', customer_id: 'CUS-0002', item_id: 'SFD-0001', status: 'active', base_price: '3' }] });
    const out = ctx.doRentConfirm({ rental_id: 'R1' });
    t.ok('a redelivered Stripe webhook is acknowledged, not re-run', out.already === true);
    t.eq('and does not re-alert', ctx.__log.mails.length, 0);
  }
  {
    const ctx = rentCtx({ Rentals: [{ rental_id: 'R1', customer_id: 'CUS-0002', item_id: 'SFD-0001', status: 'closed', base_price: '3' }] });
    ctx.doRentConfirm({ rental_id: 'R1' });
    t.eq('a confirm arriving after the rental closed changes nothing', ctx.__log.mails.length, 0);
  }
  {
    const ctx = rentCtx({ Customers: [Object.assign({}, CUST, { comp: 'TRUE' })] });
    ctx.doRentConfirm({ rental_id: 'R1' });
    t.eq('a staff comp rental is not real activity, so no alert', ctx.__log.mails.length, 0);
    t.eq('but it still confirms normally', ctx.__store.Rentals[0].status, 'active');
  }
  {
    const ctx = rentCtx();
    ctx.getSettingValue = (k) => (k === 'owner_alerts' ? 'off' : '');
    ctx.doRentConfirm({ rental_id: 'R1' });
    t.eq('owner_alerts=off sends nothing', ctx.__log.mails.length, 0);
    t.ok('and skips the wasted full-Catalog title lookup entirely',
      (ctx.__log.reads.Catalog || 0) === 0);
  }

  // --- an alert must never break the thing it reports on ----------------
  {
    const ctx = rentCtx();
    ctx.getSettingValue = (k) => { if (k === 'owner_alerts') throw new Error('Service Spreadsheets timed out'); return ''; };
    t.noThrow('a Settings failure cannot fail a Stripe confirm', () => ctx.doRentConfirm({ rental_id: 'R1' }));
    t.eq('and the rental still went active', ctx.__store.Rentals[0].status, 'active');
  }
  {
    const ctx = makeSandbox({ Customers: [], Rentals: [], Blacklist: [], Settings: [], Transactions: [] });
    ctx.getSettingValue = (k) => { if (k === 'owner_alerts') throw new Error('Service Spreadsheets timed out'); return ''; };
    let res = null;
    t.noThrow('a Settings failure cannot fail a signup', () => { res = ctx.doCustomerSignup({
      display_name: 'Rita', email: 'r@x.com', phone: '7325551212', terms: true }); });
    t.ok('signup returns a usable token', res && res.ok === true && !!res.customer_token);
    t.eq('exactly one account row', ctx.__store.Customers.length, 1);
    // The old failure: the row was written, the alert threw, the customer
    // saw "signup failed", retried, and got locked out as a duplicate.
    t.threw('a retry is correctly a duplicate -- because the first one SUCCEEDED',
      () => ctx.doCustomerSignup({ display_name: 'Rita', email: 'r@x.com', phone: '7325551212', terms: true }), 'already exists');
  }
  {
    const ctx = makeSandbox({ Customers: [], Rentals: [], Blacklist: [
      { blacklist_id: 'B1', email: 'bad@x.com', phone: '' }], Settings: [], Transactions: [] });
    ctx.getSettingValue = () => '';
    const res = ctx.doCustomerSignup({ display_name: 'Bad Actor', email: 'bad@x.com', phone: '7325550000', terms: true });
    t.ok('a blacklisted signup still creates a record', res.flagged === true && ctx.__store.Customers.length === 1);
    t.eq('but withholds the cabinet code', res.cabinet_code, null);
    t.ok('and the alert flags it for review', /Flagged/.test(ctx.__log.mails.slice(-1)[0].body));
  }

  // --- getCustomer: per-rental daily rate --------------------------------
  {
    const ctx = makeSandbox({
      Customers: [Object.assign({}, CUST, { rental_limit: 2 })],
      Catalog: [{ item_id: 'SFD-0001', title: 'Alien', format: 'Blu-ray', rental_price: '3', replacement_cost: '' }],
      Rentals: [
        // Locked in at $1/day during a promo that has since ended.
        { rental_id: 'R1', customer_id: 'CUS-0002', item_id: 'SFD-0001', status: 'active', base_price: '3', daily_rate: '1', start_date: daysAgo(2) },
        { rental_id: 'R2', customer_id: 'CUS-0002', item_id: 'SFD-0001', status: 'active', base_price: '3', daily_rate: '', start_date: daysAgo(2) },
      ],
      Settings: [], 'Rental Promos': [],
    });
    ctx.getSettingValue = () => '';
    const open = ctx.getCustomer('cus_tok').customer.rentals;
    const byId = {}; open.forEach((r) => { byId[r.rental_id] = r; });
    t.eq('a rental keeps the promo rate it started under', byId.R1.daily, 100);
    t.eq('a normal rental reports the standard rate', byId.R2.daily, 200);
    t.ok('both carry the cap so receipts can state the max charge', byId.R1.cap === 1000);
  }
  {
    const ctx = makeSandbox({
      Customers: [Object.assign({}, CUST, { comp: 'TRUE' })],
      Catalog: [{ item_id: 'SFD-0001', title: 'Alien', rental_price: '3', replacement_cost: '' }],
      Rentals: [{ rental_id: 'R1', customer_id: 'CUS-0002', item_id: 'SFD-0001', status: 'active', base_price: '3', start_date: daysAgo(40) }],
      Settings: [], 'Rental Promos': [],
    });
    ctx.getSettingValue = () => '';
    const r = ctx.getCustomer('cus_tok').customer.rentals[0];
    t.eq('a comp account is never billed, even 40 days out', r.owed_now, 0);
    t.ok('though the rate itself is still reported', r.daily === 200);
  }
});
