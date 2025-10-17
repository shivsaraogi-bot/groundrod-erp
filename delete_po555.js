const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'groundrod.db');
const db = new sqlite3.Database(dbPath);

console.log('🗑️  Deleting PO555 and all related data...\n');

db.serialize(() => {
  db.run('BEGIN TRANSACTION');

  // Step 1: Delete line items
  db.run('DELETE FROM client_po_line_items WHERE po_id = ?', ['PO555'], (err) => {
    if (err) {
      console.error('Error deleting line items:', err.message);
      db.run('ROLLBACK');
      db.close();
      return;
    }
    console.log('✓ Deleted line items for PO555');

    // Step 2: Delete any invoices
    db.run('DELETE FROM invoices WHERE po_id = ?', ['PO555'], (err) => {
      if (err) {
        console.error('Error deleting invoices:', err.message);
        db.run('ROLLBACK');
        db.close();
        return;
      }
      console.log('✓ Deleted invoices for PO555');

      // Step 3: Delete any shipments
      db.run('DELETE FROM shipments WHERE po_id = ?', ['PO555'], (err) => {
        if (err) {
          console.error('Error deleting shipments:', err.message);
          db.run('ROLLBACK');
          db.close();
          return;
        }
        console.log('✓ Deleted shipments for PO555');

        // Step 4: Delete the PO itself
        db.run('DELETE FROM client_purchase_orders WHERE id = ?', ['PO555'], (err) => {
          if (err) {
            console.error('Error deleting PO:', err.message);
            db.run('ROLLBACK');
            db.close();
            return;
          }
          console.log('✓ Deleted PO555');

          // Commit transaction
          db.run('COMMIT', (err) => {
            if (err) {
              console.error('Error committing:', err.message);
              db.run('ROLLBACK');
            } else {
              console.log('\n✅ PO555 successfully deleted from local database!');
              console.log('\nNote: This only affects your LOCAL database.');
              console.log('To delete from Render production, you need to:');
              console.log('1. SSH into Render');
              console.log('2. Run this script on the production database');
              console.log('OR');
              console.log('3. Wait for DELETE endpoint to be fixed and deployed');
            }
            db.close();
          });
        });
      });
    });
  });
});
