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
let multer = null; let pdfParse = null; let csvParse = null; let AfterShip = null; let GoogleGenAI = null; let Anthropic = null;
try { multer = require('multer'); } catch(_) {}
try { pdfParse = require('pdf-parse'); } catch(_) {}
try { csvParse = require('csv-parse/sync'); } catch(_) {}
try { AfterShip = require('aftership').default || require('aftership'); } catch(_) {}
try { GoogleGenAI = require('@google/genai').GoogleGenAI; } catch(_) {}
try { Anthropic = require('@anthropic-ai/sdk').Anthropic; } catch(_) {}
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

    // Customer contacts table (for multiple contacts per customer)
    db.run(`CREATE TABLE IF NOT EXISTS customer_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT,
      phone TEXT,
      email TEXT,
      is_primary BOOLEAN DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
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

    // NEW: Weighted Average Costing - Add cost tracking to raw materials inventory
    db.run("ALTER TABLE raw_materials_inventory ADD COLUMN total_value REAL DEFAULT 0", (_err) => { /* ignore if already exists */ });
    db.run("ALTER TABLE raw_materials_inventory ADD COLUMN average_cost_per_unit REAL DEFAULT 0", (_err) => { /* ignore if already exists */ });
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

    // Add missing columns to client_po_line_items if they don't exist
    db.run("ALTER TABLE client_po_line_items ADD COLUMN currency TEXT DEFAULT 'INR'", (err) => { /* ignore if exists */ });
    db.run("ALTER TABLE client_po_line_items ADD COLUMN marking TEXT", (err) => { /* ignore if exists */ });
    db.run("ALTER TABLE client_po_line_items ADD COLUMN due_date DATE", (err) => { /* ignore if exists */ });
    db.run("ALTER TABLE client_po_line_items ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => { /* ignore if exists */ });

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

        // Add threading support to production history
    db.run("ALTER TABLE production_history ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => { /* ignore if exists */ });

    // Stock Adjustments table for opening balances and corrections
    db.run(`CREATE TABLE IF NOT EXISTS stock_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adjustment_date DATE NOT NULL,
      product_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      adjustment_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      notes TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )`);

    // Drawing Operations table for in-house steel core production
    db.run(`CREATE TABLE IF NOT EXISTS drawing_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drawing_date DATE NOT NULL,
      product_id TEXT NOT NULL,
      raw_steel_material TEXT NOT NULL,
      steel_consumed REAL NOT NULL,
      cores_produced INTEGER NOT NULL,
      cores_rejected INTEGER NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_deleted INTEGER DEFAULT 0,
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
    db.all("PRAGMA table_info(customers)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('city')) db.run("ALTER TABLE customers ADD COLUMN city TEXT", ()=>{}); if(!n.includes('country')) db.run("ALTER TABLE customers ADD COLUMN country TEXT", ()=>{}); if(!n.includes('is_deleted')) db.run("ALTER TABLE customers ADD COLUMN is_deleted INTEGER DEFAULT 0", ()=>{}); } });
    db.all("PRAGMA table_info(vendors)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('city')) db.run("ALTER TABLE vendors ADD COLUMN city TEXT", ()=>{}); if(!n.includes('country')) db.run("ALTER TABLE vendors ADD COLUMN country TEXT", ()=>{}); if(!n.includes('vendor_type')) db.run("ALTER TABLE vendors ADD COLUMN vendor_type TEXT", ()=>{}); if(!n.includes('is_deleted')) db.run("ALTER TABLE vendors ADD COLUMN is_deleted INTEGER DEFAULT 0", ()=>{}); } });
    db.all("PRAGMA table_info(products)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('category')) db.run("ALTER TABLE products ADD COLUMN category TEXT", ()=>{}); if(!n.includes('product_type')) db.run("ALTER TABLE products ADD COLUMN product_type TEXT", ()=>{}); if(!n.includes('custom_bom')) db.run("ALTER TABLE products ADD COLUMN custom_bom INTEGER", ()=>{}); if(!n.includes('width')) db.run("ALTER TABLE products ADD COLUMN width REAL", ()=>{}); if(!n.includes('height')) db.run("ALTER TABLE products ADD COLUMN height REAL", ()=>{}); if(!n.includes('thickness')) db.run("ALTER TABLE products ADD COLUMN thickness REAL", ()=>{}); if(!n.includes('is_deleted')) db.run("ALTER TABLE products ADD COLUMN is_deleted INTEGER DEFAULT 0", ()=>{}); if(!n.includes('threading')) db.run("ALTER TABLE products ADD COLUMN threading TEXT DEFAULT 'Plain'", ()=>{}); if(!n.includes('base_product_id')) db.run("ALTER TABLE products ADD COLUMN base_product_id TEXT", ()=>{}); } });
    db.all("PRAGMA table_info(vendor_po_line_items)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('description')) db.run("ALTER TABLE vendor_po_line_items ADD COLUMN description TEXT", ()=>{}); if(!n.includes('unit')) db.run("ALTER TABLE vendor_po_line_items ADD COLUMN unit TEXT", ()=>{}); } });
    db.all("PRAGMA table_info(inventory)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('committed')) db.run("ALTER TABLE inventory ADD COLUMN committed INTEGER", ()=>{}); } });
    db.all("PRAGMA table_info(client_purchase_orders)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('is_deleted')) db.run("ALTER TABLE client_purchase_orders ADD COLUMN is_deleted INTEGER", ()=>{}); if(!n.includes('advance_percent')) db.run("ALTER TABLE client_purchase_orders ADD COLUMN advance_percent REAL", ()=>{}); if(!n.includes('balance_payment_terms')) db.run("ALTER TABLE client_purchase_orders ADD COLUMN balance_payment_terms TEXT", ()=>{}); if(!n.includes('mode_of_delivery')) db.run("ALTER TABLE client_purchase_orders ADD COLUMN mode_of_delivery TEXT", ()=>{}); if(!n.includes('expected_delivery_date')) db.run("ALTER TABLE client_purchase_orders ADD COLUMN expected_delivery_date TEXT", ()=>{}); if(!n.includes('pdf_path')) db.run("ALTER TABLE client_purchase_orders ADD COLUMN pdf_path TEXT", ()=>{}); } });
    db.all("PRAGMA table_info(invoices)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('advance_percent')) db.run("ALTER TABLE invoices ADD COLUMN advance_percent REAL", ()=>{}); if(!n.includes('balance_payment_terms')) db.run("ALTER TABLE invoices ADD COLUMN balance_payment_terms TEXT", ()=>{}); if(!n.includes('mode_of_delivery')) db.run("ALTER TABLE invoices ADD COLUMN mode_of_delivery TEXT", ()=>{}); if(!n.includes('expected_delivery_date')) db.run("ALTER TABLE invoices ADD COLUMN expected_delivery_date TEXT", ()=>{}); } });
    db.all("PRAGMA table_info(vendor_purchase_orders)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('is_deleted')) db.run("ALTER TABLE vendor_purchase_orders ADD COLUMN is_deleted INTEGER", ()=>{}); } });
    db.all("PRAGMA table_info(shipments)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('is_deleted')) db.run("ALTER TABLE shipments ADD COLUMN is_deleted INTEGER", ()=>{}); if(!n.includes('carrier')) db.run("ALTER TABLE shipments ADD COLUMN carrier TEXT", ()=>{}); if(!n.includes('destination')) db.run("ALTER TABLE shipments ADD COLUMN destination TEXT", ()=>{}); if(!n.includes('tracking_number')) db.run("ALTER TABLE shipments ADD COLUMN tracking_number TEXT", ()=>{}); if(!n.includes('tracking_status')) db.run("ALTER TABLE shipments ADD COLUMN tracking_status TEXT", ()=>{}); if(!n.includes('tracking_last_updated')) db.run("ALTER TABLE shipments ADD COLUMN tracking_last_updated DATETIME", ()=>{}); if(!n.includes('estimated_delivery')) db.run("ALTER TABLE shipments ADD COLUMN estimated_delivery TEXT", ()=>{}); if(!n.includes('carrier_detected')) db.run("ALTER TABLE shipments ADD COLUMN carrier_detected TEXT", ()=>{}); } });
    db.all("PRAGMA table_info(production_history)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('is_deleted')) db.run("ALTER TABLE production_history ADD COLUMN is_deleted INTEGER", ()=>{}); if(!n.includes('marking_type')) db.run("ALTER TABLE production_history ADD COLUMN marking_type TEXT DEFAULT 'unmarked'", ()=>{}); if(!n.includes('marking_text')) db.run("ALTER TABLE production_history ADD COLUMN marking_text TEXT", ()=>{}); if(!n.includes('allocated_po_id')) db.run("ALTER TABLE production_history ADD COLUMN allocated_po_id TEXT", ()=>{}); } });
    db.all("PRAGMA table_info(client_po_line_items)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('marking_type')) db.run("ALTER TABLE client_po_line_items ADD COLUMN marking_type TEXT DEFAULT 'unmarked'", ()=>{}); if(!n.includes('marking_text')) db.run("ALTER TABLE client_po_line_items ADD COLUMN marking_text TEXT", ()=>{}); } });
    db.all("PRAGMA table_info(job_work_orders)", (err, cols) => { if (!err && Array.isArray(cols)){ const n=cols.map(c=>c.name); if(!n.includes('raw_steel_material')) db.run("ALTER TABLE job_work_orders ADD COLUMN raw_steel_material TEXT", ()=>{}); if(!n.includes('steel_consumed')) db.run("ALTER TABLE job_work_orders ADD COLUMN steel_consumed REAL", ()=>{}); if(!n.includes('cores_produced')) db.run("ALTER TABLE job_work_orders ADD COLUMN cores_produced INTEGER", ()=>{}); if(!n.includes('cores_rejected')) db.run("ALTER TABLE job_work_orders ADD COLUMN cores_rejected INTEGER", ()=>{}); if(!n.includes('core_product_id')) db.run("ALTER TABLE job_work_orders ADD COLUMN core_product_id TEXT", ()=>{}); if(!n.includes('unit_rate')) db.run("ALTER TABLE job_work_orders ADD COLUMN unit_rate REAL DEFAULT 0", ()=>{}); if(!n.includes('total_cost')) db.run("ALTER TABLE job_work_orders ADD COLUMN total_cost REAL DEFAULT 0", ()=>{}); } });

    // Inventory allocations table for tracking marked/branded inventory
    db.run(`CREATE TABLE IF NOT EXISTS inventory_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      marking_type TEXT NOT NULL,
      marking_text TEXT,
      quantity INTEGER NOT NULL,
      allocated_po_id TEXT,
      allocated_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (allocated_po_id) REFERENCES client_purchase_orders(id)
    )`);

        // Add threading support to inventory allocations
    db.run("ALTER TABLE inventory_allocations ADD COLUMN threading TEXT DEFAULT 'Plain'", (err) => { /* ignore if exists */ });

    // MIGRATION NOTE (v20.2): Clean up old packed allocations if needed
    // The system now only tracks markings at the "stamped" stage since stamping
    // and packing are essentially one operation. To clean up historical data, run:
    // DELETE FROM inventory_allocations WHERE stage = 'packed';
    // This is optional and can be done during a maintenance window.

    // Copper Anode Scrap Sales table
    db.run(`CREATE TABLE IF NOT EXISTS copper_scrap_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_date DATE NOT NULL,
      quantity_kg REAL NOT NULL,
      rate_per_kg REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      buyer_name TEXT,
      invoice_number TEXT,
      total_value REAL GENERATED ALWAYS AS (quantity_kg * rate_per_kg) STORED,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    insertSampleData();
  });
}

// ============= Copper Scrap Sales API =============
app.get('/api/copper-scrap-sales', (req, res) => {
  db.all(`SELECT * FROM copper_scrap_sales ORDER BY sale_date DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post('/api/copper-scrap-sales', (req, res) => {
  const { sale_date, quantity_kg, rate_per_kg, currency, buyer_name, invoice_number, notes } = req.body;

  if (!sale_date || !quantity_kg || !rate_per_kg) {
    return res.status(400).json({ error: 'Date, quantity, and rate are required' });
  }

  const normalizedDate = normalizeDateInput(sale_date);

  db.run(
    `INSERT INTO copper_scrap_sales (sale_date, quantity_kg, rate_per_kg, currency, buyer_name, invoice_number, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [normalizedDate, quantity_kg, rate_per_kg, currency || 'INR', buyer_name, invoice_number, notes],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });

      // Deduct from Copper Anode inventory
      db.run(
        `UPDATE raw_materials_inventory
         SET current_stock = current_stock - ?
         WHERE material = 'Copper Anode'`,
        [quantity_kg],
        (updateErr) => {
          if (updateErr) {
            console.error('Warning: Could not update Copper Anode inventory:', updateErr.message);
          }
          res.json({ id: this.lastID, message: 'Scrap sale recorded and inventory updated' });
        }
      );
    }
  );
});

app.put('/api/copper-scrap-sales/:id', (req, res) => {
  const { id } = req.params;
  const { sale_date, quantity_kg, rate_per_kg, currency, buyer_name, invoice_number, notes } = req.body;

  if (!sale_date || !quantity_kg || !rate_per_kg) {
    return res.status(400).json({ error: 'Date, quantity, and rate are required' });
  }

  const normalizedDate = normalizeDateInput(sale_date);

  // Get old quantity to adjust inventory
  db.get(`SELECT quantity_kg FROM copper_scrap_sales WHERE id = ?`, [id], (err, oldRow) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!oldRow) return res.status(404).json({ error: 'Scrap sale not found' });

    const oldQuantity = oldRow.quantity_kg;
    const quantityDiff = quantity_kg - oldQuantity;

    db.run(
      `UPDATE copper_scrap_sales
       SET sale_date = ?, quantity_kg = ?, rate_per_kg = ?, currency = ?,
           buyer_name = ?, invoice_number = ?, notes = ?
       WHERE id = ?`,
      [normalizedDate, quantity_kg, rate_per_kg, currency || 'INR', buyer_name, invoice_number, notes, id],
      function(updateErr) {
        if (updateErr) return res.status(500).json({ error: updateErr.message });

        // Adjust inventory by the difference
        if (quantityDiff !== 0) {
          db.run(
            `UPDATE raw_materials_inventory
             SET current_stock = current_stock - ?
             WHERE material = 'Copper Anode'`,
            [quantityDiff],
            (invErr) => {
              if (invErr) {
                console.error('Warning: Could not adjust Copper Anode inventory:', invErr.message);
              }
            }
          );
        }

        res.json({ message: 'Scrap sale updated successfully' });
      }
    );
  });
});

app.delete('/api/copper-scrap-sales/:id', (req, res) => {
  const { id } = req.params;

  // Get quantity to restore inventory
  db.get(`SELECT quantity_kg FROM copper_scrap_sales WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Scrap sale not found' });

    const quantity = row.quantity_kg;

    db.run(`DELETE FROM copper_scrap_sales WHERE id = ?`, [id], function(deleteErr) {
      if (deleteErr) return res.status(500).json({ error: deleteErr.message });

      // Restore inventory
      db.run(
        `UPDATE raw_materials_inventory
         SET current_stock = current_stock + ?
         WHERE material = 'Copper Anode'`,
        [quantity],
        (restoreErr) => {
          if (restoreErr) {
            console.error('Warning: Could not restore Copper Anode inventory:', restoreErr.message);
          }
          res.json({ message: 'Scrap sale deleted and inventory restored' });
        }
      );
    });
  });
});

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
  db.all(`
    SELECT
      c.*,
      cc.name as primary_contact_name,
      cc.title as primary_contact_title,
      cc.phone as primary_contact_phone,
      cc.email as primary_contact_email
    FROM customers c
    LEFT JOIN customer_contacts cc ON c.id = cc.customer_id AND cc.is_primary = 1
    ORDER BY c.name
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      // For display, use primary contact if available, otherwise fall back to legacy fields
      const customersWithContacts = rows.map(row => ({
        ...row,
        display_contact_person: row.primary_contact_name || row.contact_person,
        display_phone: row.primary_contact_phone || row.phone,
        display_email: row.primary_contact_email || row.email
      }));
      res.json(customersWithContacts);
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

// ============= CUSTOMER CONTACTS APIs =============

// Get all contacts for a customer
app.get('/api/customers/:customerId/contacts', (req, res) => {
  const { customerId } = req.params;
  db.all(
    "SELECT * FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC, name",
    [customerId],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json(rows || []);
      }
    }
  );
});

// Add a contact to a customer
app.post('/api/customers/:customerId/contacts', (req, res) => {
  const { customerId } = req.params;
  const { name, title, phone, email, is_primary, notes } = req.body;

  // If this is being set as primary, unset other primary contacts first
  if (is_primary) {
    db.run(
      "UPDATE customer_contacts SET is_primary = 0 WHERE customer_id = ?",
      [customerId],
      (err) => {
        if (err) console.error('Error unsetting primary:', err);
      }
    );
  }

  db.run(
    "INSERT INTO customer_contacts (customer_id, name, title, phone, email, is_primary, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [customerId, name, title || '', phone || '', email || '', is_primary ? 1 : 0, notes || ''],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ message: 'Contact added successfully', id: this.lastID });
      }
    }
  );
});

// Update a contact
app.put('/api/customers/:customerId/contacts/:contactId', (req, res) => {
  const { customerId, contactId } = req.params;
  const { name, title, phone, email, is_primary, notes } = req.body;

  // If this is being set as primary, unset other primary contacts first
  if (is_primary) {
    db.run(
      "UPDATE customer_contacts SET is_primary = 0 WHERE customer_id = ? AND id != ?",
      [customerId, contactId],
      (err) => {
        if (err) console.error('Error unsetting primary:', err);
      }
    );
  }

  db.run(
    "UPDATE customer_contacts SET name=?, title=?, phone=?, email=?, is_primary=?, notes=? WHERE id=? AND customer_id=?",
    [name, title || '', phone || '', email || '', is_primary ? 1 : 0, notes || '', contactId, customerId],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ message: 'Contact updated successfully' });
      }
    }
  );
});

// Delete a contact
app.delete('/api/customers/:customerId/contacts/:contactId', (req, res) => {
  const { customerId, contactId } = req.params;

  db.run(
    "DELETE FROM customer_contacts WHERE id=? AND customer_id=?",
    [contactId, customerId],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ message: 'Contact deleted successfully' });
      }
    }
  );
});

// Get all contacts across all customers (for email blast)
app.get('/api/customer-contacts/all', (_req, res) => {
  db.all(
    `SELECT cc.*, c.name as customer_name
     FROM customer_contacts cc
     LEFT JOIN customers c ON cc.customer_id = c.id
     ORDER BY c.name, cc.is_primary DESC, cc.name`,
    [],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json(rows || []);
      }
    }
  );
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
  const threading = (req.body.threading||'Plain').toString();
  const base_product_id = req.body.base_product_id ? req.body.base_product_id.toString() : null;

  const runInsert = (schema)=>{
    const cols = ['id','description','steel_diameter','copper_coating','length','width','height','thickness','product_type','custom_bom','threading'];
    const vals = [id, description, steel_diameter, copper_coating, length, width, height, thickness, product_type, custom_bom, threading];
    if (category !== null){ cols.push('category'); vals.push(category); }
    if (base_product_id !== null){ cols.push('base_product_id'); vals.push(base_product_id); }
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
  const oldId = req.params.id;
  const newId = (req.body.id || oldId).toString();
  const description = (req.body.description||'').toString();
  const steel_diameter = Number(req.body.steel_diameter ?? req.body.diameter);
  const copper_coating = Number(req.body.copper_coating ?? req.body.coating);
  const length = Number(req.body.length ?? req.body.length_mm);
  const active = req.body.active ?? 1;
  const category = (req.body.category||'').toString() || null;
  const threading = (req.body.threading||'Plain').toString();
  const base_product_id = req.body.base_product_id ? req.body.base_product_id.toString() : null;

  const runUpdate = (schema)=>{
    // If ID changed, update all related tables
    if (oldId !== newId) {
      db.serialize(() => {
        // Disable foreign keys temporarily to allow PRIMARY KEY update
        db.run('PRAGMA foreign_keys = OFF', ()=>{});

        // Update BOM entries
        db.run('UPDATE bom SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});
        // Update inventory
        db.run('UPDATE inventory SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});
        // Update client PO line items
        db.run('UPDATE client_po_line_items SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});
        // Update shipment items
        db.run('UPDATE shipment_items SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});
        // Update production history
        db.run('UPDATE production_history SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});
        // Update stock adjustments
        db.run('UPDATE stock_adjustments SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});
        // Update drawing operations
        db.run('UPDATE drawing_operations SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});
        // Update job work items
        db.run('UPDATE job_work_items SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});
        // Update job work receipts
        db.run('UPDATE job_work_receipts SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});
        // Update inventory allocations
        db.run('UPDATE inventory_allocations SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});
        // Update vendor PO line items
        db.run('UPDATE vendor_po_line_items SET product_id=? WHERE product_id=?', [newId, oldId], ()=>{});

        // Update product ID itself
        const sets = ['id=?','description=?','steel_diameter=?','copper_coating=?','length=?','active=?','threading=?'];
        const vals = [newId, description, steel_diameter, copper_coating, length, active, threading];
        if (category !== null){ sets.push('category=?'); vals.push(category); }
        if (base_product_id !== null){ sets.push('base_product_id=?'); vals.push(base_product_id); }
        sets.push('updated_at=CURRENT_TIMESTAMP');
        if (schema.hasDiameter) { sets.splice(sets.length-1, 0, 'diameter=?'); vals.splice(vals.length, 0, steel_diameter); }
        if (schema.hasCoating) { sets.splice(sets.length-1, 0, 'coating=?'); vals.splice(vals.length, 0, copper_coating); }
        const sql = `UPDATE products SET ${sets.join(', ')} WHERE id=?`;
        db.run(sql, [...vals, oldId], function(err){
          // Re-enable foreign keys
          db.run('PRAGMA foreign_keys = ON', ()=>{});
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: 'Product updated successfully', newId });
        });
      });
    } else {
      // ID didn't change, just update product fields
      const sets = ['description=?','steel_diameter=?','copper_coating=?','length=?','active=?','threading=?'];
      const vals = [description, steel_diameter, copper_coating, length, active, threading];
      if (category !== null){ sets.push('category=?'); vals.push(category); }
      if (base_product_id !== null){ sets.push('base_product_id=?'); vals.push(base_product_id); }
      sets.push('updated_at=CURRENT_TIMESTAMP');
      if (schema.hasDiameter) { sets.splice(sets.length-1, 0, 'diameter=?'); vals.splice(vals.length, 0, steel_diameter); }
      if (schema.hasCoating) { sets.splice(sets.length-1, 0, 'coating=?'); vals.splice(vals.length, 0, copper_coating); }
      const sql = `UPDATE products SET ${sets.join(', ')} WHERE id=?`;
      db.run(sql, [...vals, oldId], function(err){
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Product updated successfully' });
      });
    }
  };
  if (productsSchema._ready) runUpdate(productsSchema); else refreshProductsSchema(runUpdate);
});

app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;

  // First check if product is referenced in other tables
  const checks = [
    { query: "SELECT COUNT(*) as count FROM client_po_line_items WHERE product_id=?", name: "Client Purchase Orders" },
    { query: "SELECT COUNT(*) as count FROM vendor_po_line_items WHERE product_id=?", name: "Vendor Purchase Orders" },
    { query: "SELECT COUNT(*) as count FROM inventory WHERE product_id=?", name: "Inventory" },
    { query: "SELECT COUNT(*) as count FROM production_history WHERE product_id=?", name: "Production History" },
    { query: "SELECT COUNT(*) as count FROM shipment_items WHERE product_id=?", name: "Shipments" },
    { query: "SELECT COUNT(*) as count FROM job_work_items WHERE product_id=?", name: "Job Work Orders" },
    { query: "SELECT COUNT(*) as count FROM stock_adjustments WHERE product_id=?", name: "Stock Adjustments" },
    { query: "SELECT COUNT(*) as count FROM drawing_operations WHERE product_id=?", name: "Drawing Operations" },
    { query: "SELECT COUNT(*) as count FROM inventory_allocations WHERE product_id=?", name: "Inventory Allocations" }
  ];

  let checkIndex = 0;
  const references = [];

  function checkNext() {
    if (checkIndex >= checks.length) {
      // All checks done
      if (references.length > 0) {
        return res.status(400).json({
          error: 'FOREIGN KEY constraint failed',
          references: references,
          message: `Cannot delete product ${id}. It is being used in: ${references.join(', ')}`
        });
      }

      // No references found, safe to delete. First delete BOM entries, then the product
      db.run("DELETE FROM bom WHERE product_id=?", [id], function(bomErr) {
        // Ignore BOM delete errors, continue with product deletion
        db.run("DELETE FROM products WHERE id=?", [id], function(err) {
          if (err) {
            res.status(500).json({ error: err.message });
          } else {
            res.json({ message: 'Product deleted successfully' });
          }
        });
      });
    } else {
      const check = checks[checkIndex];
      db.get(check.query, [id], (err, row) => {
        if (!err && row && row.count > 0) {
          references.push(`${check.name} (${row.count})`);
        }
        checkIndex++;
        checkNext();
      });
    }
  }

  checkNext();
});

// Force delete product - removes all references first
app.delete('/api/products/:id/force', (req, res) => {
  const { id } = req.params;

  db.serialize(() => {
    db.run('BEGIN');

    const fail = (err) => {
      try { db.run('ROLLBACK'); } catch(_){};
      res.status(500).json({ error: err.message || String(err) });
    };

    // Delete all references in order
    db.run('DELETE FROM bom WHERE product_id=?', [id], (e1) => {
      if (e1) return fail(e1);
      db.run('DELETE FROM client_po_line_items WHERE product_id=?', [id], (e2) => {
        if (e2) return fail(e2);
        db.run('DELETE FROM inventory WHERE product_id=?', [id], (e3) => {
          if (e3) return fail(e3);
          db.run('DELETE FROM production_history WHERE product_id=?', [id], (e4) => {
            if (e4) return fail(e4);
            db.run('DELETE FROM shipment_items WHERE product_id=?', [id], (e5) => {
              if (e5) return fail(e5);
              db.run('DELETE FROM job_work_items WHERE product_id=?', [id], (e6) => {
                if (e6) return fail(e6);
                db.run('DELETE FROM stock_adjustments WHERE product_id=?', [id], (e7) => {
                  if (e7) return fail(e7);
                  db.run('DELETE FROM drawing_operations WHERE product_id=?', [id], (e8) => {
                    if (e8) return fail(e8);
                    db.run('DELETE FROM inventory_allocations WHERE product_id=?', [id], (e9) => {
                      if (e9) return fail(e9);
                      // Finally delete the product itself
                      db.run('DELETE FROM products WHERE id=?', [id], (e10) => {
                        if (e10) return fail(e10);
                        db.run('COMMIT', (e11) => {
                          if (e11) return fail(e11);
                          res.json({ message: 'Product and all references deleted successfully' });
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
    });
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

// Update client PO header
app.put('/api/client-purchase-orders/:id', (req, res) => {
  const { id } = req.params;
  const { customer_id, po_date, due_date, currency, status, notes, advance_percent, balance_payment_terms, mode_of_delivery, expected_delivery_date, marking } = req.body;

  db.run(`
    UPDATE client_purchase_orders
    SET customer_id = ?, po_date = ?, due_date = ?, currency = ?, status = ?, notes = ?,
        advance_percent = ?, balance_payment_terms = ?, mode_of_delivery = ?, expected_delivery_date = ?, marking = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [customer_id, po_date, due_date, currency, status, notes || '', advance_percent || 0, balance_payment_terms || 'on_dispatch', mode_of_delivery || 'FOB', expected_delivery_date || null, marking || '', id],
  function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Purchase order not found' });
    res.json({ message: 'Client PO updated successfully', id });
  });
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
  const { id } = req.params; const { product_id, quantity=0, unit_price=0, currency='INR', marking='', due_date } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id required' });
  const qty = Number(quantity||0); const up = Number(unit_price||0);

  db.serialize(() => {
    db.run('BEGIN');

    // Insert PO line item
    db.run(`INSERT INTO client_po_line_items (po_id, product_id, quantity, unit_price, line_total, delivered, currency, marking, due_date) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`, [id, product_id, qty, up, qty*up, currency, marking || '', due_date || null], function(err){
      if (err) {
        try { db.run('ROLLBACK'); } catch(_) {}
        return res.status(500).json({ error: err.message });
      }

      // Commit raw materials based on BOM
      db.all('SELECT material, qty_per_unit FROM bom WHERE product_id = ?', [product_id], (bomErr, bomRows) => {
        if (bomErr) {
          try { db.run('ROLLBACK'); } catch(_) {}
          return res.status(500).json({ error: bomErr.message });
        }

        if (bomRows && bomRows.length > 0) {
          bomRows.forEach(bom => {
            const requiredQty = qty * Number(bom.qty_per_unit || 0);
            db.run(`UPDATE raw_materials_inventory SET committed_stock = committed_stock + ? WHERE material = ?`, [requiredQty, bom.material]);
          });
        }

        db.run('COMMIT', (commitErr) => {
          if (commitErr) return res.status(500).json({ error: commitErr.message });
          res.json({ message: 'Item added and materials committed', id: this.lastID });
        });
      });
    });
  });
});

app.put('/api/client-purchase-orders/:id/items/:itemId', (req, res) => {
  const { id, itemId } = req.params; const { product_id, quantity, unit_price, currency, due_date, marking } = req.body;
  db.get(`SELECT product_id, quantity, delivered FROM client_po_line_items WHERE id=? AND po_id=?`, [itemId, id], (e, row)=>{
    if (e) return res.status(500).json({ error: e.message });
    if (!row) return res.status(404).json({ error: 'Item not found' });
    const newQty = Number(quantity||0);
    if (newQty < (row.delivered||0)) return res.status(400).json({ error: 'Quantity cannot be less than delivered' });
    const up = Number(unit_price||0);
    const oldQty = Number(row.quantity || 0);
    const qtyDiff = newQty - oldQty;

    db.serialize(() => {
      db.run('BEGIN');

      db.run(`UPDATE client_po_line_items SET product_id=?, quantity=?, unit_price=?, currency=?, due_date=?, marking=?, line_total=? WHERE id=? AND po_id=?`, [product_id, newQty, up, currency || 'INR', due_date || null, marking || '', newQty*up, itemId, id], function(err){
        if (err) {
          try { db.run('ROLLBACK'); } catch(_) {}
          return res.status(500).json({ error: err.message });
        }

        // Adjust committed stock if quantity changed
        if (qtyDiff !== 0) {
          db.all('SELECT material, qty_per_unit FROM bom WHERE product_id = ?', [product_id], (bomErr, bomRows) => {
            if (bomErr) {
              try { db.run('ROLLBACK'); } catch(_) {}
              return res.status(500).json({ error: bomErr.message });
            }

            if (bomRows && bomRows.length > 0) {
              bomRows.forEach(bom => {
                const adjustQty = qtyDiff * Number(bom.qty_per_unit || 0);
                db.run(`UPDATE raw_materials_inventory SET committed_stock = MAX(0, committed_stock + ?) WHERE material = ?`, [adjustQty, bom.material]);
              });
            }

            db.run('COMMIT', (commitErr) => {
              if (commitErr) return res.status(500).json({ error: commitErr.message });
              res.json({ message: 'Item updated and materials adjusted' });
            });
          });
        } else {
          db.run('COMMIT', (commitErr) => {
            if (commitErr) return res.status(500).json({ error: commitErr.message });
            res.json({ message: 'Item updated' });
          });
        }
      });
    });
  });
});

app.delete('/api/client-purchase-orders/:id/items/:itemId', (req, res) => {
  const { id, itemId } = req.params;
  db.get(`SELECT product_id, quantity, delivered FROM client_po_line_items WHERE id=? AND po_id=?`, [itemId, id], (e,row)=>{
    if (e) return res.status(500).json({ error: e.message });
    if (!row) return res.status(404).json({ error: 'Item not found' });
    if ((row.delivered||0) > 0) return res.status(400).json({ error: 'Cannot delete item with delivered quantity' });

    db.serialize(() => {
      db.run('BEGIN');

      db.run(`DELETE FROM client_po_line_items WHERE id=? AND po_id=?`, [itemId, id], function(err){
        if (err) {
          try { db.run('ROLLBACK'); } catch(_) {}
          return res.status(500).json({ error: err.message });
        }

        // Release committed materials
        db.all('SELECT material, qty_per_unit FROM bom WHERE product_id = ?', [row.product_id], (bomErr, bomRows) => {
          if (bomErr) {
            try { db.run('ROLLBACK'); } catch(_) {}
            return res.status(500).json({ error: bomErr.message });
          }

          if (bomRows && bomRows.length > 0) {
            bomRows.forEach(bom => {
              const releaseQty = Number(row.quantity || 0) * Number(bom.qty_per_unit || 0);
              db.run(`UPDATE raw_materials_inventory SET committed_stock = MAX(0, committed_stock - ?) WHERE material = ?`, [releaseQty, bom.material]);
            });
          }

          db.run('COMMIT', (commitErr) => {
            if (commitErr) return res.status(500).json({ error: commitErr.message });
            res.json({ message: 'Item deleted and materials released' });
          });
        });
      });
    });
  });
});

// Delete entire client purchase order
app.delete('/api/client-purchase-orders/:id', (req, res) => {
  const { id } = req.params;

  db.get(`SELECT id FROM client_purchase_orders WHERE id=?`, [id], (e, po) => {
    if (e) return res.status(500).json({ error: e.message });
    if (!po) return res.status(404).json({ error: 'Client PO not found' });

    // Check for linked invoices
    db.get(`SELECT id FROM invoices WHERE po_id=?`, [id], (invErr, invoice) => {
      if (invErr) return res.status(500).json({ error: invErr.message });
      if (invoice) return res.status(400).json({ error: 'Cannot delete PO with linked invoices.' });

      // Check for linked shipments
      db.get(`SELECT id FROM shipments WHERE po_id=?`, [id], (shipErr, shipment) => {
        if (shipErr) return res.status(500).json({ error: shipErr.message });
        if (shipment) return res.status(400).json({ error: 'Cannot delete PO with linked shipments.' });

        // Delete in transaction
        db.serialize(() => {
          db.run('BEGIN');
          db.run(`DELETE FROM client_po_line_items WHERE po_id=?`, [id], (delItemsErr) => {
            if (delItemsErr) {
              try { db.run('ROLLBACK'); } catch(_) {}
              return res.status(500).json({ error: delItemsErr.message });
            }
            db.run(`DELETE FROM client_purchase_orders WHERE id=?`, [id], (delPOErr) => {
              if (delPOErr) {
                try { db.run('ROLLBACK'); } catch(_) {}
                return res.status(500).json({ error: delPOErr.message });
              }
              db.run('COMMIT', (commitErr) => {
                if (commitErr) {
                  try { db.run('ROLLBACK'); } catch(_) {}
                  return res.status(500).json({ error: commitErr.message });
                }
                res.json({ message: 'Client PO deleted successfully' });
              });
            });
          });
        });
      });
    });
  });
})


// DELETE ALL CLIENT POS AND INVOICES (DANGER ZONE)
app.post('/api/admin/delete-all-pos-invoices', (req, res) => {
  const { confirm } = req.body;

  if (confirm !== 'DELETE_ALL') {
    return res.status(400).json({ error: 'Must send {confirm: "DELETE_ALL"} to proceed' });
  }

  console.log('⚠️  DELETING ALL CLIENT POS AND INVOICES');

  db.serialize(() => {
    db.run('PRAGMA foreign_keys = OFF', (err) => {
      if (err) {
        console.error('Error disabling foreign keys:', err.message);
        return res.status(500).json({ error: err.message });
      }

      db.run('BEGIN TRANSACTION');

      db.run('DELETE FROM invoices', (err) => {
        if (err) {
          console.error('Error deleting invoices:', err.message);
          db.run('ROLLBACK');
          db.run('PRAGMA foreign_keys = ON');
          return res.status(500).json({ error: err.message });
        }

        db.run('DELETE FROM shipments', (err) => {
          if (err) {
            console.error('Error deleting shipments:', err.message);
            db.run('ROLLBACK');
            db.run('PRAGMA foreign_keys = ON');
            return res.status(500).json({ error: err.message });
          }

          db.run('DELETE FROM inventory_allocations', (err) => {
            if (err) {
              console.error('Error deleting allocations:', err.message);
              db.run('ROLLBACK');
              db.run('PRAGMA foreign_keys = ON');
              return res.status(500).json({ error: err.message });
            }

            db.run('DELETE FROM client_po_line_items', (err) => {
              if (err) {
                console.error('Error deleting line items:', err.message);
                db.run('ROLLBACK');
                db.run('PRAGMA foreign_keys = ON');
                return res.status(500).json({ error: err.message });
              }

              db.run('DELETE FROM client_purchase_orders', (err) => {
                if (err) {
                  console.error('Error deleting POs:', err.message);
                  db.run('ROLLBACK');
                  db.run('PRAGMA foreign_keys = ON');
                  return res.status(500).json({ error: err.message });
                }

                db.run('COMMIT', (err) => {
                  if (err) {
                    console.error('Error committing:', err.message);
                    db.run('ROLLBACK');
                    db.run('PRAGMA foreign_keys = ON');
                    return res.status(500).json({ error: err.message });
                  }

                  db.run('PRAGMA foreign_keys = ON', (err) => {
                    if (err) {
                      console.error('Error re-enabling foreign keys:', err.message);
                    }

                    console.log('✅ All client POs and invoices deleted');
                    res.json({
                      message: 'Successfully deleted all client POs and invoices',
                      deleted: {
                        invoices: true,
                        shipments: true,
                        allocations: true,
                        line_items: true,
                        purchase_orders: true
                      }
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
});





// Get product usage details across all tables
app.get('/api/products/:id/usage', (req, res) => {
  const { id } = req.params;

  const usage = {
    product_id: id,
    references: {},
    total_references: 0,
    can_delete: true
  };

  const checks = [
    { table: 'bom', query: 'SELECT COUNT(*) as count FROM bom WHERE product_id=?', safe_to_have: true },
    { table: 'inventory', query: 'SELECT steel_rods, plated, machined, stamped, packed FROM inventory WHERE product_id=?', safe_to_have: false },
    { table: 'client_po_line_items', query: 'SELECT COUNT(*) as count FROM client_po_line_items WHERE product_id=?', safe_to_have: false },
    { table: 'production_history', query: 'SELECT COUNT(*) as count FROM production_history WHERE product_id=?', safe_to_have: true },
    { table: 'shipment_items', query: 'SELECT COUNT(*) as count FROM shipment_items WHERE product_id=?', safe_to_have: false },
    { table: 'inventory_allocations', query: 'SELECT COUNT(*) as count FROM inventory_allocations WHERE product_id=?', safe_to_have: false },
    { table: 'stock_adjustments', query: 'SELECT COUNT(*) as count FROM stock_adjustments WHERE product_id=?', safe_to_have: true }
  ];

  let completed = 0;

  checks.forEach(check => {
    db.get(check.query, [id], (err, row) => {
      if (!err && row) {
        if (check.table === 'inventory') {
          const total = (row.steel_rods || 0) + (row.plated || 0) + (row.machined || 0) + (row.stamped || 0) + (row.packed || 0);
          if (total > 0) {
            usage.references[check.table] = {
              count: 1,
              details: row,
              blocking: true
            };
            usage.total_references++;
            if (!check.safe_to_have) usage.can_delete = false;
          }
        } else if (row.count > 0) {
          usage.references[check.table] = {
            count: row.count,
            blocking: !check.safe_to_have
          };
          usage.total_references += row.count;
          if (!check.safe_to_have) usage.can_delete = false;
        }
      }

      completed++;

      if (completed === checks.length) {
        res.json(usage);
      }
    });
  });
});

// FORCE DELETE PRODUCT (removes all references)
app.post('/api/admin/force-delete-product/:id', (req, res) => {
  const { id } = req.params;
  const { confirm } = req.body;

  if (confirm !== 'FORCE_DELETE') {
    return res.status(400).json({ error: 'Must send {confirm: "FORCE_DELETE"} to proceed' });
  }

  console.log(`⚠️  FORCE DELETING PRODUCT: ${id}`);

  db.serialize(() => {
    db.run('PRAGMA foreign_keys = OFF', (err) => {
      if (err) {
        console.error('Error disabling foreign keys:', err.message);
        return res.status(500).json({ error: err.message });
      }

      db.run('BEGIN TRANSACTION');

      // Delete from all tables that reference products
      const tables = [
        'bom',
        'inventory',
        'client_po_line_items',
        'shipment_items',
        'production_history',
        'job_work_items',
        'stock_adjustments',
        'drawing_operations',
        'inventory_allocations',
        'vendor_po_line_items'
      ];

      let completed = 0;
      let hasError = false;

      const deleteFromTable = (table) => {
        db.run(`DELETE FROM ${table} WHERE product_id=?`, [id], (err) => {
          if (err && !err.message.includes('no such table')) {
            console.error(`Error deleting from ${table}:`, err.message);
            hasError = true;
          } else {
            console.log(`✓ Deleted references from ${table}`);
          }

          completed++;

          if (completed === tables.length) {
            if (hasError) {
              db.run('ROLLBACK');
              db.run('PRAGMA foreign_keys = ON');
              return res.status(500).json({ error: 'Failed to delete some references' });
            }

            // Finally delete the product itself
            db.run('DELETE FROM products WHERE id=?', [id], (err) => {
              if (err) {
                console.error('Error deleting product:', err.message);
                db.run('ROLLBACK');
                db.run('PRAGMA foreign_keys = ON');
                return res.status(500).json({ error: err.message });
              }

              db.run('COMMIT', (err) => {
                if (err) {
                  console.error('Error committing:', err.message);
                  db.run('ROLLBACK');
                  db.run('PRAGMA foreign_keys = ON');
                  return res.status(500).json({ error: err.message });
                }

                db.run('PRAGMA foreign_keys = ON', (err) => {
                  if (err) {
                    console.error('Error re-enabling foreign keys:', err.message);
                  }

                  console.log(`✅ Product ${id} force deleted`);
                  res.json({
                    message: `Product ${id} and all references deleted successfully`,
                    deleted_from: tables
                  });
                });
              });
            });
          }
        });
      };

      // Delete from all tables
      tables.forEach(deleteFromTable);
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
  let { id, customer_id, po_date, due_date, currency = 'INR', delivery_terms, payment_terms, advance_amount = 0, payment_days = 0, priority = 'Normal', status = 'Pending', notes = '', line_items = [], advance_percent = 0, balance_payment_terms = '', mode_of_delivery = '', expected_delivery_date = '' } = req.body;
  const norm = (s)=>{ if(!s) return s; const m=String(s).replace(/\//g,'-').match(/^([0-3]\d)-([01]\d)-(\d{4})$/); return m? `${m[3]}-${m[2]}-${m[1]}` : s; };
  po_date = norm(po_date); due_date = norm(due_date); expected_delivery_date = norm(expected_delivery_date);

  db.serialize(() => {
    db.run('BEGIN');
    db.run(
      `INSERT INTO client_purchase_orders (id, customer_id, po_date, due_date, currency, delivery_terms, payment_terms, advance_amount, payment_days, priority, status, notes, advance_percent, balance_payment_terms, mode_of_delivery, expected_delivery_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, customer_id, po_date, due_date, currency, delivery_terms, payment_terms, advance_amount, payment_days, priority, status, notes, advance_percent, balance_payment_terms, mode_of_delivery, expected_delivery_date],
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
  const oldId = req.params.id;
  let { id: newId, customer_id, po_date, due_date, currency='INR', delivery_terms, payment_terms, advance_amount=0, payment_days=0, priority='Normal', status='Pending', notes='', advance_percent, balance_payment_terms, mode_of_delivery, expected_delivery_date } = req.body;

  // If no new ID provided in body, keep the old one
  const finalId = newId || oldId;

  // Support both old and new field names
  const finalAdvancePercent = advance_percent !== undefined ? advance_percent : advance_amount;
  const finalBalancePaymentTerms = balance_payment_terms !== undefined ? balance_payment_terms : payment_terms;
  const finalModeOfDelivery = mode_of_delivery !== undefined ? mode_of_delivery : delivery_terms;

  const norm = (s)=>{ if(!s) return s; const m=String(s).replace(/\//g,'-').match(/^([0-3]\d)-([01]\d)-(\d{4})$/); return m? `${m[3]}-${m[2]}-${m[1]}` : s; };
  po_date = norm(po_date); due_date = norm(due_date);
  expected_delivery_date = norm(expected_delivery_date);

  // If ID is changing, check if new ID already exists
  if (finalId !== oldId) {
    db.get('SELECT id FROM client_purchase_orders WHERE id = ?', [finalId], (checkErr, existing) => {
      if (checkErr) return res.status(500).json({ error: checkErr.message });
      if (existing) return res.status(400).json({ error: `PO ID "${finalId}" already exists. Please choose a different ID.` });

      // ID is changing and new ID is available - update with transaction
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Update line items to reference new ID
        db.run(`UPDATE client_po_line_items SET po_id = ? WHERE po_id = ?`, [finalId, oldId], (lineErr) => {
          if (lineErr) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: `Failed to update line items: ${lineErr.message}` });
          }

          // Update shipments to reference new ID
          db.run(`UPDATE shipments SET po_id = ? WHERE po_id = ?`, [finalId, oldId], (shipErr) => {
            if (shipErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: `Failed to update shipments: ${shipErr.message}` });
            }

            // Update invoices to reference new ID
            db.run(`UPDATE invoices SET po_id = ? WHERE po_id = ?`, [finalId, oldId], (invErr) => {
              if (invErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: `Failed to update invoices: ${invErr.message}` });
              }

              // Update the PO record itself
              db.run(
                `UPDATE client_purchase_orders SET id=?, customer_id=?, po_date=?, due_date=?, currency=?, advance_percent=?, balance_payment_terms=?, mode_of_delivery=?, expected_delivery_date=?, priority=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                [finalId, customer_id, po_date, due_date, currency, finalAdvancePercent, finalBalancePaymentTerms, finalModeOfDelivery, expected_delivery_date, priority, status, notes, oldId],
                function(err) {
                  if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                  }

                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: commitErr.message });
                    }
                    res.json({ message: 'Client PO updated successfully', new_id: finalId });
                  });
                }
              );
            });
          });
        });
      });
    });
  } else {
    // ID not changing - simple update
    db.run(
      `UPDATE client_purchase_orders SET customer_id=?, po_date=?, due_date=?, currency=?, advance_percent=?, balance_payment_terms=?, mode_of_delivery=?, expected_delivery_date=?, priority=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [customer_id, po_date, due_date, currency, finalAdvancePercent, finalBalancePaymentTerms, finalModeOfDelivery, expected_delivery_date, priority, status, notes, oldId],
      function(err){ if (err) return res.status(500).json({ error: err.message }); res.json({ message: 'Client PO updated' }); }
    );
  }
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
        }
        // If status changed to "Cancelled", release committed stock
        else if (oldStatus !== 'Cancelled' && newStatus === 'Cancelled') {
          db.all('SELECT material_type, quantity FROM vendor_po_line_items WHERE po_id = ?', [id], (err, items) => {
            if (err) return res.status(500).json({ error: err.message });

            items.forEach(item => {
              // Reduce committed_stock for raw materials
              db.run(
                `UPDATE raw_materials_inventory SET committed_stock = MAX(committed_stock - ?, 0) WHERE material = ?`,
                [Number(item.quantity || 0), item.material_type]
              );
            });

            res.json({ message: 'Vendor PO cancelled and committed stock released' });
          });
        }
        else {
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

    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (beginErr) => {
        if (beginErr) {
          return res.status(500).json({ error: 'Failed to start transaction: ' + beginErr.message });
        }

        // Update committed stock for all materials sequentially
        let updateIndex = 0;
        const updateNext = () => {
          if (updateIndex >= (rows || []).length) {
            // All updates done, proceed to delete line items
            db.run(`DELETE FROM vendor_po_line_items WHERE po_id = ?`, [id], (e1) => {
              if (e1) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Failed to delete line items: ' + e1.message });
              }

              // Delete the PO itself
              db.run(`DELETE FROM vendor_purchase_orders WHERE id = ?`, [id], (e2) => {
                if (e2) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: 'Failed to delete PO: ' + e2.message });
                }

                // Commit transaction
                db.run('COMMIT', (cerr) => {
                  if (cerr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Commit failed: ' + cerr.message });
                  }
                  res.json({ message: 'Vendor PO deleted' });
                });
              });
            });
            return;
          }

          const r = rows[updateIndex];
          db.run(
            `UPDATE raw_materials_inventory SET committed_stock = MAX(committed_stock - ?, 0) WHERE material = ?`,
            [Number(r.quantity || 0), r.material_type],
            (updateErr) => {
              if (updateErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Failed to update inventory: ' + updateErr.message });
              }
              updateIndex++;
              updateNext();
            }
          );
        };

        updateNext();
      });
    });
  });
});

// Receive vendor PO items into raw materials inventory (simple GRN)
app.post('/api/vendor-purchase-orders/:id/receive', (req, res) => {
  const { id } = req.params;
  // Load items from vendor_po_line_items with unit_price for weighted average costing
  db.all('SELECT material_type, quantity, unit, unit_price FROM vendor_po_line_items WHERE po_id=?', [id], (err, items) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No items to receive' });
    const receiveUnit = (u)=> String(u||'kg').toLowerCase();
    const isKg = (u)=> ['kg','kgs','kilogram','kilograms'].includes(receiveUnit(u));
    db.serialize(()=>{
      db.run('BEGIN');
      try{
        items.forEach(it => {
          const mat = it.material_type;
          const qty = Number(it.quantity||0);
          const unitPrice = Number(it.unit_price||0);
          if (!mat || !(qty>0)) return;
          const unit = receiveUnit(it.unit);
          const qtyKg = isKg(unit) ? qty : qty; // extend here for other units
          const receivedValue = qtyKg * unitPrice;

          // Weighted average costing: Get current inventory to calculate new average
          db.get('SELECT current_stock, total_value FROM raw_materials_inventory WHERE material = ?', [mat], (err2, existing) => {
            if (err2) { console.error('Error fetching existing inventory:', err2); return; }

            const oldStock = Number(existing?.current_stock || 0);
            const oldValue = Number(existing?.total_value || 0);
            const newStock = oldStock + qtyKg;
            const newValue = oldValue + receivedValue;
            const newAvgCost = newStock > 0 ? newValue / newStock : 0;

            db.run(`INSERT INTO raw_materials_inventory (material, current_stock, total_value, average_cost_per_unit, reorder_level, last_purchase_date, updated_at)
                    VALUES (?, ?, ?, ?, 0, DATE('now'), CURRENT_TIMESTAMP)
                    ON CONFLICT(material) DO UPDATE SET
                      current_stock = current_stock + excluded.current_stock,
                      total_value = total_value + excluded.total_value,
                      average_cost_per_unit = excluded.average_cost_per_unit,
                      last_purchase_date = DATE('now'),
                      updated_at = CURRENT_TIMESTAMP`,
                    [mat, qtyKg, receivedValue, newAvgCost]);
            db.run(`INSERT INTO vendor_po_receipts (vpo_id, material, qty, unit) VALUES (?, ?, ?, ?)`, [id, mat, qtyKg, unit]);
          });
        });
        db.run('COMMIT', (e)=>{
          if (e) return res.status(500).json({ error: e.message });
          res.json({ message: 'Received to raw materials with cost tracking', received: items.length });
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
        const unitPrice = Number(it.unit_price || 0);
        if (!mat || !(qtyKg>0)) return;
        const receivedValue = qtyKg * unitPrice;

        // Weighted average costing
        db.get('SELECT current_stock, total_value FROM raw_materials_inventory WHERE material = ?', [mat], (err2, existing) => {
          if (err2) { console.error('Error fetching existing inventory:', err2); return; }

          const oldStock = Number(existing?.current_stock || 0);
          const oldValue = Number(existing?.total_value || 0);
          const newStock = oldStock + qtyKg;
          const newValue = oldValue + receivedValue;
          const newAvgCost = newStock > 0 ? newValue / newStock : 0;

          db.run(`INSERT INTO raw_materials_inventory (material, current_stock, total_value, average_cost_per_unit, reorder_level, last_purchase_date, updated_at)
                  VALUES (?, ?, ?, ?, 0, DATE('now'), CURRENT_TIMESTAMP)
                  ON CONFLICT(material) DO UPDATE SET
                    current_stock = current_stock + excluded.current_stock,
                    total_value = total_value + excluded.total_value,
                    average_cost_per_unit = excluded.average_cost_per_unit,
                    last_purchase_date = DATE('now'),
                    updated_at = CURRENT_TIMESTAMP`,
                  [mat, qtyKg, receivedValue, newAvgCost]);
          db.run(`INSERT INTO vendor_po_receipts (vpo_id, material, qty, unit) VALUES (?, ?, ?, ?)`, [id, mat, qtyKg, normUnit(it.unit)]);
        });
      });
      db.run('COMMIT', (e)=>{
        if (e) return res.status(500).json({ error: e.message });
        res.json({ message:'Receipt posted with cost tracking', received: items.length });
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
  const { id, vendor_id, jw_date, due_date, job_type='Steel Core Production', status='Open', notes='', raw_steel_material, steel_consumed, cores_produced, cores_rejected, core_product_id, unit_rate, total_cost } = req.body||{};
  if (!id || !jw_date) return res.status(400).json({ error:'id and jw_date required' });

  db.run(`INSERT INTO job_work_orders (id, vendor_id, jw_date, due_date, job_type, status, notes, raw_steel_material, steel_consumed, cores_produced, cores_rejected, core_product_id, unit_rate, total_cost, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
          [id, vendor_id||'', jw_date, due_date||'', job_type, status, notes, raw_steel_material||null, steel_consumed||null, cores_produced||null, cores_rejected||null, core_product_id||null, unit_rate||0, total_cost||0],
          function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message:'JWO created' });
  });
});
app.put('/api/jobwork/orders/:id', (req, res) => {
  const { id } = req.params;
  const { vendor_id, jw_date, due_date, job_type, status, notes, raw_steel_material, steel_consumed, cores_produced, cores_rejected, core_product_id, unit_rate, total_cost } = req.body||{};
  db.run(`UPDATE job_work_orders SET vendor_id=?, jw_date=?, due_date=?, job_type=?, status=?, notes=?, raw_steel_material=?, steel_consumed=?, cores_produced=?, cores_rejected=?, core_product_id=?, unit_rate=?, total_cost=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [vendor_id||'', jw_date||'', due_date||'', job_type||'Steel Core Production', status||'Open', notes||'', raw_steel_material||null, steel_consumed||null, cores_produced||null, cores_rejected||null, core_product_id||null, unit_rate||0, total_cost||0, id], function(err){
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
  db.get('SELECT job_type, raw_steel_material, steel_consumed, cores_produced, cores_rejected, core_product_id FROM job_work_orders WHERE id=?', [id], (err, order)=>{
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: 'Job work order not found' });

    const jobType = order.job_type || 'Steel Core Production';

    db.serialize(()=>{
      db.run('BEGIN');
      try{
        // Handle Steel Core Production separately (doesn't use items)
        if (jobType === 'Steel Core Production') {
          const pid = order.core_product_id;
          const coresProduced = Number(order.cores_produced || 0);
          const steelConsumed = Number(order.steel_consumed || 0);
          const rawSteelMaterial = order.raw_steel_material;

          if (pid && coresProduced > 0 && steelConsumed > 0 && rawSteelMaterial) {
            // Add cores to inventory
            db.run(`INSERT INTO inventory (product_id, cores, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(product_id) DO UPDATE SET cores = cores + excluded.cores, updated_at=CURRENT_TIMESTAMP`, [pid, coresProduced]);

            // Weighted average costing: Calculate cost of consumed steel
            db.get('SELECT average_cost_per_unit FROM raw_materials_inventory WHERE material = ?', [rawSteelMaterial], (_err5, costRow) => {
              const avgCost = Number(costRow?.average_cost_per_unit || 0);
              const consumedValue = steelConsumed * avgCost;

              // Consume raw steel from raw materials inventory
              db.run(`UPDATE raw_materials_inventory
                      SET current_stock = MAX(0, current_stock - ?),
                          total_value = MAX(0, total_value - ?),
                          updated_at = CURRENT_TIMESTAMP
                      WHERE material = ?`, [steelConsumed, consumedValue, rawSteelMaterial]);
            });

            // Record receipt
            db.run(`INSERT INTO job_work_receipts (order_id, product_id, qty, received_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`, [id, pid, coresProduced]);
          }

          // Update job work order status to Completed
          db.run('UPDATE job_work_orders SET status = ? WHERE id = ?', ['Completed', id]);

          db.run('COMMIT', (e)=>{ if(e) return res.status(500).json({ error:e.message }); res.json({ message:`Steel Core Production job work received`, cores_produced: coresProduced }); });
          return;
        }

        items.forEach(it=>{
          const pid = it.product_id; const qty = Number(it.qty||0);
          if (!pid || !(qty>0)) return;

          if (jobType === 'Rod Making') {
            // Rod Making: Raw Steel → Steel Rods
            // Consume raw steel from BOM, add to steel_rods inventory
            db.run(`INSERT INTO inventory (product_id, steel_rods, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(product_id) DO UPDATE SET steel_rods = steel_rods + excluded.steel_rods, updated_at=CURRENT_TIMESTAMP`, [pid, qty]);

            // Consume raw steel based on BOM with weighted average costing
            db.get('SELECT qty_per_unit FROM bom WHERE product_id=? AND material=?', [pid, 'Steel'], (e, bom)=>{
              if (!e && bom) {
                const steelConsumed = qty * Number(bom.qty_per_unit || 0);
                db.get('SELECT average_cost_per_unit FROM raw_materials_inventory WHERE material = ?', ['Steel'], (_err6, costRow) => {
                  const avgCost = Number(costRow?.average_cost_per_unit || 0);
                  const consumedValue = steelConsumed * avgCost;
                  db.run(`UPDATE raw_materials_inventory
                          SET current_stock = current_stock - ?,
                              total_value = MAX(0, total_value - ?),
                              updated_at = CURRENT_TIMESTAMP
                          WHERE material = ?`, [steelConsumed, consumedValue, 'Steel']);
                });
              }
            });
          } else if (jobType === 'Plating') {
            // Plating: Steel Rods + Copper Anode → Plated
            // Consume steel_rods, consume copper anode from BOM, add to plated inventory
            db.run(`INSERT INTO inventory (product_id, plated, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(product_id) DO UPDATE SET plated = plated + excluded.plated, steel_rods = steel_rods - ?, updated_at=CURRENT_TIMESTAMP`, [pid, qty, qty]);

            // Consume copper anode based on BOM with weighted average costing
            db.get('SELECT qty_per_unit FROM bom WHERE product_id=? AND material=?', [pid, 'Copper Anode'], (e, bom)=>{
              if (!e && bom) {
                const copperConsumed = qty * Number(bom.qty_per_unit || 0);
                db.get('SELECT average_cost_per_unit FROM raw_materials_inventory WHERE material = ?', ['Copper Anode'], (_err7, costRow) => {
                  const avgCost = Number(costRow?.average_cost_per_unit || 0);
                  const consumedValue = copperConsumed * avgCost;
                  db.run(`UPDATE raw_materials_inventory
                          SET current_stock = current_stock - ?,
                              total_value = MAX(0, total_value - ?),
                              updated_at = CURRENT_TIMESTAMP
                          WHERE material = ?`, [copperConsumed, consumedValue, 'Copper Anode']);
                });
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
  const { id, po_id, shipment_date, container_number, bl_number, bl_date, notes, items, carrier, destination, tracking_number } = req.body;
  // Record shipment, update delivered counts, and decrement inventory.stamped

  // First, validate marking requirements
  db.get('SELECT marking FROM client_purchase_orders WHERE id = ?', [po_id], (poErr, po) => {
    if (poErr) {
      return res.status(500).json({ error: poErr.message });
    }

    const warnings = [];

    // If PO has marking, check if sufficient marked inventory exists
    if (po && po.marking && po.marking.trim() !== '') {
      const poMarking = po.marking.trim();
      let validationComplete = 0;
      const totalItems = (items || []).length;

      if (totalItems === 0) {
        // No items to validate, proceed
        proceedWithShipment();
      } else {
        // Check each item for marking validation
        (items || []).forEach(item => {
          const sql = `
            SELECT SUM(quantity) as available_quantity
            FROM inventory_allocations
            WHERE product_id = ?
              AND stage = 'stamped'
              AND marking_text = ?
              AND (allocated_po_id = ? OR allocated_po_id IS NULL)
          `;

          db.get(sql, [item.product_id, poMarking, po_id], (markErr, markResult) => {
            validationComplete++;

            if (!markErr) {
              const availableQty = markResult?.available_quantity || 0;
              const requestedQty = Number(item.quantity || 0);

              if (availableQty < requestedQty) {
                warnings.push({
                  product_id: item.product_id,
                  message: `Warning: PO requires "${poMarking}" marking but only ${availableQty} units available (requested ${requestedQty})`
                });
              }
            }

            // After all items validated, proceed with shipment
            if (validationComplete === totalItems) {
              proceedWithShipment();
            }
          });
        });
      }
    } else {
      // No marking validation needed
      proceedWithShipment();
    }

    function proceedWithShipment() {
      db.serialize(() => {
        db.run('BEGIN');
        db.run(
          "INSERT INTO shipments (id, po_id, shipment_date, container_number, bl_number, bl_date, notes, carrier, destination, tracking_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [id, po_id, shipment_date, container_number, bl_number, bl_date, notes, carrier, destination, tracking_number],
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
                `UPDATE inventory SET stamped = MAX(stamped - ?, 0), updated_at = CURRENT_TIMESTAMP WHERE product_id = ?`,
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

                // Include warnings in the response
                const response = {
                  success: true,
                  message: 'Shipment recorded successfully'
                };

                if (warnings.length > 0) {
                  response.warnings = warnings;
                }

                res.json(response);
              });
            });
          }
        );
      });
    }
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
          db.run(`UPDATE inventory SET stamped = stamped + ?, updated_at=CURRENT_TIMESTAMP WHERE product_id = ?`, [qty, it.product_id], (e)=>{ if(e){ failed=true; }});
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
  const { po_id, shipment_date, container_number, bl_number, bl_date, notes, carrier, destination, tracking_number } = req.body;
  db.run(`UPDATE shipments SET po_id=?, shipment_date=?, container_number=?, bl_number=?, bl_date=?, notes=?, carrier=?, destination=?, tracking_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [po_id, shipment_date, container_number, bl_number, bl_date, notes, carrier, destination, tracking_number, id],
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
            db.run(`UPDATE inventory SET stamped = stamped + ?, updated_at=CURRENT_TIMESTAMP WHERE product_id = ?`, [qty, it.product_id], (e)=>{ if(e){ failed=true; }});
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
          db.run(`UPDATE inventory SET stamped = MAX(stamped - ?, 0), updated_at=CURRENT_TIMESTAMP WHERE product_id = ?`, [qty, product_id], (e3)=>{
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
        db.run(`UPDATE inventory SET stamped = stamped - ?, updated_at=CURRENT_TIMESTAMP WHERE product_id=?`, [deltaOld, oldPid]);
        // apply new
        db.run(`UPDATE client_po_line_items SET delivered = delivered + ? WHERE po_id=? AND product_id=?`, [deltaNew, ship.po_id, newPid]);
        db.run(`UPDATE inventory SET stamped = MAX(stamped - ?, 0), updated_at=CURRENT_TIMESTAMP WHERE product_id=?`, [deltaNew, newPid]);
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
        db.run(`UPDATE inventory SET stamped = stamped + ?, updated_at=CURRENT_TIMESTAMP WHERE product_id=?`, [qty, pid]);
        db.run(`DELETE FROM shipment_items WHERE id=? AND shipment_id=?`, [itemId, id], (e3)=>{
          if (e3) { try{ db.run('ROLLBACK'); }catch(_){}; return res.status(500).json({ error:e3.message }); }
          db.run('COMMIT', (cerr)=>{ if (cerr) return res.status(500).json({ error: cerr.message }); res.json({ message:'Item deleted' }); });
        });
      });
    });
  });
});

// ============= Shipment Tracking (AfterShip Integration) =============
app.post('/api/shipments/:id/refresh-tracking', async (req, res) => {
  const { id } = req.params;

  if (!AfterShip) {
    return res.status(501).json({ error: 'AfterShip package not available' });
  }

  const apiKey = process.env.AFTERSHIP_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'AFTERSHIP_API_KEY not configured. Please set it as an environment variable on Render.' });
  }

  try {
    // Get shipment from database
    db.get(`SELECT * FROM shipments WHERE id=?`, [id], async (err, shipment) => {
      if (err || !shipment) {
        return res.status(404).json({ error: 'Shipment not found' });
      }

      if (!shipment.tracking_number) {
        return res.status(400).json({ error: 'No tracking number available for this shipment' });
      }

      try {
        // Initialize AfterShip client
        const aftership = new AfterShip(apiKey);

        // First, try to create tracking (in case it doesn't exist)
        try {
          await aftership.tracking.createTracking({
            tracking_number: shipment.tracking_number,
            ...(shipment.carrier_detected && { slug: shipment.carrier_detected })
          });
        } catch (createErr) {
          // Tracking might already exist, that's OK
          console.log('Tracking already exists or create failed:', createErr.message);
        }

        // Get tracking info
        const result = await aftership.tracking.getTracking(shipment.tracking_number, {
          ...(shipment.carrier_detected && { slug: shipment.carrier_detected })
        });

        const tracking = result.data.tracking;

        // Extract useful info
        const status = tracking.tag || 'Unknown'; // InfoReceived, InTransit, OutForDelivery, Delivered, Exception, etc.
        const carrierDetected = tracking.slug;
        const estimatedDelivery = tracking.expected_delivery || null;
        const lastCheckpoint = tracking.checkpoints && tracking.checkpoints.length > 0
          ? tracking.checkpoints[tracking.checkpoints.length - 1]
          : null;

        // Update database
        db.run(
          `UPDATE shipments
           SET tracking_status=?, carrier_detected=?, estimated_delivery=?, tracking_last_updated=CURRENT_TIMESTAMP
           WHERE id=?`,
          [status, carrierDetected, estimatedDelivery, id],
          function(updateErr) {
            if (updateErr) {
              return res.status(500).json({ error: updateErr.message });
            }

            res.json({
              message: 'Tracking status updated',
              status: status,
              carrier_detected: carrierDetected,
              estimated_delivery: estimatedDelivery,
              last_checkpoint: lastCheckpoint,
              raw_tracking: tracking
            });
          }
        );

      } catch (apiErr) {
        console.error('AfterShip API Error:', apiErr);
        res.status(500).json({
          error: 'Failed to fetch tracking info from AfterShip',
          details: apiErr.message
        });
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventory', (req, res) => {
  db.all(`
    SELECT
      i.*,
      p.description as product_description,
      (i.stamped - COALESCE(i.committed, 0)) as available
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
        total_wip: (row.plated || 0) + (row.machined || 0) + (row.qc || 0),
        total_stock: (row.plated || 0) + (row.machined || 0) + (row.qc || 0) + (row.stamped || 0) + (row.steel_rods || 0),
        committed: row.committed || 0,
        available: Math.max(0, (row.stamped || 0) - (row.committed || 0))
      }));
      res.json(enrichedRows);
    }
  });
});

// Diagnostic endpoint to check inventory vs allocations consistency
app.get('/api/inventory/diagnostic', (_req, res) => {
  db.all(`
    SELECT
      'inventory' as source,
      product_id,
      steel_rods, plated, machined, qc, stamped,
      (steel_rods + plated + machined + qc + stamped) as total
    FROM inventory
    WHERE (steel_rods + plated + machined + qc + stamped) > 0
  `, [], (err1, invRows) => {
    if (err1) return res.status(500).json({ error: err1.message });

    db.all(`
      SELECT
        'allocations' as source,
        product_id,
        stage,
        marking_type,
        marking_text,
        SUM(quantity) as quantity
      FROM inventory_allocations
      GROUP BY product_id, stage, marking_type, marking_text
      HAVING SUM(quantity) > 0
    `, [], (err2, allocRows) => {
      if (err2) return res.status(500).json({ error: err2.message });

      res.json({
        inventory_table: invRows || [],
        allocations_table: allocRows || [],
        inventory_count: invRows?.length || 0,
        allocations_count: allocRows?.length || 0
      });
    });
  });
});

// Get marking breakdown for inventory (for detailed allocation view)
app.get('/api/inventory/markings', (_req, res) => {
  db.all(`
    SELECT
      ia.product_id,
      p.description as product_description,
      ia.stage,
      ia.marking_type,
      ia.marking_text,
      SUM(ia.quantity) as quantity,
      ia.allocated_po_id,
      cpo.marking as po_marking,
      c.name as customer_name
    FROM inventory_allocations ia
    LEFT JOIN products p ON ia.product_id = p.id
    LEFT JOIN client_purchase_orders cpo ON ia.allocated_po_id = cpo.id
    LEFT JOIN customers c ON cpo.customer_id = c.id
    WHERE ia.stage = 'stamped'
    GROUP BY ia.product_id, ia.stage, ia.marking_type, ia.marking_text, ia.allocated_po_id
    HAVING SUM(ia.quantity) > 0
    ORDER BY p.description, ia.stage, ia.marking_type, ia.marking_text
  `, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows || []);
    }
  });
});

// ============= Allocation Management Endpoints =============

// POST /api/inventory/allocations/assign - Assign marked inventory to a PO
app.post('/api/inventory/allocations/assign', (req, res) => {
  const { product_id, stage, marking_type, marking_text, quantity, po_id } = req.body;

  if (!product_id || !stage || !marking_type || !quantity || !po_id) {
    return res.status(400).json({ error: 'Missing required fields: product_id, stage, marking_type, quantity, po_id' });
  }

  console.log('Assigning allocation:', { product_id, stage, marking_type, marking_text, quantity, po_id });

  db.serialize(() => {
    // First validate that the PO exists
    db.get('SELECT id FROM client_purchase_orders WHERE id = ?', [po_id], (err, po) => {
      if (err) {
        console.error('Error checking PO:', err);
        return res.status(500).json({ error: err.message });
      }
      if (!po) {
        return res.status(404).json({ error: `Purchase Order ${po_id} not found` });
      }

      // Update the inventory_allocations table to set allocated_po_id
      const updateSql = `
        UPDATE inventory_allocations
        SET allocated_po_id = ?,
            allocated_date = DATE('now')
        WHERE product_id = ?
          AND stage = ?
          AND marking_type = ?
          AND (marking_text = ? OR (marking_text IS NULL AND ? IS NULL))
          AND allocated_po_id IS NULL
          AND quantity >= ?
        LIMIT 1
      `;

      db.run(updateSql, [po_id, product_id, stage, marking_type, marking_text, marking_text, quantity], function(updateErr) {
        if (updateErr) {
          console.error('Error updating allocation:', updateErr);
          return res.status(500).json({ error: updateErr.message });
        }

        if (this.changes === 0) {
          // If no rows were updated, try to find a matching allocation entry and split it
          const findSql = `
            SELECT * FROM inventory_allocations
            WHERE product_id = ?
              AND stage = ?
              AND marking_type = ?
              AND (marking_text = ? OR (marking_text IS NULL AND ? IS NULL))
              AND allocated_po_id IS NULL
              AND quantity >= ?
            LIMIT 1
          `;

          db.get(findSql, [product_id, stage, marking_type, marking_text, marking_text, quantity], (findErr, row) => {
            if (findErr) {
              console.error('Error finding allocation:', findErr);
              return res.status(500).json({ error: findErr.message });
            }

            if (!row) {
              return res.status(404).json({ error: 'No matching unallocated inventory found with sufficient quantity' });
            }

            // Split the allocation: reduce original quantity and create a new allocated entry
            db.run('BEGIN');

            db.run(
              'UPDATE inventory_allocations SET quantity = quantity - ? WHERE id = ?',
              [quantity, row.id],
              (splitErr) => {
                if (splitErr) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: splitErr.message });
                }

                db.run(
                  `INSERT INTO inventory_allocations
                   (product_id, stage, marking_type, marking_text, quantity, allocated_po_id, allocated_date)
                   VALUES (?, ?, ?, ?, ?, ?, DATE('now'))`,
                  [product_id, stage, marking_type, marking_text, quantity, po_id],
                  (insertErr) => {
                    if (insertErr) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: insertErr.message });
                    }

                    db.run('COMMIT', (commitErr) => {
                      if (commitErr) {
                        return res.status(500).json({ error: commitErr.message });
                      }
                      console.log('Allocation assigned successfully (split entry)');
                      res.json({ success: true, message: 'Inventory allocated to PO successfully' });
                    });
                  }
                );
              }
            );
          });
        } else {
          console.log('Allocation assigned successfully');
          res.json({ success: true, message: 'Inventory allocated to PO successfully' });
        }
      });
    });
  });
});

// POST /api/inventory/allocations/deallocate - Remove PO allocation
app.post('/api/inventory/allocations/deallocate', (req, res) => {
  const { product_id, stage, marking_type, marking_text, po_id } = req.body;

  if (!product_id || !stage || !marking_type || !po_id) {
    return res.status(400).json({ error: 'Missing required fields: product_id, stage, marking_type, po_id' });
  }

  console.log('Deallocating:', { product_id, stage, marking_type, marking_text, po_id });

  const updateSql = `
    UPDATE inventory_allocations
    SET allocated_po_id = NULL,
        allocated_date = NULL
    WHERE product_id = ?
      AND stage = ?
      AND marking_type = ?
      AND (marking_text = ? OR (marking_text IS NULL AND ? IS NULL))
      AND allocated_po_id = ?
  `;

  db.run(updateSql, [product_id, stage, marking_type, marking_text, marking_text, po_id], function(err) {
    if (err) {
      console.error('Error deallocating:', err);
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'No matching allocation found to deallocate' });
    }

    console.log('Deallocation successful, rows affected:', this.changes);
    res.json({ success: true, message: 'Allocation removed successfully', rowsAffected: this.changes });
  });
});

// GET /api/inventory/available-markings - Get available (unallocated) marked inventory
app.get('/api/inventory/available-markings', (req, res) => {
  const sql = `
    SELECT
      product_id,
      stage,
      marking_type,
      marking_text,
      SUM(quantity) as total_quantity,
      COUNT(*) as entry_count
    FROM inventory_allocations
    WHERE allocated_po_id IS NULL
    GROUP BY product_id, stage, marking_type, marking_text
    ORDER BY product_id, stage, marking_type, marking_text
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching available markings:', err);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

// GET /api/marking-dashboard - Get summary data for marking dashboard
app.get('/api/marking-dashboard', (req, res) => {
  db.serialize(() => {
    const dashboardData = {
      totalMarkedInventory: {},
      allocatedVsAvailable: { allocated: 0, available: 0 },
      topMarkings: [],
      poAllocations: []
    };

    // Total marked inventory by type (only stamped - finished goods)
    db.all(`
      SELECT
        marking_type,
        SUM(quantity) as total_quantity
      FROM inventory_allocations
      WHERE stage = 'stamped'
      GROUP BY marking_type
    `, [], (err1, rows1) => {
      if (err1) {
        console.error('Error fetching total marked inventory:', err1);
        return res.status(500).json({ error: err1.message });
      }

      rows1.forEach(row => {
        dashboardData.totalMarkedInventory[row.marking_type] = row.total_quantity;
      });

      // Allocated vs Available quantities (only stamped - finished goods)
      db.get(`
        SELECT
          SUM(CASE WHEN allocated_po_id IS NOT NULL THEN quantity ELSE 0 END) as allocated,
          SUM(CASE WHEN allocated_po_id IS NULL THEN quantity ELSE 0 END) as available
        FROM inventory_allocations
        WHERE stage = 'stamped'
      `, [], (err2, row2) => {
        if (err2) {
          console.error('Error fetching allocated vs available:', err2);
          return res.status(500).json({ error: err2.message });
        }

        dashboardData.allocatedVsAvailable.allocated = row2.allocated || 0;
        dashboardData.allocatedVsAvailable.available = row2.available || 0;

        // Top 5 markings by quantity (only stamped - finished goods)
        db.all(`
          SELECT
            marking_type,
            marking_text,
            SUM(quantity) as total_quantity,
            COUNT(DISTINCT allocated_po_id) as po_count
          FROM inventory_allocations
          WHERE marking_text IS NOT NULL AND stage = 'stamped'
          GROUP BY marking_type, marking_text
          ORDER BY total_quantity DESC
          LIMIT 5
        `, [], (err3, rows3) => {
          if (err3) {
            console.error('Error fetching top markings:', err3);
            return res.status(500).json({ error: err3.message });
          }

          dashboardData.topMarkings = rows3 || [];

          // PO allocation status (only stamped - finished goods)
          db.all(`
            SELECT
              ia.allocated_po_id as po_id,
              ia.product_id,
              ia.marking_type,
              ia.marking_text,
              SUM(ia.quantity) as allocated_quantity,
              cpo.customer_id,
              c.name as customer_name,
              cpo.due_date,
              cpo.status
            FROM inventory_allocations ia
            LEFT JOIN client_purchase_orders cpo ON ia.allocated_po_id = cpo.id
            LEFT JOIN customers c ON cpo.customer_id = c.id
            WHERE ia.allocated_po_id IS NOT NULL AND ia.stage = 'stamped'
            GROUP BY ia.allocated_po_id, ia.product_id, ia.marking_type, ia.marking_text
            ORDER BY cpo.due_date ASC
          `, [], (err4, rows4) => {
            if (err4) {
              console.error('Error fetching PO allocations:', err4);
              return res.status(500).json({ error: err4.message });
            }

            dashboardData.poAllocations = rows4 || [];

            console.log('Marking dashboard data compiled successfully');
            res.json(dashboardData);
          });
        });
      });
    });
  });
});

// GET /api/production/suggested-markings - Get suggested markings from active POs
app.get('/api/production/suggested-markings', (req, res) => {
  const sql = `
    SELECT DISTINCT
      cpo.marking as marking_text,
      cpo.id as po_id,
      c.name as customer_name,
      cpo.due_date
    FROM client_purchase_orders cpo
    LEFT JOIN customers c ON cpo.customer_id = c.id
    WHERE cpo.status != 'Completed'
      AND cpo.status != 'Cancelled'
      AND cpo.marking IS NOT NULL
      AND cpo.marking != ''
    ORDER BY cpo.due_date ASC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching suggested markings:', err);
      return res.status(500).json({ error: err.message });
    }
    console.log('Suggested markings fetched:', rows?.length || 0);
    res.json(rows || []);
  });
});

// POST /api/shipments/validate-markings - Validate marking requirements before shipment creation
app.post('/api/shipments/validate-markings', (req, res) => {
  const { po_id, items } = req.body;

  if (!po_id) {
    return res.status(400).json({ error: 'Missing required field: po_id' });
  }

  console.log('Validating shipment markings for PO:', po_id, 'with items:', items);

  // First, get the PO details to check if it has marking requirements
  db.get('SELECT id, marking FROM client_purchase_orders WHERE id = ?', [po_id], (err, po) => {
    if (err) {
      console.error('Error fetching PO:', err);
      return res.status(500).json({ error: err.message });
    }

    if (!po) {
      return res.status(404).json({ error: `Purchase Order ${po_id} not found` });
    }

    const poMarking = po.marking;
    const warnings = [];
    const errors = [];

    // If PO has no marking requirement, validation passes
    if (!poMarking || poMarking.trim() === '') {
      console.log('PO has no marking requirement, validation passed');
      return res.json({
        valid: true,
        warnings: [],
        errors: [],
        message: 'No marking requirements for this PO'
      });
    }

    // If items are provided, check marking availability for each product
    if (items && items.length > 0) {
      let itemsChecked = 0;
      const totalItems = items.length;

      items.forEach(item => {
        const { product_id, quantity } = item;

        // Check if sufficient marked inventory exists for this product
        db.get(`
          SELECT
            SUM(quantity) as available_marked_qty
          FROM inventory_allocations
          WHERE product_id = ?
            AND stage = 'stamped'
            AND (marking_text = ? OR (allocated_po_id = ? AND allocated_po_id IS NOT NULL))
        `, [product_id, poMarking, po_id], (itemErr, markingData) => {
          itemsChecked++;

          if (itemErr) {
            console.error('Error checking marking data:', itemErr);
            errors.push(`Error checking marking for ${product_id}: ${itemErr.message}`);
          } else {
            const availableMarkedQty = markingData?.available_marked_qty || 0;

            if (availableMarkedQty < quantity) {
              warnings.push({
                product_id,
                required_quantity: quantity,
                available_marked_quantity: availableMarkedQty,
                shortage: quantity - availableMarkedQty,
                marking: poMarking,
                message: `Warning: PO requires "${poMarking}" marking, but only ${availableMarkedQty}/${quantity} units available for ${product_id}`
              });
            }
          }

          // When all items have been checked, send response
          if (itemsChecked === totalItems) {
            const isValid = errors.length === 0;
            const hasWarnings = warnings.length > 0;

            console.log('Validation complete:', { valid: isValid, warnings: warnings.length, errors: errors.length });

            res.json({
              valid: isValid,
              warnings,
              errors,
              hasWarnings,
              message: hasWarnings
                ? `Warning: Some products have insufficient marked inventory`
                : isValid
                ? 'All marking requirements validated successfully'
                : 'Validation failed with errors'
            });
          }
        });
      });
    } else {
      // No items provided, just return PO marking requirement
      console.log('No items provided, returning PO marking requirement');
      res.json({
        valid: true,
        warnings: [],
        errors: [],
        poMarking,
        message: `PO requires "${poMarking}" marking. Add items to validate marking availability.`
      });
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
      (production_date, product_id, plated, machined, qc, stamped, rejected, notes, marking_type, marking_text, allocated_po_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        entry.rejected || 0,
        entry.notes || '',
        entry.marking_type || 'unmarked',
        entry.marking_text || null,
        entry.allocated_po_id || null
      ], function(histErr) {
        if (histErr) {
          failed = true;
          failedMsg = histErr.message;
          console.error('Production history insert error:', histErr);
          processedCount++;
          if (processedCount === totalEntries) {
            stmt.finalize();
            try { db.run('ROLLBACK'); } catch(_){}
            return res.status(500).json({ error: failedMsg });
          }
          return;
        }

        const productionId = this.lastID;
        console.log(`✅ Production entry saved: ${entry.product_id}, updating inventory...`);

        // SEQUENTIAL FLOW: Update inventory stages
        // Each stage consumes from previous stage and adds to current stage
        // Flow: steel_rods -> plated -> machined -> qc -> stamped (final finished goods)

        const platedQty = Number(entry.plated || 0);
        const machinedQty = Number(entry.machined || 0);
        const qcQty = Number(entry.qc || 0);
        const stampedQty = Number(entry.stamped || 0);

        db.run(`
          INSERT INTO inventory (product_id, steel_rods, plated, machined, qc, stamped, updated_at)
          VALUES (?, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(product_id) DO UPDATE SET
            steel_rods = MAX(0, steel_rods - ?),
            plated = MAX(0, plated - ? - ? - ? + ?),
            machined = MAX(0, machined - ? - ? + ?),
            qc = MAX(0, qc - ? + ?),
            stamped = stamped + ?,
            updated_at = CURRENT_TIMESTAMP
        `, [
          entry.product_id,
          // steel_rods: subtract plated quantity (plating consumes steel_rods)
          platedQty,
          // plated: subtract what moves to machined, qc, stamped, add what was plated
          machinedQty, qcQty, stampedQty, platedQty,
          // machined: subtract what moves to qc, stamped, add what was machined
          qcQty, stampedQty, machinedQty,
          // qc: subtract what moves to stamped, add what passed qc
          stampedQty, qcQty,
          // stamped: add what was stamped (finished goods ready to ship)
          stampedQty
        ], (invErr) => {
          if (invErr) {
            failed = true;
            failedMsg = `Inventory update error for ${entry.product_id}: ${invErr.message}`;
            console.error('❌ Inventory update failed:', failedMsg);
            processedCount++;
            if (processedCount === totalEntries) {
              stmt.finalize();
              try { db.run('ROLLBACK'); } catch(_){}
              return res.status(500).json({ error: failedMsg });
            }
            return;
          }

          console.log(`✅ Inventory updated for ${entry.product_id}`);

          // MARKING/ALLOCATION TRACKING: Record marked inventory for stamped stage
          // Stamped is now the final finished goods stage ready to ship
          const markingType = entry.marking_type || 'unmarked';
          const markingText = entry.marking_text || null;
          const allocatedPOId = entry.allocated_po_id || null;

          // Record stamped inventory allocation if stamped quantity > 0
          if (stampedQty > 0) {
            db.run(`
              INSERT INTO inventory_allocations
              (product_id, stage, marking_type, marking_text, quantity, allocated_po_id, allocated_date)
              VALUES (?, 'stamped', ?, ?, ?, ?, ?)
            `, [entry.product_id, markingType, markingText, stampedQty, allocatedPOId, date], (allocErr) => {
              if (allocErr) console.warn('Stamped allocation tracking warning:', allocErr.message);
            });
          }

          // CRITICAL: Consume raw materials based on BOM for stamped (finished) quantity
          // NOTE: Steel is already consumed at Job Work/Drawing stage when converting raw steel to steel_rods
          // Only consume copper and other materials that are used during plating/stamping
          const stampedUnits = Number(entry.stamped||0);
          if (stampedUnits > 0){
            db.all('SELECT material, qty_per_unit FROM bom WHERE product_id = ?', [entry.product_id], (bomErr, bomRows) => {
              if (bomErr) {
                console.warn('BOM fetch warning:', bomErr.message);
              } else if (bomRows && bomRows.length > 0) {
                bomRows.forEach(bom => {
                  // Skip Steel - it was already deducted at Job Work stage (raw steel -> steel_rods)
                  const materialLower = (bom.material || '').toLowerCase();
                  if (materialLower.includes('steel') || materialLower.includes('rod')) {
                    console.log(`Skipping ${bom.material} deduction at stamping - already consumed at job work stage`);
                    return;
                  }

                  // Only deduct copper and other plating/finishing materials
                  const totalRequired = stampedUnits * Number(bom.qty_per_unit || 0);
                  if (totalRequired > 0) {
                    // Weighted average costing: Calculate cost of consumed material
                    db.get('SELECT average_cost_per_unit FROM raw_materials_inventory WHERE material = ?', [bom.material], (_err3, costRow) => {
                      const avgCost = Number(costRow?.average_cost_per_unit || 0);
                      const consumedValue = totalRequired * avgCost;

                      db.run(`UPDATE raw_materials_inventory
                              SET current_stock = MAX(0, current_stock - ?),
                                  total_value = MAX(0, total_value - ?),
                                  updated_at = CURRENT_TIMESTAMP
                              WHERE material = ?`,
                              [totalRequired, consumedValue, bom.material], (matErr) => {
                        if (matErr) {
                          console.warn(`Raw material deduction warning for ${bom.material}:`, matErr.message);
                        } else {
                          // Log the material consumption with cost
                          logAudit('raw_materials_inventory', bom.material, 'CONSUMED',
                            null,
                            { product_id: entry.product_id, quantity: totalRequired, cost: consumedValue, production_date: date }
                          );
                        }
                      });
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

// Update production entry
app.put('/api/production/:id', (req, res) => {
  const { id } = req.params;
  const { production_date, plated, machined, qc, stamped, packed, rejected, marking_type, marking_text, notes } = req.body;

  // First, get the old values to reverse inventory changes
  db.get('SELECT * FROM production_history WHERE id = ?', [id], (err, oldEntry) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!oldEntry) return res.status(404).json({ error: 'Production entry not found' });

    db.run('BEGIN TRANSACTION', (err) => {
      if (err) return res.status(500).json({ error: err.message });

      // Update production_history
      db.run(`
        UPDATE production_history
        SET production_date = ?, plated = ?, machined = ?, qc = ?, stamped = ?, rejected = ?,
            marking_type = ?, marking_text = ?, notes = ?
        WHERE id = ?
      `, [production_date, plated || 0, machined || 0, qc || 0, stamped || 0, rejected || 0,
          marking_type || 'unmarked', marking_text || '', notes || '', id], function(updateErr) {
        if (updateErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: updateErr.message });
        }

        // Reverse old inventory changes and apply new ones
        const oldPlated = Number(oldEntry.plated || 0);
        const oldMachined = Number(oldEntry.machined || 0);
        const oldQC = Number(oldEntry.qc || 0);
        const oldStamped = Number(oldEntry.stamped || 0);

        const newPlated = Number(plated || 0);
        const newMachined = Number(machined || 0);
        const newQC = Number(qc || 0);
        const newStamped = Number(stamped || 0);

        // Calculate net inventory delta (new - old)
        const deltaPlated = newPlated - oldPlated;
        const deltaMachined = newMachined - oldMachined;
        const deltaQC = newQC - oldQC;
        const deltaStamped = newStamped - oldStamped;

        // Update inventory with net delta
        // Same sequential flow logic as original production POST
        db.run(`
          INSERT INTO inventory (product_id, steel_rods, plated, machined, qc, stamped, updated_at)
          VALUES (?, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(product_id) DO UPDATE SET
            steel_rods = MAX(0, steel_rods - ?),
            plated = MAX(0, plated - ? - ? - ? + ?),
            machined = MAX(0, machined - ? - ? + ?),
            qc = MAX(0, qc - ? + ?),
            stamped = stamped + ?,
            updated_at = CURRENT_TIMESTAMP
        `, [
          oldEntry.product_id,
          deltaPlated,
          deltaMachined, deltaQC, deltaStamped, deltaPlated,
          deltaQC, deltaStamped, deltaMachined,
          deltaStamped, deltaQC,
          deltaStamped
        ], (invErr) => {
          if (invErr) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: `Inventory update error: ${invErr.message}` });
          }

          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: commitErr.message });
            }
            res.json({ message: 'Production entry updated successfully' });
          });
        });
      });
    });
  });
});

// Delete production entry
app.delete('/api/production/:id', (req, res) => {
  const { id } = req.params;

  // First, get the entry to reverse inventory changes
  db.get('SELECT * FROM production_history WHERE id = ?', [id], (err, entry) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!entry) return res.status(404).json({ error: 'Production entry not found' });

    db.run('BEGIN TRANSACTION', (err) => {
      if (err) return res.status(500).json({ error: err.message });

      // Delete the production entry
      db.run('DELETE FROM production_history WHERE id = ?', [id], (deleteErr) => {
        if (deleteErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: deleteErr.message });
        }

        // Reverse inventory changes (negate all quantities)
        const plated = Number(entry.plated || 0);
        const machined = Number(entry.machined || 0);
        const qcQty = Number(entry.qc || 0);
        const stamped = Number(entry.stamped || 0);

        db.run(`
          INSERT INTO inventory (product_id, steel_rods, plated, machined, qc, stamped, updated_at)
          VALUES (?, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP)
          ON CONFLICT(product_id) DO UPDATE SET
            steel_rods = steel_rods + ?,
            plated = plated + ? + ? + ? - ?,
            machined = machined + ? + ? - ?,
            qc = qc + ? - ?,
            stamped = stamped - ?,
            updated_at = CURRENT_TIMESTAMP
        `, [
          entry.product_id,
          plated,
          machined, qcQty, stamped, plated,
          qcQty, stamped, machined,
          stamped, qcQty,
          stamped
        ], (invErr) => {
          if (invErr) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: `Inventory reversal error: ${invErr.message}` });
          }

          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: commitErr.message });
            }
            res.json({ message: 'Production entry deleted successfully' });
          });
        });
      });
    });
  });
});

// Get production trace for a specific product (for inventory tracing)
app.get('/api/inventory/:productId/production-trace', (req, res) => {
  const { productId } = req.params;
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '50', 10)));

  const sql = `
    SELECT ph.id, ph.production_date, ph.product_id,
           ph.plated, ph.machined, ph.qc, ph.stamped, ph.packed, ph.rejected, ph.notes,
           ph.marking_type, ph.marking_text
    FROM production_history ph
    WHERE ph.product_id = ?
    ORDER BY ph.production_date DESC, ph.id DESC
    LIMIT ?`;

  db.all(sql, [productId, limit], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// ============= MRP / Purchase Planning Analytics =============
app.get('/api/analytics/mrp', (_req, res) => {
  // Get all open client POs with undelivered quantities
  db.all(`
    SELECT
      po.id as po_id,
      po.customer_id,
      po.po_date,
      po.expected_delivery_date,
      li.id as line_item_id,
      li.product_id,
      li.quantity,
      li.delivered,
      (li.quantity - li.delivered) as pending_quantity,
      p.description as product_description
    FROM client_purchase_orders po
    JOIN client_po_line_items li ON po.id = li.po_id
    JOIN products p ON li.product_id = p.id
    WHERE po.status != 'Completed' AND po.status != 'Cancelled'
      AND (li.quantity - li.delivered) > 0
      AND (po.is_deleted IS NULL OR po.is_deleted = 0)
    ORDER BY po.expected_delivery_date ASC, po.po_date ASC
  `, (err, openOrders) => {
    if (err) return res.status(500).json({ error: err.message });

    // Calculate material requirements for all pending orders
    const materialRequirements = {};
    let processedCount = 0;

    if (!openOrders || openOrders.length === 0) {
      return res.json({
        openOrders: [],
        materialRequirements: [],
        purchaseSuggestions: []
      });
    }

    openOrders.forEach((order) => {
      // Get BOM for this product
      db.all('SELECT material, qty_per_unit FROM bom WHERE product_id = ?', [order.product_id], (bomErr, bomRows) => {
        if (!bomErr && bomRows) {
          bomRows.forEach(bom => {
            const requiredQty = order.pending_quantity * Number(bom.qty_per_unit || 0);
            if (!materialRequirements[bom.material]) {
              materialRequirements[bom.material] = {
                material: bom.material,
                totalRequired: 0,
                orders: []
              };
            }
            materialRequirements[bom.material].totalRequired += requiredQty;
            materialRequirements[bom.material].orders.push({
              po_id: order.po_id,
              product_id: order.product_id,
              product_description: order.product_description,
              quantity: order.pending_quantity,
              required_material: requiredQty,
              due_date: order.expected_delivery_date
            });
          });
        }

        processedCount++;
        if (processedCount === openOrders.length) {
          // Get current raw materials inventory
          db.all('SELECT material, current_stock, committed_stock, available_stock, reorder_level FROM raw_materials_inventory', (invErr, inventory) => {
            if (invErr) return res.status(500).json({ error: invErr.message });

            const inventoryMap = {};
            (inventory || []).forEach(inv => {
              inventoryMap[inv.material] = inv;
            });

            // Generate purchase suggestions
            const purchaseSuggestions = [];
            Object.keys(materialRequirements).forEach(material => {
              const required = materialRequirements[material].totalRequired;
              const inv = inventoryMap[material] || { current_stock: 0, committed_stock: 0, available_stock: 0, reorder_level: 0 };
              const available = Number(inv.available_stock || 0);
              const shortage = required - available;
              const reorderLevel = Number(inv.reorder_level || 0);

              purchaseSuggestions.push({
                material,
                current_stock: Number(inv.current_stock || 0),
                committed_stock: Number(inv.committed_stock || 0),
                available_stock: available,
                total_required: required,
                shortage: shortage > 0 ? shortage : 0,
                reorder_level: reorderLevel,
                suggested_purchase: shortage > 0 ? Math.ceil(shortage + reorderLevel) : 0,
                status: shortage > 0 ? 'SHORTAGE' : (available < reorderLevel ? 'LOW_STOCK' : 'SUFFICIENT'),
                orders: materialRequirements[material].orders
              });
            });

            // Sort by status priority: SHORTAGE first, then LOW_STOCK, then SUFFICIENT
            purchaseSuggestions.sort((a, b) => {
              const statusOrder = { SHORTAGE: 0, LOW_STOCK: 1, SUFFICIENT: 2 };
              return statusOrder[a.status] - statusOrder[b.status];
            });

            res.json({
              openOrders,
              materialRequirements: Object.values(materialRequirements),
              purchaseSuggestions
            });
          });
        }
      });
    });
  });
});

// ============= Production Scheduling Analytics =============
app.get('/api/analytics/production-schedule', (_req, res) => {
  // Get all open client POs with their line items and current production status
  db.all(`
    SELECT
      po.id as po_id,
      po.customer_id,
      po.po_date,
      po.expected_delivery_date,
      po.status as po_status,
      li.id as line_item_id,
      li.product_id,
      li.quantity as ordered_qty,
      li.delivered as delivered_qty,
      (li.quantity - li.delivered) as pending_qty,
      p.description as product_description,
      c.name as customer_name,
      i.stamped as finished_stock
    FROM client_purchase_orders po
    JOIN client_po_line_items li ON po.id = li.po_id
    JOIN products p ON li.product_id = p.id
    LEFT JOIN customers c ON po.customer_id = c.id
    LEFT JOIN inventory i ON li.product_id = i.product_id
    WHERE po.status != 'Completed' AND po.status != 'Cancelled'
      AND (li.quantity - li.delivered) > 0
      AND (po.is_deleted IS NULL OR po.is_deleted = 0)
    ORDER BY po.expected_delivery_date ASC, po.po_date ASC
  `, (err, orders) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!orders || orders.length === 0) {
      return res.json({ schedule: [], summary: { total: 0, ready: 0, inProgress: 0, notStarted: 0, onTrack: 0, atRisk: 0, overdue: 0 } });
    }

    const today = new Date().toISOString().split('T')[0];
    const schedule = orders.map(order => {
      const finishedStock = Number(order.finished_stock || 0);
      const pendingQty = Number(order.pending_qty);
      const deliveryDate = order.expected_delivery_date;
      const daysUntilDue = deliveryDate ? Math.ceil((new Date(deliveryDate) - new Date(today)) / (1000 * 60 * 60 * 24)) : null;

      // Determine status
      let status = 'NOT_STARTED';
      let statusLabel = 'Not Started';
      let statusColor = 'gray';

      if (finishedStock >= pendingQty) {
        status = 'READY';
        statusLabel = 'Ready to Ship';
        statusColor = 'green';
      } else if (finishedStock > 0) {
        status = 'IN_PROGRESS';
        statusLabel = 'In Progress';
        statusColor = 'blue';
      }

      // Determine urgency
      let urgency = 'ON_TRACK';
      let urgencyLabel = 'On Track';
      let urgencyColor = 'green';

      if (daysUntilDue !== null) {
        if (daysUntilDue < 0) {
          urgency = 'OVERDUE';
          urgencyLabel = 'Overdue';
          urgencyColor = 'red';
        } else if (daysUntilDue <= 7 && finishedStock < pendingQty) {
          urgency = 'AT_RISK';
          urgencyLabel = 'At Risk';
          urgencyColor = 'yellow';
        }
      }

      return {
        po_id: order.po_id,
        customer_id: order.customer_id,
        customer_name: order.customer_name || order.customer_id,
        product_id: order.product_id,
        product_description: order.product_description,
        ordered_qty: Number(order.ordered_qty),
        delivered_qty: Number(order.delivered_qty),
        pending_qty: pendingQty,
        finished_stock: finishedStock,
        shortage: Math.max(0, pendingQty - finishedStock),
        completion_pct: finishedStock > 0 ? Math.min(100, Math.round((finishedStock / pendingQty) * 100)) : 0,
        expected_delivery_date: deliveryDate,
        days_until_due: daysUntilDue,
        status,
        status_label: statusLabel,
        status_color: statusColor,
        urgency,
        urgency_label: urgencyLabel,
        urgency_color: urgencyColor
      };
    });

    // Calculate summary
    const summary = {
      total: schedule.length,
      ready: schedule.filter(s => s.status === 'READY').length,
      inProgress: schedule.filter(s => s.status === 'IN_PROGRESS').length,
      notStarted: schedule.filter(s => s.status === 'NOT_STARTED').length,
      onTrack: schedule.filter(s => s.urgency === 'ON_TRACK').length,
      atRisk: schedule.filter(s => s.urgency === 'AT_RISK').length,
      overdue: schedule.filter(s => s.urgency === 'OVERDUE').length
    };

    res.json({ schedule, summary });
  });
});

// ============= Delivery Performance Analytics =============
app.get('/api/analytics/delivery-performance', (_req, res) => {
  // Get delivery performance metrics
  db.all(`
    SELECT
      po.id as po_id,
      po.customer_id,
      po.expected_delivery_date,
      li.product_id,
      li.quantity,
      li.delivered,
      s.shipment_date as actual_delivery_date,
      c.name as customer_name,
      p.description as product_description
    FROM client_purchase_orders po
    JOIN client_po_line_items li ON po.id = li.po_id
    JOIN products p ON li.product_id = p.id
    LEFT JOIN customers c ON po.customer_id = c.id
    LEFT JOIN shipments s ON po.id = s.po_id
    WHERE li.delivered > 0 AND po.expected_delivery_date IS NOT NULL
    ORDER BY s.shipment_date DESC, po.expected_delivery_date DESC
    LIMIT 100
  `, (err, deliveries) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!deliveries || deliveries.length === 0) {
      return res.json({
        deliveries: [],
        summary: { total: 0, onTime: 0, late: 0, onTimePercentage: 0, avgLeadTime: 0 }
      });
    }

    const deliveryPerformance = deliveries.map(d => {
      const expectedDate = new Date(d.expected_delivery_date);
      const actualDate = d.actual_delivery_date ? new Date(d.actual_delivery_date) : null;
      const daysDifference = actualDate ? Math.ceil((actualDate - expectedDate) / (1000 * 60 * 60 * 24)) : null;
      const onTime = daysDifference !== null && daysDifference <= 0;

      return {
        po_id: d.po_id,
        customer_id: d.customer_id,
        customer_name: d.customer_name || d.customer_id,
        product_id: d.product_id,
        product_description: d.product_description,
        quantity: d.quantity,
        delivered: d.delivered,
        expected_delivery_date: d.expected_delivery_date,
        actual_delivery_date: d.actual_delivery_date,
        days_difference: daysDifference,
        on_time: onTime,
        status: onTime ? 'On Time' : 'Late'
      };
    });

    const onTimeCount = deliveryPerformance.filter(d => d.on_time).length;
    const summary = {
      total: deliveryPerformance.length,
      onTime: onTimeCount,
      late: deliveryPerformance.length - onTimeCount,
      onTimePercentage: deliveryPerformance.length > 0 ? Math.round((onTimeCount / deliveryPerformance.length) * 100) : 0,
      avgLeadTime: 0 // Can calculate if needed
    };

    res.json({ deliveries: deliveryPerformance, summary });
  });
});

// ============= Customer Analytics =============
app.get('/api/analytics/customers', (_req, res) => {
  // Get customer revenue and order analytics with currency breakdown
  db.all(`
    SELECT
      c.id as customer_id,
      c.name as customer_name,
      COUNT(DISTINCT po.id) as total_orders,
      MAX(po.po_date) as last_order_date,
      GROUP_CONCAT(DISTINCT li.product_id) as products_ordered,
      li.currency,
      SUM(li.quantity * li.unit_price) as revenue_in_currency
    FROM customers c
    LEFT JOIN client_purchase_orders po ON c.id = po.customer_id AND (po.is_deleted IS NULL OR po.is_deleted = 0)
    LEFT JOIN client_po_line_items li ON po.id = li.po_id
    WHERE li.currency IS NOT NULL
    GROUP BY c.id, c.name, li.currency
    HAVING total_orders > 0
    ORDER BY c.name, li.currency
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // Group by customer and aggregate currencies
    const customerMap = {};
    (rows || []).forEach(row => {
      const customerId = row.customer_id;
      if (!customerMap[customerId]) {
        customerMap[customerId] = {
          customer_id: customerId,
          customer_name: row.customer_name,
          total_orders: Number(row.total_orders || 0),
          last_order_date: row.last_order_date,
          products_ordered: row.products_ordered ? [...new Set(row.products_ordered.split(','))] : [],
          revenue_by_currency: {}
        };
      }
      const currency = row.currency || 'INR';
      customerMap[customerId].revenue_by_currency[currency] = Number(row.revenue_in_currency || 0);
    });

    const customerAnalytics = Object.values(customerMap);

    // Calculate summary by currency
    const revenueByCurrency = {};
    customerAnalytics.forEach(c => {
      Object.entries(c.revenue_by_currency).forEach(([currency, amount]) => {
        revenueByCurrency[currency] = (revenueByCurrency[currency] || 0) + amount;
      });
    });

    const summary = {
      totalCustomers: customerAnalytics.length,
      revenue_by_currency: revenueByCurrency
    };

    res.json({ customers: customerAnalytics, summary });
  });
});

// ============= Material Consumption Variance Analytics =============
app.get('/api/analytics/material-variance', (_req, res) => {
  // Get production history with material consumption from audit logs
  db.all(`
    SELECT
      json_extract(new_values, '$.product_id') as product_id,
      json_extract(new_values, '$.production_date') as production_date,
      json_extract(new_values, '$.quantity') as quantity_produced,
      json_extract(new_values, '$.stamped') as stamped_qty,
      action,
      old_values,
      new_values,
      timestamp
    FROM audit_log
    WHERE table_name = 'raw_materials_inventory'
      AND action = 'CONSUMED'
      AND timestamp >= date('now', '-30 days')
    ORDER BY timestamp DESC
    LIMIT 100
  `, (err, consumptionLogs) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!consumptionLogs || consumptionLogs.length === 0) {
      return res.json({ variances: [], summary: { total: 0, highVariance: 0, avgVariance: 0 } });
    }

    // Group by product and date, then calculate variance
    const varianceData = [];
    consumptionLogs.forEach(log => {
      try {
        const newVals = typeof log.new_values === 'string' ? JSON.parse(log.new_values) : log.new_values;
        const productId = newVals.product_id;
        const material = log.record_id; // material name is stored in record_id for raw_materials_inventory
        const actualConsumed = Number(newVals.quantity || 0);
        const cost = Number(newVals.cost || 0);

        varianceData.push({
          product_id: productId,
          production_date: newVals.production_date,
          material,
          actual_consumed: actualConsumed,
          cost,
          timestamp: log.timestamp
        });
      } catch (e) {
        console.error('Error parsing variance data:', e);
      }
    });

    // Now get expected consumption from BOM for comparison
    const variancePromises = varianceData.map(v => {
      return new Promise((resolve) => {
        db.get('SELECT qty_per_unit FROM bom WHERE product_id = ? AND material = ?',
          [v.product_id, v.material], (bomErr, bom) => {
            if (bomErr || !bom) {
              resolve(null);
              return;
            }

            // Get the quantity produced from production_history
            db.get('SELECT stamped FROM production_history WHERE product_id = ? AND production_date = ? ORDER BY id DESC LIMIT 1',
              [v.product_id, v.production_date], (prodErr, prod) => {
                if (prodErr || !prod) {
                  resolve(null);
                  return;
                }

                const qtyProduced = Number(prod.stamped || 0);
                const expectedConsumption = qtyProduced * Number(bom.qty_per_unit || 0);
                const variance = v.actual_consumed - expectedConsumption;
                const variancePct = expectedConsumption > 0 ? (variance / expectedConsumption) * 100 : 0;

                resolve({
                  product_id: v.product_id,
                  production_date: v.production_date,
                  material: v.material,
                  quantity_produced: qtyProduced,
                  expected_consumption: expectedConsumption,
                  actual_consumption: v.actual_consumed,
                  variance,
                  variance_pct: variancePct,
                  cost: v.cost,
                  status: Math.abs(variancePct) > 5 ? 'HIGH_VARIANCE' : 'NORMAL',
                  timestamp: v.timestamp
                });
              });
          });
      });
    });

    Promise.all(variancePromises).then(results => {
      const validVariances = results.filter(v => v !== null);
      const highVarianceCount = validVariances.filter(v => v.status === 'HIGH_VARIANCE').length;
      const avgVariance = validVariances.length > 0 ?
        validVariances.reduce((sum, v) => sum + Math.abs(v.variance_pct), 0) / validVariances.length : 0;

      validVariances.sort((a, b) => Math.abs(b.variance_pct) - Math.abs(a.variance_pct));

      res.json({
        variances: validVariances,
        summary: {
          total: validVariances.length,
          highVariance: highVarianceCount,
          avgVariance: Math.round(avgVariance * 10) / 10
        }
      });
    });
  });
});

// ============= Stock Adjustments API =============
// Get all stock adjustments
app.get('/api/stock-adjustments', (req, res) => {
  db.all(`
    SELECT sa.*, p.description as product_description
    FROM stock_adjustments sa
    LEFT JOIN products p ON sa.product_id = p.id
    ORDER BY sa.adjustment_date DESC, sa.id DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Create stock adjustment
app.post('/api/stock-adjustments', (req, res) => {
  const { adjustment_date, product_id, stage, quantity, adjustment_type, reason, notes, created_by } = req.body;

  if (!adjustment_date || !product_id || !stage || !quantity || !adjustment_type || !reason) {
    return res.status(400).json({ error: 'Missing required fields: adjustment_date, product_id, stage, quantity, adjustment_type, reason' });
  }

  const validStages = ['plated', 'machined', 'qc', 'stamped', 'packed', 'cores'];
  if (!validStages.includes(stage.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid stage. Must be one of: plated, machined, qc, stamped, packed, cores' });
  }

  const validTypes = ['opening_balance', 'physical_count', 'damage_scrap', 'other'];
  if (!validTypes.includes(adjustment_type)) {
    return res.status(400).json({ error: 'Invalid adjustment_type. Must be one of: opening_balance, physical_count, damage_scrap, other' });
  }

  db.serialize(() => {
    db.run('BEGIN');

    // Insert adjustment record
    db.run(`
      INSERT INTO stock_adjustments (adjustment_date, product_id, stage, quantity, adjustment_type, reason, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [adjustment_date, product_id, stage.toLowerCase(), Number(quantity), adjustment_type, reason, notes || '', created_by || 'system'],
    function(err) {
      if (err) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: err.message });
      }

      const adjustmentId = this.lastID;

      // Update inventory
      const stageColumn = stage.toLowerCase();
      db.run(`
        INSERT INTO inventory (product_id, ${stageColumn})
        VALUES (?, ?)
        ON CONFLICT(product_id) DO UPDATE SET
          ${stageColumn} = ${stageColumn} + excluded.${stageColumn},
          updated_at = CURRENT_TIMESTAMP
      `, [product_id, Number(quantity)], (invErr) => {
        if (invErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: invErr.message });
        }

        db.run('COMMIT', (commitErr) => {
          if (commitErr) return res.status(500).json({ error: commitErr.message });
          res.json({ message: 'Stock adjustment created successfully', id: adjustmentId });
        });
      });
    });
  });
});

// Delete stock adjustment (reverses the inventory change)
app.delete('/api/stock-adjustments/:id', (req, res) => {
  const { id } = req.params;

  // Get adjustment details first
  db.get('SELECT * FROM stock_adjustments WHERE id = ?', [id], (err, adjustment) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!adjustment) return res.status(404).json({ error: 'Stock adjustment not found' });

    db.serialize(() => {
      db.run('BEGIN');

      // Reverse the inventory change
      const stageColumn = adjustment.stage.toLowerCase();
      db.run(`
        UPDATE inventory
        SET ${stageColumn} = MAX(0, ${stageColumn} - ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
      `, [adjustment.quantity, adjustment.product_id], (invErr) => {
        if (invErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: invErr.message });
        }

        // Delete the adjustment record
        db.run('DELETE FROM stock_adjustments WHERE id = ?', [id], (delErr) => {
          if (delErr) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: delErr.message });
          }

          db.run('COMMIT', (commitErr) => {
            if (commitErr) return res.status(500).json({ error: commitErr.message });
            res.json({ message: 'Stock adjustment deleted and inventory reversed' });
          });
        });
      });
    });
  });
});

// ============= Drawing Operations API =============
// GET all drawing operations
app.get('/api/drawing-operations', (req, res) => {
  db.all(`
    SELECT
      d.*,
      p.description as product_description
    FROM drawing_operations d
    LEFT JOIN products p ON d.product_id = p.id
    WHERE d.is_deleted = 0
    ORDER BY d.drawing_date DESC, d.id DESC
    LIMIT 100
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// POST create drawing operation
app.post('/api/drawing-operations', (req, res) => {
  const { drawing_date, product_id, raw_steel_material, steel_consumed, cores_produced, cores_rejected, notes } = req.body;

  if (!drawing_date || !product_id || !raw_steel_material || cores_produced == null || steel_consumed == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.serialize(() => {
    db.run('BEGIN');

    // Insert drawing operation record
    db.run(`
      INSERT INTO drawing_operations
      (drawing_date, product_id, raw_steel_material, steel_consumed, cores_produced, cores_rejected, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      drawing_date,
      product_id,
      raw_steel_material,
      Number(steel_consumed),
      Number(cores_produced),
      Number(cores_rejected || 0),
      notes || ''
    ], function(err) {
      if (err) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: err.message });
      }

      // Update inventory: Add produced steel rods (cores)
      db.run(`
        INSERT INTO inventory (product_id, cores, steel_rods, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(product_id) DO UPDATE SET
          cores = cores + ?,
          steel_rods = steel_rods + ?,
          updated_at = CURRENT_TIMESTAMP
      `, [product_id, Number(cores_produced), Number(cores_produced), Number(cores_produced), Number(cores_produced)], (invErr) => {
        if (invErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: invErr.message });
        }

        // Consume raw steel from raw materials inventory
        // Weighted average costing: Calculate cost of consumed steel
        db.get('SELECT average_cost_per_unit FROM raw_materials_inventory WHERE material = ?', [raw_steel_material], (_err4, costRow) => {
          const avgCost = Number(costRow?.average_cost_per_unit || 0);
          const consumedValue = Number(steel_consumed) * avgCost;

          db.run(`
            UPDATE raw_materials_inventory
            SET current_stock = MAX(0, current_stock - ?),
                total_value = MAX(0, total_value - ?),
                updated_at = CURRENT_TIMESTAMP
            WHERE material = ?
          `, [Number(steel_consumed), consumedValue, raw_steel_material], (matErr) => {
            if (matErr) {
              console.warn('Raw material deduction warning:', matErr.message);
            }

            db.run('COMMIT', (commitErr) => {
              if (commitErr) {
                return res.status(500).json({ error: commitErr.message });
              }
              res.json({
                message: 'Drawing operation recorded successfully',
                id: this.lastID,
                cores_produced: Number(cores_produced),
                steel_consumed: Number(steel_consumed)
              });
            });
          });
        });
      });
    });
  });
});

// DELETE drawing operation (reverses inventory changes)
app.delete('/api/drawing-operations/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM drawing_operations WHERE id = ? AND is_deleted = 0', [id], (err, operation) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!operation) return res.status(404).json({ error: 'Drawing operation not found' });

    db.serialize(() => {
      db.run('BEGIN');

      // Reverse inventory: Subtract cores and steel_rods
      db.run(`
        UPDATE inventory
        SET cores = MAX(0, cores - ?),
            steel_rods = MAX(0, steel_rods - ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
      `, [operation.cores_produced, operation.cores_produced, operation.product_id], (invErr) => {
        if (invErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: invErr.message });
        }

        // Return steel to raw materials inventory
        db.run(`
          UPDATE raw_materials_inventory
          SET current_stock = current_stock + ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE material = ?
        `, [operation.steel_consumed, operation.raw_steel_material], (matErr) => {
          if (matErr) {
            console.warn('Raw material return warning:', matErr.message);
          }

          // Mark as deleted (soft delete)
          db.run('UPDATE drawing_operations SET is_deleted = 1 WHERE id = ?', [id], (delErr) => {
            if (delErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: delErr.message });
            }

            db.run('COMMIT', (commitErr) => {
              if (commitErr) return res.status(500).json({ error: commitErr.message });
              res.json({ message: 'Drawing operation deleted and inventory reversed' });
            });
          });
        });
      });
    });
  });
});

