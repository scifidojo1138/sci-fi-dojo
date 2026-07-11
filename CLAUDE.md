# Sci-Fi Dojo — Project Handoff (Technical)

Last updated: 2026-07-06. Update this file whenever architecture, endpoints, or conventions change.

## Project Overview

Sci-Fi Dojo (SFD) is a membership-based physical media rental club operating in New Jersey. Members rent Blu-ray, DVD, and 4K UHD discs from a self-service cabinet. The tech stack is intentionally minimal — no framework, no database, no server — just single-file HTML/CSS/JS apps backed by Google Apps Script and Google Sheets.

## Architecture

### Frontend
- **Single-file HTML/CSS/JS apps** — no build step, no bundler, no framework. Vanilla JS only.
- Fonts: Orbitron, Share Tech Mono, Exo 2 (Google Fonts, loaded via `<link>` + preconnect — never CSS `@import`, which blocks rendering)
- Dark blue-cyan palette with CSS variables (see `:root` block in each file)
- Deployed via **GitHub → Netlify** (committing to the repo IS the deploy)
- Domain: **scifidojo.com** (DNS via Cloudflare)

### Apps — two repos

**This repo (`sci-fi-dojo`, public):**
| File | URL | Description |
|---|---|---|
| `member.html` | `scifidojo.com/member?token=tok_xxx` | Member app (legacy model, kept until cutover) |
| `rent.html` | `scifidojo.com/rent?token=cus_xxx` | Pay-per-rental customer app (Redbox model; no token = signup). Presented publicly as a free SFD Account — see "Pay-Per-Rental" below. |
| `terms.html` | `scifidojo.com/terms` | Rental terms |
| `BACKEND-UPDATE.md` | — | Apps Script change log / paste instructions |
| `TERMS-CHECKLIST.md` | — | Clause checklist for revising `/terms` around pay-per-rental billing |

There is no `index.html`; `netlify.toml` redirects `/` to the Instagram profile (`@scifi_dojo`) until a proper landing page exists.

