# Standing this up for another shop

What has to change, and why some of it can't be automated.

## The split

Values used **at runtime by JS** are extracted into one block. Values that
live in **static markup** are not, and deliberately so.

`index.html` and `collection.html` are the indexable pages. Their
`<title>`, meta description, Open Graph tags and JSON-LD have to be
literal in the served HTML, because search engines and link scrapers read
the document as delivered, not what JavaScript produces afterwards.
Templating them would quietly undo the search work and would also flash
the wrong text before the script ran.

So: one config block for code, one checklist for content.

## 1. The config block (rent.html)

Top of the app `<script>`, under `CONFIG`. Change these and every mailto
link, the ticket stub wordmark and the terms link follow automatically:

```js
var BACKEND_URL    = '...'   // the Apps Script /exec URL
var API_KEY        = '...'   // must match API_KEY in the Apps Script
var RENTAL_FN_BASE = '...'   // Netlify functions base
var SUPPORT_EMAIL  = '...'   // every "email support" link
var BRAND_NAME     = '...'
var BRAND_WORDMARK = '...'   // all-caps surfaces (the ticket stub)
var TERMS_URL      = '...'
```

`collection.html` has one equivalent constant, `ENDPOINT`.

Adding a shop name or address anywhere else in JS is a mistake -- put it
here instead.

## 2. The content checklist

Roughly 82 strings across four files. Search each file for these and
replace by hand:

| | index | collection | rent | terms |
|---|---|---|---|---|
| brand name | 7 | 6 | 7 | 7 |
| domain | 8 | 4 | 5 | - |
| town | 6 | 4 | 3 | 1 |
| host store | 3 | 4 | 3 | - |
| support email | 1 | - | 3 | 4 |
| instagram | 2 | - | - | 1 |
| maps link | 2 | 1 | - | - |

Do not skip these on the two public pages:

- **`<title>` and `<meta name="description">`** on every page
- **Open Graph and Twitter tags** -- the link-preview card
- **`<link rel="canonical">`** -- points at the real domain; wrong here
  means the Netlify subdomain competes with it in search
- **The JSON-LD block in `index.html`** -- name, address, hours, `hasMap`,
  `sameAs`, `email`, `priceRange`. It must agree with the visible copy;
  structured data that contradicts the page is treated as a spam signal
- **`sitemap.xml` and `robots.txt`** -- both name the domain

## 3. Assets

Replace in place, keeping the filenames:

- `logo.png` -- the wordmark lockup
- `og-image.jpg` -- 1200x630, composited on a solid background (a
  transparent PNG disappears against a dark-mode preview card)
- `favicon-member-*` -- the whole set, plus root `favicon.ico`
- `/covers/`, `/gallery/` -- see their own READMEs

Sampled brand colours live in each file's `:root`.

## 4. Not covered here

- **The Apps Script backend** -- its own constants (`API_KEY`,
  `SERVER_KEY`, `MAILER_KEY`, `REPLY_TO_EMAIL`) and a copy of the sheet
  with its tabs. See BACKEND-UPDATE.md.
- **The Netlify functions** -- separate private repo, own env vars.
- **`member.html`** -- the dormant legacy membership app. Not part of a
  new deployment; left untouched on purpose.

## 5. Honest expectations

A full setup is a day of work for someone comfortable with Apps Script,
Netlify and Stripe: new Google account, copy the sheet, deploy the script,
create the Stripe account and webhook, set the Netlify env vars, work
through the checklist above, print the QR.

Every quota is per Google account -- roughly 100 emails a day and 90
minutes of script runtime on a consumer account. That is the reason each
shop gets its own deployment rather than sharing one: separate accounts
mean separate allowances and separate blast radius.
