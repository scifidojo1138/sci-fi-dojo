// rent.html's side of rent-one-get-one-free (2026-10-03). A BOGO credit is
// banked at redemption but only applies after a paid rental, so the app
// must not say "Free!" while the backend is about to charge the base.
const { suite } = require('./lib/sandbox');
const { loadPage } = require('./lib/browser-stub');
const path = require('path');

const ctx = loadPage(path.join(__dirname, '..', 'rent.html'), '').ctx;
const text = (h) => String(h || '').replace(/<[^>]+>/g, '');
const withMember = (m) => { ctx.member = Object.assign({ comp: false, promo_redeemed: true }, m); };
const bannerText = () => { ctx.renderPromoSection(); return text(ctx.document.getElementById('freeCreditBanner').innerHTML); };

module.exports = () => suite('rent.html: rent one get one free', (t) => {
  const block = (fn) => {
    try { fn(); } catch (e) { t.ok('case threw unexpectedly: ' + e.message, false); }
  };
  block(() => {
    withMember({ free_rental_credits: 1, free_rental_ready: false });
    t.eq('a waiting BOGO credit does NOT make this rental free', ctx.freeCreditReady_(), false);
    const b = bannerText();
    t.ok('  ...the banner pitches the deal', /Rent one, get one free/.test(b));
    t.ok('  ...and never says this rental is free', !/next rental is free!/.test(b));
  });
  block(() => {
    withMember({ free_rental_credits: 1, free_rental_ready: true });
    t.eq('a ready credit makes the rental free', ctx.freeCreditReady_(), true);
    t.ok('  ...with the existing banner', /Your next rental is free!/.test(bannerText()));
  });
  block(() => {
    // An older backend sends no free_rental_ready at all; every credit was
    // usable then, so this file can ship before the backend.
    withMember({ free_rental_credits: 1 });
    t.eq('a backend without the field behaves as before', ctx.freeCreditReady_(), true);
  });
  block(() => {
    withMember({ free_rental_credits: 0, free_rental_ready: true });
    t.eq('no credit, nothing free', ctx.freeCreditReady_(), false);
    t.eq('  ...and no banner', bannerText(), '');
  });
  block(() => {
    withMember({ comp: true, free_rental_credits: 1, free_rental_ready: false });
    t.eq('staff accounts get no promo banner either way', bannerText(), '');
  });
});
