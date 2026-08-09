// Promo codes, including the optional rental_limit column added
// 2026-08-09 for friends & family. One lifetime redemption per customer
// is the scarce thing -- the code itself is reusable by design.
const { makeSandbox, suite } = require('./lib/sandbox');

const CUST = { customer_id: 'CUS-0001', customer_token: 'cus_tok', display_name: 'Rita',
  status: 'active', rental_limit: 1, free_rental_credits: 0, promo_redeemed_date: '' };

function ctxWith(codes, custOver) {
  const ctx = makeSandbox({
    Customers: [Object.assign({}, CUST, custOver)],
    'Promo Codes': codes,
    Transactions: [],
  });
  ctx.getSettingValue = () => '';
  return ctx;
}
const cust = (ctx) => ctx.__store.Customers[0];

module.exports = () => suite('promo codes: free rental + friends & family limit', (t) => {
  // --- existing behaviour must be untouched -----------------------------
  {
    const ctx = ctxWith([{ code: 'usetheforce', active: 'TRUE', notes: 'public' }]);
    const out = ctx.doRedeemPromo({ token: 'cus_tok', code: 'usetheforce' });
    t.eq('a plain code still grants one free rental', out.free_rental_credits, 1);
    t.eq('and reports no limit change', out.rental_limit, null);
    t.eq('the account limit is untouched', cust(ctx).rental_limit, 1);
    t.ok('redemption is stamped', !!cust(ctx).promo_redeemed_date);
  }
  {
    const ctx = ctxWith([{ code: 'usetheforce', active: 'TRUE' }]);
    t.eq('matching ignores case and spacing',
      ctx.doRedeemPromo({ token: 'cus_tok', code: '  Use The Force ' }).free_rental_credits, 1);
  }
  {
    const ctx = ctxWith([{ code: 'usetheforce', active: 'FALSE' }]);
    t.threw('an inactive code is refused (this is how you revoke)',
      () => ctx.doRedeemPromo({ token: 'cus_tok', code: 'usetheforce' }), 'not valid');
    t.threw('an unknown code is refused',
      () => ctx.doRedeemPromo({ token: 'cus_tok', code: 'nope' }), 'not valid');
  }
  {
    const ctx = ctxWith([{ code: 'a', active: 'TRUE' }, { code: 'b', active: 'TRUE' }]);
    ctx.doRedeemPromo({ token: 'cus_tok', code: 'a' });
    t.threw('one lifetime redemption per customer -- a second code is refused',
      () => ctx.doRedeemPromo({ token: 'cus_tok', code: 'b' }), 'already redeemed');
    t.eq('and nothing was granted twice', cust(ctx).free_rental_credits, 1);
  }

  // --- the friends & family code ----------------------------------------
  {
    const ctx = ctxWith([{ code: 'movienight', active: 'TRUE', rental_limit: 3, notes: 'F&F' }]);
    const out = ctx.doRedeemPromo({ token: 'cus_tok', code: 'movienight' });
    t.eq('raises the account limit', cust(ctx).rental_limit, 3);
    t.eq('and reports it back', out.rental_limit, 3);
    // The whole reason the limit rides on the promo code rather than a
    // separate mechanism: one redemption has to deliver both rewards.
    t.eq('the free rental is granted TOO, not instead', out.free_rental_credits, 1);
    t.eq('and is reflected on the account', cust(ctx).free_rental_credits, 1);
  }
  {
    // Works for an account that already exists -- the thing a signup
    // link could never do.
    const ctx = ctxWith([{ code: 'movienight', active: 'TRUE', rental_limit: 3 }],
      { free_rental_credits: 0, rental_limit: 1, joined_date: '2026-01-01' });
    ctx.doRedeemPromo({ token: 'cus_tok', code: 'movienight' });
    t.eq('a long-standing account can be upgraded in place', cust(ctx).rental_limit, 3);
  }
  {
    const ctx = ctxWith([{ code: 'movienight', active: 'TRUE', rental_limit: 3 }], { rental_limit: 4 });
    const out = ctx.doRedeemPromo({ token: 'cus_tok', code: 'movienight' });
    t.eq('NEVER lowers a limit staff already raised by hand', cust(ctx).rental_limit, 4);
    t.eq('and reports no change', out.rental_limit, null);
    t.eq('but the free rental is still granted', cust(ctx).free_rental_credits, 1);
  }
  {
    const ctx = ctxWith([{ code: 'oops', active: 'TRUE', rental_limit: 50 }]);
    ctx.doRedeemPromo({ token: 'cus_tok', code: 'oops' });
    t.eq('a typo in the sheet is capped at 5, not honoured', cust(ctx).rental_limit, 5);
  }
  {
    const ctx = ctxWith([
      { code: 'blankcol', active: 'TRUE', rental_limit: '' },
      { code: 'junkcol', active: 'TRUE', rental_limit: 'three' },
      { code: 'zerocol', active: 'TRUE', rental_limit: 0 },
    ]);
    ctx.doRedeemPromo({ token: 'cus_tok', code: 'blankcol' });
    t.eq('a blank rental_limit leaves the account alone', cust(ctx).rental_limit, 1);
    const ctx2 = ctxWith([{ code: 'junkcol', active: 'TRUE', rental_limit: 'three' }]);
    ctx2.doRedeemPromo({ token: 'cus_tok', code: 'junkcol' });
    t.eq('non-numeric is ignored, not treated as 0 or NaN', cust(ctx2).rental_limit, 1);
    const ctx3 = ctxWith([{ code: 'zerocol', active: 'TRUE', rental_limit: 0 }]);
    ctx3.doRedeemPromo({ token: 'cus_tok', code: 'zerocol' });
    t.eq('zero is ignored rather than locking the account to 0 rentals', cust(ctx3).rental_limit, 1);
  }
  {
    const ctx = ctxWith([{ code: 'movienight', active: 'TRUE', rental_limit: 3 }]);
    ctx.doRedeemPromo({ token: 'cus_tok', code: 'movienight' });
    const row = ctx.__log.txns[0];
    t.ok('the audit row records the code and the limit change',
      /^PR-/.test(row[0]) && row[4] === 'rental_promo_redeemed' && /movienight/.test(row[7]) && /limit -> 3/.test(row[7]));
    t.eq('audit row matches the 10-column Transactions schema', row.length, 10);
  }
  {
    const ctx = ctxWith([{ code: 'x', active: 'TRUE' }]);
    t.threw('an unknown token is refused', () => ctx.doRedeemPromo({ token: 'nope', code: 'x' }), 'not found');
    t.threw('an empty code is refused', () => ctx.doRedeemPromo({ token: 'cus_tok', code: '' }), 'enter a promo code');
  }
});
