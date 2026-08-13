// The two read-then-write races fixed 2026-08-07. Both had the same
// shape: the script lock covered the id SCAN but was released before the
// APPEND, so two concurrent callers both scanned before either wrote and
// both minted the same id. Regression coverage asserts on the ORDER of
// events, since that is what the lock actually guarantees.
const { makeSandbox, suite } = require('./lib/sandbox');

const SIGNUP = { display_name: 'Rita', email: 'r@x.com', phone: '7325551212', terms: true };

function signupCtx(customers) {
  const ctx = makeSandbox({
    Customers: customers || [],
    Rentals: [],
    Blacklist: [],
    Transactions: [],
  });
  ctx.getSettingValue = () => '';
  return ctx;
}

module.exports = () => suite('id races: signup + quick-receive are atomic', (t) => {
  // --- customer ids ----------------------------------------------------
  {
    const ctx = signupCtx();
    const res = ctx.doCustomerSignup(SIGNUP);
    t.ok('signup succeeds', res.ok === true);
    t.eq('append happened under the lock', ctx.__log.appendsWhileUnlocked, 0);
    t.ok('the Customers dup-check read was under the lock too',
      !ctx.__log.readsWhileUnlocked.Customers);
    t.ok('Blacklist/Settings were read BEFORE the lock, keeping it short',
      ctx.__log.readsWhileUnlocked.Blacklist > 0);
    t.eq('the write was flushed before releasing', ctx.__log.flushes, 1);
    t.ok('lock released afterwards', ctx.__log.lockHeld === false);
  }
  {
    // Order is the guarantee: never scan,scan,append,append.
    const ctx = signupCtx();
    const events = [];
    const scan = ctx.nextCustomerId_;
    ctx.nextCustomerId_ = function () { events.push('scan'); return scan.call(ctx); };
    const app = ctx.appendRowByHeaders_;
    ctx.appendRowByHeaders_ = function (tab, o) { events.push('append'); return app(tab, o); };
    const a = ctx.doCustomerSignup(SIGNUP);
    const b = ctx.doCustomerSignup({ display_name: 'Sam', email: 's@x.com', phone: '7325559999', terms: true });
    t.eq('events strictly alternate', events.join(','), 'scan,append,scan,append');
    t.ok('two signups get different ids', a.customer_id !== b.customer_id);
    t.eq('and they are sequential', [a.customer_id, b.customer_id], ['CUS-0001', 'CUS-0002']);
  }
  {
    // The realistic trigger: one person double-tapping CREATE ACCOUNT.
    const ctx = signupCtx();
    const first = ctx.doCustomerSignup(SIGNUP);
    const msg = t.threw('a double-tapped signup is rejected as a duplicate',
      () => ctx.doCustomerSignup(SIGNUP), 'already exists');
    t.ok('first tap created the account', first.ok === true);
    t.eq('exactly ONE row exists, not two sharing an id/email', ctx.__store.Customers.length, 1);
    t.ok('lock released despite the throw', ctx.__log.lockHeld === false);
    t.ok('the error points at self-service recovery, not staff',
      /Email me my account link/.test(msg) && !/staff/i.test(msg));
  }
  {
    const ctx = signupCtx();
    ctx.appendRowByHeaders_ = () => { throw new Error('Sheets exploded'); };
    t.threw('an append failure propagates', () => ctx.doCustomerSignup(SIGNUP), 'Sheets exploded');
    t.ok('but the lock is not leaked (finally ran)', ctx.__log.lockHeld === false);
  }
  {
    // A deleted Customers row must not have its id reissued while
    // Rentals history still references it.
    // customer_token is present because a real Customers tab always has
    // it -- the sandbox derives headers from the first row's keys, and
    // nextCustomerId_ now propagates a header-guard failure rather than
    // swallowing it, so a too-minimal fixture would read as a broken tab.
    const ctx = makeSandbox({
      Customers: [{ customer_id: 'CUS-0001', customer_token: 'tok1' }],
      Rentals: [{ customer_id: 'CUS-0009', rental_id: 'RNT-1' }],
    });
    t.eq('id scan spans Customers AND Rentals', ctx.nextCustomerId_(), 'CUS-0010');
  }
  {
    // The scan used to swallow ANY failure reading a tab and carry on with
    // whatever it had. That re-buries the exact bug the header guard was
    // added to surface: a Rentals tab that exists but cannot be read would
    // silently reissue an id still referenced by rental history.
    const broken = () => {
      const ctx = makeSandbox({
        Customers: [{ customer_id: 'CUS-0001', customer_token: 't' }],
        Rentals: [{ customer_id: 'CUS-0009', rental_id: 'RNT-1' }],
      });
      ctx.__setHeaders('Rentals', ['customer_id']);  // rental_id header displaced
      return ctx;
    };
    t.threw('an unreadable Rentals tab now throws instead of minting blind',
      () => broken().nextCustomerId_(), 'rental_id');
    // The old code returned CUS-0002 here: it saw only Customers and
    // ignored CUS-0009 sitting in Rentals. That single call is not itself
    // a collision, but it is the mechanism -- an id present only in
    // rental history stops being counted, so the counter walks back over
    // it and reissues it to somebody new.
    let minted = null;
    try { minted = broken().nextCustomerId_(); } catch(e) {}
    t.eq('  ...and never returns an id minted from a partial scan', minted, null);
  }
  {
    // A tab that genuinely does not exist is still fine to skip -- there
    // are no ids in it to collide with, and Rentals is absent on a fresh
    // install. Only "exists but unreadable" is fatal.
    const ctx = makeSandbox({ Customers: [{ customer_id: 'CUS-0003', customer_token: 't' }] });
    let id = null;
    t.noThrow('a missing Rentals tab is skipped, not fatal',
      () => { id = ctx.nextCustomerId_(); });
    t.eq('  ...and the id still comes from Customers', id, 'CUS-0004');
  }

  // --- catalog ids -----------------------------------------------------
  {
    const ctx = makeSandbox({ Catalog: [{ item_id: 'SFD-0005' }], Transactions: [] });
    ctx.getSettingValue = (k) => (k === 'staff_pin' ? '1234' : '');
    const events = [];
    const scan = ctx.nextCatalogItemId_;
    ctx.nextCatalogItemId_ = function () { events.push('scan'); return scan.call(ctx); };
    const app = ctx.appendRowByHeaders_;
    ctx.appendRowByHeaders_ = function (tab, o) { events.push('append'); return app(tab, o); };
    const a = ctx.doAddCatalogItem({ staff_pin: '1234', title: 'A', format: 'DVD', replacement_cost: 12 });
    const b = ctx.doAddCatalogItem({ staff_pin: '1234', title: 'B', format: 'DVD', replacement_cost: 12 });
    t.eq('events strictly alternate', events.join(','), 'scan,append,scan,append');
    t.eq('two discs received at once get different ids', [a.item_id, b.item_id], ['SFD-0006', 'SFD-0007']);
    t.eq('each append was flushed', ctx.__log.flushes, 2);
    t.eq('nothing appended outside the lock', ctx.__log.appendsWhileUnlocked, 0);
  }
});

// checkStaffPin_ is stubbed true by these tests via getSettingValue('') --
// see catalog-staff.test.js for the real PIN gating coverage.
