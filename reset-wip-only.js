// Script to reset only WIP inventory (not packed) to zero
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./groundrod.db');

console.log('Resetting WIP inventory to zero (keeping packed inventory)...');

db.run(`UPDATE inventory
        SET steel_rods = 0,
            plated = 0,
            machined = 0,
            qc = 0,
            stamped = 0,
            updated_at = CURRENT_TIMESTAMP`,
  function(err) {
    if (err) {
      console.error('❌ Error resetting WIP inventory:', err.message);
      process.exit(1);
    }

    console.log(`✅ Successfully reset WIP inventory for ${this.changes} product(s)`);

    // Verify the reset
    db.all('SELECT product_id, steel_rods, plated, machined, qc, stamped, packed FROM inventory', [], (err, rows) => {
      if (err) {
        console.error('Error verifying:', err.message);
      } else {
        console.log('\nCurrent inventory after WIP reset:');
        rows.forEach(row => {
          const wip = row.steel_rods + row.plated + row.machined + row.qc + row.stamped;
          console.log(`  ${row.product_id}:`);
          console.log(`    WIP: Steel Rods=${row.steel_rods}, Plated=${row.plated}, Machined=${row.machined}, QC=${row.qc}, Stamped=${row.stamped} (Total WIP: ${wip})`);
          console.log(`    Packed: ${row.packed} (PRESERVED)`);
        });
        console.log('\n✅ WIP inventory has been reset to zero!');
        console.log('✅ Packed inventory preserved!');
        console.log('✅ All other data (customers, products, vendors, etc.) untouched!');
      }

      db.close();
    });
  }
);
