// The Dashboard CATALOG counts. This tab exists so the owner can trust a
// number at a glance, which makes a quietly wrong one worse than none --
// it is also the tab that once spent months reading a renamed demo tab.
const { makeSandbox, suite } = require('./lib/sandbox');

const item = (id, status, rotation) => ({
  item_id: id, title: 'T ' + id, status: status, in_rotation: rotation,
});

module.exports = () => suite('dashboard: catalog counts', (t) => {
  const CATALOG = [
    item('SFD-0001', 'available', 'TRUE'),        // rentable
    item('SFD-0002', 'available', 'TRUE'),        // rentable
    item('SFD-0003', '',          'TRUE'),        // blank status: rentable
    item('SFD-0004', 'available', 'FALSE'),       // shelved, NOT rentable
    item('SFD-0005', 'available', ''),            // no rotation flag: not rentable
    item('SFD-0006', 'checked_out',    'TRUE'),   // out with a customer
    item('SFD-0007', 'checked_out',    'FALSE'),  // out, but pulled from rotation
    item('SFD-0008', 'return_pending', 'TRUE'),   // in the bin
    item('SFD-0009', 'missing',   'FALSE'),
    item('SFD-0010', 'damaged',   'FALSE'),
    { item_id: '', title: 'blank row that should not count' },
  ];
  const ctx = makeSandbox({ Catalog: CATALOG });
  const s = ctx.computeDashboardCatalogStats_();

  t.eq('blank item_id rows are not counted in the total', s.total, 10);
  // 0001, 0002, 0003, 0006, 0008 -- the flag alone, whatever the status.
  t.eq('in rotation counts the flag alone', s.in_rotation, 5);

  // The fix: "Available" means rentable, so it is the INTERSECTION of
  // in_rotation and status. Counting status alone included every shelved
  // row and roughly doubled the number on the live sheet.
  t.eq('available counts only in-rotation items', s.available, 3);
  t.ok('  ...which is fewer than status alone would give',
    s.available < CATALOG.filter((c) => (c.status || 'available') === 'available').length);
  t.ok('  ...and never exceeds in rotation', s.available <= s.in_rotation);

  // Deliberately NOT scoped by rotation: these describe where a physical
  // disc is. One pulled from rotation while a customer still has it is
  // genuinely still out, and dropping it would be the worse error.
  t.eq('checked out counts discs that are out, rotation or not', s.checked_out, 2);
  t.eq('return bin likewise', s.return_bin, 1);

  // A blank status cell means available (hand-added rows leave it empty),
  // and that has to hold here too or the tab disagrees with the rent check.
  t.ok('a blank status counts as available when in rotation',
    ctx.computeDashboardCatalogStats_().available === 3);
  {
    const only = makeSandbox({ Catalog: [item('SFD-0100', '', 'TRUE')] });
    t.eq('  ...proven in isolation', only.computeDashboardCatalogStats_().available, 1);
  }
  {
    const none = makeSandbox({ Catalog: [item('SFD-0101', '', 'FALSE')] });
    t.eq('  ...and a blank status out of rotation still is not rentable',
      none.computeDashboardCatalogStats_().available, 0);
  }

  // The label has to say what the number now means.
  {
    const src = require('fs').readFileSync(require('./lib/sandbox').BACKEND, 'utf8');
    t.ok('the Dashboard row is labelled "Available to rent"',
      /'Available to rent', catalogStats\.available/.test(src));
  }
});
