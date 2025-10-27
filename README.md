# Ground Rod ERP System

**Production ERP System for Copper Bonded Ground Rod Manufacturing**

Current Version: **37.36** | Status: **Production** | Platform: **Render.com**

---

## 🎯 Overview

Comprehensive manufacturing ERP managing inventory, production, procurement, sales orders, and analytics for ground rod manufacturing.

**Live System**: https://groundrod-erp.onrender.com

---

## ✨ Key Features

### **Inventory Management**
- Multi-stage WIP tracking: Steel Rods → Plated → Machined → Stamped → Packed
- Real-time stock levels with committed vs available tracking
- Threading variant support (Plain/Threaded/Partially Threaded)
- Base product grouping for variant consolidation

### **Production Tracking**
- Production entry with automatic BOM consumption
- Threading application at stamping stage
- Production history with audit trail
- Material consumption tracking

### **Order Management**
- **Client POs**: Sales orders with line items, invoicing, shipment tracking
- **Vendor POs**: Purchase orders for raw materials and finished products
- PDF generation and attachment storage
- Multi-currency support

### **Analytics & Reporting**
- Real-time dashboard with production metrics
- Customer analytics with revenue tracking
- Inventory analytics and forecasting
- Purchase planning and MRP

### **Master Data**
- Products with threading variants and BOM
- Customers and vendors
- Raw materials inventory
- Exchange rates and currencies

---

## 🚀 Quick Start

### **Local Development**
```bash
npm install
npm start
```
Access at: `http://localhost:3000`

### **Production Deployment**
Deployed automatically on push to GitHub main branch via Render.com

---

## 📊 System Architecture

### **Technology Stack**
- **Backend**: Node.js + Express.js
- **Database**: SQLite3 with automatic migrations
- **Frontend**: React 18 (no JSX, pure createElement)
- **Styling**: TailwindCSS (CDN)
- **Charts**: Chart.js
- **PDF**: html2pdf.js

### **Database Tables** (20+)
- products, inventory, production_history
- client_purchase_orders, client_po_line_items
- vendor_purchase_orders, vendor_po_line_items
- customers, vendors, raw_materials_inventory
- invoices, shipments, exchange_rates
- bom, inventory_allocations, audit_log

### **Key Schema Features**
- Foreign key constraints for referential integrity
- Automatic timestamp tracking
- Soft delete support (is_deleted)
- Threading support with base_product_id linking

---

## 🔧 Recent Major Features (v37.x)

### **Threading System (v37.20-37.33)**
- Products can be Plain, Threaded, or Partially Threaded
- Base products link to variants via base_product_id
- Inventory consolidated by base_product (no double-counting WIP)
- Threading applied at stamping stage in production
- Edit modals support threading fields

### **Deletion Safety (v37.24-37.36)**
- Fixed client PO deletion with shipment/invoice checks
- Product deletion validates all references
- Usage report endpoint shows blocking references
- Admin force-delete for cleanup when needed

### **Database Management (v37.28-37.31)**
- Admin endpoint to delete all client POs and invoices
- Foreign key handling for safe bulk operations
- Auto-migration system for schema evolution

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| **README.md** | This file - system overview |
| **THREADING_FEATURE_STATUS.md** | Threading implementation specs |
| **THREADING_IMPLEMENTATION_SUMMARY.md** | Threading developer guide |
| **API_TESTING_GUIDE.md** | API endpoint testing |
| **DEPLOYMENT_GUIDE.md** | Deployment instructions |
| **TESTING_GUIDE.md** | QA testing procedures |
| **QUICK_START.md** | Getting started guide |

---

## 🔌 Key API Endpoints

### **Products**
```
GET    /api/products              - List all products
POST   /api/products              - Create product
PUT    /api/products/:id          - Update product
DELETE /api/products/:id          - Delete product (with validation)
GET    /api/products/:id/usage    - Show where product is used
```

### **Inventory**
```
GET    /api/inventory             - Get consolidated inventory by base product
POST   /api/production            - Log production entry
GET    /api/production-history    - View production history
```

### **Orders**
```
GET    /api/client-purchase-orders       - List client POs
POST   /api/client-purchase-orders       - Create client PO
DELETE /api/client-purchase-orders/:id   - Delete client PO
GET    /api/vendor-purchase-orders       - List vendor POs
POST   /api/vendor-purchase-orders       - Create vendor PO
```

### **Admin Operations**
```
POST   /api/admin/delete-all-pos-invoices    - Delete all POs/invoices
POST   /api/admin/force-delete-product/:id   - Force delete product
```

---

## 🗂️ Project Structure

```
GroundRodERP/
├── server.js                    # Express backend with API endpoints
├── groundrod.db                 # SQLite database (auto-created)
├── package.json                 # Dependencies
├── public/
│   ├── index.html               # PWA shell
│   ├── app.restored.js          # React frontend (no JSX)
│   └── sw.js                    # Service worker (v37.36)
├── uploads/                     # PDF storage
│   ├── client_po/
│   └── vendor_po/
└── docs/                        # Documentation
```

---

## 🔐 Threading System Workflow

1. **Create Base Product**:
   - Set threading = "Plain"
   - Leave base_product_id empty (defaults to own ID)

2. **Create Threading Variant**:
   - Set threading = "Threaded" or "Partially Threaded"
   - Set base_product_id = ID of base product
   - System links them as variants

3. **Production Entry**:
   - Enter quantities for each stage
   - At stamping stage, select threading type
   - Inventory splits by variant at stamped/packed stages

4. **Inventory Display**:
   - WIP stages (steel_rods, plated, machined) consolidated by base
   - Finished goods (stamped, packed) split by threading variant
   - Prevents double-counting of work-in-progress

---

## 🐛 Troubleshooting

### **Product Won't Delete**
1. Check usage: `GET /api/products/:id/usage`
2. Remove blocking references (client POs, vendor POs, inventory)
3. Try delete again
4. If phantom error, use force delete (admin only)

### **Threading Not Working**
- Ensure Render deployed v37.33+ (has auto-migration)
- Check products have `threading` and `base_product_id` columns
- Hard refresh browser (Ctrl+Shift+R)

### **Database Reset**
```bash
# Delete local database
rm groundrod.db

# Restart server (recreates with latest schema)
npm start
```

---

## 📈 Version History

- **v37.36**: Fixed product DELETE endpoint - added vendor PO check *(current)*
- **v37.35**: Added product usage report endpoint
- **v37.34**: Added force delete product endpoint
- **v37.33**: Added threading to auto-migration system
- **v37.32**: Fixed Product PUT endpoint for threading fields
- **v37.31**: Fixed DELETE ALL API with foreign key handling
- **v37.28-30**: Admin endpoints for database cleanup
- **v37.25**: Added threading to edit modals
- **v37.20-23**: Implemented threading system
- **v37.18**: Removed QC stage from workflow
- **v37.15-17**: Fixed client PO deletion

**See git commit history for complete changelog**

---

## 🚀 Deployment

**Production**: https://groundrod-erp.onrender.com

**Deployment**: Automatic via GitHub → Render.com
- Push to `main` branch triggers deployment
- Build time: ~3-5 minutes
- Database persists across deploys
- Service worker caches frontend

---

## 📞 Support

For issues or questions:
1. Check documentation in `/docs` folder
2. Review git commit messages for recent changes
3. Test API endpoints using curl or Postman
4. Check browser console and server logs for errors

---

## 📄 License

ISC License - Internal company use

---

**Built for Nikkon Ferro - Ground Rod Manufacturing** | Last Updated: January 2025
