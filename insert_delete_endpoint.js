const fs = require('fs');
const lines = fs.readFileSync('c:/GroundRodERP/server.js', 'utf8').split('\n');

const endpoint = `
// DELETE ALL CLIENT POS AND INVOICES (DANGER ZONE)
app.post('/api/admin/delete-all-pos-invoices', (req, res) => {
  const { confirm } = req.body;

  if (confirm !== 'DELETE_ALL') {
    return res.status(400).json({ error: 'Must send {confirm: "DELETE_ALL"} to proceed' });
  }

  console.log('⚠️  DELETING ALL CLIENT POS AND INVOICES');

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run('DELETE FROM shipments', (err) => {
      if (err) {
        console.error('Error deleting shipments:', err.message);
        db.run('ROLLBACK');
        return res.status(500).json({ error: err.message });
      }

      db.run('DELETE FROM invoices', (err) => {
        if (err) {
          console.error('Error deleting invoices:', err.message);
          db.run('ROLLBACK');
          return res.status(500).json({ error: err.message });
        }

        db.run('DELETE FROM client_po_line_items', (err) => {
          if (err) {
            console.error('Error deleting line items:', err.message);
            db.run('ROLLBACK');
            return res.status(500).json({ error: err.message });
          }

          db.run('DELETE FROM inventory_allocations', (err) => {
            if (err) {
              console.error('Error deleting allocations:', err.message);
              db.run('ROLLBACK');
              return res.status(500).json({ error: err.message });
            }

            db.run('DELETE FROM client_purchase_orders', (err) => {
              if (err) {
                console.error('Error deleting POs:', err.message);
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
              }

              db.run('COMMIT', (err) => {
                if (err) {
                  console.error('Error committing:', err.message);
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: err.message });
                }

                console.log('✅ All client POs and invoices deleted');
                res.json({
                  message: 'Successfully deleted all client POs and invoices',
                  deleted: {
                    shipments: true,
                    invoices: true,
                    line_items: true,
                    allocations: true,
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
`.split('\n');

// Insert at line 1983 (after line 1982 which is the closing })
lines.splice(1982, 0, ...endpoint);

fs.writeFileSync('c:/GroundRodERP/server.js', lines.join('\n'), 'utf8');
console.log('✅ Added DELETE ALL endpoint at line 1983');
console.log('\nUsage:');
console.log('POST https://groundrod-erp.onrender.com/api/admin/delete-all-pos-invoices');
console.log('Body: { "confirm": "DELETE_ALL" }');
