# Ground Rod ERP - Enhancement Specifications

## Overview
This document outlines all requested enhancements to be implemented.

---

## ✅ COMPLETED: Remove Tabs

### 1. Remove Assistant Tab
- **Status**: ✅ DONE
- **Changes**: Removed from navigation and rendering

### 2. Remove Imports Tab
- **Status**: ✅ DONE
- **Changes**: Removed from navigation
- **Next**: Move PDF import functionality to Client PO and Vendor PO pages

---

## 🔄 IN PROGRESS: Major Enhancements

### 3. Multi-Currency Support

**Requirement**: Add currency selection (INR, USD, EUR, AED) to all price/rate fields

**Locations to Update**:
- ✅ Client PO: unit_price per line item
- ✅ Vendor PO: unit_price per line item
- ⏸️ Products: Add base_currency field
- ⏸️ Customers: Add preferred_currency field
- ⏸️ Invoices/Shipments: currency field

**Database Changes Needed**:
```sql
-- Add currency to line items
ALTER TABLE client_po_line_items ADD COLUMN currency TEXT DEFAULT 'INR';
ALTER TABLE vendor_po_line_items ADD COLUMN currency TEXT DEFAULT 'INR';

-- Add to products
ALTER TABLE products ADD COLUMN base_currency TEXT DEFAULT 'INR';

-- Add to customers
ALTER TABLE customers ADD COLUMN preferred_currency TEXT DEFAULT 'INR';
```

**UI Changes**:
- Add currency dropdown next to every price input
- Store currency with each line item
- Display currency in lists/tables
- Support currency conversion rates (future)

**Priority**: HIGH - Revenue tracking depends on this

---

### 4. Move Import Functionality to PO Pages

**Client PO Page - Add PDF Import Section**:
```
┌─────────────────────────────────────┐
│ Add Client PO (Manual Entry)        │
├─────────────────────────────────────┤
│ [Existing form]                      │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Import Client PO from PDF            │
├─────────────────────────────────────┤
│ [Upload PDF] [Preview] [Confirm]     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Client Purchase Orders (List)        │
├─────────────────────────────────────┤
│ [Table of all POs]                   │
└─────────────────────────────────────┘
```

**Vendor PO Page - Same Structure**:
- Manual entry form
- PDF import section
- List of all vendor POs

**Status**: ⏸️ Pending

---

### 5. Enhanced Product Creation in Client PO

**Current**: Select existing product from dropdown

**New Requirement**:
- ✅ Dropdown to select existing product
- ✅ OR create new product inline with full specifications:
  - Product ID
  - Description
  - **Steel Diameter** (mm)
  - **Copper Coating** (µm)
  - **Length** (mm or ft with unit selector)
  - **Quantity**
  - **Unit Price** with currency selector
  - Auto-calculate:
    - CBG Rod Diameter
    - Total Weight
    - Steel Weight
    - Copper Weight
  - Auto-create BOM entry

**UI Design**:
```
Line Items:
┌─────────────────────────────────────────────────────────┐
│ Product: [Dropdown: Select Existing ▼] OR [+ New Product]│
└─────────────────────────────────────────────────────────┘

If "+ New Product" clicked:
┌─────────────────────────────────────────────────────────┐
│ New Product Details                                      │
├─────────────────────────────────────────────────────────┤
│ Product ID:     [________]                               │
│ Description:    [____________________________]           │
│ Steel Dia (mm): [____] Copper (µm): [____]              │
│ Length:         [____] Unit: [mm ▼]                     │
│ Quantity:       [____]                                   │
│ Unit Price:     [____] Currency: [INR ▼]                │
│                                                          │
│ Auto-Calculated:                                         │
│ • CBG Rod Dia:    XX.XX mm                              │
│ • Steel Weight:   XX.XX kg/unit                         │
│ • Copper Weight:  XX.XX kg/unit                         │
│ • Total Weight:   XX.XX kg/unit                         │
│                                                          │
│ [Cancel] [Add Product to PO]                            │
└─────────────────────────────────────────────────────────┘
```

**Calculations** (from existing calculateWeights function):
```javascript
// Steel weight (kg)
steelWeight = (π * (steelDia/2000)² * length * 7850) / 1000

// Copper weight (kg)
copperWeight = (π * (steelDia/1000) * (copperCoating/1000000) * length * 8960) / 1000

// Total weight
totalWeight = steelWeight + copperWeight

// CBG rod diameter
cbgDia = steelDia + (2 * copperCoating / 1000)
```

