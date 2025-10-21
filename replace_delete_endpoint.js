const fs = require('fs');
const lines = fs.readFileSync('c:/GroundRodERP/server.js', 'utf8').split('\n');

const newEndpointLines = `
// DELETE ALL CLIENT POS AND INVOICES (DANGER ZONE)
app.post('/api/admin/delete-all-pos-invoices', (req, res) => {
  const { confirm } = req.body;

  if (confirm !== 'DELETE_ALL') {
    return res.status(400).json({ error: 'Must send {confirm: "DELETE_ALL"} to proceed' });
  }

  console.log('⚠️  DELETING ALL CLIENT POS AND INVOICES');

  db.serialize(() => {
    db.run('PRAGMA foreign_keys = OFF', (err) => {
      if (err) {
        console.error('Error disabling foreign keys:', err.message);
        return res.status(500).json({ error: err.message });
      }

      db.run('BEGIN TRANSACTION');

      db.run('DELETE FROM invoices', (err) => {
        if (err) {
          console.error('Error deleting invoices:', err.message);
          db.run('ROLLBACK');
          db.run('PRAGMA foreign_keys = ON');
          return res.status(500).json({ error: err.message });
        }

        db.run('DELETE FROM shipments', (err) => {
          if (err) {
            console.error('Error deleting shipments:', err.message);
            db.run('ROLLBACK');
            db.run('PRAGMA foreign_keys = ON');
            return res.status(500).json({ error: err.message });
          }

          db.run('DELETE FROM inventory_allocations', (err) => {
            if (err) {
              console.error('Error deleting allocations:', err.message);
              db.run('ROLLBACK');
              db.run('PRAGMA foreign_keys = ON');
              return res.status(500).json({ error: err.message });
            }

            db.run('DELETE FROM client_po_line_items', (err) => {
              if (err) {
                console.error('Error deleting line items:', err.message);
                db.run('ROLLBACK');
                db.run('PRAGMA foreign_keys = ON');
                return res.status(500).json({ error: err.message });
              }

              db.run('DELETE FROM client_purchase_orders', (err) => {
                if (err) {
                  console.error('Error deleting POs:', err.message);
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

                    console.log('✅ All client POs and invoices deleted');
                    res.json({
                      message: 'Successfully deleted all client POs and invoices',
                      deleted: {
                        invoices: true,
                        shipments: true,
                        allocations: true,
                        line_items: true,
                        purchase_orders: true
                      }
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});
`.split('\n');

// Delete lines 1983-2057 (inclusive, 0-indexed: 1982-2056)
lines.splice(1982, 75, ...newEndpointLines);

fs.writeFileSync('c:/GroundRodERP/server.js', lines.join('\n'), 'utf8');
console.log('✅ Replaced DELETE ALL endpoint with foreign key handling');
console.log('✓ PRAGMA foreign_keys = OFF before deletion');
console.log('✓ Order: invoices → shipments → allocations → line items → POs');
console.log('✓ PRAGMA foreign_keys = ON after completion');
