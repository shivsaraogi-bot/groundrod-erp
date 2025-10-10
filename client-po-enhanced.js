// Enhanced Client PO Component with Multi-Currency, Line Items, and Product Creation
// This will replace the existing ClientPurchaseOrders component

function ClientPurchaseOrdersEnhanced({ purchaseOrders, products, customers, onRefresh }) {
  const [openDetails, setOpenDetails] = useState({});
  const [lineItems, setLineItems] = useState({});
  const [fulfilEdit, setFulfilEdit] = useState({});
  const [localOrders, setLocalOrders] = useState(Array.isArray(purchaseOrders) ? purchaseOrders : []);

  // Form state for PO header
  const [form, setForm] = useState({
    id: '',
    customer_id: '',
    po_date: '',
    due_date: '',
    currency: 'INR',
    status: 'Pending',
    notes: ''
  });

  // Line items state
  const [newItems, setNewItems] = useState([]);

  // Product creation state
  const [creatingProduct, setCreatingProduct] = useState({});

  const [editing, setEditing] = useState(null);
  const [cols, setCols] = useState({
    id: true,
    customer: true,
    po_date: true,
    due_date: true,
    status: true,
    notes: true
  });
  const listSectionRef = React.useRef(null);

  // Constants
  const CURRENCIES = ['INR', 'USD', 'EUR', 'AED'];
  const CURRENCY_SYMBOLS = {
    INR: '₹',
    USD: '$',
    EUR: '€',
    AED: 'د.إ'
  };
  const LENGTH_UNITS = ['mm', 'ft'];

  React.useEffect(() => {
    setLocalOrders(Array.isArray(purchaseOrders) ? purchaseOrders : []);
  }, [purchaseOrders]);

  React.useEffect(() => {
    if (!Array.isArray(purchaseOrders) || purchaseOrders.length === 0) {
      refreshLocalOrders();
    }
  }, []);

  async function refreshLocalOrders() {
    try {
      const resp = await fetch(`${API_URL}/client-purchase-orders`);
      if (resp.ok) {
        const data = await resp.json();
        setLocalOrders(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to refresh client POs', err);
    }
  }

  // Add new line item
  function addNewItem() {
    setNewItems([...newItems, {
      product_id: '',
      quantity: 0,
      unit_price: 0,
      currency: 'INR',
      new_product: false,
      new_product_id: '',
      description: '',
      steel_diameter: 0,
      copper_coating: 0,
      length: 0,
      length_unit: 'mm'
    }]);
  }

  // Update line item
  function updateNewItem(index, key, value) {
    const items = [...newItems];
    items[index][key] = value;

    // If dimensions changed, recalculate weights
    if (['steel_diameter', 'copper_coating', 'length', 'length_unit'].includes(key)) {
      const item = items[index];
      const lengthMm = item.length_unit === 'ft' ? item.length * 304.8 : item.length;
      const weights = calculateWeights(item.steel_diameter, lengthMm, item.copper_coating);
      items[index].calculated_weights = weights;
    }

    setNewItems(items);
  }

  // Remove line item
  function removeNewItem(index) {
    const items = [...newItems];
    items.splice(index, 1);
    setNewItems(items);
  }

  // Calculate weights (existing function from codebase)
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
      steelWeight: steelWeight.toFixed(3),
      copperWeight: copperWeight.toFixed(3),
      totalWeight: totalWeight.toFixed(3),
      cbgDiameter: cbgDia.toFixed(2)
    };
  }

  // Create PO with line items
  async function add() {
    if (!form.id || !form.customer_id || !form.po_date || !form.due_date) {
      alert('Please fill PO ID, Customer, PO Date, and Due Date');
      return;
    }

    try {
      // Create any new products first
      for (const item of newItems) {
        if (item.new_product) {
          const productId = item.new_product_id || `P${Date.now()}`;
          const lengthMm = item.length_unit === 'ft' ? item.length * 304.8 : item.length;

          const productData = {
            id: productId,
            description: item.description || `${item.steel_diameter}mm x ${item.length}${item.length_unit} - ${item.copper_coating}µm`,
            steel_diameter: Number(item.steel_diameter),
            length: lengthMm,
            copper_coating: Number(item.copper_coating)
          };

          const pRes = await fetch(`${API_URL}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(productData)
          });

          if (!pRes.ok) {
            const err = await pRes.json().catch(() => ({}));
            alert(`Failed to create product: ${err.error || 'Unknown error'}`);
            return;
          }

          // Create BOM entries
          const weights = item.calculated_weights || calculateWeights(item.steel_diameter, lengthMm, item.copper_coating);

          await fetch(`${API_URL}/bom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product_id: productId,
              material: 'Steel',
              qty_per_unit: parseFloat(weights.steelWeight)
            })
          });

          await fetch(`${API_URL}/bom`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product_id: productId,
              material: 'Copper Anode',
              qty_per_unit: parseFloat(weights.copperWeight)
            })
          });

          // Update item to use the created product
          item.product_id = productId;
        }
      }

      // Create PO with line items
      const line_items = newItems.map(item => ({
        product_id: item.product_id,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        currency: item.currency || 'INR'
      }));

      const payload = {
        ...form,
        line_items
      };

      const res = await fetch(`${API_URL}/purchase-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json().catch(() => ({}));

      if (res.ok) {
        alert(result.message || 'Client PO created successfully');
        setForm({ id: '', customer_id: '', po_date: '', due_date: '', currency: 'INR', status: 'Pending', notes: '' });
        setNewItems([]);
        await refreshLocalOrders();
        if (onRefresh) await onRefresh();

        setTimeout(() => {
          if (listSectionRef.current) {
            listSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      } else {
        alert(result.error || 'Failed to create PO');
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  async function save(po) {
    await fetch(`${API_URL}/purchase-orders/${po.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(po)
    });
    setEditing(null);
    await refreshLocalOrders();
    if (onRefresh) await onRefresh();
  }

  async function del(id) {
    if (!confirm('Delete Client PO?')) return;
    await fetch(`${API_URL}/purchase-orders/${id}`, { method: 'DELETE' });
    await refreshLocalOrders();
    if (onRefresh) await onRefresh();
  }

  async function toggleDetails(po) {
    setOpenDetails(prev => ({ ...prev, [po.id]: !prev[po.id] }));
    if (!lineItems[po.id]) {
      const res = await fetch(`${API_URL}/client-purchase-orders/${po.id}/items`);
      const items = await res.json();
      setLineItems(prev => ({ ...prev, [po.id]: items }));
    }
  }

  async function updateDelivered(poId, itemId, delivered) {
    const item = (lineItems[poId] || []).find(i => i.id === itemId);
    if (!item) return;
    const newDelivered = Math.max(0, Math.min(Number(delivered || 0), item.quantity));

    const res = await fetch(`${API_URL}/client-po-line-items/${itemId}/delivered`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivered: newDelivered })
    });

    if (res.ok) {
      const r = await fetch(`${API_URL}/client-purchase-orders/${poId}/items`);
      const items = await r.json();
      setLineItems(prev => ({ ...prev, [poId]: items }));
      setFulfilEdit(prev => ({ ...prev, [`${poId}_${itemId}`]: undefined }));
    } else {
      alert('Failed to update delivered quantity');
    }
  }

  // Format currency
  function formatCurrency(amount, currency = 'INR') {
    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    return `${symbol}${Number(amount || 0).toLocaleString()}`;
  }

  // Render component
  return React.createElement('div', { className: 'space-y-4' },
    // Add Client PO Form
    React.createElement(Section, { title: 'Add Client PO' },
      React.createElement('div', { className: 'space-y-4' },
        // PO Header Fields
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-6 gap-3' },
          React.createElement('input', {
            className: 'border rounded px-3 py-2',
            placeholder: 'PO ID',
            value: form.id,
            onChange: e => setForm({ ...form, id: e.target.value })
          }),
          React.createElement('select', {
            className: 'border rounded px-3 py-2',
            value: form.customer_id,
            onChange: e => setForm({ ...form, customer_id: e.target.value })
          },
            React.createElement('option', { value: '' }, 'Select Customer'),
            customers.map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.id} - ${c.name}`))
          ),
          React.createElement('input', {
            className: 'border rounded px-3 py-2',
            type: 'date',
            placeholder: 'PO Date',
            value: form.po_date,
            onChange: e => setForm({ ...form, po_date: e.target.value })
          }),
          React.createElement('input', {
            className: 'border rounded px-3 py-2',
            type: 'date',
            placeholder: 'Due Date',
            value: form.due_date,
            onChange: e => setForm({ ...form, due_date: e.target.value })
          }),
          React.createElement('select', {
            className: 'border rounded px-3 py-2',
            value: form.status,
            onChange: e => setForm({ ...form, status: e.target.value })
          },
            ['Pending', 'Confirmed', 'In Production', 'Completed', 'Cancelled'].map(s =>
              React.createElement('option', { key: s, value: s }, s)
            )
          ),
          React.createElement('input', {
            className: 'border rounded px-3 py-2',
            placeholder: 'Notes',
            value: form.notes,
            onChange: e => setForm({ ...form, notes: e.target.value })
          })
        ),

        // Line Items Section
        React.createElement('div', { className: 'border-t pt-4' },
          React.createElement('div', { className: 'flex justify-between items-center mb-3' },
            React.createElement('h4', { className: 'font-semibold text-lg' }, 'Line Items'),
            React.createElement('button', {
              className: 'px-3 py-1 bg-blue-600 text-white rounded text-sm',
              onClick: addNewItem
            }, '+ Add Item')
          ),

          // Line Items Table
          newItems.length > 0 && React.createElement('div', { className: 'overflow-x-auto' },
            React.createElement('table', { className: 'min-w-full border-collapse text-sm' },
              React.createElement('thead', null,
                React.createElement('tr', { className: 'bg-gray-100' },
                  ['Product', 'New?', 'Qty', 'Unit Price', 'Currency', 'Line Total', 'Actions'].map(h =>
                    React.createElement('th', { key: h, className: 'p-2 text-left border' }, h)
                  )
                )
              ),
              React.createElement('tbody', null,
                newItems.map((item, idx) =>
                  React.createElement(React.Fragment, { key: idx },
                    // Main row
                    React.createElement('tr', { className: 'border-b' },
                      // Product selection
                      React.createElement('td', { className: 'p-2 border' },
                        React.createElement('select', {
                          className: 'border rounded px-2 py-1 w-full',
                          value: item.product_id,
                          onChange: e => updateNewItem(idx, 'product_id', e.target.value),
                          disabled: item.new_product
                        },
                          React.createElement('option', { value: '' }, 'Select Product'),
                          products.map(p => React.createElement('option', { key: p.id, value: p.id }, `${p.id} - ${p.description}`))
                        )
                      ),
                      // New product checkbox
                      React.createElement('td', { className: 'p-2 border text-center' },
                        React.createElement('input', {
                          type: 'checkbox',
                          checked: item.new_product,
                          onChange: e => updateNewItem(idx, 'new_product', e.target.checked)
                        })
                      ),
                      // Quantity
                      React.createElement('td', { className: 'p-2 border' },
                        React.createElement('input', {
                          type: 'number',
                          className: 'border rounded px-2 py-1 w-20',
                          value: item.quantity,
                          onChange: e => updateNewItem(idx, 'quantity', e.target.value)
                        })
                      ),
                      // Unit Price
                      React.createElement('td', { className: 'p-2 border' },
                        React.createElement('input', {
                          type: 'number',
                          step: '0.01',
                          className: 'border rounded px-2 py-1 w-24',
                          value: item.unit_price,
                          onChange: e => updateNewItem(idx, 'unit_price', e.target.value)
                        })
                      ),
                      // Currency
                      React.createElement('td', { className: 'p-2 border' },
                        React.createElement('select', {
                          className: 'border rounded px-2 py-1',
                          value: item.currency,
                          onChange: e => updateNewItem(idx, 'currency', e.target.value)
                        },
                          CURRENCIES.map(c => React.createElement('option', { key: c, value: c }, c))
                        )
                      ),
                      // Line Total
                      React.createElement('td', { className: 'p-2 border text-right' },
                        formatCurrency(item.quantity * item.unit_price, item.currency)
                      ),
                      // Actions
                      React.createElement('td', { className: 'p-2 border' },
                        React.createElement('button', {
                          className: 'px-2 py-1 bg-red-600 text-white rounded text-xs',
                          onClick: () => removeNewItem(idx)
                        }, 'Remove')
                      )
                    ),
                    // New product details row (if checkbox is checked)
                    item.new_product && React.createElement('tr', { className: 'bg-blue-50' },
                      React.createElement('td', { colSpan: 7, className: 'p-3 border' },
                        React.createElement('div', { className: 'space-y-2' },
                          React.createElement('h5', { className: 'font-semibold text-sm mb-2' }, 'New Product Specifications'),
                          React.createElement('div', { className: 'grid grid-cols-2 md:grid-cols-4 gap-2' },
                            React.createElement('div', null,
                              React.createElement('label', { className: 'text-xs' }, 'Product ID'),
                              React.createElement('input', {
                                className: 'border rounded px-2 py-1 w-full text-sm',
                                placeholder: 'e.g., R-100',
                                value: item.new_product_id,
                                onChange: e => updateNewItem(idx, 'new_product_id', e.target.value)
                              })
                            ),
                            React.createElement('div', null,
                              React.createElement('label', { className: 'text-xs' }, 'Description'),
                              React.createElement('input', {
                                className: 'border rounded px-2 py-1 w-full text-sm',
                                placeholder: 'Product description',
                                value: item.description,
                                onChange: e => updateNewItem(idx, 'description', e.target.value)
                              })
                            ),
                            React.createElement('div', null,
                              React.createElement('label', { className: 'text-xs' }, 'Steel Dia (mm)'),
                              React.createElement('input', {
                                type: 'number',
                                step: '0.1',
                                className: 'border rounded px-2 py-1 w-full text-sm',
                                value: item.steel_diameter,
                                onChange: e => updateNewItem(idx, 'steel_diameter', e.target.value)
                              })
                            ),
                            React.createElement('div', null,
                              React.createElement('label', { className: 'text-xs' }, 'Copper Coating (µm)'),
                              React.createElement('input', {
                                type: 'number',
                                className: 'border rounded px-2 py-1 w-full text-sm',
                                value: item.copper_coating,
                                onChange: e => updateNewItem(idx, 'copper_coating', e.target.value)
                              })
                            ),
                            React.createElement('div', null,
                              React.createElement('label', { className: 'text-xs' }, 'Length'),
                              React.createElement('input', {
                                type: 'number',
                                step: '0.1',
                                className: 'border rounded px-2 py-1 w-full text-sm',
                                value: item.length,
                                onChange: e => updateNewItem(idx, 'length', e.target.value)
                              })
                            ),
                            React.createElement('div', null,
                              React.createElement('label', { className: 'text-xs' }, 'Unit'),
                              React.createElement('select', {
                                className: 'border rounded px-2 py-1 w-full text-sm',
                                value: item.length_unit,
                                onChange: e => updateNewItem(idx, 'length_unit', e.target.value)
                              },
                                LENGTH_UNITS.map(u => React.createElement('option', { key: u, value: u }, u))
                              )
                            )
                          ),
                          // Auto-calculated values
                          item.calculated_weights && React.createElement('div', { className: 'bg-white border rounded p-2 mt-2' },
                            React.createElement('h6', { className: 'text-xs font-semibold mb-1' }, 'Auto-Calculated:'),
                            React.createElement('div', { className: 'grid grid-cols-4 gap-2 text-xs' },
                              React.createElement('div', null, `CBG Dia: ${item.calculated_weights.cbgDiameter} mm`),
                              React.createElement('div', null, `Steel: ${item.calculated_weights.steelWeight} kg`),
                              React.createElement('div', null, `Copper: ${item.calculated_weights.copperWeight} kg`),
                              React.createElement('div', null, `Total: ${item.calculated_weights.totalWeight} kg`)
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          ),

          // Submit button
          React.createElement('div', { className: 'flex justify-end mt-4' },
            React.createElement('button', {
              className: 'px-6 py-2 bg-green-600 text-white rounded font-semibold',
              onClick: add
            }, 'Create Purchase Order')
          )
        )
      )
    ),

    // List of existing POs
    React.createElement('div', { ref: listSectionRef },
      React.createElement(Section, { title: 'Client Purchase Orders' },
        React.createElement('div', { className: 'overflow-x-auto' },
          React.createElement('table', { className: 'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className: 'bg-gray-100' },
                cols.id && React.createElement('th', { className: 'p-2 border' }, 'PO ID'),
                cols.customer && React.createElement('th', { className: 'p-2 border' }, 'Customer'),
                cols.po_date && React.createElement('th', { className: 'p-2 border' }, 'PO Date'),
                cols.due_date && React.createElement('th', { className: 'p-2 border' }, 'Due Date'),
                cols.status && React.createElement('th', { className: 'p-2 border' }, 'Status'),
                cols.notes && React.createElement('th', { className: 'p-2 border' }, 'Notes'),
                React.createElement('th', { className: 'p-2 border' }, 'Actions')
              )
            ),
            React.createElement('tbody', null,
              localOrders.length > 0 ? localOrders.map(po => {
                const edit = editing === po.id;
                return React.createElement(React.Fragment, { key: po.id },
                  React.createElement('tr', { className: 'border-b' },
                    cols.id && React.createElement('td', { className: 'p-2 border font-mono' }, po.id),
                    cols.customer && React.createElement('td', { className: 'p-2 border' }, po.customer_name),
                    cols.po_date && React.createElement('td', { className: 'p-2 border' }, po.po_date),
                    cols.due_date && React.createElement('td', { className: 'p-2 border' }, po.due_date),
                    cols.status && React.createElement('td', { className: 'p-2 border' }, po.status),
                    cols.notes && React.createElement('td', { className: 'p-2 border' }, po.notes || ''),
                    React.createElement('td', { className: 'p-2 border text-right space-x-2' },
                      React.createElement('button', {
                        className: 'px-2 py-1 bg-blue-600 text-white rounded text-sm',
                        onClick: () => toggleDetails(po)
                      }, openDetails[po.id] ? 'Hide' : 'Details'),
                      React.createElement('button', {
                        className: 'px-2 py-1 bg-red-600 text-white rounded text-sm',
                        onClick: () => del(po.id)
                      }, 'Delete')
                    )
                  ),
                  // Line items details
                  openDetails[po.id] && React.createElement('tr', { className: 'bg-gray-50' },
                    React.createElement('td', { colSpan: 7, className: 'p-3 border' },
                      React.createElement('h4', { className: 'font-semibold mb-2' }, 'Line Items & Fulfillment'),
                      (lineItems[po.id] && lineItems[po.id].length > 0) ?
                        React.createElement('table', { className: 'min-w-full border-collapse text-sm' },
                          React.createElement('thead', null,
                            React.createElement('tr', { className: 'bg-gray-200' },
                              ['Product', 'Description', 'Ordered', 'Delivered', 'Remaining', 'Unit Price', 'Currency', 'Actions'].map(h =>
                                React.createElement('th', { key: h, className: 'p-2 border' }, h)
                              )
                            )
                          ),
                          React.createElement('tbody', null,
                            lineItems[po.id].map(item =>
                              React.createElement('tr', { key: item.id },
                                React.createElement('td', { className: 'p-2 border' }, item.product_id),
                                React.createElement('td', { className: 'p-2 border' }, item.product_description),
                                React.createElement('td', { className: 'p-2 border text-right' }, item.quantity),
                                React.createElement('td', { className: 'p-2 border text-right' },
                                  fulfilEdit[`${po.id}_${item.id}`] !== undefined ?
                                    React.createElement('input', {
                                      type: 'number',
                                      min: 0,
                                      max: item.quantity,
                                      value: fulfilEdit[`${po.id}_${item.id}`],
                                      onChange: e => setFulfilEdit(prev => ({ ...prev, [`${po.id}_${item.id}`]: e.target.value }))
                                    }) : item.delivered
                                ),
                                React.createElement('td', { className: 'p-2 border text-right' }, item.quantity - item.delivered),
                                React.createElement('td', { className: 'p-2 border text-right' }, formatCurrency(item.unit_price, item.currency || 'INR')),
                                React.createElement('td', { className: 'p-2 border text-center' }, item.currency || 'INR'),
                                React.createElement('td', { className: 'p-2 border' },
                                  fulfilEdit[`${po.id}_${item.id}`] !== undefined ?
                                    React.createElement(React.Fragment, null,
                                      React.createElement('button', {
                                        className: 'px-2 py-1 bg-green-600 text-white rounded text-xs mr-1',
                                        onClick: () => updateDelivered(po.id, item.id, fulfilEdit[`${po.id}_${item.id}`])
                                      }, 'Save'),
                                      React.createElement('button', {
                                        className: 'px-2 py-1 border rounded text-xs',
                                        onClick: () => setFulfilEdit(prev => ({ ...prev, [`${po.id}_${item.id}`]: undefined }))
                                      }, 'Cancel')
                                    ) :
                                    React.createElement('button', {
                                      className: 'px-2 py-1 border rounded text-xs',
                                      onClick: () => setFulfilEdit(prev => ({ ...prev, [`${po.id}_${item.id}`]: item.delivered }))
                                    }, 'Edit')
                                )
                              )
                            )
                          )
                        ) :
                        React.createElement('p', { className: 'text-sm text-gray-500' }, 'No line items')
                    )
                  )
                );
              }) : React.createElement('tr', null,
                React.createElement('td', { colSpan: 7, className: 'p-4 text-center text-gray-500' }, 'No purchase orders found')
              )
            )
          )
        )
      )
    )
  );
}
