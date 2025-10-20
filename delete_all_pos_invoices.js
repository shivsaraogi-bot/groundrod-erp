const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./groundrod.db');

console.log('⚠️  WARNING: This will delete ALL client POs and invoices!');
console.log('Starting deletion process...\n');

db.serialize(() => {
  // Start transaction
  db.run('BEGIN TRANSACTION');

  // Delete all shipments first (foreign key to client POs)
  db.run('DELETE FROM shipments', (err) => {
    if (err) {
      console.error('❌ Error deleting shipments:', err.message);
      db.run('ROLLBACK');
      return;
    }
    console.log('✓ Deleted all shipments');

    // Delete all invoices
    db.run('DELETE FROM invoices', (err) => {
      if (err) {
        console.error('❌ Error deleting invoices:', err.message);
        db.run('ROLLBACK');
        return;
      }
      console.log('✓ Deleted all invoices');

      // Delete all client PO line items
      db.run('DELETE FROM client_po_line_items', (err) => {
        if (err) {
          console.error('❌ Error deleting client PO line items:', err.message);
          db.run('ROLLBACK');
          return;
        }
        console.log('✓ Deleted all client PO line items');

        // Delete all inventory allocations
        db.run('DELETE FROM inventory_allocations', (err) => {
          if (err) {
            console.error('❌ Error deleting inventory allocations:', err.message);
            db.run('ROLLBACK');
            return;
          }
          console.log('✓ Deleted all inventory allocations');

          // Finally delete all client purchase orders
          db.run('DELETE FROM client_purchase_orders', (err) => {
            if (err) {
              console.error('❌ Error deleting client purchase orders:', err.message);
              db.run('ROLLBACK');
              return;
            }
            console.log('✓ Deleted all client purchase orders');

            // Commit transaction
            db.run('COMMIT', (err) => {
              if (err) {
                console.error('❌ Error committing transaction:', err.message);
                db.run('ROLLBACK');
                return;
              }

              console.log('\n✅ Successfully deleted:');
              console.log('   - All shipments');
              console.log('   - All invoices');
              console.log('   - All client PO line items');
              console.log('   - All inventory allocations');
              console.log('   - All client purchase orders');
              console.log('\n💾 Database cleaned successfully!');

              db.close();
            });
          });
        });
      });
    });
  });
});
