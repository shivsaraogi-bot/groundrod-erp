# Ground Rod ERP System - Complete Knowledge Base

## System Overview
This is a comprehensive ERP system for a copper bonded ground rod manufacturing company (Nikkon Ferro). The system manages the entire business lifecycle from raw material procurement to finished product delivery.

---

## Core Business Flow

### Manufacturing Process (Sequential Workflow)
1. **Raw Steel Procurement** → Purchase steel rods from vendors
2. **Drawing Operations** → Convert raw steel into steel cores (specific diameters)
3. **Plating** → Copper electroplating on steel cores
4. **Machining** → Thread cutting, chamfering, drilling holes
5. **QC (Quality Control)** → Inspection and testing
6. **Stamping/Marking** → Apply branding (unmarked, Nikkon brand, or client brand)
7. **Packing** → Final packaging for shipment
8. **Shipment** → Delivery to customers

**CRITICAL:** Each stage consumes inventory from the previous stage. You cannot pack without stamping, cannot stamp without QC, etc.

---

## Database Tables & Relationships

### Products (`products`)
- **Primary Key:** `id` (e.g., "1225", "1440", "1875")
- **Fields:** `description`, `diameter`, `diameter_unit`, `length`, `length_unit`, `unit_weight_rods`, `unit_weight_copper`, `total_weight`
- **Product Naming:** Format is `{diameter}_{length}` (e.g., "12.50mm x 2500mm")
- **Usage:** Referenced by inventory, production, orders, shipments

### Inventory (`inventory`)
- **Primary Key:** `product_id` (FK to products.id)
- **Stage Columns:** `steel_rods`, `plated`, `machined`, `qc`, `stamped`, `packed`
- **Logic:** Each production entry updates multiple columns based on sequential flow
- **Special:** `steel_rods` column updated by Drawing Operations

### Production History (`production_history`)
- **Records:** Daily production activities
- **Key Fields:** `production_date`, `product_id`, `plated`, `machined`, `qc`, `stamped`, `packed`, `rejected`
- **Marking:** `marking_type` (unmarked/nikkon_brand/client_brand), `marking_text`
- **Editing:** Full CRUD operations with automatic inventory recalculation
- **Business Rules:**
  - Plated quantity creates new plated inventory AND reduces steel_rods
  - Machined reduces plated, adds to machined
  - QC reduces machined, adds to qc
  - Stamped reduces qc, adds to stamped
  - Packed reduces stamped, adds to packed
  - Rejected removes from any stage

### Raw Materials (`raw_materials_inventory`)
- **Materials:** Steel, Copper, Packing Materials, etc.
- **Fields:** `material`, `current_stock`, `committed_stock`, `unit`, `reorder_level`, `supplier_name`
- **Committed Stock:** Reserved for job work orders

### Customers (`customers`)
- **Primary Key:** `id` (e.g., "C001", "C002")
- **Fields:** `name`, `email`, `phone`, `address`, `gst_number`, `city`, `state`, `country`, `pincode`
- **Linked To:** Client Purchase Orders, Invoices, Shipments

### Vendors (`vendors`)
- **Primary Key:** `id` (e.g., "V001", "V002")
- **Fields:** Similar to customers
- **Linked To:** Vendor Purchase Orders, Job Work Orders, Raw Material Procurement

### Client Purchase Orders (`client_purchase_orders`)
- **Primary Key:** `id` (auto-generated or manual)
- **Key Fields:** `customer_id`, `po_number`, `po_date`, `due_date`, `status`, `total_amount`, `amount_paid`, `outstanding_amount`, `payment_status`
- **Line Items:** Stored in `client_po_line_items` table (product_id, quantity, price)
- **Status Values:** Pending, In Progress, Completed, Cancelled
- **Payment Status:** Pending, Partial, Paid

### Vendor Purchase Orders (`vendor_purchase_orders`)
- **Similar Structure:** Same as client POs but for purchasing from vendors
- **Line Items:** `vendor_po_line_items` table
- **Use Cases:** Raw material procurement, sub-contracting

