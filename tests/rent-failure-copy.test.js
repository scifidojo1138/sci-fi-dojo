// What a customer reads when a rental does not go through.
//
// From a live incident (2026-09-17): a customer rented one disc on a promo
// credit, was declined on a second a minute later, and left with BOTH --
// believing the second had been paid for. The banner said "Rental failed:"
// followed by the server's prose: "Your saved card was declined. Email
// scifidojo@aol.com to update it." Her card needed nothing (prepaid Visa via
// Apple Pay, valid to 2031, both address checks passed, declined only for
// insufficient funds, network code 51), and email is a dead end at an
// unstaffed cabinet.
const { suite } = require('./lib/sandbox');
const { loadPage } = require('./lib/browser-stub');
const path = require('path');

const ctx = loadPage(path.join(__dirname, '..', 'rent.html'), '').ctx;
const H = (err) => ctx.rentFailureHtml_(err);
const text = (h) => h.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '');

module.exports = () => suite('rent.html: failed-rental copy', (t) => {
  // --- the thing that actually went wrong -------------------------------
  {
    // A customer who thinks they paid is the failure mode, so this line
    // comes first and states it as fact -- Stripe reported net $0.00.
    const h = H({ message: 'x', decline_code: 'insufficient_funds' });
    t.ok('leads with the rental not going through', /^<strong>This rental did not go through/.test(h));
    t.ok('and says no money moved', /have not been charged/.test(text(h)));
    t.ok('and says what to do with the disc in hand', /back on the shelf/.test(text(h)));
  }
  {
    // The exact prose from the incident must not reach the screen.
    const h = H({ message: 'Your saved card was declined. Email scifidojo@aol.com to update it.',
                  decline_code: 'insufficient_funds' });
    t.ok('our own reason replaces the server prose', /insufficient funds/.test(text(h)));
    t.ok('  ...and "email us to update it" is gone', !/to update it/.test(text(h)));
    t.ok('  ...and no email address is in the instruction',
      text(h).indexOf('scifidojo@aol.com') === -1);
  }

  // --- UPDATE CARD only when the card is actually the problem -----------
  {
    const funds = H({ message: 'x', decline_code: 'insufficient_funds' });
    t.ok('insufficient funds does NOT offer UPDATE CARD', funds.indexOf('>UPDATE CARD<') === -1);
    t.ok('  ...and suggests another card instead', /another card/.test(text(funds)));

    const expired = H({ message: 'x', decline_code: 'expired_card' });
    t.ok('an expired card DOES offer UPDATE CARD', expired.indexOf('>UPDATE CARD<') !== -1);
    t.ok('  ...wired to the self-service flow', /onclick="goUpdateCard\(this\)"/.test(expired));
  }
  {
    // A whitelist, not a blacklist: the wrong default is sending someone to
    // replace a card that works.
    ['', undefined, 'some_new_code_stripe_added', 'insufficient_funds'].forEach((code) => {
      const h = H({ message: 'x', decline_code: code });
      t.ok(`unknown/absent code (${JSON.stringify(code)}) does not offer UPDATE CARD`,
        h.indexOf('>UPDATE CARD<') === -1);
    });
  }

  // --- do not diagnose a payment problem we cannot see ------------------
  {
    // Today start-rental.js sends no decline_code, and plenty of failures
    // are not payment at all (item already out, rental limit reached).
    const h = H({ message: 'Item is checked_out, not available: SFD-0938' });
    t.ok('with no code, it does not suggest trying another card',
      !/another card/.test(text(h)));
    t.ok('  ...just try again', /or try again\./.test(text(h)));
    t.ok('  ...and the real reason still shows', /checked_out/.test(text(h)));
  }

  // --- fraud codes stay generic ----------------------------------------
  {
    // Stripe advises not telling the person holding the card that it is
    // reported lost or stolen.
    ['lost_card', 'stolen_card', 'pickup_card'].forEach((code) => {
      const s = text(H({ message: 'x', decline_code: code }));
      t.ok(`${code} reads as a plain bank decline`, /declined by the bank/.test(s));
      t.ok(`  ...and never says "${code.split('_')[0]}"`,
        s.toLowerCase().indexOf(code.split('_')[0]) === -1);
    });
  }

  // --- never blow up ----------------------------------------------------
  {
    t.noThrow('a bare Error still renders', () => H(new Error('boom')));
    t.noThrow('null does not throw', () => H(null));
    t.ok('  ...and still tells the customer the rental failed',
      /did not go through/.test(text(H(null))));
    const h = H({ message: '<img src=x onerror=alert(1)>' });
    t.ok('the server message is escaped', h.indexOf('<img') === -1 && /&lt;img/.test(h));
  }
});
