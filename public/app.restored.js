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
        activeTab === 'job-work' && React.createElement(JobWorkOrders, { vendors, products, onRefresh: fetchAllData }),
        activeTab === 'shipments' && React.createElement(Shipments, { shipments, purchaseOrders: clientPurchaseOrders, products, onRefresh: fetchAllData }),
        activeTab === 'inventory' && React.createElement(InventoryViewEx, { inventory, rawMaterials, products, customers, onRefresh: fetchAllData, filter, setFilter, rangeMode, setRangeMode }),
        activeTab === 'products' && React.createElement(ProductMasterEx, { products, calculateWeights, onRefresh: fetchAllData }),
        activeTab === 'customers' && React.createElement(CustomerManagementEx, { customers, onRefresh: fetchAllData }),
        activeTab === 'vendors' && React.createElement(VendorManagement, { vendors, onRefresh: fetchAllData }),
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
    { id: 'job-work', label: 'Job Work' },
    { id: 'shipments', label: 'Shipments' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'products', label: 'Products' },
    { id: 'customers', label: 'Customers' },
    { id: 'vendors', label: 'Vendors' },
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
        React.createElement('div', { className:'flex items-center gap-3 mb-3' },
          React.createElement('h4', { className:'font-semibold' }, 'Recent Production'),
          React.createElement('label', { className:'text-sm text-gray-600' }, 'Show last'),
          React.createElement('select', { className:'border rounded px-2 py-1', value:limit, onChange:e=>{ const v = parseInt(e.target.value,10); setLimit(v); loadRecent(v); } },
            [20,50,100].map(n => React.createElement('option', { key:n, value:n }, n))
          ),
          React.createElement('span', { className:'text-sm text-gray-600' }, 'entries')
        ),
        React.createElement(EnhancedTable, {
          title: '',
          data: recent,
          columns: [
            { key: 'production_date', label: 'Date' },
            { key: 'product_description', label: 'Product', render: (val, row) => val || row.product_id },
            { key: 'plated', label: 'Plated', render: (val) => val || 0 },
            { key: 'machined', label: 'Machined', render: (val) => val || 0 },
            { key: 'qc', label: 'QC', render: (val) => val || 0 },
            { key: 'stamped', label: 'Stamped', render: (val) => val || 0 },
            { key: 'packed', label: 'Packed', render: (val) => val || 0 },
            { key: 'rejected', label: 'Rejected', render: (val) => val || 0 },
            { key: 'notes', label: 'Notes', render: (val) => val || '-' }
          ],
          primaryKey: 'id',
          onRowClick: null,
          onDelete: null,
          filterOptions: [
            { key: 'product_description', label: 'Product', values: [...new Set(recent.map(r => r.product_description || r.product_id).filter(Boolean))] },
            { key: 'production_date', label: 'Date', values: [...new Set(recent.map(r => r.production_date).filter(Boolean))] }
          ],
          defaultVisibleColumns: { production_date: true, product_description: true, plated: true, machined: true, qc: true, stamped: true, packed: true, rejected: true, notes: true }
        })
      )
    )
  );
}

function ClientPurchaseOrders({ purchaseOrders, products, customers, onRefresh }) {
  const [localOrders, setLocalOrders] = useState(Array.isArray(purchaseOrders) ? purchaseOrders : []);
  const [editingPO, setEditingPO] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editLineItems, setEditLineItems] = useState([]);
  const [lineItems, setLineItems] = useState({});
  const [fulfilEdit, setFulfilEdit] = useState({});

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

  // Calculate weights
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

  async function handleRowClick(po) {
    setEditForm({
      id: po.id,
      customer_id: po.customer_id,
      customer_name: po.customer_name,
      po_date: po.po_date,
      due_date: po.due_date,
      currency: po.currency || 'INR',
      status: po.status,
      notes: po.notes || ''
    });
    setEditingPO(po);

    // Fetch line items
    try {
      const res = await fetch(`${API_URL}/client-purchase-orders/${po.id}/items`);
      if (res.ok) {
        const items = await res.json();
        setEditLineItems(items);
      }
    } catch (err) {
      console.error('Failed to fetch line items', err);
      setEditLineItems([]);
    }
  }

  async function saveEdit() {
    try {
      const res = await fetch(`${API_URL}/purchase-orders/${editForm.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });

      if (res.ok) {
        setEditingPO(null);
        await refreshLocalOrders();
        if (onRefresh) await onRefresh();
      } else {
        alert('Failed to update PO');
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  async function del(id) {
    if (!confirm('Delete Client PO?')) return;
    await fetch(`${API_URL}/purchase-orders/${id}`, { method: 'DELETE' });
    await refreshLocalOrders();
    if (onRefresh) await onRefresh();
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

    // List of existing POs with EnhancedTable
    React.createElement('div', { ref: listSectionRef },
      React.createElement(EnhancedTable, {
        title: 'Client Purchase Orders',
        data: localOrders,
        columns: [
          { key: 'id', label: 'PO ID' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'po_date', label: 'PO Date' },
          { key: 'due_date', label: 'Due Date' },
          { key: 'currency', label: 'Currency', render: (val) => val || 'INR' },
          { key: 'status', label: 'Status' },
          { key: 'notes', label: 'Notes', render: (val) => val || '-' }
        ],
        primaryKey: 'id',
        onRowClick: handleRowClick,
        onDelete: del,
        filterOptions: [
          { key: 'customer_name', label: 'Customer', values: [...new Set(localOrders.map(po => po.customer_name).filter(Boolean))] },
          { key: 'status', label: 'Status', values: ['Pending', 'Confirmed', 'In Production', 'Completed', 'Cancelled'] }
        ],
        defaultVisibleColumns: { id: true, customer_name: true, po_date: true, due_date: true, currency: true, status: true, notes: true }
      }),

      // Edit Modal
      React.createElement(EditModal, {
        isOpen: editingPO !== null,
        onClose: () => setEditingPO(null),
        title: `Edit Client PO: ${editForm.id || ''}`
      },
        editingPO && React.createElement('div', { className: 'space-y-6' },
          // PO Header Fields
          React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'PO ID'),
              React.createElement('input', {
                className: 'border rounded px-3 py-2 w-full bg-gray-100',
                value: editForm.id || '',
                disabled: true
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Customer'),
              React.createElement('select', {
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.customer_id || '',
                onChange: e => setEditForm({ ...editForm, customer_id: e.target.value })
              },
                React.createElement('option', { value: '' }, 'Select Customer'),
                customers.map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.id} - ${c.name}`))
              )
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'PO Date'),
              React.createElement('input', {
                type: 'date',
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.po_date || '',
                onChange: e => setEditForm({ ...editForm, po_date: e.target.value })
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Due Date'),
              React.createElement('input', {
                type: 'date',
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.due_date || '',
                onChange: e => setEditForm({ ...editForm, due_date: e.target.value })
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Currency'),
              React.createElement('select', {
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.currency || 'INR',
                onChange: e => setEditForm({ ...editForm, currency: e.target.value })
              },
                ['INR', 'USD', 'EUR', 'AED'].map(c => React.createElement('option', { key: c, value: c }, c))
              )
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Status'),
              React.createElement('select', {
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.status || 'Pending',
                onChange: e => setEditForm({ ...editForm, status: e.target.value })
              },
                ['Pending', 'Confirmed', 'In Production', 'Completed', 'Cancelled'].map(s =>
                  React.createElement('option', { key: s, value: s }, s)
                )
              )
            ),
            React.createElement('div', { className: 'md:col-span-2' },
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Notes'),
              React.createElement('textarea', {
                className: 'border rounded px-3 py-2 w-full',
                rows: 2,
                value: editForm.notes || '',
                onChange: e => setEditForm({ ...editForm, notes: e.target.value })
              })
            )
          ),

          // Line Items Section
          editLineItems.length > 0 && React.createElement('div', { className: 'border-t pt-4' },
            React.createElement('h4', { className: 'font-semibold text-lg mb-3' }, 'Line Items & Fulfillment'),
            React.createElement('div', { className: 'overflow-x-auto' },
              React.createElement('table', { className: 'min-w-full border-collapse text-sm' },
                React.createElement('thead', null,
                  React.createElement('tr', { className: 'bg-gray-100' },
                    ['Product', 'Description', 'Ordered', 'Delivered', 'Remaining', 'Unit Price', 'Currency'].map(h =>
                      React.createElement('th', { key: h, className: 'p-2 border' }, h)
                    )
                  )
                ),
                React.createElement('tbody', null,
                  editLineItems.map((item, idx) =>
                    React.createElement('tr', { key: idx },
                      React.createElement('td', { className: 'p-2 border font-mono text-sm' }, item.product_id),
                      React.createElement('td', { className: 'p-2 border text-sm' }, item.product_description),
                      React.createElement('td', { className: 'p-2 border text-right' }, item.quantity),
                      React.createElement('td', { className: 'p-2 border text-right' }, item.delivered || 0),
                      React.createElement('td', { className: 'p-2 border text-right' }, (item.quantity - (item.delivered || 0))),
                      React.createElement('td', { className: 'p-2 border text-right' }, formatCurrency(item.unit_price, item.currency || 'INR')),
                      React.createElement('td', { className: 'p-2 border text-center' }, item.currency || 'INR')
                    )
                  )
                )
              )
            )
          ),

          // Save/Cancel buttons
          React.createElement('div', { className: 'flex justify-end gap-3 pt-4 border-t' },
            React.createElement('button', {
              onClick: () => setEditingPO(null),
              className: 'px-4 py-2 border border-gray-300 rounded hover:bg-gray-50'
            }, 'Cancel'),
            React.createElement('button', {
              onClick: saveEdit,
              className: 'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700'
            }, 'Save Changes')
          )
        )
      )
    )
  );
}