**Onboarding repo (private Netlify site: `scifidojo-onboarding.netlify.app`):**
| File | Description |
|---|---|
| `sfd-onboarding.html` | Staff onboarding terminal (tier selection, Stripe checkout) |
| `success.html` | Post-payment enrollment confirmation + QR card |
| `sfd-staff.html` | Staff terminal (shares the onboarding terminal's teal/cyan style since 2026-07-08): attention strip, cabinet codes, outstanding rentals + sweep, customer search + card printing; legacy member tools collapsed at the bottom |
| `cards/print-cards.html` | Member card print layout |
| Netlify functions | `create-checkout`, `onboard-member`, `process-return`, `start-rental`, `rental-webhook`, `charge-rental`, `billing-sweep` |

### Backend
- **Google Apps Script** web app connected to **SciFiDojo_Sheet_v2** (Google Sheets)
- Deployed as: Execute as Me, Anyone can access
- Returns JSON. GET with `?action=` param or POST with JSON body
- Current URL: `https://script.google.com/macros/s/AKfycby7PvoGckOSEuE_qBR0Rl12sudFnjnf5rT4rNu0kUSJ_lmFVvAbjBBo5DdlVfNZpnwjDQ/exec`
- **Deployment rule (learned the hard way):** the URL only changes if you create a NEW deployment. To ship backend changes without breaking every client, always publish a new version of the EXISTING deployment: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** Saving code in the editor does NOT deploy it.
- A copy of the backend script is kept in the onboarding repo as backup. Committing it does not deploy it.

## Security Model

Two credentials, both checked server-side in Apps Script:

1. **`API_KEY`** — shared constant defined in both the Apps Script and each client page. Sent as `&key=` on GETs, `api_key` in POST bodies. Gates the member-facing actions: `member`, `catalog`, `checkout`, `return_log`, `member_request`. The key is visible in page source by design — it deters bots and casual URL abuse. Real per-member security is the membership token. To rotate: change it in the Apps Script AND every client page, then redeploy both.
2. **`staff_pin`** — lives only in the Settings tab of the sheet (never in any page source). Sent as `&pin=` on GETs. Gates the staff actions: `all_members`, `active_checkouts`, `return_bin`, `catalog_staff`, and (as `staff_pin` in POST body) `return_processed`, `correction`. The staff page's login gate verifies the typed PIN against the backend — there is no hardcoded staff code in `sfd-staff.html`.

3. **`SERVER_KEY`** — server-to-server secret shared only between the Apps Script and the Netlify functions (env `SFD_SERVER_KEY`; never in any page source). Gates the payment-recording rental actions: `rent_confirm`, `rent_charge_recorded`, `rent_charge_lookup`, `rental_payment_failed`. Without it, anyone with the public API key could mark rentals as paid.

**Deliberately ungated:** `onboard` and `update_stripe` (called server-side by Netlify functions). A commented-out gate exists in the Apps Script `doPost` — enable it once the Netlify functions include `api_key` in the JSON they send.

The membership token rides in the member URL (`?token=`) by QR-card design; `member.html` carries `<meta name="robots" content="noindex, nofollow">` so token links never get search-indexed.

## Apps Script — Endpoints

### GET
- `?action=member&key=&token=` — full member object (rentals, return_pending, rental_history, cabinet/vault codes, `location`, `active_promo`). `tier_limit`/`loan_days` already include any active promo bonus.
- `?action=catalog&key=&token=` — filtered catalog (in_rotation=TRUE only; vault items only with vault_access; filtering is backend-side, never client-side)
- `?action=events&key=&token=` — active, non-past events (Events tab); past events auto-hide by date so staff need not toggle them off
- `?action=perks&key=&token=` — active perks (Perks tab)
- `?action=updates&key=&token=` — active updates ("The Weekly Rewind"), newest first (Updates tab)
- `?action=all_members&pin=` — staff: full member list
- `?action=active_checkouts&pin=` / `?action=return_bin&pin=` / `?action=catalog_staff&pin=` — staff lists

### POST (JSON body)
- `checkout` — checks out items, updates catalog status, logs transaction (key)
- `return_log` — member logs return, slot frees immediately, item → return_pending (key)
- `member_request` — notify-me / star / title_request / review / flag / rsvp / rsvp_cancel from the member app; all append to the Requests tab with `request_type` (key). Note: review and flag land in **Requests** (triage queue), not Transactions. `rsvp`/`rsvp_cancel` carry the event_id in `item_id` and the event title in `text` (gives staff a headcount).
- `return_processed` — staff confirms physical return (staff_pin)
- `correction` — admin note (staff_pin)
- `star` — legacy route, superseded by `member_request`; kept for compatibility
- `damage_reported` — legacy member disc-issue flag (token-validated)
- `onboard` / `update_stripe` — called by Netlify functions during enrollment

## Google Sheets — SciFiDojo_Sheet_v2

Apps Script reads columns by header name via `sheetToObjects()`. Tabs:

- **Members:** `member_id, member_token, display_name, stripe_email, contact_email, stripe_phone, contact_phone, tier, active_status, deposit_status, vault_access, invite_status, cabinet_code, next_billing_date, joined_date, notes, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, deposit_collected_date`
- **Catalog:** `item_id, title, sort_title, year, edition, format, status, collection, subcategory, group_name, disc_count, condition, acquisition_type, cost, source, notes, in_rotation, last_checked, purchase_price, replacement_cost, replaceability, current_holder_member_id, due_date`
  - `sort_title` — populated only when title sorts wrong ("The Matrix" → "Matrix, The"); frontend falls back to `title` when blank
  - `in_rotation` — only TRUE items are served to clients
  - `collection` — "general" or "vault"; `status` — "available" / "checked_out" / "return_pending"
- **Catalog Backup:** the REAL library (~759 items). **Catalog is currently demo data (45 items).** See go-live checklist below before swapping.
- **Transactions:** `transaction_id, timestamp, member_id, item_id, action, status_result, note_type, note_text, actor_type, override_type`. Checkout due date is stored in `note_text`.
- **Settings:** decorative header rows — real headers in row 3. Keys: `current_general_code`, `current_vault_code`, `code_rotation_date`, `staff_pin`, `location_address`, `location_maps_url`, `location_hours`. The three `location_*` keys feed the member app's Hours & Location screen; edit them to change address/directions/hours with no redeploy. `location_hours` is a multi-line cell, one "Day<tab>hours" per line (any order — the app sorts Mon→Sun and highlights today).
- **Requests:** `request_id, timestamp, member_id, item_id, request_type, title_text, status, staff_notes`
- **Events:** `event_id, title, date_start, date_end, location, description, rsvp_enabled, image_url, active` — served by `events`; only `active=TRUE` and start date >= today are returned. `date_start`/`date_end` parse as dates (used for the Add to Google Calendar link); `rsvp_enabled` FALSE hides the RSVP button; `image_url` is a root-relative path to a repo-committed image (e.g. `/events/movie-night.jpg`, see `/events/README.md`), shown in the expanded card; blank = no image.
- **Perks:** `perk_id, title, description, image_url, active` — served by `perks`; only `active=TRUE` returned. `image_url` is a root-relative path to a repo-committed image (e.g. `/perks/popcorn.jpg`, see `/perks/README.md`); blank = text-only perk.
- **Updates:** `update_id, date, title, body, active` — served by `updates` ("The Weekly Rewind"); only `active=TRUE`, newest first by `date`. `body` is freeform; line breaks render in the app. The newest unseen update shows a "new" dot per device (localStorage `sfd_rewind_seen_<member_id>`).
- **Promos:** `promo_id, title, description, date_start, date_end, bonus_rentals, bonus_loan_days, tiers, active` — read server-side by `getActivePromo()`. A promo is live when `active=TRUE` and today is within `[date_start, date_end]` (inclusive, Eastern) and `tiers` is blank (all tiers) or lists the member's tier. Live bonuses are added to the member's **effective** `tier_limit`/`loan_days` in `lookupMember`, so checkout enforcement and availability "just work". The member's permanent plan is also returned as `base_tier_limit`/`base_loan_days`: the app shows **base** on the plan-identity lines (tier line, Membership screen) so a promo ending never looks like a downgrade, while the "Available X of Y" card uses the effective limit and tags the extra with "+N promo". `active_promo` (title + `description` + bonuses + `date_end`) drives the dashboard banner — the banner copy is the staff-written **description**, not auto-generated. A promo only counts as live when at least one bonus is non-zero. Extended loans persist (due dates are stamped per rental); `slotsLeft` clamps at 0 so an over-limit member after a promo ends simply can't check out new items.
- **Dashboard / Expenses:** human-facing, not read by backend logic

## Pay-Per-Rental (Redbox model) — the primary business model

Replaces deposits + memberships (member.html continues to work until cutover). One static QR on the cabinet → `scifidojo.com/rent` → signup (name, email/phone, terms checkbox) → personal `cus_` token URL, bookmarked and reused.

**Framing note:** this is presented to the public as a **free SFD Account** — not a membership. Signup copy says "Create Your SFD Account," the button says "Create Account," and staff print a physical **SFD card** (not a "membership card") using the existing card-print flow (see below). "Membership" is deliberately reserved for a possible future paid tier built on the legacy `Members` tab/tier system (`member.html`); Phase 1 is explicitly an account, with no monthly fee and no deposit, so the free/paid distinction stays legible in conversation even though both are colloquially "signing someone up." Internal code (`Customers` tab, `customer_id`, `customer_token`) already used this language and is unchanged.

### Pricing & accrual (single source of truth: `computeAccrued_` in the Apps Script)
- Base price = Catalog `rental_price` column in dollars (blank defaults to **$3**; $2 remains available as an explicit per-item floor for cheaper titles), covers days 1–7. The 7-day included window matches the shop's Thu–Sun open days: 7 days guarantees every rental spans at least one full open window to return in, no matter which open day it started on (the original 3-day window didn't survive the Mon–Wed closure — a rental could come due while the shop was closed with no way to return it).
- Then $2/day (`RENT_DAILY_CENTS`, bumped from $1 alongside the window extending from 3 to 7 days, to keep per-rental revenue roughly steady), `daysOut = ceil((until - start)/1day)` where `until` = `return_date` if returned else now — so charges freeze the moment the customer logs a return, regardless of when staff process it.
- **24-hour grace (`RENT_GRACE_DAYS = 1`, unadvertised):** extended fees only start once a disc is MORE than one day past the included window (day 9 under 7+1), so a return sitting unseen in the bin overnight never costs a day. The app still says "7 days" everywhere — the grace is a quiet buffer, not a longer window. Trusted-account "on time" tracks the same boundary (`<= RENT_INCLUDED_DAYS + RENT_GRACE_DAYS`).
- **Rental Promos** (pricing promos for pay-per-rental; separate from the legacy member Promos tab): tab `Rental Promos` — `promo_id, title, description, date_start, date_end, daily_rate, base_discount, active`. Live when `active=TRUE`, today within `[date_start, date_end]` (inclusive), and at least one lever set: `daily_rate` replaces the $2 extended-day rate, `base_discount` comes off every base price (floored at $1). First live row wins — pricing promos do not stack. **A rental keeps the deal it started under:** `doRentStart` stamps the discounted base into `base_price` and the promo rate into the Rentals `daily_rate` column (blank = standard rate), and `computeAccrued_` reads the stamped rate, so a promo ending never changes what an open rental accrues. The customer payload carries `active_promo` (title/description/date_end/daily_cents/base_discount_cents) which drives the app's promo banner (staff-written description) and its quoted day rate for new rentals; `getCatalog` sends effective (discounted) prices while a base-discount promo is live; `rent_start` returns `daily_cents` so the Stripe Checkout description quotes the promo rate.
- Total charges cap at Catalog `replacement_cost` (blank → Settings `default_payoff_cost`, default $10 — this is a replacement-value ceiling, not a "rate," so it did **not** move with the day-window/price bump above). **Hitting the cap means the disc is kept by default** (decision 2026-07-10, reversing the 2026-07-06 "always expected back" stance): the moment a sweep/manual charge pushes `paid_cents` to the cap on a rental that has NOT been physically returned (`close !== true`), `doRentChargeRecorded` auto-closes it as `paid_off` (not `closed`), pulls the catalog item from rotation (`status: 'sold', in_rotation: 'FALSE'`, `current_holder_member_id` left populated so staff can see who has it), and auto-pauses the customer's account via `maybeAutoPauseForPayoff_()` (see Kept Discs below). A rental that IS being physically checked in (`close === true`) always closes as a normal `closed` regardless of the math — hitting the cap exactly on a real return is still just a return. Avoid the words "late fee" and "replacement cost" in anything customer- or staff-facing; the accrual after the included window is an extended-rental fee, and the cap is a "maximum charge."
- **Existing catalog rows with an explicit `rental_price` typed in do not move automatically** when these defaults change — only rows left blank pick up the new default. Bumping already-priced titles is a manual (or separately-scripted) sheet edit, not something the backend does for you.

