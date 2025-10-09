const { useState, useEffect } = React;
const API_URL = window.location.origin + '/api';

function GroundRodERP() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [clientPurchaseOrders, setClientPurchaseOrders] = useState([]);
  const [vendorPurchaseOrders, setVendorPurchaseOrders] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({});
  const [riskAnalysis, setRiskAnalysis] = useState({});
  const [loading, setLoading] = useState(true);
  // Filters / analytics
  const [rangeMode, setRangeMode] = useState({ mode: 'lastDays', days: 30, interval: 'day' });
  const [filter, setFilter] = useState({ marking: '', product_id: '' });

  useEffect(() => {
    const onDrill = (e) => {
      const metric = e.detail?.metric;
      // Navigate based on metric type
      if (metric === 'pending' || metric === 'overdue') {
        setActiveTab('client-orders');
      } else {
        setActiveTab('inventory');
      }
    };
    window.addEventListener('dash-drill', onDrill);
    return () => window.removeEventListener('dash-drill', onDrill);
  }, []);

  useEffect(() => { fetchAllData(); }, []);

  async function fetchAllData() {
    setLoading(true);
    try {
      const [productsRes, customersRes, vendorsRes, inventoryRes, clientPOsRes, vendorPOsRes, shipmentsRes, rawRes, statsRes, riskRes] = await Promise.all([
        fetch(`${API_URL}/products`),
        fetch(`${API_URL}/customers`),
        fetch(`${API_URL}/vendors`),
        fetch(`${API_URL}/inventory`),
        fetch(`${API_URL}/client-purchase-orders`),
        fetch(`${API_URL}/vendor-purchase-orders`),
        fetch(`${API_URL}/shipments`),
        fetch(`${API_URL}/raw-materials`),
        fetch(`${API_URL}/dashboard/stats`),
        fetch(`${API_URL}/dashboard/risk-analysis`)
      ]);
      setProducts(await productsRes.json());
      setCustomers(await customersRes.json());
      setVendors(await vendorsRes.json());
      setInventory(await inventoryRes.json());
      setClientPurchaseOrders(await clientPOsRes.json());
      setVendorPurchaseOrders(await vendorPOsRes.json());
      setShipments(await shipmentsRes.json());
      setRawMaterials(await rawRes.json());
      setDashboardStats(await statsRes.json());
      setRiskAnalysis(await riskRes.json());
    } catch (err) {
      console.error('Data load error:', err);
      alert('Error loading data. Please refresh.');
    } finally {
      setLoading(false);
    }
  }

  function calculateWeights(steelDiameter, copperCoating, lengthMm) {
    // Convert units
    const Lm = (lengthMm || 0) / 1000; // mm -> m
    const d_mm = steelDiameter || 0;
    const t_um = copperCoating || 0;
    const rhoSteel = 7850; // kg/m3
    const rhoCu = 8960;    // kg/m3
    const r_m = (d_mm / 1000) / 2;
    const t_m = t_um / 1e6;
    // Core steel weight (solid cylinder)
    const steelVol = Math.PI * r_m * r_m * Lm;
    const steelWeight = steelVol * rhoSteel;
    // Copper shell volume (cylindrical shell, thin wall): approx 2πr t L
    const copperVol = 2 * Math.PI * r_m * t_m * Lm;
    const copperWeight = copperVol * rhoCu;
    const cbgWeight = steelWeight + copperWeight;
    const cbgDiameterRaw = d_mm + (t_um * 2 / 1000);
    // Round to nearest 0.10 with two decimals (e.g., 12.71 -> 12.70)
    const cbgDiameter = (Math.round(cbgDiameterRaw * 10) / 10).toFixed(2);
    return { steel: steelWeight.toFixed(3), copper: copperWeight.toFixed(3), cbg: cbgWeight.toFixed(3), cbgDiameter };
  }

  if (loading) {
    return (
      React.createElement('div', { className: 'flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100' },
        React.createElement('div', { className: 'text-center' },
          React.createElement('div', { className: 'animate-spin rounded-full h-16 w-16 border-b-4 border-blue-400 mx-auto' }),
          React.createElement('p', { className: 'mt-4 text-gray-700 text-lg font-semibold' }, 'Loading ERP...')
        )
      )
    );
  }

  return (
    React.createElement('div', { className: 'min-h-screen bg-gradient-to-br from-gray-50 to-blue-50' },
      React.createElement(Header, { onRefresh: fetchAllData }),
      React.createElement(NavTabs, { activeTab, setActiveTab }),
      React.createElement('main', { className: 'max-w-7xl mx-auto px-6 py-6' },
        activeTab === 'dashboard' && React.createElement(Dashboard, { stats: dashboardStats, riskAnalysis, clientPurchaseOrders, inventory }),
        activeTab === 'production' && React.createElement(DailyProduction, { products, onSubmit: fetchAllData }),
        activeTab === 'client-orders' && React.createElement(ClientPurchaseOrders, { purchaseOrders: clientPurchaseOrders, products, customers, onRefresh: fetchAllData }),
        activeTab === 'vendor-orders' && React.createElement(VendorPurchaseOrdersEx, { purchaseOrders: vendorPurchaseOrders, vendors, onRefresh: fetchAllData }),
        activeTab === 'shipments' && React.createElement(Shipments, { shipments, purchaseOrders: clientPurchaseOrders, products, onRefresh: fetchAllData }),
        activeTab === 'inventory' && React.createElement(InventoryViewEx, { inventory, rawMaterials, products, customers, onRefresh: fetchAllData, filter, setFilter, rangeMode, setRangeMode }),
        activeTab === 'products' && React.createElement(ProductMasterEx, { products, calculateWeights, onRefresh: fetchAllData }),
        activeTab === 'customers' && React.createElement(CustomerManagementEx, { customers, onRefresh: fetchAllData }),
        activeTab === 'vendors' && React.createElement(VendorManagement, { vendors, onRefresh: fetchAllData }),
        activeTab === 'imports' && React.createElement(ImportsPanel, { customers, vendors, products }),
        activeTab === 'assistant' && React.createElement(AssistantPanel, null)
      )
    )
  );
}

function Header({ onRefresh }){
  return (
    React.createElement('header', { className: 'bg-gradient-to-r from-blue-500 to-indigo-600 shadow-lg' },
      React.createElement('div', { className: 'max-w-7xl mx-auto px-6 py-4' },
        React.createElement('div', { className: 'flex justify-between items-center' },
          React.createElement('div', null,
            React.createElement('h1', { className: 'text-2xl font-bold text-white tracking-tight' }, 'Ground Rod ERP'),
            React.createElement('p', { className: 'text-blue-100 text-sm' }, 'Copper Bonded Ground Rod Manufacturing & Export')
          ),
          React.createElement('button', { onClick: onRefresh, className: 'px-4 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 font-semibold transition' }, 'Refresh')
        )
      )
    )
  );
}

function NavTabs({ activeTab, setActiveTab }){
  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'production', label: 'Production' },
    { id: 'client-orders', label: 'Client Orders' },
    { id: 'vendor-orders', label: 'Vendor Orders' },
    { id: 'shipments', label: 'Shipments' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'products', label: 'Products' },
    { id: 'customers', label: 'Customers' },
    { id: 'vendors', label: 'Vendors' },
    { id: 'imports', label: 'Imports' },
    { id: 'assistant', label: 'Assistant' },
  ];
  return (
    React.createElement('nav', { className: 'bg-white shadow-md border-b-2 border-gray-200' },
      React.createElement('div', { className: 'max-w-7xl mx-auto px-6' },
        React.createElement('div', { className: 'flex gap-1 overflow-x-auto' },
          tabs.map(tab => (
            React.createElement('button', {
              key: tab.id, onClick: () => setActiveTab(tab.id),
              className: `px-5 py-3 font-semibold transition-all whitespace-nowrap rounded-t-lg ${activeTab === tab.id ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-blue-50'}`
            }, tab.label)
          ))
        )
      )
    )
  );
}

function Dashboard({ stats, riskAnalysis, clientPurchaseOrders, inventory }){
  return (
    React.createElement('div', { className: 'space-y-6' },
      React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4' },
        React.createElement(MetricCardDrill, { id:'wip', title: 'Total WIP', value: (stats.total_wip || 0).toLocaleString(), color: 'blue' }),
        React.createElement(MetricCardDrill, { id:'finished', title: 'Finished Goods', value: (stats.total_finished || 0).toLocaleString(), color: 'green' }),
        React.createElement(MetricCardDrill, { id:'pending', title: 'Pending Orders', value: (stats.pending_orders || 0).toLocaleString(), color: 'orange' }),
        React.createElement(MetricCardDrill, { id:'overdue', title: 'Overdue Orders', value: stats.overdue_orders || 0, color: 'red' })
      ),
      React.createElement('div', { className: 'bg-white rounded-xl shadow-md p-6 border border-gray-200' },
        React.createElement('h3', { className: 'text-xl font-bold mb-4 text-gray-800' }, 'Risk Management - Material Requirements vs Availability'),
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-6' },
          riskAnalysis.steel && React.createElement(RiskBox, { title: 'STEEL', data: riskAnalysis.steel, color: 'gray' }),
          riskAnalysis.copper && React.createElement(RiskBox, { title: 'COPPER', data: riskAnalysis.copper, color: 'orange' })
        )
      ),
      React.createElement('div', { className: 'grid grid-cols-1 lg:grid-cols-2 gap-6' },
        React.createElement('div', { className: 'bg-white rounded-xl shadow-md p-6 border border-gray-200' },
          React.createElement('h3', { className: 'text-lg font-bold mb-4 text-gray-800' }, 'Recent Client Orders'),
          React.createElement('div', { className: 'space-y-2' },
            clientPurchaseOrders.filter(po => po.status !== 'Completed' && po.status !== 'Cancelled').slice(0, 5).length > 0 ? (
              clientPurchaseOrders.filter(po => po.status !== 'Completed' && po.status !== 'Cancelled').slice(0, 5).map(po => (
                React.createElement('div', { key: po.id, className: `p-3 rounded-lg border-l-4 ${po.status === 'Pending' ? 'bg-yellow-50 border-yellow-400' : 'bg-blue-50 border-blue-400'}` },
                  React.createElement('div', { className: 'flex justify-between items-start' },
                    React.createElement('div', { className: 'flex-1' },
                      React.createElement('div', { className: 'font-bold text-sm' }, `${po.id} - ${po.customer_name || 'Unknown Customer'}`),
                      React.createElement('div', { className: 'text-xs text-gray-600 mt-1' }, `Due: ${po.due_date}`),
                      React.createElement('div', { className: 'text-xs text-gray-500 mt-1' }, po.notes || 'No notes')
                    ),
                    React.createElement('div', { className: 'text-right ml-2' },
                      React.createElement('div', { className: `font-semibold text-xs px-2 py-1 rounded ${po.status === 'Pending' ? 'bg-yellow-200 text-yellow-800' : 'bg-blue-200 text-blue-800'}` }, po.status)
                    )
                  )
                )
              ))
            ) : (
              React.createElement('div', { className: 'text-sm text-gray-500 italic' }, 'No active orders')
            )
          )
        ),
        React.createElement('div', { className: 'bg-white rounded-xl shadow-md p-6 border border-gray-200' },
          React.createElement('h3', { className: 'text-lg font-bold mb-4 text-gray-800' }, 'Top Inventory'),
          React.createElement('div', { className: 'space-y-2' },
            inventory.sort((a,b)=>b.packed-a.packed).slice(0,5).map(item => (
              React.createElement('div', { key: item.product_id, className: 'flex justify-between items-center p-3 bg-blue-50 rounded-lg' },
                React.createElement('div', { className: 'font-semibold text-sm' }, item.product_description),
                React.createElement('div', { className: 'font-bold text-blue-600' }, `${item.packed} units`)
              )
            ))
          )
        )
      ),
      React.createElement(AnalyticsPanel, null)
    )
  );
}

