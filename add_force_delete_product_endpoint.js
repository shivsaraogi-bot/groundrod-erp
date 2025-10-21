const fs = require('fs');

const serverPath = 'c:/GroundRodERP/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find where to insert the new endpoint (after the DELETE ALL POs endpoint)
const marker = '// Update delivered quantity for a line item';
const markerIdx = content.indexOf(marker);

if (markerIdx === -1) {
  console.log('❌ Could not find insertion point');
  process.exit(1);
}

const newEndpoint = `
// FORCE DELETE PRODUCT (removes all references)
app.post('/api/admin/force-delete-product/:id', (req, res) => {
  const { id } = req.params;
  const { confirm } = req.body;

  if (confirm !== 'FORCE_DELETE') {
    return res.status(400).json({ error: 'Must send {confirm: "FORCE_DELETE"} to proceed' });
  }

  console.log(\`⚠️  FORCE DELETING PRODUCT: \${id}\`);

  db.serialize(() => {
    db.run('PRAGMA foreign_keys = OFF', (err) => {
      if (err) {
        console.error('Error disabling foreign keys:', err.message);
        return res.status(500).json({ error: err.message });
      }

      db.run('BEGIN TRANSACTION');

      // Delete from all tables that reference products
      const tables = [
        'bom',
        'inventory',
        'client_po_line_items',
        'shipment_items',
        'production_history',
        'job_work_items',
        'stock_adjustments',
        'drawing_operations',
        'inventory_allocations',
        'vendor_po_line_items'
      ];

      let completed = 0;
      let hasError = false;

      const deleteFromTable = (table) => {
        db.run(\`DELETE FROM \${table} WHERE product_id=?\`, [id], (err) => {
          if (err && !err.message.includes('no such table')) {
            console.error(\`Error deleting from \${table}:\`, err.message);
            hasError = true;
          } else {
            console.log(\`✓ Deleted references from \${table}\`);
          }

          completed++;

          if (completed === tables.length) {
            if (hasError) {
              db.run('ROLLBACK');
              db.run('PRAGMA foreign_keys = ON');
              return res.status(500).json({ error: 'Failed to delete some references' });
            }

            // Finally delete the product itself
            db.run('DELETE FROM products WHERE id=?', [id], (err) => {
              if (err) {
                console.error('Error deleting product:', err.message);
                db.run('ROLLBACK');
                db.run('PRAGMA foreign_keys = ON');
                return res.status(500).json({ error: err.message });
              }

              db.run('COMMIT', (err) => {
                if (err) {
                  console.error('Error committing:', err.message);
                  db.run('ROLLBACK');
                  db.run('PRAGMA foreign_keys = ON');
                  return res.status(500).json({ error: err.message });
                }

                db.run('PRAGMA foreign_keys = ON', (err) => {
                  if (err) {
                    console.error('Error re-enabling foreign keys:', err.message);
                  }

                  console.log(\`✅ Product \${id} force deleted\`);
                  res.json({
                    message: \`Product \${id} and all references deleted successfully\`,
                    deleted_from: tables
                  });
                });
              });
            });
          }
        });
      };

      // Delete from all tables
      tables.forEach(deleteFromTable);
    });
  });
});

`;

content = content.substring(0, markerIdx) + newEndpoint + content.substring(markerIdx);

fs.writeFileSync(serverPath, content, 'utf8');

console.log('✅ Added FORCE DELETE PRODUCT endpoint!');
console.log('\nEndpoint: POST /api/admin/force-delete-product/:id');
console.log('Body: { "confirm": "FORCE_DELETE" }');
console.log('\nDeletes product from:');
console.log('- bom');
console.log('- inventory');
console.log('- client_po_line_items');
console.log('- shipment_items');
console.log('- production_history');
console.log('- job_work_items');
console.log('- stock_adjustments');
console.log('- drawing_operations');
console.log('- inventory_allocations');
console.log('- vendor_po_line_items');
console.log('- products (finally)');