### Kept Discs (rentals that hit the maximum charge)
- A `paid_off` rental means the customer kept the disc by default — no obligation to return it, no deadline if they change their mind. `getRentalBilling()` includes `paid_off` rows alongside the normal active/return_pending ones (tagged by `status`, `due_for_sweep` always false for them) so the staff terminal's **Kept Discs** section reads from the same one call; each row carries `customer_email`/`customer_phone`/`customer_status` for the UI.
- **Auto-pause:** `maybeAutoPauseForPayoff_()` sets the customer's `status` to `paused` the moment a disc is kept (never overwrites an existing `flagged` blacklist status). Paused blocks new rentals (`doRentStart` already rejects any non-`active` status) and hides the cabinet code, exactly like any other inactive account — the rent.html banner text is already generic ("Account paused...") so no app-side change was needed. It's not a penalty, just a hold until staff follow up — the plan is mainly by email.
- **Staff terminal → Kept Discs:** each row shows what was paid, an **EMAIL CUSTOMER** `mailto:` link pre-addressed to the customer with a check-in template, a **REACTIVATE ACCOUNT** button (only shown while paused — POSTs `reactivate_customer`, staff_pin-gated, purely manual per the user's choice, no auto-reactivate), and **PROCESS RETURN** for the rare walk-in where the disc comes back.
- **Walk-in return (`process_kept_return`, staff_pin-gated):** staff decide case-by-case whether to accept the disc back at all (may decline if it's already been replaced or isn't needed) and, if accepted, enter a refund amount (capped server-side at what was actually paid on that rental — never more), an optional note, and whether the item goes back into rotation. This closes the rental for good (`status: 'closed'`) and updates the catalog (`in_rotation` per the staff choice, holder/due_date cleared). **The actual Stripe refund is issued by hand in the Stripe dashboard** — this action only records the decision for bookkeeping; it never calls Stripe. Reactivating the account (above) is a fully independent decision from processing the disc's return — either can happen first, or alone.
- Trusted Accounts needs no special-casing for any of this: `countOnTimeReturns_()` already only counts `closed` rentals within the included window + grace, so `paid_off` rentals (and the eventual `closed` rental from a walk-in return, which by definition ran far past the window to reach the cap) never count toward or against the on-time total.

### Trusted Accounts
- An account's `rental_limit` is raised automatically once it has enough **on-time returns** — closed rentals returned within the included window (`ceil(daysOut) <= RENT_INCLUDED_DAYS`, currently 7 days), computed fresh from Rentals each time by `countOnTimeReturns_()`. Rentals kept past the included window, paid off outright, or still open don't count toward or against the total. Because this reads the same `RENT_INCLUDED_DAYS` constant as the accrual math, "on time" always tracks whatever the included window currently is — it moved from 3 to 7 days for free when the window changed.
- Thresholds live in Settings so they're tunable without a redeploy: `trusted_on_time_threshold` (default 10) and `trusted_rental_limit` (default 2). `maybeUpgradeToTrusted_()` runs after any rental closes (`doRentChargeRecorded` and `doRentalClose`), only raises (never lowers) the limit, and leaves a dated note on the customer's `notes` field so staff can see why it changed.
- Anything beyond this — a customer who's great but occasionally keeps a disc past the included window, wanting a limit above the trusted default, badges/perks/streak mechanics — stays a manual `rental_limit` edit or a deliberately deferred feature; the auto-upgrade only ever does the one thing above.

### Blacklist and cabinet code timing
- The general-collection cabinet code is handed to a customer **as soon as their account is created** — `getCustomer()` reveals it whenever `status === 'active'`, with no rental required first. (The vault code, if this ever grows one, stays separately gated — untouched by this.)
- A new `Blacklist` tab (`blacklist_id, email, phone, reason, added_by, added_date`) is checked at signup by `isBlacklisted_()` (case/whitespace-insensitive on email, digits-only on phone, so formatting differences like dashes or parens still match). A match doesn't reject the signup outright — it still creates the account (so staff have a record and a legitimate person isn't silently locked out with zero explanation) but writes `status: 'flagged'` instead of `'active'`. A flagged account gets no cabinet code and can't rent (`doRentStart` already requires `status === 'active'`); the app shows the same generic "Account paused" banner as any other non-active status, without revealing why. Today the staff override is a direct edit of that customer's `status` cell back to `'active'`; the staff terminal's Rental Customers search flags a blacklisted account with a red "FLAGGED — REVIEW" badge so it isn't missed.
- This only stops a **repeat** offender from cycling through disposable contact info to sign up again — it can't retroactively catch a first-time bad actor whose payment hasn't happened yet.

