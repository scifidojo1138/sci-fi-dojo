# Backend Update — Pay-Per-Rental Launch (Redbox model)

This round adds the pay-per-rental system: `rent.html` (already on this site at
`scifidojo.com/rent`), new backend actions, two new sheet tabs, and four new
Netlify functions that do all the Stripe work. The member app is untouched and
keeps working until you retire it.

Work through the sections in order. Nothing goes live for customers until the
QR poster is printed, so you can take your time and test in Stripe test mode.

## 1. Google Sheet — new tabs and columns

**Customers** (new tab), row 1 headers:

| customer_id | customer_token | display_name | email | phone | terms_accepted | stripe_customer_id | payment_status | rental_limit | status | comp | joined_date | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

Rows are created by the signup flow — you never add these by hand. To raise a
good customer's limit after their first clean return, edit their
`rental_limit` cell (e.g. 1 → 3). A row with `status = flagged` means the
signup matched the Blacklist tab below; it has no cabinet code and can't
rent until you edit that cell back to `active`.

**Staff accounts:** sign up normally through the app, then type `TRUE` in
that row's `comp` cell. From then on their rentals log like anyone else's
(so you can test the whole flow, and staff borrowing stays on the books)
but nothing is ever charged and no card is ever asked for. The staff
terminal badges them "STAFF — NO CHARGE".

**Blacklist** (new tab), row 1 headers:

| blacklist_id | email | phone | reason | added_by | added_date |
|---|---|---|---|---|---|

A row can list an email, a phone, or both — either matching a new signup's
info flags that account instead of activating it normally (see Customers,
above). This only catches **future** signups; it can't undo a rental someone
already paid for. To let someone back in, delete their row here (their
existing account still needs its `status` cell fixed back to `active`
separately, since the two are independent).

**Rentals** (new tab), row 1 headers:

| rental_id | customer_id | item_id | start_date | status | base_price | base_paid_date | extra_charged | last_charge_date | return_date | closed_date | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|

Also machine-written. Statuses: `pending` (checkout not finished; auto-voids
after 30 min) → `active` → `return_pending` → `closed`. Reaching the
maximum charge does NOT end a rental: the daily fee just stops accruing
and the disc is still expected back — the rental stays open on the staff
Outstanding Rentals list until you check it in.

**Catalog** — add one column: `rental_price` (dollars, e.g. 2, 3, or 4; blank
defaults to $3 — set a row to `2` explicitly for anything you want priced at
the floor). The existing `replacement_cost` column is the payoff cap — fill
it in for items you rent out (blank falls back to the default below).

> **Already have items priced under the old $1/$2/$3 scheme?** Existing
> `rental_price` values don't change on their own — only blank cells pick up
> the new $3 default. If you want every title bumped by $1 to match the new
> pricing, that's a one-time manual (or separately scripted) edit to the
> Catalog tab; nothing in this update does it for you.

**Settings** — add four rows (key in column A, value in B):

| key | value |
|---|---|
| `default_payoff_cost` | `10` |
| `default_rental_limit` | `1` |
| `trusted_on_time_threshold` | `10` |
| `trusted_rental_limit` | `2` |

The last two power **Trusted Accounts**: once a customer has this many
rentals returned within the included 7-day window, their `rental_limit` is
raised to `trusted_rental_limit` automatically — no staff action needed. A
customer who's great but occasionally keeps a disc a few extra days doesn't
count toward this and isn't penalized; raising their limit further stays a
manual edit to their `rental_limit` cell, same as today.

**Rental window and rates changed for the Thu–Sun schedule:** the included
period is now 7 days (was 3) so a rental never comes due during the Mon–Wed
closure with no way to return it, and the extended-rental rate is now $2/day
(was $1) to keep revenue roughly steady against the longer free window.
Both are in the Apps Script as constants (`RENT_INCLUDED_DAYS`,
`RENT_DAILY_CENTS`), not Settings — changing them again means editing the
script and deploying a new version, same as any other code change.