### Job Work Orders (`job_work_orders`)
- **Purpose:** Send materials to vendors for processing (e.g., plating, machining)
- **Types:** Steel Core Production, Custom Machining, Other Processing
- **Key Fields:** `vendor_id`, `order_date`, `due_date`, `status`, `job_type`, `raw_material_id`, `raw_material_quantity`
- **Inventory Impact:** Commits raw materials when order created, updates inventory when completed

### Drawing Operations (`drawing_operations`)
- **Purpose:** Convert raw steel into steel cores (specific diameters)
- **Key Fields:** `operation_date`, `product_id`, `steel_drawn_kg`, `cores_produced`, `operator_name`
- **Inventory Impact:**
  - Reduces `Steel` in raw_materials_inventory
  - Increases `steel_rods` column in inventory table for specified product

### Invoices (`invoices`)
- **Primary Key:** `invoice_number`
- **Linked To:** Client POs via `po_id`
- **Key Fields:** `customer_id`, `invoice_date`, `due_date`, `total_amount`, `amount_paid`, `outstanding_amount`, `payment_status`, `currency`
- **Line Items:** `invoice_line_items` table
- **Payments:** Tracked in `payment_history` table
- **Editable:** Full CRUD on invoices and individual payments

### Payment History (`payment_history`)
- **Purpose:** Track all payments received against invoices
- **Key Fields:** `invoice_number`, `po_id`, `payment_date`, `amount`, `payment_method`, `reference_number`, `notes`
- **Payment Methods:** Bank Transfer, Cash, Check, Wire Transfer, Credit Card, Other
- **Editing:** Full edit/delete capability with automatic invoice amount recalculation

### Shipments (`shipments`)
- **Purpose:** Track deliveries to customers
- **Key Fields:** `po_id`, `shipment_date`, `carrier`, `tracking_number`, `status`
- **Line Items:** `shipment_line_items` (product_id, quantity_shipped)
- **Status Values:** Pending, In Transit, Delivered, Cancelled
- **Inventory Impact:** Reduces `packed` inventory when shipment created

---

## Key Features & Workflows

### 1. Daily Production Entry
**Location:** Dashboard → Daily Production tab
**Steps:**
1. Select date
2. For each product, enter quantities for each stage
3. Enter marking type and text (if applicable)
4. Submit → Automatically updates inventory

**Validation:**
- Cannot exceed available inventory from previous stage
- Must have steel_rods to create plated
- Marking type locked to client_brand for specific customers

**Recent Production Log:**
- Shows last 20 entries (configurable)
- Click any row to EDIT or DELETE
- Editing recalculates inventory deltas
- Deleting reverses inventory changes

### 2. Inventory Management
**Location:** Dashboard → Inventory tab
**Views:**
- WIP Inventory (steel_rods → stamped)
- Copper Bonded Ground Rods (packed finished goods)
- Raw Materials Inventory

**Features:**
- Click any inventory row → See last 50 production entries that contributed to it
- Filter by product, hide zero inventory
- Export to CSV
- Real-time totals

**Inventory Tracing:**
- Click product row → Modal shows production history
- Helps trace discrepancies back to source

### 3. Drawing Operations
**Location:** Dashboard → Drawing Operations tab
**Purpose:** Record conversion of raw steel into steel cores
**Steps:**
1. Enter operation date
2. Select target product (determines core diameter)
3. Enter steel consumed (kg) and cores produced (quantity)
4. Enter operator name
**Result:** Reduces Steel raw material, increases steel_rods inventory for product

### 4. Job Work Orders
**Location:** Dashboard → Job Work tab
**Purpose:** Send materials to external vendors for processing
**Steps:**
1. Select vendor
2. Choose job type (Steel Core Production, Custom Machining, Other)
3. Select raw material and quantity
4. Set dates and add notes
5. Submit → Commits raw material stock
6. Mark as Completed → Updates inventory based on job type

