const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Respond to preflight requests for all routes (useful when frontend is on a different port)
app.options('*', cors());
app.use(bodyParser.json({ limit: '5mb' }));
app.use(express.static('public'));
// Serve uploaded PDFs statically as well
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Optional PDF import deps (guarded)
let multer = null; let pdfParse = null; let csvParse = null;
try { multer = require('multer'); } catch(_) {}
try { pdfParse = require('pdf-parse'); } catch(_) {}
try { csvParse = require('csv-parse/sync'); } catch(_) {}
const upload = multer ? multer({ storage: multer.memoryStorage() }) : null;

function normalizeDateInput(d){
  if (!d) return d;
  const str = String(d).trim().replace(/\//g,'-');
  const m = str.match(/^([0-3]\d)-([01]\d)-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return str;
}

function extractClientPOItems(text){
  if (!text) return [];
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const items = [];
  let headerSeen = false;
  for (const line of lines){
    const lower = line.toLowerCase();
    if (!headerSeen && lower.includes('qty') && (lower.includes('price') || lower.includes('rate'))){
      headerSeen = true;
      continue;
    }
    if (!headerSeen) continue;
    const parts = line.split(/\t|\s{2,}|,/).map(p=>p.trim()).filter(Boolean);
    if (parts.length < 4) continue;
    let unitPriceIndex = -1;
    let qtyIndex = -1;
    for (let i = parts.length - 1; i >= 0; i--){
      const value = parts[i].replace(/,/g,'');
      if (/^-?\d+(?:\.\d+)?$/.test(value)){
        if (unitPriceIndex === -1){
          unitPriceIndex = i;
        } else {
          qtyIndex = i;
          break;
        }
      }
    }
    if (qtyIndex === -1 || unitPriceIndex === -1) continue;
    const quantity = Number(parts[qtyIndex].replace(/,/g,''));
    const unit_price = Number(parts[unitPriceIndex].replace(/,/g,''));
    if (!Number.isFinite(quantity) || !Number.isFinite(unit_price)) continue;
    const product_id = parts[0];
    if (!product_id || product_id.length > 40) continue;
    const descriptionParts = parts.slice(1, qtyIndex);
    const description = descriptionParts.join(' ');
    items.push({
      product_id,
      description,
      quantity,
      unit_price,
      unit: 'pcs'
    });
    if (items.length >= 25) break;
  }
  return items;
}

function parseClientPOFromText(text){
  const po = {};
  const id = text.match(/PO\s*(?:ID|#|Number)?\s*[:\-]?\s*([A-Z0-9\-]+)/i);
  if (id) po.id = id[1];
  const cust = text.match(/Customer\s*(?:ID|:)?\s*([A-Z0-9\-]+)/i);
  if (cust) po.customer_id = cust[1];
  const cname = text.match(/Customer\s*Name\s*[:\-]?\s*([A-Za-z0-9 &\-]+)/i);
  if (cname) po.customer_name = cname[1];
  const poDateMatch = (text.match(/PO\s*Date\s*[:\-]?\s*([0-3]\d[-\/]\d{2}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/i) || [])[1];
  const dueDateMatch = (text.match(/Due\s*Date\s*[:\-]?\s*([0-3]\d[-\/]\d{2}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/i) || [])[1];
  if (poDateMatch) po.po_date = normalizeDateInput(poDateMatch);
  if (dueDateMatch) po.due_date = normalizeDateInput(dueDateMatch);
  return { po, items: extractClientPOItems(text) };
}

function extractVendorPOItems(text){
  if (!text) return [];
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const items = [];
  let headerSeen = false;
  for (const line of lines){
    const lower = line.toLowerCase();
    if (!headerSeen && lower.includes('qty') && (lower.includes('unit') || lower.includes('rate') || lower.includes('price'))){
      headerSeen = true;
      continue;
    }
    if (!headerSeen) continue;
    const parts = line.split(/\t|\s{2,}|,/).map(p=>p.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    let qtyIndex = -1;
    for (let i = parts.length - 1; i >= 0; i--){
      const value = parts[i].replace(/,/g,'');
      if (/^-?\d+(?:\.\d+)?$/.test(value)){
        qtyIndex = i;
        break;
      }
    }
    if (qtyIndex === -1) continue;
    const qty = Number(parts[qtyIndex].replace(/,/g,'')); if (!Number.isFinite(qty)) continue;
    const itemCode = parts[0] || `ITEM-${items.length+1}`;
    const description = parts.slice(1, qtyIndex).join(' ');
    const unit = (qtyIndex + 1 < parts.length && parts[qtyIndex+1].length <= 6) ? parts[qtyIndex+1] : 'pcs';
    items.push({ item: itemCode, description, qty, unit });
    if (items.length >= 25) break;
  }
  return items;
}

async function ensureDir(p){
  try { await fsp.mkdir(p, { recursive:true }); } catch(_){}
}

function parseVendorPOFromText(text){
  const out = {};
  const id = text.match(/VPO\s*(?:ID|#|Number)?\s*[:\-]?\s*([A-Z0-9\-]+)/i) || text.match(/PO\s*(?:ID|#|Number)?\s*[:\-]?\s*([A-Z0-9\-]+)/i);
  if (id) out.id = id[1];
  const vendor = text.match(/Vendor\s*(?:ID|:)?\s*([A-Z0-9\-]+)/i);
  if (vendor) out.vendor_id = vendor[1];
  const vname = text.match(/Vendor\s*Name\s*[:\-]?\s*([A-Za-z0-9 &\-]+)/i);
  if (vname) out.vendor_name = vname[1];
  const poDateMatch = (text.match(/PO\s*Date\s*[:\-]?\s*([0-3]\d[-\/]\d{2}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/i) || [])[1];
  const dueDateMatch = (text.match(/Due\s*Date\s*[:\-]?\s*([0-3]\d[-\/]\d{2}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/i) || [])[1];
  if (poDateMatch) out.po_date = normalizeDateInput(poDateMatch);
  if (dueDateMatch) out.due_date = normalizeDateInput(dueDateMatch);
  return out;
}

async function handleClientPoPreview(req, res, allowParse){
  try{
    if (!req.file || !req.file.buffer) return res.status(400).json({ error:'No file uploaded' });
    const dir = path.join(__dirname,'uploads','client_po');
    await ensureDir(dir);
    const token = `clientpo_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
    const full = path.join(dir, token);
    await fsp.writeFile(full, req.file.buffer);
    let text = '';
    let warning = '';
    if (allowParse && pdfParse){
      try {
        const data = await pdfParse(req.file.buffer);
        text = (data && data.text) ? data.text : '';
        if (!text) warning = 'No text extracted from PDF; fill fields manually.';
      } catch(e){
        warning = 'Failed to extract text from PDF; fill fields manually.';
      }
    } else {
      warning = 'PDF text extraction unavailable; fill fields manually.';
    }
    const parsed = parseClientPOFromText(text || '');
    const response = { po: parsed.po, items: parsed.items, text: text || '', file_token: token };
    if (warning) response.warning = warning;
    res.json(response);
  }catch(e){
    res.status(500).json({ error: e.message || 'Preview failed' });
  }
}

async function handleVendorPoPreview(req, res, allowParse){
  try{
    if (!req.file || !req.file.buffer) return res.status(400).json({ error:'No file uploaded' });
    const dir = path.join(__dirname,'uploads','vendor_po');
    await ensureDir(dir);
    const token = `vendorpo_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
    const full = path.join(dir, token);
    await fsp.writeFile(full, req.file.buffer);
    let text = '';
    let warning = '';
    if (allowParse && pdfParse){
      try {
        const data = await pdfParse(req.file.buffer);
        text = (data && data.text) ? data.text : '';
        if (!text) warning = 'No text extracted from PDF; fill fields manually.';
      } catch(e){
        warning = 'Failed to extract text from PDF; fill fields manually.';
      }
    } else {
      warning = 'PDF text extraction unavailable; fill fields manually.';
    }
    const vpo = parseVendorPOFromText(text || '');
    const items = extractVendorPOItems(text || '');
    const response = { vpo, items, text: text || '', file_token: token };
    if (warning) response.warning = warning;
    res.json(response);
  }catch(e){
    res.status(500).json({ error: e.message || 'Preview failed' });
  }
}

// Use persistent disk on Render (/var/data) or local path for development
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : (fs.existsSync('/var/data')
      ? '/var/data/groundrod.db'
      : path.join(__dirname, 'groundrod.db'));

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('✅ Database connected');
    initializeDatabase();
  }
});

// Track products table schema (legacy columns present?)
const productsSchema = { hasDiameter: false, hasCoating: false, _ready: false };
function refreshProductsSchema(cb){
  db.all("PRAGMA table_info(products)", (err, cols) => {
    if (!err && Array.isArray(cols)){
      const names = cols.map(c=>c.name);
      productsSchema.hasDiameter = names.includes('diameter');
      productsSchema.hasCoating = names.includes('coating');
      productsSchema._ready = true;
    }
    cb && cb(productsSchema);
  });
}

// Audit logging helper function
function logAudit(tableName, recordId, action, oldValues = null, newValues = null, userId = 'system') {
  const oldValuesJson = oldValues ? JSON.stringify(oldValues) : null;
  const newValuesJson = newValues ? JSON.stringify(newValues) : null;
  db.run(
    `INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [tableName, recordId, action, oldValuesJson, newValuesJson, userId],
    (err) => {
      if (err) console.error('Audit log failed:', err.message);
    }
  );
}

// Helper function to commit/uncommit inventory
function updateInventoryCommitment(productId, quantityChange, callback) {
  db.run(
    `INSERT INTO inventory (product_id, committed)
     VALUES (?, ?)
     ON CONFLICT(product_id) DO UPDATE SET
       committed = MAX(0, committed + ?),
       updated_at = CURRENT_TIMESTAMP`,
    [productId, quantityChange, quantityChange],
    callback
  );
}

function initializeDatabase() {
  db.serialize(() => {
    // Customers table
    db.run(`CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      office_address TEXT,
      warehouse_address TEXT,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Vendors table (NEW)
    db.run(`CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      office_address TEXT,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      vendor_type TEXT DEFAULT 'Other',
      material_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Products table (UPDATED)
    db.run(`CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      steel_diameter REAL NOT NULL,
      copper_coating REAL NOT NULL,
      cbg_diameter REAL GENERATED ALWAYS AS (steel_diameter + (copper_coating * 2 / 1000)) STORED,
      length REAL NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migrate existing products table if it was created with legacy columns
    db.all("PRAGMA table_info(products)", (err, cols) => {
      if (err || !Array.isArray(cols)) return;
      const names = cols.map(c => c.name);
      const ensureColumn = (def) => {
        const name = def.split(/\s+/)[0];
        if (!names.includes(name)) {
          try { db.run(`ALTER TABLE products ADD COLUMN ${def}`); } catch(_){}
        }
      };
      ensureColumn('steel_diameter REAL');
      ensureColumn('copper_coating REAL');
      ensureColumn('length REAL');
      ensureColumn('active INTEGER DEFAULT 1');
      ensureColumn('created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
      ensureColumn('updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
      // Backfill from legacy columns if present
      if (names.includes('diameter')) {
        try { db.run('UPDATE products SET steel_diameter = COALESCE(steel_diameter, diameter) WHERE steel_diameter IS NULL'); } catch(_){}
      }
      if (names.includes('coating')) {
        try { db.run('UPDATE products SET copper_coating = COALESCE(copper_coating, coating) WHERE copper_coating IS NULL'); } catch(_){}
      }
      refreshProductsSchema();
    });

    // Client Purchase Orders table (RENAMED)
    db.run(`CREATE TABLE IF NOT EXISTS client_purchase_orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      po_date DATE NOT NULL,
      due_date DATE NOT NULL,
      currency TEXT DEFAULT 'INR',
      delivery_terms TEXT,
      payment_terms TEXT,
      advance_amount REAL DEFAULT 0,
      payment_days INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'Normal',
      status TEXT DEFAULT 'Pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )`);

    // Add marking column to client_purchase_orders if it does not exist
    db.run("ALTER TABLE client_purchase_orders ADD COLUMN marking TEXT", (err) => { /* ignore if already exists */ });
    // Add pdf_path column to client_purchase_orders if it does not exist
    db.run("ALTER TABLE client_purchase_orders ADD COLUMN pdf_path TEXT", (err) => { /* ignore if already exists */ });
    // Add currency column to client_po_line_items if it does not exist
    db.run("ALTER TABLE client_po_line_items ADD COLUMN currency TEXT DEFAULT 'INR'", (err) => { /* ignore if already exists */ });
    // Add due_date column to client_po_line_items if it does not exist
    db.run("ALTER TABLE client_po_line_items ADD COLUMN due_date TEXT", (err) => { /* ignore if already exists */ });

    // NEW: Payment tracking fields
    db.run("ALTER TABLE client_purchase_orders ADD COLUMN payment_status TEXT DEFAULT 'Pending'", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE client_purchase_orders ADD COLUMN total_amount REAL DEFAULT 0", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE client_purchase_orders ADD COLUMN amount_paid REAL DEFAULT 0", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE client_purchase_orders ADD COLUMN outstanding_amount REAL DEFAULT 0", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE client_purchase_orders ADD COLUMN invoice_number TEXT", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE client_purchase_orders ADD COLUMN invoice_date TEXT", (err) => { /* ignore if already exists */ });

    // NEW: Costing fields for line items
    db.run("ALTER TABLE client_po_line_items ADD COLUMN cost_price REAL DEFAULT 0", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE client_po_line_items ADD COLUMN profit_margin REAL DEFAULT 0", (err) => { /* ignore if already exists */ });

    // NEW: HS Code for products (export compliance)
    db.run("ALTER TABLE products ADD COLUMN hs_code TEXT", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE products ADD COLUMN export_description TEXT", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0", (err) => { /* ignore if already exists */ });

    // NEW: Add missing columns to vendors table (migrations for old databases)
    db.run("ALTER TABLE vendors ADD COLUMN office_address TEXT", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE vendors ADD COLUMN vendor_type TEXT DEFAULT 'Other'", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE vendors ADD COLUMN material_type TEXT", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE vendors ADD COLUMN city TEXT", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE vendors ADD COLUMN country TEXT", (err) => { /* ignore if already exists */ });

    // Add missing columns to vendor_purchase_orders table
    db.run("ALTER TABLE vendor_purchase_orders ADD COLUMN currency TEXT DEFAULT 'INR'", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE vendor_purchase_orders ADD COLUMN delivery_terms TEXT", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE vendor_purchase_orders ADD COLUMN payment_terms TEXT", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE vendor_purchase_orders ADD COLUMN status TEXT DEFAULT 'Pending'", (err) => { /* ignore if already exists */ });

    // Add columns to vendor_po_line_items for product purchasing
    db.run("ALTER TABLE vendor_po_line_items ADD COLUMN item_type TEXT DEFAULT 'Raw Material'", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE vendor_po_line_items ADD COLUMN product_id TEXT", (err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE vendor_po_line_items ADD COLUMN product_stage TEXT", (err) => { /* ignore if already exists */ });

    // Client PO Line Items
    db.run(`CREATE TABLE IF NOT EXISTS client_po_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      delivered INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (po_id) REFERENCES client_purchase_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`);

    // Uploads dir for PDF imports
    try { require('fs').mkdirSync(require('path').join(__dirname, 'uploads'), { recursive: true }); } catch {}

    // Vendor Purchase Orders table (NEW)
    db.run(`CREATE TABLE IF NOT EXISTS vendor_purchase_orders (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL,
      po_date DATE NOT NULL,
      due_date DATE NOT NULL,
      currency TEXT DEFAULT 'INR',
      delivery_terms TEXT,
      payment_terms TEXT,
      status TEXT DEFAULT 'Pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    )`);
    // Add pdf_path column to vendor_purchase_orders if it does not exist
    db.run("ALTER TABLE vendor_purchase_orders ADD COLUMN pdf_path TEXT", (err) => { /* ignore if exists */ });

    // Vendor PO Line Items (NEW)
    db.run(`CREATE TABLE IF NOT EXISTS vendor_po_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_id TEXT NOT NULL,
      material_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      description TEXT,
      unit TEXT,
      received REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (po_id) REFERENCES vendor_purchase_orders(id)
    )`);

    // Invoices table
    db.run(`CREATE TABLE IF NOT EXISTS invoices (
      invoice_number TEXT PRIMARY KEY,
      po_id TEXT NOT NULL,
      invoice_date DATE NOT NULL,
      due_date DATE,
      customer_name TEXT,
      customer_address TEXT,
      customer_gstin TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      amount_paid REAL DEFAULT 0,
      outstanding_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'Pending',
      currency TEXT DEFAULT 'INR',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (po_id) REFERENCES client_purchase_orders(id)
    )`);

    // Invoice Line Items
    db.run(`CREATE TABLE IF NOT EXISTS invoice_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL,
      product_id TEXT NOT NULL,
      description TEXT,
      hsn_code TEXT,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      tax_rate REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      line_total REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_number) REFERENCES invoices(invoice_number),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`);

    // Payment History table
    db.run(`CREATE TABLE IF NOT EXISTS payment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL,
      po_id TEXT,
      payment_date DATE NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT,
      reference_number TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_number) REFERENCES invoices(invoice_number),
      FOREIGN KEY (po_id) REFERENCES client_purchase_orders(id)
    )`);

    // Shipments table
    db.run(`CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      po_id TEXT NOT NULL,
      shipment_date DATE NOT NULL,
      container_number TEXT,
      bl_number TEXT,
      bl_date DATE,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (po_id) REFERENCES client_purchase_orders(id)
    )`);

    // Shipment Items table
    db.run(`CREATE TABLE IF NOT EXISTS shipment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shipment_id) REFERENCES shipments(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`);

    // Inventory table
    db.run(`CREATE TABLE IF NOT EXISTS inventory (
      product_id TEXT PRIMARY KEY,
      cores INTEGER DEFAULT 0,
      plated INTEGER DEFAULT 0,
      machined INTEGER DEFAULT 0,
      qc INTEGER DEFAULT 0,
      stamped INTEGER DEFAULT 0,
      packed INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`);

    // Lightweight migration: ensure inventory.cores and steel_rods exist
    db.all("PRAGMA table_info(inventory)", (err, cols) => {
      if (!err && Array.isArray(cols)){
        const n = cols.map(c=>c.name);
        if (!n.includes('cores')){
          try { db.run("ALTER TABLE inventory ADD COLUMN cores INTEGER DEFAULT 0"); } catch(_){ }
        }
        if (!n.includes('steel_rods')){
          try { db.run("ALTER TABLE inventory ADD COLUMN steel_rods INTEGER DEFAULT 0"); } catch(_){ }
        }
      }
    });

    // Job Work tables (cores flow)
    db.run(`CREATE TABLE IF NOT EXISTS job_work_orders (
      id TEXT PRIMARY KEY,
      vendor_id TEXT,
      jw_date DATE NOT NULL,
      due_date DATE,
      job_type TEXT DEFAULT 'Rod Making',
      status TEXT DEFAULT 'Open',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Add job_type column if it doesn't exist
    db.run("ALTER TABLE job_work_orders ADD COLUMN job_type TEXT DEFAULT 'Rod Making'", (err) => { /* ignore if already exists */ });
    db.run(`CREATE TABLE IF NOT EXISTS job_work_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      qty INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES job_work_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS job_work_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      qty INTEGER NOT NULL,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      FOREIGN KEY (order_id) REFERENCES job_work_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`);

    // Production History table
    db.run(`CREATE TABLE IF NOT EXISTS production_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_date DATE NOT NULL,
      product_id TEXT NOT NULL,
      plated INTEGER DEFAULT 0,
      machined INTEGER DEFAULT 0,
      qc INTEGER DEFAULT 0,
      stamped INTEGER DEFAULT 0,
      packed INTEGER DEFAULT 0,
      rejected INTEGER DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`);

    // Raw Materials Inventory table (UPDATED)
    db.run(`CREATE TABLE IF NOT EXISTS raw_materials_inventory (
      material TEXT PRIMARY KEY,
      current_stock REAL DEFAULT 0,
      reorder_level REAL DEFAULT 0,
      committed_stock REAL DEFAULT 0,
      available_stock REAL GENERATED ALWAYS AS (current_stock - committed_stock) STORED,
      last_purchase_date DATE,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Bill of Materials (consumption per finished unit)
    db.run(`CREATE TABLE IF NOT EXISTS bom (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      material TEXT NOT NULL,
      qty_per_unit REAL NOT NULL,
      UNIQUE(product_id, material)
    )`);

    // Vendor PO receipts (for raw materials)
    db.run(`CREATE TABLE IF NOT EXISTS vendor_po_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vpo_id TEXT NOT NULL,
      material TEXT NOT NULL,
      qty REAL NOT NULL,
      unit TEXT DEFAULT 'kg',
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Company settings (single-row) for letterhead and PDFs
    db.run(`CREATE TABLE IF NOT EXISTS company_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      phone TEXT,
      website TEXT,
      cin TEXT,
      iso TEXT,
      gstin TEXT,
      registered_address TEXT,
      factory_address TEXT,
      logo_url TEXT DEFAULT 'assets/logo-nikkon.png',
      contacts_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Add missing columns for evolving schema
    db.all("PRAGMA table_info(company_settings)", (err, cols) => {
      if (!err && Array.isArray(cols)){
        const names = cols.map(c=>c.name);
        if (!names.includes('contacts_json')){
          try { db.run("ALTER TABLE company_settings ADD COLUMN contacts_json TEXT"); } catch(_){ }
        }
      }
    });
    db.get('SELECT COUNT(*) as count FROM company_settings', (err, row) => {
      if (!err && row && row.count === 0) {
        const defaultContacts = JSON.stringify([
          { name:'Pravin N Saraogi', title:'Managing Director and CEO', email:'pravinns@nikkonferro.com', phone:'+91 98308 14400' },
          { name:'Shivam Saraogi', title:'Director', email:'shiv@nikkonferro.com', phone:'+91 98300 09236 / +1 703 225 8625' }
        ]);
        db.run(`INSERT INTO company_settings (id, name, phone, website, cin, iso, gstin, registered_address, factory_address, logo_url, contacts_json) VALUES (1,?,?,?,?,?,?,?,?,?,?)`, [
          'NIKKON FERRO PRIVATE LIMITED',
          '+91-XXXXXXXXXX',
          'www.nikkonferro.com',
          '',
          '',
          '19AABCN4398J1ZX',
          '1 AJC Bose Road, 4th Floor, Nikkon Ferro Private Limited office, Kolkata 700020',
          'S-241, Sankrail Industrial Park, J. Dhulagori, Howrah - 711302, WB, India',
          'assets/nikkon-logo.png',
          defaultContacts
        ]);
      } else if (!err && row && row.count > 0) {
        // Backfill defaults if missing
        const defaultContacts = JSON.stringify([
          { name:'Pravin N Saraogi', title:'Managing Director and CEO', email:'pravinns@nikkonferro.com', phone:'+91 98308 14400' },
          { name:'Shivam Saraogi', title:'Director', email:'shiv@nikkonferro.com', phone:'+91 98300 09236 / +1 703 225 8625' }
        ]);
        db.run("UPDATE company_settings SET contacts_json = COALESCE(NULLIF(contacts_json,''), ?) WHERE id=1", [defaultContacts]);
        db.run("UPDATE company_settings SET logo_url = 'assets/nikkon-logo.png' WHERE id=1 AND (logo_url IS NULL OR logo_url = '' OR logo_url = 'assets/logo-nikkon.png')");
      }
    });

    // Audit Trail table for tracking all changes
    db.run(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      old_values TEXT,
      new_values TEXT,
      user_id TEXT DEFAULT 'system',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Document attachments table
    db.run(`CREATE TABLE IF NOT EXISTS document_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Enable foreign key constraints
    db.run("PRAGMA foreign_keys = ON");

    // Create indexes for performance
    db.run("CREATE INDEX IF NOT EXISTS idx_client_po_status ON client_purchase_orders(status)");
    db.run("CREATE INDEX IF NOT EXISTS idx_client_po_customer ON client_purchase_orders(customer_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_vendor_po_vendor ON vendor_purchase_orders(vendor_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_shipment_po ON shipments(po_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_audit_table_record ON audit_log(table_name, record_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_attachments_entity ON document_attachments(entity_type, entity_id)");

    console.log('✅ Database tables initialized');
    // Lightweight migrations for evolving schema - all wrapped in error handlers to prevent crashes
    db.all("PRAGMA table_info(customers)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('city')) db.run("ALTER TABLE customers ADD COLUMN city TEXT", ()=>{}); if(!n.includes('country')) db.run("ALTER TABLE customers ADD COLUMN country TEXT", ()=>{}); } });
    db.all("PRAGMA table_info(vendors)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('city')) db.run("ALTER TABLE vendors ADD COLUMN city TEXT", ()=>{}); if(!n.includes('country')) db.run("ALTER TABLE vendors ADD COLUMN country TEXT", ()=>{}); if(!n.includes('vendor_type')) db.run("ALTER TABLE vendors ADD COLUMN vendor_type TEXT DEFAULT 'Other'", ()=>{}); } });
    db.all("PRAGMA table_info(products)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('category')) db.run("ALTER TABLE products ADD COLUMN category TEXT", ()=>{}); if(!n.includes('product_type')) db.run("ALTER TABLE products ADD COLUMN product_type TEXT DEFAULT 'ground_rod'", ()=>{}); if(!n.includes('custom_bom')) db.run("ALTER TABLE products ADD COLUMN custom_bom INTEGER DEFAULT 0", ()=>{}); if(!n.includes('width')) db.run("ALTER TABLE products ADD COLUMN width REAL", ()=>{}); if(!n.includes('height')) db.run("ALTER TABLE products ADD COLUMN height REAL", ()=>{}); if(!n.includes('thickness')) db.run("ALTER TABLE products ADD COLUMN thickness REAL", ()=>{}); } });
    db.all("PRAGMA table_info(vendor_po_line_items)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('description')) db.run("ALTER TABLE vendor_po_line_items ADD COLUMN description TEXT", ()=>{}); if(!n.includes('unit')) db.run("ALTER TABLE vendor_po_line_items ADD COLUMN unit TEXT", ()=>{}); } });
    db.all("PRAGMA table_info(inventory)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('committed')) db.run("ALTER TABLE inventory ADD COLUMN committed INTEGER DEFAULT 0", ()=>{}); } });
    db.all("PRAGMA table_info(client_purchase_orders)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('is_deleted')) db.run("ALTER TABLE client_purchase_orders ADD COLUMN is_deleted INTEGER DEFAULT 0", ()=>{}); } });
    db.all("PRAGMA table_info(vendor_purchase_orders)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('is_deleted')) db.run("ALTER TABLE vendor_purchase_orders ADD COLUMN is_deleted INTEGER DEFAULT 0", ()=>{}); } });
    db.all("PRAGMA table_info(shipments)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('is_deleted')) db.run("ALTER TABLE shipments ADD COLUMN is_deleted INTEGER DEFAULT 0", ()=>{}); } });
    db.all("PRAGMA table_info(production_history)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('is_deleted')) db.run("ALTER TABLE production_history ADD COLUMN is_deleted INTEGER DEFAULT 0", ()=>{}); } });
    insertSampleData();
  });
}

// ============= Company Settings API =============
app.get('/api/company', (req, res) => {
  db.get('SELECT id, name, phone, website, cin, iso, gstin, registered_address, factory_address, logo_url, contacts_json, updated_at FROM company_settings WHERE id=1', (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.json({ id:1, name:'', phone:'', website:'', cin:'', iso:'', gstin:'', registered_address:'', factory_address:'', logo_url:'assets/nikkon-logo.png', contacts_json:'[]' });
    res.json(row);
  });
});
app.put('/api/company', (req, res) => {
  const { name, phone, website, cin, iso, gstin, registered_address, factory_address, logo_url, contacts_json } = req.body || {};
  const sql = `INSERT INTO company_settings (id, name, phone, website, cin, iso, gstin, registered_address, factory_address, logo_url, contacts_json, updated_at)
               VALUES (1,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name,
                 phone=excluded.phone,
                 website=excluded.website,
                 cin=excluded.cin,
                 iso=excluded.iso,
                 gstin=excluded.gstin,
                 registered_address=excluded.registered_address,
                 factory_address=excluded.factory_address,
                 logo_url=excluded.logo_url,
                 contacts_json=excluded.contacts_json,
                 updated_at=CURRENT_TIMESTAMP`;
  db.run(sql, [name||'', phone||'', website||'', cin||'', iso||'', gstin||'', registered_address||'', factory_address||'', logo_url||'assets/nikkon-logo.png', contacts_json||'[]'], function(err){
    if (err) return res.status(500).json({ error: 'DB error' });
    db.get('SELECT id, name, phone, website, cin, iso, gstin, registered_address, factory_address, logo_url, contacts_json, updated_at FROM company_settings WHERE id=1', (e, row) => {
      if (e) return res.status(500).json({ error: 'DB error' });
      res.json(row);
    });
  });
});

function insertSampleData() {
  db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
    if (row.count === 0) {
      // Sample customers
      const customers = [
        ['CUST001', 'Reliance Power Ltd', 'Mumbai Office Tower, Mumbai 400001', 'Warehouse Complex, Navi Mumbai 400701', 'Rajesh Kumar', '+91-22-12345678', 'rajesh@reliancepower.com'],
        ['CUST002', 'Tata Projects Ltd', 'Tata Centre, Nariman Point, Mumbai 400021', 'Industrial Area, Pune 411001', 'Priya Singh', '+91-20-98765432', 'priya.singh@tataprojects.com'],
        ['CUST003', 'L&T Construction', 'L&T House, Ballard Estate, Mumbai 400001', 'Godown No. 5, Thane 400601', 'Amit Patel', '+91-22-87654321', 'amit.patel@lnt.com']
      ];

      const custStmt = db.prepare("INSERT INTO customers (id, name, office_address, warehouse_address, contact_person, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?)");
      customers.forEach(c => custStmt.run(c));
      custStmt.finalize();

      // Sample vendors
      const vendors = [
        ['VEND001', 'ABC Copper Industries', 'Industrial Estate, Gujarat', 'Suresh Sharma', '+91-79-11223344', 'suresh@abccopper.com', 'Copper'],
        ['VEND002', 'Steel Suppliers India Pvt Ltd', 'Steel Complex, Jamshedpur', 'Ramesh Verma', '+91-657-9988776', 'ramesh@steelsuppliers.in', 'Steel']
      ];

      const vendStmt = db.prepare("INSERT INTO vendors (id, name, office_address, contact_person, phone, email, material_type) VALUES (?, ?, ?, ?, ?, ?, ?)");
      vendors.forEach(v => vendStmt.run(v));
      vendStmt.finalize();

      // Sample products (UPDATED with steel_diameter and copper_coating)
      const products = [
        ['P001', '1/2" x 5\' - 254 microns', 12.2, 254, 1524, 1],
        ['P002', '5/8" x 5\' - 254 microns', 13.7, 254, 1524, 1],
        ['P003', '5/8" x 8\' - 254 microns', 13.7, 254, 2438, 1],
        ['P004', '3/4" x 8\' - 254 microns', 16.7, 254, 2438, 1],
        ['P005', '1" x 8\' - 254 microns', 22.7, 254, 2438, 1]
      ];

      const prodStmt = db.prepare("INSERT INTO products (id, description, steel_diameter, copper_coating, length, active) VALUES (?, ?, ?, ?, ?, ?)");
      products.forEach(p => prodStmt.run(p));
      prodStmt.finalize();

      // Sample inventory
      const inventory = [
        ['P001', 150, 120, 100, 80, 500],
        ['P002', 200, 180, 150, 120, 800],
        ['P003', 100, 80, 60, 40, 300],
        ['P004', 180, 150, 120, 100, 450]
      ];

      const invStmt = db.prepare("INSERT INTO inventory (product_id, plated, machined, qc, stamped, packed) VALUES (?, ?, ?, ?, ?, ?)");
      inventory.forEach(inv => invStmt.run(inv));
      invStmt.finalize();

      // Raw materials - Initialize with 0 stock (user will set starting inventory)
      db.run("INSERT INTO raw_materials_inventory (material, current_stock, reorder_level, committed_stock) VALUES ('Steel', 0, 500, 0)");
      db.run("INSERT INTO raw_materials_inventory (material, current_stock, reorder_level, committed_stock) VALUES ('Copper Anode', 0, 100, 0)");

      console.log('✅ Sample data inserted');
    }
  });
}

// ============= CUSTOMER APIs =============

app.get('/api/customers', (req, res) => {
  db.all("SELECT * FROM customers ORDER BY name", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/customers', (req, res) => {
  const { id, name, office_address, warehouse_address, contact_person, phone, email, city=null, country=null } = req.body;
  
  db.run(
    "INSERT INTO customers (id, name, office_address, warehouse_address, contact_person, phone, email, city, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, name, office_address, warehouse_address, contact_person, phone, email, city, country],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ message: 'Customer added successfully' });
      }
    }
  );
});

app.put('/api/customers/:id', (req, res) => {
  const { id } = req.params;
  const { name, office_address, warehouse_address, contact_person, phone, email, city=null, country=null } = req.body;
  
  db.run(
    "UPDATE customers SET name=?, office_address=?, warehouse_address=?, contact_person=?, phone=?, email=?, city=?, country=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [name, office_address, warehouse_address, contact_person, phone, email, city, country, id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ message: 'Customer updated successfully' });
      }
    }
  );
});

app.delete('/api/customers/:id', (req, res) => {
  const { id } = req.params;
  
  db.run("DELETE FROM customers WHERE id=?", [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Customer deleted successfully' });
    }
  });
});

// ============= VENDOR APIs (NEW) =============

app.get('/api/vendors', (req, res) => {
  db.all("SELECT * FROM vendors ORDER BY name", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/vendors', (req, res) => {
  const { id, name, office_address, contact_person, phone, email, vendor_type='Other', material_type, city=null, country=null } = req.body;
  
  db.run(
    "INSERT INTO vendors (id, name, office_address, contact_person, phone, email, vendor_type, material_type, city, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, name, office_address, contact_person, phone, email, vendor_type, material_type, city, country],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ message: 'Vendor added successfully' });
      }
    }
  );
});

app.put('/api/vendors/:id', (req, res) => {
  const { id } = req.params;
  const { name, office_address, contact_person, phone, email, vendor_type='Other', material_type, city=null, country=null } = req.body;
  
  db.run(
    "UPDATE vendors SET name=?, office_address=?, contact_person=?, phone=?, email=?, vendor_type=?, material_type=?, city=?, country=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [name, office_address, contact_person, phone, email, vendor_type, material_type, city, country, id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ message: 'Vendor updated successfully' });
      }
    }
  );
});

app.delete('/api/vendors/:id', (req, res) => {
  const { id } = req.params;
  
  db.run("DELETE FROM vendors WHERE id=?", [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Vendor deleted successfully' });
    }
  });
});

// ============= PRODUCT APIs (UPDATED) =============

app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products ORDER BY id", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/products', (req, res) => {
  const id = (req.body.id||'').toString();
  const description = (req.body.description||'').toString();
  const steel_diameter = Number(req.body.steel_diameter ?? req.body.diameter);
  const copper_coating = Number(req.body.copper_coating ?? req.body.coating);
  const length = Number(req.body.length ?? req.body.length_mm);
  const width = Number(req.body.width || 0);
  const height = Number(req.body.height || 0);
  const thickness = Number(req.body.thickness || 0);
  const category = (req.body.category||'').toString() || null;
  const product_type = (req.body.product_type||'ground_rod').toString();
  const custom_bom = req.body.custom_bom ? 1 : 0;

  const runInsert = (schema)=>{
    const cols = ['id','description','steel_diameter','copper_coating','length','width','height','thickness','product_type','custom_bom'];
    const vals = [id, description, steel_diameter, copper_coating, length, width, height, thickness, product_type, custom_bom];
    if (category !== null){ cols.push('category'); vals.push(category); }
    if (schema.hasDiameter) { cols.push('diameter'); vals.push(steel_diameter); }
    if (schema.hasCoating) { cols.push('coating'); vals.push(copper_coating); }
    const sql = `INSERT INTO products (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;
    db.run(sql, vals, function(err){
      if (err) return res.status(500).json({ error: err.message });

      // Auto-generate BOM only if NOT using custom BOM
      if (!custom_bom) {
        if (product_type === 'ground_rod' && steel_diameter > 0 && length > 0) {
          // Cylindrical ground rod calculation
          const steelRadiusMM = steel_diameter / 2;
          const steelVolumeMM3 = Math.PI * steelRadiusMM * steelRadiusMM * length;
          const steelWeightKg = (steelVolumeMM3 * 7.85) / 1000000;

          const outerRadiusMM = steel_diameter / 2 + copper_coating / 1000;
          const copperVolumeMM3 = Math.PI * (outerRadiusMM * outerRadiusMM - steelRadiusMM * steelRadiusMM) * length;
          const copperWeightKg = (copperVolumeMM3 * 8.96) / 1000000;

          db.run(`INSERT OR REPLACE INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?)`, [id, 'Steel', steelWeightKg], ()=>{});
          db.run(`INSERT OR REPLACE INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?)`, [id, 'Copper Anode', copperWeightKg], ()=>{});
        } else if (product_type === 'clamp' && width > 0 && height > 0 && thickness > 0 && length > 0) {
          // Rectangular clamp calculation - steel bar volume
          const steelVolumeMM3 = width * height * thickness * length;
          const steelWeightKg = (steelVolumeMM3 * 7.85) / 1000000; // Steel density 7.85 g/cm³

          // Copper coating for rectangular surfaces
          // Total surface area = 2*(width*height + width*thickness + height*thickness) * length
          const surfaceAreaMM2 = 2 * (width * height + width * thickness + height * thickness) * length;
          const copperThicknessMM = copper_coating / 1000; // Convert µm to mm
          const copperVolumeMM3 = surfaceAreaMM2 * copperThicknessMM;
          const copperWeightKg = (copperVolumeMM3 * 8.96) / 1000000; // Copper density 8.96 g/cm³

          db.run(`INSERT OR REPLACE INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?)`, [id, 'Steel Bar', steelWeightKg], ()=>{});
          db.run(`INSERT OR REPLACE INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?)`, [id, 'Copper Anode', copperWeightKg], ()=>{});
        }
      }

      res.json({ message: 'Product added successfully' });
    });
  };
  if (productsSchema._ready) runInsert(productsSchema); else refreshProductsSchema(runInsert);
});

app.put('/api/products/:id', (req, res) => {
  const { id } = req.params;
  const description = (req.body.description||'').toString();
  const steel_diameter = Number(req.body.steel_diameter ?? req.body.diameter);
  const copper_coating = Number(req.body.copper_coating ?? req.body.coating);
  const length = Number(req.body.length ?? req.body.length_mm);
  const active = req.body.active ?? 1;
  const category = (req.body.category||'').toString() || null;
  
  const runUpdate = (schema)=>{
    const sets = ['description=?','steel_diameter=?','copper_coating=?','length=?','active=?'];
    const vals = [description, steel_diameter, copper_coating, length, active];
    if (category !== null){ sets.push('category=?'); vals.push(category); }
    sets.push('updated_at=CURRENT_TIMESTAMP');
    if (schema.hasDiameter) { sets.splice(sets.length-1, 0, 'diameter=?'); vals.splice(vals.length, 0, steel_diameter); }
    if (schema.hasCoating) { sets.splice(sets.length-1, 0, 'coating=?'); vals.splice(vals.length, 0, copper_coating); }
    const sql = `UPDATE products SET ${sets.join(', ')} WHERE id=?`;
    db.run(sql, [...vals, id], function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Product updated successfully' });
    });
  };
  if (productsSchema._ready) runUpdate(productsSchema); else refreshProductsSchema(runUpdate);
});

app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  
  db.run("DELETE FROM products WHERE id=?", [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ message: 'Product deleted successfully' });
    }
  });
});

// Rename product ID and cascade to referencing tables
app.post('/api/products/rename', (req, res) => {
  const oldId = (req.body?.old_id || '').toString().trim();
  const newId = (req.body?.new_id || '').toString().trim();
  if (!oldId || !newId) return res.status(400).json({ error: 'old_id and new_id required' });
  if (oldId === newId) return res.json({ message: 'No change' });

  db.get('SELECT id FROM products WHERE id=?', [oldId], (e, rowOld) => {
    if (e) return res.status(500).json({ error: e.message });
    if (!rowOld) return res.status(404).json({ error: 'Old product not found' });
    db.get('SELECT id FROM products WHERE id=?', [newId], (e2, rowNew) => {
      if (e2) return res.status(500).json({ error: e2.message });
      if (rowNew) return res.status(409).json({ error: 'New product ID already exists' });

      db.serialize(() => {
        db.run('BEGIN');
        const fail = (err) => { try { db.run('ROLLBACK'); } catch(_){}; res.status(500).json({ error: err.message || String(err) }); };
        db.run('UPDATE inventory SET product_id=? WHERE product_id=?', [newId, oldId], (e3) => {
          if (e3) return fail(e3);
          db.run('UPDATE client_po_line_items SET product_id=? WHERE product_id=?', [newId, oldId], (e4) => {
            if (e4) return fail(e4);
            db.run('UPDATE production_history SET product_id=? WHERE product_id=?', [newId, oldId], (e5) => {
              if (e5) return fail(e5);
              db.run('UPDATE shipment_items SET product_id=? WHERE product_id=?', [newId, oldId], (e6) => {
                if (e6) return fail(e6);
                db.run('UPDATE products SET id=? WHERE id=?', [newId, oldId], (e7) => {
                  if (e7) return fail(e7);
                  db.run('COMMIT', (cerr) => {
                    if (cerr) return res.status(500).json({ error: cerr.message });
                    res.json({ message: 'Product ID updated', old_id: oldId, new_id: newId });
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

// Auto-categorize and normalize product descriptions
app.post('/api/products/normalize', (req, res) => {
  function inchFraction(valInch){
    const frac = [0,1/8,1/4,3/8,1/2,5/8,3/4,7/8,1];
    const labels = ['0','1/8','1/4','3/8','1/2','5/8','3/4','7/8','1'];
    const x = Math.max(0, Math.min(1, valInch - Math.floor(valInch)));
    let idx=0, best=1e9; for(let i=0;i<frac.length;i++){ const d=Math.abs(x-frac[i]); if(d<best){best=d; idx=i;} }
    const whole = Math.floor(valInch) + (labels[idx]==='1'?1:0);
    const fracLabel = labels[idx]==='1'?'0':labels[idx];
    return fracLabel==='0' ? `${whole}` : `${whole ? whole+' ' : ''}${fracLabel}`.trim();
  }
  db.all(`SELECT id, steel_diameter, copper_coating, length, description FROM products`, (err, rows)=>{
    if (err) return res.status(500).json({ error: err.message });
    db.serialize(()=>{
      db.run('BEGIN');
      const stmt = db.prepare(`UPDATE products SET description=?, category=? WHERE id=?`);
      rows.forEach(r => {
        const inch = Number(r.steel_diameter||0)/25.4;
        const lenFt = Number(r.length||0)/304.8;
        const diaLabel = inchFraction(inch).replace(/^0\s?/, '');
        const lenLabel = Math.round(lenFt).toString();
        const coat = Math.round(Number(r.copper_coating||0));
        const desc = `${diaLabel}\" x ${lenLabel}\' - ${coat} microns`;
        let cat = 'Plain CBG';
        const d = (r.description||'').toLowerCase();
        if (d.includes('thread')) cat = 'Threaded CBG';
        if (d.includes('ul')) cat = 'UL Rods';
        if (d.includes('non ul') || d.includes('non-ul')) cat = 'Non UL Rods';
        stmt.run([desc, cat, r.id]);
      });
      stmt.finalize((e)=>{
        if (e) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error: e.message }); }
        db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message: 'Products normalized' }); });
      });
    });
  });
});

// Bulk delete products by IDs (used by Products tab multi-select delete)
app.post('/api/products/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No product IDs provided' });
  const placeholders = ids.map(()=>'?' ).join(',');
  db.run(`DELETE FROM products WHERE id IN (${placeholders})`, ids, function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Products deleted', deleted: this.changes || 0 });
  });
});

// Bulk import/upsert products from JSON (for CSV uploads from UI)
app.post('/api/products/bulk', (req, res) => {
  const { products = [], mode = 'upsert' } = req.body || {};
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'No products provided' });
  }

  // Normalize and validate rows
  const rows = [];
  for (const p of products) {
    const id = (p.id || '').toString().trim();
    const description = (p.description || '').toString().trim();
    // Accept multiple possible field names from client-side mappers
    const steel_diameter = Number(
      p.steel_diameter ?? p.diameter ?? p.steelDiameter ?? p.steeldia ?? p.steeldiam ?? ''
    );
    const copper_coating = Number(
      p.copper_coating ?? p.coating ?? p.copperCoating ?? p.cucoating ?? ''
    );
    const length = Number(p.length ?? p.length_mm ?? p.len ?? '');
    if (!id || !description || !isFinite(steel_diameter) || !isFinite(copper_coating) || !isFinite(length)) {
      return res.status(400).json({ error: `Invalid product row for id '${id || '(missing)'}'` });
    }
    rows.push({ id, description, steel_diameter, copper_coating, length });
  }

  db.serialize(() => {
    db.run('BEGIN');
    const fail = (err) => {
      try { db.run('ROLLBACK'); } catch {}
      res.status(500).json({ error: err.message || String(err) });
    };

    const finishCommit = (inserted, updated) => {
      db.run('COMMIT', (cerr) => {
        if (cerr) return res.status(500).json({ error: cerr.message });
        res.json({ message: 'Import completed', inserted, updated });
      });
    };

    const doWork = () => {
      let inserted = 0, updated = 0;
      const cols = ['id','description','steel_diameter','copper_coating','length','active'];
      if (productsSchema.hasDiameter) cols.splice(cols.length-1, 0, 'diameter');
      if (productsSchema.hasCoating) cols.splice(cols.length-1, 0, 'coating');
      const placeholders = cols.map(()=>'?').join(',');
      const updates = [
        'description=excluded.description',
        'steel_diameter=excluded.steel_diameter',
        'copper_coating=excluded.copper_coating',
        'length=excluded.length',
        (productsSchema.hasDiameter ? 'diameter=excluded.diameter' : null),
        (productsSchema.hasCoating ? 'coating=excluded.coating' : null),
        'updated_at=CURRENT_TIMESTAMP'
      ].filter(Boolean).join(', ');
      const sql = `INSERT INTO products (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`;
      const stmt = db.prepare(sql);
      let remaining = rows.length;
      for (const r of rows) {
        const vals = [r.id, r.description, r.steel_diameter, r.copper_coating, r.length];
        if (productsSchema.hasDiameter) vals.push(r.steel_diameter);
        if (productsSchema.hasCoating) vals.push(r.copper_coating);
        vals.push(1);
        stmt.run(vals, function(err){
          if (err) return fail(err);
          // sqlite3 does not expose upsert result directly; approximate via changes
          // If this was an insert, lastID is set on first insert, but not reliable for upserts across runs.
          // Instead, we can detect if row existed by querying prior, but that’s heavy. We'll approximate:
          // When a conflict occurs, changes() is 1 for update; for insert also 1.
          // Track inserted vs updated by checking if this.changes === 1 and row existed previously is unknown.
          // We’ll Count all as inserted+updated; but better: try an UPDATE first then INSERT if not changed.
          // For simplicity we’ll increment inserted+updated together and return total processed.
          // To provide a stable API, we’ll only return total processed as 'inserted'.
          remaining -= 1;
          if (remaining === 0) {
            stmt.finalize((ferr)=>{ if (ferr) return fail(ferr); finishCommit(rows.length, 0); });
          }
        });
      }
    };

    if (mode === 'replace') {
      db.run('DELETE FROM products', (derr) => {
        if (derr) return fail(derr);
        doWork();
      });
    } else {
      doWork();
    }
  });
});

// ============= CLIENT PURCHASE ORDER APIs =============

app.get('/api/client-purchase-orders', (req, res) => {
  const { include_deleted = 'false' } = req.query;
  const whereClause = include_deleted === 'true' ? '' : 'WHERE po.is_deleted = 0';

  db.all(`
    SELECT po.*, c.name as customer_name, c.email as customer_email
    FROM client_purchase_orders po
    LEFT JOIN customers c ON po.customer_id = c.id
    ${whereClause}
    ORDER BY po.po_date DESC
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/client-purchase-orders/:id', (req, res) => {
  const { id } = req.params;
  
  db.get(`
    SELECT po.*, c.* 
    FROM client_purchase_orders po
    LEFT JOIN customers c ON po.customer_id = c.id
    WHERE po.id = ?
  `, [id], (err, po) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (!po) {
      res.status(404).json({ error: 'PO not found' });
    } else {
      db.all(`
        SELECT li.*, p.description as product_description
        FROM client_po_line_items li
        LEFT JOIN products p ON li.product_id = p.id
        WHERE li.po_id = ?
      `, [id], (err, items) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          res.json({ ...po, line_items: items });
        }
      });
    }
  });
});

app.post('/api/client-purchase-orders', (req, res) => {
  const { id, customer_id, po_date, due_date, currency, delivery_terms, payment_terms, advance_amount, payment_days, priority, notes, line_items } = req.body;
  
  db.run(
    `INSERT INTO client_purchase_orders (id, customer_id, po_date, due_date, currency, delivery_terms, payment_terms, advance_amount, payment_days, priority, notes) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, customer_id, po_date, due_date, currency || 'INR', delivery_terms, payment_terms, advance_amount || 0, payment_days || 0, priority || 'Normal', notes],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        const stmt = db.prepare("INSERT INTO client_po_line_items (po_id, product_id, quantity, unit_price, line_total, currency) VALUES (?, ?, ?, ?, ?, ?)");
        line_items.forEach(item => {
          stmt.run([id, item.product_id, item.quantity, item.unit_price, item.quantity * item.unit_price, item.currency || 'INR']);
        });
        stmt.finalize((err) => {
          if (err) {
            res.status(500).json({ error: err.message });
          } else {
            res.json({ message: 'Client purchase order added successfully' });
          }
        });
      }
    }
  );
});

// Client PO line items CRUD
app.get('/api/client-purchase-orders/:id/items', (req, res) => {
  const { id } = req.params;
  db.all(`SELECT li.*, p.description as product_description FROM client_po_line_items li LEFT JOIN products p ON li.product_id = p.id WHERE li.po_id = ? ORDER BY li.id`, [id], (err, rows)=>{
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/client-purchase-orders/:id/items', (req, res) => {
  const { id } = req.params; const { product_id, quantity=0, unit_price=0, currency='INR' } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id required' });
  const qty = Number(quantity||0); const up = Number(unit_price||0);
  db.run(`INSERT INTO client_po_line_items (po_id, product_id, quantity, unit_price, line_total, delivered, currency) VALUES (?, ?, ?, ?, ?, 0, ?)`, [id, product_id, qty, up, qty*up, currency], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Item added', id: this.lastID });
  });
});

app.put('/api/client-purchase-orders/:id/items/:itemId', (req, res) => {
  const { id, itemId } = req.params; const { product_id, quantity, unit_price } = req.body;
  db.get(`SELECT delivered FROM client_po_line_items WHERE id=? AND po_id=?`, [itemId, id], (e, row)=>{
    if (e) return res.status(500).json({ error: e.message });
    if (!row) return res.status(404).json({ error: 'Item not found' });
    const qty = Number(quantity||0); if (qty < (row.delivered||0)) return res.status(400).json({ error: 'Quantity cannot be less than delivered' });
    const up = Number(unit_price||0);
    db.run(`UPDATE client_po_line_items SET product_id=?, quantity=?, unit_price=?, line_total=? WHERE id=? AND po_id=?`, [product_id, qty, up, qty*up, itemId, id], function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Item updated' });
    });
  });
});

app.delete('/api/client-purchase-orders/:id/items/:itemId', (req, res) => {
  const { id, itemId } = req.params;
  db.get(`SELECT delivered FROM client_po_line_items WHERE id=? AND po_id=?`, [itemId, id], (e,row)=>{
    if (e) return res.status(500).json({ error: e.message });
    if (!row) return res.status(404).json({ error: 'Item not found' });
    if ((row.delivered||0) > 0) return res.status(400).json({ error: 'Cannot delete item with delivered quantity' });
    db.run(`DELETE FROM client_po_line_items WHERE id=? AND po_id=?`, [itemId, id], function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Item deleted' });
    });
  });
});

// Update delivered quantity for a line item
app.put('/api/client-po-line-items/:itemId/delivered', (req, res) => {
  const { itemId } = req.params;
  const { delivered } = req.body;

  db.get(`SELECT quantity FROM client_po_line_items WHERE id=?`, [itemId], (e, row) => {
    if (e) return res.status(500).json({ error: e.message });
    if (!row) return res.status(404).json({ error: 'Item not found' });

    const deliveredQty = Number(delivered || 0);
    const totalQty = Number(row.quantity || 0);

    if (deliveredQty < 0) return res.status(400).json({ error: 'Delivered quantity cannot be negative' });
    if (deliveredQty > totalQty) return res.status(400).json({ error: 'Delivered quantity cannot exceed ordered quantity' });

    db.run(`UPDATE client_po_line_items SET delivered=? WHERE id=?`, [deliveredQty, itemId], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Delivered quantity updated', delivered: deliveredQty });
    });
  });
});

// Aliases for Client PO used by UI (/api/purchase-orders)
app.post('/api/purchase-orders', (req, res) => {
  let { id, customer_id, po_date, due_date, currency = 'INR', delivery_terms, payment_terms, advance_amount = 0, payment_days = 0, priority = 'Normal', status = 'Pending', notes = '', line_items = [] } = req.body;
  const norm = (s)=>{ if(!s) return s; const m=String(s).replace(/\//g,'-').match(/^([0-3]\d)-([01]\d)-(\d{4})$/); return m? `${m[3]}-${m[2]}-${m[1]}` : s; };
  po_date = norm(po_date); due_date = norm(due_date);

  db.serialize(() => {
    db.run('BEGIN');
    db.run(
      `INSERT INTO client_purchase_orders (id, customer_id, po_date, due_date, currency, delivery_terms, payment_terms, advance_amount, payment_days, priority, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, customer_id, po_date, due_date, currency, delivery_terms, payment_terms, advance_amount, payment_days, priority, status, notes],
      function(err) {
        if (err) {
          try { db.run('ROLLBACK'); } catch(_){}
          return res.status(500).json({ error: err.message });
        }

        const stmt = db.prepare("INSERT INTO client_po_line_items (po_id, product_id, quantity, unit_price, line_total, delivered, currency) VALUES (?, ?, ?, ?, ?, 0, ?)");
        let failed = false;

        (line_items||[]).forEach(item => {
          const qty = Number(item.quantity||0);
          const up = Number(item.unit_price||0);
          const curr = item.currency || 'INR';
          stmt.run([id, item.product_id, qty, up, qty * up, curr], (itemErr) => {
            if (itemErr) failed = true;
          });

          // Commit inventory for this line item
          updateInventoryCommitment(item.product_id, qty, (commitErr) => {
            if (commitErr) {
              console.warn(`Inventory commitment warning for ${item.product_id}:`, commitErr.message);
            }
          });
        });

        stmt.finalize((e)=> {
          if (e || failed) {
            try { db.run('ROLLBACK'); } catch(_){}
            return res.status(500).json({ error: e?.message || 'Failed to create PO' });
          }

          // Log audit trail
          logAudit('client_purchase_orders', id, 'CREATE', null, { customer_id, po_date, due_date, status, line_items });

          db.run('COMMIT', (cerr) => {
            if (cerr) return res.status(500).json({ error: cerr.message });
            res.json({ message: 'Client PO added', id });
          });
        });
      }
    );
  });
});

app.put('/api/purchase-orders/:id', (req, res) => {
  const { id } = req.params;
  let { customer_id, po_date, due_date, currency='INR', delivery_terms, payment_terms, advance_amount=0, payment_days=0, priority='Normal', status='Pending', notes='' } = req.body;
  const norm = (s)=>{ if(!s) return s; const m=String(s).replace(/\//g,'-').match(/^([0-3]\d)-([01]\d)-(\d{4})$/); return m? `${m[3]}-${m[2]}-${m[1]}` : s; };
  po_date = norm(po_date); due_date = norm(due_date);
  db.run(
    `UPDATE client_purchase_orders SET customer_id=?, po_date=?, due_date=?, currency=?, delivery_terms=?, payment_terms=?, advance_amount=?, payment_days=?, priority=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [customer_id, po_date, due_date, currency, delivery_terms, payment_terms, advance_amount, payment_days, priority, status, notes, id],
    function(err){ if (err) return res.status(500).json({ error: err.message }); res.json({ message: 'Client PO updated' }); }
  );
});

app.delete('/api/purchase-orders/:id', (req, res) => {
  const { id } = req.params;
  const { hard = false } = req.query; // Support hard delete via query param

  // Prevent deleting POs that have shipments
  db.get(`SELECT COUNT(*) as cnt FROM shipments WHERE po_id = ? AND is_deleted = 0`, [id], (e, row) => {
    if (e) return res.status(500).json({ error: e.message });
    if ((row && row.cnt) > 0) return res.status(400).json({ error: 'Cannot delete PO with active shipments. Delete shipments first.' });

    // Get PO details before deletion for audit
    db.get(`SELECT * FROM client_purchase_orders WHERE id = ?`, [id], (poErr, po) => {
      if (poErr) return res.status(500).json({ error: poErr.message });
      if (!po) return res.status(404).json({ error: 'PO not found' });

      // Get line items to uncommit inventory
      db.all(`SELECT product_id, quantity FROM client_po_line_items WHERE po_id = ?`, [id], (itemErr, items) => {
        if (itemErr) return res.status(500).json({ error: itemErr.message });

        db.serialize(()=>{
          db.run('BEGIN');

          // Uncommit inventory for all line items
          let failed = false;
          (items || []).forEach(item => {
            updateInventoryCommitment(item.product_id, -Number(item.quantity || 0), (uncommitErr) => {
              if (uncommitErr) {
                console.warn(`Inventory uncommit warning for ${item.product_id}:`, uncommitErr.message);
              }
            });
          });

          if (hard === 'true') {
            // Hard delete (permanent removal)
            db.run(`DELETE FROM client_po_line_items WHERE po_id = ?`, [id], (e1)=>{
              if (e1) { try{ db.run('ROLLBACK'); }catch(_){} return res.status(500).json({ error: e1.message }); }
              db.run(`DELETE FROM client_purchase_orders WHERE id = ?`, [id], (e2)=>{
                if (e2) { try{ db.run('ROLLBACK'); }catch(_){} return res.status(500).json({ error: e2.message }); }
                logAudit('client_purchase_orders', id, 'HARD_DELETE', po, null);
                db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message: 'Client PO permanently deleted' }); });
              });
            });
          } else {
            // Soft delete (mark as deleted)
            db.run(`UPDATE client_purchase_orders SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id], (delErr)=>{
              if (delErr) { try{ db.run('ROLLBACK'); }catch(_){} return res.status(500).json({ error: delErr.message }); }
              logAudit('client_purchase_orders', id, 'SOFT_DELETE', po, null);
              db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message: 'Client PO deleted', can_undo: true }); });
            });
          }
        });
      });
    });
  });
});

// Bulk delete client POs
app.post('/api/purchase-orders/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'No PO IDs provided' });
  const result = { deleted: 0, failed: [] };
  const next = () => {
    if (!ids.length) return res.json({ message: 'Bulk delete completed', ...result });
    const id = ids.shift();
    db.get(`SELECT COUNT(*) as cnt FROM shipments WHERE po_id = ?`, [id], (e, row) => {
      if (e) { result.failed.push({ id, error: e.message }); return next(); }
      if ((row && row.cnt) > 0) { result.failed.push({ id, error: 'Has shipments' }); return next(); }
      db.serialize(()=>{
        db.run('BEGIN');
        db.run(`DELETE FROM client_po_line_items WHERE po_id = ?`, [id], (e1)=>{
          if (e1) { try{ db.run('ROLLBACK'); }catch(_){}; result.failed.push({ id, error: e1.message }); return next(); }
          db.run(`DELETE FROM client_purchase_orders WHERE id = ?`, [id], (e2)=>{
            if (e2) { try{ db.run('ROLLBACK'); }catch(_){}; result.failed.push({ id, error: e2.message }); return next(); }
            db.run('COMMIT', (cerr)=>{ if (cerr) { result.failed.push({ id, error: cerr.message }); } else { result.deleted += 1; } next(); });
          });
        });
      });
    });
  };
  next();
});

// ============= VENDOR PURCHASE ORDER APIs (NEW) =============

app.get('/api/vendor-purchase-orders', (req, res) => {
  db.all(`
    SELECT po.*, v.name as vendor_name
    FROM vendor_purchase_orders po
    LEFT JOIN vendors v ON po.vendor_id = v.id
    ORDER BY po.po_date DESC
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/vendor-purchase-orders/:id', (req, res) => {
  const { id } = req.params;
  
  db.get(`
    SELECT po.*, v.* 
    FROM vendor_purchase_orders po
    LEFT JOIN vendors v ON po.vendor_id = v.id
    WHERE po.id = ?
  `, [id], (err, po) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (!po) {
      res.status(404).json({ error: 'PO not found' });
    } else {
      db.all(`
        SELECT * FROM vendor_po_line_items WHERE po_id = ?
      `, [id], (err, items) => {
        if (err) {
          res.status(500).json({ error: err.message });
        } else {
          res.json({ ...po, line_items: items });
        }
      });
    }
  });
});

app.post('/api/vendor-purchase-orders', (req, res) => {
  const { id, vendor_id, po_date, due_date, expected_delivery, currency, delivery_terms, payment_terms, status, notes, line_items } = req.body;

  db.run(
    `INSERT INTO vendor_purchase_orders (id, vendor_id, po_date, due_date, currency, delivery_terms, payment_terms, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, vendor_id, po_date, due_date || expected_delivery, currency || 'INR', delivery_terms, payment_terms, status || 'Pending', notes],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        const stmt = db.prepare("INSERT INTO vendor_po_line_items (po_id, material_type, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)");
        const isCompleted = status === 'Completed';

        (line_items || []).forEach(item => {
          stmt.run([id, item.material_type, item.quantity, item.unit_price, item.quantity * item.unit_price]);

          if (isCompleted) {
            // If created with "Completed" status, add directly to current_stock
            db.run("UPDATE raw_materials_inventory SET current_stock = current_stock + ? WHERE material = ?",
              [item.quantity, item.material_type]);
          } else {
            // Otherwise, update committed stock
            db.run("UPDATE raw_materials_inventory SET committed_stock = committed_stock + ? WHERE material = ?",
              [item.quantity, item.material_type]);
          }
        });
        stmt.finalize((err) => {
          if (err) {
            res.status(500).json({ error: err.message });
          } else {
            res.json({ message: 'Vendor purchase order added successfully' });
          }
        });
      }
    }
  );
});

// Update vendor PO (header only)
app.put('/api/vendor-purchase-orders/:id', (req, res) => {
  const { id } = req.params;
  const { vendor_id, po_date, due_date, expected_delivery, currency='INR', delivery_terms, payment_terms, status, notes } = req.body;

  // Get the old status first
  db.get('SELECT status FROM vendor_purchase_orders WHERE id = ?', [id], (err, oldRow) => {
    if (err) return res.status(500).json({ error: err.message });

    const oldStatus = oldRow?.status;
    const newStatus = status;

    db.run(
      `UPDATE vendor_purchase_orders SET vendor_id=?, po_date=?, due_date=?, currency=?, delivery_terms=?, payment_terms=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [vendor_id, po_date, due_date || expected_delivery, currency, delivery_terms, payment_terms, newStatus, notes, id],
      function(err){
        if (err) return res.status(500).json({ error: err.message });

        // If status changed to "Completed", update inventory
        if (oldStatus !== 'Completed' && newStatus === 'Completed') {
          db.all('SELECT item_type, material_type, product_id, product_stage, quantity FROM vendor_po_line_items WHERE po_id = ?', [id], (err, items) => {
            if (err) return res.status(500).json({ error: err.message });

            items.forEach(item => {
              if (item.item_type === 'Raw Material') {
                // Add to current_stock and reduce from committed_stock for raw materials
                db.run(`UPDATE raw_materials_inventory
                        SET current_stock = current_stock + ?,
                            committed_stock = MAX(committed_stock - ?, 0)
                        WHERE material = ?`,
                  [item.quantity, item.quantity, item.material_type]);
              } else if (item.item_type === 'Product' && item.product_id) {
                // Update product inventory based on product_stage
                const stage = item.product_stage || 'steel_rods';
                const columnMap = {
                  'steel_rods': 'steel_rods',
                  'plated': 'plated',
                  'quality_checked': 'quality_checked',
                  'stamped': 'stamped',
                  'packaged': 'packaged'
                };
                const column = columnMap[stage] || 'steel_rods';

                db.run(`INSERT INTO inventory (product_id, ${column}, updated_at)
                        VALUES (?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(product_id) DO UPDATE SET
                          ${column} = ${column} + excluded.${column},
                          updated_at = CURRENT_TIMESTAMP`,
                  [item.product_id, item.quantity]);
              }
            });

            res.json({ message: 'Vendor PO updated and inventory received' });
          });
        } else {
          res.json({ message: 'Vendor PO updated' });
        }
      }
    );
  });
});

// Delete vendor PO and rollback committed stock
app.delete('/api/vendor-purchase-orders/:id', (req, res) => {
  const { id } = req.params;
  db.all(`SELECT material_type, quantity FROM vendor_po_line_items WHERE po_id = ?`, [id], (e, rows) => {
    if (e) return res.status(500).json({ error: e.message });
    db.serialize(()=>{
      db.run('BEGIN');
      (rows||[]).forEach(r => {
        db.run(`UPDATE raw_materials_inventory SET committed_stock = MAX(committed_stock - ?, 0) WHERE material = ?`, [Number(r.quantity||0), r.material_type]);
      });
      db.run(`DELETE FROM vendor_po_line_items WHERE po_id = ?`, [id], (e1)=>{
        if (e1) { try { db.run('ROLLBACK'); } catch(_){} return res.status(500).json({ error: e1.message }); }
        db.run(`DELETE FROM vendor_purchase_orders WHERE id = ?`, [id], (e2)=>{
          if (e2) { try { db.run('ROLLBACK'); } catch(_){} return res.status(500).json({ error: e2.message }); }
          db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message: 'Vendor PO deleted' }); });
        });
      });
    });
  });
});

// Receive vendor PO items into raw materials inventory (simple GRN)
app.post('/api/vendor-purchase-orders/:id/receive', (req, res) => {
  const { id } = req.params;
  // Load items from our items table
  db.all('SELECT item, description, qty, unit FROM vendor_po_items WHERE vpo_id=?', [id], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No items to receive' });
    const receiveUnit = (u)=> String(u||'kg').toLowerCase();
    const isKg = (u)=> ['kg','kgs','kilogram','kilograms'].includes(receiveUnit(u));
    db.serialize(()=>{
      db.run('BEGIN');
      try{
        items.forEach(it => {
          const mat = it.item || (it.description||'').split(' ')[0];
          const qty = Number(it.qty||0);
          if (!mat || !(qty>0)) return;
          const unit = receiveUnit(it.unit);
          const qtyKg = isKg(unit) ? qty : qty; // extend here for other units
          db.run(`INSERT INTO raw_materials_inventory (material, current_stock, reorder_level, last_purchase_date, updated_at)
                  VALUES (?, ?, 0, DATE('now'), CURRENT_TIMESTAMP)
                  ON CONFLICT(material) DO UPDATE SET current_stock = current_stock + excluded.current_stock, last_purchase_date = DATE('now'), updated_at = CURRENT_TIMESTAMP`, [mat, qtyKg]);
          db.run(`INSERT INTO vendor_po_receipts (vpo_id, material, qty, unit) VALUES (?, ?, ?, ?)`, [id, mat, qtyKg, unit]);
        });
        db.run('COMMIT', (e)=>{
          if (e) return res.status(500).json({ error: e.message });
          res.json({ message: 'Received to raw materials', received: items.length });
        });
      } catch(ex){ try{ db.run('ROLLBACK'); }catch(_){}; res.status(500).json({ error: 'Receive failed' }); }
    });
  });
});

// Partial receipts with explicit items list and unit mapping
app.post('/api/vendor-purchase-orders/:id/receive-items', (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ error: 'No items provided' });
  const normUnit = (u)=> String(u||'kg').trim().toLowerCase();
  const toKg = (qty, unit)=>{
    const u = normUnit(unit);
    const q = Number(qty||0);
    if (u==='kg' || u==='kgs' || u==='kilogram' || u==='kilograms') return q;
    if (u==='g' || u==='gram' || u==='grams') return q/1000;
    if (u==='t' || u==='ton' || u==='tonne' || u==='mt') return q*1000;
    // default assume kg
    return q;
  };
  db.serialize(()=>{
    db.run('BEGIN');
    try{
      items.forEach(it => {
        const mat = it.material || it.item;
        const qtyKg = toKg(it.qty, it.unit);
        if (!mat || !(qtyKg>0)) return;
        db.run(`INSERT INTO raw_materials_inventory (material, current_stock, reorder_level, last_purchase_date, updated_at)
                VALUES (?, ?, 0, DATE('now'), CURRENT_TIMESTAMP)
                ON CONFLICT(material) DO UPDATE SET current_stock = current_stock + excluded.current_stock, last_purchase_date = DATE('now'), updated_at = CURRENT_TIMESTAMP`, [mat, qtyKg]);
        db.run(`INSERT INTO vendor_po_receipts (vpo_id, material, qty, unit) VALUES (?, ?, ?, ?)`, [id, mat, qtyKg, normUnit(it.unit)]);
      });
      db.run('COMMIT', (e)=>{
        if (e) return res.status(500).json({ error: e.message });
        res.json({ message:'Receipt posted', received: items.length });
      });
    } catch(ex){ try{ db.run('ROLLBACK'); }catch(_){}; res.status(500).json({ error: 'Receive failed' }); }
  });
});

// ============= JOB WORK (Cores) APIs =============
// Orders
app.get('/api/jobwork/orders', (req, res) => {
  db.all(`SELECT * FROM job_work_orders ORDER BY jw_date DESC`, (err, rows)=>{
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows||[]);
  });
});
app.post('/api/jobwork/orders', (req, res) => {
  const { id, vendor_id, jw_date, due_date, job_type='Rod Making', status='Open', notes='' } = req.body||{};
  if (!id || !jw_date) return res.status(400).json({ error:'id and jw_date required' });
  db.run(`INSERT INTO job_work_orders (id, vendor_id, jw_date, due_date, job_type, status, notes, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [id, vendor_id||'', jw_date, due_date||'', job_type, status, notes], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message:'JWO created' });
  });
});
app.put('/api/jobwork/orders/:id', (req, res) => {
  const { id } = req.params;
  const { vendor_id, jw_date, due_date, job_type, status, notes } = req.body||{};
  db.run(`UPDATE job_work_orders SET vendor_id=?, jw_date=?, due_date=?, job_type=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [vendor_id||'', jw_date||'', due_date||'', job_type||'Rod Making', status||'Open', notes||'', id], function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message:'JWO updated' });
    });
});
app.delete('/api/jobwork/orders/:id', (req,res)=>{
  const { id } = req.params;
  db.serialize(()=>{
    db.run('BEGIN');
    db.run('DELETE FROM job_work_items WHERE order_id=?', [id]);
    db.run('DELETE FROM job_work_receipts WHERE order_id=?', [id]);
    db.run('DELETE FROM job_work_orders WHERE id=?', [id], function(err){
      if (err){ try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error: err.message }); }
      db.run('COMMIT', (e)=>{ if (e) return res.status(500).json({ error: e.message }); res.json({ message:'JWO deleted' }); });
    });
  });
});
// Items
app.get('/api/jobwork/orders/:id/items', (req,res)=>{
  db.all('SELECT * FROM job_work_items WHERE order_id=?', [req.params.id], (err, rows)=>{
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows||[]);
  });
});
app.post('/api/jobwork/orders/:id/items', (req,res)=>{
  const { product_id, qty } = req.body||{}; const { id } = req.params;
  if (!product_id || !(Number(qty)>0)) return res.status(400).json({ error:'product_id and qty required' });
  db.run('INSERT INTO job_work_items (order_id, product_id, qty) VALUES (?,?,?)', [id, product_id, Number(qty)], function(err){
    if (err) return res.status(500).json({ error: err.message }); res.json({ message:'Item added' });
  });
});
app.delete('/api/jobwork/orders/:id/items/:itemId', (req,res)=>{
  db.run('DELETE FROM job_work_items WHERE id=? AND order_id=?', [req.params.itemId, req.params.id], function(err){
    if (err) return res.status(500).json({ error: err.message }); res.json({ message:'Item deleted' });
  });
});
// Receipts - handle Rod Making and Plating job work
app.post('/api/jobwork/orders/:id/receive', (req,res)=>{
  const { id } = req.params; const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error:'No items' });

  // Get the job work order to determine job_type
  db.get('SELECT job_type FROM job_work_orders WHERE id=?', [id], (err, order)=>{
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: 'Job work order not found' });

    const jobType = order.job_type || 'Rod Making';

    db.serialize(()=>{
      db.run('BEGIN');
      try{
        items.forEach(it=>{
          const pid = it.product_id; const qty = Number(it.qty||0);
          if (!pid || !(qty>0)) return;

          if (jobType === 'Rod Making') {
            // Rod Making: Raw Steel → Steel Rods
            // Consume raw steel from BOM, add to steel_rods inventory
            db.run(`INSERT INTO inventory (product_id, steel_rods, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(product_id) DO UPDATE SET steel_rods = steel_rods + excluded.steel_rods, updated_at=CURRENT_TIMESTAMP`, [pid, qty]);

            // Consume raw steel based on BOM
            db.get('SELECT qty_per_unit FROM bom WHERE product_id=? AND material=?', [pid, 'Steel'], (e, bom)=>{
              if (!e && bom) {
                const steelConsumed = qty * Number(bom.qty_per_unit || 0);
                db.run(`UPDATE raw_materials_inventory SET current_stock = current_stock - ? WHERE material = ?`, [steelConsumed, 'Steel']);
              }
            });
          } else if (jobType === 'Plating') {
            // Plating: Steel Rods + Copper Anode → Plated
            // Consume steel_rods, consume copper anode from BOM, add to plated inventory
            db.run(`INSERT INTO inventory (product_id, plated, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(product_id) DO UPDATE SET plated = plated + excluded.plated, steel_rods = steel_rods - ?, updated_at=CURRENT_TIMESTAMP`, [pid, qty, qty]);

            // Consume copper anode based on BOM
            db.get('SELECT qty_per_unit FROM bom WHERE product_id=? AND material=?', [pid, 'Copper Anode'], (e, bom)=>{
              if (!e && bom) {
                const copperConsumed = qty * Number(bom.qty_per_unit || 0);
                db.run(`UPDATE raw_materials_inventory SET current_stock = current_stock - ? WHERE material = ?`, [copperConsumed, 'Copper Anode']);
              }
            });
          }

          db.run(`INSERT INTO job_work_receipts (order_id, product_id, qty, received_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`, [id, pid, qty]);
        });

        // Update job work order status to Completed
        db.run('UPDATE job_work_orders SET status = ? WHERE id = ?', ['Completed', id]);

        db.run('COMMIT', (e)=>{ if(e) return res.status(500).json({ error:e.message }); res.json({ message:`${jobType} job work received`, received: items.length }); });
      }catch(ex){ try{ db.run('ROLLBACK'); }catch(_){}; res.status(500).json({ error:'Receipt failed: ' + ex.message }); }
    });
  });
});

// ============= BOM APIs =============
app.get('/api/bom', (req, res) => {
  db.all('SELECT * FROM bom', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
app.get('/api/bom/:product_id', (req, res) => {
  db.all('SELECT * FROM bom WHERE product_id=?', [req.params.product_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
app.post('/api/bom', (req, res) => {
  const { product_id, material, qty_per_unit } = req.body||{};
  if (!product_id || !material || !(qty_per_unit>0)) return res.status(400).json({ error:'product_id, material, qty_per_unit required' });
  db.run('INSERT INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?) ON CONFLICT(product_id,material) DO UPDATE SET qty_per_unit=excluded.qty_per_unit', [product_id, material, qty_per_unit], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message:'BOM saved' });
  });
});
app.delete('/api/bom/:product_id/:material', (req, res) => {
  db.run('DELETE FROM bom WHERE product_id=? AND material=?', [req.params.product_id, req.params.material], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message:'BOM deleted', changes: this.changes });
  });
});

// Vendor PO line items CRUD
app.get('/api/vendor-purchase-orders/:id/items', (req, res) => {
  const { id } = req.params;
  db.all(`SELECT * FROM vendor_po_line_items WHERE po_id = ? ORDER BY id`, [id], (err, rows)=>{
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/vendor-purchase-orders/:id/items', (req, res) => {
  const { id } = req.params;
  const item_type = req.body.item_type || 'Raw Material';
  const material_type = (req.body.material_type || req.body.item || '').toString();
  const product_id = req.body.product_id || null;
  const product_stage = req.body.product_stage || null;
  const qtyRaw = (req.body.quantity != null ? req.body.quantity : req.body.qty);
  const unit_price = Number(req.body.unit_price || 0);
  const qty = Number(qtyRaw || 0);
  const description = req.body.description || '';
  const unit = req.body.unit || 'kg';

  db.serialize(() => {
    db.run('BEGIN');
    db.run(
      `INSERT INTO vendor_po_line_items (po_id, item_type, material_type, product_id, product_stage, quantity, unit_price, line_total, description, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, item_type, material_type, product_id, product_stage, qty, unit_price, qty * unit_price, description, unit],
      function(err) {
        if (err) {
          try { db.run('ROLLBACK'); } catch(_) {}
          return res.status(500).json({ error: err.message });
        }

        // Update committed inventory based on item type
        if (item_type === 'Raw Material') {
          // Update raw materials committed stock
          db.run(
            `UPDATE raw_materials_inventory SET committed_stock = committed_stock + ? WHERE material = ?`,
            [qty, material_type],
            (e2) => {
              if (e2) {
                try { db.run('ROLLBACK'); } catch(_) {}
                return res.status(500).json({ error: e2.message });
              }
              db.run('COMMIT', (cerr) => {
                if (cerr) return res.status(500).json({ error: cerr.message });
                res.json({ message: 'Raw material item added', id: this.lastID });
              });
            }
          );
        } else if (item_type === 'Product') {
          // For products, we don't update inventory until PO is marked completed (handled in PUT endpoint)
          db.run('COMMIT', (cerr) => {
            if (cerr) return res.status(500).json({ error: cerr.message });
            res.json({ message: 'Product item added', id: this.lastID });
          });
        } else {
          db.run('COMMIT', (cerr) => {
            if (cerr) return res.status(500).json({ error: cerr.message });
            res.json({ message: 'Item added', id: this.lastID });
          });
        }
      }
    );
  });
});

app.put('/api/vendor-purchase-orders/:id/items/:itemId', (req, res) => {
  const { id, itemId } = req.params; const material_type = (req.body.material_type || req.body.item || '').toString(); const quantity = (req.body.quantity!=null? req.body.quantity : req.body.qty); const unit_price = req.body.unit_price;
  db.get(`SELECT material_type, quantity FROM vendor_po_line_items WHERE id=? AND po_id=?`, [itemId, id], (e, row)=>{
    if (e) return res.status(500).json({ error: e.message });
    if (!row) return res.status(404).json({ error: 'Item not found' });
    const oldQty = Number(row.quantity||0); const newQty = Number(quantity||0); const diff = newQty - oldQty;
    db.serialize(()=>{
      db.run('BEGIN');
      db.run(`UPDATE vendor_po_line_items SET material_type=?, quantity=?, unit_price=?, line_total=? WHERE id=? AND po_id=?`, [material_type, newQty, Number(unit_price||0), newQty*Number(unit_price||0), itemId, id], (e1)=>{
        if (e1) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error: e1.message }); }
        if (diff !== 0) {
          db.run(`UPDATE raw_materials_inventory SET committed_stock = committed_stock + ? WHERE material = ?`, [diff, material_type], (e2)=>{
            if (e2) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error: e2.message }); }
            db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message: 'Item updated' }); });
          });
        } else {
          db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message: 'Item updated' }); });
        }
      });
    });
  });
});

app.delete('/api/vendor-purchase-orders/:id/items/:itemId', (req, res) => {
  const { id, itemId } = req.params;
  db.get(`SELECT material_type, quantity, received FROM vendor_po_line_items WHERE id=? AND po_id=?`, [itemId, id], (e,row)=>{
    if (e) return res.status(500).json({ error: e.message });
    if (!row) return res.status(404).json({ error: 'Item not found' });
    if (Number(row.received||0) > 0) return res.status(400).json({ error: 'Cannot delete item with received quantity' });
    const qty = Number(row.quantity||0);
    db.serialize(()=>{
      db.run('BEGIN');
      db.run(`DELETE FROM vendor_po_line_items WHERE id=? AND po_id=?`, [itemId, id], (e1)=>{
        if (e1) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error: e1.message }); }
        db.run(`UPDATE raw_materials_inventory SET committed_stock = MAX(committed_stock - ?, 0) WHERE material = ?`, [qty, row.material_type], (e2)=>{
          if (e2) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error: e2.message }); }
          db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message: 'Item deleted' }); });
        });
      });
    });
  });
});
// Bulk delete vendor POs
app.post('/api/vendor-purchase-orders/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'No vendor PO IDs provided' });
  const result = { deleted: 0, failed: [] };
  const next = () => {
    if (!ids.length) return res.json({ message: 'Bulk delete completed', ...result });
    const id = ids.shift();
    db.all(`SELECT material_type, quantity FROM vendor_po_line_items WHERE po_id = ?`, [id], (e, rows) => {
      if (e) { result.failed.push({ id, error: e.message }); return next(); }
      db.serialize(()=>{
        db.run('BEGIN');
        (rows||[]).forEach(r => { db.run(`UPDATE raw_materials_inventory SET committed_stock = MAX(committed_stock - ?, 0) WHERE material = ?`, [Number(r.quantity||0), r.material_type]); });
        db.run(`DELETE FROM vendor_po_line_items WHERE po_id = ?`, [id], (e1)=>{
          if (e1) { try{ db.run('ROLLBACK'); }catch(_){}; result.failed.push({ id, error: e1.message }); return next(); }
          db.run(`DELETE FROM vendor_purchase_orders WHERE id = ?`, [id], (e2)=>{
            if (e2) { try{ db.run('ROLLBACK'); }catch(_){}; result.failed.push({ id, error: e2.message }); return next(); }
            db.run('COMMIT', (cerr)=>{ if (cerr) { result.failed.push({ id, error: cerr.message }); } else { result.deleted += 1; } next(); });
          });
        });
      });
    });
  };
  next();
});

// ============= OTHER APIs =============

app.get('/api/shipments', (req, res) => {
  db.all(`
    SELECT s.*, po.id as po_number, c.name as customer_name
    FROM shipments s
    LEFT JOIN client_purchase_orders po ON s.po_id = po.id
    LEFT JOIN customers c ON po.customer_id = c.id
    ORDER BY s.shipment_date DESC
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.post('/api/shipments', (req, res) => {
  const { id, po_id, shipment_date, container_number, bl_number, bl_date, notes, items } = req.body;
  // Record shipment, update delivered counts, and decrement inventory.packed
  db.serialize(() => {
    db.run('BEGIN');
    db.run(
      "INSERT INTO shipments (id, po_id, shipment_date, container_number, bl_number, bl_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, po_id, shipment_date, container_number, bl_number, bl_date, notes],
      function(err) {
        if (err) {
          try { db.run('ROLLBACK'); } catch(_){}
          return res.status(500).json({ error: err.message });
        }
        const stmt = db.prepare("INSERT INTO shipment_items (shipment_id, product_id, quantity) VALUES (?, ?, ?)");
        let failed = false;
        (items||[]).forEach(item => {
          if (failed) return;
          const qty = Number(item.quantity||0);
          stmt.run([id, item.product_id, qty], (e)=>{ if(e){ failed = true; }});
          db.run(
            "UPDATE client_po_line_items SET delivered = delivered + ? WHERE po_id = ? AND product_id = ?",
            [qty, po_id, item.product_id],
            (e)=>{ if(e){ failed = true; }}
          );
          db.run(
            `UPDATE inventory SET packed = MAX(packed - ?, 0), updated_at = CURRENT_TIMESTAMP WHERE product_id = ?`,
            [qty, item.product_id],
            (e)=>{ if(e){ failed = true; }}
          );
        });
        stmt.finalize((err) => {
          if (err || failed) {
            try { db.run('ROLLBACK'); } catch(_){}
            return res.status(500).json({ error: (err&&err.message) || 'Failed to save shipment items' });
          }
          db.run('COMMIT', (cerr) => {
            if (cerr) return res.status(500).json({ error: cerr.message });
            res.json({ message: 'Shipment recorded successfully' });
          });
        });
      }
    );
  });
});

// Delete shipment: rollback delivered and restore inventory
app.delete('/api/shipments/:id', (req, res) => {
  const { id } = req.params;
  db.get(`SELECT * FROM shipments WHERE id = ?`, [id], (err, ship) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!ship) return res.status(404).json({ error: 'Shipment not found' });
    db.all(`SELECT * FROM shipment_items WHERE shipment_id = ?`, [id], (e2, items) => {
      if (e2) return res.status(500).json({ error: e2.message });
      db.serialize(() => {
        db.run('BEGIN');
        let failed = false;
        (items||[]).forEach(it => {
          const qty = Number(it.quantity||0);
          db.run(`UPDATE client_po_line_items SET delivered = MAX(delivered - ?, 0) WHERE po_id = ? AND product_id = ?`, [qty, ship.po_id, it.product_id], (e)=>{ if(e){ failed=true; }});
          db.run(`UPDATE inventory SET packed = packed + ?, updated_at=CURRENT_TIMESTAMP WHERE product_id = ?`, [qty, it.product_id], (e)=>{ if(e){ failed=true; }});
        });
        db.run(`DELETE FROM shipment_items WHERE shipment_id = ?`, [id], (e3) => {
          if (e3) { failed = true; }
          db.run(`DELETE FROM shipments WHERE id = ?`, [id], (e4) => {
            if (e4) { failed = true; }
            if (failed) { try { db.run('ROLLBACK'); } catch(_){} return res.status(500).json({ error: 'Failed to delete shipment' }); }
            db.run('COMMIT', (cerr) => {
              if (cerr) return res.status(500).json({ error: cerr.message });
              res.json({ message: 'Shipment deleted' });
            });
          });
        });
      });
    });
  });
});

// Update shipment header
app.put('/api/shipments/:id', (req, res) => {
  const { id } = req.params;
  const { shipment_date, container_number, bl_number, bl_date, notes } = req.body;
  db.run(`UPDATE shipments SET shipment_date=?, container_number=?, bl_number=?, bl_date=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [shipment_date, container_number, bl_number, bl_date, notes, id],
    function(err){ if (err) return res.status(500).json({ error: err.message }); res.json({ message: 'Shipment updated' }); }
  );
});

// Bulk delete shipments
app.post('/api/shipments/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'No shipment IDs provided' });
  const result = { deleted: 0, failed: [] };
  const next = () => {
    if (!ids.length) return res.json({ message: 'Bulk delete completed', ...result });
    const id = ids.shift();
    db.get(`SELECT * FROM shipments WHERE id = ?`, [id], (err, ship) => {
      if (err || !ship) { result.failed.push({ id, error: err ? err.message : 'Not found' }); return next(); }
      db.all(`SELECT * FROM shipment_items WHERE shipment_id = ?`, [id], (e2, items) => {
        if (e2) { result.failed.push({ id, error: e2.message }); return next(); }
        db.serialize(()=>{
          db.run('BEGIN');
          let failed = false;
          (items||[]).forEach(it => {
            const qty = Number(it.quantity||0);
            db.run(`UPDATE client_po_line_items SET delivered = MAX(delivered - ?, 0) WHERE po_id = ? AND product_id = ?`, [qty, ship.po_id, it.product_id], (e)=>{ if(e){ failed=true; }});
            db.run(`UPDATE inventory SET packed = packed + ?, updated_at=CURRENT_TIMESTAMP WHERE product_id = ?`, [qty, it.product_id], (e)=>{ if(e){ failed=true; }});
          });
          db.run(`DELETE FROM shipment_items WHERE shipment_id = ?`, [id], (e3)=>{
            if (e3) { failed = true; }
            db.run(`DELETE FROM shipments WHERE id = ?`, [id], (e4)=>{
              if (e4) { failed = true; }
              if (failed) { try{ db.run('ROLLBACK'); }catch(_){}; result.failed.push({ id, error: 'Failed to delete' }); return next(); }
              db.run('COMMIT', (cerr)=>{ if(cerr){ result.failed.push({ id, error: cerr.message }); } else { result.deleted += 1; } next(); });
            });
          });
        });
      });
    });
  };
  next();
});

// Shipment items CRUD with inventory/delivered adjustments
app.get('/api/shipments/:id/items', (req, res) => {
  const { id } = req.params;
  db.all(`SELECT si.*, p.description as product_description FROM shipment_items si LEFT JOIN products p ON si.product_id = p.id WHERE si.shipment_id=? ORDER BY si.id`, [id], (err, rows)=>{
    if (err) return res.status(500).json({ error: err.message }); res.json(rows);
  });
});

app.post('/api/shipments/:id/items', (req, res) => {
  const { id } = req.params; const { product_id, quantity=0 } = req.body; const qty = Number(quantity||0);
  if (!product_id || qty<=0) return res.status(400).json({ error:'product_id and positive quantity required' });
  db.get(`SELECT po_id FROM shipments WHERE id=?`, [id], (e, ship)=>{
    if (e || !ship) return res.status(404).json({ error: 'Shipment not found' });
    db.serialize(()=>{
      db.run('BEGIN');
      db.run(`INSERT INTO shipment_items (shipment_id, product_id, quantity) VALUES (?, ?, ?)`, [id, product_id, qty], function(err){
        if (err) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error: err.message }); }
        db.run(`UPDATE client_po_line_items SET delivered = delivered + ? WHERE po_id = ? AND product_id = ?`, [qty, ship.po_id, product_id], (e2)=>{
          if (e2) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error: e2.message }); }
          db.run(`UPDATE inventory SET packed = MAX(packed - ?, 0), updated_at=CURRENT_TIMESTAMP WHERE product_id = ?`, [qty, product_id], (e3)=>{
            if (e3) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error: e3.message }); }
            db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message:'Item added', id: this.lastID }); });
          });
        });
      });
    });
  });
});

app.put('/api/shipments/:id/items/:itemId', (req, res) => {
  const { id, itemId } = req.params; const { product_id, quantity } = req.body; const newQty = Number(quantity||0);
  db.get(`SELECT * FROM shipment_items WHERE id=? AND shipment_id=?`, [itemId, id], (e,row)=>{
    if (e || !row) return res.status(404).json({ error:'Item not found' });
    const oldQty = Number(row.quantity||0); const oldPid = row.product_id; const newPid = product_id||oldPid;
    const deltaOld = -oldQty; const deltaNew = newQty;
    db.get(`SELECT po_id FROM shipments WHERE id=?`, [id], (e2, ship)=>{
      if (e2 || !ship) return res.status(404).json({ error:'Shipment not found' });
      db.serialize(()=>{
        db.run('BEGIN');
        // rollback old
        db.run(`UPDATE client_po_line_items SET delivered = MAX(delivered + ?, 0) WHERE po_id=? AND product_id=?`, [deltaOld, ship.po_id, oldPid]);
        db.run(`UPDATE inventory SET packed = packed - ?, updated_at=CURRENT_TIMESTAMP WHERE product_id=?`, [deltaOld, oldPid]);
        // apply new
        db.run(`UPDATE client_po_line_items SET delivered = delivered + ? WHERE po_id=? AND product_id=?`, [deltaNew, ship.po_id, newPid]);
        db.run(`UPDATE inventory SET packed = MAX(packed - ?, 0), updated_at=CURRENT_TIMESTAMP WHERE product_id=?`, [deltaNew, newPid]);
        db.run(`UPDATE shipment_items SET product_id=?, quantity=? WHERE id=? AND shipment_id=?`, [newPid, newQty, itemId, id], (e3)=>{
          if (e3) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error:e3.message }); }
          db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message:'Item updated' }); });
        });
      });
    });
  });
});

app.delete('/api/shipments/:id/items/:itemId', (req, res) => {
  const { id, itemId } = req.params;
  db.get(`SELECT * FROM shipment_items WHERE id=? AND shipment_id=?`, [itemId, id], (e,row)=>{
    if (e || !row) return res.status(404).json({ error:'Item not found' });
    const qty = Number(row.quantity||0); const pid = row.product_id;
    db.get(`SELECT po_id FROM shipments WHERE id=?`, [id], (e2, ship)=>{
      if (e2 || !ship) return res.status(404).json({ error:'Shipment not found' });
      db.serialize(()=>{
        db.run('BEGIN');
        db.run(`UPDATE client_po_line_items SET delivered = MAX(delivered - ?, 0) WHERE po_id=? AND product_id=?`, [qty, ship.po_id, pid]);
        db.run(`UPDATE inventory SET packed = packed + ?, updated_at=CURRENT_TIMESTAMP WHERE product_id=?`, [qty, pid]);
        db.run(`DELETE FROM shipment_items WHERE id=? AND shipment_id=?`, [itemId, id], (e3)=>{
          if (e3) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error:e3.message }); }
          db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message:'Item deleted' }); });
        });
      });
    });
  });
});

app.get('/api/inventory', (req, res) => {
  db.all(`
    SELECT
      i.*,
      p.description as product_description,
      (i.packed - COALESCE(i.committed, 0)) as available
    FROM inventory i
    LEFT JOIN products p ON i.product_id = p.id
    ORDER BY p.description
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      // Add computed fields
      const enrichedRows = (rows || []).map(row => ({
        ...row,
        total_wip: (row.plated || 0) + (row.machined || 0) + (row.qc || 0) + (row.stamped || 0),
        total_stock: (row.plated || 0) + (row.machined || 0) + (row.qc || 0) + (row.stamped || 0) + (row.packed || 0) + (row.cores || 0),
        committed: row.committed || 0,
        available: Math.max(0, (row.packed || 0) - (row.committed || 0))
      }));
      res.json(enrichedRows);
    }
  });
});

app.post('/api/production', (req, res) => {
  const { date, entries } = req.body;

  if (!entries || entries.length === 0) {
    return res.status(400).json({ error: 'No production entries provided' });
  }

  db.serialize(() => {
    db.run('BEGIN');
    let failed = false;
    let failedMsg = '';

    const stmt = db.prepare(`
      INSERT INTO production_history
      (production_date, product_id, plated, machined, qc, stamped, packed, rejected, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let processedCount = 0;
    const totalEntries = entries.length;

    entries.forEach((entry, index) => {
      stmt.run([
        date,
        entry.product_id,
        entry.plated || 0,
        entry.machined || 0,
        entry.qc || 0,
        entry.stamped || 0,
        entry.packed || 0,
        entry.rejected || 0,
        entry.notes || ''
      ], function(histErr) {
        if (histErr) { failed = true; failedMsg = histErr.message; return; }

        const productionId = this.lastID;

        // Update inventory stages
        db.run(`
          INSERT INTO inventory (product_id, plated, machined, qc, stamped, packed)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(product_id) DO UPDATE SET
            plated = plated + excluded.plated,
            machined = machined + excluded.machined,
            qc = qc + excluded.qc,
            stamped = stamped + excluded.stamped,
            packed = packed + excluded.packed,
            updated_at = CURRENT_TIMESTAMP
        `, [
          entry.product_id,
          entry.plated || 0,
          entry.machined || 0,
          entry.qc || 0,
          entry.stamped || 0,
          entry.packed || 0
        ], (invErr) => {
          if (invErr) { failed = true; failedMsg = invErr.message; return; }

          // Consume CORES (job-worked rods) for plated quantity
          const platedUnits = Number(entry.plated||0);
          if (platedUnits > 0){
            db.get('SELECT cores FROM inventory WHERE product_id=?', [entry.product_id], (e,row)=>{
              const have = row && Number(row.cores||0) || 0;
              const use = Math.min(have, platedUnits);
              if (use > 0) {
                db.run(`INSERT INTO inventory (product_id, cores, updated_at)
                        VALUES (?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(product_id) DO UPDATE SET cores = MAX(0, cores - ?), updated_at=CURRENT_TIMESTAMP`,
                        [entry.product_id, 0, use], (coreErr) => {
                  if (coreErr) console.warn('Core consumption warning:', coreErr.message);
                });
              }
            });
          }

          // CRITICAL: Consume raw materials based on BOM for packed (finished) quantity
          const packedUnits = Number(entry.packed||0);
          if (packedUnits > 0){
            db.all('SELECT material, qty_per_unit FROM bom WHERE product_id = ?', [entry.product_id], (bomErr, bomRows) => {
              if (bomErr) {
                console.warn('BOM fetch warning:', bomErr.message);
              } else if (bomRows && bomRows.length > 0) {
                bomRows.forEach(bom => {
                  const totalRequired = packedUnits * Number(bom.qty_per_unit || 0);
                  if (totalRequired > 0) {
                    db.run(`UPDATE raw_materials_inventory
                            SET current_stock = MAX(0, current_stock - ?),
                                updated_at = CURRENT_TIMESTAMP
                            WHERE material = ?`,
                            [totalRequired, bom.material], (matErr) => {
                      if (matErr) {
                        console.warn(`Raw material deduction warning for ${bom.material}:`, matErr.message);
                      } else {
                        // Log the material consumption
                        logAudit('raw_materials_inventory', bom.material, 'CONSUMED',
                          null,
                          { product_id: entry.product_id, quantity: totalRequired, production_date: date }
                        );
                      }
                    });
                  }
                });
              }
            });
          }

          // Log audit trail for production entry
          logAudit('production_history', productionId.toString(), 'CREATE', null, entry);

          processedCount++;
          if (processedCount === totalEntries) {
            stmt.finalize((finErr) => {
              if (finErr || failed) {
                try { db.run('ROLLBACK'); } catch(_){}
                return res.status(500).json({ error: failedMsg || finErr?.message || 'Production save failed' });
              }
              db.run('COMMIT', (cerr) => {
                if (cerr) return res.status(500).json({ error: cerr.message });
                res.json({ message: 'Production data saved successfully', entries_processed: totalEntries });
              });
            });
          }
        });
      });
    });
  });
});

// Recent production entries (for UI display)
app.get('/api/production', (req, res) => {
  const { from, to } = req.query;
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '20', 10)));
  const where = [];
  const args = [];
  if (from) { where.push("ph.production_date >= ?"); args.push(from); }
  if (to) { where.push("ph.production_date <= ?"); args.push(to); }
  const sql = `
    SELECT ph.id, ph.production_date, ph.product_id, p.description AS product_description,
           ph.plated, ph.machined, ph.qc, ph.stamped, ph.packed, ph.rejected, ph.notes
    FROM production_history ph
    LEFT JOIN products p ON p.id = ph.product_id
    ${where.length ? ('WHERE ' + where.join(' AND ')) : ''}
    ORDER BY ph.production_date DESC, ph.id DESC
    LIMIT ?`;
  args.push(limit);
  db.all(sql, args, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/raw-materials', (req, res) => {
  db.all("SELECT * FROM raw_materials_inventory", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows || []);
    }
  });
});

app.post('/api/raw-materials', (req, res) => {
  const { material, current_stock, reorder_level, last_purchase_date } = req.body;

  if (!material) {
    return res.status(400).json({ error: 'Material name is required' });
  }

  db.run(
    `INSERT INTO raw_materials (material, current_stock, reorder_level, last_purchase_date)
     VALUES (?, ?, ?, ?)`,
    [material, Number(current_stock || 0), Number(reorder_level || 0), last_purchase_date || null],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Material already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Raw material added successfully', material });
    }
  );
});

app.delete('/api/raw-materials/:material', (req, res) => {
  const { material } = req.params;

  db.run('DELETE FROM raw_materials WHERE material = ?', [material], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Material not found' });
    }
    res.json({ message: 'Raw material deleted successfully', material });
  });
});

// Recent production entries for display
app.get('/api/production', (req, res) => {
  const { from, to, limit = 50 } = req.query;
  const where = [];
  const args = [];
  if (from) { where.push("production_date >= ?"); args.push(from); }
  if (to) { where.push("production_date <= ?"); args.push(to); }
  const sql = `SELECT ph.*, p.description as product_description FROM production_history ph LEFT JOIN products p ON p.id = ph.product_id ${where.length?('WHERE '+where.join(' AND ')):''} ORDER BY production_date DESC, id DESC LIMIT ?`;
  args.push(Number(limit));
  db.all(sql, args, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/dashboard/stats', (req, res) => {
  const stats = {};
  
  db.get("SELECT SUM(plated + machined + qc + stamped) as total_wip FROM inventory", (err, row) => {
    stats.total_wip = row ? row.total_wip || 0 : 0;
    
    db.get("SELECT SUM(packed) as total_finished FROM inventory", (err, row) => {
      stats.total_finished = row ? row.total_finished || 0 : 0;
      
      db.get(`
        SELECT SUM(li.quantity - li.delivered) as pending 
        FROM client_po_line_items li
        WHERE li.delivered < li.quantity
      `, (err, row) => {
        stats.pending_client_orders = row ? row.pending || 0 : 0;
        
        db.get(`
          SELECT COUNT(DISTINCT po.id) as overdue 
          FROM client_purchase_orders po
          LEFT JOIN client_po_line_items li ON po.id = li.po_id
          WHERE po.due_date < date('now') AND li.delivered < li.quantity
        `, (err, row) => {
          stats.overdue_orders = row ? row.overdue || 0 : 0;
          
          res.json(stats);
        });
      });
    });
  });
});

app.get('/api/dashboard/risk-analysis', (req, res) => {
  // Calculate material requirements vs availability
  db.all(`
    SELECT 
      p.id,
      p.steel_diameter,
      p.copper_coating,
      p.length,
      SUM(li.quantity - li.delivered) as pending_qty
    FROM client_po_line_items li
    JOIN products p ON li.product_id = p.id
    WHERE li.delivered < li.quantity
    GROUP BY p.id
  `, (err, pendingOrders) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    let totalSteelNeeded = 0;
    let totalCopperNeeded = 0;

    pendingOrders.forEach(order => {
      const steelWeight = (Math.PI * Math.pow(order.steel_diameter / 2000, 2) * order.length * 7850) / 1000;
      const copperWeight = (Math.PI * (order.steel_diameter / 1000) * (order.copper_coating / 1000000) * order.length * 8960) / 1000;
      
      totalSteelNeeded += steelWeight * order.pending_qty;
      totalCopperNeeded += copperWeight * order.pending_qty;
    });

    db.all("SELECT * FROM raw_materials_inventory", (err, materials) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      const steel = materials.find(m => m.material === 'Steel') || { available_stock: 0 };
      const copper = materials.find(m => m.material === 'Copper Anode' || m.material === 'Copper') || { available_stock: 0 };

      res.json({
        steel: {
          required: totalSteelNeeded.toFixed(2),
          available: steel.available_stock,
          shortage: Math.max(0, totalSteelNeeded - steel.available_stock).toFixed(2),
          excess: Math.max(0, steel.available_stock - totalSteelNeeded).toFixed(2)
        },
        copper: {
          required: totalCopperNeeded.toFixed(2),
          available: copper.available_stock,
          shortage: Math.max(0, totalCopperNeeded - copper.available_stock).toFixed(2),
          excess: Math.max(0, copper.available_stock - totalCopperNeeded).toFixed(2)
        }
      });
    });
  });
});

// Update raw materials inventory (for setting starting amounts or manual adjustments)
app.put('/api/raw-materials/:material', (req, res) => {
  const { material } = req.params;
  const { current_stock, reorder_level, last_purchase_date } = req.body;

  db.run(
    `UPDATE raw_materials SET
       current_stock = ?,
       reorder_level = ?,
       last_purchase_date = ?
     WHERE material = ?`,
    [Number(current_stock || 0), Number(reorder_level || 0), last_purchase_date || null, material],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Material not found' });
      }
      res.json({ message: 'Raw material updated successfully', material });
    }
  );
});

// ============= PDF IMPORT: Client PO + Vendor PO (Preview + Confirm) =============
if (upload && pdfParse) {
  app.post('/api/import/client-po/preview', upload.single('file'), (req, res) => handleClientPoPreview(req, res, true));
  app.post('/api/import/vendor-po/preview', upload.single('file'), (req, res) => handleVendorPoPreview(req, res, true));

  // Import Customer (preview + confirm)
  function parseCustomerFromText(text){
    const out = {};
    const id = text.match(/Customer\s*(?:ID|#|Number)?\s*[:\-]?\s*([A-Z0-9\-]+)/i); if(id) out.id = id[1];
    const name = text.match(/Customer\s*Name\s*[:\-]?\s*([A-Za-z0-9 &\-]+)/i) || text.match(/Name\s*[:\-]?\s*([A-Za-z0-9 .,&\-]+)/i); if(name) out.name = name[1];
    const phone = text.match(/Phone\s*[:\-]?\s*([+()0-9\-\s]+)/i); if(phone) out.phone = phone[1].trim();
    const email = text.match(/Email\s*[:\-]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i); if(email) out.email = email[1];
    return out;
  }
  app.post('/api/import/customer/preview', upload.single('file'), async (req, res) => {
    try{
      const dir = path.join(__dirname, 'uploads', 'customers'); fs.mkdirSync(dir, { recursive:true });
      const token = `customer_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
      fs.writeFileSync(path.join(dir, token), req.file.buffer);
      const data = await pdfParse(req.file.buffer); const text = data.text||''; const customer = parseCustomerFromText(text);
      res.json({ customer, text, file_token: token });
    }catch(e){ res.status(500).json({ error:'Failed to parse PDF' }); }
  });
  app.post('/api/import/customer/confirm', (req, res) => {
    const { id, name, contact_person='', phone='', email='', office_address='', warehouse_address='' } = req.body||{};
    const cid = id && String(id).trim() ? String(id).trim() : `CUST-${Date.now().toString().slice(-4)}`;
    db.run(`INSERT INTO customers (id, name, office_address, warehouse_address, contact_person, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, office_address=excluded.office_address, warehouse_address=excluded.warehouse_address, contact_person=excluded.contact_person, phone=excluded.phone, email=excluded.email`,
      [cid, name||cid, office_address, warehouse_address, contact_person, phone, email], function(err){
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message:'Customer imported', id: cid });
      });
  });

  // Import Vendor (preview + confirm)
  function parseVendorInfoFromText(text){
    const out = {};
    const id = text.match(/Vendor\s*(?:ID|#|Number)?\s*[:\-]?\s*([A-Z0-9\-]+)/i); if(id) out.id = id[1];
    const name = text.match(/Vendor\s*Name\s*[:\-]?\s*([A-Za-z0-9 &\-]+)/i) || text.match(/Name\s*[:\-]?\s*([A-Za-z0-9 .,&\-]+)/i); if(name) out.name = name[1];
    const phone = text.match(/Phone\s*[:\-]?\s*([+()0-9\-\s]+)/i); if(phone) out.phone = phone[1].trim();
    const email = text.match(/Email\s*[:\-]?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i); if(email) out.email = email[1];
    return out;
  }
  app.post('/api/import/vendor/preview', upload.single('file'), async (req, res) => {
    try{
      const dir = path.join(__dirname, 'uploads', 'vendors'); fs.mkdirSync(dir, { recursive:true });
      const token = `vendor_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`;
      fs.writeFileSync(path.join(dir, token), req.file.buffer);
      const data = await pdfParse(req.file.buffer); const text = data.text||''; const vendor = parseVendorInfoFromText(text);
      res.json({ vendor, text, file_token: token });
    }catch(e){ res.status(500).json({ error:'Failed to parse PDF' }); }
  });
  app.post('/api/import/vendor/confirm', (req, res) => {
    const { id, name, contact_person='', phone='', email='', office_address='' } = req.body||{};
    const vid = id && String(id).trim() ? String(id).trim() : `VEND-${Date.now().toString().slice(-4)}`;
    db.run(`INSERT INTO vendors (id, name, contact_person, phone, email, office_address) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, contact_person=excluded.contact_person, phone=excluded.phone, email=excluded.email, office_address=excluded.office_address`,
      [vid, name||vid, contact_person, phone, email, office_address], function(err){
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message:'Vendor imported', id: vid });
      });
  });

  // Confirm Client PO: auto-create customer if needed, and optional line items
  app.post('/api/import/client-po/confirm', (req, res) => {
    let { id, customer_id, customer_name, po_date, due_date, currency = 'INR', status = 'Pending', notes = '', marking = '', delivery_terms = null, payment_terms = null, items = [], file_token = '' } = req.body;
    const norm = (s)=>{ if(!s) return s; const m=String(s).replace(/\//g,'-').match(/^([0-3]\d)-([01]\d)-(\d{4})$/); return m? `${m[3]}-${m[2]}-${m[1]}` : s; };
    po_date = norm(po_date); due_date = norm(due_date);
    if (!id || !po_date || !due_date) return res.status(400).json({ error: 'Missing required fields (id, po_date, due_date)' });

    function genCustomerId(name){
      const base = (name || 'CUST').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6) || 'CUST';
      const suffix = Date.now().toString().slice(-4);
      return `${base}-${suffix}`;
    }

    function ensureCustomer(cb){
      if (customer_id) {
        db.get("SELECT id FROM customers WHERE id=?", [customer_id], (err, row) => {
          if (err) return res.status(500).json({ error: err.message });
          if (row) return cb(customer_id);
          if (!customer_name) return res.status(400).json({ error: 'Customer does not exist. Provide customer_name to auto-create.' });
          db.run("INSERT INTO customers (id, name) VALUES (?, ?)", [customer_id, customer_name], (err2)=>{
            if (err2) return res.status(500).json({ error: err2.message });
            cb(customer_id);
          });
        });
      } else if (customer_name) {
        const newId = genCustomerId(customer_name);
        db.run("INSERT INTO customers (id, name) VALUES (?, ?)", [newId, customer_name], (err)=>{
          if (err) return res.status(500).json({ error: err.message });
          cb(newId);
        });
      } else {
        return res.status(400).json({ error: 'Provide customer_id or customer_name' });
      }
    }

    function ensureProduct(item, cb){
      if (item.product_id){
        // assume exists or let insert fail later if wrong
        return cb(item.product_id);
      }
      if (!item.new_product) return cb(null);
      // Create new product from fields
      const pid = item.new_product_id && String(item.new_product_id).trim() ? String(item.new_product_id).trim() : `P${Date.now().toString().slice(-6)}`;
      // Units: diameter in mm or inches, length in mm/ft/in, coating in µm
      function toMm(val, unit){ const n=Number(val||0); if (unit==='in') return n*25.4; if(unit==='ft') return n*304.8; return n; }
      const steel_diameter = toMm(item.diameter_value, item.diameter_unit||'mm');
      const length = toMm(item.length_value, item.length_unit||'mm');
      const coating = Number(item.coating_um||0);
      const desc = item.description || `${(steel_diameter).toFixed(1)}mm x ${(length/304.8).toFixed(1)}ft - ${coating}µm`;
      db.run("INSERT INTO products (id, description, steel_diameter, copper_coating, length, active) VALUES (?, ?, ?, ?, ?, 1)",
        [pid, desc, steel_diameter, coating, length], (err)=>{
          if (err) return cb(null);
          cb(pid);
        });
    }

    ensureCustomer((finalCustomerId) => {
      db.get('SELECT id FROM client_purchase_orders WHERE id = ?', [id], (checkErr, existing) => {
        if (checkErr) return res.status(500).json({ error: checkErr.message });
        if (existing) return res.status(409).json({ error: 'Client PO ID already exists. Update the PO ID before confirming.' });

        const pdfPath = file_token ? path.join('uploads','client_po', file_token) : null;
        db.run(`INSERT INTO client_purchase_orders (id, customer_id, po_date, due_date, currency, delivery_terms, payment_terms, status, notes, marking, pdf_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, finalCustomerId, po_date, due_date, currency, delivery_terms, payment_terms, status, notes, marking, pdfPath], function(err){
            if (err) return res.status(500).json({ error: err.message });
            if (Array.isArray(items) && items.length){
              const runItems = [...items];
              const stmt = db.prepare("INSERT INTO client_po_line_items (po_id, product_id, quantity, unit_price, line_total, delivered, currency) VALUES (?, ?, ?, ?, ?, 0, ?)");
              (function next(){
                const it = runItems.shift();
                if (!it){
                  stmt.finalize((e)=>{
                    if (e) return res.status(500).json({ error: e.message });
                    res.json({ message: 'Client PO registered with items', customer_id: finalCustomerId });
                  });
                  return;
                }
                ensureProduct(it, (productId)=>{
                  const pid = productId || it.product_id;
                  const qty = Number(it.quantity||0); const up = Number(it.unit_price||0); const curr = it.currency || 'INR';
                  if (!pid){ return next(); }
                  stmt.run([id, pid, qty, up, qty*up, curr], ()=> next());
                });
              })();
            } else {
              res.json({ message: 'Client PO registered', customer_id: finalCustomerId });
            }
          });
      });
    });
  });
  
  // Confirm Vendor PO: auto-create vendor and optional items
  app.post('/api/import/vendor-po/confirm', (req, res) => {
    const { id, vendor_id, vendor_name, contact_person, phone, email, po_date, due_date, status = 'Pending', notes = '', items = [], file_token = '' } = req.body;
    if (!id || !po_date || !due_date) return res.status(400).json({ error: 'Missing required fields (id, po_date, due_date)' });

    function genVendorId(name){
      const base = (name || 'VEND').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6) || 'VEND';
      const suffix = Date.now().toString().slice(-4);
      return `${base}-${suffix}`;
    }

    function ensureVendor(cb){
      if (vendor_id) {
        db.get("SELECT id FROM vendors WHERE id=?", [vendor_id], (err, row) => {
          if (err) return res.status(500).json({ error: err.message });
          if (row) return cb(vendor_id);
          if (!vendor_name) return res.status(400).json({ error: 'Vendor does not exist. Provide vendor_name to auto-create.' });
          db.run("INSERT INTO vendors (id, name, contact_person, phone, email) VALUES (?, ?, ?, ?, ?)", [vendor_id, vendor_name, contact_person||'', phone||'', email||''], (err2)=>{
            if (err2) return res.status(500).json({ error: err2.message });
            cb(vendor_id);
          });
        });
      } else if (vendor_name) {
        const newId = genVendorId(vendor_name);
        db.run("INSERT INTO vendors (id, name, contact_person, phone, email) VALUES (?, ?, ?, ?, ?)", [newId, vendor_name, contact_person||'', phone||'', email||''], (err)=>{
          if (err) return res.status(500).json({ error: err.message });
          cb(newId);
        });
      } else {
        return res.status(400).json({ error: 'Provide vendor_id or vendor_name' });
      }
    }

    ensureVendor((finalVendorId) => {
      const pdfPath = file_token ? path.join('uploads','vendor_po', file_token) : null;
      db.run(`INSERT INTO vendor_purchase_orders (id, vendor_id, po_date, due_date, status, notes, pdf_path) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, finalVendorId, po_date, due_date, status, notes, pdfPath], function(err){
          if (err) return res.status(500).json({ error: err.message });
          if (Array.isArray(items) && items.length){
            const stmt = db.prepare("INSERT INTO vendor_po_items (vpo_id, item, description, qty, unit) VALUES (?, ?, ?, ?, ?)");
            items.forEach(it => stmt.run([id, it.item||'', it.description||'', Number(it.qty||0), it.unit||'pcs']));
            stmt.finalize((e)=>{
              if (e) return res.status(500).json({ error: e.message });
              res.json({ message: 'Vendor PO registered with items', vendor_id: finalVendorId });
            });
          } else {
            res.json({ message: 'Vendor PO registered', vendor_id: finalVendorId });
          }
        });
    });
  });
} else {
  if (upload) {
    app.post('/api/import/client-po/preview', upload.single('file'), (req, res) => handleClientPoPreview(req, res, false));
    app.post('/api/import/vendor-po/preview', upload.single('file'), (req, res) => handleVendorPoPreview(req, res, false));
  } else {
    app.post('/api/import/client-po/preview', (req,res)=> res.status(503).json({ error:'File upload unavailable' }));
    app.post('/api/import/vendor-po/preview', (req,res)=> res.status(503).json({ error:'File upload unavailable' }));
  }
  app.post('/api/import/customer/preview', (req,res)=> res.status(503).json({ error:'PDF import unavailable' }));
  app.post('/api/import/vendor/preview', (req,res)=> res.status(503).json({ error:'PDF import unavailable' }));
}

// ============= CSV BULK IMPORT ENDPOINTS =============
if (upload && csvParse) {
  // Import Vendors from CSV
  app.post('/api/bulk-import/vendors', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const csvData = req.file.buffer.toString('utf-8');
      const records = csvParse.parse(csvData, { columns: true, skip_empty_lines: true });

      let imported = 0, errors = [];

      for (const row of records) {
        try {
          await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO vendors (id, name, office_address, contact_person, phone, email, vendor_type, material_type, city, country)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                row.id || row.vendor_id,
                row.name,
                row.office_address || row.address || '',
                row.contact_person || '',
                row.phone || '',
                row.email || '',
                row.vendor_type || 'Other',
                row.material_type || '',
                row.city || '',
                row.country || ''
              ],
              (err) => err ? reject(err) : resolve()
            );
          });
          imported++;
        } catch (err) {
          errors.push({ row: row.id || row.name, error: err.message });
        }
      }

      res.json({
        message: `Imported ${imported} vendors`,
        imported,
        total: records.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Import Customers from CSV
  app.post('/api/bulk-import/customers', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const csvData = req.file.buffer.toString('utf-8');
      const records = csvParse.parse(csvData, { columns: true, skip_empty_lines: true });

      let imported = 0, errors = [];

      for (const row of records) {
        try {
          await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO customers (id, name, address, contact_person, phone, email, city, country)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                row.id || row.customer_id,
                row.name,
                row.address || '',
                row.contact_person || '',
                row.phone || '',
                row.email || '',
                row.city || '',
                row.country || ''
              ],
              (err) => err ? reject(err) : resolve()
            );
          });
          imported++;
        } catch (err) {
          errors.push({ row: row.id || row.name, error: err.message });
        }
      }

      res.json({
        message: `Imported ${imported} customers`,
        imported,
        total: records.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Import Products from CSV with Auto-BOM Generation
  app.post('/api/bulk-import/products', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const csvData = req.file.buffer.toString('utf-8');
      console.log('CSV Import - First 500 chars:', csvData.substring(0, 500));

      const records = csvParse.parse(csvData, { columns: true, skip_empty_lines: true, trim: true });
      console.log('CSV Import - Parsed records:', records.length);
      if (records.length > 0) {
        console.log('CSV Import - First record columns:', Object.keys(records[0]));
        console.log('CSV Import - First record data:', records[0]);
      }

      let imported = 0, errors = [];

      for (const row of records) {
        try {
          // Normalize column names - support various formats
          const normalizedRow = {};
          for (const [key, value] of Object.entries(row)) {
            const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
            normalizedRow[normalized] = value;
          }

          // Extract values with flexible column name matching
          const productId = row.id || row.ID || row.product_id || normalizedRow.id || normalizedRow.productid;
          const description = row.description || row.Description || row.descriptio || normalizedRow.description;
          const steelDiameter = parseFloat(
            row.steel_diameter || row.steel_dia || row.steel_diam || row['Steel Dia (mm)'] ||
            normalizedRow.steeldiametermm || normalizedRow.steeldiameter ||
            normalizedRow.steeldiam || normalizedRow.diameter || 0
          );
          const copperCoating = parseFloat(
            row.copper_coating || row.coating || row.copper_co || row['Cu Coating'] || row.cu_coating ||
            normalizedRow.cucoating || normalizedRow.coppercoating || normalizedRow.copperco || 0
          );
          const length = parseFloat(
            row.length || row['Length (mm)'] || normalizedRow.lengthmm ||
            normalizedRow.length || 3000
          );

          // Validate required fields
          if (!productId || !steelDiameter || !length) {
            errors.push({
              row: productId || description || 'Unknown',
              error: 'Missing required fields: ID, Steel Diameter, and Length are required'
            });
            continue;
          }

          // Insert product (weight is calculated, not stored)
          await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO products (id, description, steel_diameter, copper_coating, length, cost_price, hs_code, export_description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                productId,
                description || '',
                steelDiameter,
                copperCoating,
                length,
                parseFloat(row.cost_price || normalizedRow.costprice || 0),
                row.hs_code || normalizedRow.hscode || '',
                row.export_description || description || ''
              ],
              (err) => err ? reject(err) : resolve()
            );
          });

          // Auto-generate BOM based on product specifications
          // Calculate steel rod weight (kg) - Formula: (π/4) × diameter² × length × density
          const steelRadiusMM = steelDiameter / 2;
          const steelVolumeMM3 = Math.PI * steelRadiusMM * steelRadiusMM * length;
          const steelWeightKg = (steelVolumeMM3 * 7.85) / 1000000; // Steel density 7.85 g/cm³

          // Calculate copper weight (kg)
          const outerRadiusMM = steelDiameter / 2 + copperCoating / 1000;
          const copperVolumeMM3 = Math.PI * (outerRadiusMM * outerRadiusMM - steelRadiusMM * steelRadiusMM) * length;
          const copperWeightKg = (copperVolumeMM3 * 8.96) / 1000000; // Copper density 8.96 g/cm³

          // Insert Steel requirement
          await new Promise((resolve, reject) => {
            db.run(
              `INSERT OR REPLACE INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?)`,
              [productId, 'Steel', steelWeightKg],
              (err) => err ? reject(err) : resolve()
            );
          });

          // Insert Copper Anode requirement
          await new Promise((resolve, reject) => {
            db.run(
              `INSERT OR REPLACE INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?)`,
              [productId, 'Copper Anode', copperWeightKg],
              (err) => err ? reject(err) : resolve()
            );
          });

          imported++;
        } catch (err) {
          errors.push({ row: row.id || row.description, error: err.message });
        }
      }

      console.log('CSV Import - Results:', { imported, total: records.length, errorCount: errors.length });

      res.json({
        message: imported > 0
          ? `Imported ${imported} products with auto-generated BOMs`
          : `No products imported. ${errors.length} errors occurred.`,
        imported,
        total: records.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error('CSV Import - Fatal error:', error);
      res.status(500).json({ error: error.message, details: 'Check server logs for more information' });
    }
  });
}

// ============= Serve stored PDFs =============
app.get('/api/client-pos/:id/pdf', (req, res) => {
  const { id } = req.params;
  db.get('SELECT pdf_path FROM client_purchase_orders WHERE id=?', [id], (err, row) => {
    if (err || !row || !row.pdf_path) return res.status(404).send('Not found');
    const full = path.isAbsolute(row.pdf_path) ? row.pdf_path : path.join(__dirname, row.pdf_path);
    res.sendFile(full, (e) => { if (e) res.status(404).send('Not found'); });
  });
});

// Update inventory counts for a product (absolute set)
app.put('/api/inventory/:product_id', (req, res) => {
  const { product_id } = req.params;
  const { plated = 0, machined = 0, qc = 0, stamped = 0, packed = 0 } = req.body || {};
  const sql = `INSERT INTO inventory (product_id, plated, machined, qc, stamped, packed, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(product_id) DO UPDATE SET
                 plated=excluded.plated,
                 machined=excluded.machined,
                 qc=excluded.qc,
                 stamped=excluded.stamped,
                 packed=excluded.packed,
                 updated_at=CURRENT_TIMESTAMP`;
  db.run(sql, [product_id, plated, machined, qc, stamped, packed], function(err){
    if (err) return res.status(500).json({ error: err.message });
    db.get('SELECT i.*, p.description as product_description FROM inventory i LEFT JOIN products p ON i.product_id=p.id WHERE i.product_id=?', [product_id], (e,row)=>{
      if (e) return res.status(500).json({ error: e.message });
      res.json(row);
    });
  });
});

// Delete inventory row for a product
app.delete('/api/inventory/:product_id', (req, res) => {
  const { product_id } = req.params;
  db.run('DELETE FROM inventory WHERE product_id=?', [product_id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message:'Deleted', changes: this.changes });
  });
});

// Delete a production entry and roll back inventory counts
app.delete('/api/production/:id', (req, res) => {
  const { id } = req.params;
  db.get(`SELECT * FROM production_history WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Production entry not found' });
    const { product_id, plated=0, machined=0, qc=0, stamped=0, packed=0 } = row;
    db.serialize(() => {
      db.run('BEGIN');
      db.run(`
        UPDATE inventory SET
          plated   = MAX(plated   - ?, 0),
          machined = MAX(machined - ?, 0),
          qc       = MAX(qc       - ?, 0),
          stamped  = MAX(stamped  - ?, 0),
          packed   = MAX(packed   - ?, 0),
          updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
      `, [plated||0, machined||0, qc||0, stamped||0, packed||0, product_id], (uerr) => {
        if (uerr) { try { db.run('ROLLBACK'); } catch(_){} return res.status(500).json({ error: uerr.message }); }
        db.run(`DELETE FROM production_history WHERE id = ?`, [id], (derr) => {
          if (derr) { try { db.run('ROLLBACK'); } catch(_){} return res.status(500).json({ error: derr.message }); }
          db.run('COMMIT', (cerr) => {
            if (cerr) return res.status(500).json({ error: cerr.message });
            res.json({ message: 'Production entry deleted' });
          });
        });
      });
    });
  });
});

// Bulk delete production entries
app.post('/api/production/bulk-delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'No production IDs provided' });
  const result = { deleted: 0, failed: [] };
  const next = () => {
    if (!ids.length) return res.json({ message: 'Bulk delete completed', ...result });
    const id = ids.shift();
    db.get(`SELECT * FROM production_history WHERE id = ?`, [id], (err, row) => {
      if (err || !row) { result.failed.push({ id, error: err ? err.message : 'Not found' }); return next(); }
      const { product_id, plated=0, machined=0, qc=0, stamped=0, packed=0 } = row;
      db.serialize(() => {
        db.run('BEGIN');
        db.run(`
          UPDATE inventory SET
            plated   = MAX(plated   - ?, 0),
            machined = MAX(machined - ?, 0),
            qc       = MAX(qc       - ?, 0),
            stamped  = MAX(stamped  - ?, 0),
            packed   = MAX(packed   - ?, 0),
            updated_at = CURRENT_TIMESTAMP
          WHERE product_id = ?
        `, [plated||0, machined||0, qc||0, stamped||0, packed||0, product_id], (uerr) => {
          if (uerr) { try { db.run('ROLLBACK'); } catch(_){}; result.failed.push({ id, error: uerr.message }); return next(); }
          db.run(`DELETE FROM production_history WHERE id = ?`, [id], (derr) => {
            if (derr) { try { db.run('ROLLBACK'); } catch(_){}; result.failed.push({ id, error: derr.message }); return next(); }
            db.run('COMMIT', (cerr) => {
              if (cerr) { result.failed.push({ id, error: cerr.message }); } else { result.deleted += 1; }
              next();
            });
          });
        });
      });
    });
  };
  next();
});

app.get('/api/vendor-pos/:id/pdf', (req, res) => {
  const { id } = req.params;
  db.get('SELECT pdf_path FROM vendor_purchase_orders WHERE id=?', [id], (err, row) => {
    if (err || !row || !row.pdf_path) return res.status(404).send('Not found');
    const full = path.isAbsolute(row.pdf_path) ? row.pdf_path : path.join(__dirname, row.pdf_path);
    res.sendFile(full, (e) => { if (e) res.status(404).send('Not found'); });
  });
});

// ============= INVOICE & PAYMENT APIs =============

// Get all invoices
app.get('/api/invoices', (req, res) => {
  db.all('SELECT * FROM invoices ORDER BY invoice_date DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Get single invoice with line items
app.get('/api/invoices/:invoice_number', (req, res) => {
  const { invoice_number } = req.params;
  db.get('SELECT * FROM invoices WHERE invoice_number = ?', [invoice_number], (err, invoice) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    db.all('SELECT * FROM invoice_line_items WHERE invoice_number = ?', [invoice_number], (err2, items) => {
      if (err2) return res.status(500).json({ error: err2.message });
      invoice.line_items = items || [];
      res.json(invoice);
    });
  });
});

// Create invoice from Client PO
app.post('/api/invoices/generate-from-po/:po_id', (req, res) => {
  const { po_id } = req.params;
  const { invoice_number, invoice_date, due_date, tax_rate = 0 } = req.body;

  if (!invoice_number || !invoice_date) {
    return res.status(400).json({ error: 'Invoice number and date are required' });
  }

  // Get PO details
  db.get('SELECT * FROM client_purchase_orders WHERE id = ?', [po_id], (err, po) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });

    // Get customer details
    db.get('SELECT * FROM customers WHERE id = ?', [po.customer_id], (err2, customer) => {
      if (err2) return res.status(500).json({ error: err2.message });

      // Get PO line items
      db.all('SELECT * FROM client_po_line_items WHERE po_id = ?', [po_id], (err3, lineItems) => {
        if (err3) return res.status(500).json({ error: err3.message });

        // Calculate totals
        let subtotal = 0;
        lineItems.forEach(item => {
          subtotal += item.quantity * item.unit_price;
        });

        const tax_amount = subtotal * (tax_rate / 100);
        const total_amount = subtotal + tax_amount;

        // Create invoice
        db.run(
          `INSERT INTO invoices (
            invoice_number, po_id, invoice_date, due_date,
            customer_name, customer_address, customer_gstin,
            subtotal, tax_amount, total_amount,
            outstanding_amount, payment_status, currency, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoice_number, po_id, invoice_date, due_date || invoice_date,
            customer?.name || po.customer_id,
            customer?.office_address || '',
            customer?.gstin || '',
            subtotal, tax_amount, total_amount,
            total_amount, 'Pending', po.currency || 'INR', po.notes || ''
          ],
          function(err4) {
            if (err4) {
              if (err4.message.includes('UNIQUE')) {
                return res.status(400).json({ error: 'Invoice number already exists' });
              }
              return res.status(500).json({ error: err4.message });
            }

            // Create invoice line items
            const insertLineItem = (item, callback) => {
              db.run(
                `INSERT INTO invoice_line_items (
                  invoice_number, product_id, description, hsn_code,
                  quantity, unit_price, tax_rate, tax_amount, line_total
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  invoice_number, item.product_id, item.description || '',
                  item.hs_code || '', item.quantity, item.unit_price,
                  tax_rate, (item.quantity * item.unit_price * tax_rate / 100),
                  item.quantity * item.unit_price
                ],
                callback
              );
            };

            let completed = 0;
            if (lineItems.length === 0) {
              // Update PO with invoice details
              db.run(
                `UPDATE client_purchase_orders SET
                  invoice_number = ?, invoice_date = ?,
                  total_amount = ?, outstanding_amount = ?,
                  payment_status = 'Pending'
                WHERE id = ?`,
                [invoice_number, invoice_date, total_amount, total_amount, po_id],
                () => {
                  res.json({
                    message: 'Invoice created successfully',
                    invoice_number, total_amount
                  });
                }
              );
            } else {
              lineItems.forEach(item => {
                insertLineItem(item, (err5) => {
                  if (err5) console.error('Line item insert error:', err5);
                  completed++;
                  if (completed === lineItems.length) {
                    // Update PO with invoice details
                    db.run(
                      `UPDATE client_purchase_orders SET
                        invoice_number = ?, invoice_date = ?,
                        total_amount = ?, outstanding_amount = ?,
                        payment_status = 'Pending'
                      WHERE id = ?`,
                      [invoice_number, invoice_date, total_amount, total_amount, po_id],
                      () => {
                        res.json({
                          message: 'Invoice created successfully',
                          invoice_number, total_amount
                        });
                      }
                    );
                  }
                });
              });
            }
          }
        );
      });
    });
  });
});

// Update invoice
app.put('/api/invoices/:invoice_number', (req, res) => {
  const { invoice_number } = req.params;
  const { due_date, notes, payment_status } = req.body;

  db.run(
    `UPDATE invoices SET
      due_date = COALESCE(?, due_date),
      notes = COALESCE(?, notes),
      payment_status = COALESCE(?, payment_status),
      updated_at = CURRENT_TIMESTAMP
    WHERE invoice_number = ?`,
    [due_date, notes, payment_status, invoice_number],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Invoice not found' });
      }
      res.json({ message: 'Invoice updated successfully' });
    }
  );
});

// Delete invoice
app.delete('/api/invoices/:invoice_number', (req, res) => {
  const { invoice_number } = req.params;

  // Delete line items first
  db.run('DELETE FROM invoice_line_items WHERE invoice_number = ?', [invoice_number], (err) => {
    if (err) return res.status(500).json({ error: err.message });

    // Delete payments
    db.run('DELETE FROM payment_history WHERE invoice_number = ?', [invoice_number], (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });

      // Delete invoice
      db.run('DELETE FROM invoices WHERE invoice_number = ?', [invoice_number], function(err3) {
        if (err3) return res.status(500).json({ error: err3.message });
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Invoice not found' });
        }
        res.json({ message: 'Invoice deleted successfully' });
      });
    });
  });
});

// Get payment history
app.get('/api/payments', (req, res) => {
  const { invoice_number, po_id } = req.query;
  let query = 'SELECT * FROM payment_history';
  let params = [];

  if (invoice_number) {
    query += ' WHERE invoice_number = ?';
    params.push(invoice_number);
  } else if (po_id) {
    query += ' WHERE po_id = ?';
    params.push(po_id);
  }

  query += ' ORDER BY payment_date DESC';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Record payment
app.post('/api/payments', (req, res) => {
  const { invoice_number, po_id, payment_date, amount, payment_method, reference_number, notes } = req.body;

  if (!invoice_number || !payment_date || !amount) {
    return res.status(400).json({ error: 'Invoice number, payment date, and amount are required' });
  }

  // Insert payment record
  db.run(
    `INSERT INTO payment_history (
      invoice_number, po_id, payment_date, amount,
      payment_method, reference_number, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [invoice_number, po_id, payment_date, amount, payment_method, reference_number, notes],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });

      // Update invoice amounts
      db.get('SELECT amount_paid, total_amount FROM invoices WHERE invoice_number = ?', [invoice_number], (err2, invoice) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

        const new_amount_paid = (invoice.amount_paid || 0) + parseFloat(amount);
        const new_outstanding = invoice.total_amount - new_amount_paid;
        const new_status = new_outstanding <= 0 ? 'Paid' : new_outstanding < invoice.total_amount ? 'Partial' : 'Pending';

        db.run(
          `UPDATE invoices SET
            amount_paid = ?,
            outstanding_amount = ?,
            payment_status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE invoice_number = ?`,
          [new_amount_paid, new_outstanding, new_status, invoice_number],
          (err3) => {
            if (err3) return res.status(500).json({ error: err3.message });

            // Update client PO
            if (po_id) {
              db.run(
                `UPDATE client_purchase_orders SET
                  amount_paid = ?,
                  outstanding_amount = ?,
                  payment_status = ?
                WHERE id = ?`,
                [new_amount_paid, new_outstanding, new_status, po_id],
                () => {
                  res.json({
                    message: 'Payment recorded successfully',
                    payment_id: this.lastID,
                    new_amount_paid,
                    new_outstanding,
                    new_status
                  });
                }
              );
            } else {
              res.json({
                message: 'Payment recorded successfully',
                payment_id: this.lastID,
                new_amount_paid,
                new_outstanding,
                new_status
              });
            }
          }
        );
      });
    }
  );
});

// Delete payment
app.delete('/api/payments/:id', (req, res) => {
  const { id } = req.params;

  // Get payment details before deleting
  db.get('SELECT * FROM payment_history WHERE id = ?', [id], (err, payment) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    // Delete payment
    db.run('DELETE FROM payment_history WHERE id = ?', [id], function(err2) {
      if (err2) return res.status(500).json({ error: err2.message });

      // Update invoice amounts
      db.get('SELECT amount_paid, total_amount FROM invoices WHERE invoice_number = ?', [payment.invoice_number], (err3, invoice) => {
        if (err3 || !invoice) return res.json({ message: 'Payment deleted' });

        const new_amount_paid = Math.max(0, (invoice.amount_paid || 0) - parseFloat(payment.amount));
        const new_outstanding = invoice.total_amount - new_amount_paid;
        const new_status = new_outstanding <= 0 ? 'Paid' : new_outstanding < invoice.total_amount ? 'Partial' : 'Pending';

        db.run(
          `UPDATE invoices SET
            amount_paid = ?,
            outstanding_amount = ?,
            payment_status = ?
          WHERE invoice_number = ?`,
          [new_amount_paid, new_outstanding, new_status, payment.invoice_number],
          () => {
            // Update client PO if exists
            if (payment.po_id) {
              db.run(
                `UPDATE client_purchase_orders SET
                  amount_paid = ?,
                  outstanding_amount = ?,
                  payment_status = ?
                WHERE id = ?`,
                [new_amount_paid, new_outstanding, new_status, payment.po_id],
                () => res.json({ message: 'Payment deleted successfully' })
              );
            } else {
              res.json({ message: 'Payment deleted successfully' });
            }
          }
        );
      });
    });
  });
});

// ============= AUDIT LOG & UNDO APIs =============

// Get audit log for a specific record
app.get('/api/audit-log/:table/:recordId', (req, res) => {
  const { table, recordId } = req.params;
  db.all(
    `SELECT * FROM audit_log WHERE table_name = ? AND record_id = ? ORDER BY timestamp DESC LIMIT 50`,
    [table, recordId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Get recent audit log entries
app.get('/api/audit-log', (req, res) => {
  const { limit = 100 } = req.query;
  db.all(
    `SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?`,
    [Math.min(parseInt(limit, 10), 500)],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Undo a soft delete (restore)
app.post('/api/undo/:table/:recordId', (req, res) => {
  const { table, recordId } = req.params;

  const allowedTables = ['client_purchase_orders', 'vendor_purchase_orders', 'shipments', 'production_history'];
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ error: 'Invalid table for undo operation' });
  }

  db.serialize(() => {
    db.run('BEGIN');

    // Get the record to verify it's soft-deleted
    db.get(`SELECT * FROM ${table} WHERE id = ?`, [recordId], (err, record) => {
      if (err) {
        try { db.run('ROLLBACK'); } catch(_){}
        return res.status(500).json({ error: err.message });
      }
      if (!record) {
        try { db.run('ROLLBACK'); } catch(_){}
        return res.status(404).json({ error: 'Record not found' });
      }
      if (record.is_deleted !== 1) {
        try { db.run('ROLLBACK'); } catch(_){}
        return res.status(400).json({ error: 'Record is not deleted' });
      }

      // Restore the record
      db.run(`UPDATE ${table} SET is_deleted = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [recordId], (restoreErr) => {
        if (restoreErr) {
          try { db.run('ROLLBACK'); } catch(_){}
          return res.status(500).json({ error: restoreErr.message });
        }

        // If restoring a PO, recommit inventory
        if (table === 'client_purchase_orders') {
          db.all(`SELECT product_id, quantity FROM client_po_line_items WHERE po_id = ?`, [recordId], (itemErr, items) => {
            if (!itemErr && items) {
              items.forEach(item => {
                updateInventoryCommitment(item.product_id, Number(item.quantity || 0), () => {});
              });
            }

            logAudit(table, recordId, 'RESTORE', null, record);
            db.run('COMMIT', (cerr) => {
              if (cerr) return res.status(500).json({ error: cerr.message });
              res.json({ message: 'Record restored successfully', record });
            });
          });
        } else {
          logAudit(table, recordId, 'RESTORE', null, record);
          db.run('COMMIT', (cerr) => {
            if (cerr) return res.status(500).json({ error: cerr.message });
            res.json({ message: 'Record restored successfully', record });
          });
        }
      });
    });
  });
});

// ============= DOCUMENT ATTACHMENT APIs =============

// Upload document attachment
if (upload) {
  app.post('/api/attachments/:entityType/:entityId', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const { entityType, entityId } = req.params;
      const allowedTypes = ['client_po', 'vendor_po', 'customer', 'vendor', 'shipment'];

      if (!allowedTypes.includes(entityType)) {
        return res.status(400).json({ error: 'Invalid entity type' });
      }

      const dir = path.join(__dirname, 'uploads', 'attachments', entityType, entityId);
      await ensureDir(dir);

      const fileName = `${Date.now()}_${req.file.originalname}`;
      const filePath = path.join(dir, fileName);
      await fsp.writeFile(filePath, req.file.buffer);

      const relativePath = path.relative(__dirname, filePath).replace(/\\/g, '/');

      db.run(
        `INSERT INTO document_attachments (entity_type, entity_id, file_name, file_path, file_size, mime_type)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entityType, entityId, req.file.originalname, relativePath, req.file.size, req.file.mimetype],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          logAudit('document_attachments', this.lastID.toString(), 'CREATE', null, { entityType, entityId, fileName: req.file.originalname });
          res.json({ message: 'File uploaded successfully', id: this.lastID, file_name: req.file.originalname });
        }
      );
    } catch (err) {
      res.status(500).json({ error: err.message || 'Upload failed' });
    }
  });
}

// Get attachments for an entity
app.get('/api/attachments/:entityType/:entityId', (req, res) => {
  const { entityType, entityId } = req.params;
  db.all(
    `SELECT * FROM document_attachments WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at DESC`,
    [entityType, entityId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// Download attachment
app.get('/api/attachments/download/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM document_attachments WHERE id = ?', [id], (err, attachment) => {
    if (err || !attachment) return res.status(404).send('Attachment not found');
    const fullPath = path.join(__dirname, attachment.file_path);
    res.download(fullPath, attachment.file_name, (downloadErr) => {
      if (downloadErr) res.status(404).send('File not found');
    });
  });
});

// Delete attachment
app.delete('/api/attachments/:id', (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM document_attachments WHERE id = ?', [id], (err, attachment) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

    const fullPath = path.join(__dirname, attachment.file_path);
    fs.unlink(fullPath, (unlinkErr) => {
      if (unlinkErr) console.warn('File deletion warning:', unlinkErr.message);

      db.run('DELETE FROM document_attachments WHERE id = ?', [id], (delErr) => {
        if (delErr) return res.status(500).json({ error: delErr.message });
        logAudit('document_attachments', id, 'DELETE', attachment, null);
        res.json({ message: 'Attachment deleted successfully' });
      });
    });
  });
});

// ============= VALIDATION & AVAILABILITY CHECK APIs =============

// Check inventory availability for a PO before creation
app.post('/api/inventory/check-availability', (req, res) => {
  const { line_items = [] } = req.body;

  if (!line_items || line_items.length === 0) {
    return res.json({ available: true, details: [] });
  }

  const productIds = line_items.map(item => item.product_id);
  const placeholders = productIds.map(() => '?').join(',');

  db.all(
    `SELECT product_id, packed, committed FROM inventory WHERE product_id IN (${placeholders})`,
    productIds,
    (err, inventoryRows) => {
      if (err) return res.status(500).json({ error: err.message });

      const inventoryMap = {};
      (inventoryRows || []).forEach(row => {
        inventoryMap[row.product_id] = {
          packed: Number(row.packed || 0),
          committed: Number(row.committed || 0),
          available: Number(row.packed || 0) - Number(row.committed || 0)
        };
      });

      const details = line_items.map(item => {
        const inv = inventoryMap[item.product_id] || { packed: 0, committed: 0, available: 0 };
        const requested = Number(item.quantity || 0);
        const shortfall = Math.max(0, requested - inv.available);

        return {
          product_id: item.product_id,
          requested: requested,
          available: inv.available,
          packed: inv.packed,
          committed: inv.committed,
          sufficient: requested <= inv.available,
          shortfall: shortfall
        };
      });

      const allAvailable = details.every(d => d.sufficient);

      res.json({
        available: allAvailable,
        details: details,
        warnings: details.filter(d => !d.sufficient).map(d => `${d.product_id}: Need ${d.requested}, only ${d.available} available (shortfall: ${d.shortfall})`)
      });
    }
  );
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Nikkon Ferro Ground Rod ERP Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`\n✅ Ready to accept connections!\n`);
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('\n✅ Database connection closed');
    process.exit(0);
  });
});
