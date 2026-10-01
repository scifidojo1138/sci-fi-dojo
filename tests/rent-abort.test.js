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
  // Either the request fails outright (opts.error / default abort), or it
  // comes back with a body. opts.body === 'html' models a gateway error
  // page, where res.json() throws.
  if ('body' in opts) {
    ctx.fetchWithTimeout = () => Promise.resolve({
      ok: (opts.status || 200) < 400,
      status: opts.status || 200,
      json: () => opts.body === 'html'
        ? Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0'))
        : Promise.resolve(opts.body),
    });
  } else {
    ctx.fetchWithTimeout = () => Promise.reject(opts.error || abortError());
  }
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

  // --- a completed refusal from our own function is untouched ------------
  {
    // A real server answer has a real answer. It must keep its own copy
    // and must NOT be reconciled or softened into "unknown". It arrives
    // as a response, not a rejection -- an earlier version of this test
    // modeled it as a rejected fetch, which is not how it ever happens.
    const page = rig({ landsOnRefresh: 0,
                       body: { ok: false, error: 'Item is checked_out, not available: SFD-0567' } });
    await page.ctx.submitRent();
    const s = alertText(page);
    t.ok('keeps the ordinary failure copy', /did not go through/.test(s));
    t.ok('  ...including the real reason', /checked_out/.test(s));
    t.ok('  ...and does NOT reconcile', page.refreshes === 0);
    t.ok('  ...nor claim the payment is unknown', !/could not confirm whether/.test(s));
  }

  // --- the server dies first: the race that actually happens -------------
  {
    // RENT_TIMEOUT_MS outlasts the function's own limit, so a slow Stripe
    // call gets the FUNCTION killed and the phone receives a 502 -- never
    // an abort. That is the realistic timeout, and it used to land in the
    // ordinary failure copy: "You have not been charged".
    const page = rig({ landsOnRefresh: 2, status: 502, body: 'html' });
    await page.ctx.submitRent();
    t.ok('a 502 gateway page reconciles', page.refreshes >= 1);
    t.ok('  ...and finds the rental that landed', !!page.success);
    t.ok('  ...without ever claiming no charge', !/have not been charged/.test(alertText(page)));
  }
  {
    const page = rig({ landsOnRefresh: 0, status: 502, body: 'html' });
    await page.ctx.submitRent();
    const s = alertText(page);
    t.ok('a 502 that never landed reads as unconfirmed', /could not confirm whether/.test(s));
    t.ok('  ...not as a failure', !/have not been charged/.test(s));
    // The HTML body used to surface the JSON parser's own error.
    t.ok('  ...and never shows parser prose', !/Unexpected token/.test(s));
  }
  {
    // Valid JSON, but not our shape: a Lambda timeout body.
    const page = rig({ landsOnRefresh: 0, status: 502,
                       body: { errorType: 'Sandbox.Timedout', errorMessage: 'Task timed out after 10.01 seconds' } });
    await page.ctx.submitRent();
    t.ok('JSON that is not our {ok} shape is unknown too', page.refreshes >= 1);
    t.ok('  ...and reads as unconfirmed', /could not confirm whether/.test(alertText(page)));
  }
  {
    // No response at all -- the request may or may not have arrived.
    const page = rig({ landsOnRefresh: 1, error: new TypeError('Load failed') });
    await page.ctx.submitRent();
    t.ok('a dropped network request reconciles as well', page.refreshes >= 1 && !!page.success);
  }

  // --- the decline contract, end to end -----------------------------------
  {
    // The bug this change exists for: submitRent rebuilt the error from
    // the message alone, so decline_code and rental_id never reached
    // rentFailureHtml_. Every coded branch was unreachable in production.
    // These drive a real response through the real submitRent.
    const page = rig({ landsOnRefresh: 0,
      body: { ok: false, error: 'Charged but could not confirm.',
              decline_code: 'charged_not_confirmed', rental_id: 'RNT-0042' } });
    await page.ctx.submitRent();
    const s = alertText(page);
    t.ok('charged_not_confirmed reaches the screen', /Your payment went through/.test(s));
    t.ok('  ...never "not charged" to someone who paid', !/have not been charged/.test(s));
    t.ok('  ...with its reference', /RNT-0042/.test(s));
    t.ok('  ...and it does NOT reconcile -- the server already knows', page.refreshes === 0);
  }
  {
    const page = rig({ landsOnRefresh: 0,
      body: { ok: false, error: 'No usable card.', decline_code: 'no_payment_method' } });
    await page.ctx.submitRent();
    t.ok('no_payment_method gets its UPDATE CARD button',
      page.els.checkoutAlert.innerHTML.indexOf('>UPDATE CARD<') !== -1);
  }
  {
    const page = rig({ landsOnRefresh: 0,
      body: { ok: false, error: 'That card was declined.', decline_code: 'insufficient_funds' } });
    await page.ctx.submitRent();
    t.ok('a Stripe decline gets our own wording', /insufficient funds/.test(alertText(page)));
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