function RiskBox({ title, data }){
  return (
    React.createElement('div', { className: 'p-5 bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg border border-gray-300' },
      React.createElement('h4', { className: 'font-bold text-lg mb-3 text-gray-800' }, title),
      React.createElement('div', { className: 'space-y-2' },
        React.createElement('div', { className: 'flex justify-between' },
          React.createElement('span', { className: 'font-semibold' }, 'Required for Pending Orders:'),
          React.createElement('span', { className: 'font-bold text-blue-600' }, `${parseFloat(data.required).toLocaleString()} kg`)
        ),
        React.createElement('div', { className: 'flex justify-between' },
          React.createElement('span', { className: 'font-semibold' }, 'Available Stock:'),
          React.createElement('span', { className: 'font-bold text-green-600' }, `${parseFloat(data.available).toLocaleString()} kg`)
        ),
        React.createElement('div', { className: 'flex justify-between pt-2 border-t border-gray-300' },
          React.createElement('span', { className: 'font-bold' }, 'Net Position:'),
          parseFloat(data.shortage) > 0 ? (
            React.createElement('span', { className: 'font-bold text-red-600' }, `SHORTAGE: ${parseFloat(data.shortage).toLocaleString()} kg`)
          ) : (
            React.createElement('span', { className: 'font-bold text-green-600' }, `EXCESS: ${parseFloat(data.excess).toLocaleString()} kg`)
          )
        )
      )
    )
  );
}

// Analytics Panel with charts and controls
function AnalyticsPanel(){
  const [group, setGroup] = useState('marking');
  const [days, setDays] = useState(30);
  const [interval, setInterval] = useState('day');
  const wipRef = React.useRef(null);
  const fvRef = React.useRef(null);
  const byRef = React.useRef(null);
  const charts = React.useRef({});

  async function loadCharts(){
    // WIP by stage
    const wip = await (await fetch(`${API_URL}/analytics/wip-stages`)).json();
    const wd = {
      labels: ['Plated','Machined','QC','Stamped','Packed'],
      datasets:[{ data:[wip.plated,wip.machined,wip.qc,wip.stamped,wip.packed], backgroundColor:['#60a5fa','#34d399','#fbbf24','#f87171','#818cf8'] }]
    };
    if (charts.current.wip) charts.current.wip.destroy();
    charts.current.wip = new Chart(wipRef.current.getContext('2d'), { type:'doughnut', data:wd, options:{ responsive:true } });

    // Finished vs WIP trend
    const fv = await (await fetch(`${API_URL}/analytics/finished-vs-wip?days=${encodeURIComponent(days)}&interval=${encodeURIComponent(interval)}`)).json();
    const fvd = { labels: fv.labels, datasets:[
      { label:'WIP', data: fv.series.wip, backgroundColor:'#60a5fa' },
      { label:'Finished', data: fv.series.finished, backgroundColor:'#34d399' }
    ]};
    if (charts.current.fv) charts.current.fv.destroy();
    charts.current.fv = new Chart(fvRef.current.getContext('2d'), { type:'bar', data:fvd, options:{ responsive:true, scales:{ x:{ stacked:false }, y:{ beginAtZero:true } } } });

    // Inventory by group
    const by = await (await fetch(`${API_URL}/analytics/inventory-by?group=${encodeURIComponent(group)}`)).json();
    const labels = by.map(b=>b.label||'Unmarked');
    const mk = (k)=> by.map(b=>b[k]);
    const byd = { labels, datasets:[
      { label:'Plated', data: mk('plated'), backgroundColor:'#60a5fa' },
      { label:'Machined', data: mk('machined'), backgroundColor:'#34d399' },
      { label:'QC', data: mk('qc'), backgroundColor:'#fbbf24' },
      { label:'Stamped', data: mk('stamped'), backgroundColor:'#f87171' },
      { label:'Packed', data: mk('packed'), backgroundColor:'#818cf8' }
    ]};
    if (charts.current.by) charts.current.by.destroy();
    charts.current.by = new Chart(byRef.current.getContext('2d'), { type:'bar', data: byd, options:{ responsive:true, scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } } });
  }

  useEffect(() => { loadCharts(); }, []);
  useEffect(() => { loadCharts(); }, [group, days, interval]);

  return (
    React.createElement('div', { className:'bg-white rounded-xl shadow-md p-6 border border-gray-200 space-y-4' },
      React.createElement('div', { className:'flex flex-wrap gap-3 items-center' },
        React.createElement('div', null,
          React.createElement('label', { className:'text-sm font-semibold mr-2' }, 'Trend Window:'),
          React.createElement('input', { type:'number', min:1, max:365, value:days, onChange:e=>setDays(parseInt(e.target.value||30,10)), className:'border rounded px-2 py-1 w-24 mr-2' }),
          React.createElement('select', { value:interval, onChange:e=>setInterval(e.target.value), className:'border rounded px-2 py-1' },
            React.createElement('option', { value:'day' }, 'By Day'),
            React.createElement('option', { value:'month' }, 'By Month')
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { className:'text-sm font-semibold mr-2' }, 'Inventory By:'),
          React.createElement('select', { value:group, onChange:e=>setGroup(e.target.value), className:'border rounded px-2 py-1' },
            React.createElement('option', { value:'marking' }, 'Customer Marking'),
            React.createElement('option', { value:'product' }, 'Product')
          )
        )
      ),
      React.createElement('div', { className:'grid grid-cols-1 lg:grid-cols-3 gap-6' },
        React.createElement('div', null,
          React.createElement('h4', { className:'font-bold mb-2' }, 'WIP by Stage'),
          React.createElement('canvas', { ref: wipRef, height: 200 })
        ),
        React.createElement('div', { className:'lg:col-span-2' },
          React.createElement('h4', { className:'font-bold mb-2' }, 'Finished vs WIP'),
          React.createElement('canvas', { ref: fvRef, height: 200 })
        ),
        React.createElement('div', { className:'lg:col-span-3' },
          React.createElement('h4', { className:'font-bold mb-2' }, group === 'marking' ? 'Inventory by Marking' : 'Inventory by Product'),
          React.createElement('canvas', { ref: byRef, height: 220 })
        )
      )
    )
  );
}
function DailyProduction({ products, onSubmit }){
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [entries, setEntries] = useState([]);
  const [recent, setRecent] = useState([]);
  const [limit, setLimit] = useState(20);
  async function loadRecent(l){
    try { const r = await fetch(`${API_URL}/production?limit=${encodeURIComponent(l||limit)}`); setRecent(await r.json()); } catch {}
  }
  useEffect(()=>{ loadRecent(limit); },[]);
  function addEntry(){ setEntries([...entries, { product_id: products[0]?.id || '', plated:0,machined:0,qc:0,stamped:0,packed:0,rejected:0,notes:'' }]); }
  function updateEntry(i, field, val){ const e=[...entries]; e[i][field]= (['notes','product_id'].includes(field))? val : Number(val||0); setEntries(e); }
  async function save(){ await fetch(`${API_URL}/production`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ date, entries }) }); setEntries([]); onSubmit?.(); alert('Production saved'); loadRecent(limit); }
  return (
    React.createElement('div', { className: 'bg-white rounded-xl shadow-md p-6 border border-gray-200 space-y-4' },
      React.createElement('div', { className: 'flex gap-3 items-end' },
        React.createElement('div', null,
          React.createElement('label', { className: 'text-sm font-semibold text-gray-700' }, 'Date'),
          React.createElement('input', { type: 'date', value: date, onChange: e=>setDate(e.target.value), className: 'ml-2 border rounded px-2 py-1' })
        ),
        React.createElement('button', { onClick: addEntry, className: 'px-3 py-2 bg-blue-600 text-white rounded' }, 'Add Line'),
        React.createElement('button', { onClick: save, className: 'px-3 py-2 bg-green-600 text-white rounded' }, 'Save')
      ),
      React.createElement('div', { className: 'overflow-x-auto' },
        React.createElement('table', { className: 'min-w-full border-collapse' },
          React.createElement('thead', null,
            React.createElement('tr', { className: 'bg-gray-100' },
              ['Product','Plated','Machined','QC','Stamped','Packed','Rejected','Notes'].map(h=> React.createElement('th', { key: h, className: 'p-2' }, h))
            )
          ),
          React.createElement('tbody', null,
            entries.map((en,i)=> (
              React.createElement('tr', { key: i, className: 'border-b' },
                React.createElement('td', { className: 'p-2' },
                  React.createElement('select', { value: en.product_id, onChange: e=>updateEntry(i,'product_id',e.target.value), className: 'border rounded px-2 py-1' },
                    products.map(p=> React.createElement('option', { key: p.id, value: p.id }, `${p.id} - ${p.description}`))
                  )
                ),
                ['plated','machined','qc','stamped','packed','rejected'].map(f=> (
                  React.createElement('td', { key: f, className: 'p-2' },
                    React.createElement('input', { type: 'number', min: 0, value: en[f], onChange: e=>updateEntry(i,f,e.target.value), className: 'w-24 border rounded px-2 py-1 text-right' })
                  )
                )),
                React.createElement('td', { className: 'p-2' },
                  React.createElement('input', { value: en.notes, onChange: e=>updateEntry(i,'notes',e.target.value), className: 'border rounded px-2 py-1' })
                )
              )
            ))
          )
        )
      ),
      React.createElement('div', { className:'pt-4 border-t space-y-2' },
        React.createElement('div', { className:'flex items-center gap-3' },
          React.createElement('h4', { className:'font-semibold' }, 'Recent Production'),
          React.createElement('label', { className:'text-sm text-gray-600' }, 'Show last'),
          React.createElement('select', { className:'border rounded px-2 py-1', value:limit, onChange:e=>{ const v = parseInt(e.target.value,10); setLimit(v); loadRecent(v); } },
            [20,50,100].map(n => React.createElement('option', { key:n, value:n }, n))
          ),
          React.createElement('span', { className:'text-sm text-gray-600' }, 'entries')
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' }, ['Date','Product','Plated','Machined','QC','Stamped','Packed','Rejected','Notes'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
            ),
            React.createElement('tbody', null,
              recent.map((r,i)=> (
                React.createElement('tr', { key:i, className:'border-b' },
                  React.createElement('td', { className:'p-2' }, r.production_date),
                  React.createElement('td', { className:'p-2' }, r.product_description || r.product_id),
                  React.createElement('td', { className:'p-2 text-center' }, r.plated||0),
                  React.createElement('td', { className:'p-2 text-center' }, r.machined||0),
                  React.createElement('td', { className:'p-2 text-center' }, r.qc||0),
                  React.createElement('td', { className:'p-2 text-center' }, r.stamped||0),
                  React.createElement('td', { className:'p-2 text-center' }, r.packed||0),
                  React.createElement('td', { className:'p-2 text-center' }, r.rejected||0),
                  React.createElement('td', { className:'p-2' }, r.notes||'')
                )
              ))
            )
          )
        )
      )
    )
  );
}

