# API Testing Guide - Ground Rod ERP

## Quick Test Commands

### 1. Test Production with BOM Material Consumption

```bash
# Create a production entry that will consume raw materials
curl -X POST http://localhost:3000/api/production \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2025-01-15",
    "entries": [{
      "product_id": "CBG-14-3000-250",
      "plated": 0,
      "machined": 0,
      "qc": 0,
      "stamped": 0,
      "packed": 100,
      "rejected": 0,
      "notes": "Test production with BOM consumption"
    }]
  }'

# Expected Result:
# - 100 units added to inventory.packed
# - Steel and copper deducted from raw_materials_inventory based on BOM
# - Audit log entry created
```

### 2. Test Inventory Commitment on PO Creation

```bash
# First, check current inventory
curl http://localhost:3000/api/inventory

# Check availability before creating PO
curl -X POST http://localhost:3000/api/inventory/check-availability \
  -H "Content-Type: application/json" \
  -d '{
    "line_items": [
      { "product_id": "CBG-14-3000-250", "quantity": 500 }
    ]
  }'

# Create a client PO (will commit inventory)
curl -X POST http://localhost:3000/api/purchase-orders \
  -H "Content-Type: application/json" \
  -d '{
    "id": "PO-TEST-001",
    "customer_id": "CUST001",
    "po_date": "2025-01-15",
    "due_date": "2025-02-15",
    "currency": "USD",
    "priority": "Normal",
    "status": "Pending",
    "line_items": [
      {
        "product_id": "CBG-14-3000-250",
        "quantity": 500,
        "unit_price": 25.50
      }
    ]
  }'

# Check inventory again - should show committed=500, available reduced by 500
curl http://localhost:3000/api/inventory
```

### 3. Test Soft Delete and Undo

```bash
# Delete the PO (soft delete)
curl -X DELETE http://localhost:3000/api/purchase-orders/PO-TEST-001

# Verify it's marked as deleted (uncommitted inventory)
curl "http://localhost:3000/api/client-purchase-orders?include_deleted=true" | grep PO-TEST-001

# Check audit log
curl http://localhost:3000/api/audit-log/client_purchase_orders/PO-TEST-001

# Undo the deletion
curl -X POST http://localhost:3000/api/undo/client_purchase_orders/PO-TEST-001

# Verify restoration
curl http://localhost:3000/api/client-purchase-orders | grep PO-TEST-001
```

### 4. Test Document Attachments

```bash
# Upload a file to a PO
curl -X POST http://localhost:3000/api/attachments/client_po/PO-TEST-001 \
  -F "file=@./test-document.pdf"

# List attachments for the PO
curl http://localhost:3000/api/attachments/client_po/PO-TEST-001

# Download an attachment (replace {id} with actual attachment ID)
curl http://localhost:3000/api/attachments/download/{id} --output downloaded.pdf

# Delete an attachment
curl -X DELETE http://localhost:3000/api/attachments/{id}
```

### 5. Test Shipment with PO Fulfillment

```bash
# Create a shipment (will update delivered qty and deduct inventory)
curl -X POST http://localhost:3000/api/shipments \
  -H "Content-Type: application/json" \
  -d '{
    "id": "SHIP-TEST-001",
    "po_id": "PO-TEST-001",
    "shipment_date": "2025-01-20",
    "container_number": "CONT12345",
    "bl_number": "BL67890",
    "items": [
      {
        "product_id": "CBG-14-3000-250",
        "quantity": 250
      }
    ]
  }'

# Check PO line items - delivered should be updated
curl http://localhost:3000/api/client-purchase-orders/PO-TEST-001/items

# Check inventory - packed should be reduced, committed should be reduced
curl http://localhost:3000/api/inventory

# Delete shipment (will reverse everything)
curl -X DELETE http://localhost:3000/api/shipments/SHIP-TEST-001
```

### 6. Test Audit Log Retrieval

```bash
# Get recent audit entries
curl http://localhost:3000/api/audit-log?limit=50

# Get audit log for specific record
curl http://localhost:3000/api/audit-log/client_purchase_orders/PO-TEST-001

# Get audit log for production
curl http://localhost:3000/api/audit-log/production_history/1
```

---

## Integration Test Scenarios

### Scenario A: Complete Order Fulfillment Flow

