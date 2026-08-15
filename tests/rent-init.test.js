// rent.html's load path, exercised for real rather than by inspection.
//
// Exists because of a live outage: ACCT_STATES was declared ~400 lines
// BELOW the init IIFE that reads it. `var` hoists the declaration but not
// the assignment, so init threw on the no-token path, the throw escaped
// before showScreen('screen-signup') could run, and every new customer
// scanning the cabinet QR was stranded on the loading screen. Nothing
// caught it for two days because the token path defers loadMember with
// setTimeout(...,0) and therefore runs after the script has parsed --
// so every logged-in test looked perfect.
//
// Reading the file cannot catch that class of fault. Running it can.
const path = require('path');
const { suite } = require('./lib/sandbox');
const { loadPage } = require('./lib/browser-stub');

const RENT = path.join(__dirname, '..', 'rent.html');

module.exports = () => suite('rent.html: load path', (t) => {
  // --- no token: a brand new customer at the cabinet --------------------
  {
    const page = loadPage(RENT, '');
    t.eq('loads without throwing', page.error, null);
    // The one that actually matters. If this regresses, nobody can sign up.
    t.ok('the signup screen is shown', page.screenActive('screen-signup'));
    t.ok('  ...and the app does NOT sit on the loading screen',
      !page.screenActive('screen-loading'));
    t.eq('the header reads as idle, not mid-load', page.headerText, 'Account');
  }

  // --- the ordering fault itself, stated directly -----------------------
  {
    const src = require('fs').readFileSync(RENT, 'utf8');
    const decl = src.indexOf('var ACCT_STATES = {');
    const init = src.indexOf('(function init() {');
    t.ok('both the declaration and init were located', decl > 0 && init > 0);
    // var assignments run in source order; init runs synchronously at
    // parse time. Anything init touches must be assigned above it.
    t.ok('ACCT_STATES is assigned ABOVE the init IIFE that reads it', decl < init);

    // The front door must not sit behind a decorative call.
    const branch = src.slice(src.indexOf('if (!token) {'), src.indexOf('if (rentedReturn) {'));
    t.ok('init shows the signup screen before setting the status readout',
      branch.indexOf("showScreen('screen-signup')") < branch.indexOf("setAccountStatus('idle')"));
  }

  // --- the status readout must never be fatal again ---------------------
  {
    const page = loadPage(RENT, '');
    const setAccountStatus = page.ctx.setAccountStatus;
    t.noThrow('an unknown state falls back instead of throwing',
      () => setAccountStatus('not-a-real-state'));
    t.eq('  ...to the idle label', page.headerText, 'Account');
    // Simulate the exact regression: the map missing at call time.
    page.ctx.ACCT_STATES = undefined;
    t.noThrow('even a missing ACCT_STATES cannot take the page down',
      () => setAccountStatus('idle'));
  }

  // --- a token is present: the deferred path ----------------------------
  {
    // The stub does not read `class="screen active"` out of the static
    // markup, so it cannot confirm the loading screen is up -- only that
    // init did not navigate anywhere. That is still the useful half: a
    // token holder must never be dropped onto the signup form.
    const page = loadPage(RENT, '?token=cus_test');
    t.eq('loads without throwing', page.error, null);
    t.ok('does not show signup to someone who already has an account',
      !page.screenActive('screen-signup'));
  }
});
