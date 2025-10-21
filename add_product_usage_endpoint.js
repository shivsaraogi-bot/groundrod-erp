const fs = require('fs');

const serverPath = 'c:/GroundRodERP/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find where to insert (before the force delete endpoint)
const marker = '// FORCE DELETE PRODUCT (removes all references)';
const markerIdx = content.indexOf(marker);

if (markerIdx === -1) {
  console.log('❌ Could not find insertion point');
  process.exit(1);
}

const newEndpoint = `
// Get product usage details across all tables
app.get('/api/products/:id/usage', (req, res) => {
  const { id } = req.params;

  const usage = {
    product_id: id,
    references: {},
    total_references: 0,
    can_delete: true
  };

  const checks = [
    { table: 'bom', query: 'SELECT COUNT(*) as count FROM bom WHERE product_id=?', safe_to_have: true },
    { table: 'inventory', query: 'SELECT steel_rods, plated, machined, stamped, packed FROM inventory WHERE product_id=?', safe_to_have: false },
    { table: 'client_po_line_items', query: 'SELECT COUNT(*) as count FROM client_po_line_items WHERE product_id=?', safe_to_have: false },
    { table: 'production_history', query: 'SELECT COUNT(*) as count FROM production_history WHERE product_id=?', safe_to_have: true },
    { table: 'shipment_items', query: 'SELECT COUNT(*) as count FROM shipment_items WHERE product_id=?', safe_to_have: false },
    { table: 'inventory_allocations', query: 'SELECT COUNT(*) as count FROM inventory_allocations WHERE product_id=?', safe_to_have: false },
    { table: 'stock_adjustments', query: 'SELECT COUNT(*) as count FROM stock_adjustments WHERE product_id=?', safe_to_have: true }
  ];

  let completed = 0;

  checks.forEach(check => {
    db.get(check.query, [id], (err, row) => {
      if (!err && row) {
        if (check.table === 'inventory') {
          const total = (row.steel_rods || 0) + (row.plated || 0) + (row.machined || 0) + (row.stamped || 0) + (row.packed || 0);
          if (total > 0) {
            usage.references[check.table] = {
              count: 1,
              details: row,
              blocking: true
            };
            usage.total_references++;
            if (!check.safe_to_have) usage.can_delete = false;
          }
        } else if (row.count > 0) {
          usage.references[check.table] = {
            count: row.count,
            blocking: !check.safe_to_have
          };
          usage.total_references += row.count;
          if (!check.safe_to_have) usage.can_delete = false;
        }
      }

      completed++;

      if (completed === checks.length) {
        res.json(usage);
      }
    });
  });
});

`;

content = content.substring(0, markerIdx) + newEndpoint + content.substring(markerIdx);

fs.writeFileSync(serverPath, content, 'utf8');

console.log('✅ Added Product Usage Report endpoint!');
console.log('\nEndpoint: GET /api/products/:id/usage');
console.log('\nReturns:');
console.log('- Which tables reference the product');
console.log('- How many references in each table');
console.log('- Whether each reference blocks deletion');
console.log('- Overall can_delete status');
console.log('\nUse this BEFORE deleting to see what needs to be cleaned up!');
