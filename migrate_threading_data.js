const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'groundrod.db');
const db = new sqlite3.Database(dbPath);

console.log('🔄 Migrating existing products to threading schema...\n');

db.serialize(() => {
  // Step 1: Get all existing products
  db.all('SELECT id, description, base_product_id, threading FROM products', (err, products) => {
    if (err) {
      console.error('Error fetching products:', err.message);
      db.close();
      return;
    }

    console.log(`Found ${products.length} products to migrate\n`);

    let updated = 0;
    let skipped = 0;

    products.forEach((product, index) => {
      // Skip if already has threading data
      if (product.base_product_id && product.threading) {
        skipped++;
        return;
      }

      // Detect threading from product ID pattern
      let threading = 'Plain';
      let baseProductId = product.id;

      // Pattern: NFPL19X3T → base: NFPL19X3, threading: Threaded
      if (product.id.endsWith('T') && product.id.length > 1) {
        const potentialBase = product.id.slice(0, -1);
        // Check if base product exists
        const baseExists = products.some(p => p.id === potentialBase);
        if (baseExists) {
          threading = 'Threaded';
          baseProductId = potentialBase;
        }
      }

      // Pattern: Check description for threading keywords
      if (product.description) {
        const desc = product.description.toLowerCase();
        if (desc.includes('threaded') && !desc.includes('non-threaded') && !desc.includes('plain')) {
          threading = 'Threaded';
        } else if (desc.includes('partially threaded') || desc.includes('partial thread')) {
          threading = 'Partially Threaded';
        }
      }

      // Update product
      db.run(
        `UPDATE products SET base_product_id = ?, threading = ? WHERE id = ?`,
        [baseProductId, threading, product.id],
        (updateErr) => {
          if (updateErr) {
            console.error(`✗ Error updating ${product.id}:`, updateErr.message);
          } else {
            updated++;
            if (baseProductId !== product.id) {
              console.log(`✓ ${product.id}: Linked to base ${baseProductId}, threading: ${threading}`);
            } else {
              console.log(`✓ ${product.id}: Set as base product, threading: ${threading}`);
            }
          }

          // Close DB after last update
          if (index === products.length - 1) {
            setTimeout(() => {
              console.log(`\n✅ Migration complete!`);
              console.log(`   Updated: ${updated} products`);
              console.log(`   Skipped: ${skipped} products (already migrated)`);
              console.log(`\nNext steps:`);
              console.log(`1. Review migrated data: SELECT id, base_product_id, threading FROM products;`);
              console.log(`2. Manually adjust any incorrect threading assignments`);
              console.log(`3. Test creating new threading variants through UI`);
              db.close();
            }, 500);
          }
        }
      );
    });

    if (products.length === 0) {
      console.log('No products to migrate');
      db.close();
    }
  });
});