function VendorPurchaseOrders({ purchaseOrders, vendors, onRefresh }){
  const [form, setForm] = useState({ id:'', vendor_id:'', po_date:'', due_date:'', status:'Pending', notes:'' });
  const [editingVPO, setEditingVPO] = useState(null);
  const [editForm, setEditForm] = useState({});

  async function add(){
    await fetch(`${API_URL}/vendor-purchase-orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
    setForm({ id:'', vendor_id:'', po_date:'', due_date:'', status:'Pending', notes:'' });
    onRefresh?.();
  }

  function handleRowClick(vpo){
    setEditForm({
      id: vpo.id,
      vendor_id: vpo.vendor_id,
      vendor_name: vpo.vendor_name,
      po_date: vpo.po_date,
      due_date: vpo.due_date,
      status: vpo.status,
      notes: vpo.notes || ''
    });
    setEditingVPO(vpo);
  }

  async function saveEdit(){
    await fetch(`${API_URL}/vendor-purchase-orders/${editForm.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(editForm) });
    setEditingVPO(null);
    onRefresh?.();
  }

  async function del(id){
    if(!confirm('Delete Vendor PO?')) return;
    await fetch(`${API_URL}/vendor-purchase-orders/${id}`, { method:'DELETE' });
    onRefresh?.();
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
      React.createElement(EnhancedTable, {
        title: 'Vendor Purchase Orders',
        data: purchaseOrders,
        columns: [
          { key: 'id', label: 'VPO ID' },
          { key: 'vendor_name', label: 'Vendor' },
          { key: 'po_date', label: 'PO Date' },
          { key: 'due_date', label: 'Due Date' },
          { key: 'status', label: 'Status' },
          { key: 'notes', label: 'Notes', render: (val) => val || '-' }
        ],
        primaryKey: 'id',
        onRowClick: handleRowClick,
        onDelete: del,
        filterOptions: [
          { key: 'vendor_name', label: 'Vendor', values: [...new Set(purchaseOrders.map(vpo => vpo.vendor_name).filter(Boolean))] },
          { key: 'status', label: 'Status', values: ['Pending', 'Ordered', 'In Transit', 'Completed', 'Cancelled'] }
        ],
        defaultVisibleColumns: { id: true, vendor_name: true, po_date: true, due_date: true, status: true, notes: true }
      }),

      // Edit Modal
      React.createElement(EditModal, {
        isOpen: editingVPO !== null,
        onClose: () => setEditingVPO(null),
        title: `Edit Vendor PO: ${editForm.id || ''}`
      },
        editingVPO && React.createElement('div', { className: 'space-y-4' },
          React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'VPO ID'),
              React.createElement('input', {
                className: 'border rounded px-3 py-2 w-full bg-gray-100',
                value: editForm.id || '',
                disabled: true
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Vendor'),
              React.createElement('select', {
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.vendor_id || '',
                onChange: e => setEditForm({ ...editForm, vendor_id: e.target.value })
              },
                React.createElement('option', { value: '' }, 'Select Vendor'),
                vendors.map(v => React.createElement('option', { key: v.id, value: v.id }, `${v.id} - ${v.name}`))
              )
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'PO Date'),
              React.createElement('input', {
                type: 'date',
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.po_date || '',
                onChange: e => setEditForm({ ...editForm, po_date: e.target.value })
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Due Date'),
              React.createElement('input', {
                type: 'date',
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.due_date || '',
                onChange: e => setEditForm({ ...editForm, due_date: e.target.value })
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Status'),
              React.createElement('select', {
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.status || 'Pending',
                onChange: e => setEditForm({ ...editForm, status: e.target.value })
              },
                ['Pending', 'Ordered', 'In Transit', 'Completed', 'Cancelled'].map(s =>
                  React.createElement('option', { key: s, value: s }, s)
                )
              )
            ),
            React.createElement('div', { className: 'md:col-span-2' },
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Notes'),
              React.createElement('textarea', {
                className: 'border rounded px-3 py-2 w-full',
                rows: 2,
                value: editForm.notes || '',
                onChange: e => setEditForm({ ...editForm, notes: e.target.value })
              })
            )
          ),

          React.createElement('div', { className: 'flex justify-end gap-3 pt-4 border-t' },
            React.createElement('button', {
              onClick: () => setEditingVPO(null),
              className: 'px-4 py-2 border border-gray-300 rounded hover:bg-gray-50'
            }, 'Cancel'),
            React.createElement('button', {
              onClick: saveEdit,
              className: 'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700'
            }, 'Save Changes')
          )
        )
      )
    )
  );
}

function JobWorkOrders({ vendors, products, onRefresh }){
  const [orders, setOrders] = useState([]);
  const [openDetails, setOpenDetails] = useState({});
  const [items, setItems] = useState({});
  const [form, setForm] = useState({ id:'', vendor_id:'', jw_date:'', due_date:'', job_type:'Rod Making', status:'Open', notes:'' });
  const [editing, setEditing] = useState(null);
  const listSectionRef = React.useRef(null);

  const JOB_TYPES = ['Rod Making', 'Plating'];
  const STATUSES = ['Open', 'In Progress', 'Completed', 'Cancelled'];

  React.useEffect(() => {
    refreshOrders();
  }, []);

  async function refreshOrders() {
    try {
      const resp = await fetch(`${API_URL}/jobwork/orders`);
      if (resp.ok) {
        const data = await resp.json();
        setOrders(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch job work orders', err);
    }
  }

  async function add(){
    if (!form.id || !form.jw_date) {
      alert('Please fill JW ID and Date');
      return;
    }
    const res = await fetch(`${API_URL}/jobwork/orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
    if (res.ok) {
      setForm({ id:'', vendor_id:'', jw_date:'', due_date:'', job_type:'Rod Making', status:'Open', notes:'' });
      await refreshOrders();
      if (onRefresh) await onRefresh();
      setTimeout(() => {
        if (listSectionRef.current) {
          listSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    } else {
      alert('Failed to create job work order');
    }
  }

  async function save(order){
    await fetch(`${API_URL}/jobwork/orders/${order.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(order) });
    setEditing(null);
    await refreshOrders();
    if (onRefresh) await onRefresh();
  }

  async function del(id){
    if(!confirm('Delete Job Work Order?')) return;
    await fetch(`${API_URL}/jobwork/orders/${id}`, { method:'DELETE' });
    await refreshOrders();
    if (onRefresh) await onRefresh();
  }

  async function toggleDetails(order) {
    setOpenDetails(prev => ({ ...prev, [order.id]: !prev[order.id] }));
    if (!items[order.id]) {
      const res = await fetch(`${API_URL}/jobwork/orders/${order.id}/items`);
      const data = await res.json();
      setItems(prev => ({ ...prev, [order.id]: data }));
    }
  }

  async function addItem(orderId, productId, qty) {
    if (!productId || !qty) return;
    await fetch(`${API_URL}/jobwork/orders/${orderId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: productId, qty: Number(qty) })
    });
    const res = await fetch(`${API_URL}/jobwork/orders/${orderId}/items`);
    const data = await res.json();
    setItems(prev => ({ ...prev, [orderId]: data }));
  }

  async function removeItem(orderId, itemId) {
    await fetch(`${API_URL}/jobwork/orders/${orderId}/items/${itemId}`, { method: 'DELETE' });
    const res = await fetch(`${API_URL}/jobwork/orders/${orderId}/items`);
    const data = await res.json();
    setItems(prev => ({ ...prev, [orderId]: data }));
  }

  async function receiveItems(orderId) {
    const orderItems = items[orderId] || [];
    if (!orderItems.length) {
      alert('No items to receive');
      return;
    }
    const receiveData = orderItems.map(it => ({ product_id: it.product_id, qty: it.qty }));
    const res = await fetch(`${API_URL}/jobwork/orders/${orderId}/receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: receiveData })
    });
    if (res.ok) {
      alert('Job work items received successfully');
      await refreshOrders();
      if (onRefresh) await onRefresh();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(`Failed to receive items: ${err.error || 'Unknown error'}`);
    }
  }

  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title: 'Add Job Work Order' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-7 gap-3' },
          React.createElement('input', { className:'border rounded px-3 py-2', placeholder:'JW ID', value: form.id, onChange:e=>setForm({...form,id:e.target.value}) }),
          React.createElement('select', { className:'border rounded px-3 py-2', value: form.vendor_id, onChange:e=>setForm({...form,vendor_id:e.target.value}) },
            React.createElement('option', { value:'' }, 'Select Vendor'),
            vendors.map(v => React.createElement('option', { key:v.id, value:v.id }, `${v.id} - ${v.name}`))
          ),
          React.createElement('input', { className:'border rounded px-3 py-2', type:'date', value: form.jw_date, onChange:e=>setForm({...form,jw_date:e.target.value}) }),
          React.createElement('input', { className:'border rounded px-3 py-2', type:'date', placeholder:'Due Date', value: form.due_date, onChange:e=>setForm({...form,due_date:e.target.value}) }),
          React.createElement('select', { className:'border rounded px-3 py-2', value: form.job_type, onChange:e=>setForm({...form,job_type:e.target.value}) },
            JOB_TYPES.map(t => React.createElement('option', { key:t, value:t }, t))
          ),
          React.createElement('select', { className:'border rounded px-3 py-2', value: form.status, onChange:e=>setForm({...form,status:e.target.value}) },
            STATUSES.map(s => React.createElement('option', { key:s, value:s }, s))
          ),
          React.createElement('button', { onClick:add, className:'px-4 py-2 bg-green-600 text-white rounded font-semibold' }, 'Create')
        )
      ),
      React.createElement('div', { ref: listSectionRef },
        React.createElement(Section, { title: 'Job Work Orders' },
          React.createElement('div', { className: 'overflow-x-auto' },
            React.createElement('table', { className:'min-w-full border-collapse' },
              React.createElement('thead', null,
                React.createElement('tr', { className:'bg-gray-100' }, ['JW ID','Vendor','Date','Due Date','Job Type','Status','Actions'].map(h => React.createElement('th', { key:h, className:'p-2 border' }, h)))
              ),
              React.createElement('tbody', null,
                orders.length > 0 ? orders.map(order => {
                  const edit = editing === order.id;
                  return React.createElement(React.Fragment, { key: order.id },
                    React.createElement('tr', { className:'border-b' },
                      React.createElement('td', { className:'p-2 border font-mono' }, order.id),
                      React.createElement('td', { className:'p-2 border' }, order.vendor_id || 'N/A'),
                      React.createElement('td', { className:'p-2 border' }, order.jw_date),
                      React.createElement('td', { className:'p-2 border' }, order.due_date || '-'),
                      React.createElement('td', { className:'p-2 border' }, order.job_type || 'Rod Making'),
                      React.createElement('td', { className:'p-2 border' }, order.status),
                      React.createElement('td', { className:'p-2 border text-right space-x-2' },
                        React.createElement('button', {
                          className:'px-2 py-1 bg-blue-600 text-white rounded text-sm',
                          onClick:()=>toggleDetails(order)
                        }, openDetails[order.id] ? 'Hide' : 'Details'),
                        React.createElement('button', {
                          className:'px-2 py-1 bg-red-600 text-white rounded text-sm',
                          onClick:()=>del(order.id)
                        }, 'Delete')
                      )
                    ),
                    openDetails[order.id] && React.createElement('tr', { className:'bg-gray-50' },
                      React.createElement('td', { colSpan:7, className:'p-3 border' },
                        React.createElement('div', { className:'space-y-3' },
                          React.createElement('h4', { className:'font-semibold' }, 'Job Work Items'),
                          items[order.id] && items[order.id].length > 0 ?
                            React.createElement('table', { className:'min-w-full border-collapse text-sm mb-3' },
                              React.createElement('thead', null,
                                React.createElement('tr', { className:'bg-gray-200' },
                                  ['Product','Quantity','Actions'].map(h => React.createElement('th', { key:h, className:'p-2 border' }, h))
                                )
                              ),
                              React.createElement('tbody', null,
                                items[order.id].map(item =>
                                  React.createElement('tr', { key:item.id },
                                    React.createElement('td', { className:'p-2 border' }, item.product_id),
                                    React.createElement('td', { className:'p-2 border text-right' }, item.qty),
                                    React.createElement('td', { className:'p-2 border' },
                                      React.createElement('button', {
                                        className:'px-2 py-1 bg-red-600 text-white rounded text-xs',
                                        onClick:()=>removeItem(order.id, item.id)
                                      }, 'Remove')
                                    )
                                  )
                                )
                              )
                            ) :
                            React.createElement('p', { className:'text-sm text-gray-500' }, 'No items'),
                          React.createElement('div', { className:'flex gap-2' },
                            React.createElement('select', {
                              id:`product-${order.id}`,
                              className:'border rounded px-2 py-1 flex-1'
                            },
                              React.createElement('option', { value:'' }, 'Select Product'),
                              products.map(p => React.createElement('option', { key:p.id, value:p.id }, `${p.id} - ${p.description}`))
                            ),
                            React.createElement('input', {
                              id:`qty-${order.id}`,
                              type:'number',
                              placeholder:'Qty',
                              className:'border rounded px-2 py-1 w-24'
                            }),
                            React.createElement('button', {
                              className:'px-3 py-1 bg-green-600 text-white rounded text-sm',
                              onClick:()=>{
                                const pid = document.getElementById(`product-${order.id}`).value;
                                const qty = document.getElementById(`qty-${order.id}`).value;
                                if (pid && qty) {
                                  addItem(order.id, pid, qty);
                                  document.getElementById(`product-${order.id}`).value = '';
                                  document.getElementById(`qty-${order.id}`).value = '';
                                }
                              }
                            }, '+ Add Item')
                          ),
                          React.createElement('div', { className:'pt-3 border-t' },
                            React.createElement('button', {
                              className:'px-4 py-2 bg-purple-600 text-white rounded font-semibold',
                              onClick:()=>receiveItems(order.id)
                            }, `Receive ${order.job_type || 'Rod Making'} Items`)
                          )
                        )
                      )
                    )
                  );
                }) : React.createElement('tr', null,
                  React.createElement('td', { colSpan:7, className:'p-4 text-center text-gray-500' }, 'No job work orders found')
                )
              )
            )
          )
        )
      )
    )
  );
}

