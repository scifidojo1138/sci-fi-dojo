# Backend Update — Pay-Per-Rental Launch (Redbox model)

This round adds the pay-per-rental system: `rent.html` (already on this site at
`scifidojo.com/rent`), new backend actions, two new sheet tabs, and four new
Netlify functions that do all the Stripe work. The member app is untouched and
keeps working until you retire it.

Work through the sections in order. Nothing goes live for customers until the
QR poster is printed, so you can take your time and test in Stripe test mode.

## 1. Google Sheet — new tabs and columns

**Customers** (new tab), row 1 headers:

| customer_id | customer_token | display_name | email | phone | terms_accepted | stripe_customer_id | payment_status | rental_limit | status | comp | card_printed | joined_date | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Rows are created by the signup flow — you never add these by hand. To raise a
good customer's limit after their first clean return, edit their
`rental_limit` cell (e.g. 1 → 3). A row with `status = flagged` means the
signup matched the Blacklist tab below; it has no cabinet code and can't
rent until you edit that cell back to `active`. A row with `status = paused`
means one of their rentals hit its maximum charge (see the Kept Discs
section below) — the staff terminal is the only way to clear this (the
REACTIVATE ACCOUNT button), there's no expected sheet edit for it.

**Staff accounts:** sign up normally through the app, then type `TRUE` in
that row's `comp` cell. From then on their rentals log like anyone else's
(so you can test the whole flow, and staff borrowing stays on the books)
but nothing is ever charged and no card is ever asked for. The staff
terminal badges them "STAFF — NO CHARGE".

**`card_printed`** — leave blank; the staff terminal's Cards To Print
section sets it to `TRUE` once a customer's card has been printed in a
batch. You never need to touch this cell by hand.

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
after 30 min) → `active` → `return_pending` → `closed`, or `paid_off`.
Reaching the maximum charge on a rental that hasn't been physically
returned auto-closes it as `paid_off`: the disc is the customer's to keep
by default, their account pauses for new rentals, and it shows up in the
staff terminal's Kept Discs section. Nothing further happens automatically
until staff act — see "Kept Discs" below.

## Kept Discs (rentals that hit the maximum charge)

When a rental's total charges reach its maximum, the disc is the
customer's to keep — no deadline, no obligation to return it. Three
things happen automatically, all visible in the new **Kept Discs** section
of the staff terminal:

1. The rental closes as `paid_off` (not `closed`) and the catalog item is
   pulled out of rotation.
2. The customer's account is paused (`status: paused`) so they can't start
   a new rental until you've connected with them. It's not a penalty —
   just a hold for a quick check-in, and the plan is to mainly reach out
   by email (the section has an **EMAIL CUSTOMER** button pre-addressed
   to them for exactly this).
3. The disc stays flagged in Kept Discs indefinitely, so nothing is ever
   silently forgotten.

If the customer walks back in with the disc, tap **PROCESS RETURN** on
their row: enter whatever refund makes sense case by case (capped
automatically at what they actually paid), an optional note, and whether
the disc goes back into rotation. **This does not touch Stripe** — it only
records your decision. Issue the actual refund yourself in the Stripe
dashboard afterward (search the customer, refund the relevant charge).

Reactivating the account is a separate button (**REACTIVATE ACCOUNT**,
shown whenever the account is paused) and a separate decision from
processing the disc's return — you might reactivate someone well before
the disc ever comes back, or not at all if it never does. There's no
auto-reactivate; every reactivation is a deliberate tap in the terminal.

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
| `return_cooldown_minutes` | `60` |
| `rent_app_url` | (leave blank) |

`rent_app_url` is optional and only matters for testing: the account-link
emails (below) point at `https://scifidojo.com/rent` when it's blank. Set
it to a test URL if you ever want those emails to point somewhere else;
no redeploy needed.

`return_cooldown_minutes` is how long after checkout a customer must wait
before they can log a return. Logging a return frees their rental slot
immediately, so this cooldown is what stops someone renting a stack of
discs by insta-returning each one. Staff comp accounts are exempt, and
the staff terminal's LOG RETURN (STAFF) button overrides it for the
honest wrong-disc case. Set it to `0` to disable entirely.

The last two power **Trusted Accounts**: once a customer has this many
rentals returned within the included 7-day window, their `rental_limit` is
raised to `trusted_rental_limit` automatically — no staff action needed. A
customer who's great but occasionally keeps a disc a few extra days doesn't
count toward this and isn't penalized; raising their limit further stays a
manual edit to their `rental_limit` cell, same as today.

**Rental Promos** (new tab), row 1 headers:

| promo_id | title | description | date_start | date_end | daily_rate | base_discount | active |
|---|---|---|---|---|---|---|---|

Pricing promos for pay-per-rental (separate from the legacy member Promos
tab). A row is live when `active` is TRUE and today falls between the
dates (inclusive). `daily_rate` replaces the $2 extended-day rate;
`base_discount` comes off every base price (never below $1). Fill in one,
both, or use rows for different windows — the first live row wins. Every
rental keeps the deal it started under, so ending a promo never changes
what someone already renting owes. The `description` text is the banner
customers see in the app. For the launch special, add:

| RP-001 | Launch Special | All extended days are just $1 a day during our launch. | (launch date) | (end date) | 1 |  | TRUE |

**Rentals tab** — add one column: `daily_rate` (leave the cells blank;
the backend stamps it when a promo rental starts).

**Promo Codes** (new tab, added 2026-07-14), row 1 headers:

| code | active | notes |
|---|---|---|

Generic, reusable marketing codes — NOT the same thing as Rental Promos
above, and NOT single-use. The same code can be redeemed by any number
of different customers (give it out on flyers, social media, verbally —
something on-theme and easy to say, like `usetheforce`); what's actually
limited is one lifetime redemption **per customer**, tracked on their
own Customers row, not on the code. Matching is case/whitespace-insensitive,
so `usetheforce`, `UseTheForce`, and `use the force` all redeem the same
row. Add a row, set `active` to TRUE, and it's live immediately — no
dates, no redemption counter to reset. To retire a code, flip `active`
to FALSE (or just leave the row as a record and add a new one for the
next campaign).

