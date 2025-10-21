const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./groundrod.db');

console.log('🔥 FORCE DELETING ALL CLIENT POS AND INVOICES\n');
console.log('Step 1: Disable foreign keys temporarily');
console.log('Step 2: Delete invoices first');
console.log('Step 3: Delete shipments');
console.log('Step 4: Delete allocations');
console.log('Step 5: Delete line items');
console.log('Step 6: Delete client POs');
console.log('Step 7: Re-enable foreign keys\n');

db.serialize(() => {
  // Disable foreign keys to avoid constraint issues
  db.run('PRAGMA foreign_keys = OFF', (err) => {
    if (err) {
      console.error('❌ Error disabling foreign keys:', err.message);
      db.close();
      return;
    }
    console.log('✓ Foreign keys disabled');

    db.run('BEGIN TRANSACTION');

    // Step 1: Delete all invoices FIRST (no dependencies)
    db.run('DELETE FROM invoices', function(err) {
      if (err) {
        console.error('❌ Error deleting invoices:', err.message);
        db.run('ROLLBACK');
        db.close();
        return;
      }
      console.log(`✓ Deleted ${this.changes} invoices`);

      // Step 2: Delete all shipments
      db.run('DELETE FROM shipments', function(err) {
        if (err) {
          console.error('❌ Error deleting shipments:', err.message);
          db.run('ROLLBACK');
          db.close();
          return;
        }
        console.log(`✓ Deleted ${this.changes} shipments`);

        // Step 3: Delete all inventory allocations
        db.run('DELETE FROM inventory_allocations', function(err) {
          if (err) {
            console.error('❌ Error deleting allocations:', err.message);
            db.run('ROLLBACK');
            db.close();
            return;
          }
          console.log(`✓ Deleted ${this.changes} inventory allocations`);

          // Step 4: Delete all client PO line items
          db.run('DELETE FROM client_po_line_items', function(err) {
            if (err) {
              console.error('❌ Error deleting line items:', err.message);
              db.run('ROLLBACK');
              db.close();
              return;
            }
            console.log(`✓ Deleted ${this.changes} client PO line items`);

            // Step 5: Delete all client purchase orders
            db.run('DELETE FROM client_purchase_orders', function(err) {
              if (err) {
                console.error('❌ Error deleting client POs:', err.message);
                db.run('ROLLBACK');
                db.close();
                return;
              }
              console.log(`✓ Deleted ${this.changes} client purchase orders`);

              // Commit the transaction
              db.run('COMMIT', (err) => {
                if (err) {
                  console.error('❌ Error committing:', err.message);
                  db.run('ROLLBACK');
                  db.close();
                  return;
                }

                // Re-enable foreign keys
                db.run('PRAGMA foreign_keys = ON', (err) => {
                  if (err) {
                    console.error('❌ Error re-enabling foreign keys:', err.message);
                  } else {
                    console.log('✓ Foreign keys re-enabled');
                  }

                  // Verify deletion
                  console.log('\n📊 Verifying deletion...');
                  db.get('SELECT COUNT(*) as count FROM invoices', (err, row) => {
                    console.log(`   Remaining invoices: ${row ? row.count : 'error'}`);
                  });
                  db.get('SELECT COUNT(*) as count FROM shipments', (err, row) => {
                    console.log(`   Remaining shipments: ${row ? row.count : 'error'}`);
                  });
                  db.get('SELECT COUNT(*) as count FROM inventory_allocations', (err, row) => {
                    console.log(`   Remaining allocations: ${row ? row.count : 'error'}`);
                  });
                  db.get('SELECT COUNT(*) as count FROM client_po_line_items', (err, row) => {
                    console.log(`   Remaining line items: ${row ? row.count : 'error'}`);
                  });
                  db.get('SELECT COUNT(*) as count FROM client_purchase_orders', (err, row) => {
                    console.log(`   Remaining client POs: ${row ? row.count : 'error'}`);

                    setTimeout(() => {
                      console.log('\n✅ FORCE DELETE COMPLETE!\n');
                      db.close();
                    }, 500);
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
