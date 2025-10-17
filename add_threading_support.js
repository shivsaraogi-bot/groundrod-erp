const fs = require('fs');

console.log('🔧 Adding threading support to Ground Rod ERP...\n');

// ============================================================================
// STEP 1: Add threading columns to products table schema
// ============================================================================
console.log('1. Updating products table schema...');

let server = fs.readFileSync('server.js', 'utf8');

// Add threading columns to the ensureColumn section
const oldEnsureColumns = `      ensureColumn('steel_diameter REAL');
      ensureColumn('copper_coating REAL');
      ensureColumn('length REAL');
      ensureColumn('active INTEGER DEFAULT 1');`;

const newEnsureColumns = `      ensureColumn('steel_diameter REAL');
      ensureColumn('copper_coating REAL');
      ensureColumn('length REAL');
      ensureColumn('active INTEGER DEFAULT 1');
      ensureColumn('base_product_id TEXT');
      ensureColumn('threading TEXT DEFAULT \\'Plain\\'');`;

server = server.replace(oldEnsureColumns, newEnsureColumns);

// Add threading column migration after products table creation
const afterProductsTable = `    });

    // Add threading support columns
    db.run("ALTER TABLE products ADD COLUMN base_product_id TEXT", (err) => { /* ignore if exists */ });
    db.run("ALTER TABLE products ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => { /* ignore if exists */ });

    // Customer table`;

server = server.replace(/    \}\);\n\n    \/\/ Customer table/, afterProductsTable);

console.log('   ✓ Products table schema updated');

// ============================================================================
// STEP 2: Add threading to client_po_line_items
// ============================================================================
console.log('\n2. Adding threading to client PO line items...');

const afterClientPOColumns = `    db.run("ALTER TABLE client_po_line_items ADD COLUMN currency TEXT DEFAULT 'INR'", (err) => { /* ignore if exists */ });
    db.run("ALTER TABLE client_po_line_items ADD COLUMN marking TEXT", (err) => { /* ignore if exists */ });
    db.run("ALTER TABLE client_po_line_items ADD COLUMN due_date DATE", (err) => { /* ignore if exists */ });
    db.run("ALTER TABLE client_po_line_items ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => { /* ignore if exists */ });`;

server = server.replace(
  /db\.run\("ALTER TABLE client_po_line_items ADD COLUMN due_date DATE", \(err\) => \{ \/\* ignore if exists \*\/ \}\);/,
  `db.run("ALTER TABLE client_po_line_items ADD COLUMN due_date DATE", (err) => { /* ignore if exists */ });
    db.run("ALTER TABLE client_po_line_items ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => { /* ignore if exists */ });`
);

console.log('   ✓ Client PO line items updated');

// ============================================================================
// STEP 3: Add threading to inventory_allocations
// ============================================================================
console.log('\n3. Adding threading to inventory allocations...');

server = server.replace(
  /\/\/ MIGRATION NOTE \(v20\.2\)/,
  `    // Add threading support to inventory allocations
    db.run("ALTER TABLE inventory_allocations ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => { /* ignore if exists */ });

    // MIGRATION NOTE (v20.2)`
);

console.log('   ✓ Inventory allocations updated');

// ============================================================================
// STEP 4: Add threading to production_history
// ============================================================================
console.log('\n4. Adding threading to production history...');

server = server.replace(
  /\/\/ Stock Adjustments table/,
  `    // Add threading support to production history
    db.run("ALTER TABLE production_history ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => { /* ignore if exists */ });

    // Stock Adjustments table`
);

console.log('   ✓ Production history updated');

fs.writeFileSync('server.js', server, 'utf8');

console.log('\n✅ Server schema updates complete!');
console.log('\nSummary of database changes:');
console.log('- Added base_product_id and threading columns to products table');
console.log('- Added threading column to client_po_line_items table');
console.log('- Added threading column to inventory_allocations table');
console.log('- Added threading column to production_history table');
console.log('\nNext steps:');
console.log('1. Update inventory tracking logic (consolidate by base_product_id)');
console.log('2. Update production logs UI (add threading selection)');
console.log('3. Update dashboard analytics (show combined WIP)');
console.log('4. Update client PO allocation logic');
