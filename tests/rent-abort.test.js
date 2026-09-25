// What happens when the customer's phone gives up mid-rental.
//
// From a live incident (2026-09-25, CUS-0015): start-rental charges the
// card and THEN records the rental, so a client timeout can land after
// the money moved. Stripe took $3.20 at 2:05:42, submitRent's catch ran
// at 2:05:54, and the app told her "This rental did not go through. You
// have not been charged." Stripe emailed her a receipt at 2:06.
//
// An abort is the one failure where the request is known to have left
// and the outcome is not known at all. So the app reconciles instead of
// guessing. Driving the real submitRent is the only way to test that --
// the routing lives inside it, and reading the file cannot see it.
const path = require('path');
const { suite } = require('./lib/sandbox');
const { loadPage } = require('./lib/browser-stub');

const RENT = path.join(__dirname, '..', 'rent.html');
const abortError = () => Object.assign(new Error('Fetch is aborted'), { name: 'AbortError' });

// A page with submitRent's collaborators stubbed at the boundaries:
// the network, the account refresh, and the two render calls.
function rig(opts) {
  const page = loadPage(RENT, '?token=cus_x');
  const ctx = page.ctx;
  ctx.__timers(true);

  ctx.token = 'cus_x';
  ctx.member = { comp: false, has_card: true, payment_status: 'ok',
                 rentals: [], return_pending: [], all_open: [], rental_limit: 3,
                 cabinet_code: '' };
  ctx.rentSelection = { item_id: 'SFD-0567', title: '28 Days Later',
                        base_cents: 300, cap_cents: 2000 };
  ctx.backendGetMemberStatus = () => ({ canCheckout: true });
  ctx.reportClientError = () => { page.reported = (page.reported || 0) + 1; };
  ctx.renderRentalTicket = (r) => { page.ticket = r; };
  ctx.showSuccess = (k, title, msg, rows) => { page.success = { title, msg, rows }; };
  ctx.appBusy = () => {};

  page.refreshes = 0;
  ctx.refreshAfterRent = async () => {
    page.refreshes++;
    if (opts.landsOnRefresh && page.refreshes >= opts.landsOnRefresh) {
      ctx.member.all_open = [{ rental_id: 'RNT-953593852', item_id: 'SFD-0567',
                               title: '28 Days Later', start_date: new Date().toISOString() }];
    }
  };
  ctx.fetchWithTimeout = () => Promise.reject(opts.error || abortError());
  return page;
}

const alertText = (page) =>
  (page.els.checkoutAlert.innerHTML || '').replace(/<[^>]+>/g, ' ');

module.exports = () => suite('rent.html: a phone that gives up mid-rental', async (t) => {
  // --- the live case: it actually worked -------------------------------
  {
    // The server finished while the phone was already giving up, so the
    // rental is there on the very first look.
    const page = rig({ landsOnRefresh: 1 });
    await page.ctx.submitRent();

    t.ok('the success screen is shown', !!page.success);
    // Guarded: a bare page.success.title would THROW when this regresses,
    // aborting the async suite and silently skipping every assertion
    // below it. The first mutation run reported one failure for exactly
    // that reason -- the suite looked narrower than it is.
    t.eq('  ...the real one, not a consolation', (page.success || {}).title, 'Enjoy the Movie!');
    t.ok('  ...and the ticket stub renders', !!page.ticket);
    t.eq('  ...for the rental that actually landed', (page.ticket || {}).rental_id, 'RNT-953593852');
    // The whole point. This is what she was told on 2026-09-25.
    t.ok('NEVER says the rental did not go through', !/did not go through/.test(alertText(page)));
    t.ok('NEVER claims she was not charged', !/have not been charged/.test(alertText(page)));
    t.ok('no failure banner at all', alertText(page).trim() === '');
  }
  {
    // The server may still be finishing rent_confirm when the phone
    // aborts, so one look is not enough -- same webhook-lag poll the
    // back-from-Stripe path already does.
    const page = rig({ landsOnRefresh: 3 });
    await page.ctx.submitRent();
    t.ok('keeps looking past the first refresh', page.refreshes >= 3);
    t.ok('  ...and still finds it', !!page.success);
  }

  // --- the abort that really was nothing -------------------------------
  {
    const page = rig({ landsOnRefresh: 0 });
    await page.ctx.submitRent();
    const s = alertText(page);

    t.ok('no success screen', !page.success);
    t.ok('it gives up looking rather than polling forever', page.refreshes <= 6);
    // Still unknown, so it must not assert either outcome.
    t.ok('does NOT claim she was not charged', !/have not been charged/.test(s));
    t.ok('does NOT claim she was charged', !/Your payment went through/.test(s));
    t.ok('says plainly that it is unconfirmed', /could not confirm whether/.test(s));
    t.ok('tells her not to retry', /do not try again/i.test(s));
    t.ok('and to leave the disc', /[Ll]eave the disc/.test(s));
    t.ok('never shows the browser\'s own words', !/Fetch is aborted/.test(s));
    t.ok('the button is usable again', page.els.checkoutSubmitBtn.disabled === false);
  }

  // --- everything that is NOT an abort is untouched ---------------------
  {
    // A real server answer has a real answer. It must keep its own copy
    // and must NOT be reconciled or softened into "unknown".
    const page = rig({ landsOnRefresh: 0,
                       error: new Error('Item is checked_out, not available: SFD-0567') });
    await page.ctx.submitRent();
    const s = alertText(page);
    t.ok('keeps the ordinary failure copy', /did not go through/.test(s));
    t.ok('  ...including the real reason', /checked_out/.test(s));
    t.ok('  ...and does NOT reconcile', page.refreshes === 0);
    t.ok('  ...nor claim the payment is unknown', !/could not confirm whether/.test(s));
  }

  // --- the failure is still reported ------------------------------------
  {
    const page = rig({ landsOnRefresh: 1 });
    await page.ctx.submitRent();
    t.ok('an abort that worked is still reported to the owner', page.reported === 1);
  }

  // --- the timeout that caused it ---------------------------------------
  {
    const src = require('fs').readFileSync(RENT, 'utf8');
    t.ok('the rent call has its own, longer budget',
      /RENT_TIMEOUT_MS\s*=\s*(\d+)/.test(src) && Number(RegExp.$1) > 20000);
    const call = src.slice(src.indexOf("'/start-rental'"), src.indexOf("'/start-rental'") + 260);
    t.ok('  ...and actually passes it at the call site', /RENT_TIMEOUT_MS/.test(call));
  }
});