function ClientPurchaseOrders({ purchaseOrders, products, customers, onRefresh }){
  const [openDetails, setOpenDetails] = useState({});
  const [lineItems, setLineItems] = useState({});
  const [fulfilEdit, setFulfilEdit] = useState({});
  const [localOrders, setLocalOrders] = useState(Array.isArray(purchaseOrders) ? purchaseOrders : []);

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

  async function toggleDetails(po) {
    setOpenDetails(prev => ({ ...prev, [po.id]: !prev[po.id] }));
    if (!lineItems[po.id]) {
      const res = await fetch(`${API_URL}/client-purchase-orders/${po.id}/items`);
      const items = await res.json();
      setLineItems(prev => ({ ...prev, [po.id]: items }));
    }
  }

  async function updateDelivered(poId, itemId, delivered) {
    // PATCH endpoint not present, so use PUT for full update
    const item = (lineItems[poId]||[]).find(i=>i.id===itemId);
    if (!item) return;
    const newDelivered = Math.max(0, Math.min(Number(delivered)||0, item.quantity));
    // Only update delivered field
    const res = await fetch(`${API_URL}/client-po-line-items/${itemId}/delivered`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delivered: newDelivered })
    });
    if (res.ok) {
      // Refresh line items
      const r = await fetch(`${API_URL}/client-purchase-orders/${poId}/items`);
      const items = await r.json();
      setLineItems(prev => ({ ...prev, [poId]: items }));
      setFulfilEdit(prev => ({ ...prev, [`${poId}_${itemId}`]: undefined }));
    } else {
      alert('Failed to update delivered quantity');
    }
  }
  const [form, setForm] = useState({ id:'', customer_id:'', po_date:'', due_date:'', currency:'INR', status:'Pending', notes:'' });
  const [editing, setEditing] = useState(null);
  const [cols, setCols] = useState({ id:true, customer:true, po_date:true, due_date:true, delivery:true, payment:true, status:true, notes:true });
  const listSectionRef = React.useRef(null);

  async function add(){
    const res = await fetch(`${API_URL}/purchase-orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
    if (res.ok) {
      setForm({ id:'', customer_id:'', po_date:'', due_date:'', currency:'INR', status:'Pending', notes:'' });
      await refreshLocalOrders();
      if (onRefresh) await onRefresh();
      setTimeout(() => {
        if (listSectionRef.current) {
          listSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    } else {
      alert('Failed to add purchase order');
    }
  }
  async function save(po){
    await fetch(`${API_URL}/purchase-orders/${po.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(po) });
    setEditing(null);
    await refreshLocalOrders();
    if (onRefresh) await onRefresh();
  }
  async function del(id){
    if(!confirm('Delete Client PO?')) return;
    await fetch(`${API_URL}/purchase-orders/${id}`, { method:'DELETE' });
    await refreshLocalOrders();
    if (onRefresh) await onRefresh();
  }
  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title:'Add Client PO' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-3' },
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'PO ID', value: form.id, onChange:e=>setForm({...form,id:e.target.value}) }),
          React.createElement('select', { className:'border rounded px-2 py-1', value: form.customer_id, onChange:e=>setForm({...form,customer_id:e.target.value}) },
            React.createElement('option', { value:'' }, 'Select Customer'),
            customers.map(c => React.createElement('option', { key:c.id, value:c.id }, `${c.id} - ${c.name}`))
          ),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value: form.po_date, onChange:e=>setForm({...form,po_date:e.target.value}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value: form.due_date, onChange:e=>setForm({...form,due_date:e.target.value}) }),
          React.createElement('select', { className:'border rounded px-2 py-1', value: form.status, onChange:e=>setForm({...form,status:e.target.value}) },
            ['Pending','Confirmed','In Production','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))
          ),
          React.createElement('button', { onClick:add, className:'px-3 py-2 bg-green-600 text-white rounded' }, 'Add')
        )
      ),
      React.createElement('div', { ref: listSectionRef },
        React.createElement(Section, { title:'Client Purchase Orders' },
          React.createElement('div', { className:'mb-3 flex flex-wrap gap-3 items-center' },
            React.createElement('span', { className:'text-sm text-gray-700' }, 'Columns:'),
            [
              ['id','PO ID'],
              ['customer','Customer'],
              ['po_date','PO Date'],
              ['due_date','Due Date'],
              ['delivery','Delivery'],
              ['payment','Payment'],
              ['status','Status'],
              ['notes','Notes']
            ].map(([k,label]) => (
              React.createElement('label', { key:k, className:'text-sm flex items-center gap-1' },
                React.createElement('input', { type:'checkbox', checked: cols[k], onChange:e=>setCols({ ...cols, [k]: e.target.checked }) }), label
              )
            )),
                React.createElement('button', { className:'ml-auto px-3 py-2 bg-gray-700 text-white rounded', onClick:async ()=>{
                  // Gather all line items for all POs
                  const allRows = [];
                  for (const po of localOrders) {
                    let items = [];
                    try {
                      const res = await fetch(`${API_URL}/client-purchase-orders/${po.id}/items`);
                      items = await res.json();
                    } catch {}
                    if (items.length === 0) {
                      allRows.push({
                        'PO ID': po.id,
                        'Customer': po.customer_name,
                        'PO Date': po.po_date,
                        'Due Date': po.due_date,
                        'Status': po.status,
                        'Notes': po.notes,
                        'Product': '',
                        'Description': '',
                        'Quantity': '',
                        'Delivered': '',
                        'Unit Price': '',
                        'Delivery Terms': po.delivery_terms || '',
                        'Payment Terms': po.payment_terms || ''
                      });
                    } else {
                      for (const item of items) {
                        allRows.push({
                          'PO ID': po.id,
                          'Customer': po.customer_name,
                          'PO Date': po.po_date,
                          'Due Date': po.due_date,
                          'Status': po.status,
                          'Notes': po.notes,
                          'Product': item.product_id,
                          'Description': item.product_description,
                          'Quantity': item.quantity,
                          'Delivered': item.delivered,
                          'Unit Price': item.unit_price,
                          'Delivery Terms': po.delivery_terms || '',
                          'Payment Terms': po.payment_terms || ''
                        });
                      }
                    }
                  }
                  const headers = [
                    { key:'PO ID', label:'PO ID' },
                    { key:'Customer', label:'Customer' },
                    { key:'PO Date', label:'PO Date' },
                    { key:'Due Date', label:'Due Date' },
                    { key:'Status', label:'Status' },
                    { key:'Notes', label:'Notes' },
                    { key:'Product', label:'Product' },
                    { key:'Description', label:'Description' },
                    { key:'Quantity', label:'Quantity' },
                    { key:'Delivered', label:'Delivered' },
                    { key:'Unit Price', label:'Unit Price' },
                    { key:'Delivery Terms', label:'Delivery Terms' },
                    { key:'Payment Terms', label:'Payment Terms' }
                  ];
                  downloadCSV('client-pos.csv', headers, allRows);
                }}, 'Export CSV')
              ),
              React.createElement('div', { className:'overflow-x-auto' },
                React.createElement('table', { className:'min-w-full border-collapse' },
                  React.createElement('thead', null,
                    React.createElement('tr', { className:'bg-gray-100' },
                      cols.id && React.createElement('th', { className:'p-2' }, 'PO ID'),
                      cols.customer && React.createElement('th', { className:'p-2' }, 'Customer'),
                      cols.po_date && React.createElement('th', { className:'p-2' }, 'PO Date'),
                      cols.due_date && React.createElement('th', { className:'p-2' }, 'Due Date'),
                      cols.delivery && React.createElement('th', { className:'p-2' }, 'Delivery'),
                      cols.payment && React.createElement('th', { className:'p-2' }, 'Payment'),
                      cols.status && React.createElement('th', { className:'p-2' }, 'Status'),
                      cols.notes && React.createElement('th', { className:'p-2' }, 'Notes'),
                      React.createElement('th', { className:'p-2' }, 'Actions')
                    )
                  ),
                  React.createElement('tbody', null,
                    localOrders.map(po => {
                      const edit = editing === po.id;
                      return [
                        React.createElement('tr', { key:po.id, className:'border-b' },
                          cols.id && React.createElement('td', { className:'p-2 font-mono' }, po.id),
                          cols.customer && React.createElement('td', { className:'p-2' }, po.customer_name),
                          cols.po_date && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { type:'date', className:'border rounded px-2 py-1', defaultValue:po.po_date, onChange:e=>po.po_date=e.target.value }) : po.po_date),
                          cols.due_date && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { type:'date', className:'border rounded px-2 py-1', defaultValue:po.due_date, onChange:e=>po.due_date=e.target.value }) : po.due_date),
                          cols.delivery && React.createElement('td', { className:'p-2' }, po.delivery_terms || ''),
                          cols.payment && React.createElement('td', { className:'p-2' }, po.payment_terms || ''),
                          cols.status && React.createElement('td', { className:'p-2' }, edit ? React.createElement('select', { className:'border rounded px-2 py-1', defaultValue:po.status, onChange:e=>po.status=e.target.value }, ['Pending','Confirmed','In Production','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))) : po.status),
                          cols.notes && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:po.notes, onChange:e=>po.notes=e.target.value }) : (po.notes || '')),
                          React.createElement('td', { className:'p-2 text-right space-x-2' },
                            edit ? React.createElement(React.Fragment, null,
                              React.createElement('button', { onClick:()=>save(po), className:'px-2 py-1 bg-green-600 text-white rounded text-sm' }, 'Save'),
                              React.createElement('button', { onClick:()=>setEditing(null), className:'px-2 py-1 border rounded text-sm' }, 'Cancel')
                            ) : React.createElement(React.Fragment, null,
                              React.createElement('button', { onClick:()=>setEditing(po.id), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'Edit'),
                              React.createElement('button', { onClick:()=>del(po.id), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete'),
                              React.createElement('button', { onClick:()=>window.open(`${API_URL}/client-pos/${po.id}/pdf`, '_blank'), className:'px-2 py-1 border rounded text-sm' }, 'PDF'),
                              React.createElement('button', { onClick:()=>toggleDetails(po), className:'px-2 py-1 border rounded text-sm' }, openDetails[po.id] ? 'Hide Details' : 'View Details')
                            )
                          )
                        ),
                        openDetails[po.id] && React.createElement('tr', { key:po.id+':details', className:'bg-gray-50' },
                          React.createElement('td', { colSpan:8 },
                            React.createElement('div', { className:'p-3' },
                              React.createElement('h4', { className:'font-semibold mb-2' }, 'Line Items & Fulfilment'),
                              (lineItems[po.id] && lineItems[po.id].length > 0) ? (
                                React.createElement('table', { className:'min-w-full border-collapse mb-2' },
                                  React.createElement('thead', null,
                                    React.createElement('tr', { className:'bg-gray-200' },
                                      ['Product','Description','Ordered Qty','Delivered','Remaining','Unit Price','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h))
                                    )
                                  ),
                                  React.createElement('tbody', null,
                                    lineItems[po.id].map(item => (
                                      React.createElement('tr', { key:item.id },
                                        React.createElement('td', { className:'p-2' }, item.product_id),
                                        React.createElement('td', { className:'p-2' }, item.product_description),
                                        React.createElement('td', { className:'p-2 text-right' }, item.quantity),
                                        React.createElement('td', { className:'p-2 text-right' },
                                          fulfilEdit[`${po.id}_${item.id}`] !== undefined ?
                                            React.createElement('input', {
                                              type:'number', min:0, max:item.quantity,
                                              value:fulfilEdit[`${po.id}_${item.id}`],
                                              onChange:e=>setFulfilEdit(prev=>({ ...prev, [`${po.id}_${item.id}`]: e.target.value }))
                                            }) : item.delivered
                                        ),
                                        React.createElement('td', { className:'p-2 text-right' }, item.quantity - item.delivered),
                                        React.createElement('td', { className:'p-2 text-right' }, item.unit_price),
                                        React.createElement('td', { className:'p-2' },
                                          fulfilEdit[`${po.id}_${item.id}`] !== undefined ?
                                            React.createElement(React.Fragment, null,
                                              React.createElement('button', {
                                                className:'px-2 py-1 bg-green-600 text-white rounded text-sm',
                                                onClick:()=>updateDelivered(po.id, item.id, fulfilEdit[`${po.id}_${item.id}`])
                                              }, 'Save'),
                                              React.createElement('button', {
                                                className:'px-2 py-1 border rounded text-sm ml-2',
                                                onClick:()=>setFulfilEdit(prev=>({ ...prev, [`${po.id}_${item.id}`]: undefined }))
                                              }, 'Cancel')
                                            ) :
                                            React.createElement('button', {
                                              className:'px-2 py-1 border rounded text-sm',
                                              onClick:()=>setFulfilEdit(prev=>({ ...prev, [`${po.id}_${item.id}`]: item.delivered }))
                                            }, 'Edit')
                                        )
                                      )
                                    ))
                                  )
                                )
                              ) : React.createElement('div', { className:'text-gray-500' }, 'No line items')
                            )
                          )
                        )
                      ];
                    })
                  )
            )
          )
        )
      )
    )
  );
}

