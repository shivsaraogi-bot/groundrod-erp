# Ground Rod ERP - Integrated Workflow Diagrams

## 🔄 Complete Material & Inventory Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     VENDOR PURCHASE ORDER                           │
│                                                                     │
│  Create VPO → Receive Materials → raw_materials_inventory ↑        │
│                                    (Steel: +5000kg, Copper: +500kg) │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Materials Available
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     PRODUCTION PROCESS                               │
│                                                                     │
│  Log Production (Packed: 1000 units)                                │
│         │                                                           │
│         ├──→ Check BOM (14mm rod needs: 3.5kg steel, 0.25kg copper)│
│         │                                                           │
│         ├──→ Calculate Total (1000 × 3.5kg = 3500kg steel)         │
│         │                    (1000 × 0.25kg = 250kg copper)         │
│         │                                                           │
│         ├──→ Deduct from raw_materials_inventory                   │
│         │    (Steel: 5000kg → 1500kg)                              │
│         │    (Copper: 500kg → 250kg)                               │
│         │                                                           │
│         └──→ Add to inventory.packed (+1000)                       │
│                                                                     │
│  📊 Audit Log: Material consumption recorded                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Finished Goods Available
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     CLIENT PURCHASE ORDER                           │
│                                                                     │
│  Create PO (Qty: 1000)                                              │
│         │                                                           │
│         ├──→ Check availability (Packed: 1500, Committed: 0)       │
│         │    Available: 1500 ✓                                     │
│         │                                                           │
│         ├──→ Commit inventory                                      │
│         │    (Committed: 0 → 1000)                                 │
│         │    (Available: 1500 → 500)                               │
│         │                                                           │
│         └──→ PO Status: Pending                                    │
│                                                                     │
│  📊 Audit Log: PO created, inventory committed                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Order Ready to Ship
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     SHIPMENT PROCESS                                 │
│                                                                     │
│  Create Shipment (Qty: 1000)                                        │
│         │                                                           │
│         ├──→ Update PO line item                                   │
│         │    (Delivered: 0 → 1000)                                 │
│         │                                                           │
│         ├──→ Deduct from inventory.packed                          │
│         │    (Packed: 1500 → 500)                                  │
│         │                                                           │
│         ├──→ Uncommit inventory                                    │
│         │    (Committed: 1000 → 0)                                 │
│         │    (Available: 500 → 500)                                │
│         │                                                           │
│         └──→ PO Status: Completed (if fully delivered)             │
│                                                                     │
│  📊 Audit Log: Shipment created, fulfillment complete               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Inventory State Transitions

```
┌──────────────┐
│  Raw Steel   │
│   5000 kg    │
└──────┬───────┘
       │ Receive from Vendor
       ↓
┌──────────────────────────────────────┐
│  raw_materials_inventory             │
│  Steel: 5000kg → 1500kg (-3500)     │
│  Copper: 500kg → 250kg (-250)       │
└──────┬───────────────────────────────┘
       │ Production (BOM-based deduction)
       ↓
┌──────────────────────────────────────┐
│  Inventory (Product: CBG-14-3000)    │
│                                      │
│  Cores:     100                      │
│  Plated:    200                      │
│  Machined:  150                      │
│  QC:        100                      │
│  Stamped:   50                       │
│  Packed:    1500 ──┐                 │
│  Committed: 0      │                 │
│  Available: 1500   │                 │
└────────────────────┼──────────────────┘
                     │ Client PO Created
                     ↓
┌──────────────────────────────────────┐
│  Inventory (After PO)                │
│                                      │
│  Packed:    1500 (unchanged)         │
│  Committed: 1000 (+1000) ◄───────    │
│  Available: 500  (-1000)             │
└────────────────────┼──────────────────┘
                     │ Shipment Created
                     ↓
┌──────────────────────────────────────┐
│  Inventory (After Shipment)          │
│                                      │
│  Packed:    500  (-1000)             │
│  Committed: 0    (-1000)             │
│  Available: 500  (unchanged)         │
└──────────────────────────────────────┘
```

---

## ❌➡️✅ Error Correction Flow (Soft Delete + Undo)