function Shipments({ shipments }){
  const [editingShipment, setEditingShipment] = useState(null);
  const [editForm, setEditForm] = useState({});

  function handleRowClick(shipment){
    setEditForm({
      id: shipment.id,
      po_id: shipment.po_id,
      shipment_date: shipment.shipment_date,
      bl_number: shipment.bl_number,
      container_number: shipment.container_number,
      carrier: shipment.carrier,
      destination: shipment.destination
    });
    setEditingShipment(shipment);
  }

  async function saveEdit(){
    try {
      const res = await fetch(`${API_URL}/shipments/${editForm.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      if (res.ok) {
        setEditingShipment(null);
        window.location.reload();
      } else {
        alert('Failed to update shipment');
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  async function del(id){
    if (!confirm('Delete Shipment?')) return;
    await fetch(`${API_URL}/shipments/${id}`, { method: 'DELETE' });
    window.location.reload();
  }

  return (
    React.createElement('div', null,
      React.createElement(EnhancedTable, {
        title: 'Shipments',
        data: shipments,
        columns: [
          { key: 'id', label: 'ID' },
          { key: 'po_id', label: 'PO' },
          { key: 'shipment_date', label: 'Date' },
          { key: 'bl_number', label: 'BL No.', render: (val) => val || '-' },
          { key: 'container_number', label: 'Container', render: (val) => val || '-' },
          { key: 'carrier', label: 'Carrier', render: (val) => val || '-' },
          { key: 'destination', label: 'Destination', render: (val) => val || '-' }
        ],
        primaryKey: 'id',
        onRowClick: handleRowClick,
        onDelete: del,
        filterOptions: [
          { key: 'po_id', label: 'PO', values: [...new Set(shipments.map(s => s.po_id).filter(Boolean))] }
        ],
        defaultVisibleColumns: { id: true, po_id: true, shipment_date: true, bl_number: true, container_number: true, carrier: true, destination: true }
      }),

      React.createElement(EditModal, {
        isOpen: editingShipment !== null,
        onClose: () => setEditingShipment(null),
        title: `Edit Shipment: ${editForm.id || ''}`
      },
        editingShipment && React.createElement('div', { className: 'space-y-4' },
          React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Shipment ID'),
              React.createElement('input', {
                className: 'border rounded px-3 py-2 w-full bg-gray-100',
                value: editForm.id || '',
                disabled: true
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'PO ID'),
              React.createElement('input', {
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.po_id || '',
                onChange: e => setEditForm({ ...editForm, po_id: e.target.value })
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Shipment Date'),
              React.createElement('input', {
                type: 'date',
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.shipment_date || '',
                onChange: e => setEditForm({ ...editForm, shipment_date: e.target.value })
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'BL Number'),
              React.createElement('input', {
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.bl_number || '',
                onChange: e => setEditForm({ ...editForm, bl_number: e.target.value })
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Container Number'),
              React.createElement('input', {
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.container_number || '',
                onChange: e => setEditForm({ ...editForm, container_number: e.target.value })
              })
            ),
            React.createElement('div', null,
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Carrier'),
              React.createElement('input', {
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.carrier || '',
                onChange: e => setEditForm({ ...editForm, carrier: e.target.value })
              })
            ),
            React.createElement('div', { className: 'md:col-span-2' },
              React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Destination'),
              React.createElement('input', {
                className: 'border rounded px-3 py-2 w-full',
                value: editForm.destination || '',
                onChange: e => setEditForm({ ...editForm, destination: e.target.value })
              })
            )
          ),

          React.createElement('div', { className: 'flex justify-end gap-3 pt-4 border-t' },
            React.createElement('button', {
              onClick: () => setEditingShipment(null),
              className: 'px-4 py-2 border border-gray-300 rounded hover:bg-gray-50'
            }, 'Cancel'),
            React.createElement('button', {
              onClick: saveEdit,
              className: 'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700'
            }, 'Save Changes')
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
            React.createElement('tr', { className: 'bg-gray-100' }, ['Product','Steel Rods','Plated','Machined','QC','Stamped','Packed','Total'].map(h => React.createElement('th', { key: h, className: 'p-4 font-bold text-center' }, h)))
          ),
          React.createElement('tbody', null,
            inventory.map((item, idx) => {
              const total = (item.steel_rods||0) + (item.plated||0) + (item.machined||0) + (item.qc||0) + (item.stamped||0) + (item.packed||0);
              return React.createElement('tr', { key: item.product_id, className: `border-b-2 border-gray-200 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}` },
                React.createElement('td', { className: 'p-4 font-bold text-left' }, item.product_description),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.steel_rods || 0),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.plated || 0),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.machined || 0),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.qc || 0),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.stamped || 0),
                React.createElement('td', { className: 'p-4 font-semibold text-center' }, item.packed || 0),
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
  const [invCols, setInvCols] = useState({ product:true, steel_rods:true, plated:true, machined:true, qc:true, stamped:true, packed:true, total:true });
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
  const [editingRM, setEditingRM] = useState(null);
  const [editRMForm, setEditRMForm] = useState({});

  async function add(){
    await fetch(`${API_URL}/raw-materials`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rmForm) });
    setRmForm({ material:'', current_stock:0, reorder_level:0, last_purchase_date:'' });
    onRefresh?.();
  }

  function handleRMClick(m){
    setEditRMForm({
      material: m.material,
      current_stock: m.current_stock || 0,
      reorder_level: m.reorder_level || 0,
      last_purchase_date: m.last_purchase_date || ''
    });
    setEditingRM(m);
  }

  async function saveRM(){
    await fetch(`${API_URL}/raw-materials/${encodeURIComponent(editRMForm.material)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(editRMForm) });
    setEditingRM(null);
    onRefresh?.();
  }

  async function delRM(name){
    if(!confirm('Delete raw material?')) return;
    await fetch(`${API_URL}/raw-materials/${encodeURIComponent(name)}`, { method:'DELETE' });
    onRefresh?.();
  }
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
        React.createElement(EnhancedTable, {
          title: '',
          data: rawMaterials,
          columns: [
            { key: 'material', label: 'Material' },
            { key: 'current_stock', label: 'Current Stock', render: (val) => val || 0 },
            { key: 'reorder_level', label: 'Reorder Level', render: (val) => val || 0 },
            { key: 'last_purchase_date', label: 'Last Purchase', render: (val) => val || '-' }
          ],
          primaryKey: 'material',
          onRowClick: handleRMClick,
          onDelete: delRM,
          filterOptions: [],
          defaultVisibleColumns: { material: true, current_stock: true, reorder_level: true, last_purchase_date: true }
        }),

        React.createElement(EditModal, {
          isOpen: editingRM !== null,
          onClose: () => setEditingRM(null),
          title: `Edit Raw Material: ${editRMForm.material || ''}`
        },
          editingRM && React.createElement('div', { className: 'space-y-4' },
            React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
              React.createElement('div', null,
                React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Material'),
                React.createElement('input', {
                  className: 'border rounded px-3 py-2 w-full bg-gray-100',
                  value: editRMForm.material || '',
                  disabled: true
                })
              ),
              React.createElement('div', null,
                React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Current Stock'),
                React.createElement('input', {
                  type: 'number',
                  className: 'border rounded px-3 py-2 w-full',
                  value: editRMForm.current_stock || 0,
                  onChange: e => setEditRMForm({ ...editRMForm, current_stock: Number(e.target.value || 0) })
                })
              ),
              React.createElement('div', null,
                React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Reorder Level'),
                React.createElement('input', {
                  type: 'number',
                  className: 'border rounded px-3 py-2 w-full',
                  value: editRMForm.reorder_level || 0,
                  onChange: e => setEditRMForm({ ...editRMForm, reorder_level: Number(e.target.value || 0) })
                })
              ),
              React.createElement('div', null,
                React.createElement('label', { className: 'block text-sm font-semibold text-gray-700 mb-1' }, 'Last Purchase Date'),
                React.createElement('input', {
                  type: 'date',
                  className: 'border rounded px-3 py-2 w-full',
                  value: editRMForm.last_purchase_date || '',
                  onChange: e => setEditRMForm({ ...editRMForm, last_purchase_date: e.target.value })
                })
              )
            ),

            React.createElement('div', { className: 'flex justify-end gap-3 pt-4 border-t' },
              React.createElement('button', {
                onClick: () => setEditingRM(null),
                className: 'px-4 py-2 border border-gray-300 rounded hover:bg-gray-50'
              }, 'Cancel'),
              React.createElement('button', {
                onClick: saveRM,
                className: 'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700'
              }, 'Save Changes')
            )
          )
        )
      ),
      React.createElement(Section, { title:'WIP & Finished Copper Bonded Ground Rods' },
        controls,
        React.createElement(EnhancedTable, {
          title: '',
          data: (invData||[]).map(r => ({
            ...r,
            total: (r.steel_rods||0)+(r.plated||0)+(r.machined||0)+(r.qc||0)+(r.stamped||0)+(r.packed||0)
          })),
          columns: [
            { key: 'product_description', label: 'Product' },
            { key: 'steel_rods', label: 'Steel Rods', render: (val) => val || 0 },
            { key: 'plated', label: 'Plated', render: (val) => val || 0 },
            { key: 'machined', label: 'Machined', render: (val) => val || 0 },
            { key: 'qc', label: 'QC', render: (val) => val || 0 },
            { key: 'stamped', label: 'Stamped', render: (val) => val || 0 },
            { key: 'packed', label: 'Packed', render: (val) => val || 0 },
            { key: 'total', label: 'Total', render: (val) => val || 0 }
          ],
          primaryKey: 'product_id',
          onRowClick: null,
          onDelete: null,
          filterOptions: [
            { key: 'product_description', label: 'Product', values: [...new Set((invData||[]).map(r => r.product_description).filter(Boolean))] }
          ],
          defaultVisibleColumns: { product_description: true, steel_rods: true, plated: true, machined: true, qc: true, stamped: true, packed: true, total: true }
        })
      )
    )
  );
}

