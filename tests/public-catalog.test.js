// The public /collection feed. Unlike getCatalog this is unauthenticated,
// so what it does NOT expose matters as much as what it does.
const { makeSandbox, suite } = require('./lib/sandbox');

const ITEMS = [
  { item_id: 'SFD-0001', title: 'Alien', sort_title: '', format: 'Blu-ray', year: '1979',
    genre: 'Sci-Fi, Horror', status: 'available', in_rotation: 'TRUE', collection: 'general',
    rental_price: '3', replacement_cost: '35', barcode: '012345678905', imdb_id: 'tt0078748',
    cost: '9.99', notes: 'bought used', condition: 'good', synopsis: 'In space no one can hear you scream.',
    current_holder_member_id: '' },
  { item_id: 'SFD-0002', title: 'The Matrix', sort_title: 'Matrix, The', format: '4K UHD', year: '1999',
    genre: 'Sci-Fi', status: 'checked_out', in_rotation: 'TRUE', collection: 'general',
    current_holder_member_id: 'CUS-0007' },
  { item_id: 'SFD-0003', title: 'Hidden Gem', format: 'DVD', status: 'available',
    in_rotation: 'FALSE', collection: 'general' },                       // out of rotation
  { item_id: 'SFD-0004', title: 'Vault Thing', format: 'DVD', status: 'available',
    in_rotation: 'TRUE', collection: 'vault' },                          // vault
  { item_id: 'SFD-0005', title: 'Broken Disc', format: 'DVD', status: 'damaged',
    in_rotation: 'FALSE', collection: 'general' },                       // damaged
];

