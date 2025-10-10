# Stock Adjustment UI - Remaining Code to Add

## STATUS: Backend 100% complete, Frontend functions added, UI components pending

The backend is fully functional and deployed. The frontend logic functions are added.
Now we need to add the UI components to the InventoryViewEx return statement.

## 1. Add Buttons to Controls Section

Find the `controls` variable around line 2508 and modify it to add the stock adjustment buttons.

**Find this (around line 2527):**
```javascript
React.createElement('button', { onClick: refetch, className:'px-3 py-2 bg-blue-600 text-white rounded' }, 'Apply')
```

**Change to:**
```javascript
React.createElement('button', { onClick: refetch, className:'px-3 py-2 bg-blue-600 text-white rounded' }, 'Apply'),
React.createElement('button', {
  onClick: () => setShowStockAdjustment(true),
  className:'px-4 py-2 bg-green-600 text-white rounded font-semibold'
}, '+ Stock Adjustment'),
React.createElement('button', {
  onClick: () => {
    setShowAdjustmentsHistory(!showAdjustmentsHistory);
    if (!showAdjustmentsHistory) refreshStockAdjustments();
  },
  className:'px-4 py-2 bg-gray-600 text-white rounded font-semibold'
}, showAdjustmentsHistory ? 'Hide Adjustments' : 'View Adjustments')
```

## 2. Add Stock Adjustment Modal Before the Main Return

Add this BEFORE the `return (` statement of InventoryViewEx (around line 2679):

