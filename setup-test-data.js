// Test Database Setup Script
// Creates groundrod-test.db with comprehensive dummy data
// Run with: node setup-test-data.js
// To use test DB: set DB_PATH=groundrod-test.db in environment
// To switch back: remove DB_PATH environment variable

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, 'groundrod-test.db');

// Delete existing test database
if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
  console.log('✓ Deleted existing test database');
}

const db = new sqlite3.Database(TEST_DB_PATH, (err) => {
  if (err) {
    console.error('Error creating test database:', err);
    process.exit(1);
  }
  console.log('✓ Created test database:', TEST_DB_PATH);
});

// Initialize schema (same as main database)
function initSchema(callback) {
  db.serialize(() => {
    // Products table
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      description TEXT,
      steel_diameter REAL,
      copper_coating REAL,
      length REAL,
      weight REAL,
      cost_price REAL,
      hs_code TEXT,
      export_description TEXT
    )`);

    // Customers table
    db.run(`CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT,
      address TEXT,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      office_address TEXT,
      warehouse_address TEXT,
      city TEXT,
      country TEXT
    )`);

    // Vendors table
    db.run(`CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      office_address TEXT,
      vendor_type TEXT,
      material_type TEXT,
      city TEXT,
      country TEXT
    )`);

    // Raw materials inventory
    db.run(`CREATE TABLE IF NOT EXISTS raw_materials_inventory (
      material TEXT PRIMARY KEY,
      current_stock REAL DEFAULT 0,
      committed_stock REAL DEFAULT 0,
      unit TEXT DEFAULT 'kg'
    )`);

    // BOM table
    db.run(`CREATE TABLE IF NOT EXISTS bom (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT,
      material TEXT,
      qty_per_unit REAL,
      FOREIGN KEY(product_id) REFERENCES products(id)
    )`);

    // Inventory table
    db.run(`CREATE TABLE IF NOT EXISTS inventory (
      product_id TEXT PRIMARY KEY,
      steel_rods INTEGER DEFAULT 0,
      plated INTEGER DEFAULT 0,
      quality_checked INTEGER DEFAULT 0,
      stamped INTEGER DEFAULT 0,
      packaged INTEGER DEFAULT 0,
      updated_at TEXT,
      FOREIGN KEY(product_id) REFERENCES products(id)
    )`);

    // Client Purchase Orders
    db.run(`CREATE TABLE IF NOT EXISTS client_purchase_orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      po_date TEXT,
      expected_delivery_date TEXT,
      status TEXT DEFAULT 'Pending',
      notes TEXT,
      currency TEXT DEFAULT 'INR',
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    )`);

    // Client PO Line Items
    db.run(`CREATE TABLE IF NOT EXISTS client_po_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id TEXT,
      product_id TEXT,
      quantity INTEGER,
      unit_price REAL,
      FOREIGN KEY(po_id) REFERENCES client_purchase_orders(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    )`);

    // Vendor Purchase Orders
    db.run(`CREATE TABLE IF NOT EXISTS vendor_purchase_orders (
      id TEXT PRIMARY KEY,
      vendor_id TEXT,
      po_date TEXT,
      expected_delivery_date TEXT,
      status TEXT DEFAULT 'Pending',
      notes TEXT,
      currency TEXT DEFAULT 'INR',
      delivery_terms TEXT,
      payment_terms TEXT,
      FOREIGN KEY(vendor_id) REFERENCES vendors(id)
    )`);

    // Vendor PO Line Items
    db.run(`CREATE TABLE IF NOT EXISTS vendor_po_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id TEXT,
      material_type TEXT,
      item_type TEXT DEFAULT 'Raw Material',
      product_id TEXT,
      product_stage TEXT,
      quantity REAL,
      unit_price REAL,
      unit TEXT DEFAULT 'kg',
      description TEXT,
      FOREIGN KEY(po_id) REFERENCES vendor_purchase_orders(id)
    )`);

    // Shipments table
    db.run(`CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      po_id TEXT,
      shipment_date TEXT,
      expected_arrival_date TEXT,
      actual_arrival_date TEXT,
      status TEXT DEFAULT 'In Transit',
      tracking_number TEXT,
      notes TEXT,
      FOREIGN KEY(po_id) REFERENCES client_purchase_orders(id)
    )`, callback);
  });
}

// Insert dummy data
function insertDummyData() {
  db.serialize(() => {
    console.log('\n📦 Populating test data...\n');

    // Insert Vendors
    console.log('Adding vendors...');
    const vendors = [
      ['V001', 'ABC Steel Industries', 'Rajesh Kumar', '+91-79-2345-6789', 'rajesh@abcsteel.com', 'Plot 45, Industrial Area Phase 1, Ahmedabad', 'Steel', 'Steel', 'Ahmedabad', 'India'],
      ['V002', 'Copper Anode Suppliers Ltd', 'Priya Sharma', '+91-11-9876-5432', 'priya@copperanode.in', '234 Factory Road, Sector 18, Delhi', 'Copper', 'Copper Anode', 'Delhi', 'India'],
      ['V003', 'Mumbai Metal Works', 'Amit Patel', '+91-22-5555-1234', 'amit@mumbaimetals.com', '67 MIDC Area, Andheri East, Mumbai', 'Steel', 'Steel', 'Mumbai', 'India'],
      ['V004', 'Bengal Coating Services', 'Subhash Ghosh', '+91-33-4444-7890', 'subhash@bengalcoating.co.in', '123 Industrial Estate, Salt Lake, Kolkata', 'Job Work', 'Electroplating', 'Kolkata', 'India'],
      ['V005', 'Chennai Copper Traders', 'Lakshmi Iyer', '+91-44-3333-4567', 'lakshmi@chennaicopper.com', '89 Anna Nagar Industrial Zone, Chennai', 'Copper', 'Copper Anode', 'Chennai', 'India']
    ];

    vendors.forEach(v => {
      db.run('INSERT INTO vendors VALUES (?,?,?,?,?,?,?,?,?,?)', v);
    });
    console.log(`✓ Added ${vendors.length} vendors`);

    // Insert Customers
    console.log('Adding customers...');
    const customers = [
      ['C001', 'Global Infrastructure Ltd', '123 Business District Tower A, Bangalore', 'Mohammed Ali', '+91-80-1111-2222', 'ali@globalinfra.com', '123 Business District Tower A, Bangalore', 'Warehouse Complex B, Whitefield, Bangalore', 'Bangalore', 'India'],
      ['C002', 'National Power Grid Corp', '456 Nehru Place, New Delhi', 'Sunita Verma', '+91-11-3333-4444', 'sunita@nationalpowergrid.in', '456 Nehru Place, New Delhi', 'Storage Facility, Okhla Phase 2, Delhi', 'Delhi', 'India'],
      ['C003', 'Mumbai Metro Construction', '789 BKC Complex, Mumbai', 'Vikram Singh', '+91-22-6666-7777', 'vikram@mumbaimetro.com', '789 BKC Complex, Mumbai', 'Site Office, Goregaon, Mumbai', 'Mumbai', 'India'],
      ['C004', 'Eastern Railway Projects', '321 Park Street, Kolkata', 'Arijit Banerjee', '+91-33-8888-9999', 'arijit@easternrailway.gov.in', '321 Park Street, Kolkata', 'Depot, Dankuni, Kolkata', 'Kolkata', 'India'],
      ['C005', 'Southern Power Utilities', '654 Mount Road, Chennai', 'Deepa Krishnan', '+91-44-5555-6666', 'deepa@southernpower.co.in', '654 Mount Road, Chennai', 'Warehouse, Ambattur Industrial Estate, Chennai', 'Chennai', 'India']
    ];

    customers.forEach(c => {
      db.run('INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?)', c);
    });
    console.log(`✓ Added ${customers.length} customers`);

    // Insert Products with BOMs
    console.log('Adding products with auto-calculated BOMs...');
    const products = [
      ['CE1034', '14.2mm x 3000mm Copper Bonded Ground Rod', 14.2, 250, 3000, 4.75, 450, '8538.90', 'Copper Bonded Earthing Electrode 14.2mm Dia x 3m Length'],
      ['CE1535', '17.2mm x 3000mm Copper Bonded Ground Rod', 17.2, 300, 3000, 6.85, 650, '8538.90', 'Copper Bonded Earthing Electrode 17.2mm Dia x 3m Length'],
      ['CE2036', '20.0mm x 3000mm Copper Bonded Ground Rod', 20.0, 350, 3000, 9.42, 850, '8538.90', 'Copper Bonded Earthing Electrode 20mm Dia x 3m Length'],
      ['CE1424', '14.2mm x 2400mm Copper Bonded Ground Rod', 14.2, 250, 2400, 3.80, 380, '8538.90', 'Copper Bonded Earthing Electrode 14.2mm Dia x 2.4m Length'],
      ['CE1718', '17.2mm x 1800mm Copper Bonded Ground Rod', 17.2, 300, 1800, 4.11, 420, '8538.90', 'Copper Bonded Earthing Electrode 17.2mm Dia x 1.8m Length'],
      ['CE2030', '20.0mm x 3000mm Heavy Duty Ground Rod', 20.0, 400, 3000, 9.58, 900, '8538.90', 'Heavy Duty Copper Bonded Earthing Electrode 20mm Dia x 3m']
    ];

    products.forEach(p => {
      db.run('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?)', p);

      // Calculate BOM
      const [id, desc, steelDia, copperCoating, length] = p;
      const steelRadiusMM = steelDia / 2;
      const steelVolumeMM3 = Math.PI * steelRadiusMM * steelRadiusMM * length;
      const steelWeightKg = (steelVolumeMM3 * 7.85) / 1000000;

      const outerRadiusMM = steelDia / 2 + copperCoating / 1000;
      const copperVolumeMM3 = Math.PI * (outerRadiusMM * outerRadiusMM - steelRadiusMM * steelRadiusMM) * length;
      const copperWeightKg = (copperVolumeMM3 * 8.96) / 1000000;

      db.run('INSERT INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?)', [id, 'Steel', steelWeightKg]);
      db.run('INSERT INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?)', [id, 'Copper Anode', copperWeightKg]);
    });
    console.log(`✓ Added ${products.length} products with BOMs`);

    // Insert Raw Materials Inventory
    console.log('Adding raw materials inventory...');
    db.run("INSERT INTO raw_materials_inventory (material, current_stock, committed_stock, unit) VALUES ('Steel', 15000, 2500, 'kg')");
    db.run("INSERT INTO raw_materials_inventory (material, current_stock, committed_stock, unit) VALUES ('Copper Anode', 5000, 800, 'kg')");
    db.run("INSERT INTO raw_materials_inventory (material, current_stock, committed_stock, unit) VALUES ('Flux', 500, 50, 'kg')");
    db.run("INSERT INTO raw_materials_inventory (material, current_stock, committed_stock, unit) VALUES ('Packaging Material', 2000, 200, 'units')");
    console.log('✓ Added raw materials inventory');

    // Insert Inventory for Products
    console.log('Adding product inventory...');
    const inventory = [
      ['CE1034', 150, 120, 100, 95, 80],
      ['CE1535', 200, 180, 150, 140, 120],
      ['CE2036', 100, 85, 70, 65, 55],
      ['CE1424', 180, 160, 140, 130, 110],
      ['CE1718', 90, 75, 60, 55, 45],
      ['CE2030', 120, 100, 85, 80, 70]
    ];

    inventory.forEach(inv => {
      db.run('INSERT INTO inventory (product_id, steel_rods, plated, quality_checked, stamped, packaged, updated_at) VALUES (?,?,?,?,?,?,?)',
        [...inv, new Date().toISOString()]);
    });
    console.log(`✓ Added inventory for ${inventory.length} products`);

    // Insert Vendor Purchase Orders
    console.log('Adding vendor purchase orders...');
    const vendorPOs = [
      ['VPO-2025-001', 'V001', '2025-01-05', '2025-01-20', 'Completed', 'Bulk steel order for Q1 production', 'INR', 'Ex-Works', 'Net 30'],
      ['VPO-2025-002', 'V002', '2025-01-10', '2025-01-25', 'Pending', 'Copper anode replenishment', 'INR', 'FOB', 'Net 45'],
      ['VPO-2025-003', 'V003', '2025-01-15', '2025-02-01', 'In Transit', 'Additional steel rods', 'INR', 'CIF', 'Net 30']
    ];

    vendorPOs.forEach(vpo => {
      db.run('INSERT INTO vendor_purchase_orders VALUES (?,?,?,?,?,?,?,?,?)', vpo);
    });
    console.log(`✓ Added ${vendorPOs.length} vendor purchase orders`);

    // Insert Vendor PO Line Items
    console.log('Adding vendor PO line items...');
    db.run("INSERT INTO vendor_po_line_items (po_id, material_type, item_type, quantity, unit_price, unit, description) VALUES ('VPO-2025-001', 'Steel', 'Raw Material', 5000, 85, 'kg', 'MS Steel Rods 14.2mm')");
    db.run("INSERT INTO vendor_po_line_items (po_id, material_type, item_type, quantity, unit_price, unit, description) VALUES ('VPO-2025-001', 'Steel', 'Raw Material', 3000, 88, 'kg', 'MS Steel Rods 17.2mm')");
    db.run("INSERT INTO vendor_po_line_items (po_id, material_type, item_type, quantity, unit_price, unit, description) VALUES ('VPO-2025-002', 'Copper Anode', 'Raw Material', 2000, 750, 'kg', 'Copper Anode 99.9% purity')");
    db.run("INSERT INTO vendor_po_line_items (po_id, material_type, item_type, quantity, unit_price, unit, description) VALUES ('VPO-2025-003', 'Steel', 'Raw Material', 4000, 87, 'kg', 'MS Steel Rods 20mm')");
    console.log('✓ Added vendor PO line items');

    // Insert Client Purchase Orders
    console.log('Adding client purchase orders...');
    const clientPOs = [
      ['CPO-2025-001', 'C001', '2025-01-08', '2025-02-15', 'In Production', 'Ground rods for infrastructure project', 'INR'],
      ['CPO-2025-002', 'C002', '2025-01-12', '2025-02-28', 'Confirmed', 'National grid expansion - Phase 3', 'INR'],
      ['CPO-2025-003', 'C003', '2025-01-18', '2025-03-10', 'Pending', 'Mumbai Metro Line 7 earthing system', 'INR'],
      ['CPO-2025-004', 'C004', '2025-01-20', '2025-02-20', 'In Production', 'Railway electrification project', 'INR'],
      ['CPO-2025-005', 'C005', '2025-01-22', '2025-03-05', 'Confirmed', 'Substation grounding system', 'INR']
    ];

    clientPOs.forEach(cpo => {
      db.run('INSERT INTO client_purchase_orders VALUES (?,?,?,?,?,?,?)', cpo);
    });
    console.log(`✓ Added ${clientPOs.length} client purchase orders`);

    // Insert Client PO Line Items
    console.log('Adding client PO line items...');
    const clientPOItems = [
      ['CPO-2025-001', 'CE1034', 500, 650],
      ['CPO-2025-001', 'CE1535', 300, 950],
      ['CPO-2025-002', 'CE2036', 400, 1250],
      ['CPO-2025-002', 'CE1535', 600, 950],
      ['CPO-2025-003', 'CE2036', 800, 1250],
      ['CPO-2025-003', 'CE2030', 200, 1350],
      ['CPO-2025-004', 'CE1424', 1000, 550],
      ['CPO-2025-004', 'CE1718', 500, 600],
      ['CPO-2025-005', 'CE2036', 300, 1250],
      ['CPO-2025-005', 'CE1535', 400, 950]
    ];

    clientPOItems.forEach(item => {
      db.run('INSERT INTO client_po_line_items (po_id, product_id, quantity, unit_price) VALUES (?,?,?,?)', item);
    });
    console.log(`✓ Added ${clientPOItems.length} client PO line items`);

    // Insert Shipments
    console.log('Adding shipments...');
    const shipments = [
      ['SHIP-2025-001', 'CPO-2025-001', '2025-02-10', '2025-02-15', null, 'In Transit', 'TRK-2025-001234', 'Partial shipment - 60% of order'],
      ['SHIP-2025-002', 'CPO-2025-004', '2025-02-15', '2025-02-20', null, 'Preparing', 'TRK-2025-001235', 'Full order ready for dispatch']
    ];

    shipments.forEach(ship => {
      db.run('INSERT INTO shipments VALUES (?,?,?,?,?,?,?,?)', ship);
    });
    console.log(`✓ Added ${shipments.length} shipments`);

    console.log('\n✅ Test database setup complete!\n');
    console.log('📍 Database location:', TEST_DB_PATH);
    console.log('\n🔄 To use this test database:');
    console.log('   Windows: set DB_PATH=groundrod-test.db && npm start');
    console.log('   Linux/Mac: DB_PATH=groundrod-test.db npm start');
    console.log('\n🔙 To switch back to main database:');
    console.log('   Just run: npm start (without DB_PATH)\n');

    db.close();
  });
}

// Run the setup
initSchema(() => {
  insertDummyData();
});