// Enhanced Table Component with sorting, filtering, column customization, and clickable rows
function EnhancedTable({ title, data, columns, primaryKey = 'id', onRowClick, onDelete, onExport, filterOptions = [], defaultVisibleColumns }) {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [visibleColumns, setVisibleColumns] = useState(defaultVisibleColumns || columns.reduce((acc, col) => ({ ...acc, [col.key]: true }), {}));
  const [filters, setFilters] = useState({});
  const [searchTerm, setSearchTerm] = useState('');

  const sortedData = React.useMemo(() => {
    let sortableData = [...(data || [])];
    if (sortConfig.key) {
      sortableData.sort((a, b) => {
        const aVal = a[sortConfig.key]; const bVal = b[sortConfig.key];
        if (aVal == null) return 1; if (bVal == null) return -1;
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableData;
  }, [data, sortConfig]);

  const filteredData = React.useMemo(() => {
    return sortedData.filter(row => {
      for (const [filterKey, filterValue] of Object.entries(filters)) {
        if (filterValue && row[filterKey] !== filterValue) return false;
      }
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const match = columns.some(col => { const val = row[col.key]; return val && String(val).toLowerCase().includes(searchLower); });
        if (!match) return false;
      }
      return true;
    });
  }, [sortedData, filters, searchTerm, columns]);

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const orderedColumns = columns.filter(c => visibleColumns[c.key]);

  return React.createElement('div', { className: 'space-y-4' },
    React.createElement('div', { className: 'bg-white rounded-lg shadow-md p-4 border border-gray-200' },
      React.createElement('div', { className: 'flex flex-wrap gap-3 items-center mb-3' },
        React.createElement('input', { type: 'text', placeholder: 'Search...', value: searchTerm, onChange: e => setSearchTerm(e.target.value), className: 'border rounded px-3 py-2 w-64' }),
        filterOptions.map(filter => React.createElement('select', { key: filter.key, value: filters[filter.key] || '', onChange: e => setFilters({ ...filters, [filter.key]: e.target.value }), className: 'border rounded px-3 py-2' },
          React.createElement('option', { value: '' }, `All ${filter.label}`),
          (filter.values || []).map(val => React.createElement('option', { key: val, value: val }, val))
        )),
        onExport && React.createElement('button', { onClick: () => onExport(filteredData, orderedColumns), className: 'ml-auto px-3 py-2 bg-gray-700 text-white rounded' }, 'Export CSV')
      ),
      React.createElement('div', { className: 'flex flex-wrap gap-2 items-center' },
        React.createElement('span', { className: 'text-sm font-semibold text-gray-700' }, 'Columns:'),
        columns.map(col => React.createElement('label', { key: col.key, className: 'text-sm flex items-center gap-1 cursor-pointer' },
          React.createElement('input', { type: 'checkbox', checked: visibleColumns[col.key] || false, onChange: e => setVisibleColumns({ ...visibleColumns, [col.key]: e.target.checked }) }),
          col.label
        ))
      )
    ),
    React.createElement('div', { className: 'bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden' },
      React.createElement('div', { className: 'overflow-x-auto' },
        React.createElement('table', { className: 'min-w-full border-collapse' },
          React.createElement('thead', { className: 'bg-gray-100' },
            React.createElement('tr', null,
              orderedColumns.map(col => React.createElement('th', { key: col.key, className: 'p-3 text-left cursor-pointer hover:bg-gray-200 select-none border', onClick: () => requestSort(col.key) },
                React.createElement('div', { className: 'flex items-center gap-2' }, col.label, sortConfig.key === col.key && React.createElement('span', { className: 'text-xs' }, sortConfig.direction === 'asc' ? '▲' : '▼'))
              )),
              React.createElement('th', { className: 'p-3 text-right border' }, 'Actions')
            )
          ),
          React.createElement('tbody', null,
            filteredData.length > 0 ? filteredData.map((row, rowIdx) => React.createElement('tr', { key: row[primaryKey] || rowIdx, className: 'border-b hover:bg-blue-50 transition-colors' },
              orderedColumns.map(col => React.createElement('td', { key: col.key, className: `p-3 border ${col.key === primaryKey ? 'font-mono font-semibold text-blue-600 cursor-pointer hover:underline' : ''}`, onClick: col.key === primaryKey && onRowClick ? () => onRowClick(row) : undefined },
                col.render ? col.render(row[col.key], row) : (row[col.key] || '-')
              )),
              React.createElement('td', { className: 'p-3 text-right border' },
                onDelete && React.createElement('button', { onClick: () => onDelete(row[primaryKey]), className: 'px-2 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700' }, 'Delete')
              )
            )) : React.createElement('tr', null, React.createElement('td', { colSpan: orderedColumns.length + 1, className: 'p-8 text-center text-gray-500' }, 'No data found'))
          )
        )
      )
    ),
    React.createElement('div', { className: 'text-sm text-gray-600' }, `Showing ${filteredData.length} of ${data?.length || 0} entries`)
  );
}

// Modal component for editing entries
function EditModal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return React.createElement('div', { className: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4', onClick: onClose },
    React.createElement('div', { className: 'bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto', onClick: e => e.stopPropagation() },
      React.createElement('div', { className: 'sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center' },
        React.createElement('h2', { className: 'text-2xl font-bold text-gray-800' }, title),
        React.createElement('button', { onClick: onClose, className: 'text-gray-500 hover:text-gray-700 text-3xl font-bold leading-none' }, '×')
      ),
      React.createElement('div', { className: 'p-6' }, children)
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
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editForm, setEditForm] = useState({});

  async function add(){
    await fetch(`${API_URL}/customers`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
    setForm({ id:'', name:'', office_address:'', warehouse_address:'', contact_person:'', phone:'', email:'' });
    onRefresh?.();
  }

  async function saveEdit(){
    await fetch(`${API_URL}/customers/${editForm.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(editForm) });
    setEditingCustomer(null);
    onRefresh?.();
  }

  async function del(id){
    if(!confirm('Delete customer?')) return;
    await fetch(`${API_URL}/customers/${id}`, { method:'DELETE' });
    onRefresh?.();
  }

  const columns = [
    { key: 'id', label: 'Customer ID' },
    { key: 'name', label: 'Name' },
    { key: 'contact_person', label: 'Contact Person' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'office_address', label: 'Office Address' },
    { key: 'warehouse_address', label: 'Warehouse Address' }
  ];

  function handleRowClick(customer){
    setEditForm({ ...customer });
    setEditingCustomer(customer);
  }

  return React.createElement('div', { className:'space-y-4' },
    React.createElement(Section, { title: 'Add Customer' },
      React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-3 gap-3' },
        React.createElement('input', { className: 'border rounded px-3 py-2', placeholder: 'Customer ID', value: form.id, onChange: e=>setForm({...form,id:e.target.value}) }),
        React.createElement('input', { className: 'border rounded px-3 py-2', placeholder: 'Name', value: form.name, onChange: e=>setForm({...form,name:e.target.value}) }),
        React.createElement('input', { className: 'border rounded px-3 py-2', placeholder: 'Contact Person', value: form.contact_person, onChange: e=>setForm({...form,contact_person:e.target.value}) }),
        React.createElement('input', { className: 'border rounded px-3 py-2', placeholder: 'Phone', value: form.phone, onChange: e=>setForm({...form,phone:e.target.value}) }),
        React.createElement('input', { className: 'border rounded px-3 py-2', placeholder: 'Email', value: form.email, onChange: e=>setForm({...form,email:e.target.value}) }),
        React.createElement('input', { className: 'border rounded px-3 py-2 md:col-span-3', placeholder: 'Office Address', value: form.office_address, onChange: e=>setForm({...form,office_address:e.target.value}) }),
        React.createElement('input', { className: 'border rounded px-3 py-2 md:col-span-3', placeholder: 'Warehouse Address', value: form.warehouse_address, onChange: e=>setForm({...form,warehouse_address:e.target.value}) }),
        React.createElement('button', { onClick: add, className: 'px-4 py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700' }, 'Add Customer')
      )
    ),
    React.createElement(EnhancedTable, {
      title: 'Customers',
      data: customers,
      columns: columns,
      primaryKey: 'id',
      onRowClick: handleRowClick,
      onDelete: del,
      onExport: (data, cols) => downloadCSV('customers.csv', cols.map(c=>({key:c.key,label:c.label})), data)
    }),
    React.createElement(EditModal, { isOpen: !!editingCustomer, onClose: () => setEditingCustomer(null), title: `Edit Customer: ${editForm.id || ''}` },
      React.createElement('div', { className:'space-y-4' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-2 gap-4' },
          React.createElement('div', null, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Customer ID'), React.createElement('input', { className:'border rounded px-3 py-2 w-full bg-gray-100', value:editForm.id || '', disabled:true })),
          React.createElement('div', null, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Name'), React.createElement('input', { className:'border rounded px-3 py-2 w-full', value:editForm.name || '', onChange:e=>setEditForm({...editForm, name:e.target.value}) })),
          React.createElement('div', null, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Contact Person'), React.createElement('input', { className:'border rounded px-3 py-2 w-full', value:editForm.contact_person || '', onChange:e=>setEditForm({...editForm, contact_person:e.target.value}) })),
          React.createElement('div', null, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Phone'), React.createElement('input', { className:'border rounded px-3 py-2 w-full', value:editForm.phone || '', onChange:e=>setEditForm({...editForm, phone:e.target.value}) })),
          React.createElement('div', { className:'md:col-span-2' }, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Email'), React.createElement('input', { type:'email', className:'border rounded px-3 py-2 w-full', value:editForm.email || '', onChange:e=>setEditForm({...editForm, email:e.target.value}) })),
          React.createElement('div', { className:'md:col-span-2' }, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Office Address'), React.createElement('textarea', { className:'border rounded px-3 py-2 w-full', rows:2, value:editForm.office_address || '', onChange:e=>setEditForm({...editForm, office_address:e.target.value}) })),
          React.createElement('div', { className:'md:col-span-2' }, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Warehouse Address'), React.createElement('textarea', { className:'border rounded px-3 py-2 w-full', rows:2, value:editForm.warehouse_address || '', onChange:e=>setEditForm({...editForm, warehouse_address:e.target.value}) }))
        ),
        React.createElement('div', { className:'flex justify-end gap-3 mt-6' },
          React.createElement('button', { onClick:()=>setEditingCustomer(null), className:'px-4 py-2 border rounded text-gray-700 hover:bg-gray-100' }, 'Cancel'),
          React.createElement('button', { onClick:saveEdit, className:'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700' }, 'Save Changes')
        )
      )
    )
  );
}

function VendorManagement({ vendors, onRefresh }){
  const [form, setForm] = useState({ id:'', name:'', contact_person:'', phone:'', email:'' });
  const [editingVendor, setEditingVendor] = useState(null);
  const [editForm, setEditForm] = useState({});

  async function add(){
    await fetch(`${API_URL}/vendors`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) });
    setForm({ id:'', name:'', contact_person:'', phone:'', email:'' });
    onRefresh?.();
  }

  async function saveEdit(){
    await fetch(`${API_URL}/vendors/${editForm.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(editForm) });
    setEditingVendor(null);
    onRefresh?.();
  }

  async function del(id){
    if(!confirm('Delete vendor?')) return;
    await fetch(`${API_URL}/vendors/${id}`, { method:'DELETE' });
    onRefresh?.();
  }

  const columns = [
    { key: 'id', label: 'Vendor ID' },
    { key: 'name', label: 'Name' },
    { key: 'contact_person', label: 'Contact Person' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'vendor_type', label: 'Type' },
    { key: 'material_type', label: 'Material Type' }
  ];

  function handleRowClick(vendor){
    setEditForm({ ...vendor });
    setEditingVendor(vendor);
  }

  return React.createElement('div', { className:'space-y-4' },
    React.createElement(Section, { title: 'Add Vendor' },
      React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-5 gap-3' },
        React.createElement('input', { className: 'border rounded px-3 py-2', placeholder: 'Vendor ID', value: form.id, onChange: e=>setForm({...form,id:e.target.value}) }),
        React.createElement('input', { className: 'border rounded px-3 py-2', placeholder: 'Name', value: form.name, onChange: e=>setForm({...form,name:e.target.value}) }),
        React.createElement('input', { className: 'border rounded px-3 py-2', placeholder: 'Contact Person', value: form.contact_person, onChange: e=>setForm({...form,contact_person:e.target.value}) }),
        React.createElement('input', { className: 'border rounded px-3 py-2', placeholder: 'Phone', value: form.phone, onChange: e=>setForm({...form,phone:e.target.value}) }),
        React.createElement('input', { className: 'border rounded px-3 py-2', placeholder: 'Email', value: form.email, onChange: e=>setForm({...form,email:e.target.value}) }),
        React.createElement('button', { onClick: add, className: 'px-4 py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700' }, 'Add Vendor')
      )
    ),
    React.createElement(EnhancedTable, {
      title: 'Vendors',
      data: vendors,
      columns: columns,
      primaryKey: 'id',
      onRowClick: handleRowClick,
      onDelete: del,
      onExport: (data, cols) => downloadCSV('vendors.csv', cols.map(c=>({key:c.key,label:c.label})), data)
    }),
    React.createElement(EditModal, { isOpen: !!editingVendor, onClose: () => setEditingVendor(null), title: `Edit Vendor: ${editForm.id || ''}` },
      React.createElement('div', { className:'space-y-4' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-2 gap-4' },
          React.createElement('div', null, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Vendor ID'), React.createElement('input', { className:'border rounded px-3 py-2 w-full bg-gray-100', value:editForm.id || '', disabled:true })),
          React.createElement('div', null, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Name'), React.createElement('input', { className:'border rounded px-3 py-2 w-full', value:editForm.name || '', onChange:e=>setEditForm({...editForm, name:e.target.value}) })),
          React.createElement('div', null, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Contact Person'), React.createElement('input', { className:'border rounded px-3 py-2 w-full', value:editForm.contact_person || '', onChange:e=>setEditForm({...editForm, contact_person:e.target.value}) })),
          React.createElement('div', null, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Phone'), React.createElement('input', { className:'border rounded px-3 py-2 w-full', value:editForm.phone || '', onChange:e=>setEditForm({...editForm, phone:e.target.value}) })),
          React.createElement('div', { className:'md:col-span-2' }, React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Email'), React.createElement('input', { type:'email', className:'border rounded px-3 py-2 w-full', value:editForm.email || '', onChange:e=>setEditForm({...editForm, email:e.target.value}) }))
        ),
        React.createElement('div', { className:'flex justify-end gap-3 mt-6' },
          React.createElement('button', { onClick:()=>setEditingVendor(null), className:'px-4 py-2 border rounded text-gray-700 hover:bg-gray-100' }, 'Cancel'),
          React.createElement('button', { onClick:saveEdit, className:'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700' }, 'Save Changes')
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
  const [editingProduct, setEditingProduct] = useState(null);
  const [editForm, setEditForm] = useState({});

  async function add(){
    await fetch(`${API_URL}/products`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...form, steel_diameter:Number(form.diameter), length:Number(form.length), copper_coating:Number(form.coating) }) });
    setForm({ id:'', description:'', diameter:0, length:0, coating:0 });
    onRefresh?.();
  }

  async function saveEdit(){
    await fetch(`${API_URL}/products/${editForm.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...editForm, steel_diameter:Number(editForm.steel_diameter), length:Number(editForm.length), copper_coating:Number(editForm.copper_coating) }) });
    setEditingProduct(null);
    onRefresh?.();
  }

  async function deleteProduct(id){
    if (!confirm('Delete product?')) return;
    await fetch(`${API_URL}/products/${id}`, { method:'DELETE' });
    onRefresh?.();
  }

  const columns = [
    { key: 'id', label: 'Product ID' },
    { key: 'description', label: 'Description' },
    { key: 'steel_diameter', label: 'Steel Dia (mm)', render: (val) => val || '-' },
    { key: 'length', label: 'Length (mm)', render: (val) => val || '-' },
    { key: 'length_ft', label: 'Length (ft)', render: (val, row) => row.length ? (row.length/304.8).toFixed(2) : '-' },
    { key: 'copper_coating', label: 'Copper (µm)', render: (val) => val || '-' },
    { key: 'cbg_diameter', label: 'CBG Dia (mm)', render: (val, row) => {
      if (!row.steel_diameter || !row.copper_coating) return '-';
      const cbg = row.steel_diameter + (2 * row.copper_coating / 1000);
      return cbg.toFixed(2);
    }},
    { key: 'cbg_weight', label: 'CBG Weight (kg)', render: (val, row) => {
      if (!row.steel_diameter || !row.copper_coating || !row.length) return '-';
      const w = calculateWeights(row.steel_diameter, row.copper_coating, row.length);
      return w.cbg;
    }}
  ];

  const enrichedProducts = products.map(p => ({
    ...p,
    steel_diameter: p.steel_diameter || p.diameter,
    copper_coating: p.copper_coating || p.coating
  }));

  function handleRowClick(product){
    setEditForm({
      id: product.id,
      description: product.description,
      steel_diameter: product.steel_diameter || product.diameter,
      length: product.length,
      copper_coating: product.copper_coating || product.coating
    });
    setEditingProduct(product);
  }

  function handleExport(data, cols){
    const headers = cols.map(c => ({ key: c.key, label: c.label }));
    const rows = data.map(p => {
      const w = calculateWeights(p.steel_diameter || p.diameter, p.copper_coating || p.coating, p.length);
      return {
        ...p,
        length_ft: p.length ? (p.length/304.8).toFixed(2) : '',
        cbg_diameter: (p.steel_diameter + (2 * (p.copper_coating||0) / 1000)).toFixed(2),
        cbg_weight: w.cbg
      };
    });
    downloadCSV('products.csv', headers, rows);
  }

  return (
    React.createElement('div', { className:'space-y-4' },
      React.createElement(Section, { title:'Add Product' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-3' },
          React.createElement('input', { className:'border rounded px-3 py-2', placeholder:'Product ID', value:form.id, onChange:e=>setForm({ ...form, id:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-3 py-2 md:col-span-2', placeholder:'Description', value:form.description, onChange:e=>setForm({ ...form, description:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-3 py-2', type:'number', placeholder:'Steel Dia (mm)', value:form.diameter, onChange:e=>setForm({ ...form, diameter:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-3 py-2', type:'number', placeholder:'Length (mm)', value:form.length, onChange:e=>setForm({ ...form, length:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-3 py-2', type:'number', placeholder:'Copper (µm)', value:form.coating, onChange:e=>setForm({ ...form, coating:e.target.value }) }),
          React.createElement('button', { onClick:add, className:'px-4 py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700' }, 'Add Product')
        )
      ),
      React.createElement(EnhancedTable, {
        title: 'Products',
        data: enrichedProducts,
        columns: columns,
        primaryKey: 'id',
        onRowClick: handleRowClick,
        onDelete: deleteProduct,
        onExport: handleExport
      }),
      React.createElement(EditModal, {
        isOpen: !!editingProduct,
        onClose: () => setEditingProduct(null),
        title: `Edit Product: ${editForm.id || ''}`
      },
        React.createElement('div', { className:'space-y-4' },
          React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-2 gap-4' },
            React.createElement('div', null,
              React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Product ID'),
              React.createElement('input', { className:'border rounded px-3 py-2 w-full bg-gray-100', value:editForm.id || '', disabled:true })
            ),
            React.createElement('div', { className:'md:col-span-1' },
              React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Description'),
              React.createElement('input', { className:'border rounded px-3 py-2 w-full', value:editForm.description || '', onChange:e=>setEditForm({...editForm, description:e.target.value}) })
            ),
            React.createElement('div', null,
              React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Steel Diameter (mm)'),
              React.createElement('input', { className:'border rounded px-3 py-2 w-full', type:'number', value:editForm.steel_diameter || '', onChange:e=>setEditForm({...editForm, steel_diameter:e.target.value}) })
            ),
            React.createElement('div', null,
              React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Length (mm)'),
              React.createElement('input', { className:'border rounded px-3 py-2 w-full', type:'number', value:editForm.length || '', onChange:e=>setEditForm({...editForm, length:e.target.value}) })
            ),
            React.createElement('div', null,
              React.createElement('label', { className:'block text-sm font-semibold text-gray-700 mb-1' }, 'Copper Coating (µm)'),
              React.createElement('input', { className:'border rounded px-3 py-2 w-full', type:'number', value:editForm.copper_coating || '', onChange:e=>setEditForm({...editForm, copper_coating:e.target.value}) })
            ),
            editForm.steel_diameter && editForm.copper_coating && editForm.length && React.createElement('div', { className:'md:col-span-2 bg-blue-50 border border-blue-200 rounded p-4' },
              React.createElement('h4', { className:'font-semibold text-blue-900 mb-2' }, 'Calculated Values'),
              React.createElement('div', { className:'grid grid-cols-2 gap-2 text-sm' },
                React.createElement('div', null, `CBG Diameter: ${(Number(editForm.steel_diameter) + (2 * Number(editForm.copper_coating) / 1000)).toFixed(2)} mm`),
                React.createElement('div', null, `CBG Weight: ${calculateWeights(Number(editForm.steel_diameter), Number(editForm.copper_coating), Number(editForm.length)).cbg} kg`)
              )
            )
          ),
          React.createElement('div', { className:'flex justify-end gap-3 mt-6' },
            React.createElement('button', { onClick:()=>setEditingProduct(null), className:'px-4 py-2 border rounded text-gray-700 hover:bg-gray-100' }, 'Cancel'),
            React.createElement('button', { onClick:saveEdit, className:'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700' }, 'Save Changes')
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