**Auto-create BOM**:
```sql
INSERT INTO bom (product_id, material, qty_per_unit)
VALUES
  (new_product_id, 'Steel', steel_weight_per_unit),
  (new_product_id, 'Copper Anode', copper_weight_per_unit);
```

**Status**: ⏸️ High Priority

---

### 6. Vendor PO Page Enhancements

**Current Status**: Basic CRUD exists

**Requirements**:
- ✅ Auto-refresh list after create/edit/delete (like Client PO)
- ✅ Same UI consistency as Client PO page
- ✅ Show list of all past vendor POs
- ✅ Edit functionality
- ✅ Delete functionality
- ✅ PDF import section
- ✅ Receipt/fulfillment tracking per line item
- ✅ Auto-update raw materials on receipt

**Partial Fulfillment for Vendor PO**:
```
Line Items Table:
┌──────────────────────────────────────────────────────────┐
│ Material | Ordered | Received | Remaining | Unit Price │
├──────────────────────────────────────────────────────────┤
│ Steel    | 5000 kg | 3000 kg  | 2000 kg   | ₹50/kg     │
│          | [Edit]                                        │
└──────────────────────────────────────────────────────────┘
```

**Status**: ⏸️ Medium Priority

---

### 7. Job Work Page (NEW)

**Requirement**: Dedicated page for job work orders (plating, machining, etc.)

**Structure**:
```
┌─────────────────────────────────────────────────────┐
│ Add Job Work Order                                   │
├─────────────────────────────────────────────────────┤
│ Order ID:        [________]                          │
│ Vendor:          [Select Vendor ▼]                   │
│ Job Type:        [Plating ▼]                        │
│ Product:         [Select Product ▼]                  │
│ Quantity (pcs):  [________]                          │
│ Rate per piece:  [____] Currency: [INR ▼]           │
│ Expected Date:   [____/__/____]                      │
│ Notes:           [____________________________]      │
│                  [Add Job Work Order]                │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Job Work Orders List                                 │
├─────────────────────────────────────────────────────┤
│ Order ID | Vendor | Type | Product | Qty | Status   │
│ ─────────────────────────────────────────────────── │
│ JW-001   | ABC    | Plate| R-100  | 1000| Pending  │
│          [Edit] [Delete] [Mark Complete]             │
└─────────────────────────────────────────────────────┘
```

**Database Schema**:
```sql
CREATE TABLE job_work_orders (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  job_type TEXT NOT NULL, -- 'Plating', 'Machining', 'QC', etc.
  product_id TEXT,
  quantity INTEGER NOT NULL,
  rate_per_unit REAL NOT NULL,
  currency TEXT DEFAULT 'INR',
  expected_date DATE,
  actual_date DATE,
  status TEXT DEFAULT 'Pending', -- Pending, In Progress, Completed
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

**API Endpoints Needed**:
```
GET    /api/job-work-orders
POST   /api/job-work-orders
PUT    /api/job-work-orders/:id
DELETE /api/job-work-orders/:id
```

**Status**: ⏸️ Medium Priority

---

### 8. Raw Materials Starting Inventory UI

**Current**: API endpoint exists (`PUT /api/raw-materials/:material`)

**Requirement**: User-friendly UI to set starting inventory

**UI Design - Add to Inventory Page**:
```
┌─────────────────────────────────────────────────────┐
│ Set Starting Inventory                               │
├─────────────────────────────────────────────────────┤
│ Material: Steel                                      │
│ Current Stock (kg): [2500    ] [Update]             │
│ Reorder Level (kg): [500     ]                      │
│                                                      │
│ Material: Copper Anode                               │
│ Current Stock (kg): [450     ] [Update]             │
│ Reorder Level (kg): [100     ]                      │
│                                                      │
│ Note: This is for setting your initial inventory     │
│ when first deploying the system. Future updates      │
│ will be automatic via vendor PO receipts.            │
└─────────────────────────────────────────────────────┘
```

**Status**: ⏸️ Low Priority (API already works, just needs UI)

---

## Implementation Priority

### Phase 1: Critical (This Week)
1. ✅ Remove Assistant/Imports tabs
2. ⏸️ Multi-currency support on Client PO
3. ⏸️ Enhanced product creation in Client PO
4. ⏸️ Move PDF import to Client PO page

### Phase 2: High Priority (Next Week)
5. ⏸️ Vendor PO page enhancements (auto-refresh, consistency)
6. ⏸️ Multi-currency on Vendor PO
7. ⏸️ Move PDF import to Vendor PO page

### Phase 3: Medium Priority
8. ⏸️ Job Work page creation
9. ⏸️ Vendor PO partial fulfillment tracking
10. ⏸️ Raw materials starting inventory UI

---

## Technical Notes

### Weight Calculation Formula
Already exists in codebase (`calculateWeights` function):

```javascript
function calculateWeights(diameter, length, coating) {
  const d = Number(diameter) || 0;
  const l = Number(length) || 0;
  const c = Number(coating) || 0;

  // Steel weight (kg)
  const steelWeight = (Math.PI * Math.pow(d / 2000, 2) * l * 7850) / 1000;

  // Copper weight (kg)
  const copperWeight = (Math.PI * (d / 1000) * (c / 1000000) * l * 8960) / 1000;

  // Total weight
  const totalWeight = steelWeight + copperWeight;

  // CBG rod diameter (mm)
  const cbgDia = d + (2 * c / 1000);

  return {
    steelWeight: steelWeight.toFixed(2),
    copperWeight: copperWeight.toFixed(2),
    totalWeight: totalWeight.toFixed(2),
    cbgDiameter: cbgDia.toFixed(2)
  };
}
```

### Currency Support
Create helper function:
```javascript
const CURRENCIES = ['INR', 'USD', 'EUR', 'AED'];