```bash
# Step 1: Check raw materials
curl http://localhost:3000/api/raw-materials

# Step 2: Create vendor PO if materials low
curl -X POST http://localhost:3000/api/vendor-purchase-orders \
  -H "Content-Type: application/json" \
  -d '{
    "id": "VPO-TEST-001",
    "vendor_id": "VEND001",
    "po_date": "2025-01-10",
    "due_date": "2025-01-20",
    "currency": "INR",
    "status": "Pending",
    "line_items": [
      {
        "material_type": "Steel Rod 14mm",
        "quantity": 5000,
        "unit_price": 55,
        "unit": "kg"
      },
      {
        "material_type": "Copper Coil",
        "quantity": 500,
        "unit_price": 650,
        "unit": "kg"
      }
    ]
  }'

# Step 3: Receive materials
curl -X POST http://localhost:3000/api/vendor-purchase-orders/VPO-TEST-001/receive-items \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "material": "Steel Rod 14mm", "qty": 5000, "unit": "kg" },
      { "material": "Copper Coil", "qty": 500, "unit": "kg" }
    ]
  }'

# Step 4: Create client PO (commits inventory)
curl -X POST http://localhost:3000/api/purchase-orders \
  -H "Content-Type: application/json" \
  -d '{
    "id": "PO-2025-100",
    "customer_id": "CUST001",
    "po_date": "2025-01-15",
    "due_date": "2025-02-15",
    "currency": "USD",
    "priority": "Urgent",
    "status": "Pending",
    "line_items": [
      { "product_id": "CBG-14-3000-250", "quantity": 1000, "unit_price": 25.50 }
    ]
  }'

# Step 5: Log production (consumes materials, produces finished goods)
curl -X POST http://localhost:3000/api/production \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2025-01-18",
    "entries": [
      {
        "product_id": "CBG-14-3000-250",
        "plated": 0,
        "machined": 0,
        "qc": 0,
        "stamped": 0,
        "packed": 1000,
        "rejected": 10,
        "notes": "Production batch #42"
      }
    ]
  }'

# Step 6: Verify inventory and materials
curl http://localhost:3000/api/inventory
curl http://localhost:3000/api/raw-materials

# Step 7: Create shipment (fulfills PO, deducts inventory)
curl -X POST http://localhost:3000/api/shipments \
  -H "Content-Type: application/json" \
  -d '{
    "id": "SHIP-2025-050",
    "po_id": "PO-2025-100",
    "shipment_date": "2025-01-25",
    "container_number": "MAEU1234567",
    "bl_number": "BL2025010025",
    "items": [
      { "product_id": "CBG-14-3000-250", "quantity": 1000 }
    ]
  }'

# Step 8: Verify completion
curl http://localhost:3000/api/client-purchase-orders/PO-2025-100
curl http://localhost:3000/api/client-purchase-orders/PO-2025-100/items
curl http://localhost:3000/api/inventory

# Step 9: Review audit trail
curl http://localhost:3000/api/audit-log?limit=100
```

### Scenario B: Error Correction Workflow

```bash
# Step 1: User creates PO with wrong quantity
curl -X POST http://localhost:3000/api/purchase-orders \
  -H "Content-Type: application/json" \
  -d '{
    "id": "PO-ERROR-001",
    "customer_id": "CUST002",
    "po_date": "2025-01-15",
    "due_date": "2025-02-15",
    "line_items": [
      { "product_id": "CBG-14-3000-250", "quantity": 5000, "unit_price": 25.50 }
    ]
  }'

# Step 2: User realizes mistake and deletes
curl -X DELETE http://localhost:3000/api/purchase-orders/PO-ERROR-001

# Step 3: User realizes they need to edit, not delete
curl -X POST http://localhost:3000/api/undo/client_purchase_orders/PO-ERROR-001

# Step 4: User updates the PO correctly
curl -X PUT http://localhost:3000/api/purchase-orders/PO-ERROR-001 \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "CUST002",
    "po_date": "2025-01-15",
    "due_date": "2025-02-15",
    "currency": "USD",
    "status": "Pending",
    "notes": "Corrected quantity"
  }'

# Step 5: Update line item quantity
# (Get item ID first)
curl http://localhost:3000/api/client-purchase-orders/PO-ERROR-001/items

# Then update
curl -X PUT http://localhost:3000/api/client-purchase-orders/PO-ERROR-001/items/{itemId} \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "CBG-14-3000-250",
    "quantity": 2000,
    "unit_price": 25.50
  }'

# Step 6: Verify audit trail shows all changes
curl http://localhost:3000/api/audit-log/client_purchase_orders/PO-ERROR-001
```

