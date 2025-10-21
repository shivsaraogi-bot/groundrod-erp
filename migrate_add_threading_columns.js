const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./groundrod.db');

console.log('🔄 Adding threading columns to database...\n');

db.serialize(() => {
  // Add columns to products table
  db.run("ALTER TABLE products ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Error adding threading to products:', err.message);
    } else {
      console.log('✓ Added threading column to products');
    }
  });

  db.run("ALTER TABLE products ADD COLUMN base_product_id TEXT", (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Error adding base_product_id to products:', err.message);
    } else {
      console.log('✓ Added base_product_id column to products');
    }
  });

  // Set default base_product_id to product's own id for existing products
  db.run("UPDATE products SET base_product_id = id WHERE base_product_id IS NULL", (err) => {
    if (err) {
      console.error('❌ Error updating base_product_id:', err.message);
    } else {
      console.log('✓ Set default base_product_id for existing products');
    }
  });

  // Set default threading to 'Plain' for existing products
  db.run("UPDATE products SET threading = 'Plain' WHERE threading IS NULL", (err) => {
    if (err) {
      console.error('❌ Error updating threading:', err.message);
    } else {
      console.log('✓ Set default threading to Plain for existing products');
    }
  });

  // Add columns to client_po_line_items
  db.run("ALTER TABLE client_po_line_items ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Error adding threading to line items:', err.message);
    } else {
      console.log('✓ Added threading column to client_po_line_items');
    }
  });

  // Add columns to inventory_allocations
  db.run("ALTER TABLE inventory_allocations ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Error adding threading to allocations:', err.message);
    } else {
      console.log('✓ Added threading column to inventory_allocations');
    }
  });

  // Add columns to production_history
  db.run("ALTER TABLE production_history ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('❌ Error adding threading to production:', err.message);
    } else {
      console.log('✓ Added threading column to production_history');
    }

    // Close after last operation
    setTimeout(() => {
      console.log('\n✅ Threading migration complete!');
      console.log('\nYou can now:');
      console.log('1. Edit existing plain products to set them as base products');
      console.log('2. Create threaded variants and link them via Base Product ID');
      console.log('3. Use threading selector in production entry\n');
      db.close();
    }, 500);
  });
});
