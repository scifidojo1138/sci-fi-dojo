# Cover Art Thumbnails

Cover images for the Browse screen's tap-to-expand detail panel
(rent.html). No sheet column needed — it works purely by filename:

- Name each file after the item's catalog code: `SFD-0123.jpg`
- Commit it to this folder — committing IS the deploy (Netlify)
- The cover appears the next time someone expands that title in Browse

Titles without an image are fine: the detail panel just shows the rental
facts with no broken-image icon.

Size guidance: ~300px wide, JPEG, ideally under ~50 KB. Big phone photos
work but waste data — ask Claude to batch-resize a folder of images if
needed (same treatment as the perk photos).

Covers only download when a row is expanded, so a large library does not
slow the app down — image cost scales with curiosity, not catalog size.
