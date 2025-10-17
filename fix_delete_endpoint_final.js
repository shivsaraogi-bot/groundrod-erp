const fs = require('fs');

console.log('🔧 Fixing client PO DELETE endpoint (final fix)...\n');

let server = fs.readFileSync('server.js', 'utf8');

// Find and replace the entire DELETE endpoint with a simplified, working version
const deleteEndpointPattern = /app\.delete\('\/api\/client-purchase-orders\/:id', \(req, res\) => \{[\s\S]*?\n\}\);\n\n\/\/ Update delivered quantity for a line item/;

const newDeleteEndpoint = `app.delete('/api/client-purchase-orders/:id', (req, res) => {
  const { id } = req.params;

  // Check if PO exists
  db.get(\`SELECT id FROM client_purchase_orders WHERE id=?\`, [id], (e, po) => {
    if (e) return res.status(500).json({ error: e.message });
    if (!po) return res.status(404).json({ error: 'Client PO not found' });

    // Check if there are any invoices linked to this PO
    db.get(\`SELECT id FROM invoices WHERE po_id=?\`, [id], (invErr, invoice) => {
      if (invErr) return res.status(500).json({ error: invErr.message });
      if (invoice) return res.status(400).json({ error: 'Cannot delete PO with linked invoices. Delete invoices first.' });

      // Check if there are any shipments linked to this PO
      db.get(\`SELECT id FROM shipments WHERE po_id=?\`, [id], (shipErr, shipment) => {
        if (shipErr) return res.status(500).json({ error: shipErr.message });
        if (shipment) return res.status(400).json({ error: 'Cannot delete PO with linked shipments. Delete shipments first.' });

        // Check if any line items have delivered quantity
        db.get(\`SELECT id FROM client_po_line_items WHERE po_id=? AND delivered > 0\`, [id], (delErr, deliveredItem) => {
          if (delErr) return res.status(500).json({ error: delErr.message });
          if (deliveredItem) return res.status(400).json({ error: 'Cannot delete PO with delivered items' });

          // Delete line items and PO in a transaction
          db.serialize(() => {
            db.run('BEGIN');

            db.run(\`DELETE FROM client_po_line_items WHERE po_id=?\`, [id], (delItemsErr) => {
              if (delItemsErr) {
                try { db.run('ROLLBACK'); } catch(_) {}
                return res.status(500).json({ error: delItemsErr.message });
              }

              db.run(\`DELETE FROM client_purchase_orders WHERE id=?\`, [id], (delPOErr) => {
                if (delPOErr) {
                  try { db.run('ROLLBACK'); } catch(_) {}
                  return res.status(500).json({ error: delPOErr.message });
                }

                db.run('COMMIT', (commitErr) => {
                  if (commitErr) {
                    try { db.run('ROLLBACK'); } catch(_) {}
                    return res.status(500).json({ error: commitErr.message });
                  }
                  res.json({ message: 'Client PO deleted successfully' });
                });
              });
            });
          });
        });
      });
    });
  });
});

// Update delivered quantity for a line item`;

server = server.replace(deleteEndpointPattern, newDeleteEndpoint);

fs.writeFileSync('server.js', server, 'utf8');

console.log('✅ DELETE endpoint fixed!');
console.log('\nChanges:');
console.log('- Simplified DELETE logic (no material release)');
console.log('- Added shipment check');
console.log('- Proper transaction handling');
console.log('- Validates: PO exists, no invoices, no shipments, no delivered items');
console.log('\nThis should work on Render once deployed.');