**General-collection cabinet code is now handed out immediately at signup**
(no rental needed first) unless the signup matches the Blacklist tab above,
in which case the account is created but held for staff review with no code
and no ability to rent. This is deliberate for a single trusted location —
see `CLAUDE.md`'s "Blacklist and cabinet code timing" section for the
tradeoff before turning this on somewhere with different foot traffic.

## 2. Apps Script

Paste the delivered backend file over the current code, then deploy a **new
version of the SAME deployment** (Deploy → Manage deployments → ✏️ → New
version → Deploy). Changes: Customers/Rentals support, accrual math
(`computeAccrued_`), signup / rent / return / billing actions, a new
returning-customer lookup action (`customer_lookup` — requires both email
and phone to match the same account), signup now rejects a duplicate email
or phone already on file (pointing the customer at that same lookup instead
of quietly creating a second account), the catalog payload now includes
`rental_price` (feeds the Browse tap-to-expand price line), staff comp
accounts (`comp` column — logged but never charged), and a new
`SERVER_KEY` that only the Netlify functions know (it gates the "mark this
rental paid" actions, so the public page key can't fake payments).

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

Replace `sfd-staff.html` with the delivered file. It now shares the
onboarding terminal's visual style (teal/cyan, high contrast) and is
organized by daily task: a needs-attention strip up top (returns to check
in, due for sweep, failed cards — each chip jumps to its section), compact
cabinet codes, then **Outstanding Rentals** (each open rental with days
out / paid / owed / cap, a CHARGE & CLOSE button on returned discs, and
the RUN BILLING SWEEP button) and **Rental Customers** (search; badges;
open a customer's app; PRINT CARD). The legacy membership tools (member
lookup, active checkouts, return bin) are collapsed at the bottom until
tapped.

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

1. Open `scifidojo.com/rent` in a private window → sign up. The success
   screen should show the cabinet code immediately (no rental needed yet).
2. Sign up again with an email/phone you've added to the Blacklist tab →
   the success screen should say the account is pending review, with no
   cabinet code, and the Rentals tab should still be empty for that account.
3. Reload `scifidojo.com/rent` with no token (simulating a lost bookmark) →
   expand "Or look up by email & phone" → try just the email, or just the
   phone, from step 1's account (should be rejected) → then both together
   (should log you straight into that account). Scanning the QR from the
   printed card should also work — commit the delivered `print-cards.html`
   into the onboarding repo's `cards/` first, so customer cards encode the
   `/rent` link instead of the legacy `/member` one.
4. Rent a disc on the first (non-blacklisted) account → Stripe Checkout →
   card `4242 4242 4242 4242`, any future expiry/CVC → back in the app the
   rental shows active.
5. Check the sheet: Customers row, Rentals row `active`, catalog item
   `checked_out`.
6. Log the return in the app → staff terminal shows RETURNED — CHECK IN →
   CHARGE & CLOSE (within the 7-day window it just closes; nothing owed).
7. Rent again (same account) — it should charge with one tap, no redirect.
8. Failed-card path: new signup with card `4000 0000 0000 0341` (attaches but
   fails charges) — the sweep flags the customer, and their app shows the
   card banner with renting blocked.
9. Staff comp path: set `comp = TRUE` on one account's Customers row →
   renting on it should skip Stripe entirely (no checkout page, "RENT
   (NO CHARGE)" button), the rental still shows on Outstanding Rentals
   with a STAFF — NO CHARGE badge, and check-in closes it without
   charging.
10. Flip to live keys (and a live-mode webhook) when everything passes.

## 7. Terms page

Revise `/terms` before printing the QR poster — see `TERMS-CHECKLIST.md` in
this repo for the clauses the rental model needs.

## 8. Launch

Print the QR poster pointing at `https://scifidojo.com/rent` and put it on
the cabinet. That is the moment the system goes live.
