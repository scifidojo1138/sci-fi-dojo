# Sci-Fi Dojo

A curated physical-media rental club. Blu-ray, DVD, and 4K UHD — full discs
with the packaging, bonuses, and extras — rented from a locked cabinet.

## Pages

| File | What it is |
|---|---|
| `index.html` | Public landing page. |
| `member.html` | Membership app (monthly-tier model): token-based access, QR checkout/return, cabinet code, browse. |
| `rental.html` | **Pay-per-day rental app** (Redbox-style): self-serve accounts, browse, rent, combination code, daily billing. |
| `terms.html` | House rules / terms. |
| `apps-script/` | Google Apps Script backend for `rental.html` + setup guide. |

## The pay-per-day app (`rental.html`)

- **Create an account** (email + password) and sign in.
- **Browse the cabinet** — every title shows its daily rate: **$1, $2, or $3
  per day** depending on the disc (set per title in the catalog; e.g. DVDs $1,
  Blu-rays $2, 4K/new releases $3).
- **Rent** — confirm the price, get the **cabinet combination code**, open the
  lock, take the disc.
- **Billing** — day of rental is day 1; each day after adds the daily rate.
  The meter stops when you **return** the disc or when it hits the **cap**
  (default 14 days), whichever comes first. The max possible charge is always
  shown up front.
- **My Shelf** — live view of what's out, what it has cost so far, and the
  combination code; one tap to mark a disc returned.
- **Account** — open charges, total spent, full rental history, sign out.

### Try it right now

Open `rental.html` in a browser. With no backend configured it runs in **demo
mode** (data in localStorage) with a seeded catalog and a **+1 DAY** button so
you can watch billing accrue, hit the cap, and stop on return.

### Go live

Follow [`apps-script/SETUP.md`](apps-script/SETUP.md): create a Google Sheet,
deploy `Code.gs` as a web app, and paste the URL into `BACKEND_URL` in
`rental.html`. Same architecture as the existing member app — static page +
Apps Script + Sheets, no servers to run.
