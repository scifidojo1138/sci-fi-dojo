#!/usr/bin/env node
// Regenerates covers/index.json -- the list of item_ids that have cover
// art in this folder.
//
// /collection uses it to hide titles with no artwork by default. The page
// cannot work this out for itself: a missing cover is only discovered when
// the image 404s, which happens after render and (because covers are
// lazy-loaded) never at all for anything off-screen.
//
// RUN THIS AFTER ADDING OR REMOVING COVERS:
//     node covers/build-index.js
//
// Forgetting to is not fatal but it is visible: a newly added cover stays
// hidden behind the "show titles without cover art" toggle until you do.
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const ids = fs.readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.jpg'))
  .map((f) => f.slice(0, -4))
  .sort();

const out = path.join(dir, 'index.json');
fs.writeFileSync(out, JSON.stringify(ids) + '\n');
console.log(`covers/index.json: ${ids.length} covers indexed`);