### Scenario C: Inventory Availability Check

```bash
# Step 1: Check current inventory
curl http://localhost:3000/api/inventory

# Step 2: Try to create PO that exceeds available inventory
curl -X POST http://localhost:3000/api/inventory/check-availability \
  -H "Content-Type: application/json" \
  -d '{
    "line_items": [
      { "product_id": "CBG-14-3000-250", "quantity": 999999 }
    ]
  }'

# Expected response:
# {
#   "available": false,
#   "details": [...],
#   "warnings": ["CBG-14-3000-250: Need 999999, only 500 available (shortfall: 999499)"]
# }

# Step 3: Create PO with realistic quantity based on availability
curl -X POST http://localhost:3000/api/inventory/check-availability \
  -H "Content-Type: application/json" \
  -d '{
    "line_items": [
      { "product_id": "CBG-14-3000-250", "quantity": 100 }
    ]
  }'

# Expected response:
# {
#   "available": true,
#   "details": [...]
# }
```

---

## Verification Queries

### Check Database Consistency

```bash
# Verify: Available = Packed - Committed
curl http://localhost:3000/api/inventory | jq '.[] | {product_id, packed, committed, available, check: (.packed - .committed == .available)}'

# Verify: Audit log exists for all operations
curl http://localhost:3000/api/audit-log?limit=100 | jq 'length'

# Verify: Soft-deleted records excluded by default
curl http://localhost:3000/api/client-purchase-orders | jq '[.[] | select(.is_deleted == 1)] | length'

# Verify: Delivered never exceeds quantity
curl http://localhost:3000/api/client-purchase-orders | jq '.[] | .id' | while read po; do
  curl -s "http://localhost:3000/api/client-purchase-orders/$po/items" | jq '.[] | select(.delivered > .quantity)'
done
```

---

## Performance Benchmarks

```bash
# Test 1: Get all POs with filters (should be < 100ms with indexes)
time curl -s http://localhost:3000/api/client-purchase-orders > /dev/null

# Test 2: Inventory availability check (should be < 50ms)
time curl -s -X POST http://localhost:3000/api/inventory/check-availability \
  -H "Content-Type: application/json" \
  -d '{"line_items": [{"product_id": "CBG-14-3000-250", "quantity": 100}]}' > /dev/null

# Test 3: Audit log retrieval (should be < 150ms)
time curl -s http://localhost:3000/api/audit-log?limit=100 > /dev/null
```

---

## Cleanup Commands

```bash
# Hard delete test records (use with caution!)
curl -X DELETE "http://localhost:3000/api/purchase-orders/PO-TEST-001?hard=true"
curl -X DELETE "http://localhost:3000/api/shipments/SHIP-TEST-001"
curl -X DELETE "http://localhost:3000/api/vendor-purchase-orders/VPO-TEST-001"
```

---

## Expected Results Summary

| Test | Expected Outcome |
|------|------------------|
| Production with BOM | Raw materials deducted, inventory increased, audit logged |
| PO Creation | Inventory committed, available reduced, audit logged |
| PO Deletion (soft) | is_deleted=1, inventory uncommitted, can_undo=true |
| Undo Delete | is_deleted=0, inventory recommitted, audit logged |
| Shipment Creation | PO delivered qty updated, inventory deducted, uncommitted |
| Availability Check | Accurate available vs requested comparison |
| Attachment Upload | File stored permanently, linked to entity |
| Audit Log | All changes captured with timestamps |

---

## Troubleshooting

### Issue: Inventory not committing
**Check**: Look at audit log to see if CREATE action was logged
```bash
curl http://localhost:3000/api/audit-log/client_purchase_orders/{po_id}
```

### Issue: Materials not deducting on production
**Check**: Verify BOM exists for the product
```bash
curl http://localhost:3000/api/bom/{product_id}
```

### Issue: Cannot undo deletion
**Check**: Ensure record is soft-deleted (is_deleted=1)
```bash
curl "http://localhost:3000/api/client-purchase-orders?include_deleted=true" | jq '.[] | select(.id=="{po_id}")'
```

### Issue: Attachment upload fails
**Check**: Verify uploads directory exists and is writable
```bash
ls -la uploads/attachments/
```

---

**Testing Version**: 2.0.0
**Last Updated**: January 2025