### 5. Client Purchase Orders
**Location:** Dashboard → Client Purchase Orders tab
**Steps:**
1. Create PO: Select customer, enter PO details
2. Add Line Items: Select products and quantities
3. Track Status: Pending → In Progress → Completed
4. Record Payments: Via Invoice Management
5. Create Shipments: Link PO to shipment

**Linked Features:**
- Generate invoices from POs
- Record payments against invoices
- Track outstanding amounts
- View payment history

### 6. Invoice & Payment Management
**Location:** Dashboard → Invoice Management tab
**Features:**
- Create invoices from client POs or standalone
- Add multiple line items
- Record payments (multiple per invoice)
- **EDIT PAYMENTS:** Click Edit button in payment history modal
- **DELETE PAYMENTS:** Click Delete button in payment history modal
- Automatic calculation of outstanding amounts
- Payment methods: Bank Transfer, Cash, Check, Wire Transfer, Credit Card, Other

**Payment Editing:**
- Edit payment date, amount, method, reference #, notes
- Automatic invoice amount recalculation
- Updates client PO outstanding if linked
- Transaction-safe operations

### 7. Shipment Management
**Location:** Dashboard → Shipments tab
**Features:**
- Create shipments from client POs
- Select products and quantities to ship
- Enter carrier, tracking number
- Track shipment status
- Automatic inventory reduction (packed stage)

**Validation:**
- Cannot ship more than ordered
- Cannot ship without packed inventory
- Warns if partial shipment

### 8. Vendor Purchase Orders
**Location:** Dashboard → Vendor Orders tab
**Purpose:** Purchase raw materials or sub-contract work
**Steps:**
1. Select vendor
2. Enter PO details and dates
3. Add line items (materials or services)
4. Track status and payments
5. Receive materials → Update raw materials inventory

---

## User Interface Components

### EnhancedTable
- **Features:** Sorting, filtering, column customization, CSV export
- **Clickable Rows:** Entire row clickable (not just primary key)
- **Actions Column:** Edit, Delete, View buttons (context-specific)
- **Persistence:** Column preferences saved to localStorage

### EditModal
- **Reusable Modal:** Used across all edit forms
- **Standard Layout:** Title, form fields, Save/Cancel buttons
- **Validation:** Client-side validation before submission

### Navigation Tabs
- **Main Tabs:** Dashboard, Daily Production, Client POs, Invoice Management, Vendor Orders, Job Work, Shipments, Inventory, Products, Customers, Vendors, Drawing Operations
- **Active State:** Highlighted current tab
- **Badge Counts:** Some tabs show counts (e.g., pending orders)

---

## Business Rules & Validation

### Production Flow Rules
1. **Sequential Processing:** Must follow steel_rods → plated → machined → qc → stamped → packed
2. **Inventory Availability:** Cannot produce more than available inventory from previous stage
3. **Rejected Items:** Removed from inventory permanently (quality control failures)

### Marking Types
1. **Unmarked:** No branding, flexible usage, can sell to any customer
2. **Nikkon Brand:** Nikkon Ferro branding, semi-flexible (preferred for regular customers)
3. **Client Brand:** Custom client branding, LOCKED to specific customer (cannot be sold to others)

### Payment Rules
1. **Multiple Payments:** Single invoice can have multiple payment entries
2. **Partial Payments:** Allowed, status changes to "Partial"
3. **Overpayment:** System allows (advance payments, handling fees, etc.)
4. **Payment Editing:** Edits recalculate invoice outstanding automatically
5. **Payment Deletion:** Deletes recalculate invoice outstanding automatically