**Customers tab** — add two columns: `promo_redeemed_date` (leave
blank; stamped the first time a customer redeems any code) and
`free_rental_credits` (leave blank; an integer, incremented by
`redeem_promo`, consumed by `rent_confirm` when a free rental actually
activates).

**Grace period:** extended fees now start only once a disc is more than
24 hours past the 7-day window (so day 9, not day 8). This is deliberate
slack for returns nobody has seen yet — the apps still say "7 days"
everywhere, and on-time credit for Trusted Accounts uses the same
boundary.

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

### Rental Stats (added 2026-07-20)

One-time step after pasting the 2026-07-20 backend:

1. **Trigger + first run:** in the Apps Script editor, pick
   `setupStatsTrigger` in the toolbar dropdown and click Run once.
   Approve the permission prompt if asked. This creates a daily ~9am
   trigger (`refreshRentalStats`) AND runs it immediately, so you get
   numbers right away instead of waiting until tomorrow.
2. Fully rebuilds the `Dashboard` tab: CATALOG, REQUESTS, and RENTALS
   sections, computed by the script (by column name, from whichever
   tab is literally named "Catalog") rather than the old hand-built
   formulas -- the MEMBERS section is dropped (member/deposit model is
   dormant) and the stale 'Catalog Demo' formula reference goes with
   it. Catalog/Requests numbers now refresh daily alongside Rentals
   (or on a manual re-run) instead of updating instantly like the old
   live formulas did -- a deliberate trade for numbers that can't
   silently drift again after a future tab rename.
3. **Optional:** add a Settings row `repeat_late_threshold` (e.g. `2`)
   to control how many late returns a title needs before it shows up
   in the "repeatedly stays out too long" list. Blank defaults to 2.

Reports: number of rentals, average rental length, % returned on time,
average days overdue, reminder emails sent, reminders followed by a
return within 24h, average extended fee collected, and repeat-offender
titles. Re-run `refreshRentalStats` any time from the editor toolbar
for an on-demand update between daily runs.

### Rental reminder emails (added 2026-07-20)

Three one-time steps after pasting the 2026-07-20 backend:

1. **Sheet:** add a `reminders_sent` column to the Rentals tab (any
   position -- everything reads by header name). Tracks which reminder
   stages each rental has received (`due_soon,due_today,fee_started`).
2. **Trigger:** in the Apps Script editor, pick `setupReminderTrigger`
   in the toolbar dropdown and click Run once. Approve the permission
   prompt. It creates a daily ~9am run of `sendRentalReminders` (the
   hour follows the SCRIPT timezone -- File > Project settings should
   say America/New_York).
3. **Optional pause switch:** a Settings row `reminder_emails` with
   value `off` stops all reminder sends without touching the trigger.

Reminders email every active rental at day 5 (due in 2 days), day 7
(due today), and day 8 (extended fee now applies -- the advertised
boundary; the quiet grace day means accrual still starts day 9, so a
day-8 return costs nothing). Comp accounts are skipped. Mail rides the
existing SFD Mailer relay, so no new mail setup is needed.

### Catalog genre browsing + barcode/imdb_id (added 2026-07-21)

