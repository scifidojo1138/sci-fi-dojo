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

A title with no cover file is not hidden anywhere. It renders with its
title as a text placeholder instead (`.noart`), so a gap is visible rather
than silent.

## Notes

- `.jpg` only. `.png`, `.jpeg` and `.JPG` are not picked up.
- Portrait art works best; the grid frames covers at 3:4 and crops with
  `object-fit: cover`.
- More covers than titles is fine and expected. Files exist for
  out-of-rotation items too; the page only ever shows ids that are in the
  public catalog feed.
