// The billing-sweep heartbeat. Exists because the Netlify function log is
// the only other evidence a scheduled sweep ran, and it ages out within
// hours -- so after a day there is no way to distinguish a healthy sweep
// from one that silently stopped charging.
const { makeSandbox, suite } = require('./lib/sandbox');

const KEY = 'srv_secret';
const ctx_ = () => {
  const ctx = makeSandbox({
    Rentals: [], Customers: [], Catalog: [], Settings: [], Transactions: [],
  });
  ctx.SERVER_KEY = KEY;
  const store = {};
  ctx.getSettingValue = (k) => (k === 'staff_pin' ? '1234' : (store[k] || ''));
  ctx.setSettingValue_ = (k, v) => { store[k] = v; return true; };
  ctx.__settings = store;
  return ctx;
};
const call = (ctx, params) => JSON.parse(
  ctx.doGet({ parameter: Object.assign({ action: 'rental_billing' }, params) }).getContent());

module.exports = () => suite('billing sweep: heartbeat', (t) => {
  // --- only the automated path stamps -----------------------------------
  {
    const ctx = ctx_();
    t.eq('a server-key read succeeds', call(ctx, { server_key: KEY }).ok, true);
    t.ok('and stamps last_sweep_at', !!ctx.__settings.last_sweep_at);
    t.ok('  ...as an ISO timestamp',
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(ctx.__settings.last_sweep_at));
  }
  {
    // Staff open the terminal constantly and it reads this same action. A
    // heartbeat any human page load could refresh would report health the
    // sweep never had -- the exact false negative this must not produce.
    const ctx = ctx_();
    t.eq('a staff PIN read succeeds', call(ctx, { pin: '1234' }).ok, true);
    t.eq('  ...but does NOT stamp', ctx.__settings.last_sweep_at, undefined);
  }
  {
    const ctx = ctx_();
    t.eq('an unauthorized read is refused', call(ctx, {}).ok, false);
    t.eq('  ...and stamps nothing', ctx.__settings.last_sweep_at, undefined);
    t.eq('a wrong key is refused', call(ctx, { server_key: 'nope' }).ok, false);
    t.eq('  ...and stamps nothing', ctx.__settings.last_sweep_at, undefined);
  }

  // --- a failed write must never break billing ---------------------------
  {
    const ctx = ctx_();
    ctx.setSettingValue_ = () => { throw new Error('Service Spreadsheets timed out'); };
    let res = null;
    t.noThrow('a heartbeat write failure does not break the sweep',
      () => { res = call(ctx, { server_key: KEY }); });
    t.eq('  ...and the billing list still comes back', res && res.ok, true);
  }

  // --- how it reads on the Dashboard -------------------------------------
  {
    const ctx = ctx_();
    const at = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
    ctx.Utilities = { formatDate: () => 'Sep 15' };

    ctx.__settings.last_sweep_at = at(0);
    t.ok('today reads as today', /today/.test(ctx.sweepHeartbeatLabel_()));
    ctx.__settings.last_sweep_at = at(1);
    t.ok('one day reads as yesterday', /yesterday/.test(ctx.sweepHeartbeatLabel_()));
    ctx.__settings.last_sweep_at = at(14);
    t.ok('a stalled sweep reads as a growing number of days',
      /14 days ago/.test(ctx.sweepHeartbeatLabel_()));
    delete ctx.__settings.last_sweep_at;
    t.ok('never-run says so plainly', /never/.test(ctx.sweepHeartbeatLabel_()));
    ctx.__settings.last_sweep_at = 'not a date';
    t.noThrow('garbage in the cell does not throw', () => ctx.sweepHeartbeatLabel_());
  }
});