```javascript
// Stock Adjustment Modal
const stockAdjustmentModal = showStockAdjustment && React.createElement(EditModal, {
  title: 'Create Stock Adjustment',
  isOpen: showStockAdjustment,
  onClose: () => setShowStockAdjustment(false),
  onSave: createStockAdjustment,
  children: React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
    React.createElement('div', null,
      React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Adjustment Date'),
      React.createElement('input', {
        type: 'date',
        className: 'border rounded px-3 py-2 w-full',
        value: stockAdjustmentForm.adjustment_date,
        onChange: e => setStockAdjustmentForm({ ...stockAdjustmentForm, adjustment_date: e.target.value })
      })
    ),
    React.createElement('div', null,
      React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Product *'),
      React.createElement('select', {
        className: 'border rounded px-3 py-2 w-full',
        value: stockAdjustmentForm.product_id,
        onChange: e => setStockAdjustmentForm({ ...stockAdjustmentForm, product_id: e.target.value })
      },
        React.createElement('option', { value: '' }, '-- Select Product --'),
        products.map(p => React.createElement('option', { key: p.id, value: p.id }, `${p.id} - ${p.description}`))
      )
    ),
    React.createElement('div', null,
      React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Stage *'),
      React.createElement('select', {
        className: 'border rounded px-3 py-2 w-full',
        value: stockAdjustmentForm.stage,
        onChange: e => setStockAdjustmentForm({ ...stockAdjustmentForm, stage: e.target.value })
      },
        React.createElement('option', { value: 'cores' }, 'Cores (Steel Rods from Job Work)'),
        React.createElement('option', { value: 'plated' }, 'Plated'),
        React.createElement('option', { value: 'machined' }, 'Machined'),
        React.createElement('option', { value: 'qc' }, 'QC'),
        React.createElement('option', { value: 'stamped' }, 'Stamped'),
        React.createElement('option', { value: 'packed' }, 'Packed (Finished Goods)')
      )
    ),
    React.createElement('div', null,
      React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Quantity * (can be negative)'),
      React.createElement('input', {
        type: 'number',
        className: 'border rounded px-3 py-2 w-full',
        value: stockAdjustmentForm.quantity,
        onChange: e => setStockAdjustmentForm({ ...stockAdjustmentForm, quantity: Number(e.target.value) })
      })
    ),
    React.createElement('div', null,
      React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Adjustment Type'),
      React.createElement('select', {
        className: 'border rounded px-3 py-2 w-full',
        value: stockAdjustmentForm.adjustment_type,
        onChange: e => setStockAdjustmentForm({ ...stockAdjustmentForm, adjustment_type: e.target.value })
      },
        React.createElement('option', { value: 'opening_balance' }, 'Opening Balance'),
        React.createElement('option', { value: 'physical_count' }, 'Physical Count Adjustment'),
        React.createElement('option', { value: 'damage_scrap' }, 'Damage/Scrap'),
        React.createElement('option', { value: 'other' }, 'Other')
      )
    ),
    React.createElement('div', null,
      React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Created By'),
      React.createElement('input', {
        type: 'text',
        className: 'border rounded px-3 py-2 w-full',
        value: stockAdjustmentForm.created_by,
        onChange: e => setStockAdjustmentForm({ ...stockAdjustmentForm, created_by: e.target.value })
      })
    ),
    React.createElement('div', { className: 'md:col-span-2' },
      React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Reason * (Why is this adjustment needed?)'),
      React.createElement('input', {
        type: 'text',
        className: 'border rounded px-3 py-2 w-full',
        placeholder: 'e.g., Opening stock as of system go-live',
        value: stockAdjustmentForm.reason,
        onChange: e => setStockAdjustmentForm({ ...stockAdjustmentForm, reason: e.target.value })
      })
    ),
    React.createElement('div', { className: 'md:col-span-2' },
      React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Notes (Optional)'),
      React.createElement('textarea', {
        className: 'border rounded px-3 py-2 w-full',
        rows: 3,
        placeholder: 'Additional notes...',
        value: stockAdjustmentForm.notes,
        onChange: e => setStockAdjustmentForm({ ...stockAdjustmentForm, notes: e.target.value })
      })
    )
  )
});

// Stock Adjustments History Table
const adjustmentsHistoryTable = showAdjustmentsHistory && React.createElement(Section, { title: 'Stock Adjustments History' },
  React.createElement(EnhancedTable, {
    title: 'Stock Adjustments',
    data: stockAdjustments,
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'adjustment_date', label: 'Date' },
      { key: 'product_id', label: 'Product ID' },
      { key: 'product_description', label: 'Product' },
      { key: 'stage', label: 'Stage', render: (val) => val ? val.charAt(0).toUpperCase() + val.slice(1) : '-' },
      { key: 'quantity', label: 'Quantity', render: (val) => val >= 0 ? `+${val}` : val },
      { key: 'adjustment_type', label: 'Type', render: (val) => {
        const types = {
          'opening_balance': 'Opening Balance',
          'physical_count': 'Physical Count',
          'damage_scrap': 'Damage/Scrap',
          'other': 'Other'
        };
        return types[val] || val;
      }},
      { key: 'reason', label: 'Reason' },
      { key: 'created_by', label: 'Created By' },
      { key: 'created_at', label: 'Created At', render: (val) => val ? new Date(val).toLocaleString() : '-' }
    ],
    primaryKey: 'id',
    onDelete: deleteStockAdjustment,
    onExport: (data, cols) => downloadCSV('stock-adjustments.csv', cols.map(c=>({key:c.key,label:c.label})), data),
    defaultVisibleColumns: { id: true, adjustment_date: true, product_id: true, product_description: true, stage: true, quantity: true, adjustment_type: true, reason: true, created_by: true, created_at: false }
  })
);
```

## 3. Add Components to Return Statement

Find the return statement (around line 2680) and add the modal and table.

**Find:**
```javascript
return (
  React.createElement('div', { className:'space-y-6' },
    React.createElement(Section, { title:'Raw Materials' },
```

**Change to:**
```javascript
return (
  React.createElement('div', { className:'space-y-6' },
    stockAdjustmentModal,
    adjustmentsHistoryTable,
    React.createElement(Section, { title:'Raw Materials' },
```

---

## Quick Test After Adding

1. Go to Inventory tab
2. You should see two new buttons: "+ Stock Adjustment" and "View Adjustments"
3. Click "+ Stock Adjustment" to open the modal
4. Fill in the form and click "Save"
5. Click "View Adjustments" to see the history table

## What This Enables

**Opening Balance Workflow:**
1. Click "+ Stock Adjustment"
2. Select Product
3. Select Stage (e.g., "Packed (Finished Goods)")
4. Enter Quantity (e.g., 500)
5. Select "Opening Balance" as type
6. Enter reason: "Opening stock as of system go-live"
7. Click Save

**View/Delete Adjustments:**
1. Click "View Adjustments"
2. See full history with all details
3. Delete button on each row to reverse if needed