const CURRENCY_SYMBOLS = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  AED: 'AED'
};

function formatCurrency(amount, currency = 'INR') {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `${symbol}${Number(amount).toLocaleString()}`;
}
```

### BOM Auto-Creation
When new product is created via Client PO:
```javascript
async function createProductWithBOM(productData, weights) {
  // 1. Create product
  const product = await createProduct(productData);

  // 2. Create BOM entries
  await createBOMEntry(product.id, 'Steel', weights.steelWeight);
  await createBOMEntry(product.id, 'Copper Anode', weights.copperWeight);

  return product;
}
```

---

## Testing Checklist

### Multi-Currency
- [ ] Create Client PO with USD pricing
- [ ] Create Vendor PO with INR pricing
- [ ] Verify currency displays correctly in lists
- [ ] Export PO as PDF - verify currency shows

### Product Creation in PO
- [ ] Create new product from Client PO form
- [ ] Verify auto-calculations are correct
- [ ] Verify BOM is created automatically
- [ ] Verify product appears in Products list
- [ ] Use newly created product in another PO

### Vendor PO
- [ ] Create vendor PO
- [ ] Verify it appears in list
- [ ] Edit vendor PO
- [ ] Delete vendor PO
- [ ] Import vendor PO from PDF

### Job Work
- [ ] Create job work order
- [ ] Edit job work order
- [ ] Mark as complete
- [ ] Delete job work order

---

## Files to Modify

1. **public/app.restored.js** - Frontend components
   - Remove Assistant/Imports tabs ✅
   - Add currency dropdowns
   - Add inline product creation
   - Enhance Vendor PO page
   - Create Job Work page

2. **server.js** - Backend API
   - Add currency columns to tables
   - Add job_work_orders table
   - Add job work CRUD endpoints
   - Update BOM auto-creation logic

3. **Database migrations** - Schema updates
   - Add currency fields
   - Create job_work_orders table

---

## Estimated Timeline

- **Phase 1**: 2-3 days
- **Phase 2**: 2-3 days
- **Phase 3**: 1-2 days

**Total**: ~1 week for full implementation

---

## Questions/Decisions Needed

1. **Currency Conversion**: Do you want automatic currency conversion rates, or just display/store different currencies?

2. **Job Work Types**: What are the standard job work types?
   - Plating
   - Machining
   - QC/Testing
   - Stamping
   - Other?

3. **BOM Auto-Creation**: Should this be automatic or give user a choice to review before creating?

4. **Units**: For length, support both mm and ft?
   - 1 ft = 304.8 mm
   - Auto-convert based on selection?

---

This specification will guide the implementation of all requested enhancements.