// Delete production entry (reverses inventory changes)
app.delete('/api/production/:id', (req, res) => {
  const { id } = req.params;

  // Get production details first
  db.get('SELECT * FROM production_history WHERE id = ?', [id], (err, production) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!production) return res.status(404).json({ error: 'Production entry not found' });

    db.serialize(() => {
      db.run('BEGIN');

      // REVERSE SEQUENTIAL FLOW: Return materials to previous stages
      // This reverses the sequential flow logic from POST
      const platedQty = Number(production.plated || 0);
      const machinedQty = Number(production.machined || 0);
      const qcQty = Number(production.qc || 0);
      const stampedQty = Number(production.stamped || 0);
      const packedQty = Number(production.packed || 0);

      db.run(`
        UPDATE inventory
        SET cores = cores + ?,
            plated = MAX(0, plated + ? + ? + ? + ? - ?),
            machined = MAX(0, machined + ? + ? + ? - ?),
            qc = MAX(0, qc + ? + ? - ?),
            stamped = MAX(0, stamped + ? - ?),
            packed = MAX(0, packed - ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
      `, [
        // cores: add back plated quantity
        platedQty,
        // plated: add back what was consumed (machined, qc, stamped, packed), subtract what was added
        machinedQty, qcQty, stampedQty, packedQty, platedQty,
        // machined: add back what was consumed (qc, stamped, packed), subtract what was added
        qcQty, stampedQty, packedQty, machinedQty,
        // qc: add back what was consumed (stamped, packed), subtract what was added
        stampedQty, packedQty, qcQty,
        // stamped: add back what was consumed (packed), subtract what was added
        packedQty, stampedQty,
        // packed: subtract what was added
        packedQty,
        production.product_id
      ], (invErr) => {
        if (invErr) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: invErr.message });
        }

        // Delete the production record
        db.run('DELETE FROM production_history WHERE id = ?', [id], (delErr) => {
          if (delErr) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: delErr.message });
          }

          db.run('COMMIT', (commitErr) => {
            if (commitErr) return res.status(500).json({ error: commitErr.message });
            res.json({ message: 'Production entry deleted and inventory reversed' });
          });
        });
      });
    });
  });
});