### Billing policy (fees vs locked-card risk)
- **At rental:** base charged immediately. First rental via Stripe Checkout (`start-rental` returns a URL; card saved with `setup_future_usage`); later rentals are one-tap off-session charges. Proves the card is live before the disc leaves.
- **At return:** staff CHARGE & CLOSE bills the accrued overage in one transaction.
- **While out:** RUN BILLING SWEEP (staff terminal) charges any active rental ≥7 days since last charge or ≥$10 owed (`due_for_sweep` flag from `rental_billing`). Bounds a locked-card loss to roughly one week.
- **Failed charge:** customer `payment_status=failed`, blocked from new rentals, banner in the app, retried by the next sweep.

### Sheet tabs
- **Customers:** `customer_id, customer_token, display_name, email, phone, terms_accepted, stripe_customer_id, payment_status(none/ok/failed), rental_limit, status(active/flagged/paused/...), comp, card_printed, joined_date, notes`. `rental_limit` starts at Settings `default_rental_limit` (1); staff raise it per customer after a clean first return (or it self-raises via Trusted Accounts, above). **`comp=TRUE` marks a staff comp account:** rentals log exactly like anyone else's (Rentals row, catalog status, Transactions audit trail, staff Outstanding Rentals) but no money ever moves — `rent_start` returns a `comp` flag so `start-rental` skips Stripe and confirms directly (no card is ever collected), and the billing reads (`rental_billing`, `rent_charge_lookup`, the customer payload's `owed_now`) report 0 owed so the sweep and CHARGE & CLOSE naturally collect nothing. The app shows a "Staff account" banner and no-charge cost lines; the staff terminal badges these rows "STAFF — NO CHARGE". Set it by typing TRUE in the sheet; there is no signup path to it. **`status: 'paused'`** is set automatically when one of the customer's rentals hits its maximum charge (see Kept Discs below) — blocks new rentals and hides the cabinet code, same as any inactive status; cleared only by staff tapping REACTIVATE ACCOUNT in the terminal (fully manual, no auto-reactivate). **`card_printed`** (TRUE/blank) drives the staff terminal's batch card-printing list — set by `customer_card_printed`, never by the customer.
- **Rentals:** `rental_id, customer_id, item_id, start_date, status(pending/active/return_pending/closed/paid_off/void), base_price, daily_rate, base_paid_date, extra_charged, last_charge_date, return_date, closed_date, notes`. `daily_rate` (dollars) is stamped at rent time when a Rental Promo is live; blank = standard `RENT_DAILY_CENTS`. Dollars in the sheet; the code does math in cents. `pending` rows older than 30 min are auto-voided by any `rental_billing` read (and inline by `rent_start` for the same item). `paid_off` is a live, currently-produced status again as of 2026-07-10 (see Kept Discs above) — it means the customer kept the disc by default, not a legacy artifact.
- **Catalog:** + `rental_price` column; `replacement_cost` doubles as the payoff cap.
- **Blacklist:** `blacklist_id, email, phone, reason, added_by, added_date` — checked at signup only (see above); a row needs an email, a phone, or both.
- **Settings:** + `default_payoff_cost`, `default_rental_limit`, `trusted_on_time_threshold`, `trusted_rental_limit`, `return_cooldown_minutes` (blank = 60; 0 disables).