### Inventory Rules
1. **No Negative Inventory:** System prevents operations that would create negative inventory
2. **Stage Locking:** Cannot skip stages (e.g., can't stamp without QC)
3. **Committed Stock:** Raw materials reserved for job work orders cannot be used elsewhere

### Order Rules
1. **PO Numbering:** Can be auto-generated or manually entered
2. **Status Changes:** Manual status updates (Pending → In Progress → Completed)
3. **Cancellation:** Can cancel orders, does not reverse inventory (manual adjustment needed)

---

## Common User Tasks

### How to Record Daily Production
1. Go to Daily Production tab
2. Select today's date
3. For each product produced:
   - If starting from steel cores: Enter plated quantity
   - If continuing from previous stage: Enter quantity for that stage
   - Example: 100 rods plated yesterday → Enter 90 in "Machined" today
4. Add marking details if stamping
5. Click Submit
6. Verify in Recent Production log

### How to Check Inventory Levels
1. Go to Inventory tab
2. Toggle between WIP and Finished Goods views
3. Click "Hide Zero Inventory" to focus on active products
4. Click any product row to see production history
5. Check totals at bottom of each column

### How to Process a Customer Order
1. **Receive Order:** Create Client PO with customer details and line items
2. **Check Inventory:** Go to Inventory → Verify packed inventory available
3. **If Low Inventory:** Schedule production in Daily Production
4. **Create Invoice:** Invoice Management → Generate from PO
5. **Record Payment:** Click "Record Payment" on invoice
6. **Create Shipment:** Shipments → Create from PO, enter carrier/tracking
7. **Mark Completed:** Update PO status to Completed

### How to Procure Raw Materials
1. **Check Stock:** Inventory → Raw Materials tab
2. **Below Reorder Level?** Create Vendor PO
3. **Vendor Orders:** Create PO, add line items (material, quantity, price)
4. **Receive Materials:** Mark PO as received
5. **Update Inventory:** Manually update raw_materials_inventory (or via receiving process)

### How to Handle Job Work
1. **Create Job Work Order:** Select vendor, job type, material, quantity
2. **System Commits Stock:** Raw material marked as "committed"
3. **Send Materials:** Physical shipment to vendor
4. **Receive Back:** Mark order as Completed
5. **System Updates:** Inventory updated based on job type

### How to Edit Past Production Entries
1. Go to Daily Production tab
2. Scroll down to Recent Production log
3. Click anywhere on the row you want to edit
4. Edit Production modal opens with all fields
5. Make changes (date, quantities, marking, notes)
6. Click Save → System recalculates inventory deltas
7. Or click Delete → System reverses all inventory changes

### How to Edit Payment History
1. Go to Invoice Management tab
2. Click invoice row to view details
3. Payment History modal shows all payments
4. Click "Edit" button on any payment row
5. Edit Payment modal opens (date, amount, method, reference, notes)
6. Click Save → Invoice outstanding automatically recalculated
7. Or click "Delete" → Payment removed, invoice outstanding recalculated

### How to Trace Inventory to Production
1. Go to Inventory tab
2. Click on any product row (e.g., "12.50mm x 2500mm")
3. Production History modal opens
4. Shows current inventory levels at top
5. Shows last 50 production entries below
6. Use this to trace where inventory came from and identify discrepancies

---

## API Endpoints

### Production
- `GET /api/production?limit=20` - Get recent production entries
- `POST /api/production` - Create production entry
- `PUT /api/production/:id` - Update production entry
- `DELETE /api/production/:id` - Delete production entry
- `GET /api/inventory/:productId/production-trace?limit=50` - Get production history for product

### Inventory
- `GET /api/inventory` - Get all inventory
- `GET /api/raw-materials` - Get raw materials inventory
- `POST /api/raw-materials` - Add/update raw material

### Drawing Operations
- `GET /api/drawing-operations?limit=50` - Get recent operations
- `POST /api/drawing-operations` - Create drawing operation
- `DELETE /api/drawing-operations/:id` - Delete drawing operation

### Orders
- `GET /api/client-purchase-orders` - Get all client POs with line items
- `POST /api/client-purchase-orders` - Create client PO
- `PUT /api/client-purchase-orders/:id` - Update client PO
- `DELETE /api/client-purchase-orders/:id` - Delete client PO

### Invoices & Payments
- `GET /api/invoices` - Get all invoices
- `POST /api/invoices` - Create invoice
- `PUT /api/invoices/:id` - Update invoice
- `DELETE /api/invoices/:id` - Delete invoice
- `POST /api/payments` - Record payment
- `PUT /api/payments/:id` - Update payment (NEW)
- `DELETE /api/payments/:id` - Delete payment

### Shipments
- `GET /api/shipments` - Get all shipments
- `POST /api/shipments` - Create shipment
- `PUT /api/shipments/:id` - Update shipment
- `DELETE /api/shipments/:id` - Delete shipment

### Master Data
- `GET /api/products` - Get all products
- `GET /api/customers` - Get all customers
- `GET /api/vendors` - Get all vendors
- `POST /api/products` - Create product
- `POST /api/customers` - Create customer
- `POST /api/vendors` - Create vendor

---

## Troubleshooting Guide

### "Inventory shows zero but I produced items"
**Cause:** Production entry may have been recorded for wrong product or stage
**Solution:**
1. Go to Inventory → Click product row
2. Check production history
3. Look for entries with unusual quantities
4. Edit or delete incorrect entry

### "Cannot create shipment - insufficient inventory"
**Cause:** Not enough packed inventory
**Solution:**
1. Check Inventory → Copper Bonded Ground Rods (packed)
2. If low, go to Daily Production
3. Record packing operation (moves from stamped → packed)
4. Try shipment again

### "Payment total doesn't match invoice"
**Cause:** Payment may have been edited or deleted
**Solution:**
1. Invoice Management → Click invoice
2. Check Payment History in modal
3. Verify all payments are correct
4. Edit any incorrect payments
5. System auto-recalculates outstanding

### "Raw material shows negative stock"
**Cause:** Drawing operation or job work recorded without sufficient stock
**Solution:**
1. Check Raw Materials inventory
2. Identify which material is negative
3. Check drawing operations or job work orders
4. Either: Delete incorrect operation, OR Add stock receipt from vendor

### "Chatbot not showing"
**Cause:** Browser cache not cleared
**Solution:**
1. Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
2. Or clear browser cache
3. Button appears in bottom-right corner

---

## Recent Updates & New Features

### Latest (v15.3)
- **Editable Payment History:** Full edit/delete capability for individual payments
- Edit/Delete buttons in payment history modal
- Automatic invoice recalculation on payment changes
- Transaction-safe payment operations

### v15.2
- Enhanced table functionality with sortable columns
- Clickable entire table rows (not just primary key)
- Added search, filter, and CSV export to all tables
- Fixed drawing operations to update steel_rods inventory

### v15.0-15.1
- Terminology standardized to "Steel Rods" (not "Cores")
- Inventory trace functionality (click to see production history)
- Editable production entries (full CRUD)
- ChatWidget with Gemini AI assistant

---

## System Architecture

### Frontend
- **Framework:** React 18 (using createElement, no JSX)
- **Styling:** Tailwind CSS with custom brand colors
- **State Management:** React useState/useEffect hooks
- **Components:** Functional components with hooks

### Backend
- **Server:** Node.js + Express.js
- **Database:** SQLite3 (groundrod.db)
- **AI Integration:** Google Gemini AI (gemini-2.5-flash model)
- **Environment:** Render cloud hosting

### Deployment
- **Platform:** Render (auto-deploy from GitHub)
- **Repository:** GitHub (shivsaraogi-bot/groundrod-erp)
- **Cache Busting:** Query parameter versioning (app.restored.js?v=X.X)

---

## Tips for Success

1. **Always check inventory before promising customer delivery dates**
2. **Record production daily** - Don't let it pile up
3. **Mark client-branded products correctly** - Cannot be sold to other customers
4. **Use job work for specialized operations** - Track external processing
5. **Trace inventory discrepancies** - Use production history feature
6. **Edit production mistakes immediately** - System auto-corrects inventory
7. **Record payments promptly** - Keep outstanding amounts accurate
8. **Use payment editing feature** - Fix mistakes without deleting and re-entering
9. **Check committed stock** - Before using raw materials for other purposes
10. **Use the AI assistant** - Ask questions about data, get help with workflows

---

## Contact & Support

**Company:** Nikkon Ferro
**System Built By:** Claude AI (Anthropic)
**Primary Developer:** Shiv Saraogi
**Deployment:** render.com
