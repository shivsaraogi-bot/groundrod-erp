// Script to reset all inventory to zero
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./groundrod.db');

console.log('Resetting all inventory to zero...');

db.run(`UPDATE inventory
        SET steel_rods = 0,
            plated = 0,
            machined = 0,
            qc = 0,
            stamped = 0,
            packed = 0,
            updated_at = CURRENT_TIMESTAMP`,
  function(err) {
    if (err) {
      console.error('❌ Error resetting inventory:', err.message);
      process.exit(1);
    }

    console.log(`✅ Successfully reset inventory for ${this.changes} product(s)`);

    // Verify the reset
    db.all('SELECT product_id, steel_rods, plated, machined, qc, stamped, packed FROM inventory', [], (err, rows) => {
      if (err) {
        console.error('Error verifying:', err.message);
      } else {
        console.log('\nCurrent inventory after reset:');
        rows.forEach(row => {
          const total = row.steel_rods + row.plated + row.machined + row.qc + row.stamped + row.packed;
          console.log(`  ${row.product_id}: Total = ${total} (Steel Rods: ${row.steel_rods}, Plated: ${row.plated}, Machined: ${row.machined}, QC: ${row.qc}, Stamped: ${row.stamped}, Packed: ${row.packed})`);
        });
        console.log('\n✅ All inventory has been reset to zero!');
      }

      db.close();
    });
  }
);
