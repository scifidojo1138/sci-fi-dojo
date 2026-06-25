# Apps Script Backend Update — Weekly Rewind, Promos, Location

This round adds three things to the member app, all driven from the spreadsheet:

1. **The Weekly Rewind** — an in-app weekly update (new `Updates` tab + `updates` endpoint).
2. **Weekend Promos** — temporary rental/loan bonuses (new `Promos` tab, read server-side; no new endpoint).
3. **Hours & Location** — address, directions, and editable hours (three new `Settings` keys; rides the member object).

> Until deployed, these sections simply don't appear in the app (fetches fail quietly / fields come back empty). Nothing else is affected.

## 1. Create / update tabs

**Updates** (new tab) — "The Weekly Rewind":

| update_id | date | title | body | active |
|---|---|---|---|---|

- `body` is freeform; line breaks are preserved in the app (write "New arrivals:", picks, perks on separate lines).
- Newest `date` shows first; `active=TRUE` to publish. `update_id` just needs to be unique (e.g. `U1`, `U2`).

**Promos** (new tab):

| promo_id | title | description | date_start | date_end | bonus_rentals | bonus_loan_days | tiers | active |
|---|---|---|---|---|---|---|---|---|

- Live when `active=TRUE` and today is within `[date_start, date_end]` (inclusive, Eastern).
- `bonus_rentals` / `bonus_loan_days`: integers added to the member's normal limit / loan length during the window.
- `tiers`: blank = all tiers; otherwise a comma list (e.g. `Premiere, Donor`).
- Example "+1 rental this weekend": `bonus_rentals=1`, `bonus_loan_days=0`, `date_start`/`date_end` = the weekend, `tiers` blank.

**Settings** (existing tab) — add three rows (column A key, column B value):

| key | value (example) |
|---|---|
| `location_address` | `123 Main St, Asbury Park, NJ 07712` |
| `location_maps_url` | `https://maps.google.com/?q=123+Main+St+Asbury+Park+NJ` |
| `location_hours` | a multi-line cell, one day per line (see below) |

For `location_hours`, paste one "Day<tab or spaces>hours" per line, in any order — the app sorts Monday→Sunday and highlights today:

```
Monday      2–10 PM
Tuesday     4–10 PM
Wednesday   2–10 PM
Thursday    2–10 PM
Friday      12–10 PM
Saturday    12–10 PM
Sunday      2–10 PM
```

Leave all three location keys blank to keep the Hours & Location tile hidden until you have a venue.

**Post-Credits Scene** (monthly meetup): no new tab — just add a row to the **Events** tab each month with `rsvp_enabled=TRUE`. It uses the existing Events feed (expand, "I'm going" headcount, Add to Calendar).

## 2. Update the Apps Script

Paste the delivered `.txt` over the current code. Changes vs. the previous version:
- `TAB` gains `updates` and `promos`.
- `doGet` requires the API key on the new `updates` action and routes it.
- New `getUpdates(token)` and `getActivePromo(memberTier)`.
- `lookupMember` now returns a `location` object and an `active_promo` summary, and folds any active promo bonus into `tier_limit`/`loan_days` (so checkout and the dashboard reflect it automatically).

## 3. Deploy (same URL)

**Deploy → Manage deployments → ✏️ on the active deployment → Version: New version → Deploy.** Saving the code does **not** deploy it.

## 4. Verify

With your token (replace `YOUR_TOKEN`):

```
.../exec?action=updates&key=27268cf583e78fcdb9e5eb2d5bada419&token=YOUR_TOKEN
.../exec?action=member&key=27268cf583e78fcdb9e5eb2d5bada419&token=YOUR_TOKEN
```

- `updates` returns `{"ok":true,"updates":[...]}` (after you add an active Updates row).
- `member` now includes a `location` object and `active_promo` (null when no promo is live). During a live promo, `tier_limit` is the elevated number.

Then open the member app: The Weekly Rewind, the Hours & Location tile (once the address is set), and a promo banner (during a live promo) all appear on the dashboard.
