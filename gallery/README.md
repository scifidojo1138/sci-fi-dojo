# Landing page photo carousel

Photos shown in the carousel on `scifidojo.com` live here.

## Adding a photo

1. Save it as **`.jpg`** (see the format rule below -- this matters).
2. Name it with the next free number: `4.jpg`, `5.jpg`, and so on.
3. Commit it. That's it -- no code change.

`index.html` probes `gallery/1.jpg` through `gallery/10.jpg` on page load
and builds the carousel from whichever ones actually exist.

## Removing or reordering

Just delete or rename files. **Gaps are fine** -- deleting `2.jpg` and
leaving `1.jpg` and `3.jpg` works correctly and shows both photos, in
numeric order. You do *not* need to renumber anything.

Display order is the numeric order of the filenames, so renaming is how
you reorder.

## Format: `.jpg` only

The probe builds exactly these filenames and nothing else:

```
gallery/1.jpg  gallery/2.jpg  ...  gallery/10.jpg
```

So these will **silently never appear** -- no error, no broken image,
because a 404 is how the carousel decides a photo doesn't exist:

- `.png`
- `.jpeg` (very common from cameras and exports -- and this folder has
  held `.jpeg` files before, so it's the likely mistake)
- `.JPG` or any other capitalization (Netlify is case-sensitive)

If a photo you added isn't showing up, check the extension first.

## Limits and sizing

- **More than 10 photos?** Bump `GALLERY_MAX` in the `<script>` block near
  the bottom of `index.html`.
- **Frame is a fixed 3:4 portrait box** (`object-fit: cover`), sized for
  **960x1280** photos. That ratio crops cleanest; anything else still
  works but gets cropped top/bottom or on the sides.
- **Keep files small.** Every photo here is downloaded on page load, so
  size directly costs load time. Aim for **under ~300KB** each. (The
  current `1.jpg` is ~400KB and is worth recompressing.)

## Behavior notes

- An **empty folder** means the carousel section doesn't render at all --
  no empty box, no broken-image icons.
- A **single photo** renders without arrows or dots.
- Auto-advances every 4.5s. Pauses while hovering on desktop; on touch it
  pauses briefly after a swipe and then resumes.
