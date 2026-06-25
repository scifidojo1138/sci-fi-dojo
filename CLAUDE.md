# Sci-Fi Dojo — Project Handoff (Technical)

Last updated: 2026-06-10. Update this file whenever architecture, endpoints, or conventions change.

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
| `index.html` | `scifidojo.com` | Public landing page |
| `member.html` | `scifidojo.com/member?token=tok_xxx` | Member app |
| `terms.html` | `scifidojo.com/terms` | Rental terms |
| `BACKEND-UPDATE.md` | — | Apps Script change log / paste instructions |

**Onboarding repo (private Netlify site: `scifidojo-onboarding.netlify.app`):**
| File | Description |
|---|---|
| `sfd-onboarding.html` | Staff onboarding terminal (tier selection, Stripe checkout) |
| `success.html` | Post-payment enrollment confirmation + QR card |
| `sfd-staff.html` | Staff terminal: member lookup, cabinet codes, checkouts, return bin |
| `cards/print-cards.html` | Member card print layout |
| Netlify functions | `create-checkout`, `onboard-member`, `process-return` |

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
- **Promos:** `promo_id, title, description, date_start, date_end, bonus_rentals, bonus_loan_days, tiers, active` — read server-side by `getActivePromo()`. A promo is live when `active=TRUE` and today is within `[date_start, date_end]` (inclusive, Eastern) and `tiers` is blank (all tiers) or lists the member's tier. Live bonuses are added to the member's `tier_limit`/`loan_days` in `lookupMember`, so checkout enforcement and display "just work"; the member object's `active_promo` drives the dashboard banner. Extended loans persist (due dates are stamped per rental); `slotsLeft` clamps at 0 so an over-limit member after a promo ends simply can't check out new items.
- **Dashboard / Expenses:** human-facing, not read by backend logic

## Membership Tiers — Source of Truth

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
- `lookupMember` returns a `location` object (`address`, `maps_url`, `hours`) from the three `location_*` Settings keys. A "HOURS & LOCATION" action tile appears only when `address` is set, opening `screen-location` (address, Get Directions button, hours table). `parseHours()` splits the multi-line `hours` string into day/time rows, sorts Mon→Sun, and highlights the current day. Ships hidden until a location is configured.

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
- Location references use "New Jersey" until permanent location confirmed
- Invite-only tiers hidden from all public-facing copy
- Collection should feel welcoming to all film fans, not genre-restricted

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