function VendorPurchaseOrders({ purchaseOrders, vendors, onRefresh }){
  const [form, setForm] = useState({ id:'', vendor_id:'', po_date:'', due_date:'', status:'Pending', notes:'' });
  const [editing, setEditing] = useState(null);
  async function add(){ await fetch(`${API_URL}/vendor-purchase-orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }); setForm({ id:'', vendor_id:'', po_date:'', due_date:'', status:'Pending', notes:'' }); onRefresh?.(); }
  async function save(v){ await fetch(`${API_URL}/vendor-purchase-orders/${v.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(v) }); setEditing(null); onRefresh?.(); }
  async function del(id){ if(!confirm('Delete Vendor PO?')) return; await fetch(`${API_URL}/vendor-purchase-orders/${id}`, { method:'DELETE' }); onRefresh?.(); }
  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title: 'Add Vendor PO' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-3' },
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'VPO ID', value: form.id, onChange:e=>setForm({...form,id:e.target.value}) }),
          React.createElement('select', { className:'border rounded px-2 py-1', value: form.vendor_id, onChange:e=>setForm({...form,vendor_id:e.target.value}) },
            React.createElement('option', { value:'' }, 'Select Vendor'),
            vendors.map(v => React.createElement('option', { key:v.id, value:v.id }, `${v.id} - ${v.name}`))
          ),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value: form.po_date, onChange:e=>setForm({...form,po_date:e.target.value}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value: form.due_date, onChange:e=>setForm({...form,due_date:e.target.value}) }),
          React.createElement('select', { className:'border rounded px-2 py-1', value: form.status, onChange:e=>setForm({...form,status:e.target.value}) },
            ['Pending','Ordered','In Transit','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))
          ),
          React.createElement('button', { onClick:add, className:'px-3 py-2 bg-green-600 text-white rounded' }, 'Add')
        )
      ),
      React.createElement(Section, { title: 'Vendor Purchase Orders' },
        React.createElement('div', { className: 'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' }, ['VPO ID','Vendor','PO Date','Due Date','Status','Notes','Actions'].map(h => React.createElement('th', { key:h, className:'p-2' }, h)))
            ),
            React.createElement('tbody', null,
              purchaseOrders.map(vpo => {
                const edit = editing === vpo.id;
                return React.createElement('tr', { key:vpo.id, className:'border-b' },
                  React.createElement('td', { className:'p-2 font-mono' }, vpo.id),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('select', { className:'border rounded px-2 py-1', defaultValue:vpo.vendor_id, onChange:e=>vpo.vendor_id=e.target.value }, vendors.map(v=> React.createElement('option', { key:v.id, value:v.id }, `${v.id} - ${v.name}`))) : vpo.vendor_name ),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { type:'date', className:'border rounded px-2 py-1', defaultValue:vpo.po_date, onChange:e=>vpo.po_date=e.target.value }) : vpo.po_date),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { type:'date', className:'border rounded px-2 py-1', defaultValue:vpo.due_date, onChange:e=>vpo.due_date=e.target.value }) : vpo.due_date),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('select', { className:'border rounded px-2 py-1', defaultValue:vpo.status, onChange:e=>vpo.status=e.target.value }, ['Pending','Ordered','In Transit','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))) : vpo.status),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:vpo.notes, onChange:e=>vpo.notes=e.target.value }) : (vpo.notes || '')),
                  React.createElement('td', { className:'p-2 text-right space-x-2' },
                    edit ? React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>save(vpo), className:'px-2 py-1 bg-green-600 text-white rounded text-sm' }, 'Save'),
                      React.createElement('button', { onClick:()=>setEditing(null), className:'px-2 py-1 border rounded text-sm' }, 'Cancel')
                    ) : React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>setEditing(vpo.id), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'Edit'),
                      React.createElement('button', { onClick:()=>del(vpo.id), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete')
                    )
                  )
                );
              })
            )
          )
        )
      )
    )
  );
}

function Shipments({ shipments }){
  const [cols, setCols] = useState({ id:true, po:true, date:true, bl:true });
  return (
    React.createElement('div', { className: 'bg-white rounded-xl shadow-md p-6 border border-gray-200' },
      React.createElement('h3', { className: 'text-lg font-bold mb-4 text-gray-800' }, 'Shipments'),
      React.createElement('div', { className:'mb-3 flex flex-wrap gap-3 items-center' },
        React.createElement('span', { className:'text-sm text-gray-700' }, 'Columns:'),
        [['id','ID'],['po','PO'],['date','Date'],['bl','BL No.']].map(([k,label]) => (
          React.createElement('label', { key:k, className:'text-sm flex items-center gap-1' },
            React.createElement('input', { type:'checkbox', checked: cols[k], onChange:e=>setCols({ ...cols, [k]: e.target.checked }) }), label
          )
        )),
        React.createElement('button', { className:'ml-auto px-3 py-2 bg-gray-700 text-white rounded', onClick:()=>{
          const headers = [];
          if (cols.id) headers.push({ key:'id', label:'ID' });
          if (cols.po) headers.push({ key:'po_id', label:'PO' });
          if (cols.date) headers.push({ key:'shipment_date', label:'Date' });
          if (cols.bl) headers.push({ key:'bl_number', label:'BL No.' });
          downloadCSV('shipments.csv', headers, shipments);
        }}, 'Export CSV')
      ),
      React.createElement('div', { className: 'overflow-x-auto' },
        React.createElement('table', { className: 'min-w-full border-collapse' },
          React.createElement('thead', null,
            React.createElement('tr', { className: 'bg-gray-100' },
              cols.id && React.createElement('th', { className:'p-2' }, 'ID'),
              cols.po && React.createElement('th', { className:'p-2' }, 'PO'),
              cols.date && React.createElement('th', { className:'p-2' }, 'Date'),
              cols.bl && React.createElement('th', { className:'p-2' }, 'BL No.')
            )
          ),
          React.createElement('tbody', null,
            shipments.map(s => React.createElement('tr', { key: s.id, className: 'border-b' },
              cols.id && React.createElement('td', { className: 'p-2' }, s.id),
              cols.po && React.createElement('td', { className: 'p-2' }, s.po_id),
              cols.date && React.createElement('td', { className: 'p-2' }, s.shipment_date),
              cols.bl && React.createElement('td', { className: 'p-2' }, s.bl_number)
            ))
          )
        )
      )
    )
  );
}

function InventoryView({ inventory }){
  return (
    React.createElement('div', { className: 'bg-white rounded-xl shadow-md p-6 border border-gray-200' },
      React.createElement('h3', { className: 'text-lg font-bold mb-4 text-gray-800' }, 'Inventory'),
      React.createElement('div', { className: 'overflow-x-auto' },
        React.createElement('table', { className: 'min-w-full border-collapse' },
          React.createElement('thead', null,
            React.createElement('tr', { className: 'bg-gray-100' }, ['Product','Plated','Machined','QC','Stamped','Packed','Total'].map(h => React.createElement('th', { key: h, className: 'p-4 font-bold text-center' }, h)))
          ),
          React.createElement('tbody', null,
            inventory.map((item, idx) => {
              const total = item.plated + item.machined + item.qc + item.stamped + item.packed;
              return React.createElement('tr', { key: item.product_id, className: `border-b-2 border-gray-200 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}` },
                React.createElement('td', { className: 'p-4 font-bold text-left' }, item.product_description),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.plated),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.machined),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.qc),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.stamped),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.packed),
                React.createElement('td', { className: 'p-4 font-bold text-center' }, total)
              );
            })
          )
        )
      )
    )
  );
}

