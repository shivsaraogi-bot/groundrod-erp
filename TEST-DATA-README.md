# Test Database - Comprehensive Dummy Data

## 📊 What's Been Created

Your Ground Rod ERP system is now running with **comprehensive test data** across all modules. The test database is currently active as `groundrod.db`.

---

## 📦 Test Data Summary

### 🏭 **5 Vendors**
- **V001** - ABC Steel Industries (Ahmedabad) - Steel supplier
- **V002** - Copper Anode Suppliers Ltd (Delhi) - Copper supplier
- **V003** - Mumbai Metal Works (Mumbai) - Steel supplier
- **V004** - Bengal Coating Services (Kolkata) - Job work/Electroplating
- **V005** - Chennai Copper Traders (Chennai) - Copper supplier

### 👥 **5 Customers**
- **C001** - Global Infrastructure Ltd (Bangalore)
- **C002** - National Power Grid Corp (New Delhi)
- **C003** - Mumbai Metro Construction (Mumbai)
- **C004** - Eastern Railway Projects (Kolkata)
- **C005** - Southern Power Utilities (Chennai)

### ⚙️ **6 Products** (with Auto-Generated BOMs)
- **CE1034** - 14.2mm x 3000mm Ground Rod
- **CE1535** - 17.2mm x 3000mm Ground Rod
- **CE2036** - 20.0mm x 3000mm Ground Rod
- **CE1424** - 14.2mm x 2400mm Ground Rod
- **CE1718** - 17.2mm x 1800mm Ground Rod
- **CE2030** - 20.0mm x 3000mm Heavy Duty Ground Rod

**All products have auto-calculated BOMs** based on:
- Steel weight (7.85 g/cm³)
- Copper Anode weight (8.96 g/cm³)

### 📊 **Raw Materials Inventory**
- **Steel**: 15,000 kg (2,500 kg committed)
- **Copper Anode**: 5,000 kg (800 kg committed)
- **Flux**: 500 kg (50 kg committed)
- **Packaging Material**: 2,000 units (200 committed)

### 📦 **Product Inventory** (by production stage)
Each of the 6 products has inventory across all stages:
- Steel Rods
- Plated
- Quality Checked
- Stamped
- Packaged

### 📝 **3 Vendor Purchase Orders**
- **VPO-2025-001**: Completed order from ABC Steel Industries
- **VPO-2025-002**: Pending order from Copper Anode Suppliers
- **VPO-2025-003**: In Transit order from Mumbai Metal Works

With **4 line items** across these orders.

### 📋 **5 Client Purchase Orders**
- **CPO-2025-001**: In Production for Global Infrastructure Ltd
- **CPO-2025-002**: Confirmed for National Power Grid Corp
- **CPO-2025-003**: Pending for Mumbai Metro Construction
- **CPO-2025-004**: In Production for Eastern Railway Projects
- **CPO-2025-005**: Confirmed for Southern Power Utilities

With **10 line items** totaling thousands of units across multiple products.

### 🚚 **2 Shipments**
- **SHIP-2025-001**: In Transit to Global Infrastructure (60% of order)
- **SHIP-2025-002**: Preparing for Eastern Railway Projects (full order)

---

## 🎯 What You Can Test

### ✅ Dashboard
- View summary statistics
- See pending orders, in-production items
- Check inventory levels
- Review risk analysis

### ✅ Products Tab
- View all 6 products with dimensions
- See auto-calculated weights and BOMs
- Edit products with unit conversions (mm/inches, m/ft, kg/lbs)
- Export product data to CSV

### ✅ Customers Tab
- Browse 5 customers with full contact details
- Edit customer information
- View office and warehouse addresses

### ✅ Vendors Tab
- See 5 vendors categorized by type (Steel, Copper, Job Work)
- View vendor contact details and locations
- Track vendor types and materials supplied

### ✅ Client Orders Tab
- View 5 active client purchase orders
- See order status (Pending, Confirmed, In Production)
- Check line items for each order
- View total order values

### ✅ Vendor Orders Tab
- Track 3 vendor purchase orders
- See material orders (Steel, Copper Anode)
- Check order status (Completed, Pending, In Transit)
- View line items and pricing

### ✅ Inventory Tab
- Check product inventory across all production stages
- See raw materials stock levels
- View committed vs available stock
- Monitor inventory by production stage (steel_rods → packaged)

### ✅ Shipments Tab
- Track 2 active shipments
- See shipment status and tracking numbers
- View expected vs actual arrival dates
- Link shipments to client purchase orders

---

## 🔄 Database Management

### Current Setup
- **Active Database**: `groundrod.db` (now contains test data)
- **Backup**: `groundrod-backup.db` (your original data - if any)
- **Test Source**: `groundrod-test.db` (template with all test data)

### To Restore Your Original Database
```powershell
# Windows
Stop-Process -Name node -Force
Copy-Item groundrod-backup.db groundrod.db -Force
npm start
```

### To Recreate Test Data
```bash
node setup-test-data.js
```

This creates a fresh `groundrod-test.db` with all dummy data.

### To Switch Between Databases
The server will automatically use `groundrod.db` in your project directory.
- Want test data? Copy `groundrod-test.db` to `groundrod.db`
- Want clean data? Delete `groundrod.db` (server will create fresh one)
- Want your data back? Copy `groundrod-backup.db` to `groundrod.db`

---

## 🧪 Testing Workflows

### Test Full Production Flow
1. Check raw materials inventory (Steel, Copper Anode)
2. Create vendor PO to order more materials
3. Mark vendor PO as "Completed" → see raw materials increase
4. View client orders waiting for production
5. Check product inventory by stage
6. Create shipment for completed orders

### Test Product Creation with BOMs
1. Go to Products tab
2. Add new product with dimensions in different units (try inches, feet)
3. Check BOM tab to see auto-calculated steel/copper requirements
4. View weight in both kg and lbs

### Test CSV Import
1. Download sample CSV templates from each tab
2. Modify the CSV data
3. Upload via bulk import buttons
4. Verify data appears correctly with auto-generated BOMs

---

## 📍 Access Your System

**Local Server**: http://localhost:3000

The server is currently running with the test database loaded.

---

##  💡 Notes

- All financial values are in INR
- Dates are realistic (Jan-Mar 2025)
- BOMs are calculated using actual physics formulas
- Inventory levels are realistic for a mid-sized operation
- Order quantities reflect real-world projects

---

**Enjoy testing your system! All features are now populated with realistic data.**
