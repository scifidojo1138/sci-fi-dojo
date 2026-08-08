# Rental Backend Setup

`rental.html` works two ways:

- **Demo mode (default):** `BACKEND_URL` in `rental.html` is empty, so accounts,
  the catalog, rentals, and billing are simulated in the browser's
  localStorage. Open the page and try the whole flow immediately — the
  orange bar at the top includes a **+1 DAY** button so you can watch
  charges accrue and hit the cap.
- **Live mode:** deploy `Code.gs` as a Google Apps Script web app backed by a
  Google Sheet, then paste the deployment URL into `BACKEND_URL`.

This is the same architecture as the existing `member.html` app (static page +
Apps Script + Sheets), but it is a **separate script and spreadsheet** — it
does not touch the membership backend.

## 1. Create the spreadsheet

Make a new Google Sheet with four tabs. Row 1 of each tab must contain these
exact headers:

### `Members`
| member_id | name | email | salt | password_hash | session_token | token_expires | created_at | status |

Leave it empty — signups fill it in. To suspend someone, change `status` to
anything other than `active`.

### `Catalog`
| item_id | title | year | format | edition | blurb | rate | status |

One row per disc. `rate` is the dollars-per-day price (`1`, `2`, or `3`) —
set it per title, e.g. DVDs at 1, Blu-rays at 2, 4K/new releases at 3.
`status` is `available` or `rented` (the script flips this automatically;
set new rows to `available`).

Example row:

| SFD-101 | Blade Runner: The Final Cut | 1982 | 4K UHD | 4-Disc Collector Set | Every cut, every extra. | 3 | available |

### `Rentals`
| rental_id | member_id | item_id | rate | rented_at | status | returned_at | days_billed | amount |

Leave empty — the script writes it. This tab is your billing ledger: every
closed rental has its final `days_billed` and `amount`.

### `Config`
| key | value |

| cabinet_code | 42-17-08 |
| cap_days | 14 |
| max_active | 3 |

- `cabinet_code` — the combination shown to members with an active rental.
  Update it weekly when you rotate the physical lock.
- `cap_days` — billing stops after this many days even if the disc is not
  back (the app still nags the member to return it).
- `max_active` — how many discs one member can have out at once.

## 2. Deploy the script

1. In the spreadsheet: **Extensions → Apps Script**.
2. Replace the default `Code.gs` contents with this folder's `Code.gs`.
3. **Deploy → New deployment → Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the web app URL (ends in `/exec`).

## 3. Point the front end at it

In `rental.html`, set:

```js
var BACKEND_URL = 'https://script.google.com/macros/s/.../exec';
```

Demo mode turns off automatically once the URL is set.

## 4. Collecting the money

The app meters charges and records the final amount of each rental in the
`Rentals` tab; it does not charge cards itself. Two reasonable paths:

- **Manual (start here):** total each member's closed rentals weekly or
  monthly and send a Stripe payment link or invoice.
- **Automated (later):** store a Stripe customer ID per member (collect the
  card once via a Stripe Checkout setup link), then have a time-driven Apps
  Script trigger sweep newly returned rentals and create charges via the
  Stripe API.

## Notes on security

Reasonable for a small club, but know the limits: passwords are salted
SHA-256 (no bcrypt available in Apps Script), sessions expire after 60 days,
and the web app URL is effectively public — all real decisions (availability,
rental limits, billing math) happen server-side, never trust the client. Do
not reuse a password you care about elsewhere.