**Sheet:** three new Catalog columns (any position -- everything reads
by header name): `barcode` (12-digit UPC), `imdb_id` (IMDB tt-code),
`genre` (comma-separated free text, e.g. "Action, Horror,
Science-Fiction"). No trigger or one-time run needed -- `getCatalog`
picks these up on the next request. `barcode`/`imdb_id` are internal
reference fields only and never reach rent.html; `genre` is parsed into
an array and does. A blank `genre` cell (fine to leave blank -- mostly
multi-movie box sets) shows up under Browse's "All Genres" chip only,
never under a specific genre, and never breaks anything.

### Dashboard section banners + charts (added 2026-07-21)

No new setup step -- paste the backend, publish a new version, and the
next `refreshRentalStats` run (daily, or triggered manually from the
editor toolbar) rebuilds the Dashboard tab with colored section banners
(CATALOG blue, REQUESTS orange, RENTALS green) and two charts: a
Catalog Breakdown pie (Available/Checked out/Return bin) and, when at
least one title qualifies, a Titles Returned Late Repeatedly bar chart.
Both charts and all formatting are removed and rebuilt from scratch on
every refresh, same as the text -- nothing to reapply by hand after a
manual edit gets overwritten by the next run.

### Bin-outcome staff actions (added 2026-07-21)

No new setup step -- paste the backend and publish a new version. Three
new staff-PIN POST actions handle a disc sitting in the return bin
(`return_pending`) that needs a non-standard outcome:

- `rental_undo_return` -- a return was logged by mistake; puts the disc
  back to `checked_out` and the rental back to `active` (fully
  reversible).
- `rental_mark_mia` -- the logged-returned disc never physically showed
  up; closes the rental, sets the catalog item to `missing` + out of
  rotation, and auto-pauses the customer for follow-up.
- `rental_mark_damaged` -- the disc came back unusable; same as MIA but
  the catalog item is set to `damaged`, and the customer is NOT
  auto-paused (staff decide case by case).

None touch Stripe. Two new Catalog `status` values can now appear:
`missing` and `damaged` (both out of rotation). The staff-terminal
buttons that call these live in the onboarding repo's `sfd-staff.html`
(handled separately) -- deploying this backend just makes the actions
available.

### Staff catalog: barcode field, quick-receive, label printer (added 2026-08-01)

**Sheet:** one new Catalog column (any position -- reads by header
name): `label_printed_at`. Leave every existing row blank; the backend
stamps it, you never type into it by hand.

Otherwise no new setup step -- paste the backend and publish a new version.

- `catalog_staff` (GET, staff_pin) now includes each item's `barcode`
  and `label_printed_at` alongside the existing `status`/`in_rotation`
  fields, for the staff app's Item Lookup / label printer.
- `add_catalog_item` (new staff-PIN POST action): `{ staff_pin, title,
  format, barcode }` -- quick-receives a freshly-unboxed disc so it's
  rentable same-day. Mints the next `SFD-####` id (lock-protected max-
  suffix scan, same pattern as customer ids -- safe if two staff
  receive discs at the same time), writes a minimal row (`status:
  available`, `in_rotation: TRUE`, `disc_count: 1`, plus the given
  title/format/barcode), and logs a `catalog_item_added` Transactions
  row. Everything else a full catalog row eventually carries (genre,
  synopsis, year, cost, condition, `sort_title`, etc.) is left blank on
  purpose -- expected to arrive later via the MyMovies import matched
  by barcode. The staff-terminal UI for this is the onboarding repo's
  job (handled separately); this just makes the action available.
- `mark_labels_printed` (new staff-PIN POST action): `{ staff_pin,
  item_ids: [...] }` -- the label printer's batch confirm. Stamps
  `label_printed_at` with the current timestamp on each item in the
  batch; an unknown/stale item_id is silently skipped rather than
  failing the whole print run. Returns `{ ok: true }`, or `{ ok: false,
  error }` on a bad PIN (same top-level error handling every other
  action already gets). The staff-terminal label-printer UI that calls
  this lives in the onboarding repo (handled separately).

### Device-online line on error alerts (2026-08-13b)

**Status: ready to paste** (`sfd-backend-2026-08-13b.gs.txt`). Contains
everything in the 2026-08-13 file below, so paste this one instead.

**Sheet:** no changes.

`client_error` reports now carry `navigator.onLine` from the moment of
failure, and the alert email renders it as a `Device online:` line:
`yes`, `NO -- the phone had no connection, likely not a fault`, or
`(unknown)`.

That one fact is what decides whether an alert is worth acting on. A
network error from a phone that had no signal is nothing to fix; the same
error from a connected device means something really did fail.

Sent as the string `'true'`/`'false'` rather than a boolean so a report
from an older client that omits the field stays distinguishable from a
genuine `false` -- reading a missing field as "offline" would be exactly
the wrong conclusion, and a test pins that.

Pairs with a rent.html change that suppresses these reports entirely when
the page was backgrounded mid-fetch (iOS Safari kills in-flight requests
when the phone locks). Deploy this after that ships, so the new field has
somewhere to appear.

### Charge-failure reason + automated sweep access (2026-08-20)

**Status: ready to paste** (`sfd-backend-2026-08-20.gs.txt`).

**Sheet: ONE new column.** Add `last_failure` to the **Rentals** tab
(any position, headers are matched by name). Leave every existing row
blank; the backend writes it and you never type into it.

If you skip the column nothing breaks -- the reason simply stays
invisible, exactly as it is today.

**Why.** When a charge failed, the only record was a Transactions row.
That row carries `customer_id` and `item_id` but no `rental_id`, so a
staff screen could not reliably tie a failure back to the rental it
belongs to (a customer who rented the same disc twice is ambiguous). In
practice the reason was only findable by digging through the sheet by
hand -- which is how the first real expired-card failure went unexplained.

Now `rental_payment_failed` also stamps `last_failure` on the rental as
`YYYY-MM-DD: <Stripe's message>`, and `rental_billing` returns it, so the
staff terminal can show *why* next to the RETRY button. A successful
charge clears it, so a resolved failure never lingers next to a rental
that has since been paid.

**`rental_billing` now accepts `SERVER_KEY` as well as the staff PIN.**
This is what lets the billing sweep run unattended on a schedule.

Deliberately not the staff PIN in a Netlify env var: that couples an
automated job to a human credential, so rotating the PIN silently breaks
the sweep -- and worse, a stale PIN would fail on every run and trip
`checkStaffPin_`'s **global** lockout, locking real staff out of the
terminal. The key is checked first and short-circuits, so the scheduled
job never touches the PIN counter at all.

Pass it as `?action=rental_billing&server_key=...`. The staff terminal is
unchanged and keeps using `&pin=`.

### Dashboard "Available" now means rentable (2026-08-14)

**Status: ready to paste** (`sfd-backend-2026-08-14.gs.txt`). Contains
every 2026-08-13 change too, so paste this one instead of any of them.

**Sheet:** no changes. The Dashboard rebuilds itself on the next refresh.

The CATALOG section's `Available` count filtered on `status` alone, so it
counted every out-of-rotation row as well. On the live sheet that read
804 when only 434 titles were genuinely rentable, printed directly under
an `In rotation: 437` line it plainly contradicted.

It is now the intersection of `in_rotation` and status, and the row is
labelled **Available to rent** so the number says what it means.

`Checked out` and `Return bin` are deliberately left alone: they describe
where a physical disc actually is, and one pulled from rotation while a
customer still has it is genuinely still out. Hiding it would be the
worse of the two errors.

Note this tab is a **daily snapshot**, not live formulas. To see the
change immediately, run `refreshRentalStats` once from the Apps Script
editor; otherwise the next daily trigger picks it up.

### Catalog integrity: blank status, header guard, error causes (2026-08-13)

**Status: ready to paste** (`sfd-backend-2026-08-13.gs.txt`). This file
also contains the `disc_count` change below, so it supersedes
`sfd-backend-2026-08-11.gs.txt` -- paste this one instead.

**Sheet:** no changes.

Prompted by a live failure during the first real rentals: a customer hit
`Item not found: SFD-0934` at the cabinet on a row that existed. Three
fixes, none of which depend on the others.

**1. A blank `status` cell now means available.** `in_rotation` is what
decides whether an item is rentable; a hand-added Catalog row routinely
leaves `status` empty, and that used to make the row permanently
unrentable. Worse, it still appeared in the app as browsable, because
`getCatalog` filters on `in_rotation` and not on `status` -- so the
customer got all the way to the pay button before anything objected. All
status reads now go through one `itemStatus_()` helper (the rent check,
the staff payload, `mapSheetItem`, the public `/collection` feed, and the
Dashboard counts) so the rule cannot drift between them.

**2. A missing key header now throws by name.** Columns are matched by
header name, so a header cell that gets moved, renamed or overwritten
turns every value in that column into `undefined` -- silently, and the
damage surfaces far away wearing someone else's clothes. That is what
produced "Item not found" for a row that was present: with the Catalog's
`item_id` header displaced, EVERY lookup failed at once, which reads like
one missing row rather than a broken column. `sheetToObjects` now checks
a small `REQUIRED_HEADERS` map (Catalog `item_id`; Customers
`customer_id`/`customer_token`; Rentals `rental_id`) and throws naming the
tab, the column, and where to look. Key columns only, deliberately: it is
not a schema validator, and listing merely-important columns risks
failing reads that would have worked (Rentals `item_id` was tried and
reverted for exactly that reason).

**3. The three "cannot rent this" causes are told apart.** Out of
rotation, wrong status, and vault all shared one `Item not available`
message, so the alert email never said which to go and look at. Each now
names its own cause and still carries the item id.

**Follow-up, fixed in 2026-08-13c:** `nextCustomerId_` wrapped its Rentals
read in a bare `try/catch`, which would have caught the new header guard
and thrown the benefit away -- the scan would carry on with Customers
alone, silently dropping any id that exists only in rental history. It now
tolerates only a genuinely absent tab and rethrows everything else.

**`doRentStart` too, in 2026-08-13d.** Its Rentals read fed both the
mid-payment lock on a disc and the rental-limit check, so a bare catch
leaving that list empty silently passed BOTH: a broken header would have
allowed two customers to rent the same disc, and one customer to take out
any number at once. Both sites now share one `readTabOrEmptyIfAbsent_()`
helper. Reads that only display or count (feeds, Dashboard stats) keep
their bare catches on purpose -- a section rendering empty for one request
is not a correctness problem.

### disc_count on the staff catalog, for the label printer (added 2026-08-11)

**Status: superseded by the 2026-08-13 file above, which includes it.**

**Sheet:** no changes. `disc_count` is an existing Catalog column.

One field added to `catalog_staff`'s response:
`disc_count: parseInt(r.disc_count || 1, 10)`. A box set or TV series
needs one label per disc, and the printer had no way to know how many
that was -- everything else in that payload is per-title.

It is a real number, not a string, and a blank cell reads as `1` rather
than `0` or `undefined`, so an unfilled row still prints one label. Same
coercion `mapSheetItem` has always used for this column, deliberately
identical so the two never drift.

One caveat inherited from that shared pattern: a non-numeric cell (a
typo like `two`) yields `NaN`, which serializes to `null`. `2 discs`
parses fine as `2`; only genuinely non-numeric text is affected. Worth
knowing if a label run ever comes up short.

### Owner alerts on signup/rental (added 2026-08-06)

**Sheet:** no new columns. Optional new Settings key `owner_alerts` --
leave blank (or anything other than `off`) to keep alerts on; set to
`off` to pause them without a redeploy.

No other setup step -- paste the backend and publish a new version.
Uses the same SFD Mailer relay already configured for account-link and
reminder emails, sent to `REPLY_TO_EMAIL` (`scifidojo@aol.com`).

- Fires on every successful `customer_signup`, including a blacklist-
  flagged one (the alert calls out that it needs review).
- Fires on `rent_confirm`, but only the real pending/void -> active
  transition -- never on a redelivered Stripe webhook or a confirm
  arriving after the rental already closed. Skips `comp` (staff)
  accounts, since those aren't real rental activity.
- A failed alert never blocks the signup or the rental it's reporting
  on -- same fire-and-forget pattern as every other outbound email here.
- Meant as a temporary while-we're-small signal. Flip `owner_alerts` to
  `off` in Settings once volume makes it noise instead of signal.

### Friends & family: promo codes can raise a rental limit (added 2026-08-09)

**Status: DEPLOYED 2026-08-09** (`sfd-backend-2026-08-09.gs.txt`, confirmed via `?action=ping`).

**Sheet:** add one column to the **Promo Codes** tab: `rental_limit`.
Leave it blank on existing codes -- blank means "no limit change", so
they keep behaving exactly as they do now.

| code | active | rental_limit | notes |
|---|---|---|---|
| `usetheforce` | TRUE | | public, free rental |
| `movienight` | TRUE | 3 | friends & family |

Redeeming a code that has a number there raises that account's
`rental_limit` to it, on top of the free rental every code already
grants. Both rewards come from the single redemption on purpose -- there
is one lifetime redemption per customer, so a friend would otherwise
have to pick one and could easily pick the wrong one.

Why this instead of a `?invite=` signup link: a link only ever works at
signup, and most friends and family already have an account by the time
you think to send them one. The promo card on the Rent screen works for
new and existing accounts alike, and it's a screen every customer passes
through on the way to renting.

Two guardrails: it only ever **raises** a limit (so one you set by hand
in the staff terminal is never knocked back down), and it caps at 5
server-side, so a typo in the sheet can't hand out 50 slots.

To revoke: set that code's `active` to FALSE. Accounts already upgraded
keep their limit -- lower them individually in the staff terminal if
you ever need to.

### Public catalog feed for /collection (added 2026-08-10)

**Status: DEPLOYED 2026-08-10** (`sfd-backend-2026-08-10.gs.txt`,
confirmed via `?action=ping`).

**Sheet:** no changes. Adds one GET action, `?action=public_catalog`,
which feeds the public browse page at `scifidojo.com/collection`.

**No key and no token, on purpose.** It is public data by definition --
the whole point is that anyone can browse it without an account -- and
`API_KEY` is already visible in page source, so requiring it would add
another file to the rotation list for no real protection. Same reasoning
as `ping`.

**Abuse protection is the cache instead.** `/collection` is on the
indexable side of the site (unlike `/rent`, which is `noindex`), so
crawlers will hit it. The response is cached for 5 minutes, which bounds
the ~700-row Catalog read no matter how much traffic arrives. Because
`CacheService` caps a single value at 100KB and the payload is ~120KB,
the cache is split across numbered keys -- a plain `put()` would have
failed on every write and cached nothing at all.

**What it returns per title:** `id, title, format, year, genre[], avail`
(plus `sort` only when the sort title genuinely differs). Deliberately
NOT returned: pricing, `barcode`, `imdb_id`, `cost`, `replacement_cost`,
`notes`, `condition`, holder, or the raw `status` -- availability is
collapsed to a boolean so operational states like `missing`/`damaged`/
`sold` never surface publicly. Vault and out-of-rotation items are
filtered out entirely.

**Cover art** comes from the repo-committed `/covers/<item_id>.jpg`
files, the same ones rent.html's Browse and the receipt ticket use -- so
a missing or mismatched cover shows up in all three places.

### Deployed-version marker on ping (added 2026-08-08)

**Status: DEPLOYED 2026-08-08** (`sfd-backend-2026-08-08.gs.txt`).

**Sheet:** no changes. `?action=ping` now returns a `version` field:

```
{"ok":true,"ts":"2026-08-08T10:59:41.402Z","version":"2026.08.08"}
```

It reports the `BACKEND_VERSION` constant at the top of the script, so
you can confirm what is actually deployed by opening the /exec URL with
`?action=ping` in any browser. Previously there was no way to tell --
saving in the editor does not deploy, and the Apps Script has no version
footer the way rent.html and terms.html do.

**When handing over a new backend file, bump `BACKEND_VERSION` to match
the filename.** A stale value is worse than none: it would confirm a
deployment that never happened.

The UptimeRobot relay is unaffected -- `"ok":true` still serializes first
in the body, so its keyword check still matches.

### Review fixes -- quick-receive pricing, id race, alert safety (2026-08-07)

**Status: DEPLOYED 2026-08-08** (`sfd-backend-2026-08-07d.gs.txt`). This
section, the per-rental daily rate below, and the owner alerts above are
all live.

Fixes found in review. All of these bugs were **already live** when
found, which is why this version shipped promptly.

1. **`add_catalog_item` now REQUIRES `replacement_cost`.** It previously
   left that cell blank, which makes `payoffCapCents_` fall back to
   Settings `default_payoff_cost` ($10) -- and that number is the
   ceiling on everything SFD can ever collect for the disc. A
   quick-received $35 4K would be automatically sold for $10 the first
   time a customer kept it long enough to hit the cap. There is
   deliberately no default: staff have the disc in hand, and any silent
   fallback here is a wrong price. **This changes the request shape** --
   the staff app's quick-receive form needs a "replacement cost" field,
   and a request without it now returns `{ok:false}` with a clear error.
   (That UI lives in the onboarding repo -- hand this note over.)
2. **`add_catalog_item` could mint duplicate item ids.** The script lock
   only covered the id scan, not the scan-and-append pair, so two staff
   receiving discs at the same moment could both get `SFD-0760`. The
   lock now spans both, ending with an explicit flush.
3. **Owner alerts can no longer fail a signup or a rental confirm.**
   `ownerAlertsEnabled_()` reads the Settings tab and that read can
   throw; unwrapped, it turned a *successful* signup into a visible
   error (and the customer's retry then hit "an account already exists").
   Now fully wrapped at both call sites. Bonus: with `owner_alerts=off`,
   rental confirms no longer do a wasted full-Catalog read.

No sheet changes for any of these. `replacement_cost` is an existing
Catalog column.

4. **`mark_labels_printed` is now one read + one write** instead of one
   full Catalog read *per label*. A 300-label batch costs the same as a
   1-label batch. It also now returns `{ ok: true, requested, stamped }`
   so the printer UI can tell a real success from a batch where every id
   silently missed, and a missing `label_printed_at` column now throws
   instead of reporting success while stamping nothing.

5. **Signup is now atomic too.** `nextCustomerId_` had the same
   lock-scope flaw as `add_catalog_item` — the lock covered the id scan
   but was released before the row was appended, so two simultaneous
   signups could both mint the same `CUS-####`. The lock now lives in
   `doCustomerSignup` and spans the duplicate check, the scan, the
   append, and a flush. That also fixes a second race in the same
   window: a customer double-tapping CREATE ACCOUNT on a slow connection
   could get two requests that both passed the duplicate check. The
   second now loses cleanly with the normal "account already exists"
   message instead of creating a second row.

**Cross-session status (confirmed 2026-08-07):** the staff app already
ships the required Replacement Cost field, chunks its label batches, and
has terminal UI for all the staff catalog/bin actions. `onboard-member.js`
and `stripe-webhook.js` were verified to already send `server_key` — the
long-standing "blocking follow-up" on that is cleared, nothing was broken.

### Per-rental daily rate exposed to the customer app (added 2026-08-07)

**Sheet:** no changes. No new setup step -- paste the backend and
publish a new version.

Each OPEN rental in `getCustomer`'s payload (`customer.rentals`) now
carries a `daily` field -- that specific rental's own locked-in
extended-day rate in cents (`computeAccrued_`'s existing internal
`dailyCents` value, just not previously returned to any caller). This
lets rent.html show an already-active rental's real rate even if
today's live Rental Promo has changed or ended since that rental
started -- it always accrues at the rate it began with, so showing
"today's rate" instead could quote the wrong number. Purely additive;
nothing else in the payload shape changed. If you deploy the frontend
change before this backend version, rent.html falls back to today's
live rate for these two spots (same as before this change) until you
publish this version -- no error, no broken screen either way.

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

**Account link emails (added 2026-07-13, for the unstaffed store):**

- Signup now **requires both** an email and a phone number (was either/or).
  The pair is what makes the lookup recovery work, and the email is where
  the account link gets sent.
- Every successful signup **emails the customer their personal account
  link** automatically, so a lost bookmark is no longer fatal. A mail
  failure never fails the signup — the app just skips the "we emailed it
  to you" line.
- New `send_link` action behind the app's EMAIL ME MY LINK button (the
  sign-in screen's only non-scan recovery — the old email+phone FIND MY
  ACCOUNT form was retired the same day, since controlling the inbox is
  stronger proof than knowing two facts about someone): the customer
  types their email and the link is mailed **to the address on file**. The
  response is identical whether or not the email matched an account, so it
  can't be used to find out who's registered, and there's a 10-minute
  per-address cooldown so it can't flood an inbox. The `customer_lookup`
  action stays live server-side, just unused by the app.
- **The emails send through a separate "SFD Mailer" relay script that
  lives in a Gmail account — this is required, not optional.** The main
  script's Google account signs in as scifidojo@aol.com, and mail stamped
  from an aol.com address but sent through Google's servers fails AOL's
  DMARC policy — every major provider bounces it on arrival (that's the
  554 5.7.9 error). Setup, one time:
  1. Create (or pick) a Gmail account for the shop.
  2. In that account: script.google.com → New project → name it "SFD
     Mailer" → paste the delivered `sfd-mailer` file → save.
  3. Run its `testMailer` function once from the toolbar and approve the
     permission prompt. Check the account's own inbox for the test email.
  4. Deploy → New deployment → Web app → Execute as **Me**, access
     **Anyone** → Deploy → copy the `/exec` URL.
  5. In the MAIN backend script, paste that URL into `MAILER_URL` near
     the top (the shared `MAILER_KEY` already matches in both delivered
     files), run `testAccountLinkEmail` once (approve its prompt too —
     it now calls an external URL), confirm the log says SENT and the
     email arrives at the AOL inbox, then deploy a new version.

  Customers see mail from "Sci-Fi Dojo" at the Gmail address, and replies
  go to scifidojo@aol.com automatically (replyTo). Gmail's daily sending
  quota (about 100/day on a consumer account) is far above what signups +
  recoveries should ever need; if a test blows through it, emails silently
  stop until the next day — signups keep working regardless.

**Self-service card update (added 2026-07-13):** two new server-to-server
actions, `rent_card_lookup` (the update-card Netlify function asks who a
token belongs to) and `rent_card_updated` (the webhook clears a failed
`payment_status` once a new card is saved). A customer whose card fails
now taps UPDATE CARD in the app (failed-card banner, rent screen, or
Account) and fixes it themselves through a Stripe page — no money moves
there, it only saves the new card. Owed charges are NOT retried on the
spot; the next RUN BILLING SWEEP (or CHARGE & CLOSE at return) collects
them, so run a sweep after you see a customer un-flag if you want the
money sooner.

**Maximum charge now rides the catalog payload (added 2026-07-13):**
`getCatalog` sends a resolved `cap_cents` per item (the same value
`payoffCapCents_` already computes for accrual — the item's
`replacement_cost`, or the Settings `default_payoff_cost` when blank)
so the app can show the real ceiling before a customer pays instead of
only after, in Rentals history. This also fixed a latent bug:
`mapSheetItem` (used by `getCatalog` and a few other reads) never
passed through `replacement_cost` at all, so nothing built on it going
forward would have picked up a per-title override — now it does.

**Active promo pricing now shows "was $X, now $Y" (added 2026-07-14):**
`getCatalog` sends `rental_price_was` (the resolved pre-discount price)
alongside the already-discounted `rental_price` whenever a base-discount
Rental Promo is live — previously the discount silently overwrote the
number and the original was lost, so the app couldn't show both.
`getActiveRentalPromo_` also now returns `standard_daily_cents`
(= `RENT_DAILY_CENTS`) so the app can tell whether a promo's day rate is
actually a discount without hardcoding the standard rate itself. Neither
field appears when no promo is live — existing prices are unaffected.

**Uptime monitoring + client error reporting (added 2026-07-14):** the
cabinet has a person on-site but no one who can accurately describe a
technical failure, so this closes that gap two ways:

- **`?action=ping`** — no key required, no sheet reads, instant
  `{ok:true}`. Point a free monitor (UptimeRobot or similar) at
  `<APPS_SCRIPT_URL>?action=ping` every 1-5 minutes, and a second check
  at `https://scifidojo.com/rent` itself (checks Netlify hosting
  separately from the backend). Set the monitor's alert to your email
  or phone — this is the one piece you set up outside any repo, since
  it's a third-party service, not code.
- **`client_error` action** — rent.html now reports real failures
  directly: uncaught JS errors, unhandled promise rejections, and the
  catch blocks of signup, rent, return, card update, and the email-link
  recovery. Each report emails you (via the same SFD Mailer relay used
  for account links) with what failed, which customer/screen, and the
  actual error message — no more guessing from a secondhand phone
  description. Rate-limited two ways so a broken thing can't flood your
  inbox: the same error won't re-alert more than once every 15 minutes,
  and a hard cap of 10 error emails/hour regardless of how many
  different errors occur. Deliberately does NOT report routine
  rejections a customer already sees a clear message for (declined
  card, rental limit reached, etc.) — only things that need an actual
  fix. Requires the mailer relay to already be set up (see the account
  link email section above); if it isn't, error reports simply don't
  send, same as any other email from this backend.
- **Server-side exception alerting** — `doGet`/`doPost`'s own top-level
  `catch` blocks now also email you when Apps Script itself throws (a
  bad column name, a Sheets quota error, a malformed request body).
  This is the backstop `client_error` can't cover: it also catches
  failures in the server-to-server calls from Netlify (`onboard`,
  `update_stripe`, `rent_confirm`, etc.) that never reach a customer's
  browser at all. Shares the same rate limiting as `client_error`
  (15-min per-signature cooldown, 10/hour cap total across both), with
  item/customer codes stripped from the dedup key first so the same
  underlying bug hitting different items/customers still counts as one
  alert instead of flooding the cap.

**customer_id generation fixed (added 2026-07-14):** signup ids used to
come from `'CUS-' + sheet.getLastRow()`, which reused an id the moment
any row above the bottom got deleted — this happened live in testing
(two CUS-005 accounts, the second inheriting the first's open rental
and unable to rent). `nextCustomerId_()` now mints from the max
existing `CUS-###` suffix across **Customers AND Rentals** (+1, wrapped
in `LockService` so concurrent signups can't race to the same id).
Works against whatever's already in the sheet — no need to clear test
data first. Going forward, prefer marking an account `status: closed`
over deleting its row, since a deleted row's id can still be referenced
in Rentals/Transactions history either way.

## 3. Netlify (onboarding repo)

Commit the four delivered function files into `netlify/functions/`:
`start-rental.js`, `rental-webhook.js`, `charge-rental.js`, `billing-sweep.js`.

**Added 2026-07-15 (NJ sales tax):** also commit the updated
`start-rental.js` and `charge-rental.js`. NJ treats a disc rental as a
taxable lease/rental of tangible personal property, so the standard
rate now applies to both the base price and the extended-day fee.
Requires the paired Apps Script backend update (adds a `sales_tax_rate`
Settings key, defaulting to 6.625 if left blank, and `tax_cents` on
`rent_start`/`rent_charge_lookup`'s responses) — deploy that first or
alongside. Deliberately Stripe-side only: tax shows as its own line
item on the first rental's Checkout Session, and is folded into the
actual charged amount on both off-session charge sites, but never
touches the sheet's own "paid" figures or the payoff cap — add a
`sales_tax_rate` row to Settings if you ever need to change the rate
(no redeploy needed for that). No new env vars, no Stripe dashboard
change.

**⚠️ Required before deploying the 2026-07-14 backend:** also commit
the updated `onboard-member.js` and `stripe-webhook.js` — these two
legacy membership functions now send `server_key: process.env.SFD_SERVER_KEY`,
since the Apps Script `onboard`/`update_stripe` gate is no longer
optional (see the Security Model section). Deploying the new backend
without also deploying these two updated functions breaks member
signup and Stripe activation entirely (every call gets rejected as
unauthorized). `onboard-member.js` also no longer forwards client-sent
`active_status`/`vault_access` at all — the Apps Script already ignores
them, so this just stops the Netlify function from pretending to pass
through fields it doesn't actually control. No new env var needed,
`SFD_SERVER_KEY` already exists from the rental functions above.

**Added 2026-07-15 (Stripe email receipts on off-session charges):** also
commit the updated `start-rental.js` and `charge-rental.js`. Neither
Stripe nor the app ever emails a receipt for an off-session charge
(a returning customer's one-tap rental, or a CHARGE & CLOSE / billing-sweep
extended-fee charge) unless `receipt_email` is explicitly set on the
`paymentIntents.create()` call — Stripe does not infer it from the
attached Stripe Customer. Both files now pass it (`start.email` for the
base-charge branch in `start-rental.js`; `rec.email` for the shared
`chargeOneRental()` used by both `charge-rental.js` and
`billing-sweep.js`). Requires the paired Apps Script backend update
(`rent_charge_lookup` now also returns the customer's `email`) — deploy
that first or alongside. No new env vars, no Stripe dashboard change.

**Added 2026-07-14 (Promo Codes free rental):** also commit the updated
`start-rental.js` and `rental-webhook.js`. `start-rental.js` now branches
on `rent_start`'s new `free_credit` flag: if the customer already has a
card, it confirms the rental directly with no Stripe call at all (same
shape as the staff-comp path); if they don't, it opens a Stripe Checkout
**setup-mode** session (collects + saves a card, charges nothing) tagged
`sfd_kind: 'free_promo_rental'`. `rental-webhook.js` recognizes that tag
on completion, sets the new card as the invoice default (same as its
card-update branch), and calls `rent_confirm` instead of
`rent_card_updated`. No new env vars, no Stripe dashboard change —
setup-mode sessions fire the same `checkout.session.completed` event the
endpoint already listens for.

**Added 2026-07-13:** also commit `update-card.js` (opens the Stripe
Checkout setup-mode session for a card update — same env vars, nothing
new to configure) and the updated `rental-webhook.js` (a completed
**setup-mode** session now makes the new card the customer's card —
invoice default set, old cards detached — then calls
`rent_card_updated` to unblock the account; payment sessions behave
exactly as before). No Stripe dashboard change needed: setup sessions
fire the same `checkout.session.completed` event the endpoint already
listens for.

**Also updated 2026-07-13:** `start-rental.js`'s Checkout line-item
description said "up to the price of the disc" — replacement-cost
phrasing the project deliberately avoids everywhere else. It now reads
"up to a maximum charge of $X", using the real `cap_cents` that
`rent_start` already returns (previously unused by this file) instead
of a vague reference to the disc's value. The day rate is now
consistently labeled "a $X/day extended rental fee" (was "$X per
day") to match the wording used everywhere else in the app and terms.

Then in Netlify → Site settings → Environment variables, add:

| Variable | Value |
|---|---|
| `SFD_API_KEY` | the `API_KEY` constant from the Apps Script (same as the page key; visible in page source by design) |
| `SFD_SERVER_KEY` | the `SERVER_KEY` constant from the Apps Script — server-to-server secret, must NEVER be committed to this (public) repo or appear in any page source |
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
in, due for sweep, kept discs, failed cards, cards to print — each chip
jumps to its section), compact cabinet codes, then **Outstanding Rentals**
(each open rental with days out / paid / owed / cap, a CHARGE & CLOSE
button on returned discs, a LOG RETURN (STAFF) button on active ones
that bypasses the customer return cooldown for wrong-disc walk-ups, and
the RUN BILLING SWEEP button), **Kept
Discs** (see the section above), **Cards To Print** (below), and
**Rental Customers** (search; badges including a "PAUSED — KEPT DISC"
badge with a REACTIVATE button; open a customer's app; PRINT CARD). The
legacy membership tools (member lookup, active checkouts, return bin) are
collapsed at the bottom until tapped.

### Cards To Print (batch printing)

Cards are no longer printed the moment someone signs up — they're printed
in batches as you get to them, and picked up on a later visit. **Cards To
Print** lists every active signup without a card yet; check up to two
(the print sheet holds two people per physical sheet, same as it always
has), tap **PRINT SELECTED**, and both are marked printed automatically.
Pick just one and it prints solo with the second slot blank, same as
before. The existing single **PRINT CARD** button in Rental Customers
search is untouched — still there for reprints and one-offs regardless of
whether someone's been through the batch flow yet.

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

1. Open `scifidojo.com/rent` in a private window → sign up with a real
   email you can check (both email AND phone are now required — try
   leaving one blank first and confirm the app blocks it). The success
   screen should show the cabinet code immediately (no rental needed yet)
   and say the link was emailed; confirm the welcome email arrives with a
   working account link (check spam the first time).
2. Sign up again with an email/phone you've added to the Blacklist tab →
   the success screen should say the account is pending review, with no
   cabinet code, and the Rentals tab should still be empty for that account.
3. Reload `scifidojo.com/rent` with no token (simulating a lost bookmark) →
   expand "Or email me my account link" → submit step 1's email: the app
   shows the same "if that email is on an account" message whether or not
   the email matches anything, and the recovery email with the link should
   arrive (a second tap within 10 minutes sends nothing — that's the
   cooldown). Scanning the QR from the printed card should also work —
   commit the delivered `print-cards.html` into the onboarding repo's
   `cards/` first, so customer cards encode the `/rent` link instead of
   the legacy `/member` one.
4. Rent a disc on the first (non-blacklisted) account → Stripe Checkout →
   card `4242 4242 4242 4242`, any future expiry/CVC → back in the app the
   rental shows active.
5. Check the sheet: Customers row, Rentals row `active`, catalog item
   `checked_out`.
6. Try to return it right away → the app should show the disc locked with
   a "returns unlock in ~60 min" note (that's the return cooldown; the
   dashboard slot stays used while the disc is active). To keep testing
   without waiting an hour, either use the staff terminal's LOG RETURN
   (STAFF) button on that rental, or temporarily set
   `return_cooldown_minutes` to `0` in Settings (put it back after).
7. With the return logged: the app's rental slot frees IMMEDIATELY (you
   can rent again before staff touch anything), and the staff terminal
   shows RETURNED — CHECK IN → CHARGE & CLOSE (within the 7-day window it
   just closes; nothing owed).
8. Rent again (same account) — it should charge with one tap, no redirect.
9. Failed-card path: new signup with card `4000 0000 0000 0341` (attaches but
   fails charges) — the sweep flags the customer, and their app shows the
   card banner with renting blocked.
10. Staff comp path: set `comp = TRUE` on one account's Customers row →
    renting on it should skip Stripe entirely (no checkout page, "RENT
    (NO CHARGE)" button), the rental still shows on Outstanding Rentals
    with a STAFF — NO CHARGE badge, and check-in closes it without
    charging.
11. Kept-disc path: rent a disc, then in the sheet set that rental's
    `replacement_cost` (via the catalog item) very low — say $3, equal to
    the base price — and run RUN BILLING SWEEP. The rental should close as
    `paid_off`, the catalog item should drop out of rotation, the customer
    should show `status: paused` and a "PAUSED — KEPT DISC" badge in
    Rental Customers, and the disc should appear in the staff terminal's
    Kept Discs section with an EMAIL CUSTOMER link and a REACTIVATE
    ACCOUNT button. Try PROCESS RETURN (a refund amount, a note, the
    reactivate checkbox) and confirm the rental closes for good and the
    catalog item's `in_rotation` matches your checkbox choice. Try
    REACTIVATE ACCOUNT separately and confirm the customer can rent again.
12. Cards To Print: sign up two more test accounts, confirm both appear in
    Cards To Print, check both, tap PRINT SELECTED, confirm the print sheet
    opens with both names filled in and both disappear from the pending
    list afterward.
13. Maximum charge & due date (added 2026-07-13): in Browse, expand a
    catalog item and confirm a "Maximum charge $X" fact appears (set that
    item's `replacement_cost` first to confirm it's the real per-title
    value, not the $10 default). Enter that item's code on the Rent
    screen and confirm the item-confirm card says "...up to a maximum
    charge of $X" before you pay. With an active rental from step 4,
    check My Rentals and the Return screen's list both show "Due back
    [date]" (start date + 7 days) alongside the existing accrual info.
14. Promo pricing display (added 2026-07-14): with a Rental Promo live
    that sets both `daily_rate` and `base_discount` (like the launch
    special row from earlier), confirm Browse and the item-confirm card
    both show the original base price struck through next to the
    discounted one, and the standard $2/day struck through next to the
    promo rate. Turn the promo off (or let it expire) and confirm both
    strikethroughs disappear and the plain price shows as before.
15. Uptime + error reporting (added 2026-07-14): hit
    `<APPS_SCRIPT_URL>?action=ping` directly in a browser and confirm an
    instant `{"ok":true,...}` with no key. Then, in the browser console
    on `scifidojo.com/rent`, run `reportClientError('test', new
    Error('manual test'), 'walkthrough')` and confirm an email arrives
    within a minute or two with that message; run it a second time
    immediately and confirm no second email (15-min per-error cooldown).
    Finally set up the actual uptime monitor (UptimeRobot or similar)
    pointed at both the ping URL and `scifidojo.com/rent`, with alerts
    going to your email or phone.
16. Server-side alerting (added 2026-07-14): from the Apps Script
    editor, temporarily break something on purpose — e.g. rename a
    Catalog header — hit `?action=catalog&key=<your key>&token=<any
    token>` in a browser, and confirm both a JSON error in the response
    AND an email titled "SFD Server Error: doGet:catalog" arrive. Fix
    the header back afterward. Hit it a second time before 15 minutes
    pass and confirm no second email (shared cooldown with
    `client_error`).
17. customer_id generation (added 2026-07-14): sign up a test account,
    note its id, delete that row from Customers, sign up a second test
    account, and confirm it does NOT reuse the deleted id (it should
    continue from the highest id still present, including in Rentals
    history if any exists).
18. Promo Codes (added 2026-07-14): add a row to the Promo Codes tab
    (e.g. `usetheforce`, `active` TRUE). On a test account with no card
    on file, open the Rent screen, expand "Have a promo code?", enter
    the code (try mixed case / extra spaces to confirm the match is
    forgiving) — confirm the card disappears and a "Your next rental is
    free!" banner appears. Enter the SAME or a different code again and
    confirm it's rejected (one lifetime redemption). Scan an item: the
    confirm card should say "Free!" and the button "CONFIRM FREE
    RENTAL". Complete it via Stripe Checkout (card `4242 4242 4242
    4242`) — this should be a **setup-mode** session (no charge shown),
    and the app should return to a success receipt reading "Free (promo
    credit)". Check the sheet: Rentals row `base_price` is `0` (not
    blank), Customers row `free_rental_credits` back to 0. Repeat once
    more on an account that ALREADY has a saved card (e.g. from a prior
    test rental) and confirm this time there's no Stripe redirect at
    all — it confirms instantly.
19. Flip to live keys (and a live-mode webhook) when everything passes.

## 7. Terms page

Revise `/terms` before printing the QR poster — see `TERMS-CHECKLIST.md` in
this repo for the clauses the rental model needs.

## 8. Launch

Print the QR poster pointing at `https://scifidojo.com/rent` and put it on
the cabinet. That is the moment the system goes live.