### Endpoints
- GET `customer&key=&token=` — dashboard payload (profile, open rentals with live accrual, history, `cabinet_code` as soon as the account is active, `active_promo` from the Rental Promos tab, location).
- POST (api_key): `customer_signup` (rejects a duplicate email or phone already on another Customers row — normalized the same way as the Blacklist match — with an error pointing the customer at the "Or look up by email & phone" recovery flow instead of silently creating a second account; also returns `cabinet_code` and a `flagged` boolean so the app can show the code immediately or the pending-review message), `customer_lookup` (returning-customer recovery: requires **both** email and phone to match the same account — either alone is rejected; returns `customer_token` on a match, a generic error otherwise), `rent_start` (validates limit/payment/item — vault titles are rejected since customers never get the vault code; a fresh `pending` row on the same item by someone else blocks it with a "checking out right now" error, while the customer's own pending rows and anyone's stale ones (>30 min) are voided inline rather than waiting for a staff `rental_billing` read; creates pending rental; returns price + has_card; **only ACTIVE rentals count against the limit** — a bin-pending return no longer holds the slot, decision 2026-07-10), `rental_return` (freezes accrual, item → return_pending; **return cooldown**: blocked until `return_cooldown_minutes` (Settings, default 60) after checkout so slots can't be insta-cycled — staff comp accounts exempt, and a valid `staff_pin` in the payload overrides the cooldown AND skips the token/ownership check, which is how the staff terminal's LOG RETURN (STAFF) button works).
- POST (SERVER_KEY, Netlify only): `rent_confirm` (payment done → active, clock starts, item checked_out; only transitions `pending`/`void` rows — a Stripe webhook redelivered after the rental closed is acknowledged without reopening it), `rent_charge_lookup`, `rent_charge_recorded` (adds charge; closes + reshelves on a real return, or auto-closes as `paid_off` + pauses the account when a non-return charge reaches the cap), `rental_payment_failed`.
- GET (staff_pin): `all_customers` (now includes `card_printed`), `rental_billing` (open + kept rentals, owed_now, flags). POST (staff_pin): `rental_close` (waive & close), `process_kept_return` (walk-in return of a kept disc: refund noted for the Stripe dashboard, catalog reactivate choice), `reactivate_customer` (clears a `paused` status), `customer_card_printed` (marks a signup's card as printed for the batch-printing list).
- Catalog/events/perks/updates/member_request accept customer tokens too (`accountForToken_`); rental audit rows land in Transactions as `rental_*` actions (invisible to legacy member views).

### Returning-customer login (rent.html)
- The signup screen leads with a Returning Customer card: **SCAN MY CARD** opens the same camera/jsQR pipeline used for item lookup, now parameterized by `cameraPurpose` (`'checkout'` vs `'login'`) so `openCamera()`/`onQRDetected()` branch correctly — a login scan extracts a `token` query param if the scan is a URL, else treats the raw scanned text as the token itself, then calls `loginWithToken()`.
- As a backup, a collapsible form (reusing the `toggleNote()` accordion) asks for **email and phone together** — the client enforces both are non-blank before submitting, and the backend (`doCustomerLookup`) re-checks both server-side with the same normalization as the Blacklist match (case/whitespace-insensitive email, digits-only phone). Neither field alone is ever sufficient; a customer_id is guessable and an email or phone alone isn't proof of identity. A non-match returns one generic error regardless of which field (if either) was close, so this can't be used to probe for registered contacts one at a time.
- `loginWithToken()` verifies the token against `?action=customer` before committing to it, so a bad scan or a stale/garbage token shows an inline error and stays on the signup screen instead of bouncing to the full-page "Account Link Invalid" error.

### SFD card printing (staff terminal)
- `sfd-staff.html` → Rental Customers → **PRINT CARD** on any result row. `printCustomerCard()` looks the customer up in the already-loaded `allCustomers` list and calls `buildCustomerPrintUrl()`, which mirrors the legacy `buildPrintUrl()` pattern one-for-one: `cards/print-cards.html?token_a=<customer_token>&name_a=<display_name>&id_a=<customer_id>&since_a=<formatSince(joined_date)>`. No `reprint_a` flag on first print (matches the legacy default-print call).
- `cards/print-cards.html` picks the QR base URL by token prefix (fixed 2026-07-06): `cus_` tokens encode `scifidojo.com/rent?token=`, everything else the legacy `/member?token=`. Customer cards also say "unique to your account" (not "membership") and "Since <year>" (not "Member since"). The card FRONT art still carries member-era labels ("+ Member Access", "Founding Member Series +") baked into the overlay/PNG — changing those is a design call, not wiring.
- Typical flow: customer creates their SFD Account digitally on visit one (QR → signup → bookmarked link, no physical card yet); staff print the card whenever the customer is next at the counter.

### rent.html notes
- Fork of member.html; internal variable is still `member` — `normalizeCustomer()` aliases `member_id`, splits open rentals into `rentals` (active) + `return_pending`, sets `tier_limit = rental_limit`.
- Rent flow calls the Netlify `start-rental` (CORS-enabled): `{url}` → redirect to Stripe Checkout, `{charged:true}` → instant success. Back-from-Stripe (`?rented=1`) polls the customer endpoint briefly for webhook lag.
- **Browse is discovery-only** (no RENT button — renting starts by scanning the disc in hand at the cabinet). Rows tap-to-expand (`browseExpanded` map lives outside the render so star-toggle re-renders keep rows open) into a detail panel: cover art loaded **on demand from `/covers/<item_id>.jpg`** (repo-committed by filename convention, no sheet column — see `/covers/README.md`; the `<img>` element only exists while a row is open, so covers never preload, and `coverMissing` suppresses re-requests for 404'd images), a price line (`rental_price` rides the `catalog` payload since the 2026-07-08 backend; the line is hidden when the field is absent so an old deploy never shows a guessed price), subcategory/group/disc-count/condition facts (defaults `standard`/`good` are hidden as noise), and an availability line.
- **App status strip (`#appStatusBar`)** is a fixed chip pinned to the top of the viewport (the old `#catalogStatusBar` at the bottom of the dashboard is gone): catalog loading/ready/failed states live there, plus an "UPDATING ACCOUNT..." chip (`appBusy()`, counted so overlapping refreshes don't clear each other) whenever a fresh account fetch is in flight. `refreshAfterRent()` runs after every money action — rentals AND logged returns — so the customer always lands back on server truth.
- **`showScreen()` is a no-op when the target screen is already active.** Background re-renders (catalog finishing, account refreshes) used to route through it and yank the scroll position to the top mid-read; only real navigation scrolls/refocuses now. Don't "fix" this back.
- **Return cooldown UI:** the return list greys out rentals younger than `member.return_cooldown_min` (payload field; server enforces regardless) with an unlock-in-N-minutes note and an ask-staff hint; `toggleReturn()` ignores taps on locked rows.
- Netlify env needed: existing `STRIPE_SECRET_KEY`, `APPS_SCRIPT_URL` + new `SFD_API_KEY`, `SFD_SERVER_KEY`, `STRIPE_WEBHOOK_SECRET`, `SFD_RENT_URL`. Stripe dashboard webhook → `rental-webhook`, event `checkout.session.completed`.

## Membership Tiers — Source of Truth (legacy model)

| Tier | Rentals | Loan | Deposit | Access | Visibility |
|---|---|---|---|---|---|
| Matinee | 1 | 7 days | $25 | General | Public |
| Double Feature | 2 | 10 days | $40 | General | Public |
| Premiere | 3 | 14 days | $75 | General + Vault | Invite only, hidden |
| Friends & Family | 2 | 10 days | $0 | General | Invite only, hidden |
| Donor | 3 | 14 days | $0 | General + Vault | Invite only, hidden |

All tiers receive Perks. Apps Script `tierRules` mirrors this table — keep them in sync.

## Member App — Key Architecture Decisions

### Loading and caching
- On startup: member data fetches first, dashboard renders immediately; catalog fetches in background
- **Member cache:** last good member object is stored in localStorage (`'sfd_member_cache_' + token`) and rendered instantly on revisit while the fresh fetch (Apps Script cold start = 1–3s+) completes. If the fetch fails non-auth, the cached dashboard stays up with a stale-data banner. Auth failures clear the cache and show the invalid-link screen.
- **Silent refresh:** `visibilitychange` re-fetches member data when the tab regains focus (60s throttle, `MEMBER_REFRESH_MIN_MS`)
- All backend calls go through `fetchWithTimeout()` — 20s abort (`FETCH_TIMEOUT_MS`). Never use bare `fetch()`.
- Catalog: `catalogCache` (array) + `catalogByIdCache` (keyed) rebuilt after each fetch. `null` = not loaded; `[]` = loaded but empty. Status indicator: amber (loading) → green (ready, fades) → red (failed, tappable retry). Browse screen re-renders on catalog ready/failed too.

### Security in the client
- **`esc()` on every `innerHTML` data interpolation** — all backend and user-typed values must pass through it. Never interpolate IDs into inline `onclick='fn("id")'` strings; use `data-id="..."` + `onclick="fn(this.dataset.id)"`.

### Accessibility conventions
- Div-based controls carry `role="button"` (or `role="checkbox"`) + `tabindex`; a single delegated keydown handler makes Enter/Space trigger click
- Toggle-style buttons (filters, history ranges) update class + `aria-pressed` via `setToggleBtn()`
- Screens receive programmatic focus on navigation (`showScreen`)

### STAR_KEY
- localStorage key for starred items. Initialized as `'sfd_starred_anon'` at parse time, overwritten to `'sfd_starred_' + member.member_id` at top of `renderStatus()` once member loads. Do not initialize with member_id at parse time — member is null then.

### QR Scanner
- jsQR v1.4.0 is **inlined directly in the HTML** (CDN loading fails on Netlify due to CSP) — but at the **end of `<body>`**, before the app script, so it never blocks first paint. `captureQRFrame()` guards with `typeof jsQR === 'undefined'`.
- Tap-to-scan: camera opens, member frames code, taps SCAN, single frame captured. No auto-scan loop.
- `inversionAttempts: 'attemptBoth'` — required for iOS. Canvas downscaled to 640x480 before jsQR.
- Camera failures (denied permission, no mediaDevices) surface a message in `#camFeedback` — never fail silently.

### Checkout / Browse
- Checkout input prefilled `SFD-`; "Keep typing..." hint at 4+ chars; `lookupItem()` fires at 8+; validation via `catalogByIdCache`; final validation server-side
- Browse sort: starred first → available → alpha by `sort_title` (falls back to `title`). Search input is debounced (200ms). Starred IDs are read once per render into a Set — never re-parse localStorage per item.
- Format emoji: 💿 DVD, 📀 Blu-ray, 💽 4K UHD, 🕹️ Video Games (future), 📼 VHS (future)

### Events / Perks / Weekly Rewind feeds
- Three background fetches (`loadEvents`/`loadPerks`/`loadUpdates`, mirroring `loadCatalog`) populate `eventsCache`/`perksCache`/`updatesCache`; `renderFeeds()` fills the `#rewindSection`/`#eventsSection`/`#perksSection` containers on the dashboard (selective update, like `setCatalogStatus` — it does not re-run the full `renderStatus`). Feeds are non-critical: a failed fetch leaves the cache null and the section simply stays hidden.
- Collapsible `.feed-card` accordion (tap headline to expand) shared by all three. Events show a single-tap "I'm going" RSVP and an Add to Google Calendar link; perks show optional photo + text; The Weekly Rewind shows the newest update with a "new" dot (cleared on expand via `REWIND_KEY` localStorage), older active updates listed below.

### Hours & Location
- `lookupMember` returns a `location` object (`address`, `maps_url`, `hours`) from the three `location_*` Settings keys. Hours & Location live **inside the Access Cabinet screen** (no separate tile): `goCode()` renders the cabinet code(s) + do-not-share warning, then `buildLocationHtml()` appends an address card, Get Directions button, and hours table when a location is configured. The cabinet tile subtitle is "Tap to view your code & check current hours". `parseHours()` splits the multi-line `hours` string into day/time rows, sorts Mon→Sun, and highlights the current day. The location section renders nothing when unconfigured. (Members-only app, so the cabinet tile's normal `showCode` gate is fine.)

### Post-Credits Scene (monthly meetup)
- No dedicated code: it's a monthly **Events** row (`rsvp_enabled=TRUE`) so it reuses the Events feed's expand + "I'm going" headcount + Add to Calendar.
- RSVP reuses `member_request` (no backend change) and mirrors the `STAR_KEY` localStorage toggle: `RSVP_KEY = 'sfd_rsvp_' + member.member_id` drives button state; each tap posts `rsvp`/`rsvp_cancel` fire-and-forget.
- The "Tap Check Out or Return Items to get started" hint only renders for members with zero rentals and zero return-pending items.

### Error screen
- "Connection Interrupted" — reassures the member their account is fine; TRY AGAIN reloads. `showError()` uses `innerHTML` so links render (its inputs are hardcoded strings; anything dynamic must be escaped).

### Removed (do not resurrect)
- `DEMO_MEMBERS` fallback and demo tokens — gone; no token now shows the not-found screen
- Debug banner — gone
- VLT item prefixes — catalog uses SFD- (sheet-side rename still pending, see queue)

## Version Convention

Every app file shows a date-based version in its footer: `v2026.06.10`. **Bump it to the current date as part of every edit** — there is no build step, so the human (or Claude) doing the edit is the build step. An HTML comment sits above each version line as the reminder. The Apps Script does not need one (Google tracks deployment versions under Manage deployments).

## Known Issues / Active Queue

### In progress
- QR scanner: success feedback (green flash) and SFD-code validation (reject non-SFD QR codes before closing camera)

### Queued
- Pay-per-rental go-live: create Customers/Rentals tabs + Settings keys, set Netlify env + Stripe webhook, deploy backend, test in Stripe test mode, print the cabinet QR (scifidojo.com/rent). Then decide member-app cutover timing.
- Automate the billing sweep (Netlify scheduled function) once the staff-triggered flow is proven.
- Go-live swap from demo Catalog to Catalog Backup. Checklist: set `in_rotation` TRUE on live items (real library is currently ALL FALSE = empty catalog if swapped as-is); clear/process demo transactions first (all 45 demo item_ids collide with real titles — open rentals and history would display wrong movies); unify `sort_title` convention (634 of 759 real items blank)
- VLT prefix → SFD batch rename in sheet
- Enable the `onboard`/`update_stripe` key gate (needs `api_key` added to the two Netlify functions first)
- Stripe Customer Portal for self-service plan changes

### Deferred
- Vault visual treatment in Browse (no vault titles in collection yet — real library currently has zero `collection=vault` items)
- Sort by format in Browse; public inventory browser. (Monthly meetup "Post-Credits Scene" is handled via an Events row, not separate tooling.)

## Working Conventions

### Dyslexia-friendly code changes
- All code changes use explicit FIND/REPLACE with file name and context
- Edits must be surgical — no layout, CSS, or structural changes unless explicitly requested
- No broad rewrites unless asked. Always specify the exact file being edited.

### Copy / tone (app and public-facing prose)
- Direct, confident, slightly cinematic — never corporate, never quirky
- No em-dashes or emojis in prose
- Location references use "Belmar, NJ" (confirmed 2026-07-08)
- Invite-only tiers hidden from all public-facing copy
- Collection should feel welcoming to all film fans, not genre-restricted
- Perks (snacks, surprises) are cheap PAID items via an honor box (decision 2026-07-08) — copy should not promise free stuff; trade-ins are rewarded in free rentals (exact math TBD)

### CSS Variables (member app palette)
```css
:root {
  --bg:       #080c12;
  --panel:    #0d1520;
  --panel2:   #111c2a;
  --border:   #1e3450;
  --border2:  #2a4868;
  --accent:   #00d4ff;
  --accent2:  #ff6b35;
  --success:  #00ff9d;
  --warning:  #ffcc00;
  --danger:   #ff3b5c;
  --vault:    #c084fc;
  --text:     #e8f4ff;
  --text-mid: #a8c8e8;
  --text-dim: #6a90b0;
  --text-lbl: #8ab4d4;
  --glow:     0 0 20px rgba(0,212,255,.25);
  --r:        14px;
  --r-sm:     9px;
}
```

## Contact / Accounts
- Email: scifidojo@aol.com · Instagram: @scifi_dojo
- GitHub repo `sci-fi-dojo` (public, this one) + private onboarding repo → both auto-deploy via Netlify
- Google account manages Sheets + Apps Script; Stripe is the payment platform