module.exports = () => suite('public catalog: /collection feed', (t) => {
  const fresh = () => {
    const ctx = makeSandbox({ Catalog: ITEMS.map((i) => Object.assign({}, i)) });
    ctx.getSettingValue = () => '';
    return ctx;
  };

  // --- what it returns --------------------------------------------------
  {
    const ctx = fresh();
    const res = ctx.getPublicCatalog();
    t.ok('returns ok', res.ok === true);
    t.eq('only in-rotation, non-vault items', res.catalog.map((c) => c.id), ['SFD-0001', 'SFD-0002']);

    const alien = res.catalog[0];
    t.eq('carries id (which is also the cover filename)', alien.id, 'SFD-0001');
    t.eq('title', alien.title, 'Alien');
    t.eq('format + year', [alien.format, alien.year], ['Blu-ray', '1979']);
    t.eq('genre parsed to a trimmed array', alien.genre, ['Sci-Fi', 'Horror']);
    t.eq('availability collapsed to a boolean', alien.avail, true);
    t.eq('a checked-out title reports unavailable', res.catalog[1].avail, false);
    // `sort` is omitted when it would just repeat the title -- true for
    // most of the library, and worth ~20KB across 700 items. The client
    // falls back to title.
    t.eq('sort omitted when it would duplicate the title', 'sort' in alien, false);
    t.eq('...but present when sort_title genuinely differs', res.catalog[1].sort, 'Matrix, The');
  }

  // --- what it must NOT leak -------------------------------------------
  {
    const ctx = fresh();
    const item = ctx.getPublicCatalog().catalog[0];
    const leaked = ['rental_price', 'cap_cents', 'replacement_cost', 'barcode', 'imdb_id',
      'cost', 'notes', 'condition', 'current_holder_member_id', 'status', 'synopsis']
      .filter((f) => f in item);
    t.eq('no pricing, internal ids, or operational fields', leaked, []);
    t.eq('the payload is exactly the intended shape',
      Object.keys(item).sort(), ['avail', 'format', 'genre', 'id', 'title', 'year']);
    // Raw statuses like damaged/missing/sold are operational detail; the
    // in_rotation filter already removes them, but assert it explicitly.
    t.ok('no damaged/out-of-rotation title is ever surfaced',
      !ctx.getPublicCatalog().catalog.some((c) => c.id === 'SFD-0005'));
  }

  // --- no auth required -------------------------------------------------
  {
    const ctx = fresh();
    t.noThrow('takes no token and no key (it is public data by design)',
      () => ctx.getPublicCatalog());
    const src = require('fs').readFileSync(require('./lib/sandbox').BACKEND, 'utf8');
    t.ok('doGet routes public_catalog before the key/PIN gates',
      /action === 'public_catalog'\)\s*return respond\(getPublicCatalog\(\)\)/.test(src));
    // Check the GATE block specifically -- matching loosely from
    // "action === 'member'" also hits the dispatch list further down,
    // where public_catalog legitimately appears.
    const gate = src.slice(
      src.indexOf("// Member/customer-facing actions require the shared key"),
      src.indexOf("!== API_KEY) return respondError('unauthorized');"));
    t.ok('the API_KEY gate list was located', /action === 'member'/.test(gate) && gate.length < 400);
    t.ok('and public_catalog is NOT in it', !/public_catalog/.test(gate));
  }

  // --- caching protects the sheet from crawlers -------------------------
  {
    const ctx = fresh();
    const first = ctx.getPublicCatalog();
    t.eq('first call reads the sheet', ctx.__log.reads.Catalog, 1);
    t.eq('and reports itself uncached', first.cached, false);
    const second = ctx.getPublicCatalog();
    t.eq('a second call serves from cache, no further sheet read', ctx.__log.reads.Catalog, 1);
    t.eq('and reports itself cached', second.cached, true);
    t.eq('cached payload is identical', second.catalog, first.catalog);
  }
  {
    // The payload is well past CacheService's 100KB per-value cap (~120KB
    // at 700 items), so a plain put() would fail on EVERY write and the
    // cache would quietly do nothing. Chunking is what makes it real --
    // assert against a realistic library, not a 2-item fixture.
    const big = [];
    for (let i = 1; i <= 700; i++) big.push({
      item_id: 'SFD-' + String(i).padStart(4, '0'),
      title: 'A Reasonably Long Movie Title ' + i, sort_title: '', format: 'Blu-ray',
      year: '1999', genre: 'Science-Fiction, Action, Suspense/Thriller',
      status: 'available', in_rotation: 'TRUE', collection: 'general' });
    const ctx = makeSandbox({ Catalog: big });
    ctx.getSettingValue = () => '';
    const live = ctx.getPublicCatalog();
    t.eq('700 items build fine', live.catalog.length, 700);
    t.ok('payload really does exceed one cache slot',
      JSON.stringify(live.catalog).length > 100 * 1024);
    const again = ctx.getPublicCatalog();
    t.eq('...and the SECOND call is still served from cache', again.cached, true);
    t.eq('so the sheet was read exactly once', ctx.__log.reads.Catalog, 1);
    t.eq('cached payload round-trips intact', again.catalog.length, 700);
    t.eq('  ...byte-for-byte', JSON.stringify(again.catalog), JSON.stringify(live.catalog));
  }
  {
    // An oversized/failing cache must degrade to serving live, never throw.
    const ctx = fresh();
    ctx.CacheService = { getScriptCache: () => ({
      get: () => null,
      put: () => { throw new Error('Argument too large: value'); },
      remove: () => {},
    }) };
    let res = null;
    t.noThrow('a cache write failure does not break the endpoint', () => { res = ctx.getPublicCatalog(); });
    t.ok('and it still returns the full catalog', res && res.catalog.length === 2);
  }
  {
    const ctx = fresh();
    ctx.CacheService = { getScriptCache: () => ({
      get: () => '{ this is not json',
      put: () => {},
      remove: () => {},
    }) };
    let res = null;
    t.noThrow('a corrupt cache entry does not break the endpoint', () => { res = ctx.getPublicCatalog(); });
    t.ok('it falls back to a live read', res && res.catalog.length === 2 && res.cached === false);
  }
});