// Extended Inventory view: Raw Materials + WIP/Finished
function InventoryViewEx({ inventory, rawMaterials, products, customers, onRefresh, filter, setFilter, rangeMode, setRangeMode }){
  // Controls
  const [invData, setInvData] = useState(inventory);
  const [invCols, setInvCols] = useState({ product:true, plated:true, machined:true, qc:true, stamped:true, packed:true, total:true });
  useEffect(() => { setInvData(inventory); }, [inventory]);
  async function refetch(){
    const params = new URLSearchParams();
    // Date range
    const now = new Date();
    let from = '';
    if (rangeMode.mode === 'lastDays'){
      const d = new Date(now); d.setDate(d.getDate() - (parseInt(rangeMode.days||30, 10))); from = d.toISOString().slice(0,10);
      params.set('from', from); params.set('to', now.toISOString().slice(0,10));
    }
    if (filter.marking) params.set('marking', filter.marking);
    if (filter.product_id) params.set('product_id', filter.product_id);
    const resp = await fetch(`${API_URL}/inventory?${params.toString()}`);
    const data = await resp.json();
    setInvData(data);
  }
  // Simple controls row
  const controls = React.createElement('div', { className:'mb-4 flex flex-wrap gap-3 items-end' },
    React.createElement('div', null,
      React.createElement('label', { className:'text-sm font-semibold block' }, 'Last Days'),
      React.createElement('input', { type:'number', min:1, max:365, value:rangeMode.days, onChange:e=>setRangeMode({ ...rangeMode, days: parseInt(e.target.value||30,10) }), className:'border rounded px-2 py-1 w-24' })
    ),
    React.createElement('div', null,
      React.createElement('label', { className:'text-sm font-semibold block' }, 'Marking (Customer ID)'),
      React.createElement('select', { value:filter.marking, onChange:e=>setFilter({ ...filter, marking: e.target.value }), className:'border rounded px-2 py-1' },
        React.createElement('option', { value:'' }, 'All'),
        customers.map(c => React.createElement('option', { key:c.id, value:c.id }, `${c.id} - ${c.name}`))
      )
    ),
    React.createElement('div', null,
      React.createElement('label', { className:'text-sm font-semibold block' }, 'Product'),
      React.createElement('select', { value:filter.product_id, onChange:e=>setFilter({ ...filter, product_id: e.target.value }), className:'border rounded px-2 py-1' },
        React.createElement('option', { value:'' }, 'All'),
        products.map(p => React.createElement('option', { key:p.id, value:p.id }, `${p.id} - ${p.description}`))
      )
    ),
    React.createElement('button', { onClick: refetch, className:'px-3 py-2 bg-blue-600 text-white rounded' }, 'Apply')
  );
  const [rmForm, setRmForm] = useState({ material:'', current_stock:0, reorder_level:0, last_purchase_date:'' });
  const [editing, setEditing] = useState(null);
  async function add(){ await fetch(`${API_URL}/raw-materials`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rmForm) }); setRmForm({ material:'', current_stock:0, reorder_level:0, last_purchase_date:'' }); onRefresh?.(); }
  async function save(m){ await fetch(`${API_URL}/raw-materials/${encodeURIComponent(m.material)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(m) }); setEditing(null); onRefresh?.(); }
  async function del(name){ if(!confirm('Delete raw material?')) return; await fetch(`${API_URL}/raw-materials/${encodeURIComponent(name)}`, { method:'DELETE' }); onRefresh?.(); }
  return (
    React.createElement('div', { className:'space-y-6' },
      React.createElement(Section, { title:'Raw Materials' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-5 gap-3 mb-3' },
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Material', value:rmForm.material, onChange:e=>setRmForm({...rmForm,material:e.target.value}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Current Stock', value:rmForm.current_stock, onChange:e=>setRmForm({...rmForm,current_stock:Number(e.target.value||0)}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Reorder Level', value:rmForm.reorder_level, onChange:e=>setRmForm({...rmForm,reorder_level:Number(e.target.value||0)}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'date', placeholder:'Last Purchase', value:rmForm.last_purchase_date, onChange:e=>setRmForm({...rmForm,last_purchase_date:e.target.value}) }),
          React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:add }, 'Add')
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' }, ['Material','Current Stock','Reorder Level','Last Purchase','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
            ),
            React.createElement('tbody', null,
              rawMaterials.map(m => {
                const edit = editing === m.material;
                return React.createElement('tr', { key:m.material, className:'border-b' },
                  React.createElement('td', { className:'p-2 font-mono' }, m.material),
                  React.createElement('td', { className:'p-2 text-right' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', defaultValue:m.current_stock, onChange:e=>m.current_stock=Number(e.target.value||0) }) : (m.current_stock||0)),
                  React.createElement('td', { className:'p-2 text-right' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', defaultValue:m.reorder_level, onChange:e=>m.reorder_level=Number(e.target.value||0) }) : (m.reorder_level||0)),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1', type:'date', defaultValue:m.last_purchase_date || '', onChange:e=>m.last_purchase_date=e.target.value }) : (m.last_purchase_date || '')),
                  React.createElement('td', { className:'p-2 text-right space-x-2' },
                    edit ? React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>save(m), className:'px-2 py-1 bg-green-600 text-white rounded text-sm' }, 'Save'),
                      React.createElement('button', { onClick:()=>setEditing(null), className:'px-2 py-1 border rounded text-sm' }, 'Cancel')
                    ) : React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>setEditing(m.material), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'Edit'),
                      React.createElement('button', { onClick:()=>del(m.material), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete')
                    )
                  )
                );
              })
            )
          )
        )
      ),
      React.createElement(Section, { title:'WIP & Finished Copper Bonded Ground Rods' },
        controls,
        React.createElement('div', { className:'mb-3 flex flex-wrap gap-3 items-center' },
          React.createElement('span', { className:'text-sm text-gray-700' }, 'Columns:'),
          ['product','plated','machined','qc','stamped','packed','total'].map(c => (
            React.createElement('label', { key:c, className:'text-sm flex items-center gap-1' },
              React.createElement('input', { type:'checkbox', checked: (invCols||{})[c] === undefined ? true : invCols[c], onChange:e=>setInvCols({ ...(invCols||{}), [c]: e.target.checked }) }), c.charAt(0).toUpperCase()+c.slice(1)
            )
          )),
          React.createElement('button', { onClick: ()=>{
              const headers = [];
              const cols = invCols || {};
              if (cols.product) headers.push({ key:'product_description', label:'Product' });
              if (cols.plated) headers.push({ key:'plated', label:'Plated' });
              if (cols.machined) headers.push({ key:'machined', label:'Machined' });
              if (cols.qc) headers.push({ key:'qc', label:'QC' });
              if (cols.stamped) headers.push({ key:'stamped', label:'Stamped' });
              if (cols.packed) headers.push({ key:'packed', label:'Packed' });
              if (cols.total) headers.push({ key:'total', label:'Total' });
              const rows = (invData||[]).map(r => ({
                product_description: r.product_description,
                plated: r.plated||0,
                machined: r.machined||0,
                qc: r.qc||0,
                stamped: r.stamped||0,
                packed: r.packed||0,
                total: (r.plated||0)+(r.machined||0)+(r.qc||0)+(r.stamped||0)+(r.packed||0)
              }));
              downloadCSV('inventory.csv', headers, rows);
            }, className:'ml-auto px-3 py-2 bg-gray-700 text-white rounded' }, 'Export CSV')
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' },
                (invCols||{}).product !== false && React.createElement('th', { className:'p-2 text-left' }, 'Product'),
                (invCols||{}).plated !== false && React.createElement('th', { className:'p-2 text-center' }, 'Plated'),
                (invCols||{}).machined !== false && React.createElement('th', { className:'p-2 text-center' }, 'Machined'),
                (invCols||{}).qc !== false && React.createElement('th', { className:'p-2 text-center' }, 'QC'),
                (invCols||{}).stamped !== false && React.createElement('th', { className:'p-2 text-center' }, 'Stamped'),
                (invCols||{}).packed !== false && React.createElement('th', { className:'p-2 text-center' }, 'Packed'),
                (invCols||{}).total !== false && React.createElement('th', { className:'p-2 text-center' }, 'Total')
              )
            ),
            React.createElement('tbody', null,
              (invData||[]).map((r, i) => {
                const total = (r.plated||0)+(r.machined||0)+(r.qc||0)+(r.stamped||0)+(r.packed||0);
                return React.createElement('tr', { key:r.product_id||i, className:'border-b' },
                  (invCols||{}).product !== false && React.createElement('td', { className:'p-2' }, r.product_description),
                  (invCols||{}).plated !== false && React.createElement('td', { className:'p-2 text-center' }, r.plated||0),
                  (invCols||{}).machined !== false && React.createElement('td', { className:'p-2 text-center' }, r.machined||0),
                  (invCols||{}).qc !== false && React.createElement('td', { className:'p-2 text-center' }, r.qc||0),
                  (invCols||{}).stamped !== false && React.createElement('td', { className:'p-2 text-center' }, r.stamped||0),
                  (invCols||{}).packed !== false && React.createElement('td', { className:'p-2 text-center' }, r.packed||0),
                  (invCols||{}).total !== false && React.createElement('td', { className:'p-2 text-center' }, total)
                );
              })
            )
          )
        )
      )
    )
  );
}

function Section({ title, children }){
  const [open, setOpen] = useState(true);
  return React.createElement('div', { className: 'bg-white rounded-xl shadow-md p-6 border border-gray-200' },
    React.createElement('div', { className: 'flex justify-between items-center mb-4' },
      React.createElement('h3', { className: 'text-lg font-bold text-gray-800' }, title),
      React.createElement('button', { onClick: () => setOpen(!open), className: 'px-3 py-1 text-sm rounded border' }, open ? 'Hide' : 'Show')
    ),
    open && children
  );
}

function ProductMaster({ products, calculateWeights, onRefresh }){
  const [form, setForm] = useState({ id:'', description:'', diameter:0, length:0, coating:0 });
  const [editingId, setEditingId] = useState(null);
  const [cols, setCols] = useState({ id:true, description:true, diameter:true, length:true, coating:true });
  function update(k,v){ setForm({ ...form, [k]: v }) }
  async function add(){ await fetch(`${API_URL}/products`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...form, diameter:Number(form.diameter), length:Number(form.length), coating:Number(form.coating) }) }); setForm({ id:'', description:'', diameter:0, length:0, coating:0 }); onRefresh?.(); }
  async function save(p){ await fetch(`${API_URL}/products/${p.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(p) }); setEditingId(null); onRefresh?.(); }
  async function del(id){ if(!confirm('Delete product?')) return; await fetch(`${API_URL}/products/${id}`, { method:'DELETE' }); onRefresh?.(); }
  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title: 'Add Product' },
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-6 gap-3' },
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'ID', value: form.id, onChange: e=>update('id',e.target.value) }),
          React.createElement('input', { className: 'border rounded px-2 py-1 md:col-span-2', placeholder: 'Description', value: form.description, onChange: e=>update('description',e.target.value) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', type: 'number', placeholder: 'Diameter (mm)', value: form.diameter, onChange: e=>update('diameter',e.target.value) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', type: 'number', placeholder: 'Length (mm)', value: form.length, onChange: e=>update('length',e.target.value) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', type: 'number', placeholder: 'Coating (µm)', value: form.coating, onChange: e=>update('coating',e.target.value) }),
          React.createElement('button', { onClick: add, className: 'px-3 py-2 bg-green-600 text-white rounded' }, 'Add')
        )
      ),
      React.createElement(Section, { title: 'Products' },
        React.createElement('div', { className: 'flex items-center gap-3 mb-3' },
          React.createElement('span', { className: 'text-sm text-gray-700' }, 'Columns:'),
          ['id','description','diameter','length','coating'].map(c => (
            React.createElement('label', { key:c, className:'text-sm flex items-center gap-1' },
              React.createElement('input', { type:'checkbox', checked: cols[c], onChange: e=>setCols({ ...cols, [c]: e.target.checked }) }), c
            )
          ))
        ),
        React.createElement('div', { className: 'overflow-x-auto' },
          React.createElement('table', { className: 'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' },
                cols.id && React.createElement('th', { className:'p-2 text-left' }, 'ID'),
                cols.description && React.createElement('th', { className:'p-2 text-left' }, 'Description'),
                cols.diameter && React.createElement('th', { className:'p-2 text-center' }, 'Dia (mm)'),
                cols.length && React.createElement('th', { className:'p-2 text-center' }, 'Length (mm)'),
                cols.coating && React.createElement('th', { className:'p-2 text-center' }, 'Coating (µm)'),
                React.createElement('th', { className:'p-2 text-right' }, 'Actions')
              )
            ),
            React.createElement('tbody', null,
              products.map(p => {
                const edit = editingId === p.id; const w = calculateWeights(p.diameter, p.coating, p.length);
                return React.createElement('tr', { key:p.id, className:'border-b' },
                  cols.id && React.createElement('td', { className:'p-2 font-mono' }, p.id),
                  cols.description && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:p.description, onChange: e=>p.description=e.target.value }) : `${p.description}`),
                  cols.diameter && React.createElement('td', { className:'p-2 text-center' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', defaultValue:p.diameter, onChange: e=>p.diameter=Number(e.target.value) }) : p.diameter),
                  cols.length && React.createElement('td', { className:'p-2 text-center' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', defaultValue:p.length, onChange: e=>p.length=Number(e.target.value) }) : p.length),
                  cols.coating && React.createElement('td', { className:'p-2 text-center' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', defaultValue:p.coating, onChange: e=>p.coating=Number(e.target.value) }) : p.coating),
                  React.createElement('td', { className:'p-2 text-right space-x-2' },
                    edit
                      ? React.createElement(React.Fragment, null,
                          React.createElement('button', { onClick: ()=>save(p), className:'px-2 py-1 bg-green-600 text-white rounded text-sm' }, 'Save'),
                          React.createElement('button', { onClick: ()=>setEditingId(null), className:'px-2 py-1 border rounded text-sm' }, 'Cancel')
                        )
                      : React.createElement(React.Fragment, null,
                          React.createElement('button', { onClick: ()=>setEditingId(p.id), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'Edit'),
                          React.createElement('button', { onClick: ()=>del(p.id), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete')
                        ),
                    React.createElement('div', { className:'text-xs text-gray-500 mt-1' }, `Steel ${w.steel}kg, Copper ${w.copper}kg`)
                  )
                )
              })
            )
          )
        )
      )
    )
  );
}

function CustomerManagementEx({ customers, onRefresh }){
  const [form, setForm] = useState({ id:'', name:'', office_address:'', warehouse_address:'', contact_person:'', phone:'', email:'' });
  const [editing, setEditing] = useState(null);
  async function add(){ await fetch(`${API_URL}/customers`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }); setForm({ id:'', name:'', office_address:'', warehouse_address:'', contact_person:'', phone:'', email:'' }); onRefresh?.(); }
  async function save(c){ await fetch(`${API_URL}/customers/${c.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(c) }); setEditing(null); onRefresh?.(); }
  async function del(id){ if(!confirm('Delete customer?')) return; await fetch(`${API_URL}/customers/${id}`, { method:'DELETE' }); onRefresh?.(); }
  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title: 'Add Customer' },
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-3 gap-3' },
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'ID', value: form.id, onChange: e=>setForm({...form,id:e.target.value}) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'Name', value: form.name, onChange: e=>setForm({...form,name:e.target.value}) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'Contact Person', value: form.contact_person, onChange: e=>setForm({...form,contact_person:e.target.value}) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'Phone', value: form.phone, onChange: e=>setForm({...form,phone:e.target.value}) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'Email', value: form.email, onChange: e=>setForm({...form,email:e.target.value}) }),
          React.createElement('input', { className: 'border rounded px-2 py-1 md:col-span-3', placeholder: 'Office Address', value: form.office_address, onChange: e=>setForm({...form,office_address:e.target.value}) }),
          React.createElement('input', { className: 'border rounded px-2 py-1 md:col-span-3', placeholder: 'Warehouse Address', value: form.warehouse_address, onChange: e=>setForm({...form,warehouse_address:e.target.value}) }),
          React.createElement('button', { onClick: add, className: 'px-3 py-2 bg-green-600 text-white rounded' }, 'Add')
        )
      ),
      React.createElement(Section, { title: 'Customers' },
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' }, ['ID','Name','Contact','Phone','Email','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
            ),
            React.createElement('tbody', null,
              customers.map(c => {
                const edit = editing === c.id;
                return React.createElement('tr', { key:c.id, className:'border-b' },
                  React.createElement('td', { className:'p-2 font-mono' }, c.id),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:c.name, onChange:e=>c.name=e.target.value }) : c.name),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:c.contact_person, onChange:e=>c.contact_person=e.target.value }) : c.contact_person),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1', defaultValue:c.phone, onChange:e=>c.phone=e.target.value }) : c.phone),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1', defaultValue:c.email, onChange:e=>c.email=e.target.value }) : c.email),
                  React.createElement('td', { className:'p-2 text-right space-x-2' },
                    edit ? React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>save(c), className:'px-2 py-1 bg-green-600 text-white rounded text-sm' }, 'Save'),
                      React.createElement('button', { onClick:()=>setEditing(null), className:'px-2 py-1 border rounded text-sm' }, 'Cancel')
                    ) : React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>setEditing(c.id), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'Edit'),
                      React.createElement('button', { onClick:()=>del(c.id), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete')
                    )
                  )
                );
              })
            )
          )
        )
      )
    )
  );
}

function VendorManagement({ vendors, onRefresh }){
  const [form, setForm] = useState({ id:'', name:'', contact_person:'', phone:'', email:'' });
  const [editing, setEditing] = useState(null);
  async function add(){ await fetch(`${API_URL}/vendors`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }); setForm({ id:'', name:'', contact_person:'', phone:'', email:'' }); onRefresh?.(); }
  async function save(v){ await fetch(`${API_URL}/vendors/${v.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(v) }); setEditing(null); onRefresh?.(); }
  async function del(id){ if(!confirm('Delete vendor?')) return; await fetch(`${API_URL}/vendors/${id}`, { method:'DELETE' }); onRefresh?.(); }
  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title: 'Add Vendor' },
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-5 gap-3' },
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'ID', value: form.id, onChange: e=>setForm({...form,id:e.target.value}) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'Name', value: form.name, onChange: e=>setForm({...form,name:e.target.value}) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'Contact Person', value: form.contact_person, onChange: e=>setForm({...form,contact_person:e.target.value}) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'Phone', value: form.phone, onChange: e=>setForm({...form,phone:e.target.value}) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', placeholder: 'Email', value: form.email, onChange: e=>setForm({...form,email:e.target.value}) }),
          React.createElement('button', { onClick: add, className: 'px-3 py-2 bg-green-600 text-white rounded' }, 'Add')
        )
      ),
      React.createElement(Section, { title: 'Vendors' },
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' }, ['ID','Name','Contact','Phone','Email','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
            ),
            React.createElement('tbody', null,
              vendors.map(v => {
                const edit = editing === v.id;
                return React.createElement('tr', { key:v.id, className:'border-b' },
                  React.createElement('td', { className:'p-2 font-mono' }, v.id),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:v.name, onChange:e=>v.name=e.target.value }) : v.name),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:v.contact_person, onChange:e=>v.contact_person=e.target.value }) : v.contact_person),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1', defaultValue:v.phone, onChange:e=>v.phone=e.target.value }) : v.phone),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1', defaultValue:v.email, onChange:e=>v.email=e.target.value }) : v.email),
                  React.createElement('td', { className:'p-2 text-right space-x-2' },
                    edit ? React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>save(v), className:'px-2 py-1 bg-green-600 text-white rounded text-sm' }, 'Save'),
                      React.createElement('button', { onClick:()=>setEditing(null), className:'px-2 py-1 border rounded text-sm' }, 'Cancel')
                    ) : React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>setEditing(v.id), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'Edit'),
                      React.createElement('button', { onClick:()=>del(v.id), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete')
                    )
                  )
                );
              })
            )
          )
        )
      )
    )
  );
}

