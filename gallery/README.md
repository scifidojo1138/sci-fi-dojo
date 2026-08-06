# Landing page photo carousel

Photos shown in the carousel on `scifidojo.com` live here. To add one:

1. Commit the image into this folder as `gallery/1.jpg`, `gallery/2.jpg`,
   `gallery/3.jpg`, and so on -- numbered, no gaps, starting at 1.
2. That's it. `index.html` probes for `gallery/1.jpg` through
   `gallery/10.jpg` on page load and builds the carousel from whichever
   numbers actually exist -- no code change needed to add, remove, or
   reorder photos, just add/replace/delete numbered files and keep the
   sequence gap-free (a missing number stops the probe there, so if you
   delete `gallery/2.jpg` you must also rename `gallery/3.jpg` down to
   `gallery/2.jpg`, etc.).
3. Need more than 10 photos? Bump `GALLERY_MAX` in the `<script>` block
   near the bottom of `index.html`.

An empty folder (the current state) means the carousel section doesn't
render at all -- no broken image icons, no empty box.

Keep files reasonably small (ideally under ~300KB) so the landing page
stays fast. JPG or PNG. The carousel frame is a fixed 3:4 portrait box
(`object-fit: cover`) sized for 960x1280 photos -- that ratio crops
cleanest; other ratios still work but get cropped top/bottom or sides
to fit.
