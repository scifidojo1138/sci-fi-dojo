# Backend Update — Pay-Per-Rental Launch (Redbox model)

This round adds the pay-per-rental system: `rent.html` (already on this site at
`scifidojo.com/rent`), new backend actions, two new sheet tabs, and four new
Netlify functions that do all the Stripe work. The member app is untouched and
keeps working until you retire it.

Work through the sections in order. Nothing goes live for customers until the
QR poster is printed, so you can take your time and test in Stripe test mode.

## 1. Google Sheet — new tabs and columns

**Customers** (new tab), row 1 headers:

| customer_id | customer_token | display_name | email | phone | terms_accepted | stripe_customer_id | payment_status | rental_limit | status | joined_date | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|

Rows are created by the signup flow — you never add these by hand. To raise a
good customer's limit after their first clean return, edit their
`rental_limit` cell (e.g. 1 → 3).

**Rentals** (new tab), row 1 headers:

| rental_id | customer_id | item_id | start_date | status | base_price | base_paid_date | extra_charged | last_charge_date | return_date | closed_date | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|

Also machine-written. Statuses: `pending` (checkout not finished; auto-voids
after 30 min) → `active` → `return_pending` → `closed`, or `paid_off` when
the customer has paid the disc's full price (it is theirs; the catalog row
becomes `sold`).

**Catalog** — add one column: `rental_price` (dollars: 1, 2, or 3; blank
defaults to $2 — set a row to `1` explicitly for anything you want priced at
the floor). The existing `replacement_cost` column is the payoff cap — fill
it in for items you rent out (blank falls back to the default below).

**Settings** — add four rows (key in column A, value in B):

| key | value |
|---|---|
| `default_payoff_cost` | `10` |
| `default_rental_limit` | `1` |
| `trusted_on_time_threshold` | `10` |
| `trusted_rental_limit` | `2` |

The last two power **Trusted Accounts**: once a customer has this many
rentals returned within the included 3-day window, their `rental_limit` is
raised to `trusted_rental_limit` automatically — no staff action needed. A
customer who's great but occasionally keeps a disc a few extra days doesn't
count toward this and isn't penalized; raising their limit further stays a
manual edit to their `rental_limit` cell, same as today.

## 2. Apps Script

Paste the delivered backend file over the current code, then deploy a **new
version of the SAME deployment** (Deploy → Manage deployments → ✏️ → New
version → Deploy). Changes: Customers/Rentals support, accrual math
(`computeAccrued_`), signup / rent / return / billing actions, and a new
`SERVER_KEY` that only the Netlify functions know (it gates the
"mark this rental paid" actions, so the public page key can't fake payments).

## 3. Netlify (onboarding repo)

Commit the four delivered function files into `netlify/functions/`:
`start-rental.js`, `rental-webhook.js`, `charge-rental.js`, `billing-sweep.js`.

Then in Netlify → Site settings → Environment variables, add:

| Variable | Value |
|---|---|
| `SFD_API_KEY` | `27268cf583e78fcdb9e5eb2d5bada419` (same as the page key) |
| `SFD_SERVER_KEY` | `28dcc9be93758719d3a5dd74b5e2d7ac` (matches SERVER_KEY in the Apps Script) |
| `SFD_RENT_URL` | `https://scifidojo.com/rent` |
| `STRIPE_WEBHOOK_SECRET` | from step 4 below |

(`STRIPE_SECRET_KEY` and `APPS_SCRIPT_URL` already exist.) Remember: env
changes need a redeploy of the Netlify site to take effect.

## 4. Stripe dashboard

1. **Webhook:** Developers → Webhooks → Add endpoint →
   `https://scifidojo-onboarding.netlify.app/.netlify/functions/rental-webhook`
   → select the single event `checkout.session.completed`. Copy the signing
   secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` and redeploy.
2. **Test mode first:** use your test API key in `STRIPE_SECRET_KEY` and a
   matching test-mode webhook until the flow checks out.

## 5. Staff terminal

Replace `sfd-staff.html` with the delivered file. New sections: **Rental
Customers** (search; CARD FAILED badges; open a customer's app; PRINT CARD),
and **Outstanding Rentals** (each open rental with days out / paid / owed /
cap, a CHARGE & CLOSE button on returned discs, and the RUN BILLING SWEEP
button).

Weekly routine: open the staff page, tap RUN BILLING SWEEP. It charges every
active rental that is 7+ days since its last charge or owes $10+, and reports
a summary. Returned discs: put the disc back, tap CHARGE & CLOSE.

Signups are presented to the public as a free **SFD Account** (no deposit,
no monthly fee) — not a membership; "membership" is reserved for a possible
future paid tier. See `rent.html`'s signup and success screens. The account
itself is a row in the Customers tab. When a customer is at the counter,
search for them in **Rental Customers** and tap **PRINT CARD** to print
their physical SFD card (same print layout the legacy member flow uses).
Most people create their account digitally on the first visit and get the
card on a later one.

## 6. Test in Stripe test mode

1. Open `scifidojo.com/rent` in a private window → sign up.
2. Rent a disc → Stripe Checkout → card `4242 4242 4242 4242`, any future
   expiry/CVC → back in the app the rental shows active with the cabinet code.
3. Check the sheet: Customers row, Rentals row `active`, catalog item
   `checked_out`.
4. Log the return in the app → staff terminal shows RETURNED — CHECK IN →
   CHARGE & CLOSE (within 3 days it just closes; nothing owed).
5. Rent again (same account) — it should charge with one tap, no redirect.
6. Failed-card path: new signup with card `4000 0000 0000 0341` (attaches but
   fails charges) — the sweep flags the customer, and their app shows the
   card banner with renting blocked.
7. Flip to live keys (and a live-mode webhook) when everything passes.

## 7. Terms page

Revise `/terms` before printing the QR poster — see `TERMS-CHECKLIST.md` in
this repo for the clauses the rental model needs.

## 8. Launch

Print the QR poster pointing at `https://scifidojo.com/rent` and put it on
the cabinet. That is the moment the system goes live.
