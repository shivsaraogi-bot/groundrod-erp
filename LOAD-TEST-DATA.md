# Load Test Data on Render

## ✅ Quick Instructions

Your Render deployment will redeploy automatically in 2-3 minutes. Once it's done, follow these simple steps to populate comprehensive test data:

### Step 1: Wait for Render Deployment
Wait for Render to finish deploying (check your Render dashboard - deployment usually takes 2-3 minutes)

### Step 2: Load Test Data

**Option A: Using Browser Console**
1. Open your Render URL in browser
2. Press F12 to open Developer Tools
3. Go to Console tab
4. Paste this command:

```javascript
fetch(window.location.origin + '/api/setup-test-data', { method: 'POST' })
  .then(r => r.json())
  .then(data => console.log('✅ Test data loaded!', data))
```

5. Press Enter
6. Wait 5-10 seconds
7. Refresh the page - you'll see all the test data!

**Option B: Using curl (if you have it)**
```bash
curl -X POST https://your-render-url.onrender.com/api/setup-test-data
```

**Option C: Using Postman/Insomnia**
- Method: POST
- URL: `https://your-render-url.onrender.com/api/setup-test-data`
- No body needed
- Send request

---

## 📦 What Gets Loaded

Once you run the setup endpoint, your system will be populated with:

### **5 Vendors**
- ABC Steel Industries (Ahmedabad)
- Copper Anode Suppliers Ltd (Delhi)
- Mumbai Metal Works (Mumbai)
- Bengal Coating Services (Kolkata)
- Chennai Copper Traders (Chennai)

### **5 Customers**
- Global Infrastructure Ltd (Bangalore)
- National Power Grid Corp (Delhi)
- Mumbai Metro Construction (Mumbai)
- Eastern Railway Projects (Kolkata)
- Southern Power Utilities (Chennai)

### **6 Products** with Auto-Calculated BOMs
- CE1034 - 14.2mm x 3000mm Ground Rod
- CE1535 - 17.2mm x 3000mm Ground Rod
- CE2036 - 20.0mm x 3000mm Ground Rod
- CE1424 - 14.2mm x 2400mm Ground Rod
- CE1718 - 17.2mm x 1800mm Ground Rod
- CE2030 - 20.0mm x 3000mm Heavy Duty Ground Rod

### **Raw Materials Inventory**
- Steel: 15,000 kg (2,500 committed)
- Copper Anode: 5,000 kg (800 committed)
- Flux: 500 kg (50 committed)
- Packaging Material: 2,000 units (200 committed)

### **Product Inventory**
All 6 products have inventory across all 5 production stages:
- Steel Rods
- Plated
- Quality Checked
- Stamped
- Packaged

### **3 Vendor Purchase Orders**
- VPO-2025-001: Completed order for steel
- VPO-2025-002: Pending order for copper anode
- VPO-2025-003: In Transit order for steel

### **5 Client Purchase Orders**
- CPO-2025-001: In Production for Global Infrastructure
- CPO-2025-002: Confirmed for National Power Grid
- CPO-2025-003: Pending for Mumbai Metro
- CPO-2025-004: In Production for Eastern Railway
- CPO-2025-005: Confirmed for Southern Power

### **2 Active Shipments**
- SHIP-2025-001: In Transit (60% of order)
- SHIP-2025-002: Preparing for dispatch

---

## 🎯 What to Test

After loading test data, you can explore:

1. **Dashboard** - See populated stats, charts, pending orders
2. **Products** - View 6 products with BOMs, test unit conversions
3. **Customers & Vendors** - Browse realistic company data
4. **Client Orders** - 5 orders with different statuses and line items
5. **Vendor Orders** - 3 orders showing material procurement
6. **Inventory** - Check product inventory across production stages
7. **Raw Materials** - View current and committed stock levels
8. **Shipments** - Track active deliveries

---

## 🔄 Reset/Reload Test Data

You can call the setup endpoint multiple times - it uses `INSERT OR REPLACE` so it will update existing records without duplicates.

To completely reset and reload:
1. Run the setup endpoint again
2. Refresh your browser

---

## ⚠️ Important Notes

- This endpoint uses `INSERT OR REPLACE` - safe to run multiple times
- All BOMs are auto-calculated using physics formulas
- Data is realistic for a mid-sized manufacturing operation
- Dates are set to Jan-Mar 2025
- Currency is INR (Indian Rupees)

---

**Enjoy testing your fully populated ERP system!** 🎉
