const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'groundrod.db');
const db = new sqlite3.Database(dbPath);

console.log('Starting database migration to remove QC column...\n');

db.serialize(() => {
  console.log('1. Migrating production_history table...');

  // Create new table without qc column
  db.run(`CREATE TABLE IF NOT EXISTS production_history_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    production_date DATE NOT NULL,
    product_id TEXT NOT NULL,
    plated INTEGER DEFAULT 0,
    machined INTEGER DEFAULT 0,
    stamped INTEGER DEFAULT 0,
    packed INTEGER DEFAULT 0,
    rejected INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`, (err) => {
    if (err) {
      console.error('   ✗ Error creating production_history_new:', err.message);
      return;
    }

    // Copy data from old table (excluding qc column)
    db.run(`INSERT INTO production_history_new
            SELECT id, production_date, product_id, plated, machined, stamped, packed, rejected, notes, created_at
            FROM production_history`, (err) => {
      if (err) {
        console.error('   ✗ Error copying data:', err.message);
        return;
      }

      // Drop old table
      db.run(`DROP TABLE production_history`, (err) => {
        if (err) {
          console.error('   ✗ Error dropping old table:', err.message);
          return;
        }

        // Rename new table
        db.run(`ALTER TABLE production_history_new RENAME TO production_history`, (err) => {
          if (err) {
            console.error('   ✗ Error renaming table:', err.message);
          } else {
            console.log('   ✓ production_history table migrated successfully');
          }
        });
      });
    });
  });

  // Wait a bit for production_history to complete
  setTimeout(() => {
    console.log('\n2. Migrating inventory table...');

    // Create new table without qc column
    db.run(`CREATE TABLE IF NOT EXISTS inventory_new (
      product_id TEXT PRIMARY KEY,
      cores INTEGER DEFAULT 0,
      steel_rods INTEGER DEFAULT 0,
      plated INTEGER DEFAULT 0,
      machined INTEGER DEFAULT 0,
      stamped INTEGER DEFAULT 0,
      packed INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`, (err) => {
      if (err) {
        console.error('   ✗ Error creating inventory_new:', err.message);
        return;
      }

      // Copy data from old table (excluding qc column)
      db.run(`INSERT INTO inventory_new
              SELECT product_id, cores, steel_rods, plated, machined, stamped, packed, updated_at
              FROM inventory`, (err) => {
        if (err) {
          console.error('   ✗ Error copying data:', err.message);
          return;
        }

        // Drop old table
        db.run(`DROP TABLE inventory`, (err) => {
          if (err) {
            console.error('   ✗ Error dropping old table:', err.message);
            return;
          }

          // Rename new table
          db.run(`ALTER TABLE inventory_new RENAME TO inventory`, (err) => {
            if (err) {
              console.error('   ✗ Error renaming table:', err.message);
            } else {
              console.log('   ✓ inventory table migrated successfully');
              console.log('\n✅ Database migration complete!');
              console.log('\nNote: This script should be run on both local and production databases.');
              db.close();
            }
          });
        });
      });
    });
  }, 1000);
});