app.get('/api/raw-materials', (req, res) => {
  // Calculate committed stock dynamically from active vendor POs
  db.all(`
    SELECT vli.material_type, SUM(vli.quantity) as total_committed
    FROM vendor_po_line_items vli
    JOIN vendor_purchase_orders vpo ON vli.po_id = vpo.id
    WHERE vpo.status NOT IN ('Completed', 'Cancelled')
      AND vli.item_type = 'Raw Material'
    GROUP BY vli.material_type
  `, (err, vendorPOs) => {
    if (err) return res.status(500).json({ error: err.message });

    const committedByMaterial = {};
    (vendorPOs || []).forEach(vpo => {
      committedByMaterial[vpo.material_type] = Number(vpo.total_committed || 0);
    });

    db.all("SELECT * FROM raw_materials_inventory", (err2, rows) => {
      if (err2) {
        res.status(500).json({ error: err2.message });
      } else {
        // Override committed_stock with dynamically calculated values
        const materials = (rows || []).map(row => ({
          ...row,
          committed_stock: committedByMaterial[row.material] || 0,
          available_stock: Number(row.current_stock || 0) - (committedByMaterial[row.material] || 0)
        }));
        res.json(materials);
      }
    });
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

app.put('/api/raw-materials/:material', (req, res) => {
  const { material } = req.params;
  const { current_stock, reorder_level, last_purchase_date } = req.body;

  db.run(
    `UPDATE raw_materials_inventory
     SET current_stock = ?,
         reorder_level = ?,
         last_purchase_date = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE material = ?`,
    [Number(current_stock || 0), Number(reorder_level || 0), last_purchase_date || null, material],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Material not found' });
      }
      res.json({ message: 'Raw material updated successfully', material });
    }
  );
});

app.delete('/api/raw-materials/:material', (req, res) => {
  const { material } = req.params;

  db.run('DELETE FROM raw_materials_inventory WHERE material = ?', [material], function(err) {
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
  
  // Fixed: stamped is finished goods, not WIP (removed from WIP calculation)
  db.get("SELECT SUM(plated + machined + qc) as total_wip FROM inventory", (_err, row) => {
    stats.total_wip = row ? row.total_wip || 0 : 0;
    
    db.get("SELECT SUM(stamped) as total_finished FROM inventory", (err, row) => {
      stats.total_finished = row ? row.total_finished || 0 : 0;
      
      db.get(`
        SELECT SUM(li.quantity - li.delivered) as pending
        FROM client_po_line_items li
        JOIN client_purchase_orders po ON li.po_id = po.id
        WHERE li.delivered < li.quantity
          AND po.status NOT IN ('Completed', 'Cancelled')
      `, (err, row) => {
        stats.pending_client_orders = row ? row.pending || 0 : 0;

        db.get(`
          SELECT COUNT(DISTINCT po.id) as overdue
          FROM client_purchase_orders po
          LEFT JOIN client_po_line_items li ON po.id = li.po_id
          WHERE po.due_date < date('now')
            AND li.delivered < li.quantity
            AND po.status NOT IN ('Completed', 'Cancelled')
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
    JOIN client_purchase_orders po ON li.po_id = po.id
    WHERE li.delivered < li.quantity
      AND po.status NOT IN ('Completed', 'Cancelled')
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

    // Calculate committed stock dynamically from active vendor POs
    db.all(`
      SELECT vli.material_type, SUM(vli.quantity) as total_qty
      FROM vendor_po_line_items vli
      JOIN vendor_purchase_orders vpo ON vli.po_id = vpo.id
      WHERE vpo.status NOT IN ('Completed', 'Cancelled')
        AND vli.item_type = 'Raw Material'
      GROUP BY vli.material_type
    `, (err2, vendorPOs) => {
      if (err2) {
        return res.status(500).json({ error: err2.message });
      }

      const committedStock = {};
      (vendorPOs || []).forEach(vpo => {
        committedStock[vpo.material_type] = Number(vpo.total_qty || 0);
      });

      db.all("SELECT * FROM raw_materials_inventory", (err3, materials) => {
        if (err3) {
          return res.status(500).json({ error: err3.message });
        }

        const steel = materials.find(m => m.material === 'Steel') || { current_stock: 0 };
        const copper = materials.find(m => m.material === 'Copper Anode' || m.material === 'Copper') || { current_stock: 0 };

        // For risk management, use current_stock (what's actually on hand)
        // committed stock is calculated dynamically from active vendor POs
        const steelAvailable = Number(steel.current_stock || 0);
        const copperAvailable = Number(copper.current_stock || 0);
        const steelCommitted = committedStock['Steel'] || 0;
        const copperCommitted = committedStock['Copper Anode'] || committedStock['Copper'] || 0;

        res.json({
          steel: {
            required: totalSteelNeeded.toFixed(2),
            available: steelAvailable,
            committed: steelCommitted,
            shortage: Math.max(0, totalSteelNeeded - steelAvailable).toFixed(2),
            excess: Math.max(0, steelAvailable - totalSteelNeeded).toFixed(2)
          },
          copper: {
            required: totalCopperNeeded.toFixed(2),
            available: copperAvailable,
            committed: copperCommitted,
            shortage: Math.max(0, totalCopperNeeded - copperAvailable).toFixed(2),
            excess: Math.max(0, copperAvailable - totalCopperNeeded).toFixed(2)
          }
        });
      });
    });
  });
});

// Cleanup endpoint to fix corrupted PDF paths
// Regenerate missing BOMs for auto-BOM products
app.post('/api/dashboard/regenerate-boms', (req, res) => {
  db.all('SELECT id, steel_diameter, copper_coating, length, custom_bom FROM products WHERE custom_bom = 0 OR custom_bom IS NULL', (err, products) => {
    if (err) return res.status(500).json({ error: err.message });

    let regenerated = 0;
    let processed = 0;

    if (!products || products.length === 0) {
      return res.json({ message: 'No auto-BOM products found', regenerated: 0 });
    }

    products.forEach(product => {
      if (product.steel_diameter > 0 && product.length > 0) {
        // Delete existing BOM entries
        db.run('DELETE FROM bom WHERE product_id = ?', [product.id], (delErr) => {
          if (!delErr) {
            // Calculate and insert new BOM
            const steelRadiusMM = product.steel_diameter / 2;
            const steelVolumeMM3 = Math.PI * steelRadiusMM * steelRadiusMM * product.length;
            const steelVolumeM3 = steelVolumeMM3 / 1e9;
            const steelDensity = 7850;
            const steelWeightKg = steelVolumeM3 * steelDensity;

            const copperThicknessMM = product.copper_coating / 1000;
            const copperSurfaceAreaMM2 = 2 * Math.PI * (product.steel_diameter / 2) * product.length;
            const copperVolumeMM3 = copperSurfaceAreaMM2 * copperThicknessMM;
            const copperVolumeM3 = copperVolumeMM3 / 1e9;
            const copperDensity = 8960;
            const copperWeightKg = copperVolumeM3 * copperDensity;

            db.run('INSERT INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?)', [product.id, 'Steel', steelWeightKg]);
            db.run('INSERT INTO bom (product_id, material, qty_per_unit) VALUES (?, ?, ?)', [product.id, 'Copper Anode', copperWeightKg], () => {
              regenerated++;
            });
          }
        });
      }

      processed++;
      if (processed === products.length) {
        setTimeout(() => {
          res.json({ message: `Regenerated BOMs for ${regenerated} products`, regenerated, total: products.length });
        }, 500); // Wait for all inserts to complete
      }
    });
  });
});

app.post('/api/dashboard/cleanup-bad-pdf-paths', (req, res) => {
  db.run(`
    UPDATE client_purchase_orders
    SET pdf_path = NULL
    WHERE pdf_path IS NOT NULL
      AND (pdf_path LIKE '%app.restored.js%'
           OR pdf_path NOT LIKE '%.pdf')
  `, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      message: 'Cleaned up bad PDF paths',
      rows_updated: this.changes
    });
  });
});

// Diagnostic endpoint to check vendor POs and committed stock
app.get('/api/dashboard/diagnostic-vendor', (req, res) => {
  db.all(`
    SELECT vpo.id, vpo.status, vli.material_type, vli.quantity
    FROM vendor_purchase_orders vpo
    LEFT JOIN vendor_po_line_items vli ON vpo.id = vli.po_id
    WHERE vpo.status NOT IN ('Completed', 'Cancelled')
  `, (err, vendorPOs) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(`SELECT material, current_stock, committed_stock FROM raw_materials_inventory`, (err2, materials) => {
      if (err2) return res.status(500).json({ error: err2.message });

      res.json({
        vendor_pos: vendorPOs,
        materials: materials,
        summary: {
          total_vendor_pos: vendorPOs.length,
          committed_in_db: materials.reduce((sum, m) => sum + Number(m.committed_stock || 0), 0)
        }
      });
    });
  });
});

// Diagnostic endpoint to check line items
app.get('/api/dashboard/diagnostic', (req, res) => {
  db.all(`
    SELECT
      li.id as line_item_id,
      li.po_id,
      li.product_id,
      li.quantity,
      li.delivered,
      po.id as po_exists,
      po.status as po_status,
      p.id as product_exists
    FROM client_po_line_items li
    LEFT JOIN client_purchase_orders po ON li.po_id = po.id
    LEFT JOIN products p ON li.product_id = p.id
    WHERE li.delivered < li.quantity
  `, (err, items) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      items,
      count: items.length,
      orphaned: items.filter(i => !i.po_exists).length,
      withDeletedOrders: items.filter(i => i.po_exists && (i.po_status === 'Completed' || i.po_status === 'Cancelled')).length
    });
  });
});

// Cleanup endpoint to delete orphaned and completed/cancelled order line items
app.delete('/api/dashboard/cleanup-orphaned-items', (req, res) => {
  let orphanedCount = 0;
  let completedCount = 0;

  db.serialize(() => {
    // Delete line items with no parent order
    db.run(`
      DELETE FROM client_po_line_items
      WHERE po_id NOT IN (SELECT id FROM client_purchase_orders)
    `, function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      orphanedCount = this.changes;

      // Delete line items from Completed or Cancelled orders
      db.run(`
        DELETE FROM client_po_line_items
        WHERE po_id IN (
          SELECT id FROM client_purchase_orders
          WHERE status IN ('Completed', 'Cancelled')
        )
      `, function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        completedCount = this.changes;

        res.json({
          message: 'Line items cleaned up',
          orphanedDeleted: orphanedCount,
          completedCancelledDeleted: completedCount,
          totalDeleted: orphanedCount + completedCount
        });
      });
    });
  });
});

// Emergency cleanup - delete ALL line items (use when you have 0 orders)
app.delete('/api/dashboard/emergency-cleanup-all-line-items', (req, res) => {
  db.run(`DELETE FROM client_po_line_items`, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      message: 'Emergency cleanup: ALL line items deleted',
      deletedCount: this.changes
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
  const { invoice_number, invoice_date, due_date, tax_rate = 0, advance_percent, balance_payment_terms, mode_of_delivery, expected_delivery_date } = req.body;

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
            outstanding_amount, payment_status, currency, notes,
            advance_percent, balance_payment_terms, mode_of_delivery, expected_delivery_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoice_number, po_id, invoice_date, due_date || invoice_date,
            customer?.name || po.customer_id,
            customer?.office_address || '',
            customer?.gstin || '',
            subtotal, tax_amount, total_amount,
            total_amount, 'Pending', po.currency || 'INR', po.notes || '',
            advance_percent ?? po.advance_percent,
            balance_payment_terms || po.balance_payment_terms,
            mode_of_delivery || po.mode_of_delivery,
            expected_delivery_date || po.expected_delivery_date
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

// Update payment
app.put('/api/payments/:id', (req, res) => {
  const { id } = req.params;
  const { payment_date, amount, payment_method, reference_number, notes } = req.body;

  if (!payment_date || !amount) {
    return res.status(400).json({ error: 'Payment date and amount are required' });
  }

  // Get old payment details
  db.get('SELECT * FROM payment_history WHERE id = ?', [id], (err, oldPayment) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!oldPayment) return res.status(404).json({ error: 'Payment not found' });

    db.run('BEGIN TRANSACTION', (err) => {
      if (err) return res.status(500).json({ error: err.message });

      // Update payment record
      db.run(
        `UPDATE payment_history SET
          payment_date = ?,
          amount = ?,
          payment_method = ?,
          reference_number = ?,
          notes = ?
        WHERE id = ?`,
        [payment_date, amount, payment_method || null, reference_number || null, notes || null, id],
        function(updateErr) {
          if (updateErr) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: updateErr.message });
          }

          // Calculate the delta in payment amount
          const amountDelta = parseFloat(amount) - parseFloat(oldPayment.amount);

          // Update invoice amounts
          db.get('SELECT amount_paid, total_amount FROM invoices WHERE invoice_number = ?', [oldPayment.invoice_number], (err2, invoice) => {
            if (err2) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: err2.message });
            }
            if (!invoice) {
              db.run('ROLLBACK');
              return res.status(404).json({ error: 'Invoice not found' });
            }

            const new_amount_paid = (invoice.amount_paid || 0) + amountDelta;
            const new_outstanding = invoice.total_amount - new_amount_paid;
            const new_status = new_outstanding <= 0 ? 'Paid' : new_outstanding < invoice.total_amount ? 'Partial' : 'Pending';

            db.run(
              `UPDATE invoices SET
                amount_paid = ?,
                outstanding_amount = ?,
                payment_status = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE invoice_number = ?`,
              [new_amount_paid, new_outstanding, new_status, oldPayment.invoice_number],
              (err3) => {
                if (err3) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: err3.message });
                }

                // Update client PO if exists
                if (oldPayment.po_id) {
                  db.run(
                    `UPDATE client_purchase_orders SET
                      amount_paid = ?,
                      outstanding_amount = ?,
                      payment_status = ?
                    WHERE id = ?`,
                    [new_amount_paid, new_outstanding, new_status, oldPayment.po_id],
                    (err4) => {
                      if (err4) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err4.message });
                      }
                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: commitErr.message });
                        }
                        res.json({ message: 'Payment updated successfully' });
                      });
                    }
                  );
                } else {
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: commitErr.message });
                    }
                    res.json({ message: 'Payment updated successfully' });
                  });
                }
              }
            );
          });
        }
      );
    });
  });
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

// Upload Client PO PDF
if (upload) {
  app.post('/api/purchase-orders/:id/upload-pdf', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const { id } = req.params;
      const dir = path.join(__dirname, 'uploads', 'client_po_pdfs');
      await ensureDir(dir);

      const fileName = `${id}_${Date.now()}_${req.file.originalname}`;
      const filePath = path.join(dir, fileName);
      await fsp.writeFile(filePath, req.file.buffer);

      const relativePath = path.relative(__dirname, filePath).replace(/\\/g, '/');

      db.run(
        `UPDATE client_purchase_orders SET pdf_path = ? WHERE id = ?`,
        [relativePath, id],
        function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: 'PDF uploaded successfully', pdf_path: relativePath });
        }
      );
    } catch (err) {
      res.status(500).json({ error: err.message || 'Upload failed' });
    }
  });
}

// Get Client PO PDF
app.get('/api/purchase-orders/:id/pdf', (req, res) => {
  const { id } = req.params;
  db.get('SELECT pdf_path FROM client_purchase_orders WHERE id=?', [id], (err, row) => {
    if (err || !row || !row.pdf_path) return res.status(404).send('PDF not found');
    const fullPath = path.isAbsolute(row.pdf_path) ? row.pdf_path : path.join(__dirname, row.pdf_path);
    res.sendFile(fullPath, (e) => { if (e) res.status(404).send('File not found'); });
  });
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
    `SELECT product_id, stamped, committed FROM inventory WHERE product_id IN (${placeholders})`,
    productIds,
    (err, inventoryRows) => {
      if (err) return res.status(500).json({ error: err.message });

      const inventoryMap = {};
      (inventoryRows || []).forEach(row => {
        inventoryMap[row.product_id] = {
          stamped: Number(row.stamped || 0),
          committed: Number(row.committed || 0),
          available: Number(row.stamped || 0) - Number(row.committed || 0)
        };
      });

      const details = line_items.map(item => {
        const inv = inventoryMap[item.product_id] || { stamped: 0, committed: 0, available: 0 };
        const requested = Number(item.quantity || 0);
        const shortfall = Math.max(0, requested - inv.available);

        return {
          product_id: item.product_id,
          requested: requested,
          available: inv.available,
          stamped: inv.stamped,
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

// ============================================================================
// GEMINI AI CHATBOT ENDPOINT
// ============================================================================

app.post('/api/chat', async (req, res) => {
  console.log('📨 Gemini chat request received');

  if (!GoogleGenAI) {
    console.error('❌ GoogleGenAI SDK not loaded');
    return res.status(503).json({
      error: 'Gemini AI not available',
      details: 'The @google/genai package failed to load. Please check server logs.'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in environment');
    return res.status(400).json({
      error: 'Gemini API key not configured',
      details: 'GEMINI_API_KEY environment variable is missing. Please add it on Render.'
    });
  }

  console.log('✅ Gemini API key found, length:', apiKey.length);

  try {
    const { message, conversationHistory = [] } = req.body;
    console.log('💬 User message:', message.substring(0, 50) + '...');

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Fetch current system data for context
    const products = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM products WHERE is_deleted = 0 ORDER BY id', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const inventory = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM inventory', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const customers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM customers WHERE is_deleted = 0 ORDER BY id', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const vendors = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM vendors WHERE is_deleted = 0 ORDER BY id', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const clientPOs = await new Promise((resolve, reject) => {
      db.all(`SELECT po.*, c.name as customer_name
              FROM client_purchase_orders po
              LEFT JOIN customers c ON po.customer_id = c.id
              WHERE po.is_deleted = 0
              ORDER BY po.po_date DESC LIMIT 50`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const recentProduction = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM production_history
              ORDER BY production_date DESC LIMIT 20`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const rawMaterials = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM raw_materials_inventory', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Build comprehensive system prompt with workflow examples
    const systemPrompt = `You are an intelligent ERP assistant for Nikkon Ferro, a copper bonded ground rod manufacturing company.

# Your Role:
1. **Answer Questions** - Help users find data, understand workflows, troubleshoot issues
2. **Guide Users** - Walk through complex tasks step-by-step (production, orders, payments)
3. **Provide Context** - Explain WHY things work certain ways (business rules, inventory flow)
4. **Validate Operations** - Warn about low inventory, unusual quantities, or workflow violations

# IMPORTANT - System Navigation:
The system has these main tabs/sections:
- **Dashboard** - Overview and quick stats
- **Daily Production** - Record production (plating, machining, QC, stamping, packing)
- **Client Purchase Orders** - Customer orders and line items
- **Invoice Management** - Create invoices, record/edit payments
- **Vendor Orders** - Purchase orders to suppliers
- **Job Work** - Send materials to vendors for processing
- **Shipments** - Track deliveries to customers
- **Inventory** - View WIP, finished goods, raw materials (with production tracing)
- **Products** - Product master data
- **Customers** - Customer management
- **Vendors** - Vendor management
- **Drawing Operations** - Convert raw steel to steel cores

When users ask "how do I..." questions, ALWAYS include which tab/section to navigate to.

# Example Good Responses:

User: "How do I record today's production?"
Good Answer: "Go to the **Daily Production** tab. Select today's date, then for each product:
• If plating steel cores → Enter quantity in 'Plated' column
• If continuing from previous stage → Enter quantity in that stage's column
• Add marking details if stamping
• Click Submit

The system automatically updates inventory for each stage."

User: "How can I see where my inventory came from?"
Good Answer: "Go to the **Inventory** tab, then click on any product row. A modal will open showing:
• Current inventory levels at top (Steel Rods → Packed)
• Last 50 production entries below
This helps trace inventory back to specific production dates and quantities."

User: "Can I fix a mistake in yesterday's production?"
Good Answer: "Yes! Go to **Daily Production** tab → scroll to 'Recent Production' log → click the row you need to edit. You can:
• Change any quantities, dates, or marking details
• Delete the entry completely
The system automatically recalculates inventory when you save/delete."

# Current System Data (as of ${new Date().toISOString().slice(0,10)}):

## Products (${products.length} total):
${products.slice(0, 10).map(p => `- ${p.id}: ${p.description} (${p.diameter}${p.diameter_unit} × ${p.length}${p.length_unit})`).join('\n')}
${products.length > 10 ? `... and ${products.length - 10} more` : ''}

## Current Inventory Summary:
${inventory.slice(0, 10).map(inv => {
  const prod = products.find(p => p.id === inv.product_id);
  return `- ${inv.product_id} (${prod?.description || 'Unknown'}): Cores: ${inv.cores || 0}, Plated: ${inv.plated || 0}, Machined: ${inv.machined || 0}, QC: ${inv.qc || 0}, Stamped: ${inv.stamped || 0}, Packed: ${inv.packed || 0}`;
}).join('\n')}

## Customers (${customers.length} total):
${customers.slice(0, 10).map(c => `- ${c.id}: ${c.name}`).join('\n')}
${customers.length > 10 ? `... and ${customers.length - 10} more` : ''}

## Vendors (${vendors.length} total):
${vendors.slice(0, 10).map(v => `- ${v.id}: ${v.name}`).join('\n')}
${vendors.length > 10 ? `... and ${vendors.length - 10} more` : ''}

## Recent Client Orders (${clientPOs.length} shown):
${clientPOs.slice(0, 5).map(po => `- ${po.id}: ${po.customer_name} - Status: ${po.status} - Date: ${po.po_date}`).join('\n')}

## Recent Production Activity:
${recentProduction.slice(0, 5).map(p => `- ${p.production_date}: ${p.product_id} - Plated: ${p.plated || 0}, Machined: ${p.machined || 0}, QC: ${p.qc || 0}, Stamped: ${p.stamped || 0}`).join('\n')}

## Raw Materials Inventory:
${rawMaterials.map(rm => `- ${rm.material}: ${rm.current_stock} ${rm.unit} (Committed: ${rm.committed_stock || 0})`).join('\n')}

# Production Workflow:
Steel Rods → Plating → Machining → QC → Stamping/Marking (Final Finished Goods)
(Each stage consumes from previous stage - sequential flow. Stamped = ready to ship)

# Your Capabilities:

**READ-ONLY QUERIES** (You can answer directly):
- "Show me inventory for product X"
- "What orders are pending for customer Y?"
- "Which vendors do we use for copper?"
- "What was produced yesterday?"

**GUIDED DATA ENTRY** (Ask questions, then return action JSON):
When user wants to create/update data:
1. Ask clarifying questions one at a time
2. Validate inputs and warn about issues
3. Once you have all info, return JSON in this format:

{
  "action": "create_vendor_po" | "record_production" | "create_shipment" | "update_order_status" | etc.,
  "data": {
    // All required fields
  },
  "needsConfirmation": true/false,
  "warnings": ["Optional warning messages"]
}

**SMART SUGGESTIONS**:
- Suggest recently used vendors/customers
- Warn about low inventory
- Flag unusual quantities (e.g., 10x normal)
- Remind about sequential production flow

# Important Business Rules:
1. Production is SEQUENTIAL: Can't stamp without QC, can't QC without machining, etc. Stamped = final finished goods ready to ship.
2. Marking types: unmarked (flexible), nikkon_brand (semi-flexible), client_brand (locked to customer)
3. Always validate inventory availability before confirming operations
4. Job Work types: Steel Core Production, Custom Machining, Other Processing

# Common User Questions & How to Answer:

Q: "How do I edit a payment?"
A: "Go to **Invoice Management** → click the invoice → in the Payment History modal, click **Edit** button next to the payment. You can change date, amount, method, reference #, and notes. The invoice outstanding amount updates automatically."

Q: "How do I trace inventory discrepancies?"
A: "Go to **Inventory** tab → click the product row with the discrepancy. You'll see:
• Current inventory at each stage (top)
• Last 50 production entries (below)
Review the production entries to find where numbers don't match."

Q: "Why don't I have enough finished goods?"
A: "Stamped inventory is your finished goods ready to ship. Check **Inventory** tab to see your stamped quantity. If it's low, you need to:
1. Go to **Daily Production**
2. Record stamping operation to move QC items to finished goods
3. Stamped items are immediately ready for shipment"

Q: "How do I process a customer order end-to-end?"
A: "Here's the full workflow:
1. **Client Purchase Orders** → Create PO with customer and line items
2. **Inventory** → Verify you have stamped (finished goods) inventory
3. **Invoice Management** → Generate invoice from PO
4. **Invoice Management** → Record Payment when received
5. **Shipments** → Create shipment with carrier/tracking (reduces stamped inventory)
6. **Client Purchase Orders** → Mark PO as Completed"

Q: "What's the difference between unmarked, nikkon_brand, and client_brand?"
A: "Marking types control flexibility:
• **Unmarked** - No branding, can sell to anyone
• **Nikkon Brand** - Nikkon Ferro branding, preferred for regular customers
• **Client Brand** - Custom branding, LOCKED to specific customer only
Set this in **Daily Production** when recording stamping operations."

# Response Guidelines:
- ALWAYS mention which tab/section to navigate to
- Be specific with step-by-step instructions
- Use bullet points (•) for lists
- Include relevant numbers from current data
- Ask ONE clarifying question at a time if needed
- For ambiguous requests, ask which specific item they mean
- Warn about low inventory or workflow violations

User message: ${message}`;

    // Call Gemini API using new SDK
    console.log('🚀 Initializing Gemini AI client...');
    const ai = new GoogleGenAI({ apiKey });

    console.log('📤 Sending request to Gemini API (model: gemini-2.5-flash)...');
    // Use gemini-2.5-flash model (user confirmed this is available)
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: systemPrompt
    });
    console.log('📥 Received response from Gemini API');

    // Extract text from response - new SDK returns candidates array
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) {
      console.error('Gemini response structure:', JSON.stringify(result, null, 2));
      throw new Error('No text content in Gemini response');
    }

    console.log(`✅ Gemini response received: ${text.substring(0, 100)}...`);

    // Check if response contains action JSON
    let actionData = null;
    const jsonMatch = text.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        actionData = JSON.parse(jsonMatch[0]);
      } catch (e) {
        // Not valid JSON, treat as regular text
      }
    }

    res.json({
      response: text,
      action: actionData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Gemini API error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to process chat message',
      details: error.message,
      type: error.name || 'Unknown error'
    });
  }
});

// ============================================================================
// CLAUDE AI CHATBOT ENDPOINT (Premium Assistant)
// ============================================================================

app.post('/api/chat/claude', async (req, res) => {
  console.log('📨 Claude chat request received');

  if (!Anthropic) {
    console.error('❌ Anthropic SDK not loaded');
    return res.status(503).json({
      error: 'Claude AI not available',
      details: 'The @anthropic-ai/sdk package is not installed. Please install it or use Gemini instead.'
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY not found in environment');
    return res.status(400).json({
      error: 'Claude API key not configured',
      details: 'Please add ANTHROPIC_API_KEY to your environment variables on Render, or use Gemini (Fast) mode instead.',
      fallback: 'Switch to Gemini (Fast) mode which is already configured and working.'
    });
  }

  console.log('✅ Claude API key found, length:', apiKey.length);

  try {
    const { message, conversationHistory = [] } = req.body;
    console.log('💬 User message:', message.substring(0, 50) + '...');

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Load knowledge base
    const knowledgeBasePath = path.join(__dirname, 'erp-knowledge-base.md');
    let knowledgeBase = '';
    try {
      knowledgeBase = await fsp.readFile(knowledgeBasePath, 'utf-8');
    } catch (err) {
      console.warn('Knowledge base file not found, proceeding without it');
    }

    // Fetch current system data for context (same as Gemini)
    const products = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM products WHERE is_deleted = 0 ORDER BY id', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const inventory = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM inventory', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const customers = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM customers WHERE is_deleted = 0 ORDER BY id', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const clientPOs = await new Promise((resolve, reject) => {
      db.all(`SELECT po.*, c.name as customer_name
              FROM client_purchase_orders po
              LEFT JOIN customers c ON po.customer_id = c.id
              WHERE po.is_deleted = 0
              ORDER BY po.po_date DESC LIMIT 50`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const recentProduction = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM production_history
              ORDER BY production_date DESC LIMIT 20`, [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Build system message with knowledge base
    const systemMessage = `You are an expert ERP assistant for Nikkon Ferro's Ground Rod Manufacturing ERP system. You helped build this system, so you understand it deeply.

# Your Expertise:
- Complete knowledge of all system features, workflows, and business rules
- Understanding of manufacturing process: Steel Rods → Plating → Machining → QC → Stamping (Final Finished Goods)
- Database structure and relationships between tables
- User interface navigation and features

# Knowledge Base:
${knowledgeBase}

# Current System Data (as of ${new Date().toISOString().slice(0,10)}):

## Products (${products.length} total):
${products.slice(0, 15).map(p => `- ${p.id}: ${p.description} (${p.diameter}${p.diameter_unit} × ${p.length}${p.length_unit})`).join('\n')}
${products.length > 15 ? `... and ${products.length - 15} more` : ''}

## Current Inventory Summary:
${inventory.slice(0, 15).map(inv => {
  const prod = products.find(p => p.id === inv.product_id);
  return `- ${inv.product_id} (${prod?.description || 'Unknown'}): Steel Rods: ${inv.steel_rods || 0}, Plated: ${inv.plated || 0}, Machined: ${inv.machined || 0}, QC: ${inv.qc || 0}, Stamped: ${inv.stamped || 0}`;
}).join('\n')}

## Recent Client Orders (${clientPOs.length} shown):
${clientPOs.slice(0, 10).map(po => `- ${po.id}: ${po.customer_name} - Status: ${po.status} - Total: ${po.total_amount} - Outstanding: ${po.outstanding_amount}`).join('\n')}

## Recent Production:
${recentProduction.slice(0, 10).map(p => `- ${p.production_date}: ${p.product_id} - Plated: ${p.plated || 0}, Machined: ${p.machined || 0}, QC: ${p.qc || 0}, Stamped: ${p.stamped || 0}`).join('\n')}

# Instructions:
- Provide comprehensive, step-by-step guidance
- Always mention which tab/section to navigate to
- Explain WHY things work the way they do (business logic)
- Reference specific features you know exist (editable payments, inventory tracing, etc.)
- Use the knowledge base to provide accurate workflow instructions
- Be conversational but professional
- Format responses with clear headings, bullet points, and numbered steps`;

    // Build conversation messages
    const messages = [
      // Add conversation history
      ...conversationHistory.map(msg => ({
        role: msg.role === 'bot' ? 'assistant' : 'user',
        content: msg.content
      })),
      // Add current user message
      {
        role: 'user',
        content: message
      }
    ];

    // Call Claude API
    console.log('🚀 Initializing Claude AI client...');
    const anthropic = new Anthropic({ apiKey });

    console.log('📤 Sending request to Claude API (model: claude-sonnet-4-5-20250929)...');
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: systemMessage,
      messages: messages
    });

    console.log('📥 Received response from Claude API');
    const text = response.content[0].text;

    console.log(`✅ Claude response received: ${text.substring(0, 100)}...`);

    res.json({
      response: text,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Claude API error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to process chat message',
      details: error.message,
      type: error.name || 'Unknown error'
    });
  }
});

// Action execution endpoint (for confirmed actions from chatbot)
app.post('/api/chat/execute', async (req, res) => {
  try {
    const { action, data } = req.body;

    if (!action || !data) {
      return res.status(400).json({ error: 'Action and data required' });
    }

    // Execute the requested action
    switch (action) {
      case 'create_vendor_po':
        // Reuse existing endpoint logic
        const vpoId = data.id || `VPO-${Date.now()}`;
        db.run(
          `INSERT INTO vendor_purchase_orders (id, vendor_id, po_date, due_date, status, notes) VALUES (?,?,?,?,?,?)`,
          [vpoId, data.vendor_id, data.po_date, data.due_date || null, data.status || 'Pending', data.notes || ''],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: `Created vendor PO ${vpoId}`, id: vpoId });
          }
        );
        break;

      case 'record_production':
        // Similar to existing production endpoint
        const { production_date, entries } = data;
        if (!entries || !Array.isArray(entries)) {
          return res.status(400).json({ error: 'Entries array required' });
        }

        db.serialize(() => {
          db.run('BEGIN');

          const stmt = db.prepare(`INSERT INTO production_history
            (production_date, product_id, plated, machined, qc, stamped, packed, rejected, notes, marking_type, marking_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

          entries.forEach(entry => {
            stmt.run([
              production_date,
              entry.product_id,
              entry.plated || 0,
              entry.machined || 0,
              entry.qc || 0,
              entry.stamped || 0,
              entry.packed || 0,
              entry.rejected || 0,
              entry.notes || '',
              entry.marking_type || 'unmarked',
              entry.marking_text || null
            ]);
          });

          stmt.finalize();
          db.run('COMMIT', (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Production recorded successfully' });
          });
        });
        break;

      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
    }

  } catch (error) {
    console.error('Action execution error:', error);
    res.status(500).json({ error: 'Failed to execute action', details: error.message });
  }
});

// ============================================================================
// ADMIN ENDPOINTS (Protected)
// ============================================================================

// Reset WIP inventory (keeps packed inventory)
app.post('/api/admin/reset-wip', (req, res) => {
  const { confirm } = req.body;

  if (confirm !== 'RESET_WIP_INVENTORY') {
    return res.status(400).json({
      error: 'Confirmation required',
      message: 'Send { "confirm": "RESET_WIP_INVENTORY" } to proceed'
    });
  }

  db.run(
    `UPDATE inventory
     SET steel_rods = 0,
         plated = 0,
         machined = 0,
         qc = 0,
         stamped = 0,
         updated_at = CURRENT_TIMESTAMP`,
    [],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      console.log(`✅ Admin: Reset WIP inventory for ${this.changes} products`);

      res.json({
        message: 'WIP inventory reset successfully',
        products_updated: this.changes,
        reset_fields: ['steel_rods', 'plated', 'machined', 'qc', 'stamped'],
        preserved_fields: ['packed']
      });
    }
  );
});

// ============= DATABASE RESET ENDPOINT =============
// Reset inventory and production data while preserving master data
app.post('/api/admin/reset-inventory-production', (req, res) => {
  const { confirmPassword } = req.body;

  // Simple password protection - change this to your preferred password
  if (confirmPassword !== 'RESET2025') {
    return res.status(403).json({ error: 'Invalid password' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    try {
      // Clear all inventory data
      db.run('DELETE FROM inventory', (err) => {
        if (err) throw err;
      });

      // Clear all inventory allocations (marking/branding data)
      db.run('DELETE FROM inventory_allocations', (err) => {
        if (err) throw err;
      });

      // Clear production history
      db.run('DELETE FROM production_history', (err) => {
        if (err) throw err;
      });

      // Clear job work orders
      db.run('DELETE FROM job_work_orders', (err) => {
        if (err) throw err;
      });

      // Clear job work receipts
      db.run('DELETE FROM job_work_receipts', (err) => {
        if (err) throw err;
      });

      // Clear drawing operations
      db.run('DELETE FROM drawing_operations', (err) => {
        if (err) throw err;
      });

      // Reset raw materials inventory to zero
      db.run('UPDATE raw_materials_inventory SET current_stock = 0, committed_stock = 0, updated_at = CURRENT_TIMESTAMP', (err) => {
        if (err) throw err;
      });

      // Clear vendor PO line items first (foreign key constraint)
      db.run('DELETE FROM vendor_po_line_items', (err) => {
        if (err) throw err;
      });

      // Clear vendor purchase orders
      db.run('DELETE FROM vendor_purchase_orders', (err) => {
        if (err) throw err;
      });

      // Clear shipments
      db.run('DELETE FROM shipments', (err) => {
        if (err) throw err;
      });

      // Clear shipment items
      db.run('DELETE FROM shipment_items', (err) => {
        if (err) throw err;
      });

      // PRESERVED DATA:
      // - customers (kept)
      // - client_purchase_orders (kept)
      // - client_po_line_items (kept)
      // - products (kept)
      // - vendors (kept)
      // - bom (kept)
      // - raw_materials_inventory structure (kept, but stock reset to 0)

      db.run('COMMIT', (err) => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Reset failed: ' + err.message });
        }

        res.json({
          success: true,
          message: 'Database reset successfully',
          cleared: [
            'inventory',
            'inventory_allocations',
            'production_history',
            'job_work_orders',
            'job_work_receipts',
            'drawing_operations',
            'raw_materials_inventory (stock reset to 0)',
            'vendor_purchase_orders',
            'vendor_po_line_items',
            'shipments',
            'shipment_items'
          ],
          preserved: [
            'customers',
            'client_purchase_orders',
            'client_po_line_items',
            'products',
            'vendors',
            'bom (Bill of Materials)'
          ]
        });
      });
    } catch (err) {
      db.run('ROLLBACK');
      return res.status(500).json({ error: 'Reset failed: ' + err.message });
    }
  });
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