```
┌────────────────────────────────────────────────────────────┐
│  USER ACTION: Delete PO accidentally                       │
│                                                            │
│  DELETE /api/purchase-orders/PO-001                        │
└──────────────┬─────────────────────────────────────────────┘
               │
               ↓
┌────────────────────────────────────────────────────────────┐
│  SYSTEM RESPONSE: Soft Delete                              │
│                                                            │
│  1. Set is_deleted = 1                                     │
│  2. Uncommit inventory (Committed: 1000 → 0)               │
│  3. Update available (Available: 500 → 1500)               │
│  4. Log audit trail (Action: SOFT_DELETE)                  │
│  5. Return: { "can_undo": true }                           │
└──────────────┬─────────────────────────────────────────────┘
               │
               │ User realizes mistake within minutes
               ↓
┌────────────────────────────────────────────────────────────┐
│  USER ACTION: Undo the deletion                            │
│                                                            │
│  POST /api/undo/client_purchase_orders/PO-001              │
└──────────────┬─────────────────────────────────────────────┘
               │
               ↓
┌────────────────────────────────────────────────────────────┐
│  SYSTEM RESPONSE: Restore                                  │
│                                                            │
│  1. Verify is_deleted = 1 ✓                                │
│  2. Set is_deleted = 0                                     │
│  3. Recommit inventory (Committed: 0 → 1000)               │
│  4. Update available (Available: 1500 → 500)               │
│  5. Log audit trail (Action: RESTORE)                      │
│  6. Return: { "message": "Record restored successfully" }  │
└────────────────────────────────────────────────────────────┘
               │
               ↓
           ✅ PO FULLY RESTORED
        (All inventory states back to normal)
```

---

## 🔍 Availability Check Flow (Pre-Flight Validation)

```
┌─────────────────────────────────────────────┐
│  USER: Creating New Client PO               │
│  Wants to order 2000 units of CBG-14-3000   │
└──────────────┬──────────────────────────────┘
               │
               │ Before submitting PO
               ↓
┌─────────────────────────────────────────────────────────┐
│  FRONTEND: Call availability check                      │
│                                                         │
│  POST /api/inventory/check-availability                │
│  {                                                      │
│    "line_items": [                                      │
│      { "product_id": "CBG-14-3000", "quantity": 2000 }  │
│    ]                                                    │
│  }                                                      │
└──────────────┬──────────────────────────────────────────┘
               │
               ↓
┌─────────────────────────────────────────────────────────┐
│  BACKEND: Query inventory                               │
│                                                         │
│  Current State:                                         │
│  - Packed: 1500                                         │
│  - Committed: 500                                       │
│  - Available: 1000                                      │
│                                                         │
│  Requested: 2000                                        │
│  Available: 1000                                        │
│  Shortfall: 1000 ❌                                     │
└──────────────┬──────────────────────────────────────────┘
               │
               ↓
┌─────────────────────────────────────────────────────────┐
│  RESPONSE: Insufficient Inventory                       │
│                                                         │
│  {                                                      │
│    "available": false,                                  │
│    "details": [{                                        │
│      "product_id": "CBG-14-3000",                       │
│      "requested": 2000,                                 │
│      "available": 1000,                                 │
│      "sufficient": false,                               │
│      "shortfall": 1000                                  │
│    }],                                                  │
│    "warnings": [                                        │
│      "CBG-14-3000: Need 2000, only 1000 available       │
│       (shortfall: 1000)"                                │
│    ]                                                    │
│  }                                                      │
└──────────────┬──────────────────────────────────────────┘
               │
               ↓
┌─────────────────────────────────────────────┐
│  FRONTEND: Show warning to user             │
│                                             │
│  ⚠️ Insufficient Inventory Alert            │
│                                             │
│  Cannot fulfill this order completely:      │
│  • Requested: 2000 units                    │
│  • Available: 1000 units                    │
│  • Shortfall: 1000 units                    │
│                                             │
│  Options:                                   │
│  1. Reduce quantity to 1000                 │
│  2. Schedule production for remaining 1000  │
│  3. Cancel order                            │
└─────────────────────────────────────────────┘
```

---

## 📎 Document Attachment Flow

