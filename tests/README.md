# Backend tests

Unit tests for the Google Apps Script backend, run under Node. No
network, no Google account, no Sheets access -- the whole spreadsheet
layer is mocked in `lib/sandbox.js`.

## Running

The backend source is **not in this repo** and never should be: it holds
`SERVER_KEY` and `MAILER_KEY`, and this repo is public. Keep a local copy
and point the tests at it:

```sh
SFD_BACKEND=/path/to/sfd-backend.txt node tests/run-all.js
```

The copy is whatever is pasted in the Apps Script editor. Confirm it
matches production by opening the web app's `/exec` URL with
`?action=ping` -- the `version` it returns is the deployed
`BACKEND_VERSION`.

Exit code is non-zero if anything fails, so this drops into CI as-is.

## What's covered

| Suite | Focus |
|---|---|
| `money.test.js` | `computeAccrued_`: the included window, the unadvertised grace day, the payoff cap, per-rental locked-in day rates, blank-vs-zero base price, tax staying out of the accrual |
| `id-races.test.js` | The 2026-08-07 lock-scope fixes: signup and quick-receive are each one atomic scan-then-append; double-tapped signups lose cleanly |
| `catalog-staff.test.js` | Quick-receive requiring `replacement_cost`, the label printer's flat cost + `requested`/`stamped` counts, `mark_item_active` guards |
| `alerts-payload.test.js` | Owner alerts firing only on real transitions, never able to break the signup or Stripe confirm they report on, and the per-rental `daily` field |

## Conventions

**One shared harness.** Suites used to each declare their own mocks and
they drifted -- when `doCustomerSignup` gained a `SpreadsheetApp.flush()`,
two unrelated suites broke with "SpreadsheetApp is not defined", a
harness gap that looked like a code failure. Teach `lib/sandbox.js` about
a new global once.

**Assert on cost, not just behavior.** Several bugs here were about how
*expensive* something was (the label printer doing one full 700-row read
per label). `__log.reads`, `__log.writes` and `__log.rowUpdates` exist so
a suite can assert "one read, one write, zero per-item helper calls".

**Assert on ordering for the lock fixes.** A lock's guarantee is that
scan and append can't interleave, so those suites check the event
sequence is `scan,append,scan,append` rather than checking a final value
that would look identical either way.

**Mutation-test new coverage.** Break the fix on purpose and confirm the
suite goes red. This is not ceremony -- it caught a real hole here: the
"one read + one write" assertion passed even when the code was reverted
to per-item reads, because the harness wasn't counting `updateRowByKey_`
as a read. That's what `rowUpdates` is for now.
