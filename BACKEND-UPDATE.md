# Apps Script Backend Update — Events & Perks Feeds

The member app now reads two new feeds from the spreadsheet: **upcoming
events** (with RSVP + Add to Google Calendar) and **member perks** (with an
optional photo). This requires two new Google Sheet tabs and two new backend
GET endpoints.

> Until this update is deployed, the events/perks sections simply do not
> appear in the member app (the fetches fail quietly and the sections stay
> hidden). Nothing else is affected.

## 1. Create the two new tabs

In **SciFiDojo_Sheet_v2**, add two tabs with these exact header rows (row 1):

**Events**

| event_id | title | date_start | date_end | location | description | rsvp_enabled | image_url | active |
|---|---|---|---|---|---|---|---|---|

- `date_start` / `date_end`: a date-time the sheet recognizes (e.g. `2026-07-10 19:00`). `date_end` may be blank (the calendar link then defaults to a 2-hour event).
- `rsvp_enabled`: `TRUE` to show the "I'm going" button, `FALSE` to hide it.
- `image_url`: optional. Root-relative path to an image committed in the repo, e.g. `/events/movie-night.jpg` (see `events/README.md`). Shown inside the expanded card. Blank = no image.
- `active`: `TRUE` to publish. Events whose `date_start` is before today are hidden automatically, so you do not have to flip `active` off after an event passes.

> **Already have the Events tab?** Just add one `image_url` column (anywhere before `active` is fine; columns are read by header name). **Perk descriptions need no deploy at all** — the `description` column already flows to the card; just type text into it.

**Perks**

| perk_id | title | description | image_url | active |
|---|---|---|---|---|

- `image_url`: optional. A root-relative path to an image committed in the repo, e.g. `/perks/popcorn.jpg` (see `perks/README.md`). Leave blank for a text-only perk.
- `active`: `TRUE` to publish.

`event_id` / `perk_id` just need to be unique and stable (e.g. `EV1`, `PK1`); the RSVP headcount in the Requests tab references `event_id`.

## 2. Update the Apps Script

Paste the updated backend (the `.gs` file delivered alongside this note) over
the current code. The changes versus the previous version:

- `TAB` gains `events: 'Events'` and `perks: 'Perks'`.
- `doGet` requires the API key on the new `events` / `perks` actions and routes them.
- New `getEvents(token)` / `getPerks(token)` functions (token-gated, key-checked, mirroring `getCatalog`).
- No change to RSVP handling: RSVPs arrive through the existing `member_request` action and land in the **Requests** tab with `request_type` = `rsvp` (or `rsvp_cancel`), `item_id` = the event_id, and the event title in the text column.

## 3. Deploy (same URL)

**Deploy → Manage deployments → ✏️ on the active deployment → Version: New
version → Deploy.** This keeps the existing URL. Saving the code in the editor
does **not** deploy it.

## 4. Verify

With your token, in a browser (replace `YOUR_TOKEN`):

```
.../exec?action=events&key=27268cf583e78fcdb9e5eb2d5bada419&token=YOUR_TOKEN
.../exec?action=perks&key=27268cf583e78fcdb9e5eb2d5bada419&token=YOUR_TOKEN
```

Each should return `{"ok":true,"events":[...]}` / `{"ok":true,"perks":[...]}`.
Then open the member app: events and perks appear as tappable cards on the
dashboard. Tapping "I'm going" adds a row to the Requests tab.
