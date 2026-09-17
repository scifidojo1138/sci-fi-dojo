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

  // --- the customer has no usable card at all ---------------------------
  {
    // Not a Stripe code -- start-rental.js sends it when the payment-method
    // resolver comes back empty (the Link wallet bug's shape). Left in the
    // neutral branch it would read "or try again", which is a retry into
    // the identical failure, forever, at a cabinet with nobody to ask.
    const h = H({ message: 'We could not charge your card. Please contact staff.',
                  decline_code: 'no_payment_method' });
    const s = text(h);
    t.ok('no_payment_method says there is no usable card', /no usable card/.test(s));
    t.ok('  ...and offers the one remedy that works unattended',
      h.indexOf('>UPDATE CARD<') !== -1);
    t.ok('  ...pointing at the setup-mode flow', /onclick="goUpdateCard\(this\)"/.test(h));
    t.ok('  ...and never tells the customer to find staff',
      s.toLowerCase().indexOf('staff') === -1);
    t.ok('  ...the server prose is replaced, not appended',
      s.indexOf('could not charge your card') === -1);
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

  // --- the one failure where the customer HAS paid ----------------------
  {
    // start-rental.js charges, then records. When only the record fails,
    // Stripe already took the money. The standard lede would state the
    // opposite as fact -- the same false-statement-about-money mistake the
    // whole function exists to prevent, just pointed the other way.
    const h = H({ message: 'Charged but could not confirm. Contact staff with rental RNT-0042',
                  decline_code: 'charged_not_confirmed' });
    const s = text(h);
    t.ok('says the payment went through', /payment went through/.test(s));
    t.ok('  ...and NEVER claims no money moved', !/have not been charged/.test(s));
    t.ok('  ...and does not tell them to put back a disc they paid for',
      !/back on the shelf/.test(s));
    t.ok('  ...and offers no card remedy', h.indexOf('>UPDATE CARD<') === -1);
    t.ok('  ...and never sends them to find staff', s.toLowerCase().indexOf('staff') === -1);
    t.ok('  ...but does reach us by email', /mailto:/.test(h));
  }
  {
    // The reference is optional: start-rental.js may or may not send it.
    const withId = H({ message: 'x', decline_code: 'charged_not_confirmed', rental_id: 'RNT-0042' });
    t.ok('a rental_id is shown when sent', /RNT-0042/.test(text(withId)));
    t.ok('  ...and rides the mailto subject', /subject=[^"]*RNT-0042/.test(withId));

    const noId = H({ message: 'x', decline_code: 'charged_not_confirmed' });
    t.ok('no rental_id still renders cleanly', /payment went through/.test(text(noId)));
    t.ok('  ...with no empty Reference line', !/Reference:/.test(text(noId)));

    const nasty = H({ decline_code: 'charged_not_confirmed', rental_id: '<img src=x>' });
    t.ok('the reference is escaped', nasty.indexOf('<img') === -1);
  }

  // --- the agreed contract's fallback prose -----------------------------
  {
    // start-rental.js owns the wording for codes we do not map. It must
    // survive to the screen intact, or its careful copy is pointless.
    const h = text(H({ message: 'That card was declined.', decline_code: 'call_issuer' }));
    t.ok('an unmapped code shows the server prose verbatim', /That card was declined\./.test(h));
    t.ok('  ...and still says what to do with the disc', /back on the shelf/.test(h));
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