```
┌────────────────────────────────────────┐
│  USER: Uploads Invoice PDF to PO       │
│                                        │
│  File: invoice_2025_001.pdf (2.5 MB)   │
└──────────────┬─────────────────────────┘
               │
               ↓
┌────────────────────────────────────────────────────┐
│  BACKEND: Process upload                           │
│                                                    │
│  1. Validate: entity_type = "client_po" ✓          │
│  2. Create directory: uploads/attachments/         │
│     client_po/PO-2025-001/                         │
│  3. Generate filename: 1737897600_invoice.pdf      │
│  4. Save file to disk                              │
│  5. Insert record to document_attachments:         │
│     - entity_type: client_po                       │
│     - entity_id: PO-2025-001                       │
│     - file_name: invoice_2025_001.pdf              │
│     - file_path: uploads/attachments/...           │
│     - file_size: 2621440 (bytes)                   │
│     - mime_type: application/pdf                   │
│  6. Log audit trail                                │
└──────────────┬─────────────────────────────────────┘
               │
               ↓
┌────────────────────────────────────────┐
│  STORAGE: File persisted                │
│                                        │
│  uploads/                              │
│  └── attachments/                      │
│      └── client_po/                    │
│          └── PO-2025-001/              │
│              ├── 1737897600_invoice.pdf│
│              └── 1737898200_contract.pdf│
└────────────────────────────────────────┘
               │
               │ Later: User wants to view
               ↓
┌────────────────────────────────────────┐
│  GET /api/attachments/client_po/       │
│      PO-2025-001                       │
│                                        │
│  Response: [                           │
│    {                                   │
│      "id": 42,                         │
│      "file_name": "invoice_2025_001.pdf"│
│      "file_size": 2621440,             │
│      "uploaded_at": "2025-01-26..."    │
│    },                                  │
│    { ... }                             │
│  ]                                     │
└────────────────────────────────────────┘
               │
               │ User clicks download
               ↓
┌────────────────────────────────────────┐
│  GET /api/attachments/download/42      │
│                                        │
│  → Sends file with correct headers     │
│  → Browser downloads: invoice_2025...pdf│
└────────────────────────────────────────┘
```

---

## 🕐 Audit Trail Timeline

```
Time: 10:00 AM
┌────────────────────────────────────────┐
│  Event: Client PO Created              │
│  Action: CREATE                        │
│  Table: client_purchase_orders         │
│  Record: PO-2025-001                   │
│  User: system                          │
│  New Values: { customer_id, po_date... }│
└────────────────────────────────────────┘
               │
               ↓
Time: 10:05 AM
┌────────────────────────────────────────┐
│  Event: Production Logged              │
│  Action: CREATE                        │
│  Table: production_history             │
│  Record: 123                           │
│  User: system                          │
│  New Values: { product_id, packed... }  │
└────────────────────────────────────────┘
               │
               ↓
Time: 10:07 AM
┌────────────────────────────────────────┐
│  Event: Material Consumed              │
│  Action: CONSUMED                      │
│  Table: raw_materials_inventory        │
│  Record: Steel Rod 14mm                │
│  User: system                          │
│  New Values: { quantity: 3500 }        │
└────────────────────────────────────────┘
               │
               ↓
Time: 2:30 PM
┌────────────────────────────────────────┐
│  Event: PO Accidentally Deleted        │
│  Action: SOFT_DELETE                   │
│  Table: client_purchase_orders         │
│  Record: PO-2025-001                   │
│  User: system                          │
│  Old Values: { entire PO object }      │
└────────────────────────────────────────┘
               │
               ↓
Time: 2:32 PM
┌────────────────────────────────────────┐
│  Event: Deletion Undone                │
│  Action: RESTORE                       │
│  Table: client_purchase_orders         │
│  Record: PO-2025-001                   │
│  User: system                          │
│  New Values: { entire PO object }      │
└────────────────────────────────────────┘
               │
               ↓
Time: 3:00 PM
┌────────────────────────────────────────┐
│  Event: Shipment Created               │
│  Action: CREATE                        │
│  Table: shipments                      │
│  Record: SHIP-2025-050                 │
│  User: system                          │
│  New Values: { po_id, shipment_date... }│
└────────────────────────────────────────┘

✅ Complete Timeline Available
   GET /api/audit-log/client_purchase_orders/PO-2025-001
   → Returns all 4 events in chronological order
```

---

## 📊 Dashboard Data Dependencies

```
                      ┌─────────────────┐
                      │   DASHBOARD     │
                      └────────┬────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ↓                ↓                ↓
    ┌─────────────────┐  ┌──────────┐  ┌──────────────┐
    │  Total WIP      │  │ Finished │  │ Pending      │
    │                 │  │  Goods   │  │  Orders      │
    │  SUM(plated +   │  │          │  │              │
    │  machined +     │  │ SUM(     │  │ COUNT(*)     │
    │  qc + stamped)  │  │  packed) │  │ WHERE        │
    │                 │  │          │  │ status=      │
    │  FROM inventory │  │ FROM     │  │ 'Pending'    │
    │                 │  │ inventory│  │              │
    └─────────────────┘  └──────────┘  └──────────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                               ↓
                    ┌──────────────────────┐
                    │  Material Risk       │
                    │  Analysis            │
                    │                      │
                    │  For each pending PO:│
                    │  1. Get line items   │
                    │  2. Get BOM          │
                    │  3. Calculate need   │
                    │  4. Compare to       │
                    │     raw_materials    │
                    │  5. Show shortage    │
                    └──────────────────────┘
```

---

**Quick Reference**: All flows are automatic - no manual intervention needed!

