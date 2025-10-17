const fs = require('fs');

const serverPath = 'c:/GroundRodERP/server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find the DELETE endpoint
const startMarker = '// Delete entire client purchase order';
const startIdx = content.indexOf(startMarker);

if (startIdx === -1) {
  console.log('❌ Could not find DELETE endpoint');
  process.exit(1);
}

// Find the end - look for the closing of app.delete
let openBraces = 0;
let endIdx = startIdx;
let foundAppDelete = false;

for (let i = startIdx; i < content.length; i++) {
  if (!foundAppDelete && content.substring(i, i + 11) === "app.delete(") {
    foundAppDelete = true;
  }

  if (foundAppDelete) {
    if (content[i] === '{') openBraces++;
    if (content[i] === '}') {
      openBraces--;
      if (openBraces === 0) {
        endIdx = i + 3; // Include '});'
        break;
      }
    }
  }
}

const oldCode = content.substring(startIdx, endIdx);

const newCode = `// Delete entire client purchase order
app.delete('/api/client-purchase-orders/:id', (req, res) => {
  const { id } = req.params;

  db.get(\`SELECT id FROM client_purchase_orders WHERE id=?\`, [id], (e, po) => {
    if (e) return res.status(500).json({ error: e.message });
    if (!po) return res.status(404).json({ error: 'Client PO not found' });

    // Check for linked invoices
    db.get(\`SELECT id FROM invoices WHERE po_id=?\`, [id], (invErr, invoice) => {
      if (invErr) return res.status(500).json({ error: invErr.message });
      if (invoice) return res.status(400).json({ error: 'Cannot delete PO with linked invoices.' });

      // Check for linked shipments
      db.get(\`SELECT id FROM shipments WHERE po_id=?\`, [id], (shipErr, shipment) => {
        if (shipErr) return res.status(500).json({ error: shipErr.message });
        if (shipment) return res.status(400).json({ error: 'Cannot delete PO with linked shipments.' });

        // Delete in transaction
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
})`;

content = content.substring(0, startIdx) + newCode + content.substring(endIdx);

fs.writeFileSync(serverPath, content, 'utf8');

console.log('✅ Fixed DELETE endpoint!');
console.log('✓ Removed committed_stock updates (column no longer exists)');
console.log('✓ Removed material release logic');
console.log('✓ Added shipment validation');
console.log('✓ Simplified transaction logic');
