# Threading Feature Implementation Status (v37.20)

## Overview
Implements support for product variants based on threading type (Plain, Threaded, Partially Threaded) while consolidating early-stage inventory to avoid double-counting.

## Business Requirement
Threading is applied LATE in the manufacturing process (after machining, before stamping). However, customers specify threading requirements at PO creation time. The system needs to:
- Track inventory by BASE product for early stages (steel rods → plated → machined)
- Split inventory by THREADING VARIANT at later stages (stamped → packed)
- Avoid double-counting WIP inventory for threading variants

## Implementation Status

### ✅ COMPLETED (v37.20)

#### 1. Database Schema Updates
**Files Modified**: `server.js`

**Products Table**:
- Added `base_product_id TEXT` - Links threading variants to base product
- Added `threading TEXT DEFAULT 'Plain'` - Threading type for this product variant

**Client PO Line Items**:
- Added `threading TEXT DEFAULT 'Plain'` - Threading requirement specified by customer

**Inventory Allocations**:
- Added `threading TEXT DEFAULT 'Plain'` - Tracks threading for allocated inventory

**Production History**:
- Added `threading TEXT DEFAULT 'Plain'` - Records threading applied during production

#### 2. Inventory API Logic
**Endpoint**: `GET /api/inventory`
**File**: `server.js` lines ~3309-3333

**Key Changes**:
- Consolidates `steel_rods`, `plated`, `machined` by `base_product_id`
- Keeps `stamped`, `packed` separate by actual `product_id` (threading variant)
- Returns structured response with `variants` array

**Response Structure**:
```json
{
  "product_id": "NFPL19X3",
  "base_product_id": "NFPL19X3",
  "description": "19mm x 3m Rod",
  "steel_rods": 0,
  "plated": 200,
  "machined": 150,
  "total_wip": 350,
  "variants": [
    {
      "product_id": "NFPL19X3",
      "threading": "Plain",
      "stamped": 60,
      "packed": 50,
      "committed": 10,
      "available": 50
    },
    {
      "product_id": "NFPL19X3T",
      "threading": "Threaded",
      "stamped": 40,
      "packed": 35,
      "committed": 5,
      "available": 35
    }
  ]
}
```

**Benefits**:
- ✅ No double-counting of WIP inventory
- ✅ Clear separation of threading-specific inventory
- ✅ Accurate material requirements calculation

### 🔄 PENDING (Future Implementation)

#### 3. Products Master Data UI
**Status**: Schema ready, UI not yet updated
**Needed Changes**:
- Add `base_product_id` field to product add/edit forms
- Add `threading` dropdown (Plain, Threaded, Partially Threaded)
- Display threading and base_product_id columns in products table
- Helper UI to link variants (e.g., "Link to base product")

#### 4. Production Entry UI
**Status**: Schema ready, UI not yet updated
**Needed Changes**:
- Add threading selector when entering "stamped" production quantity
- When threading selected: create inventory for specific variant product_id
- Production log should record threading type
- Threading dropdown options: Plain, Threaded, Partially Threaded

#### 5. Client PO Management UI
**Status**: Schema ready, UI not yet updated
**Needed Changes**:
- Add threading column to client PO line items table
- Add threading dropdown when adding/editing line items
- Display threading requirement in PO details
- Allocation logic should use base_product_id for machined inventory

#### 6. Dashboard Analytics
**Status**: Needs update to handle new inventory structure
**Needed Changes**:
- WIP chart: Combine variants (show base product quantities)
- Material Requirements: Use base_product_id for calculations
- Purchase Planning (MRP): Account for threading when allocating machined inventory

#### 7. Data Migration
**Status**: Not yet created
**Needed**: Script to set `base_product_id` for existing products
```javascript
// For plain products: base_product_id = id
// For threaded products: extract base from ID pattern (e.g., NFPL19X3T → NFPL19X3)
```

## Usage Guide (Once UI is Complete)

### Creating Product Variants
1. Create base product: `NFPL19X3` (19mm x 3m Plain Rod)
   - `base_product_id`: NFPL19X3
   - `threading`: Plain

2. Create threaded variant: `NFPL19X3T` (19mm x 3m Threaded Rod)
   - `base_product_id`: NFPL19X3 (← links to base)
   - `threading`: Threaded

### Client Order Flow
1. Customer orders 100 pcs of `NFPL19X3T` (threaded)
2. System reserves 100 pcs from `NFPL19X3` machined inventory
3. During production, enter stamped quantity and select "Threaded"
4. Inventory created for `NFPL19X3T` stamped stage

### Production Workflow
```
Steel Rods → Plated → Machined (Track by NFPL19X3 base)
              ↓
         Apply Threading
              ↓
Stamped → Packed (Track by NFPL19X3 or NFPL19X3T variant)
```

## Testing Checklist (When UI Complete)
- [ ] Create base product + threaded variant
- [ ] Verify BOM calculation shared across variants
- [ ] Create client PO with threading requirement
- [ ] Enter production with threading selection
- [ ] Verify inventory split correctly at stamped stage
- [ ] Check dashboard WIP doesn't double-count
- [ ] Verify material requirements use base product
- [ ] Test allocation reserves correct base product inventory

## Files Modified
- `server.js` - Database schema + inventory API logic
- `add_threading_support.js` - Schema migration script
- `implement_threading_logic.js` - Inventory API update script

## Next Steps
1. Update Products Master Data UI with threading fields
2. Add threading selector to production entry forms
3. Update client PO UI with threading column
4. Modify dashboard analytics to handle variants
5. Create data migration script for existing products
6. End-to-end testing of complete workflow

## Notes
- Threading types: "Plain", "Threaded", "Partially Threaded"
- Base product ID convention: Use shortest ID (e.g., NFPL19X3 not NFPL19X3T)
- Catalog structure preserved: Separate SKUs maintained for pricing/quoting
- Late differentiation: Threading applied when actually performed in factory
