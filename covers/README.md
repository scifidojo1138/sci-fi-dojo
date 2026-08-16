# Cover art

One JPEG per catalog item, named for its `item_id`:

```
covers/SFD-0917.jpg
```

No sheet column, no config. The filename **is** the wiring. Drop a file in
and it appears; there is nothing else to update.

Used in three places: `/collection`, the Browse detail panel in
`rent.html`, and the ticket stub on a rental receipt. A bad or mismatched
cover shows up in all three, so it is worth checking the `item_id` is
right rather than just that the image looks fine.

## After adding or removing covers, run this

```
node covers/build-index.js
```

That regenerates `index.json`, the list of which ids have artwork.
`/collection` hides titles with no cover by default and uses this file to
know which those are.

**Why a generated file instead of just letting the images 404:** the page
cannot detect a missing cover until the request fails, which happens after
render and, because covers are lazy-loaded, never at all for anything
off-screen. Filtering on failure would make titles pop out of the grid as
you scrolled and would miss most of them entirely.

**If you forget to run it:** a newly added cover stays hidden behind the
"show N more without cover art" toggle until you do. Nothing breaks, and
the title is one click away. If `index.json` is missing or unreadable the
page shows **everything**, which is the safe direction to fail in.

## Notes

- `.jpg` only. `.png`, `.jpeg` and `.JPG` are not picked up.
- Portrait art works best; the grid frames covers at 3:4 and crops with
  `object-fit: cover`.
- More covers than titles is fine and expected. Files exist for
  out-of-rotation items too; the page only ever shows ids that are in the
  public catalog feed.