// Assistant chat panel
function AssistantPanel(){
  const [messages, setMessages] = useState([{ role:'system', content:'You are the Ground Rod ERP assistant.' }]);
  const [input, setInput] = useState('');
  async function send(){
    const msgs = [...messages, { role:'user', content: input }];
    setMessages(msgs); setInput('');
    const resp = await fetch(`${API_URL}/ai/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ messages: msgs }) });
    const data = await resp.json();
    setMessages([...msgs, { role:'assistant', content: data.reply }]);
  }
  return (
    React.createElement('div', { className:'bg-white rounded-xl shadow-md p-6 border border-gray-200 max-w-3xl' },
      React.createElement('h3', { className:'text-lg font-bold mb-4 text-gray-800' }, 'Assistant'),
      React.createElement('div', { className:'h-64 overflow-y-auto border rounded p-3 mb-3 bg-gray-50' },
        messages.filter(m=>m.role!=='system').map((m,i)=> (
          React.createElement('div', { key:i, className: m.role==='user' ? 'text-right' : '' },
            React.createElement('div', { className: 'inline-block px-3 py-2 rounded mb-2 ' + (m.role==='user'?'bg-blue-600 text-white':'bg-gray-200') }, m.content)
          )
        ))
      ),
      React.createElement('div', { className:'flex gap-2' },
        React.createElement('input', { className:'flex-1 border rounded px-3 py-2', value:input, onChange:e=>setInput(e.target.value), placeholder:'Ask about WIP, customers, etc.' }),
        React.createElement('button', { onClick:send, className:'px-4 py-2 bg-blue-600 text-white rounded' }, 'Send')
      ),
      React.createElement('p', { className:'text-xs text-gray-500 mt-2' }, 'Note: This is a local assistant with basic knowledge. For full AI responses, connect an LLM API server-side with your API key.')
    )
  );
}

// Imports panel for PDF -> PO preview & confirm
function ImportsPanel({ customers, vendors, products }){
  const [clientPreview, setClientPreview] = useState(null);
  const [clientItems, setClientItems] = useState([]);
  const [useNewCustomer, setUseNewCustomer] = useState(false);
  const [vendorPreview, setVendorPreview] = useState(null);
  async function uploadClient(e){
    const f = e.target.files[0]; if(!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch(`${API_URL}/import/client-po/preview`, { method:'POST', body: fd });
    const data = await r.json();
    setClientPreview({ po: { currency:'INR', status:'Pending', notes:'', marking:'', ...(data.po||{}) }, text: data.text||'', file_token: data.file_token||'' });
    setClientItems([]);
  }
  async function uploadVendor(e){
    const f = e.target.files[0]; if(!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch(`${API_URL}/import/vendor-po/preview`, { method:'POST', body: fd });
    setVendorPreview(await r.json());
  }
  function updateClientPo(field, val){
    setClientPreview(prev => ({ ...(prev||{}), po: { ...((prev&&prev.po)||{}), [field]: val } }));
  }
  function addClientItem(){ setClientItems([...clientItems, { product_id:'', quantity:0, unit_price:0, unit:'pcs' }]); }
  function updateClientItem(i, k, v){ const arr=[...clientItems]; arr[i][k] = (k==='product_id'||k==='unit')? v : Number(v||0); setClientItems(arr); }
  function removeClientItem(i){ const arr=[...clientItems]; arr.splice(i,1); setClientItems(arr); }
  async function confirmClient(){
    const po = (clientPreview&&clientPreview.po) || {};
    const payload = {
      id: po.id,
      customer_id: useNewCustomer ? '' : po.customer_id || '',
      customer_name: useNewCustomer ? (po.customer_name||'') : '',
      po_date: po.po_date,
      due_date: po.due_date,
      currency: po.currency || 'INR',
      status: po.status || 'Pending',
      notes: po.notes || '',
      marking: po.marking || '',
      items: clientItems,
      file_token: clientPreview.file_token || ''
    };
    const r = await fetch(`${API_URL}/import/client-po/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const res = await r.json();
    if(!r.ok){ alert(res.error||'Failed to register'); return; }
    alert(res.message||'Registered');
  }
  async function confirmVendor(){
    const vpo = vendorPreview?.vpo || {}; const body = JSON.stringify(vpo);
    const r = await fetch(`${API_URL}/import/vendor-po/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body });
    alert((await r.json()).message||'OK');
  }
  return (
    React.createElement('div', { className:'space-y-6' },
      React.createElement(Section, { title:'Import Client PO (PDF)' },
        React.createElement('input', { type:'file', accept:'application/pdf', onChange:uploadClient }),
        clientPreview && React.createElement('div', { className:'mt-3 space-y-4' },
          React.createElement('div', { className:'text-sm text-gray-700 mb-2' }, 'Preview (editable before confirm):'),
          React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-3 gap-3' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'PO ID'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'PO-1001', value:clientPreview.po?.id||'', onChange:e=>updateClientPo('id', e.target.value) }),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Customer'),
            React.createElement('div', { className:'md:col-span-2 flex gap-2 items-center' },
              React.createElement('select', { className:'border rounded px-2 py-1', value: useNewCustomer ? '' : (clientPreview.po?.customer_id||''), onChange:e=>{ setUseNewCustomer(false); updateClientPo('customer_id', e.target.value) } },
                React.createElement('option', { value:'' }, '-- Select existing --'),
                customers.map(c=> React.createElement('option', { key:c.id, value:c.id }, `${c.id} - ${c.name}`))
              ),
              React.createElement('span', { className:'text-xs text-gray-500' }, 'or'),
              React.createElement('input', { className:'border rounded px-2 py-1 flex-1', placeholder:'New customer name', value: useNewCustomer ? (clientPreview.po?.customer_name||'') : '', onChange:e=>{ setUseNewCustomer(true); updateClientPo('customer_name', e.target.value); updateClientPo('customer_id','') } })
            ),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'PO Date'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', type:'date', value:clientPreview.po?.po_date||'', onChange:e=>updateClientPo('po_date', e.target.value) }),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Due Date'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', type:'date', value:clientPreview.po?.due_date||'', onChange:e=>updateClientPo('due_date', e.target.value) }),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Currency'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'INR', value:clientPreview.po?.currency||'INR', onChange:e=>updateClientPo('currency', e.target.value) }),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Status'),
            React.createElement('select', { className:'border rounded px-2 py-1 md:col-span-2', value:clientPreview.po?.status||'Pending', onChange:e=>updateClientPo('status', e.target.value) },
              ['Pending','Confirmed','In Production','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))
            ),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Notes'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Optional notes', value:clientPreview.po?.notes||'', onChange:e=>updateClientPo('notes', e.target.value) })
          ),

          React.createElement('div', { className:'pt-2 border-t' },
            React.createElement('div', { className:'flex justify-between items-center mb-2' },
              React.createElement('h4', { className:'font-semibold' }, 'Line Items (optional)'),
              React.createElement('button', { className:'px-3 py-1 bg-blue-600 text-white rounded text-sm', onClick:addClientItem }, 'Add Item')
            ),
            React.createElement('div', { className:'overflow-x-auto' },
              React.createElement('table', { className:'min-w-full border-collapse' },
                React.createElement('thead', null,
                  React.createElement('tr', { className:'bg-gray-100' }, ['Product','New Product?','New Product ID','Description','Steel Dia','Dia Unit','Length','Len Unit','Coating (µm)','Qty','Unit Price','Unit','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
                ),
                React.createElement('tbody', null,
                  clientItems.map((it, i) => (
                    React.createElement('tr', { key:i, className:'border-b' },
                      React.createElement('td', { className:'p-2' },
                        React.createElement('select', { className:'border rounded px-2 py-1', value:it.product_id||'', onChange:e=>updateClientItem(i,'product_id', e.target.value) },
                          React.createElement('option', { value:'' }, '-- Select --'),
                          products.map(p => React.createElement('option', { key:p.id, value:p.id }, `${p.id} - ${p.description}`))
                        )
                      ),
                      React.createElement('td', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked:it.new_product||false, onChange:e=>updateClientItem(i,'new_product', e.target.checked) })),
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-32', placeholder:'Optional', value:it.new_product_id||'', onChange:e=>updateClientItem(i,'new_product_id', e.target.value) })),
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Description', value:it.description||'', onChange:e=>updateClientItem(i,'description', e.target.value) })),
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-24', type:'number', placeholder:'Dia', value:it.diameter_value||'', onChange:e=>updateClientItem(i,'diameter_value', e.target.value) })),
                      React.createElement('td', { className:'p-2' }, React.createElement('select', { className:'border rounded px-2 py-1', value:it.diameter_unit||'mm', onChange:e=>updateClientItem(i,'diameter_unit', e.target.value) }, ['mm','in'].map(u=> React.createElement('option', { key:u, value:u }, u)))),
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-24', type:'number', placeholder:'Length', value:it.length_value||'', onChange:e=>updateClientItem(i,'length_value', e.target.value) })),
                      React.createElement('td', { className:'p-2' }, React.createElement('select', { className:'border rounded px-2 py-1', value:it.length_unit||'mm', onChange:e=>updateClientItem(i,'length_unit', e.target.value) }, ['mm','in','ft'].map(u=> React.createElement('option', { key:u, value:u }, u)))),
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-24', type:'number', placeholder:'µm', value:it.coating_um||'', onChange:e=>updateClientItem(i,'coating_um', e.target.value) })),
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24', value:it.quantity, onChange:e=>updateClientItem(i,'quantity', e.target.value) })),
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24', value:it.unit_price, onChange:e=>updateClientItem(i,'unit_price', e.target.value) })),
                      React.createElement('td', { className:'p-2' }, React.createElement('select', { className:'border rounded px-2 py-1', value:it.unit||'pcs', onChange:e=>updateClientItem(i,'unit', e.target.value) }, ['pcs','kg','litre'].map(u=> React.createElement('option', { key:u, value:u }, u)))) ,
                      React.createElement('td', { className:'p-2 text-right' }, React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>removeClientItem(i) }, 'Remove'))
                    )
                  ))
                )
              )
            )
          ),

          React.createElement('div', { className:'mt-3 flex gap-2' },
            React.createElement('button', { onClick:()=>confirmClient(), className:'px-3 py-2 bg-green-600 text-white rounded' }, 'Confirm & Register'),
            React.createElement('details', null,
              React.createElement('summary', null, 'Raw Text'),
              React.createElement('pre', { className:'mt-2 p-2 border rounded bg-gray-50 whitespace-pre-wrap' }, clientPreview.text || '(no text)')
            )
          )
        )
      ),
      React.createElement(Section, { title:'Import Vendor PO (PDF)' },
        React.createElement('input', { type:'file', accept:'application/pdf', onChange:uploadVendor }),
        vendorPreview && React.createElement('div', { className:'mt-3 space-y-4' },
          React.createElement('div', { className:'text-sm text-gray-700 mb-2' }, 'Preview (editable before confirm):'),
          React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-3 gap-3' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'VPO ID'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'VPO-1001', defaultValue:vendorPreview.vpo?.id||'', onChange:e=>vendorPreview.vpo.id=e.target.value }),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Vendor'),
            React.createElement('div', { className:'md:col-span-2 flex gap-2 items-center' },
              React.createElement('select', { className:'border rounded px-2 py-1', defaultValue:vendorPreview.vpo?.vendor_id||'', onChange:e=>vendorPreview.vpo.vendor_id=e.target.value },
                React.createElement('option', { value:'' }, '-- Select existing --'),
                vendors.map(v=> React.createElement('option', { key:v.id, value:v.id }, `${v.id} - ${v.name}`))
              ),
              React.createElement('span', { className:'text-xs text-gray-500' }, 'or'),
              React.createElement('input', { className:'border rounded px-2 py-1 flex-1', placeholder:'New vendor name', onChange:e=>{ vendorPreview.vpo.vendor_name = e.target.value; vendorPreview.vpo.vendor_id=''; setVendorPreview({ ...vendorPreview }); } })
            ),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Contact Person'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Optional', onChange:e=>{ vendorPreview.vpo.contact_person = e.target.value; setVendorPreview({ ...vendorPreview }); } }),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Phone'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'+1-555-0100', onChange:e=>{ vendorPreview.vpo.phone = e.target.value; setVendorPreview({ ...vendorPreview }); } }),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Email'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'vendor@example.com', onChange:e=>{ vendorPreview.vpo.email = e.target.value; setVendorPreview({ ...vendorPreview }); } }),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'PO Date'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', type:'date', defaultValue:vendorPreview.vpo?.po_date||'' , onChange:e=>{ vendorPreview.vpo.po_date=e.target.value; setVendorPreview({ ...vendorPreview }); } }),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Due Date'),
            React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', type:'date', defaultValue:vendorPreview.vpo?.due_date||'' , onChange:e=>{ vendorPreview.vpo.due_date=e.target.value; setVendorPreview({ ...vendorPreview }); } })
          ),

          React.createElement('div', { className:'mt-3 flex gap-2' },
            React.createElement('button', { onClick:async ()=>{
              const vpo = vendorPreview.vpo || {};
              const payload = { id:vpo.id, vendor_id:vpo.vendor_id||'', vendor_name:vpo.vendor_name||'', contact_person:vpo.contact_person||'', phone:vpo.phone||'', email:vpo.email||'', po_date:vpo.po_date, due_date:vpo.due_date, status:'Pending', notes:'', items: [], file_token: vendorPreview.file_token||'' };
              const r = await fetch(`${API_URL}/import/vendor-po/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
              const res = await r.json();
              if(!r.ok){ alert(res.error||'Failed'); return; }
              alert(res.message||'Registered');
            }, className:'px-3 py-2 bg-green-600 text-white rounded' }, 'Confirm & Register'),
          React.createElement('details', null,
            React.createElement('summary', null, 'Raw Text'),
            React.createElement('pre', { className:'mt-2 p-2 border rounded bg-gray-50 whitespace-pre-wrap' }, vendorPreview.text || '(no text)')
          )
        )
        )
      )
    )
  );
}
// Extended Vendor Purchase Orders with line items (item, description, qty, unit)
function VendorPurchaseOrdersEx({ purchaseOrders, vendors, onRefresh }){
  const [form, setForm] = useState({ id:'', vendor_id:'', po_date:'', due_date:'', status:'Pending', notes:'' });
  const [editing, setEditing] = useState(null);
  const [openItems, setOpenItems] = useState({});
  const [itemsCache, setItemsCache] = useState({});
  const [newItem, setNewItem] = useState({ item:'', description:'', qty:0, unit:'kg' });
  const [cols, setCols] = useState({ id:true, vendor:true, po_date:true, due_date:true, status:true, notes:true });
  async function add(){ await fetch(`${API_URL}/vendor-purchase-orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }); setForm({ id:'', vendor_id:'', po_date:'', due_date:'', status:'Pending', notes:'' }); onRefresh?.(); }
  async function save(v){ await fetch(`${API_URL}/vendor-purchase-orders/${v.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(v) }); setEditing(null); onRefresh?.(); }
  async function del(id){ if(!confirm('Delete Vendor PO?')) return; await fetch(`${API_URL}/vendor-purchase-orders/${id}`, { method:'DELETE' }); onRefresh?.(); }
  async function toggleItems(vpo){
    const opened = !!openItems[vpo.id];
    setOpenItems({ ...openItems, [vpo.id]: !opened });
    if (!opened && !itemsCache[vpo.id]){
      const res = await fetch(`${API_URL}/vendor-purchase-orders/${vpo.id}/items`);
      const data = await res.json();
      setItemsCache({ ...itemsCache, [vpo.id]: data });
    }
  }
  async function addItem(vpo){
    const res = await fetch(`${API_URL}/vendor-purchase-orders/${vpo.id}/items`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(newItem) });
    if (res.ok){
      const idata = await (await fetch(`${API_URL}/vendor-purchase-orders/${vpo.id}/items`)).json();
      setItemsCache({ ...itemsCache, [vpo.id]: idata });
      setNewItem({ item:'', description:'', qty:0, unit:'kg' });
    }
  }
  async function updateItem(vpoId, item){
    await fetch(`${API_URL}/vendor-purchase-orders/${vpoId}/items/${item.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(item) });
  }
  async function deleteItem(vpoId, itemId){
    await fetch(`${API_URL}/vendor-purchase-orders/${vpoId}/items/${itemId}`, { method:'DELETE' });
    const idata = await (await fetch(`${API_URL}/vendor-purchase-orders/${vpoId}/items`)).json();
    setItemsCache({ ...itemsCache, [vpoId]: idata });
  }
  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title: 'Add Vendor PO' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-3' },
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'VPO ID', value: form.id, onChange:e=>setForm({...form,id:e.target.value}) }),
          React.createElement('select', { className:'border rounded px-2 py-1', value: form.vendor_id, onChange:e=>setForm({...form,vendor_id:e.target.value}) },
            React.createElement('option', { value:'' }, 'Select Vendor'),
            vendors.map(v => React.createElement('option', { key:v.id, value:v.id }, `${v.id} - ${v.name}`))
          ),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value: form.po_date, onChange:e=>setForm({...form,po_date:e.target.value}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value: form.due_date, onChange:e=>setForm({...form,due_date:e.target.value}) }),
          React.createElement('select', { className:'border rounded px-2 py-1', value: form.status, onChange:e=>setForm({...form,status:e.target.value}) },
            ['Pending','Ordered','In Transit','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))
          ),
          React.createElement('button', { onClick:add, className:'px-3 py-2 bg-green-600 text-white rounded' }, 'Add')
        )
      ),
      React.createElement(Section, { title: 'Vendor Purchase Orders' },
        React.createElement('div', { className:'mb-3 flex flex-wrap gap-3 items-center' },
          React.createElement('span', { className:'text-sm text-gray-700' }, 'Columns:'),
          [['id','VPO ID'],['vendor','Vendor'],['po_date','PO Date'],['due_date','Due Date'],['status','Status'],['notes','Notes']].map(([k,label]) => (
            React.createElement('label', { key:k, className:'text-sm flex items-center gap-1' },
              React.createElement('input', { type:'checkbox', checked: cols[k], onChange:e=>setCols({ ...cols, [k]: e.target.checked }) }), label
            )
          )),
          React.createElement('button', { className:'ml-auto px-3 py-2 bg-gray-700 text-white rounded', onClick:()=>{
            const headers = [];
            if (cols.id) headers.push({ key:'id', label:'VPO ID' });
            if (cols.vendor) headers.push({ key:'vendor_name', label:'Vendor' });
            if (cols.po_date) headers.push({ key:'po_date', label:'PO Date' });
            if (cols.due_date) headers.push({ key:'due_date', label:'Due Date' });
            if (cols.status) headers.push({ key:'status', label:'Status' });
            if (cols.notes) headers.push({ key:'notes', label:'Notes' });
            downloadCSV('vendor-pos.csv', headers, purchaseOrders);
          }}, 'Export CSV')
        ),
        React.createElement('div', { className: 'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' },
                cols.id && React.createElement('th', { className:'p-2' }, 'VPO ID'),
                cols.vendor && React.createElement('th', { className:'p-2' }, 'Vendor'),
                cols.po_date && React.createElement('th', { className:'p-2' }, 'PO Date'),
                cols.due_date && React.createElement('th', { className:'p-2' }, 'Due Date'),
                cols.status && React.createElement('th', { className:'p-2' }, 'Status'),
                cols.notes && React.createElement('th', { className:'p-2' }, 'Notes'),
                React.createElement('th', { className:'p-2' }, 'Actions')
              )
            ),
            React.createElement('tbody', null,
              purchaseOrders.map(vpo => {
                const edit = editing === vpo.id;
                return React.createElement('tr', { key:vpo.id, className:'border-b' },
                  cols.id && React.createElement('td', { className:'p-2 font-mono' }, vpo.id),
                  cols.vendor && React.createElement('td', { className:'p-2' }, edit ? React.createElement('select', { className:'border rounded px-2 py-1', defaultValue:vpo.vendor_id, onChange:e=>vpo.vendor_id=e.target.value }, vendors.map(v=> React.createElement('option', { key:v.id, value:v.id }, `${v.id} - ${v.name}`))) : vpo.vendor_name ),
                  cols.po_date && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { type:'date', className:'border rounded px-2 py-1', defaultValue:vpo.po_date, onChange:e=>vpo.po_date=e.target.value }) : vpo.po_date),
                  cols.due_date && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { type:'date', className:'border rounded px-2 py-1', defaultValue:vpo.due_date, onChange:e=>vpo.due_date=e.target.value }) : vpo.due_date),
                  cols.status && React.createElement('td', { className:'p-2' }, edit ? React.createElement('select', { className:'border rounded px-2 py-1', defaultValue:vpo.status, onChange:e=>vpo.status=e.target.value }, ['Pending','Ordered','In Transit','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))) : vpo.status),
                  cols.notes && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:vpo.notes, onChange:e=>vpo.notes=e.target.value }) : (vpo.notes || '')),
                  React.createElement('td', { className:'p-2 text-right space-x-2' },
                    edit ? React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>save(vpo), className:'px-2 py-1 bg-green-600 text-white rounded text-sm' }, 'Save'),
                      React.createElement('button', { onClick:()=>setEditing(null), className:'px-2 py-1 border rounded text-sm' }, 'Cancel')
                    ) : React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>setEditing(vpo.id), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'Edit'),
                      React.createElement('button', { onClick:()=>toggleItems(vpo), className:'px-2 py-1 border rounded text-sm' }, openItems[vpo.id] ? 'Hide Items' : 'Items'),
                      React.createElement('button', { onClick:()=>del(vpo.id), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete')
                    )
                  )
                );
              })
            )
          )
        ),
        Object.keys(openItems).filter(id => openItems[id]).map(id => (
          React.createElement('div', { key:id, className:'mt-3 ml-2 border-l-4 border-blue-300 pl-4' },
            React.createElement('div', { className:'text-sm text-gray-700 mb-2' }, `Items for VPO ${id}`),
            React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-5 gap-2 mb-2' },
              React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Item', value:newItem.item, onChange:e=>setNewItem({...newItem,item:e.target.value}) }),
              React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Description', value:newItem.description, onChange:e=>setNewItem({...newItem,description:e.target.value}) }),
              React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Qty', value:newItem.qty, onChange:e=>setNewItem({...newItem,qty:Number(e.target.value||0)}) }),
              React.createElement('select', { className:'border rounded px-2 py-1', value:newItem.unit, onChange:e=>setNewItem({...newItem,unit:e.target.value}) }, ['kg','pcs','litre'].map(u=> React.createElement('option', { key:u, value:u }, u))),
              React.createElement('button', { className:'px-3 py-1 bg-green-600 text-white rounded', onClick:()=>addItem({ id }) }, 'Add Item')
            ),
            React.createElement('div', { className:'overflow-x-auto' },
              React.createElement('table', { className:'min-w-full border-collapse' },
                React.createElement('thead', null,
                  React.createElement('tr', { className:'bg-gray-100' }, ['Item','Description','Qty','Unit','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
                ),
                React.createElement('tbody', null,
                  (itemsCache[id]||[]).map(it => (
                    React.createElement('tr', { key:it.id, className:'border-b' },
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:it.item, onChange:e=>it.item=e.target.value })),
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:it.description, onChange:e=>it.description=e.target.value })),
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24 text-right', defaultValue:it.qty, onChange:e=>it.qty=Number(e.target.value||0) })),
                      React.createElement('td', { className:'p-2' }, React.createElement('select', { className:'border rounded px-2 py-1', defaultValue:it.unit, onChange:e=>it.unit=e.target.value }, ['kg','pcs','litre'].map(u=> React.createElement('option', { key:u, value:u }, u)))),
                      React.createElement('td', { className:'p-2 text-right space-x-2' },
                        React.createElement('button', { className:'px-2 py-1 bg-blue-600 text-white rounded text-sm', onClick:()=>updateItem(id, it) }, 'Save'),
                        React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>deleteItem(id, it.id) }, 'Delete')
                      )
                    )
                  ))
                )
              )
            )
          )
        ))
      )
    )
  );
}

// Extended Products table with required columns
function ProductMasterEx({ products, calculateWeights, onRefresh }){
  const [form, setForm] = useState({ id:'', description:'', diameter:0, length:0, coating:0 });
  async function add(){ await fetch(`${API_URL}/products`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...form, diameter:Number(form.diameter), length:Number(form.length), coating:Number(form.coating) }) }); setForm({ id:'', description:'', diameter:0, length:0, coating:0 }); onRefresh?.(); }
  return (
    React.createElement('div', { className:'space-y-4' },
      React.createElement(Section, { title:'Add Product' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-3' },
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'ID', value:form.id, onChange:e=>setForm({ ...form, id:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Description', value:form.description, onChange:e=>setForm({ ...form, description:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Steel Dia (mm)', value:form.diameter, onChange:e=>setForm({ ...form, diameter:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Length (mm)', value:form.length, onChange:e=>setForm({ ...form, length:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Coating (µm)', value:form.coating, onChange:e=>setForm({ ...form, coating:e.target.value }) }),
          React.createElement('button', { onClick:add, className:'px-3 py-2 bg-green-600 text-white rounded' }, 'Add')
        )
      ),
      React.createElement(Section, { title:'Products' },
        React.createElement('div', { className:'mb-3' },
          React.createElement('button', { className:'px-3 py-2 bg-gray-700 text-white rounded', onClick:()=>{
            const headers = [
              { key:'id', label:'ID' },
              { key:'description', label:'Description' },
              { key:'diameter', label:'Steel Dia (mm)' },
              { key:'length', label:'Length (mm)' },
              { key:'length_ft', label:'Length (ft)' },
              { key:'coating', label:'Cu Coating (µm)' },
              { key:'cbgDiameter', label:'CBG Dia (mm)' },
              { key:'cbg', label:'CBG Weight (kg)' }
            ];
            const rows = products.map(p=>{ const w = calculateWeights(p.diameter,p.coating,p.length); return { ...p, length_ft:(p.length/304.8).toFixed(2), cbgDiameter:w.cbgDiameter, cbg:w.cbg }; });
            downloadCSV('products.csv', headers, rows);
          }}, 'Export CSV')
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' },
                ['ID','Description','Steel Dia (mm)','Length (mm)','Length (ft)','Cu Coating (µm)','CBG Dia (mm)','CBG Weight (kg)'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h))
              )
            ),
            React.createElement('tbody', null,
              products.map(p => {
                const w = calculateWeights(p.diameter, p.coating, p.length);
                return React.createElement('tr', { key:p.id, className:'border-b' },
                  React.createElement('td', { className:'p-2 font-mono' }, p.id),
                  React.createElement('td', { className:'p-2' }, p.description),
                  React.createElement('td', { className:'p-2 text-center' }, p.diameter),
                  React.createElement('td', { className:'p-2 text-center' }, p.length),
                  React.createElement('td', { className:'p-2 text-center' }, (p.length/304.8).toFixed(2)),
                  React.createElement('td', { className:'p-2 text-center' }, p.coating),
                  React.createElement('td', { className:'p-2 text-center' }, w.cbgDiameter),
                  React.createElement('td', { className:'p-2 text-center' }, w.cbg)
                );
              })
            )
          )
        )
      )
    )
  );
}

function MetricCard({ title, value, color }){
  const colors = { blue: 'from-blue-400 to-blue-600 border-blue-300', green: 'from-green-400 to-green-600 border-green-300', orange: 'from-orange-400 to-orange-600 border-orange-300', red: 'from-red-400 to-red-600 border-red-300' };
  return React.createElement('div', { className: `bg-gradient-to-br ${colors[color]} rounded-xl shadow-lg p-6 border-2 text-white` },
    React.createElement('div', { className: 'text-sm font-bold opacity-90 mb-2' }, title),
    React.createElement('div', { className: 'text-4xl font-bold' }, value)
  );
}

// MetricCard with drill (click navigates to Inventory with filters)
function MetricCardDrill({ id, title, value, color }){
  const colors = { blue: 'from-blue-400 to-blue-600 border-blue-300', green: 'from-green-400 to-green-600 border-green-300', orange: 'from-orange-400 to-orange-600 border-orange-300', red: 'from-red-400 to-red-600 border-red-300' };
  const handleClick = () => {
    // Simple drill: navigate to Inventory tab
    const ev = new CustomEvent('dash-drill', { detail: { metric: id }});
    window.dispatchEvent(ev);
  };
  return React.createElement('button', { onClick: handleClick, className: `text-left w-full bg-gradient-to-br ${colors[color]} rounded-xl shadow-lg p-6 border-2 text-white` },
    React.createElement('div', { className: 'text-sm font-bold opacity-90 mb-2' }, title),
    React.createElement('div', { className: 'text-4xl font-bold' }, value)
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(GroundRodERP));

// CSV export helper
function downloadCSV(filename, headers, rows){
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? '"' + s + '"' : s;
  };
  const headerLine = headers.map(h => escape(h.label)).join(',');
  const lines = rows.map(r => headers.map(h => escape(r[h.key])).join(','));
  const csv = [headerLine, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Marking (Customer ID)'),
            React.createElement('select', { className:'border rounded px-2 py-1 md:col-span-2', value:clientPreview.po?.marking||'', onChange:e=>updateClientPo('marking', e.target.value) },
              React.createElement('option', { value:'' }, '-- Select --'),
              customers.map(c=> React.createElement('option', { key:c.id, value:c.id }, `${c.id} - ${c.name}`))
            )