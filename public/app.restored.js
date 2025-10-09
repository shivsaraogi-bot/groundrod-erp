const { useState, useEffect, useCallback, useRef } = React;
// Flexible API base resolution
function __resolveApiUrl(){
  try {
    const qp = new URLSearchParams(window.location.search);
    const qApi = qp.get('api');
    if (qApi) { try { localStorage.setItem('API_URL', qApi); } catch(_){} return qApi; }
  } catch(_){ }
  if (window.API_URL) return window.API_URL;
  try { const ls = localStorage.getItem('API_URL'); if (ls) return ls; } catch(_){ }
  return window.location.origin + '/api';
}
const API_URL = __resolveApiUrl();
try { console.log('API_URL =', API_URL); } catch(_){ }

// Toast Notification System
const ToastContext = React.createContext();

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', action = null) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type, action }]);
    if (!action) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 5000);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return React.createElement(ToastContext.Provider, { value: { addToast, removeToast } },
    children,
    React.createElement(ToastContainer, { toasts, removeToast })
  );
}

function ToastContainer({ toasts, removeToast }) {
  return React.createElement('div', {
    className: 'fixed top-4 right-4 z-50 space-y-2',
    style: { maxWidth: '400px' }
  },
    toasts.map(toast => React.createElement(Toast, {
      key: toast.id,
      toast,
      onClose: () => removeToast(toast.id)
    }))
  );
}

function Toast({ toast, onClose }) {
  const colors = {
    success: 'bg-green-50 border-green-400 text-green-800',
    error: 'bg-red-50 border-red-400 text-red-800',
    warning: 'bg-yellow-50 border-yellow-400 text-yellow-800',
    info: 'bg-blue-50 border-blue-400 text-blue-800'
  };

  return React.createElement('div', {
    className: `${colors[toast.type]} border-l-4 p-4 rounded shadow-lg flex items-start gap-3`
  },
    React.createElement('div', { className: 'flex-1' },
      React.createElement('p', { className: 'font-semibold text-sm' }, toast.message),
      toast.action && React.createElement('button', {
        className: 'mt-2 text-xs font-bold underline hover:no-underline',
        onClick: () => { toast.action.onClick(); onClose(); }
      }, toast.action.label)
    ),
    React.createElement('button', {
      onClick: onClose,
      className: 'text-xl font-bold opacity-50 hover:opacity-100'
    }, '×')
  );
}

// Helper: Check inventory availability before PO creation
async function checkInventoryAvailability(lineItems) {
  try {
    const response = await fetch(`${API_URL}/inventory/check-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_items: lineItems })
    });
    return await response.json();
  } catch (error) {
    console.error('Availability check failed:', error);
    return { available: true, details: [], warnings: [] };
  }
}

// Helper: Undo soft delete
async function undoDelete(table, recordId) {
  const response = await fetch(`${API_URL}/undo/${table}/${recordId}`, {
    method: 'POST'
  });
  if (!response.ok) throw new Error('Undo failed');
  return await response.json();
}

// Global date formatter used across tabs
function formatLongDate(s){
  try {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString('en-GB', { year:'numeric', month:'short', day:'2-digit' });
  } catch(_) {
    return String(s||'');
  }
}

// API Error banner
function ApiErrorBanner({ error }){
  const resetApi = ()=>{ try { localStorage.setItem('API_URL', window.location.origin + '/api'); window.location.reload(); } catch(_){} };
  return React.createElement('div', { className:'bg-red-50 border-b border-red-200 text-red-800' },
    React.createElement('div', { className:'max-w-7xl mx-auto px-6 py-3 flex items-center gap-3' },
      React.createElement('div', { className:'font-semibold' }, 'API Error:'),
      React.createElement('div', null, error||'Failed to reach API'),
      React.createElement('button', { className:'ml-auto px-3 py-1 border rounded text-red-800', onClick: resetApi }, 'Use current origin')
    )
  );
}

function GroundRodERP() {
  const toast = React.useContext(ToastContext);
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
  const [companySettings, setCompanySettings] = useState(null);
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(true);
  // Filters / analytics
  const [rangeMode, setRangeMode] = useState({ mode: 'lastDays', days: 30, interval: 'day' });
  const [filter, setFilter] = useState({ marking: '', product_id: '' });

  useEffect(() => {
    const onDrill = (e) => {
      setActiveTab('inventory');
    };
    window.addEventListener('dash-drill', onDrill);
    return () => window.removeEventListener('dash-drill', onDrill);
  }, []);

  useEffect(() => { fetchAllData(); }, []);

  async function fetchAllData() {
    setApiError('');
    setLoading(true);
    const endpoints = [
      { name: 'products', url: `${API_URL}/products`, apply: (data) => setProducts(Array.isArray(data) ? data : []) },
      { name: 'customers', url: `${API_URL}/customers`, apply: (data) => setCustomers(Array.isArray(data) ? data : []) },
      { name: 'vendors', url: `${API_URL}/vendors`, apply: (data) => setVendors(Array.isArray(data) ? data : []) },
      { name: 'inventory', url: `${API_URL}/inventory`, apply: (data) => setInventory(Array.isArray(data) ? data : []) },
      { name: 'client-purchase-orders', url: `${API_URL}/client-purchase-orders`, apply: (data) => setClientPurchaseOrders(Array.isArray(data) ? data : []) },
      { name: 'vendor-purchase-orders', url: `${API_URL}/vendor-purchase-orders`, apply: (data) => setVendorPurchaseOrders(Array.isArray(data) ? data : []) },
      { name: 'shipments', url: `${API_URL}/shipments`, apply: (data) => setShipments(Array.isArray(data) ? data : []) },
      { name: 'raw-materials', url: `${API_URL}/raw-materials`, apply: (data) => setRawMaterials(Array.isArray(data) ? data : []) },
      { name: 'dashboard-stats', url: `${API_URL}/dashboard/stats`, apply: (data) => setDashboardStats(data && typeof data === 'object' ? data : {}) },
      { name: 'risk-analysis', url: `${API_URL}/dashboard/risk-analysis`, apply: (data) => setRiskAnalysis(data && typeof data === 'object' ? data : {}) },
      { name: 'company', url: `${API_URL}/company`, apply: (data) => setCompanySettings(data && typeof data === 'object' ? data : null) }
    ];
    const results = await Promise.allSettled(endpoints.map(ep => fetch(ep.url)));
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      const endpoint = endpoints[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        const response = result.value;
        if (!response.ok) {
          errors.push(`${endpoint.name}: ${response.status} ${response.statusText || ''}`.trim());
          continue;
        }
        try {
          const data = await response.json();
          endpoint.apply(data);
        } catch (parseErr) {
          console.error(`Failed to parse ${endpoint.name} response`, parseErr);
          errors.push(`${endpoint.name}: invalid response`);
        }
      } else {
        const reason = result.reason && result.reason.message ? result.reason.message : 'request failed';
        errors.push(`${endpoint.name}: ${reason}`);
      }
    }
    if (errors.length) {
      setApiError(`Some data failed to load. ${errors.join('; ')}`);
    }
    setLoading(false);
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
    // Copper shell volume (cylindrical shell, thin wall): approx 2Ï€r t L
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
      apiError && React.createElement(ApiErrorBanner, { error: apiError }),
      React.createElement(NavTabs, { activeTab, setActiveTab, company: companySettings }),
      React.createElement('main', { className: 'max-w-7xl mx-auto px-6 py-6' },
        activeTab === 'dashboard' && React.createElement(Dashboard, { stats: dashboardStats, riskAnalysis, clientPurchaseOrders, inventory }),
        activeTab === 'production' && React.createElement(DailyProduction, { products, onSubmit: fetchAllData }),
        activeTab === 'client-orders' && React.createElement(ClientPurchaseOrders, { purchaseOrders: clientPurchaseOrders, products, customers, onRefresh: fetchAllData, company: companySettings }),
        activeTab === 'vendor-orders' && React.createElement(VendorPurchaseOrdersEx, { purchaseOrders: vendorPurchaseOrders, vendors, onRefresh: fetchAllData, company: companySettings }),
        activeTab === 'job-work' && React.createElement(JobWorkTab, { products, onRefresh: fetchAllData }),
        activeTab === 'bom' && React.createElement(BOMTab, { products, rawMaterials, calculateWeights }),
        activeTab === 'shipments' && React.createElement(Shipments, { shipments, purchaseOrders: clientPurchaseOrders, products, onRefresh: fetchAllData }),
        activeTab === 'inventory' && React.createElement(InventoryViewEx, { inventory, rawMaterials, products, customers, onRefresh: fetchAllData, filter, setFilter, rangeMode, setRangeMode }),
        activeTab === 'products' && React.createElement(ProductMasterEx, { products, rawMaterials, calculateWeights, onRefresh: fetchAllData }),
        activeTab === 'customers' && React.createElement(CustomerManagementEx, { customers, onRefresh: fetchAllData }),
        activeTab === 'vendors' && React.createElement(VendorManagement, { vendors, onRefresh: fetchAllData }),
        /* Imports tab removed; import is now per-tab */
        activeTab === 'letters' && React.createElement(LettersPanel, { company: companySettings }),
        activeTab === 'settings' && React.createElement(CompanySettingsPanel, { company: companySettings, products, rawMaterials, onSaved: async ()=>{ try{ const r=await fetch(`${API_URL}/company`); setCompanySettings(await r.json()); }catch(_){} } })
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

function NavTabs({ activeTab, setActiveTab, company }){
  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'production', label: 'Production' },
    { id: 'client-orders', label: 'Client Orders' },
    { id: 'vendor-orders', label: 'Vendor Orders' },
    { id: 'job-work', label: 'Job Work' },
    { id: 'bom', label: 'BOM' },
    { id: 'shipments', label: 'Shipments' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'products', label: 'Products' },
    { id: 'customers', label: 'Customers' },
    { id: 'vendors', label: 'Vendors' },
    { id: 'letters', label: 'Letters' },
    { id: 'settings', label: 'Settings' },
    // Assistant tab removed in favor of floating chatbot
  ];
  // fallback logo as inline SVG data URL
  const fallbackSvg = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="140" height="36"><rect width="140" height="36" fill="white"/><text x="8" y="24" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800" fill="#167DB7">Nikkon Ferro</text></svg>`);
  const logoUrl = (company && company.logo_url) ? company.logo_url : '';
  const resolvedLogo = logoUrl ? (logoUrl.startsWith('http') ? logoUrl : (logoUrl.startsWith('/') ? logoUrl : '/' + logoUrl)) : '';
  const onLogoError = (e)=>{ try{ e.target.onerror=null; e.target.src=fallbackSvg; }catch(_){} };
  return (
    React.createElement('nav', { className: 'bg-white shadow-md border-b-2 border-gray-200' },
      React.createElement('div', { className: 'max-w-7xl mx-auto px-6 ribbon-wrap' },
        React.createElement('div', { className: 'flex items-center gap-3 py-2' },
          React.createElement('img', { src: resolvedLogo || fallbackSvg, onError: onLogoError, alt:'Nikkon Ferro', style:{ height:36 } }),
          React.createElement('div', { className: 'flex gap-1 overflow-x-auto nav-scroll' },
            tabs.map(tab => (
              React.createElement('button', {
                key: tab.id, onClick: () => setActiveTab(tab.id),
                className: `px-5 py-3 font-semibold transition-all whitespace-nowrap rounded-t-lg ${activeTab === tab.id ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-blue-50'}`
              }, tab.label)
            ))
          )
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
          React.createElement('h3', { className: 'text-lg font-bold mb-4 text-gray-800' }, 'Urgent Client Orders'),
          React.createElement('div', { className: 'space-y-2' },
            clientPurchaseOrders.filter(po => po.priority === 'Urgent' && po.status !== 'Completed').slice(0, 5).map(po => (
              React.createElement('div', { key: po.id, className: 'p-3 bg-red-50 rounded-lg border-l-4 border-red-400' },
                React.createElement('div', { className: 'flex justify-between' },
                  React.createElement('div', null,
                    React.createElement('div', { className: 'font-bold text-sm' }, `${po.id} - ${po.customer_name}`),
                    React.createElement('div', { className: 'text-xs text-gray-600' }, `Due: ${formatLongDate(po.due_date)}`)
                  ),
                  React.createElement('div', { className: 'text-right' },
                    React.createElement('div', { className: 'font-bold text-red-600 text-sm' }, po.currency)
                  )
                )
              )
            ))
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
  if (typeof window !== 'undefined' && !window.Chart){
    return React.createElement('div', { className:'bg-white rounded-xl shadow-md p-6 border border-gray-200' },
      React.createElement('div', { className:'text-sm text-gray-600' }, 'Charts unavailable (Chart.js not loaded).')
    );
  }
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
  const [selectedRecent, setSelectedRecent] = useState([]);
  const allRecentSelected = selectedRecent.length>0 && selectedRecent.length === recent.length;
  function toggleRecent(id){ setSelectedRecent(prev=> prev.includes(id)? prev.filter(x=>x!==id) : [...prev, id]); }
  function toggleRecentAll(){ setSelectedRecent(allRecentSelected ? [] : recent.map(r=>r.id)); }
  async function deleteSelectedRecent(){ if(!selectedRecent.length) return; if(!confirm(`Delete ${selectedRecent.length} production entries? This rolls back inventory.`)) return; const r=await fetch(`${API_URL}/production/bulk-delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids: selectedRecent }) }); const res=await r.json(); if(!r.ok){ alert(res.error||'Bulk delete failed'); return; } if(res.failed && res.failed.length) alert(`Some failed: ${res.failed.map(f=>f.id).join(', ')}`); setSelectedRecent([]); loadRecent(limit); }
  const [prodSearch, setProdSearch] = useState('');
  const [searchBy, setSearchBy] = useState('id');
  const [entryTexts, setEntryTexts] = useState([]);
  async function loadRecent(l){
    try { const r = await fetch(`${API_URL}/production?limit=${encodeURIComponent(l||limit)}`); setRecent(await r.json()); } catch {}
  }

  // Pretty date formatter: '2025-10-10' -> '10th, October, 2025'
  function formatLongDate(s){
    if(!s) return '';
    try{
      let y, m, d;
      const m1 = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m1){ y=+m1[1]; m=+m1[2]; d=+m1[3]; }
      else {
        const dt = new Date(s);
        if (isNaN(dt.getTime())) return s;
        y = dt.getFullYear(); m = dt.getMonth()+1; d = dt.getDate();
      }
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const suf = (n)=>{ const j=n%10, k=n%100; if(k>=11&&k<=13) return 'th'; if(j===1) return 'st'; if(j===2) return 'nd'; if(j===3) return 'rd'; return 'th'; };
      return `${d}${suf(d)}, ${months[m-1]}, ${y}`;
    } catch{ return s; }
  }
  useEffect(()=>{ loadRecent(limit); },[]);
  function getProductLabel(pid){ const p = (products||[]).find(x=>x.id===pid); return p ? `${p.id} - ${p.description}` : (pid||''); }
  function addEntry(){
    const newEn = { product_id: products[0]?.id || '', plated:0,machined:0,qc:0,stamped:0,packed:0,rejected:0,notes:'' };
    setEntries([...entries, newEn]);
    setEntryTexts([...entryTexts, getProductLabel(newEn.product_id)]);
  }
  function updateEntry(i, field, val){ const e=[...entries]; e[i][field]= (['notes','product_id'].includes(field))? val : Number(val||0); setEntries(e); }
  async function save(){ await fetch(`${API_URL}/production`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ date, entries }) }); setEntries([]); onSubmit?.(); alert('Production saved'); loadRecent(limit); }
  const filteredProducts = (products||[]).filter(p => {
    if (!prodSearch) return true;
    const q = prodSearch.toLowerCase();
    return searchBy==='id' ? (p.id||'').toLowerCase().includes(q) : (p.description||'').toLowerCase().includes(q);
  });
  function guessProductIdFromInput(text){
    const v = (text||'').trim(); if (!v) return '';
    const byId = (products||[]).find(p=> (p.id||'').toLowerCase()===v.toLowerCase()); if (byId) return byId.id;
    const idx = v.indexOf(' - '); if (idx>0) return v.slice(0, idx);
    const lc = v.toLowerCase(); const matches = (products||[]).filter(p=> (p.description||'').toLowerCase().includes(lc));
    if (matches.length===1) return matches[0].id;
    return '';
  }
  function setEntryText(i, text){ const arr=[...entryTexts]; arr[i]=text; setEntryTexts(arr); }
  return (
    React.createElement('div', { className: 'bg-white rounded-xl shadow-md p-6 border border-gray-200 space-y-4' },
      React.createElement('div', { className: 'flex gap-3 items-end flex-wrap' },
        React.createElement('div', null,
          React.createElement('label', { className: 'text-sm font-semibold text-gray-700' }, 'Date'),
          React.createElement('input', { type: 'date', value: date, onChange: e=>setDate(e.target.value), className: 'ml-2 border rounded px-2 py-1' })
        ),
        React.createElement('button', { onClick: addEntry, className: 'px-3 py-2 bg-blue-600 text-white rounded' }, 'Add Line'),
        React.createElement('button', { onClick: save, className: 'px-3 py-2 bg-green-600 text-white rounded' }, 'Save'),
        React.createElement('div', { className:'ml-auto flex items-end gap-2' },
          React.createElement('div', null,
            React.createElement('label', { className:'text-sm font-semibold text-gray-700' }, 'Search Products'),
            React.createElement('input', { className:'ml-2 border rounded px-2 py-1', placeholder: searchBy==='id'?'By ID':'By Description', value: prodSearch, onChange:e=>setProdSearch(e.target.value) })
          ),
          React.createElement('div', null,
            React.createElement('label', { className:'text-sm font-semibold text-gray-700 mr-2' }, 'Search By'),
            React.createElement('select', { className:'border rounded px-2 py-1', value:searchBy, onChange:e=>setSearchBy(e.target.value) },
              React.createElement('option', { value:'id' }, 'Product ID'),
              React.createElement('option', { value:'desc' }, 'Description')
            )
          )
        )
      ),
      React.createElement('div', { className: 'overflow-x-auto' },
        React.createElement('table', { className: 'min-w-full border-collapse' },
          React.createElement('thead', null,
            React.createElement('tr', { className: 'bg-gray-100' },
              ['Product','Plated','Machined','QC','Stamped','Packed','Rejected','Notes'].map(h=> React.createElement('th', { key: h, className: 'p-2' }, h))
            ),
          ),
          React.createElement('tbody', null,
            entries.map((en,i)=> (
              React.createElement('tr', { key: i, className: 'border-b' },
                React.createElement('td', { className: 'p-2' },
                  React.createElement('input', { list:`prodlist-${i}`, className:'border rounded px-2 py-1 w-72', value: (entryTexts[i]!==undefined? entryTexts[i] : getProductLabel(en.product_id)), placeholder:'Type ID or Description', onChange:e=>{ const t=e.target.value; setEntryText(i,t); const gid=guessProductIdFromInput(t); if(gid){ updateEntry(i,'product_id', gid); setEntryText(i, getProductLabel(gid)); } } }),
                  React.createElement('datalist', { id:`prodlist-${i}` },
                    filteredProducts.map(p=> React.createElement('option', { key:p.id, value: `${p.id} - ${p.description}` }))
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
          React.createElement('span', { className:'text-sm text-gray-600' }, 'entries'),
          React.createElement('button', { className:'ml-auto px-3 py-2 bg-red-600 text-white rounded disabled:opacity-50', disabled:!selectedRecent.length, onClick: deleteSelectedRecent }, `Delete Selected (${selectedRecent.length||0})`)
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' },
                React.createElement('th', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked: allRecentSelected, onChange: toggleRecentAll })),
                ['Date','Product','Plated','Machined','QC','Stamped','Packed','Rejected','Notes','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h))
              )
            ),
            React.createElement('tbody', null,
              recent.map((r,i)=> (
                React.createElement('tr', { key:i, className:'border-b' },
                  React.createElement('td', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked:selectedRecent.includes(r.id), onChange:()=>toggleRecent(r.id) })),
                  React.createElement('td', { className:'p-2' }, formatLongDate(r.production_date)),
                  React.createElement('td', { className:'p-2' }, r.product_description || r.product_id),
                  React.createElement('td', { className:'p-2 text-center' }, r.plated||0),
                  React.createElement('td', { className:'p-2 text-center' }, r.machined||0),
                  React.createElement('td', { className:'p-2 text-center' }, r.qc||0),
                  React.createElement('td', { className:'p-2 text-center' }, r.stamped||0),
                  React.createElement('td', { className:'p-2 text-center' }, r.packed||0),
                  React.createElement('td', { className:'p-2 text-center' }, r.rejected||0),
                  React.createElement('td', { className:'p-2' }, r.notes||''),
                  React.createElement('td', { className:'p-2 text-right' },
                    React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick: async ()=>{
                      if(!confirm('Delete this production entry?')) return;
                      try {
                        const resp = await fetch(`${API_URL}/production/${encodeURIComponent(r.id)}`, { method:'DELETE' });
                        const res = await resp.json();
                        if(!resp.ok){ alert(res.error||'Delete failed'); return; }
                        loadRecent(limit);
                        alert('Deleted');
                      } catch(e){ alert('Delete failed'); }
                    } }, 'Delete')
                  )
                )
              ))
            )
          )
        )
      )
    )
  );
}

function ClientPurchaseOrders({ purchaseOrders, products, customers, onRefresh, company }){
  const [form, setForm] = useState({ id:'', customer_id:'', po_date:'', due_date:'', currency:'INR', status:'Pending', delivery_terms:'FOB', payment_terms:'' , notes:'' });
  // Optional line items to create along with the PO (support new product creation)
  const [newItems, setNewItems] = useState([]);
  function addNewItem(){ setNewItems([ ...newItems, { product_id:'', quantity:0, unit_price:0, new_product:false, new_product_id:'', description:'', diameter:0, length:0, coating:0 } ]); }
  function updateNewItem(i, k, v){ const arr=[...newItems]; arr[i][k] = (k==='product_id'||k==='description')? v : (k==='new_product'? !!v : Number(v||0)); setNewItems(arr); }
  function removeNewItem(i){ const arr=[...newItems]; arr.splice(i,1); setNewItems(arr); }
  const [editing, setEditing] = useState(null);
  const [cols, setCols] = useState({ id:true, customer:true, po_date:true, due_date:true, delivery_terms:true, payment_terms:true, status:true, notes:true });
  const [expanded, setExpanded] = useState({});
  const [poItems, setPoItems] = useState({});
  const [loadingItems, setLoadingItems] = useState({});
  const [selected, setSelected] = useState([]);
  const [importPreview, setImportPreview] = useState(null);
  const [importItems, setImportItems] = useState([]);
  const [useNewCustomer, setUseNewCustomer] = useState(false);
  const [localOrders, setLocalOrders] = useState(Array.isArray(purchaseOrders) ? purchaseOrders : []);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const listSectionRef = React.useRef(null);
  useEffect(() => { setLocalOrders(Array.isArray(purchaseOrders) ? purchaseOrders : []); }, [purchaseOrders]);
  useEffect(() => {
    setSelected(prev => prev.filter(id => localOrders.some(po => po.id === id)));
  }, [localOrders]);
  useEffect(() => {
    if (!Array.isArray(purchaseOrders) || purchaseOrders.length === 0) {
      refreshLocalOrders(false);
    }
    // intentionally run once on mount
  }, []);
  async function refreshLocalOrders(triggerGlobalRefresh = false) {
    setListLoading(true);
    setListError('');
    try {
      const resp = await fetch(`${API_URL}/client-purchase-orders`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setLocalOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to refresh client POs', err);
      setListError(err && err.message ? err.message : 'Failed to load client POs');
    } finally {
      setListLoading(false);
      if (triggerGlobalRefresh && typeof onRefresh === 'function') {
        try { onRefresh(); } catch(_) {}
      }
    }
  }
  const allSelected = selected.length>0 && selected.length === localOrders.length;
  function toggle(id){ setSelected(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]); }
  function toggleAll(){ setSelected(allSelected ? [] : localOrders.map(po=>po.id)); }
  async function deleteSelected(){
    if(!selected.length) return;
    if(!confirm(`Delete ${selected.length} PO(s)? Shipments must be deleted first.`)) return;
    const r=await fetch(`${API_URL}/purchase-orders/bulk-delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids: selected }) });
    const res=await r.json();
    if(!r.ok){ alert(res.error||'Bulk delete failed'); return; }
    if(res.failed && res.failed.length) alert(`Some failed: ${res.failed.map(f=>f.id).join(', ')}`);
    setSelected([]);
    await refreshLocalOrders(true);
  }
  const [poModal, setPoModal] = useState(null);
  function openPo(po){ setPoModal({ ...po }); }
  async function savePoModal(){
    const p=poModal;
    const r=await fetch(`${API_URL}/purchase-orders/${encodeURIComponent(p.id)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(p) });
    const res=await r.json();
    if(!r.ok){ alert(res.error||'Save failed'); return; }
    setPoModal(null);
    await refreshLocalOrders(true);
  }
  async function exportClientPo(po, format){
    try{
      const r = await fetch(`${API_URL}/client-purchase-orders/${encodeURIComponent(po.id)}`);
      const full = await r.json(); if(!r.ok) throw new Error(full.error||'Failed to load');
      const items = full.line_items || [];
      const html = buildPOHtml({ company, headerTitle:'Client Purchase Order', partyName: full.customer_name||full.customer_id, partyAddress:'', po: full, items, totals: items.reduce((s,it)=> s + Number(it.quantity||0)*Number(it.unit_price||0), 0) });
      const container = document.createElement('div'); container.innerHTML = html; document.body.appendChild(container);
      if (format==='pdf'){ await html2pdf().from(container).set({ margin:10, filename:`client-po-${po.id}.pdf` }).save(); }
      else { const blob = new Blob([html], { type:'application/msword' }); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`client-po-${po.id}.doc`; a.click(); URL.revokeObjectURL(url); }
      document.body.removeChild(container);
    }catch(e){ alert(e.message||'Export failed'); }
  }
  function formatPaymentTermsPreview(ap, after){
    const pct = Math.max(0, Math.min(100, Number(ap||0)));
    const bal = Math.max(0, 100 - pct);
    if (!after) return pct ? `${pct}% advance, balance ${bal}%` : '';
    return pct ? `${pct}% advance, balance ${bal}% ${after}` : `Balance ${after}`;
  }
  const [payAdvance, setPayAdvance] = useState(0);
  const [payAfter, setPayAfter] = useState('At dispatch');
  async function add(){
    if (!form.id || !form.customer_id || !form.po_date || !form.due_date){ alert('Please enter PO ID, Customer, PO Date and Due Date'); return; }
    // Create any new products first
    try{
      for (const it of newItems){
        if (it.new_product){
          const pid = (it.new_product_id||'').trim() || `P${Date.now().toString().slice(-6)}`;
          const pd = { id: pid, description: (it.description||'').trim() || `${(it.diameter||0).toFixed(1)}mm x ${(Number(it.length||0)/304.8).toFixed(1)}ft - ${(it.coating||0)}µm`, diameter:Number(it.diameter||0), length:Number(it.length||0), coating:Number(it.coating||0) };
          const pr = await fetch(`${API_URL}/products`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(pd) });
          if (!pr.ok){ const eres = await pr.json().catch(()=>({})); alert(eres.error||'Failed to create product'); return; }
          it.product_id = pid;
        }
      }
    }catch(e){ alert(e.message||'Failed while creating products'); return; }
    const line_items = (newItems||[]).filter(it => it.product_id).map(it => ({ product_id: it.product_id, quantity: Number(it.quantity||0), unit_price: Number(it.unit_price||0) }));
    const payload = { ...form, payment_terms: formatPaymentTermsPreview(payAdvance, payAfter), line_items };
    try{
      const r = await fetch(`${API_URL}/purchase-orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const res = await r.json().catch(()=>({}));
      if (!r.ok){ alert(res.error || 'Failed to add PO'); return; }
      alert(res.message || 'Client PO added');
      setForm({ id:'', customer_id:'', po_date:'', due_date:'', currency:'INR', status:'Pending', delivery_terms:'FOB', payment_terms:'', notes:'' });
      setNewItems([]);
      setPayAdvance(0); setPayAfter('At dispatch');
      await refreshLocalOrders(true);
      setTimeout(() => {
        if (listSectionRef.current) {
          listSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }catch(e){ alert(e.message || 'Failed to add PO'); }
  }
  async function save(po){
    const resp = await fetch(`${API_URL}/purchase-orders/${po.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(po) });
    const res = await resp.json().catch(()=>({}));
    if(!resp.ok){ alert(res.error||'Save failed'); return; }
    setEditing(null);
    await refreshLocalOrders(true);
  }
  async function del(id){
    if(!confirm('Delete Client PO?')) return;
    const resp = await fetch(`${API_URL}/purchase-orders/${id}`, { method:'DELETE' });
    const res = await resp.json().catch(()=>({}));
    if(!resp.ok){ alert(res.error||'Delete failed'); return; }
    await refreshLocalOrders(true);
  }
  async function toggleItems(id){
    const isOpen = !!expanded[id];
    const next = { ...expanded, [id]: !isOpen };
    setExpanded(next);
    if (!isOpen && !poItems[id]){
      setLoadingItems({ ...loadingItems, [id]: true });
      try {
        const r = await fetch(`${API_URL}/client-purchase-orders/${encodeURIComponent(id)}`);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error||'Failed to load items');
        setPoItems(prev => ({ ...prev, [id]: (data.line_items||[]) }));
      } catch (e) {
        alert(e.message||'Failed to load items');
      } finally {
        setLoadingItems(prev => ({ ...prev, [id]: false }));
      }
    }
  }
  const colCount = (cols.id?1:0) + (cols.customer?1:0) + (cols.po_date?1:0) + (cols.due_date?1:0) + (cols.status?1:0) + (cols.notes?1:0) + 1; // + Actions
  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title:'Add Client PO' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-8 gap-4 items-end' },
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'PO ID'),
            React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'PO-1001', value: form.id, onChange:e=>setForm({...form,id:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1 md:col-span-2' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Customer'),
            React.createElement('select', { className:'border rounded px-3 py-2 h-10 text-sm w-full', value: form.customer_id, onChange:e=>setForm({...form,customer_id:e.target.value}) },
              React.createElement('option', { value:'' }, 'Select Customer'),
              customers.map(c => React.createElement('option', { key:c.id, value:c.id }, `${c.id} - ${c.name}`))
            )
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'PO Date'),
            React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', type:'date', value: form.po_date, onChange:e=>setForm({...form,po_date:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Due Date'),
            React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', type:'date', value: form.due_date, onChange:e=>setForm({...form,due_date:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Delivery Terms'),
            React.createElement('select', { className:'border rounded px-3 py-2 h-10 text-sm w-full', value: form.delivery_terms, onChange:e=>setForm({...form, delivery_terms:e.target.value}) },
              ['FOB','CIF','Door Delivery','DDP','Factory Ex Works'].map(x=> React.createElement('option', { key:x, value:x }, x))
            )
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Advance %'),
            React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full text-right', type:'number', min:0, max:100, value:payAdvance, onChange:e=>setPayAdvance(Number(e.target.value||0)) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Remaining Balance'),
            React.createElement('select', { className:'border rounded px-3 py-2 h-10 text-sm w-full', value:payAfter, onChange:e=>setPayAfter(e.target.value) },
              ['At dispatch','30 days Net from B/L','56 days Net from B/L','60 days Net from B/L','90 days Net from B/L','At B/L release'].map(x=> React.createElement('option', { key:x, value:x }, x))
            ),
            React.createElement('div', { className:'text-[11px] text-gray-500 leading-tight' }, `Balance terms: ${formatPaymentTermsPreview(payAdvance, payAfter)}`)
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Status'),
            React.createElement('select', { className:'border rounded px-3 py-2 h-10 text-sm w-full', value: form.status, onChange:e=>setForm({...form,status:e.target.value}) },
              ['Pending','Confirmed','In Production','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))
            )
          ),
          React.createElement('div', { className:'flex md:justify-end' },
            React.createElement('button', { onClick:add, className:'h-10 px-5 bg-green-600 text-white rounded font-semibold shadow-sm' }, 'Add')
          )
        ),
        // Optional line items (existing products only)
        React.createElement('div', { className:'pt-2 border-t mt-3' },
          React.createElement('div', { className:'flex justify-between items-center mb-2' },
            React.createElement('h4', { className:'font-semibold' }, 'Line Items (optional)'),
            React.createElement('button', { className:'px-3 py-1 bg-blue-600 text-white rounded text-sm', onClick:addNewItem }, 'Add Item')
          ),
          React.createElement('div', { className:'overflow-x-auto' },
            React.createElement('table', { className:'min-w-full border-collapse' },
              React.createElement('thead', null,
                React.createElement('tr', { className:'bg-gray-100' }, ['Product','New?','New Product ID','Description','Dia (mm)','Len (mm)','Cu (µm)','Qty','Unit Price','Line Total','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2 text-left' }, h)))
              ),
              React.createElement('tbody', null,
                newItems.map((it, i) => (
                  React.createElement('tr', { key:i, className:'border-b' },
                    React.createElement('td', { className:'p-2' },
                      React.createElement('select', { className:'border rounded px-2 py-1 min-w-[16rem]', value:it.product_id||'', onChange:e=>updateNewItem(i,'product_id', e.target.value) },
                        React.createElement('option', { value:'' }, '-- Select Product --'),
                        (products||[]).map(p => React.createElement('option', { key:p.id, value:p.id }, `${p.id} - ${p.description}`))
                      )
                    ),
                    React.createElement('td', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked:!!it.new_product, onChange:e=>updateNewItem(i,'new_product', e.target.checked) })),
                    React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-32', placeholder:'Optional', value:it.new_product_id||'', onChange:e=>updateNewItem(i,'new_product_id', e.target.value) })),
                    React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Description', value:it.description||'', onChange:e=>updateNewItem(i,'description', e.target.value) })),
                    React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24 text-right', value:it.diameter||0, onChange:e=>updateNewItem(i,'diameter', e.target.value) })),
                    React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24 text-right', value:it.length||0, onChange:e=>updateNewItem(i,'length', e.target.value) })),
                    React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24 text-right', value:it.coating||0, onChange:e=>updateNewItem(i,'coating', e.target.value) })),
                    React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24 text-right', value:it.quantity, onChange:e=>updateNewItem(i,'quantity', e.target.value) })),
                    React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', step:'0.01', className:'border rounded px-2 py-1 w-28 text-right', value:it.unit_price, onChange:e=>updateNewItem(i,'unit_price', e.target.value) })),
                    React.createElement('td', { className:'p-2 text-right' }, ((Number(it.quantity||0)*Number(it.unit_price||0))||0).toFixed(2)),
                    React.createElement('td', { className:'p-2 text-right' }, React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>removeNewItem(i) }, 'Remove'))
                  )
                )),
                newItems.length===0 && React.createElement('tr', null, React.createElement('td', { className:'p-2 text-sm text-gray-500', colSpan:11 }, 'No items added'))
              )
            )
          )
        )
      ),
      React.createElement(Section, { title:'Import Client PO (PDF)' },
        React.createElement('div', { className:'space-y-4' },
          React.createElement('div', { className:'flex flex-col md:flex-row md:items-center gap-3' },
            React.createElement('label', { className:'text-sm font-semibold text-gray-700' }, 'Upload PDF'),
            React.createElement('input', { type:'file', accept:'application/pdf', className:'text-sm', onChange: async (e)=>{
              const f=e.target.files&&e.target.files[0]; if(!f) return; const fd=new FormData(); fd.append('file', f);
              const r=await fetch(`${API_URL}/import/client-po/preview`, { method:'POST', body: fd }); const data=await r.json(); if(!r.ok){ alert(data.error||'Failed to parse'); return; }
              const normalizedItems = Array.isArray(data.items) ? data.items.map(it => ({
                product_id: it.product_id || '',
                description: it.description || '',
                quantity: Number(it.quantity||0),
                unit_price: Number(it.unit_price||0),
                unit: it.unit || 'pcs'
              })) : [];
              setImportPreview({
                po: { currency:'INR', status:'Pending', notes:'', marking:'', ...(data.po||{}) },
                text: data.text || '',
                warning: data.warning || '',
                file_token: data.file_token || ''
              });
              setImportItems(normalizedItems.length ? normalizedItems : []);
              setUseNewCustomer(false);
            }})
          ),
          importPreview && React.createElement(React.Fragment, null,
            React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-4' },
              importPreview.warning && React.createElement('div', { className:'md:col-span-6 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-3 py-2' }, importPreview.warning),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'PO ID'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'PO-1001', value:importPreview.po?.id||'', onChange:e=>setImportPreview(prev=>({ ...prev, po:{ ...(prev.po||{}), id:e.target.value } })) })
              ),
              React.createElement('div', { className:'space-y-1 md:col-span-2' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Customer'),
                React.createElement('div', { className:'flex items-center gap-2' },
                  React.createElement('select', { className:'border rounded px-3 py-2 h-10 text-sm w-full', value:useNewCustomer? '' : (importPreview.po?.customer_id||''), onChange:e=>{ setUseNewCustomer(false); setImportPreview(prev=>({ ...prev, po:{ ...(prev.po||{}), customer_id:e.target.value, customer_name:'' } })); } },
                    React.createElement('option', { value:'' }, 'Select existing customer'),
                    customers.map(c=> React.createElement('option', { key:c.id, value:c.id }, `${c.id} - ${c.name}`))
                  ),
                  React.createElement('span', { className:'text-xs text-gray-500 whitespace-nowrap' }, 'or'),
                  React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm flex-1', placeholder:'New customer name', value:useNewCustomer? (importPreview.po?.customer_name||''):'', onChange:e=>{ setUseNewCustomer(true); setImportPreview(prev=>({ ...prev, po:{ ...(prev.po||{}), customer_name:e.target.value, customer_id:'' } })); } })
                )
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'PO Date'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', type:'date', value:importPreview.po?.po_date||'', onChange:e=>setImportPreview(prev=>({ ...prev, po:{ ...(prev.po||{}), po_date:e.target.value } })) })
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Due Date'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', type:'date', value:importPreview.po?.due_date||'', onChange:e=>setImportPreview(prev=>({ ...prev, po:{ ...(prev.po||{}), due_date:e.target.value } })) })
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Marking'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'Shipment marking / customer ref', value:importPreview.po?.marking||'', onChange:e=>setImportPreview(prev=>({ ...prev, po:{ ...(prev.po||{}), marking:e.target.value } })) })
              ),
              React.createElement('div', { className:'space-y-1 md:col-span-2' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Notes'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'Optional internal notes', value:importPreview.po?.notes||'', onChange:e=>setImportPreview(prev=>({ ...prev, po:{ ...(prev.po||{}), notes:e.target.value } })) })
              ),
              importItems.length > 0 && React.createElement('div', { className:'md:col-span-6 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2' }, `${importItems.length} line item(s) extracted from PDF. Please verify before confirming.`),
              React.createElement('div', { className:'md:col-span-6 flex flex-wrap gap-3 justify-end' },
                React.createElement('button', { className:'px-4 py-2 bg-green-600 text-white rounded font-semibold shadow-sm', onClick: async ()=>{
                  const po = importPreview.po||{};
                  if(!po.id || !po.po_date || !po.due_date){ alert('Fill PO ID, PO Date, and Due Date before confirming.'); return; }
                  for (const row of importItems){
                    if (!row.useNewProduct && !(row.product_id||'').trim()){
                      alert('Select an existing product for each line item or mark it as new.');
                      return;
                    }
                    if (row.useNewProduct && !(row.new_product_id||'').trim()){
                      alert('Enter a New Product ID for line items flagged as new.');
                      return;
                    }
                  }
                  const itemsPayload = importItems.map(row => ({
                    product_id: row.useNewProduct ? '' : (row.product_id||''),
                    new_product: !!row.useNewProduct,
                    new_product_id: row.useNewProduct ? (row.new_product_id||'') : undefined,
                    description: row.description || '',
                    diameter_value: Number(row.diameter||0),
                    diameter_unit: 'mm',
                    length_value: Number(row.length||0),
                    length_unit: 'mm',
                    coating_um: Number(row.coating||0),
                    quantity: Number(row.quantity||0),
                    unit_price: Number(row.unit_price||0),
                    unit: row.unit || 'pcs'
                  }));
                  const body={ id:po.id, customer_id: useNewCustomer? '' : (po.customer_id||''), customer_name: useNewCustomer? (po.customer_name||''):'', po_date:po.po_date, due_date:po.due_date, currency: po.currency||'INR', status: po.status||'Pending', delivery_terms: po.delivery_terms||null, payment_terms: po.payment_terms||null, notes: po.notes||'', marking: po.marking||'', items: itemsPayload, file_token: importPreview.file_token||'' };
                  const r=await fetch(`${API_URL}/import/client-po/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); const res=await r.json(); if(!r.ok){ alert(res.error||'Failed to register'); return; } alert(res.message||'Registered'); setImportPreview(null); setImportItems([]); await refreshLocalOrders(true); setTimeout(() => { if (listSectionRef.current) { listSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 100);
                } }, 'Confirm & Register')
              )
            ),
            React.createElement('div', { className:'bg-white border border-gray-200 rounded px-3 py-3 space-y-2' },
              React.createElement('div', { className:'flex items-center justify-between' },
                React.createElement('h4', { className:'text-sm font-semibold text-gray-700' }, 'Line Items (from PDF)'),
                React.createElement('button', { className:'px-3 py-1 bg-blue-600 text-white rounded text-sm', onClick:()=>setImportItems([...importItems, { product_id:'', useNewProduct:false, new_product_id:'', description:'', diameter:0, length:0, coating:0, quantity:0, unit_price:0, unit:'pcs' }]) }, 'Add Row')
              ),
              React.createElement('div', { className:'overflow-x-auto' },
                React.createElement('table', { className:'min-w-full border-collapse text-sm' },
                  React.createElement('thead', null,
                    React.createElement('tr', { className:'bg-gray-100' }, ['Product','New?','New Product ID','Description','Dia (mm)','Len (mm)','Cu (µm)','Qty','Unit Price','Unit','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2 text-left' }, h)))
                  ),
                  React.createElement('tbody', null,
                    importItems.length ? importItems.map((it, idx) => (
                      React.createElement('tr', { key:idx, className:'border-b' },
                        React.createElement('td', { className:'p-2' }, (()=>{
                          const existingProducts = products||[];
                          const currentValue = it.product_id || '';
                          const hasExisting = existingProducts.some(p=>p.id === currentValue);
                          const options = [
                            React.createElement('option', { key:'__blank__', value:'' }, 'Select Product')
                          ];
                          if (!hasExisting && currentValue){
                            options.push(React.createElement('option', { key:'__pdf__', value:currentValue }, `${currentValue} (from PDF)`));
                          }
                          options.push(...existingProducts.map(p=> React.createElement('option', { key:p.id, value:p.id }, `${p.id} - ${p.description}`)));
                          return React.createElement('select', { className:'border rounded px-2 py-1 w-44', value:currentValue, onChange:e=>{
                            const value = e.target.value;
                            const arr=[...importItems];
                            arr[idx].product_id = value;
                            if (value){
                              arr[idx].useNewProduct = false;
                              const prod = existingProducts.find(p=>p.id===value);
                              if (prod){
                                arr[idx].description = prod.description || arr[idx].description || '';
                                arr[idx].diameter = Number(prod.steel_diameter ?? prod.diameter ?? arr[idx].diameter ?? 0);
                                arr[idx].length = Number(prod.length ?? arr[idx].length ?? 0);
                                arr[idx].coating = Number(prod.copper_coating ?? prod.coating ?? arr[idx].coating ?? 0);
                              }
                            }
                            setImportItems(arr);
                          }}, options);
                        })()),
                        React.createElement('td', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked:!!it.useNewProduct, onChange:e=>{
                          const arr=[...importItems]; arr[idx].useNewProduct = e.target.checked;
                          if (e.target.checked){ arr[idx].product_id=''; }
                          setImportItems(arr);
                        }})),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-32', placeholder:'Optional', value:it.new_product_id||'', disabled:!it.useNewProduct, onChange:e=>{
                          const arr=[...importItems]; arr[idx].new_product_id=e.target.value; setImportItems(arr);
                        }})),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-full', placeholder:'Description', value:it.description||'', onChange:e=>{
                          const arr=[...importItems]; arr[idx].description=e.target.value; setImportItems(arr);
                        }})),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24 text-right', value:it.diameter||0, onChange:e=>{
                          const arr=[...importItems]; arr[idx].diameter=Number(e.target.value||0); setImportItems(arr);
                        }})),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24 text-right', value:it.length||0, onChange:e=>{
                          const arr=[...importItems]; arr[idx].length=Number(e.target.value||0); setImportItems(arr);
                        }})),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24 text-right', value:it.coating||0, onChange:e=>{
                          const arr=[...importItems]; arr[idx].coating=Number(e.target.value||0); setImportItems(arr);
                        }})),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-24 text-right', value:it.quantity||0, onChange:e=>{
                          const arr=[...importItems]; arr[idx].quantity=Number(e.target.value||0); setImportItems(arr);
                        }})),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', step:'0.01', className:'border rounded px-2 py-1 w-24 text-right', value:it.unit_price||0, onChange:e=>{
                          const arr=[...importItems]; arr[idx].unit_price=Number(e.target.value||0); setImportItems(arr);
                        }})),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-20', value:it.unit||'pcs', onChange:e=>{
                          const arr=[...importItems]; arr[idx].unit=e.target.value||'pcs'; setImportItems(arr);
                        }})),
                        React.createElement('td', { className:'p-2 text-right' }, React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>{
                          const arr=[...importItems]; arr.splice(idx,1); setImportItems(arr);
                        } }, 'Remove'))
                      )
                    )) : React.createElement('tr', null, React.createElement('td', { className:'p-2 text-sm text-gray-500', colSpan:11 }, 'No items detected in PDF.'))
                  )
                )
              )
            ),
            React.createElement('div', { className:'bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap' }, importPreview.text ? importPreview.text : 'No text extracted from PDF. Review the document manually.')
          )
        )
      ),
      React.createElement('div', { ref: listSectionRef },
        React.createElement(Section, { title:'Client Purchase Orders' },
          React.createElement('div', { className:'mb-3 flex flex-wrap gap-3 items-center' },
          React.createElement('span', { className:'text-sm text-gray-700' }, 'Columns:'),
          [['id','PO ID'],['customer','Customer'],['po_date','PO Date'],['due_date','Due Date'],['delivery_terms','Delivery'],['payment_terms','Payment'],['status','Status'],['notes','Notes']].map(([k,label]) => (
            React.createElement('label', { key:k, className:'text-sm flex items-center gap-1' },
              React.createElement('input', { type:'checkbox', checked: cols[k], onChange:e=>setCols({ ...cols, [k]: e.target.checked }) }), label
            )
          )),
          listLoading && React.createElement('span', { className:'text-xs text-gray-500' }, 'Refreshing list...'),
          !listLoading && listError && React.createElement('span', { className:'text-xs text-red-600' }, listError),
              React.createElement('button', { className:'ml-auto px-3 py-2 bg-gray-700 text-white rounded', onClick:()=>{
                const headers = [];
                if (cols.id) headers.push({ key:'id', label:'PO ID' });
                if (cols.customer) headers.push({ key:'customer_name', label:'Customer' });
                if (cols.po_date) headers.push({ key:'po_date', label:'PO Date' });
                if (cols.due_date) headers.push({ key:'due_date', label:'Due Date' });
                if (cols.status) headers.push({ key:'status', label:'Status' });
                if (cols.notes) headers.push({ key:'notes', label:'Notes' });
                downloadCSV('client-pos.csv', headers, localOrders);
              }}, 'Export CSV'),
              React.createElement('button', { className:'px-3 py-2 bg-red-600 text-white rounded disabled:opacity-50', disabled:!selected.length, onClick: deleteSelected }, `Delete Selected (${selected.length||0})`)
            ),
            React.createElement('div', { className:'overflow-x-auto' },
              React.createElement('table', { className:'min-w-full border-collapse' },
                React.createElement('thead', null,
                  React.createElement('tr', { className:'bg-gray-100' },
                    React.createElement('th', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked: allSelected, onChange: toggleAll })),
                    cols.id && React.createElement('th', { className:'p-2' }, 'PO ID'),
                    cols.customer && React.createElement('th', { className:'p-2' }, 'Customer'),
                    cols.po_date && React.createElement('th', { className:'p-2' }, 'PO Date'),
                    cols.due_date && React.createElement('th', { className:'p-2' }, 'Due Date'),
                    cols.status && React.createElement('th', { className:'p-2' }, 'Status'),
                    cols.delivery_terms && React.createElement('th', { className:'p-2' }, 'Delivery'),
                    cols.payment_terms && React.createElement('th', { className:'p-2' }, 'Payment'),
                    cols.notes && React.createElement('th', { className:'p-2' }, 'Notes'),
                    React.createElement('th', { className:'p-2' }, 'Actions')
                  )
                ),
                React.createElement('tbody', null,
                  localOrders.length
                    ? localOrders.map(po => {
                    const edit = editing === po.id;
                    return React.createElement('tr', { key:po.id, className:'border-b' },
                      React.createElement('td', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked:selected.includes(po.id), onChange:()=>toggle(po.id) })),
                      cols.id && React.createElement('td', { className:'p-2 font-mono' }, React.createElement('button', { className:'underline text-blue-700', onClick:()=>openPo(po) }, po.id)),
                      cols.customer && React.createElement('td', { className:'p-2' }, React.createElement('button', { className:'underline text-blue-700', onClick:()=>openPo(po) }, po.customer_name)),
                      cols.po_date && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { type:'date', className:'border rounded px-2 py-1', defaultValue:po.po_date, onChange:e=>po.po_date=e.target.value }) : formatLongDate(po.po_date)),
                      cols.due_date && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { type:'date', className:'border rounded px-2 py-1', defaultValue:po.due_date, onChange:e=>po.due_date=e.target.value }) : formatLongDate(po.due_date)),
                      cols.status && React.createElement('td', { className:'p-2' }, edit ? React.createElement('select', { className:'border rounded px-2 py-1', defaultValue:po.status, onChange:e=>po.status=e.target.value }, ['Pending','Confirmed','In Production','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))) : po.status),
                      cols.delivery_terms && React.createElement('td', { className:'p-2' }, edit ? React.createElement('select', { className:'border rounded px-2 py-1', defaultValue:po.delivery_terms||'FOB', onChange:e=>po.delivery_terms=e.target.value }, ['FOB','CIF','Door Delivery','DDP','Factory Ex Works'].map(x=> React.createElement('option', { key:x, value:x }, x))) : (po.delivery_terms||'')),
                      cols.payment_terms && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:po.payment_terms||'', onChange:e=>po.payment_terms=e.target.value }) : (po.payment_terms||'')),
                      cols.notes && React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:po.notes, onChange:e=>po.notes=e.target.value }) : (po.notes || '')),
                      React.createElement('td', { className:'p-2 text-right space-x-2' },
                        edit ? React.createElement(React.Fragment, null,
                          React.createElement('button', { onClick:()=>save(po), className:'px-2 py-1 bg-green-600 text-white rounded text-sm' }, 'Save'),
                          React.createElement('button', { onClick:()=>setEditing(null), className:'px-2 py-1 border rounded text-sm' }, 'Cancel')
                        ) : React.createElement(React.Fragment, null,
                          React.createElement('button', { onClick:()=>toggleItems(po.id), className:'px-2 py-1 border rounded text-sm' }, expanded[po.id] ? 'Hide Items' : 'View Items'),
                          React.createElement('button', { onClick:()=>setEditing(po.id), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'Edit'),
                          React.createElement('button', { onClick:()=>del(po.id), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete'),
                          React.createElement('button', { onClick:()=> window.open(`${API_URL}/client-pos/${encodeURIComponent(po.id)}/pdf`, '_blank'), className:'px-2 py-1 border rounded text-sm', disabled: !po.pdf_path }, 'View PDF'),
                          React.createElement('button', { onClick:()=>exportClientPo(po,'pdf'), className:'px-2 py-1 border rounded text-sm' }, 'PDF (Letterhead)'),
                          React.createElement('button', { onClick:()=>exportClientPo(po,'doc'), className:'px-2 py-1 border rounded text-sm' }, 'DOC')
                        )
                      )
                    ),
                    expanded[po.id] && React.createElement('tr', { key:po.id+':items' },
                      React.createElement('td', { colSpan: colCount + 1, className:'p-0' },
                        React.createElement('div', { className:'bg-gray-50 p-3' },
                          loadingItems[po.id]
                            ? React.createElement('div', { className:'text-sm text-gray-500' }, 'Loading items...')
                              : React.createElement('div', { className:'overflow-x-auto' },
                                React.createElement('table', { className:'min-w-full border-collapse' },
                                  React.createElement('thead', null,
                                    React.createElement('tr', { className:'bg-gray-100' }, ['Product ID','Product Description','Qty','Unit Price','Delivered','Line Total','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2 text-left' }, h)))
                                  ),
                                  React.createElement('tbody', null,
                                    (poItems[po.id]||[]).map((li, idx) => (
                                      React.createElement('tr', { key: li.id||idx, className:'border-b' },
                                        React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-40 font-mono', defaultValue:li.product_id, onChange:e=>li.product_id=e.target.value })),
                                        React.createElement('td', { className:'p-2' }, li.product_description || ''),
                                        React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', defaultValue:li.quantity||0, onChange:e=>li.quantity=Number(e.target.value||0) })),
                                        React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', step:'0.01', defaultValue:li.unit_price||0, onChange:e=>li.unit_price=Number(e.target.value||0) })),
                                        React.createElement('td', { className:'p-2 text-right' }, li.delivered||0),
                                        React.createElement('td', { className:'p-2 text-right' }, ((li.quantity||0) * (li.unit_price||0)).toFixed(2)),
                                        React.createElement('td', { className:'p-2 text-right space-x-2' },
                                          React.createElement('button', { className:'px-2 py-1 bg-blue-600 text-white rounded text-sm', onClick: async ()=>{
                                            const url = li.id ? `${API_URL}/client-purchase-orders/${encodeURIComponent(po.id)}/items/${encodeURIComponent(li.id)}` : `${API_URL}/client-purchase-orders/${encodeURIComponent(po.id)}/items`;
                                            const method = li.id ? 'PUT' : 'POST';
                                            const body = JSON.stringify({ product_id: li.product_id, quantity: li.quantity, unit_price: li.unit_price });
                                            const r = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body });
                                            const res = await r.json(); if(!r.ok){ alert(res.error||'Save failed'); return; }
                                            // Reload items
                                            const re = await fetch(`${API_URL}/client-purchase-orders/${encodeURIComponent(po.id)}/items`);
                                            const data = await re.json(); setPoItems(prev=>({ ...prev, [po.id]: data }));
                                          } }, li.id ? 'Save' : 'Add'),
                                          li.id && React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick: async ()=>{
                                            if(!confirm('Delete item?')) return;
                                            const r = await fetch(`${API_URL}/client-purchase-orders/${encodeURIComponent(po.id)}/items/${encodeURIComponent(li.id)}`, { method:'DELETE' });
                                            const res = await r.json(); if(!r.ok){ alert(res.error||'Delete failed'); return; }
                                            const re = await fetch(`${API_URL}/client-purchase-orders/${encodeURIComponent(po.id)}/items`);
                                            const data = await re.json(); setPoItems(prev=>({ ...prev, [po.id]: data }));
                                          } }, 'Delete')
                                        )
                                      )
                                    )),
                                    React.createElement('tr', null,
                                      React.createElement('td', { className:'p-2', colSpan:7 }, React.createElement('button', { className:'px-3 py-1 bg-green-600 text-white rounded text-sm', onClick: ()=> setPoItems(prev=>({ ...prev, [po.id]: [ ...(prev[po.id]||[]), { product_id:'', quantity:0, unit_price:0 } ] })) }, 'Add Row'))
                                    )
                                  )
                                )
                              )
                        )
                      )
                    );
                  })
                    : React.createElement('tr', null,
                        React.createElement('td', { colSpan: colCount + 1, className:'p-4 text-center text-sm text-gray-500' }, 'No client purchase orders found.')
                      )
                )
              )
            ),
        poModal && React.createElement('div', { className:'fixed inset-0 bg-black/30 flex items-center justify-center z-50' },
          React.createElement('div', { className:'bg-white rounded-lg shadow-lg p-6 w-full max-w-3xl' },
            React.createElement('div', { className:'mb-3 flex items-center justify-between gap-2' },
              React.createElement('h4', { className:'text-lg font-bold' }, `Edit PO: ${poModal.id}`),
              React.createElement('div', { className:'flex gap-2' },
                React.createElement('button', { onClick:()=>exportClientPo(poModal,'pdf'), className:'px-2 py-1 border rounded text-sm' }, 'PDF (Letterhead)'),
                React.createElement('button', { onClick:()=>exportClientPo(poModal,'doc'), className:'px-2 py-1 border rounded text-sm' }, 'DOC')
              )
            ),
            React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-3 gap-3' },
              React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Customer ID', value:poModal.customer_id||'', onChange:e=>setPoModal({ ...poModal, customer_id:e.target.value }) }),
              React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value:poModal.po_date||'', onChange:e=>setPoModal({ ...poModal, po_date:e.target.value }) }),
              React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value:poModal.due_date||'', onChange:e=>setPoModal({ ...poModal, due_date:e.target.value }) }),
              React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Currency', value:poModal.currency||'INR', onChange:e=>setPoModal({ ...poModal, currency:e.target.value }) }),
              React.createElement('select', { className:'border rounded px-2 py-1', value:poModal.status||'Pending', onChange:e=>setPoModal({ ...poModal, status:e.target.value }) }, ['Pending','Confirmed','In Production','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))),
              React.createElement('select', { className:'border rounded px-2 py-1', value:poModal.delivery_terms||'FOB', onChange:e=>setPoModal({ ...poModal, delivery_terms:e.target.value }) }, ['FOB','CIF','Door Delivery','DDP','Factory Ex Works'].map(x=> React.createElement('option', { key:x, value:x }, x))),
              React.createElement('select', { className:'border rounded px-2 py-1 md:col-span-2', value: (poModal.payment_terms_after||'At dispatch'), onChange:e=>{ const after=e.target.value; const text = (poModal.payment_terms||'').split(',')[0] || ''; const final = text ? `${text}, balance ${100-Number(text.replace(/\D/g,''))}% ${after}` : after; setPoModal({ ...poModal, payment_terms_after: after, payment_terms: final }); } }, ['At dispatch','30 days Net from B/L','56 days Net from B/L','60 days Net from B/L','90 days Net from B/L','At B/L release'].map(x=> React.createElement('option', { key:x, value:x }, x))),
              React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-3', placeholder:'Payment Terms (free text)', value:poModal.payment_terms||'', onChange:e=>setPoModal({ ...poModal, payment_terms:e.target.value }) }),
              React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-3', placeholder:'Notes', value:poModal.notes||'', onChange:e=>setPoModal({ ...poModal, notes:e.target.value }) })
            ),
            React.createElement('div', { className:'mt-4 flex justify-end gap-2' },
              React.createElement('button', { className:'px-3 py-2 border rounded', onClick:()=>setPoModal(null) }, 'Close'),
              React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:savePoModal }, 'Save Changes')
            )
          )
        )
      )
      )
    )
  );
}

function VendorPurchaseOrders({ purchaseOrders, vendors, onRefresh, company }){
  const [form, setForm] = useState({ id:'', vendor_id:'', po_date:'', due_date:'', status:'Pending', notes:'' });
  const [editing, setEditing] = useState(null);
  async function add(){ await fetch(`${API_URL}/vendor-purchase-orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }); setForm({ id:'', vendor_id:'', po_date:'', due_date:'', status:'Pending', notes:'' }); onRefresh?.(); }
  async function save(v){ await fetch(`${API_URL}/vendor-purchase-orders/${v.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(v) }); setEditing(null); onRefresh?.(); }
  async function del(id){ if(!confirm('Delete Vendor PO?')) return; await fetch(`${API_URL}/vendor-purchase-orders/${id}`, { method:'DELETE' }); onRefresh?.(); }
  async function exportVendorPo(po, format){
    try{
      const r = await fetch(`${API_URL}/vendor-purchase-orders/${encodeURIComponent(po.id)}`);
      const full = await r.json(); if(!r.ok) throw new Error(full.error||'Failed to load');
      const items = full.line_items || [];
      const html = buildPOHtml({ company, headerTitle:'Purchase Order (Vendor)', partyName: full.vendor_name||full.vendor_id, partyAddress:'', po: full, items, totals: items.reduce((s,it)=> s + Number(it.quantity||0)*Number(it.unit_price||0), 0) });
      const container = document.createElement('div'); container.innerHTML = html; document.body.appendChild(container);
      if (format==='pdf'){ await html2pdf().from(container).set({ margin:10, filename:`vendor-po-${po.id}.pdf` }).save(); }
      else { const blob = new Blob([html], { type:'application/msword' }); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`vendor-po-${po.id}.doc`; a.click(); URL.revokeObjectURL(url); }
      document.body.removeChild(container);
    }catch(e){ alert(e.message||'Export failed'); }
  }
  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title: 'Add Vendor PO' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-8 gap-4 items-end' },
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'VPO ID'),
            React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'VPO-1001', value: form.id, onChange:e=>setForm({...form,id:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1 md:col-span-2' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Vendor'),
            React.createElement('select', { className:'border rounded px-3 py-2 h-10 text-sm w-full', value: form.vendor_id, onChange:e=>setForm({...form,vendor_id:e.target.value}) },
              React.createElement('option', { value:'' }, 'Select Vendor'),
              vendors.map(v => React.createElement('option', { key:v.id, value:v.id }, `${v.id} - ${v.name}`))
            )
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'PO Date'),
            React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', type:'date', value: form.po_date, onChange:e=>setForm({...form,po_date:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Due Date'),
            React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', type:'date', value: form.due_date, onChange:e=>setForm({...form,due_date:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Status'),
            React.createElement('select', { className:'border rounded px-3 py-2 h-10 text-sm w-full', value: form.status, onChange:e=>setForm({...form,status:e.target.value}) },
              ['Pending','Ordered','In Transit','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))
            )
          ),
          React.createElement('div', { className:'space-y-1 md:col-span-2' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Notes'),
            React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'Optional', value: form.notes||'', onChange:e=>setForm({...form,notes:e.target.value}) })
          ),
          React.createElement('div', { className:'flex md:justify-end md:col-span-2' },
            React.createElement('button', { onClick:add, className:'h-10 px-5 bg-green-600 text-white rounded font-semibold shadow-sm' }, 'Add')
          )
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
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { type:'date', className:'border rounded px-2 py-1', defaultValue:vpo.po_date, onChange:e=>vpo.po_date=e.target.value }) : formatLongDate(vpo.po_date)),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { type:'date', className:'border rounded px-2 py-1', defaultValue:vpo.due_date, onChange:e=>vpo.due_date=e.target.value }) : formatLongDate(vpo.due_date)),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('select', { className:'border rounded px-2 py-1', defaultValue:vpo.status, onChange:e=>vpo.status=e.target.value }, ['Pending','Ordered','In Transit','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))) : vpo.status),
                  React.createElement('td', { className:'p-2' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:vpo.notes, onChange:e=>vpo.notes=e.target.value }) : (vpo.notes || '')),
                  React.createElement('td', { className:'p-2 text-right space-x-2' },
                    edit ? React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>save(vpo), className:'px-2 py-1 bg-green-600 text-white rounded text-sm' }, 'Save'),
                      React.createElement('button', { onClick:()=>setEditing(null), className:'px-2 py-1 border rounded text-sm' }, 'Cancel')
                    ) : React.createElement(React.Fragment, null,
                      React.createElement('button', { onClick:()=>setEditing(vpo.id), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'Edit'),
                      React.createElement('button', { onClick:()=>del(vpo.id), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete'),
                      React.createElement('button', { onClick: async ()=>{ if(!confirm('Receive all items to Raw Materials?')) return; try{ const r=await fetch(`${API_URL}/vendor-purchase-orders/${encodeURIComponent(vpo.id)}/receive`, { method:'POST' }); const res=await r.json(); if(!r.ok){ alert(res.error||'Receive failed'); return; } alert('Received to Raw Materials'); }catch{ alert('Receive failed'); } }, className:'px-2 py-1 border rounded text-sm' }, 'Receive to Raw'),
                      React.createElement('button', { onClick:()=>exportVendorPo(vpo,'pdf'), className:'px-2 py-1 border rounded text-sm' }, 'PDF (Letterhead)'),
                      React.createElement('button', { onClick:()=>exportVendorPo(vpo,'doc'), className:'px-2 py-1 border rounded text-sm' }, 'DOC')
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

function Shipments({ shipments, purchaseOrders, products, onRefresh }){
  const [cols, setCols] = useState({ id:true, po:true, date:true, bl:true, actions:true });
  const [selected, setSelected] = useState([]);
  const allSelected = selected.length>0 && selected.length === shipments.length;
  function toggle(id){ setSelected(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]); }
  function toggleAll(){ setSelected(allSelected ? [] : shipments.map(s=>s.id)); }
  async function deleteSelected(){ if(!selected.length) return; if(!confirm(`Delete ${selected.length} shipment(s)?`)) return; const r=await fetch(`${API_URL}/shipments/bulk-delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids: selected }) }); const res=await r.json(); if(!r.ok){ alert(res.error||'Bulk delete failed'); return; } if(res.failed && res.failed.length) alert(`Some failed: ${res.failed.map(f=>f.id).join(', ')}`); setSelected([]); onRefresh?.(); }
  const [shipModal, setShipModal] = useState(null);
  const [shipItems, setShipItems] = useState([]);
  function openShip(s){ setShipModal({ ...s }); (async()=>{ try{ const r=await fetch(`${API_URL}/shipments/${encodeURIComponent(s.id)}/items`); setShipItems(await r.json()); }catch{} })(); }
  async function addShipItem(){ setShipItems([...shipItems, { product_id:'', quantity:0 }]); }
  async function saveShipItem(i){ const it=shipItems[i]; const isNew = !it.id; const url = isNew ? `${API_URL}/shipments/${encodeURIComponent(shipModal.id)}/items` : `${API_URL}/shipments/${encodeURIComponent(shipModal.id)}/items/${encodeURIComponent(it.id)}`; const method = isNew ? 'POST' : 'PUT'; const body = JSON.stringify({ product_id: it.product_id, quantity: it.quantity }); const r=await fetch(url, { method, headers:{'Content-Type':'application/json'}, body }); const res=await r.json(); if(!r.ok){ alert(res.error||'Save failed'); return; } const re=await fetch(`${API_URL}/shipments/${encodeURIComponent(shipModal.id)}/items`); setShipItems(await re.json()); }
  async function deleteShipItem(i){ const it=shipItems[i]; if (!it.id){ const arr=[...shipItems]; arr.splice(i,1); setShipItems(arr); return; } if(!confirm('Delete shipment item?')) return; const r=await fetch(`${API_URL}/shipments/${encodeURIComponent(shipModal.id)}/items/${encodeURIComponent(it.id)}`, { method:'DELETE' }); const res=await r.json(); if(!r.ok){ alert(res.error||'Delete failed'); return; } const re=await fetch(`${API_URL}/shipments/${encodeURIComponent(shipModal.id)}/items`); setShipItems(await re.json()); }
  async function saveShipModal(){ const s=shipModal; const r=await fetch(`${API_URL}/shipments/${encodeURIComponent(s.id)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(s) }); const res=await r.json(); if(!r.ok){ alert(res.error||'Save failed'); return; } setShipModal(null); onRefresh?.(); }
  const [form, setForm] = useState({ id:'', po_id:'', shipment_date: new Date().toISOString().slice(0,10), container_number:'', bl_number:'', bl_date:'', notes:'' });
  const [items, setItems] = useState([]);
  function addItem(){ setItems([...items, { product_id:'', quantity:0 }]); }
  function updateItem(i,k,v){ const arr=[...items]; arr[i][k] = (k==='product_id')? v : Number(v||0); setItems(arr); }
  function removeItem(i){ const arr=[...items]; arr.splice(i,1); setItems(arr); }
  async function saveShipment(){
    if (!form.id || !form.po_id){ alert('Enter Shipment ID and select PO'); return; }
    if (items.length===0){ alert('Add at least one item'); return; }
    const body = { ...form, items };
    const r = await fetch(`${API_URL}/shipments`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const res = await r.json();
    if(!r.ok){ alert(res.error||'Failed to record shipment'); return; }
    alert('Shipment recorded'); setItems([]); setForm({ ...form, id:'', container_number:'', bl_number:'', bl_date:'', notes:'' }); onRefresh?.();
  }
  async function delShipment(id){ if(!confirm('Delete shipment? This will rollback inventory/delivery.')) return; const r=await fetch(`${API_URL}/shipments/${encodeURIComponent(id)}`, { method:'DELETE' }); const res=await r.json(); if(!r.ok){ alert(res.error||'Failed'); return; } alert('Deleted'); onRefresh?.(); }
  return (
    React.createElement('div', { className: 'bg-white rounded-xl shadow-md p-6 border border-gray-200 space-y-4' },
      React.createElement('h3', { className: 'text-lg font-bold text-gray-800' }, 'Shipments'),
      React.createElement(Section, { title:'Record Shipment' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-4 gap-3 mb-3' },
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Shipment ID', value:form.id, onChange:e=>setForm({...form,id:e.target.value}) }),
          React.createElement('select', { className:'border rounded px-2 py-1 md:col-span-2', value:form.po_id, onChange:e=>setForm({...form,po_id:e.target.value}) },
            React.createElement('option', { value:'' }, '-- Select Client PO --'),
            (purchaseOrders||[]).map(po=> React.createElement('option', { key:po.id, value:po.id }, `${po.id} - ${po.customer_name||po.customer_id}`))
          ),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value:form.shipment_date, onChange:e=>setForm({...form,shipment_date:e.target.value}) })
        ),
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-4 gap-3 mb-3' },
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Container No.', value:form.container_number, onChange:e=>setForm({...form,container_number:e.target.value}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'BL No.', value:form.bl_number, onChange:e=>setForm({...form,bl_number:e.target.value}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value:form.bl_date, onChange:e=>setForm({...form,bl_date:e.target.value}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Notes', value:form.notes, onChange:e=>setForm({...form,notes:e.target.value}) })
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' }, ['Product','Quantity','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
            ),
            React.createElement('tbody', null,
              items.map((it,i)=> (
                React.createElement('tr', { key:i, className:'border-b' },
                  React.createElement('td', { className:'p-2' }, React.createElement('select', { className:'border rounded px-2 py-1', value:it.product_id||'', onChange:e=>updateItem(i,'product_id', e.target.value) }, [React.createElement('option', { key:'', value:'' }, '-- Select --')].concat((products||[]).map(p=> React.createElement('option', { key:p.id, value:p.id }, `${p.id} - ${p.description}`))))),
                  React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', value:it.quantity||0, onChange:e=>updateItem(i,'quantity', e.target.value) })),
                  React.createElement('td', { className:'p-2 text-right' }, React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>removeItem(i) }, 'Remove'))
                )
              ))
            )
          )
        ),
        React.createElement('div', { className:'flex gap-2' },
          React.createElement('button', { className:'px-3 py-2 bg-blue-600 text-white rounded', onClick:addItem }, 'Add Item'),
          React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:saveShipment }, 'Save Shipment')
        )
      ),
      React.createElement(Section, { title:'Shipments' },
        React.createElement('div', { className:'mb-3 flex flex-wrap gap-3 items-center' },
          React.createElement('span', { className:'text-sm text-gray-700' }, 'Columns:'),
          [['id','ID'],['po','PO'],['date','Date'],['bl','BL No.'],['actions','Actions']].map(([k,label]) => (
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
          }}, 'Export CSV'),
          React.createElement('button', { className:'px-3 py-2 bg-red-600 text-white rounded disabled:opacity-50', disabled: !selected.length, onClick: deleteSelected }, `Delete Selected (${selected.length||0})`)
        ),
        React.createElement('div', { className: 'overflow-x-auto' },
          React.createElement('table', { className: 'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className: 'bg-gray-100' },
                React.createElement('th', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked: allSelected, onChange: toggleAll })),
                cols.id && React.createElement('th', { className:'p-2' }, 'ID'),
                cols.po && React.createElement('th', { className:'p-2' }, 'PO'),
                cols.date && React.createElement('th', { className:'p-2' }, 'Date'),
                cols.bl && React.createElement('th', { className:'p-2' }, 'BL No.'),
                cols.actions && React.createElement('th', { className:'p-2' }, 'Actions')
              )
            ),
            React.createElement('tbody', null,
              shipments.map(s => React.createElement('tr', { key: s.id, className: 'border-b' },
                React.createElement('td', { className: 'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked: selected.includes(s.id), onChange:()=>toggle(s.id) })),
                cols.id && React.createElement('td', { className: 'p-2' }, React.createElement('button', { className:'underline text-blue-700', onClick:()=>openShip(s) }, s.id)),
                cols.po && React.createElement('td', { className: 'p-2' }, s.po_id),
                cols.date && React.createElement('td', { className: 'p-2' }, formatLongDate(s.shipment_date)),
                cols.bl && React.createElement('td', { className: 'p-2' }, s.bl_number),
                cols.actions && React.createElement('td', { className:'p-2 text-right' }, React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>delShipment(s.id) }, 'Delete'))
              ))
            )
          )
        )
        , shipModal && React.createElement('div', { className:'fixed inset-0 bg-black/30 flex items-center justify-center z-50' },
            React.createElement('div', { className:'bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl' },
              React.createElement('h4', { className:'text-lg font-bold mb-3' }, `Edit Shipment: ${shipModal.id}`),
              React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-2 gap-3' },
                React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value:shipModal.shipment_date||'', onChange:e=>setShipModal({ ...shipModal, shipment_date:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Container No.', value:shipModal.container_number||'', onChange:e=>setShipModal({ ...shipModal, container_number:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'BL No.', value:shipModal.bl_number||'', onChange:e=>setShipModal({ ...shipModal, bl_number:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value:shipModal.bl_date||'', onChange:e=>setShipModal({ ...shipModal, bl_date:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Notes', value:shipModal.notes||'', onChange:e=>setShipModal({ ...shipModal, notes:e.target.value }) })
              ),
              React.createElement('div', { className:'mt-4' },
                React.createElement('div', { className:'flex justify-between items-center mb-2' },
                  React.createElement('h5', { className:'font-semibold' }, 'Shipment Items'),
                  React.createElement('button', { className:'px-2 py-1 bg-blue-600 text-white rounded text-sm', onClick:addShipItem }, 'Add Item')
                ),
                React.createElement('div', { className:'overflow-x-auto' },
                  React.createElement('table', { className:'min-w-full border-collapse' },
                    React.createElement('thead', null,
                      React.createElement('tr', { className:'bg-gray-100' }, ['Product','Quantity','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
                    ),
                    React.createElement('tbody', null,
                      shipItems.map((it,i)=> (
                        React.createElement('tr', { key: it.id||i, className:'border-b' },
                          React.createElement('td', { className:'p-2' }, React.createElement('select', { className:'border rounded px-2 py-1', value: it.product_id||'', onChange:e=>{ const arr=[...shipItems]; arr[i].product_id=e.target.value; setShipItems(arr); } }, [React.createElement('option', { key:'', value:'' }, '-- Select --')].concat((products||[]).map(p=> React.createElement('option', { key:p.id, value:p.id }, `${p.id} - ${p.description}`))))),
                          React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', value: it.quantity||0, onChange:e=>{ const arr=[...shipItems]; arr[i].quantity=Number(e.target.value||0); setShipItems(arr); } })),
                          React.createElement('td', { className:'p-2 text-right space-x-2' },
                            React.createElement('button', { className:'px-2 py-1 bg-blue-600 text-white rounded text-sm', onClick:()=>saveShipItem(i) }, it.id?'Save':'Add'),
                            React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>deleteShipItem(i) }, 'Delete')
                          )
                        )
                      ))
                    )
                  )
                )
              ),
              React.createElement('div', { className:'mt-4 flex justify-end gap-2' },
                React.createElement('button', { className:'px-3 py-2 border rounded', onClick:()=>setShipModal(null) }, 'Close'),
                React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:saveShipModal }, 'Save Changes')
              )
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
  const [invCols, setInvCols] = useState({ product_id:true, product:true, cores:true, plated:true, machined:true, qc:true, stamped:true, packed:true, total:true });
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
        React.createElement('div', { className:'text-xs text-gray-600 mb-2' }, 'Units: kg for Current Stock and Reorder Level'),
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-5 gap-3 mb-3' },
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Material', value:rmForm.material, onChange:e=>setRmForm({...rmForm,material:e.target.value}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', step:'0.001', placeholder:'Current Stock (kg)', value:rmForm.current_stock, onChange:e=>setRmForm({...rmForm,current_stock:Number(e.target.value||0)}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', step:'0.001', placeholder:'Reorder Level (kg)', value:rmForm.reorder_level, onChange:e=>setRmForm({...rmForm,reorder_level:Number(e.target.value||0)}) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'date', placeholder:'Last Purchase', value:rmForm.last_purchase_date, onChange:e=>setRmForm({...rmForm,last_purchase_date:e.target.value}) }),
          React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:add }, 'Add')
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' }, ['Material','Current Stock (kg)','Reorder Level (kg)','Last Purchase','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
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
        React.createElement('div', { className:'text-xs text-gray-600 -mt-2 mb-2' }, 'Units: pcs for all stage counts'),
        React.createElement('div', { className:'mb-3 flex flex-wrap gap-3 items-center' },
          React.createElement('span', { className:'text-sm text-gray-700' }, 'Columns:'),
          ['product_id','product','cores','plated','machined','qc','stamped','packed','total'].map(c => (
            React.createElement('label', { key:c, className:'text-sm flex items-center gap-1' },
              React.createElement('input', { type:'checkbox', checked: (invCols||{})[c] === undefined ? true : invCols[c], onChange:e=>setInvCols({ ...(invCols||{}), [c]: e.target.checked }) }), (c==='product_id' ? 'Product ID' : (c.charAt(0).toUpperCase()+c.slice(1)))
            )
          )),
          React.createElement('button', { onClick: ()=>{
              const headers = [];
              const cols = invCols || {};
              if (cols.product_id) headers.push({ key:'product_id', label:'Product ID' });
              if (cols.product) headers.push({ key:'product_description', label:'Product' });
              if (cols.cores) headers.push({ key:'cores', label:'Cores' });
              if (cols.plated) headers.push({ key:'plated', label:'Plated' });
              if (cols.machined) headers.push({ key:'machined', label:'Machined' });
              if (cols.qc) headers.push({ key:'qc', label:'QC' });
              if (cols.stamped) headers.push({ key:'stamped', label:'Stamped' });
              if (cols.packed) headers.push({ key:'packed', label:'Packed' });
              if (cols.total) headers.push({ key:'total', label:'Total' });
              const rows = (invData||[]).map(r => ({
                cores: r.cores||0,
                product_id: r.product_id,
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
                (invCols||{}).product_id !== false && React.createElement('th', { className:'p-2 text-left' }, 'Product ID'),
                (invCols||{}).product !== false && React.createElement('th', { className:'p-2 text-left' }, 'Product'),
                (invCols||{}).cores !== false && React.createElement('th', { className:'p-2 text-center' }, 'Cores (pcs)'),
                (invCols||{}).plated !== false && React.createElement('th', { className:'p-2 text-center' }, 'Plated'),
                (invCols||{}).machined !== false && React.createElement('th', { className:'p-2 text-center' }, 'Machined'),
                (invCols||{}).qc !== false && React.createElement('th', { className:'p-2 text-center' }, 'QC'),
                (invCols||{}).stamped !== false && React.createElement('th', { className:'p-2 text-center' }, 'Stamped'),
                (invCols||{}).packed !== false && React.createElement('th', { className:'p-2 text-center' }, 'Packed'),
                (invCols||{}).total !== false && React.createElement('th', { className:'p-2 text-center' }, 'Total'),
                React.createElement('th', { className:'p-2 text-right' }, 'Actions')
              )
            ),
            React.createElement('tbody', null,
              (invData||[]).map((r, i) => {
                const total = (r.plated||0)+(r.machined||0)+(r.qc||0)+(r.stamped||0)+(r.packed||0);
                return React.createElement('tr', { key:r.product_id||i, className:'border-b' },
                  (invCols||{}).product_id !== false && React.createElement('td', { className:'p-2 font-mono' }, r.product_id),
                  (invCols||{}).product !== false && React.createElement('td', { className:'p-2' }, r.product_description),
                  (invCols||{}).cores !== false && React.createElement('td', { className:'p-2 text-center' }, r.cores||0),
                  (invCols||{}).plated !== false && React.createElement('td', { className:'p-2 text-center' }, r.plated||0),
                  (invCols||{}).machined !== false && React.createElement('td', { className:'p-2 text-center' }, r.machined||0),
                  (invCols||{}).qc !== false && React.createElement('td', { className:'p-2 text-center' }, r.qc||0),
                  (invCols||{}).stamped !== false && React.createElement('td', { className:'p-2 text-center' }, r.stamped||0),
                  (invCols||{}).packed !== false && React.createElement('td', { className:'p-2 text-center' }, r.packed||0),
                  (invCols||{}).total !== false && React.createElement('td', { className:'p-2 text-center' }, total),
                  React.createElement('td', { className:'p-2 text-right space-x-2' },
                    React.createElement('button', { className:'px-2 py-1 bg-blue-600 text-white rounded text-sm', onClick: async ()=>{
                      try{
                        const plated = Number(prompt('Plated', r.plated||0) || 0);
                        const machined = Number(prompt('Machined', r.machined||0) || 0);
                        const qc = Number(prompt('QC', r.qc||0) || 0);
                        const stamped = Number(prompt('Stamped', r.stamped||0) || 0);
                        const packed = Number(prompt('Packed', r.packed||0) || 0);
                        const resp = await fetch(`${API_URL}/inventory/${encodeURIComponent(r.product_id)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ plated, machined, qc, stamped, packed }) });
                        const res = await resp.json(); if(!resp.ok){ alert(res.error||'Save failed'); return; } await refetch();
                      }catch{}
                    } }, 'Edit'),
                    React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick: async ()=>{ if(!confirm('Delete this inventory row?')) return; const resp = await fetch(`${API_URL}/inventory/${encodeURIComponent(r.product_id)}`, { method:'DELETE' }); const res=await resp.json(); if(!resp.ok){ alert(res.error||'Delete failed'); return; } await refetch(); } }, 'Delete')
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
          React.createElement('select', { className: 'border rounded px-2 py-1', value: form.category||'', onChange: e=>update('category',e.target.value) }, ['','Plain CBG','Threaded CBG','UL Rods','Non UL Rods'].map(x=> React.createElement('option', { key:x, value:x }, x||'Category'))),
          React.createElement('input', { className: 'border rounded px-2 py-1', type: 'number', placeholder: 'Diameter (mm)', value: form.diameter, onChange: e=>update('diameter',e.target.value) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', type: 'number', placeholder: 'Length (mm)', value: form.length, onChange: e=>update('length',e.target.value) }),
          React.createElement('input', { className: 'border rounded px-2 py-1', type: 'number', placeholder: 'Coating (Âµm)', value: form.coating, onChange: e=>update('coating',e.target.value) }),
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
          )),
          React.createElement('button', { className:'ml-auto px-3 py-2 bg-blue-600 text-white rounded', onClick: async ()=>{ const r=await fetch(`${API_URL}/products/normalize`, { method:'POST' }); const res=await r.json(); if(!r.ok){ alert(res.error||'Failed'); return; } alert(res.message||'Normalized'); onRefresh?.(); } }, 'Auto Categorize + Normalize')
        ),
        React.createElement('div', { className: 'overflow-x-auto' },
          React.createElement('table', { className: 'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' },
                cols.id && React.createElement('th', { className:'p-2 text-left' }, 'ID'),
                cols.description && React.createElement('th', { className:'p-2 text-left' }, 'Description'),
                cols.diameter && React.createElement('th', { className:'p-2 text-center' }, 'Dia (mm)'),
                cols.length && React.createElement('th', { className:'p-2 text-center' }, 'Length (mm)'),
                cols.coating && React.createElement('th', { className:'p-2 text-center' }, 'Coating (Âµm)'),
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
  const [custImport, setCustImport] = useState(null);
  const [cols, setCols] = useState({ id:true, name:true, contact:true, phone:true, email:true });
  const [selected, setSelected] = useState([]);
  const allSelected = selected.length>0 && selected.length === customers.length;
  function toggle(id){ setSelected(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]); }
  function toggleAll(){ setSelected(allSelected ? [] : customers.map(c=>c.id)); }
  async function deleteSelected(){ if(!selected.length) return; if(!confirm(`Delete ${selected.length} customer(s)?`)) return; for (const id of selected) { await fetch(`${API_URL}/customers/${encodeURIComponent(id)}`, { method:'DELETE' }); } setSelected([]); onRefresh?.(); }
  const [modalCustomer, setModalCustomer] = useState(null);
  function openCustomer(c){ setModalCustomer({ ...c }); }
  async function saveModal(){ const c = modalCustomer; const r = await fetch(`${API_URL}/customers/${encodeURIComponent(c.id)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(c) }); if(!r.ok){ const res=await r.json().catch(()=>({})); alert(res.error||'Save failed'); return; } setModalCustomer(null); onRefresh?.(); }
  async function add(){ await fetch(`${API_URL}/customers`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }); setForm({ id:'', name:'', office_address:'', warehouse_address:'', contact_person:'', phone:'', email:'' }); onRefresh?.(); }
  async function del(id){ if(!confirm('Delete customer?')) return; await fetch(`${API_URL}/customers/${id}`, { method:'DELETE' }); onRefresh?.(); }
  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title: 'Add Customer' },
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-6 gap-4 items-end' },
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'ID'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'CUS-1001', value: form.id, onChange: e=>setForm({...form,id:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1 md:col-span-2' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Name'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'Customer Name', value: form.name, onChange: e=>setForm({...form,name:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Contact Person'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'Contact Person', value: form.contact_person, onChange: e=>setForm({...form,contact_person:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Phone'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: '+1-555-0100', value: form.phone, onChange: e=>setForm({...form,phone:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Email'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'customer@example.com', value: form.email, onChange: e=>setForm({...form,email:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'City'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'City', value: form.city||'', onChange: e=>setForm({...form,city:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Country'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'Country', value: form.country||'', onChange: e=>setForm({...form,country:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1 md:col-span-3' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Office Address'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'Office Address', value: form.office_address, onChange: e=>setForm({...form,office_address:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1 md:col-span-3' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Warehouse Address'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'Warehouse Address', value: form.warehouse_address, onChange: e=>setForm({...form,warehouse_address:e.target.value}) })
          ),
          React.createElement('div', { className:'flex md:justify-end' },
            React.createElement('button', { onClick: add, className: 'h-10 px-5 bg-green-600 text-white rounded font-semibold shadow-sm' }, 'Add')
          )
        )
      ),
      React.createElement(Section, { title: 'Import Customer (PDF)' },
        React.createElement('div', { className:'space-y-4' },
          React.createElement('div', { className:'flex flex-col md:flex-row md:items-center gap-3' },
            React.createElement('label', { className:'text-sm font-semibold text-gray-700' }, 'Upload PDF'),
            React.createElement('input', { type:'file', accept:'application/pdf', className:'text-sm', onChange: async (e)=>{
              const f=e.target.files&&e.target.files[0]; if(!f) return; const fd=new FormData(); fd.append('file', f);
              const r=await fetch(`${API_URL}/import/customer/preview`, { method:'POST', body: fd }); const data=await r.json(); if(!r.ok){ alert(data.error||'Failed to parse'); return; }
              setCustImport({ customer: data.customer||{}, file_token: data.file_token||'' });
            }})
          ),
          custImport && React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-4' },
            React.createElement('div', { className:'space-y-1' },
              React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Customer ID'),
              React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'CUS-1001', value:custImport.customer?.id||'', onChange:e=>setCustImport(prev=>({ ...prev, customer:{ ...(prev.customer||{}), id:e.target.value } })) })
            ),
            React.createElement('div', { className:'space-y-1 md:col-span-2' },
              React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Name'),
              React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'Customer name', value:custImport.customer?.name||'', onChange:e=>setCustImport(prev=>({ ...prev, customer:{ ...(prev.customer||{}), name:e.target.value } })) })
            ),
            React.createElement('div', { className:'space-y-1' },
              React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Contact Person'),
              React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'Primary contact', value:custImport.customer?.contact_person||'', onChange:e=>setCustImport(prev=>({ ...prev, customer:{ ...(prev.customer||{}), contact_person:e.target.value } })) })
            ),
            React.createElement('div', { className:'space-y-1' },
              React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Phone'),
              React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'+1-555-0100', value:custImport.customer?.phone||'', onChange:e=>setCustImport(prev=>({ ...prev, customer:{ ...(prev.customer||{}), phone:e.target.value } })) })
            ),
            React.createElement('div', { className:'space-y-1' },
              React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Email'),
              React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'customer@example.com', value:custImport.customer?.email||'', onChange:e=>setCustImport(prev=>({ ...prev, customer:{ ...(prev.customer||{}), email:e.target.value } })) })
            ),
            React.createElement('div', { className:'md:col-span-6 flex flex-wrap gap-3 justify-end' },
              React.createElement('button', { className:'px-4 py-2 bg-green-600 text-white rounded font-semibold shadow-sm', onClick: async ()=>{
                const c = custImport.customer||{}; const body={ ...c, file_token: custImport.file_token||'' };
                if(!body.id || !body.name){ alert('Provide Customer ID and Name before confirming.'); return; }
                const r=await fetch(`${API_URL}/import/customer/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); const res=await r.json(); if(!r.ok){ alert(res.error||'Failed'); return; } alert(res.message||'Imported'); setCustImport(null); onRefresh?.();
              } }, 'Confirm & Add/Update')
            )
          )
        )
      ),
      React.createElement(Section, { title: 'Customers' },
        React.createElement('div', { className:'mb-3 flex flex-wrap gap-3 items-center' },
          React.createElement('span', { className:'text-sm text-gray-700' }, 'Columns:'),
          [['id','ID'],['name','Name'],['contact','Contact'],['phone','Phone'],['email','Email']].map(([k,label]) => (
            React.createElement('label', { key:k, className:'text-sm flex items-center gap-1' },
              React.createElement('input', { type:'checkbox', checked: cols[k], onChange:e=>setCols({ ...cols, [k]: e.target.checked }) }), label
            )
          )),
          React.createElement('button', { className:'ml-auto px-3 py-2 bg-red-600 text-white rounded disabled:opacity-50', disabled: !selected.length, onClick: deleteSelected }, `Delete Selected (${selected.length||0})`)
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' },
                React.createElement('th', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked: allSelected, onChange: toggleAll })),
                cols.id && React.createElement('th', { className:'p-2' }, 'ID'),
                cols.name && React.createElement('th', { className:'p-2' }, 'Name'),
                cols.contact && React.createElement('th', { className:'p-2' }, 'Contact'),
                cols.phone && React.createElement('th', { className:'p-2' }, 'Phone'),
                cols.email && React.createElement('th', { className:'p-2' }, 'Email'),
                React.createElement('th', { className:'p-2' }, 'Actions')
              )
            ),
            React.createElement('tbody', null,
              customers.map(c => (
                React.createElement('tr', { key:c.id, className:'border-b' },
                  React.createElement('td', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked:selected.includes(c.id), onChange:()=>toggle(c.id) })),
                  cols.id && React.createElement('td', { className:'p-2 font-mono' }, c.id),
                  cols.name && React.createElement('td', { className:'p-2' }, React.createElement('button', { className:'underline text-blue-700', onClick:()=>openCustomer(c) }, c.name)),
                  cols.contact && React.createElement('td', { className:'p-2' }, c.contact_person||''),
                  cols.phone && React.createElement('td', { className:'p-2' }, c.phone||''),
                  cols.email && React.createElement('td', { className:'p-2' }, c.email||''),
                  React.createElement('td', { className:'p-2 text-right space-x-2' },
                    React.createElement('button', { onClick:()=>openCustomer(c), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'View / Edit'),
                    React.createElement('button', { onClick:()=>del(c.id), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete')
                  )
                )
              ))
            )
          )
        )
        , modalCustomer && React.createElement('div', { className:'fixed inset-0 bg-black/30 flex items-center justify-center z-50' },
            React.createElement('div', { className:'bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl' },
              React.createElement('h4', { className:'text-lg font-bold mb-3' }, `Edit Customer: ${modalCustomer.id}`),
              React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-2 gap-3' },
                React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Name', value:modalCustomer.name||'', onChange:e=>setModalCustomer({ ...modalCustomer, name:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Contact Person', value:modalCustomer.contact_person||'', onChange:e=>setModalCustomer({ ...modalCustomer, contact_person:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'City', value:modalCustomer.city||'', onChange:e=>setModalCustomer({ ...modalCustomer, city:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Country', value:modalCustomer.country||'', onChange:e=>setModalCustomer({ ...modalCustomer, country:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Phone', value:modalCustomer.phone||'', onChange:e=>setModalCustomer({ ...modalCustomer, phone:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Email', value:modalCustomer.email||'', onChange:e=>setModalCustomer({ ...modalCustomer, email:e.target.value }) }),
                React.createElement('textarea', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Office Address', value:modalCustomer.office_address||'', onChange:e=>setModalCustomer({ ...modalCustomer, office_address:e.target.value }) }),
                React.createElement('textarea', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Warehouse Address', value:modalCustomer.warehouse_address||'', onChange:e=>setModalCustomer({ ...modalCustomer, warehouse_address:e.target.value }) })
              ),
              React.createElement('div', { className:'mt-4 flex justify-end gap-2' },
                React.createElement('button', { className:'px-3 py-2 border rounded', onClick:()=>setModalCustomer(null) }, 'Close'),
                React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:saveModal }, 'Save Changes')
              )
            )
          )
      )
    )
  );
}

function VendorManagement({ vendors, onRefresh }){
  const [form, setForm] = useState({ id:'', name:'', contact_person:'', phone:'', email:'', office_address:'', material_type:'', city:'', country:'' });
  const [vendImport, setVendImport] = useState(null);
  const [cols, setCols] = useState({ id:true, name:true, contact:true, phone:true, email:true });
  const [selected, setSelected] = useState([]);
  const allSelected = selected.length>0 && selected.length === vendors.length;
  function toggle(id){ setSelected(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]); }
  function toggleAll(){ setSelected(allSelected ? [] : vendors.map(v=>v.id)); }
  async function deleteSelected(){ if(!selected.length) return; if(!confirm(`Delete ${selected.length} vendor(s)?`)) return; for(const id of selected){ await fetch(`${API_URL}/vendors/${encodeURIComponent(id)}`, { method:'DELETE' }); } setSelected([]); onRefresh?.(); }
  const [modalVendor, setModalVendor] = useState(null);
  function openVendor(v){ setModalVendor({ vendor_type: (v && v.vendor_type) || 'Other', ...v }); }
  async function saveVendorModal(){ const v=modalVendor; const r=await fetch(`${API_URL}/vendors/${encodeURIComponent(v.id)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(v) }); if(!r.ok){ const res=await r.json().catch(()=>({})); alert(res.error||'Save failed'); return; } setModalVendor(null); onRefresh?.(); }
  async function add(){
    const payload = { ...form };
    if (!payload.id || !payload.name){ alert('Please enter Vendor ID and Name'); return; }
    try{
      const r = await fetch(`${API_URL}/vendors`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const res = await r.json().catch(()=>({}));
      if(!r.ok){ alert(res.error || 'Failed to add vendor'); return; }
      setForm({ id:'', name:'', contact_person:'', phone:'', email:'', office_address:'', vendor_type:'Other', material_type:'', city:'', country:'' });
      onRefresh?.();
    } catch(e){ alert('Network error while adding vendor'); }
  }
  async function del(id){ if(!confirm('Delete vendor?')) return; await fetch(`${API_URL}/vendors/${id}`, { method:'DELETE' }); onRefresh?.(); }
  return (
    React.createElement('div', { className: 'space-y-4' },
      React.createElement(Section, { title: 'Add Vendor' },
        React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-8 gap-4 items-end' },
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'ID'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'VEND-1001', value: form.id, onChange: e=>setForm({...form,id:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1 md:col-span-2' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Name'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'Vendor Name', value: form.name, onChange: e=>setForm({...form,name:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Contact Person'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'Contact Person', value: form.contact_person, onChange: e=>setForm({...form,contact_person:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Phone'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: '+1-555-0100', value: form.phone, onChange: e=>setForm({...form,phone:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Email'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'vendor@example.com', value: form.email, onChange: e=>setForm({...form,email:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'City'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'City', value: form.city||'', onChange: e=>setForm({...form,city:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Country'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'Country', value: form.country||'', onChange: e=>setForm({...form,country:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1 md:col-span-3' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Office Address'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'Office Address', value: form.office_address, onChange: e=>setForm({...form,office_address:e.target.value}) })
          ),
          React.createElement('div', { className:'space-y-1' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Vendor Type'),
            React.createElement('select', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', value: form.vendor_type||'Other', onChange: e=>setForm({ ...form, vendor_type: e.target.value }) }, ['Jobber','Raw Materials','Other'].map(vt=> React.createElement('option', { key:vt, value:vt }, vt)))
          ),
          React.createElement('div', { className:'space-y-1 md:col-span-2' },
            React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Material Type'),
            React.createElement('input', { className: 'border rounded px-3 py-2 h-10 text-sm w-full', placeholder: 'e.g., Steel, Copper', value: form.material_type||'', onChange: e=>setForm({...form,material_type:e.target.value}) })
          ),
          React.createElement('div', { className:'flex md:justify-end' },
            React.createElement('button', { onClick: add, className: 'h-10 px-5 bg-green-600 text-white rounded font-semibold shadow-sm' }, 'Add')
          )
        )
      ),
      React.createElement(Section, { title: 'Import Vendor (PDF)' },
        React.createElement('div', { className:'space-y-4' },
          React.createElement('div', { className:'flex flex-col md:flex-row md:items-center gap-3' },
            React.createElement('label', { className:'text-sm font-semibold text-gray-700' }, 'Upload PDF'),
            React.createElement('input', { type:'file', accept:'application/pdf', className:'text-sm', onChange: async (e)=>{
              const f=e.target.files&&e.target.files[0]; if(!f) return; const fd=new FormData(); fd.append('file', f);
              const r=await fetch(`${API_URL}/import/vendor/preview`, { method:'POST', body: fd }); const data=await r.json(); if(!r.ok){ alert(data.error||'Failed to parse'); return; }
              setVendImport({ vendor: data.vendor||{}, file_token: data.file_token||'' });
            }})
          ),
          vendImport && React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-4' },
            React.createElement('div', { className:'space-y-1' },
              React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Vendor ID'),
              React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'VEND-1001', value:vendImport.vendor?.id||'', onChange:e=>setVendImport(prev=>({ ...prev, vendor:{ ...(prev.vendor||{}), id:e.target.value } })) })
            ),
            React.createElement('div', { className:'space-y-1 md:col-span-2' },
              React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Name'),
              React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'Vendor name', value:vendImport.vendor?.name||'', onChange:e=>setVendImport(prev=>({ ...prev, vendor:{ ...(prev.vendor||{}), name:e.target.value } })) })
            ),
            React.createElement('div', { className:'space-y-1' },
              React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Contact Person'),
              React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'Primary contact', value:vendImport.vendor?.contact_person||'', onChange:e=>setVendImport(prev=>({ ...prev, vendor:{ ...(prev.vendor||{}), contact_person:e.target.value } })) })
            ),
            React.createElement('div', { className:'space-y-1' },
              React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Phone'),
              React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'+1-555-0100', value:vendImport.vendor?.phone||'', onChange:e=>setVendImport(prev=>({ ...prev, vendor:{ ...(prev.vendor||{}), phone:e.target.value } })) })
            ),
            React.createElement('div', { className:'space-y-1' },
              React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Email'),
              React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'vendor@example.com', value:vendImport.vendor?.email||'', onChange:e=>setVendImport(prev=>({ ...prev, vendor:{ ...(prev.vendor||{}), email:e.target.value } })) })
            ),
            React.createElement('div', { className:'md:col-span-6 flex flex-wrap gap-3 justify-end' },
              React.createElement('button', { className:'px-4 py-2 bg-green-600 text-white rounded font-semibold shadow-sm', onClick: async ()=>{
                const v = vendImport.vendor||{}; const body={ ...v, file_token: vendImport.file_token||'' };
                if(!body.id || !body.name){ alert('Provide Vendor ID and Name before confirming.'); return; }
                const r=await fetch(`${API_URL}/import/vendor/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); const res=await r.json(); if(!r.ok){ alert(res.error||'Failed'); return; } alert(res.message||'Imported'); setVendImport(null); onRefresh?.();
              } }, 'Confirm & Add/Update')
            )
          )
        )
      ),
      React.createElement(Section, { title: 'Vendors' },
        React.createElement('div', { className:'mb-3 flex flex-wrap gap-3 items-center' },
          React.createElement('span', { className:'text-sm text-gray-700' }, 'Columns:'),
          [['id','ID'],['name','Name'],['contact','Contact'],['phone','Phone'],['email','Email']].map(([k,label]) => (
            React.createElement('label', { key:k, className:'text-sm flex items-center gap-1' },
              React.createElement('input', { type:'checkbox', checked: cols[k], onChange:e=>setCols({ ...cols, [k]: e.target.checked }) }), label
            )
          )),
          React.createElement('button', { className:'ml-auto px-3 py-2 bg-red-600 text-white rounded disabled:opacity-50', disabled: !selected.length, onClick: deleteSelected }, `Delete Selected (${selected.length||0})`)
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' },
                React.createElement('th', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked: allSelected, onChange: toggleAll })),
                cols.id && React.createElement('th', { className:'p-2' }, 'ID'),
                cols.name && React.createElement('th', { className:'p-2' }, 'Name'),
                cols.contact && React.createElement('th', { className:'p-2' }, 'Contact'),
                cols.phone && React.createElement('th', { className:'p-2' }, 'Phone'),
                cols.email && React.createElement('th', { className:'p-2' }, 'Email'),
                React.createElement('th', { className:'p-2' }, 'Actions')
              )
            ),
            React.createElement('tbody', null,
              vendors.map(v => (
                React.createElement('tr', { key:v.id, className:'border-b' },
                  React.createElement('td', { className:'p-2 text-center' }, React.createElement('input', { type:'checkbox', checked:selected.includes(v.id), onChange:()=>toggle(v.id) })),
                  cols.id && React.createElement('td', { className:'p-2 font-mono' }, v.id),
                  cols.name && React.createElement('td', { className:'p-2' }, React.createElement('button', { className:'underline text-blue-700', onClick:()=>openVendor(v) }, v.name)),
                  cols.contact && React.createElement('td', { className:'p-2' }, v.contact_person||''),
                  cols.phone && React.createElement('td', { className:'p-2' }, v.phone||''),
                  cols.email && React.createElement('td', { className:'p-2' }, v.email||''),
                  React.createElement('td', { className:'p-2 text-right space-x-2' },
                    React.createElement('button', { onClick:()=>openVendor(v), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'View / Edit'),
                    React.createElement('button', { onClick:()=>del(v.id), className:'px-2 py-1 bg-red-600 text-white rounded text-sm' }, 'Delete')
                  )
                )
              ))
            )
          )
        )
        , modalVendor && React.createElement('div', { className:'fixed inset-0 bg-black/30 flex items-center justify-center z-50' },
            React.createElement('div', { className:'bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl' },
              React.createElement('h4', { className:'text-lg font-bold mb-3' }, `Edit Vendor: ${modalVendor.id}`),
              React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-2 gap-3' },
                React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Name', value:modalVendor.name||'', onChange:e=>setModalVendor({ ...modalVendor, name:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Contact Person', value:modalVendor.contact_person||'', onChange:e=>setModalVendor({ ...modalVendor, contact_person:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'City', value:modalVendor.city||'', onChange:e=>setModalVendor({ ...modalVendor, city:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Country', value:modalVendor.country||'', onChange:e=>setModalVendor({ ...modalVendor, country:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Phone', value:modalVendor.phone||'', onChange:e=>setModalVendor({ ...modalVendor, phone:e.target.value }) }),
                React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Email', value:modalVendor.email||'', onChange:e=>setModalVendor({ ...modalVendor, email:e.target.value }) }),
                React.createElement('textarea', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Office Address', value:modalVendor.office_address||'', onChange:e=>setModalVendor({ ...modalVendor, office_address:e.target.value }) }),
                React.createElement('select', { className:'border rounded px-2 py-1', value: modalVendor.vendor_type||'Other', onChange:e=>setModalVendor({ ...modalVendor, vendor_type: e.target.value }) }, ['Jobber','Raw Materials','Other'].map(vt=> React.createElement('option', { key:vt, value:vt }, vt))),
                React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Material Type', value:modalVendor.material_type||'', onChange:e=>setModalVendor({ ...modalVendor, material_type:e.target.value }) })
              ),
              React.createElement('div', { className:'mt-4 flex justify-end gap-2' },
                React.createElement('button', { className:'px-3 py-2 border rounded', onClick:()=>setModalVendor(null) }, 'Close'),
                React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:saveVendorModal }, 'Save Changes')
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
  // Selection state for bulk delete
  const [selected, setSelected] = useState([]);
  const allSelected = selected.length>0 && selected.length === products.length;
  function toggle(id){ setSelected(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]); }
  function toggleAll(){ setSelected(allSelected ? [] : products.map(p=>p.id)); }
  async function deleteSelected(){
    if (selected.length===0) return;
    if (!confirm(`Delete ${selected.length} product(s)? This cannot be undone.`)) return;
    const resp = await fetch(`${API_URL}/products/bulk-delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids: selected }) });
    const res = await resp.json();
    if(!resp.ok){ alert(res.error||'Delete failed'); return; }
    setSelected([]);
    onRefresh?.();
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
function ImportsPanel({ customers, vendors, products, onRegistered }){
  const [clientPreview, setClientPreview] = useState(null);
  const [clientItems, setClientItems] = useState([]);
  const [useNewCustomer, setUseNewCustomer] = useState(false);
  const [vendorPreview, setVendorPreview] = useState(null);
  const [vendorItems, setVendorItems] = useState([]);
  async function uploadClient(e){
    const f = e.target.files[0]; if(!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch(`${API_URL}/import/client-po/preview`, { method:'POST', body: fd });
    const data = await r.json();
    const normalizedItems = Array.isArray(data.items) ? data.items.map(it=>({
      product_id: it.product_id||'',
      description: it.description||'',
      quantity: Number(it.quantity||0),
      unit_price: Number(it.unit_price||0),
      unit: it.unit || 'pcs'
    })) : [];
    setClientPreview({ po: { currency:'INR', status:'Pending', notes:'', marking:'', ...(data.po||{}) }, text: data.text||'', warning: data.warning || '', file_token: data.file_token||'' });
    setClientItems(normalizedItems.length ? normalizedItems : []);
  }
  async function uploadVendor(e){
    const f = e.target.files[0]; if(!f) return;
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch(`${API_URL}/import/vendor-po/preview`, { method:'POST', body: fd });
    const data = await r.json();
    const normalizedItems = Array.isArray(data.items) ? data.items.map(it=>({
      item: it.item || `ITEM-${Math.random().toString(36).slice(-4)}`,
      description: it.description || '',
      qty: Number(it.qty||0),
      unit: it.unit || 'pcs'
    })) : [];
    setVendorPreview({ vpo: { status:'Pending', ...(data.vpo||{}) }, text: data.text||'', warning: data.warning||'', file_token: data.file_token||'' });
    setVendorItems(normalizedItems.length ? normalizedItems : []);
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
        delivery_terms: po.delivery_terms || null,
        payment_terms: po.payment_terms || null,
        notes: po.notes || '',
        marking: po.marking || '',
        items: clientItems,
        file_token: clientPreview.file_token || ''
      };
    const r = await fetch(`${API_URL}/import/client-po/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const res = await r.json();
    if(!r.ok){ alert(res.error||'Failed to register'); return; }
    alert(res.message||'Registered');
    try{ onRegistered?.(); }catch(_){ }
  }
  async function confirmVendor(){
    const vpo = vendorPreview?.vpo || {};
    if (!vpo.id || !vpo.po_date || !vpo.due_date){ alert('Fill VPO ID, PO Date, and Due Date before confirming.'); return; }
    const payload = {
      id: vpo.id,
      vendor_id: vpo.vendor_id || '',
      vendor_name: vpo.vendor_name || '',
      contact_person: vpo.contact_person || '',
      phone: vpo.phone || '',
      email: vpo.email || '',
      po_date: vpo.po_date,
      due_date: vpo.due_date,
      status: vpo.status || 'Pending',
      notes: vpo.notes || '',
      items: vendorItems.map(row => ({ item: row.item||'', description: row.description||'', qty: Number(row.qty||0), unit: row.unit||'pcs' })),
      file_token: vendorPreview?.file_token || ''
    };
    const r = await fetch(`${API_URL}/import/vendor-po/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const res = await r.json();
    if(!r.ok){ alert(res.error||'Failed'); return; }
    alert(res.message||'Registered');
    setVendorPreview(null);
    setVendorItems([]);
    try{ onRegistered?.(); }catch(_){ }
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

 

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Marking (Customer ID)'),
            React.createElement('select', { className:'border rounded px-2 py-1 md:col-span-2', value:clientPreview.po?.marking||'', onChange:e=>updateClientPo('marking', e.target.value) },
              React.createElement('option', { value:'' }, '-- Select --'),
              customers.map(c=> React.createElement('option', { key:c.id, value:c.id }, `${c.id} - ${c.name}`))
            ),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Delivery Terms'),
            React.createElement('select', { className:'border rounded px-2 py-1 md:col-span-2', value:clientPreview.po?.delivery_terms||'FOB', onChange:e=>updateClientPo('delivery_terms', e.target.value) }, ['FOB','CIF','Door Delivery','DDP','Factory Ex Works'].map(x=> React.createElement('option', { key:x, value:x }, x))),

            React.createElement('label', { className:'text-xs font-semibold text-gray-600' }, 'Payment Terms'),
            React.createElement('div', { className:'md:col-span-2 flex items-center gap-2' },
              React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', min:0, max:100, placeholder:'Advance %', value:clientPreview.po?.advance_pct||0, onChange:e=>{ const pct=Number(e.target.value||0); updateClientPo('advance_pct', pct); const after = clientPreview.po?.after_term||'At dispatch'; const bal = Math.max(0,100-pct); updateClientPo('payment_terms', pct?`${pct}% advance, balance ${bal}% ${after}`: after); } }),
              React.createElement('select', { className:'border rounded px-2 py-1', value:clientPreview.po?.after_term||'At dispatch', onChange:e=>{ const after = e.target.value; updateClientPo('after_term', after); const pct = Number(clientPreview.po?.advance_pct||0); const bal = Math.max(0,100-pct); updateClientPo('payment_terms', pct?`${pct}% advance, balance ${bal}% ${after}`: after); } }, ['At dispatch','30 days Net from B/L','56 days Net from B/L','60 days Net from B/L','90 days Net from B/L','At B/L release'].map(x=> React.createElement('option', { key:x, value:x }, x))),
              React.createElement('span', { className:'text-xs text-gray-600' }, clientPreview.po?.payment_terms||'')
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
                  React.createElement('tr', { className:'bg-gray-100' }, ['Product','New Product?','New Product ID','Description','Steel Dia','Dia Unit','Length','Len Unit','Coating (Âµm)','Qty','Unit Price','Unit','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
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
                      React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-24', type:'number', placeholder:'Âµm', value:it.coating_um||'', onChange:e=>updateClientItem(i,'coating_um', e.target.value) })),
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
        React.createElement('div', { className:'space-y-4' },
          React.createElement('div', { className:'flex flex-col md:flex-row md:items-center gap-3' },
            React.createElement('label', { className:'text-sm font-semibold text-gray-700' }, 'Upload PDF'),
            React.createElement('input', { type:'file', accept:'application/pdf', className:'text-sm', onChange: async (e)=>{
              const f=e.target.files&&e.target.files[0]; if(!f) return; const fd=new FormData(); fd.append('file', f);
              const r=await fetch(`${API_URL}/import/vendor-po/preview`, { method:'POST', body: fd }); const data=await r.json(); if(!r.ok){ alert(data.error||'Failed to parse'); return; }
              const normalizedItems = Array.isArray(data.items) ? data.items.map(it=>({
                item: it.item || `ITEM-${Math.random().toString(36).slice(-4)}`,
                description: it.description || '',
                qty: Number(it.qty||0),
                unit: it.unit || 'pcs'
              })) : [];
              setVpoImport({
                vpo: { status:'Pending', ...(data.vpo||{}) },
                text: data.text || '',
                warning: data.warning || '',
                file_token: data.file_token || ''
              });
              setVpoImportItems(normalizedItems.length ? normalizedItems : []);
            }})
          ),
          vpoImport && React.createElement(React.Fragment, null,
            React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-4' },
              vpoImport.warning && React.createElement('div', { className:'md:col-span-6 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded px-3 py-2' }, vpoImport.warning),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'VPO ID'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'VPO-1001', value:vpoImport.vpo?.id||'', onChange:e=>setVpoImport(prev=>({ ...prev, vpo:{ ...(prev.vpo||{}), id:e.target.value } })) })
              ),
              React.createElement('div', { className:'space-y-1 md:col-span-2' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Vendor'),
                React.createElement('div', { className:'flex items-center gap-2' },
                  React.createElement('select', { className:'border rounded px-3 py-2 h-10 text-sm w-full', value:vpoImport.vpo?.vendor_id||'', onChange:e=>setVpoImport(prev=>({ ...prev, vpo:{ ...(prev.vpo||{}), vendor_id:e.target.value, vendor_name:'' } })) },
                    React.createElement('option', { value:'' }, 'Select existing vendor'),
                    vendors.map(v=> React.createElement('option', { key:v.id, value:v.id }, `${v.id} - ${v.name}`))
                  ),
                  React.createElement('span', { className:'text-xs text-gray-500 whitespace-nowrap' }, 'or'),
                  React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm flex-1', placeholder:'New vendor name', value: vpoImport.vpo?.vendor_name||'', onChange:e=>setVpoImport(prev=>({ ...prev, vpo:{ ...(prev.vpo||{}), vendor_name:e.target.value, vendor_id:'' } })) })
                )
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Contact Person'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'Optional', value:vpoImport.vpo?.contact_person||'', onChange:e=>setVpoImport(prev=>({ ...prev, vpo:{ ...(prev.vpo||{}), contact_person:e.target.value } })) })
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Phone'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'+1-555-0100', value:vpoImport.vpo?.phone||'', onChange:e=>setVpoImport(prev=>({ ...prev, vpo:{ ...(prev.vpo||{}), phone:e.target.value } })) })
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Email'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'vendor@example.com', value:vpoImport.vpo?.email||'', onChange:e=>setVpoImport(prev=>({ ...prev, vpo:{ ...(prev.vpo||{}), email:e.target.value } })) })
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'PO Date'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', type:'date', value:vpoImport.vpo?.po_date||'', onChange:e=>setVpoImport(prev=>({ ...prev, vpo:{ ...(prev.vpo||{}), po_date:e.target.value } })) })
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Due Date'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', type:'date', value:vpoImport.vpo?.due_date||'', onChange:e=>setVpoImport(prev=>({ ...prev, vpo:{ ...(prev.vpo||{}), due_date:e.target.value } })) })
              ),
              React.createElement('div', { className:'space-y-1 md:col-span-6' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Notes'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', placeholder:'Optional notes', value:vpoImport.vpo?.notes||'', onChange:e=>setVpoImport(prev=>({ ...prev, vpo:{ ...(prev.vpo||{}), notes:e.target.value } })) })
              ),
              vpoImportItems.length > 0 && React.createElement('div', { className:'md:col-span-6 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2' }, `${vpoImportItems.length} line item(s) extracted from PDF.`),
              React.createElement('div', { className:'md:col-span-6 flex flex-wrap gap-3 justify-end' },
                React.createElement('button', { className:'px-4 py-2 bg-green-600 text-white rounded font-semibold shadow-sm', onClick: async ()=>{
                  const vpo = vpoImport.vpo || {};
                  if (!vpo.id || !vpo.po_date || !vpo.due_date){ alert('Fill VPO ID, PO Date, and Due Date before confirming.'); return; }
                  const payload = {
                    id: vpo.id,
                    vendor_id: vpo.vendor_id||'',
                    vendor_name: vpo.vendor_name||'',
                    contact_person: vpo.contact_person||'',
                    phone: vpo.phone||'',
                    email: vpo.email||'',
                    po_date: vpo.po_date,
                    due_date: vpo.due_date,
                    status: vpo.status||'Pending',
                    notes: vpo.notes||'',
                    items: vpoImportItems.map(row => ({ item: row.item||'', description: row.description||'', qty: Number(row.qty||0), unit: row.unit||'pcs' })),
                    file_token: vpoImport.file_token||''
                  };
                  const resp = await fetch(`${API_URL}/import/vendor-po/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
                  const result = await resp.json();
                  if(!resp.ok){ alert(result.error||'Failed'); return; }
                  alert(result.message||'Registered');
                  setVpoImport(null);
                  setVpoImportItems([]);
                  onRefresh?.();
                } }, 'Confirm & Register')
              )
            ),
            React.createElement('div', { className:'bg-white border border-gray-200 rounded px-3 py-3 space-y-2' },
              React.createElement('div', { className:'flex items-center justify-between' },
                React.createElement('h4', { className:'text-sm font-semibold text-gray-700' }, 'Line Items (from PDF)'),
                React.createElement('button', { className:'px-3 py-1 bg-blue-600 text-white rounded text-sm', onClick:()=>setVpoImportItems([...vpoImportItems, { item:`ITEM-${vpoImportItems.length+1}`, description:'', qty:0, unit:'pcs' }]) }, 'Add Row')
              ),
              React.createElement('div', { className:'overflow-x-auto' },
                React.createElement('table', { className:'min-w-full border-collapse text-sm' },
                  React.createElement('thead', null,
                    React.createElement('tr', { className:'bg-gray-100' }, ['Item','Description','Qty','Unit','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2 text-left' }, h)))
                  ),
                  React.createElement('tbody', null,
                    vpoImportItems.length ? vpoImportItems.map((it, idx) => (
                      React.createElement('tr', { key:idx, className:'border-b' },
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-32 font-mono', value:it.item||'', onChange:e=>{ const arr=[...vpoImportItems]; arr[idx].item=e.target.value; setVpoImportItems(arr); } })),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-full', value:it.description||'', onChange:e=>{ const arr=[...vpoImportItems]; arr[idx].description=e.target.value; setVpoImportItems(arr); } })),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-20 text-right', value:it.qty, onChange:e=>{ const arr=[...vpoImportItems]; arr[idx].qty=Number(e.target.value||0); setVpoImportItems(arr); } })),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-20', value:it.unit||'pcs', onChange:e=>{ const arr=[...vpoImportItems]; arr[idx].unit=e.target.value||'pcs'; setVpoImportItems(arr); } })),
                        React.createElement('td', { className:'p-2 text-right' }, React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>{ const arr=[...vpoImportItems]; arr.splice(idx,1); setVpoImportItems(arr); } }, 'Remove'))
                      )
                    )) : React.createElement('tr', null, React.createElement('td', { className:'p-2 text-sm text-gray-500', colSpan:5 }, 'No items detected in PDF.'))
                  )
                )
              )
            ),
            React.createElement('div', { className:'bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap' }, vpoImport.text ? vpoImport.text : 'No text extracted from PDF. Review the document manually.')
          )
        )
      )
    )
  );
}
// Extended Vendor Purchase Orders with line items (item, description, qty, unit)
function VendorPurchaseOrdersEx({ purchaseOrders, vendors, onRefresh, company }){
  const [form, setForm] = useState({ id:'', vendor_id:'', po_date:'', due_date:'', status:'Pending', notes:'' });
  const [vpoImport, setVpoImport] = useState(null);
  const [vpoImportItems, setVpoImportItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [openItems, setOpenItems] = useState({});
  const [itemsCache, setItemsCache] = useState({});
  const [newItem, setNewItem] = useState({ item:'', description:'', qty:0, unit:'kg' });
  const [cols, setCols] = useState({ id:true, vendor:true, po_date:true, due_date:true, status:true, notes:true });
  const [vpoModal, setVpoModal] = useState(null);
  async function add(){ await fetch(`${API_URL}/vendor-purchase-orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }); setForm({ id:'', vendor_id:'', po_date:'', due_date:'', status:'Pending', notes:'' }); onRefresh?.(); }
  async function exportVendorPoLocal(vpoIdOrObj, format){
    try{
      const vpo = typeof vpoIdOrObj === 'string' ? (purchaseOrders||[]).find(x=>x.id===vpoIdOrObj) : vpoIdOrObj;
      if (!vpo) throw new Error('VPO not found');
      const r = await fetch(`${API_URL}/vendor-purchase-orders/${encodeURIComponent(vpo.id)}`);
      const full = await r.json(); if(!r.ok) throw new Error(full.error||'Failed to load');
      const items = full.items || full.line_items || [];
      const html = buildPOHtml({ company, headerTitle:'Purchase Order (Vendor)', partyName: full.vendor_name||full.vendor_id, partyAddress:'', po: full, items, totals: items.reduce((s,it)=> s + Number(it.qty||it.quantity||0)*Number(it.unit_price||0), 0) });
      const container = document.createElement('div'); container.innerHTML = html; document.body.appendChild(container);
      if (format==='pdf'){ await html2pdf().from(container).set({ margin:10, filename:`vendor-po-${vpo.id}.pdf` }).save(); }
      else { const blob = new Blob([html], { type:'application/msword' }); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`vendor-po-${vpo.id}.doc`; a.click(); URL.revokeObjectURL(url); }
      document.body.removeChild(container);
    }catch(e){ alert(e.message||'Export failed'); }
  }
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
  function openVpoModal(vpo){ setVpoModal({ ...vpo }); }
  async function saveVpoModal(){
    if (!vpoModal) return;
    const payload = { vendor_id: vpoModal.vendor_id, po_date: vpoModal.po_date, due_date: vpoModal.due_date, status: vpoModal.status, notes: vpoModal.notes };
    const r = await fetch(`${API_URL}/vendor-purchase-orders/${encodeURIComponent(vpoModal.id)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const res = await r.json().catch(()=>({}));
    if(!r.ok){ alert(res.error||'Save failed'); return; }
    setVpoModal(null);
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
                      React.createElement('button', { onClick:()=>openVpoModal(vpo), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'View / Edit'),
                      React.createElement('button', { onClick:()=>setEditing(vpo.id), className:'px-2 py-1 border rounded text-sm' }, 'Inline Edit'),
                      React.createElement('button', { onClick:()=>toggleItems(vpo), className:'px-2 py-1 border rounded text-sm' }, openItems[vpo.id] ? 'Hide Items' : 'Items'),
                      React.createElement('button', { onClick:()=>openGrn(vpo), className:'px-2 py-1 border rounded text-sm' }, 'GRN'),
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
            React.createElement('div', { className:'mb-2 flex items-center justify-between gap-2' },
              React.createElement('div', { className:'text-sm text-gray-700' }, `Items for VPO ${id}`),
              React.createElement('div', { className:'flex gap-2' },
                React.createElement('button', { className:'px-2 py-1 border rounded text-sm', onClick:()=>exportVendorPoLocal(id,'pdf') }, 'PDF (Letterhead)'),
                React.createElement('button', { className:'px-2 py-1 border rounded text-sm', onClick:()=>exportVendorPoLocal(id,'doc') }, 'DOC')
              )
            ),
            React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-5 gap-2 mb-2' },
              React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Item', value:newItem.item, onChange:e=>setNewItem({...newItem,item:e.target.value}) }),
              React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Description', value:newItem.description, onChange:e=>setNewItem({...newItem,description:e.target.value}) }),
              React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Qty', value:newItem.qty, onChange:e=>setNewItem({...newItem,qty:Number(e.target.value||0)}) }),
              React.createElement('select', { className:'border rounded px-2 py-1', value:newItem.unit, onChange:e=>setNewItem({...newItem,unit:e.target.value}) }, ['kg','pcs','litre'].map(u=> React.createElement('option', { key:u, value:u }, u))),
              React.createElement('button', { className:'px-3 py-1 bg-green-600 text-white rounded', onClick:()=>addItem({ id }) }, 'Add Item')
            ),
            grn.open && React.createElement('div', { className:'mt-4 border-t pt-3' },
              React.createElement('div', { className:'text-sm font-semibold mb-2' }, 'GRN for VPO ' + (((grn.vpo||{}).id)||'')),
              React.createElement('div', { className:'overflow-x-auto' },
                React.createElement('table', { className:'min-w-full border-collapse' },
                  React.createElement('thead', null,
                    React.createElement('tr', { className:'bg-gray-100' }, ['Material','Description','Qty to Receive','Unit'].map(h=> React.createElement('th', { key:h, className:'p-2 text-left' }, h)))
                  ),
                  React.createElement('tbody', null,
                    (grn.items||[]).map((it, idx)=> (
                      React.createElement('tr', { key:idx, className:'border-b' },
                        React.createElement('td', { className:'p-2 font-mono' }, it.material||''),
                        React.createElement('td', { className:'p-2' }, it.description||''),
                        React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-32 text-right', value: it.qty_receipt, onChange:e=>{ const arr=[...grn.items]; arr[idx].qty_receipt = Number(e.target.value||0); setGrn({ ...grn, items: arr }); } })),
                        React.createElement('td', { className:'p-2' }, React.createElement('select', { className:'border rounded px-2 py-1', value: it.unit||'kg', onChange:e=>{ const arr=[...grn.items]; arr[idx].unit = e.target.value; setGrn({ ...grn, items: arr }); } }, ['kg','g','t'].map(u=> React.createElement('option', { key:u, value:u }, u))))
                      )
                    ))
                  )
                )
              ),
              grn.open && React.createElement('div', { className:'flex justify-end gap-2 mt-2' },
                React.createElement('button', { className:'px-2 py-1 border rounded text-sm', onClick:()=>setGrn({ open:false, vpo:null, items:[] }) }, 'Cancel GRN'),
                React.createElement('button', { className:'px-2 py-1 bg-green-600 text-white rounded text-sm', onClick:postGrn }, 'Post Receipt')
              )
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
        )),
        vpoModal && React.createElement('div', { className:'fixed inset-0 bg-black/30 flex items-center justify-center z-50' },
          React.createElement('div', { className:'bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl space-y-4' },
            React.createElement('div', { className:'flex justify-between items-center' },
              React.createElement('h4', { className:'text-lg font-bold' }, `Vendor PO: ${vpoModal.id}`),
              React.createElement('button', { className:'text-sm underline', onClick:()=>setVpoModal(null) }, 'Close')
            ),
            React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-2 gap-4' },
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Vendor'),
                React.createElement('select', { className:'border rounded px-3 py-2 h-10 text-sm w-full', value:vpoModal.vendor_id||'', onChange:e=>setVpoModal({ ...vpoModal, vendor_id:e.target.value }) },
                  React.createElement('option', { value:'' }, 'Select vendor'),
                  vendors.map(v=> React.createElement('option', { key:v.id, value:v.id }, `${v.id} - ${v.name}`))
                )
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Status'),
                React.createElement('select', { className:'border rounded px-3 py-2 h-10 text-sm w-full', value:vpoModal.status||'Pending', onChange:e=>setVpoModal({ ...vpoModal, status:e.target.value }) },
                  ['Pending','Ordered','In Transit','Completed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))
                )
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'PO Date'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', type:'date', value:vpoModal.po_date||'', onChange:e=>setVpoModal({ ...vpoModal, po_date:e.target.value }) })
              ),
              React.createElement('div', { className:'space-y-1' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Due Date'),
                React.createElement('input', { className:'border rounded px-3 py-2 h-10 text-sm w-full', type:'date', value:vpoModal.due_date||'', onChange:e=>setVpoModal({ ...vpoModal, due_date:e.target.value }) })
              ),
              React.createElement('div', { className:'space-y-1 md:col-span-2' },
                React.createElement('label', { className:'text-xs font-semibold text-gray-700' }, 'Notes'),
                React.createElement('textarea', { className:'border rounded px-3 py-2 text-sm w-full h-24', placeholder:'Special instructions or follow-ups', value:vpoModal.notes||'', onChange:e=>setVpoModal({ ...vpoModal, notes:e.target.value }) })
              )
            ),
            React.createElement('div', { className:'flex justify-end gap-2' },
              React.createElement('button', { className:'px-3 py-2 border rounded', onClick:()=>setVpoModal(null) }, 'Cancel'),
              React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded font-semibold', onClick:saveVpoModal }, 'Save Changes')
            )
          )
        )
      )
    )
  );
}

// Extended Products table with required columns
function ProductMasterEx({ products, calculateWeights, onRefresh }){
  const [form, setForm] = useState({ id:'', description:'', diameter:0, length:0, coating:0 });
  async function add(){ await fetch(`${API_URL}/products`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...form, diameter:Number(form.diameter), length:Number(form.length), coating:Number(form.coating) }) }); setForm({ id:'', description:'', diameter:0, length:0, coating:0 }); onRefresh?.(); }
  // CSV import state and helpers
  const [replaceAll, setReplaceAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  async function saveProduct(p){
    const payload = {
      description: p.description,
      steel_diameter: Number(p.steel_diameter ?? p.diameter ?? 0),
      copper_coating: Number(p.copper_coating ?? p.coating ?? 0),
      length: Number(p.length ?? 0),
      active: p.active ?? 1
    };
    const r = await fetch(`${API_URL}/products/${encodeURIComponent(p.id)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if(!r.ok){ const res = await r.json().catch(()=>({})); alert(res.error||'Update failed'); return; }
    setEditingId(null); onRefresh?.();
  }
  function parseCSVText(str){
    const rows=[]; let cur=''; let row=[]; let inQ=false;
    for(let i=0;i<str.length;i++){
      const ch=str[i];
      if(inQ){
        if(ch==='"'){
          if(str[i+1]==='"'){ cur+='"'; i++; }
          else { inQ=false; }
        } else { cur+=ch; }
      } else {
        if(ch==='"'){ inQ=true; }
        else if(ch===','){ row.push(cur); cur=''; }
        else if(ch==='\r'){ /* skip */ }
        else if(ch==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; }
        else { cur+=ch; }
      }
    }
    if(cur.length>0 || row.length>0){ row.push(cur); rows.push(row); }
    return rows;
  }
  function normalizeHeader(s){ return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,''); }
  function mapHeaders(headers){
    const idx={};
    headers.forEach((h,i)=>{
      const n=normalizeHeader(h);
      if(n==='id' || n==='productid') idx.id=i;
      else if(n.startsWith('desc')) idx.description=i;
      else if(n.includes('steel') && (n.includes('dia')||n.includes('diameter'))) idx.steel_diameter=i;
      else if(n==='diameter' || n==='dia' || (n.includes('dia') && !idx.steel_diameter)) idx.steel_diameter=i;
      else if(n.includes('coat')) idx.copper_coating=i;
      else if(n.includes('length') || n==='len') idx.length=i;
    });
    return idx;
  }
  async function importCsvFile(e){
    const f=e.target.files && e.target.files[0]; if(!f) return;
    try{
      setImporting(true);
      const text=await f.text();
      const rows=parseCSVText(text);
      if(rows.length<2){ alert('CSV has no data rows'); return; }
      const headers=rows[0];
      const m=mapHeaders(headers);
      const required=['id','description','steel_diameter','copper_coating','length'];
      const missing = required.filter(k=> m[k]===undefined);
      if(missing.length){
        alert('Missing required columns: '+missing.join(', ')+". Expect headers like: id, description, steel_diameter, copper_coating, length");
        return;
      }
      const productsToSend=[];
      for(let r=1;r<rows.length;r++){
        const row=rows[r]; if(!row || (row.length===1 && (row[0]||'').trim()==='')) continue;
        const id=(row[m.id]||'').trim(); const description=(row[m.description]||'').trim();
        const steel_diameter=parseFloat((row[m.steel_diameter]||'').trim());
        const copper_coating=parseFloat((row[m.copper_coating]||'').trim());
        const length=parseFloat((row[m.length]||'').trim());
        if(!id || !description || !isFinite(steel_diameter) || !isFinite(copper_coating) || !isFinite(length)){
          continue; // skip invalid row
        }
        productsToSend.push({ id, description, steel_diameter, copper_coating, length });
      }
      if(productsToSend.length===0){ alert('No valid rows to import'); return; }
      if(!confirm(`Import ${productsToSend.length} products? ${replaceAll? '(This will replace all existing products)' : '(Upsert existing records)'} `)) return;
      const resp = await fetch(`${API_URL}/products/bulk`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ products: productsToSend, mode: replaceAll ? 'replace' : 'upsert' }) });
      const res = await resp.json();
      if(!resp.ok){ alert(res.error||'Import failed'); return; }
      alert(res.message || 'Import completed');
      onRefresh?.();
    } catch(err){
      console.error(err);
      alert('Failed to import CSV: '+(err.message||String(err)));
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }
  return (
    React.createElement('div', { className:'space-y-4' },
      React.createElement(Section, { title:'Add Product' },
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-3' },
          React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'ID', value:form.id, onChange:e=>setForm({ ...form, id:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-2 py-1 md:col-span-2', placeholder:'Description', value:form.description, onChange:e=>setForm({ ...form, description:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Steel Dia (mm)', value:form.diameter, onChange:e=>setForm({ ...form, diameter:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Length (mm)', value:form.length, onChange:e=>setForm({ ...form, length:e.target.value }) }),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Coating (Âµm)', value:form.coating, onChange:e=>setForm({ ...form, coating:e.target.value }) }),
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
              { key:'coating', label:'Cu Coating (Âµm)' },
              { key:'cbgDiameter', label:'CBG Dia (mm)' },
              { key:'cbg', label:'CBG Weight (kg)' }
            ];
            const rows = products.map(p=>{ const w = calculateWeights(p.diameter,p.coating,p.length); return { ...p, length_ft:(p.length/304.8).toFixed(2), cbgDiameter:w.cbgDiameter, cbg:w.cbg }; });
            downloadCSV('products.csv', headers, rows);
          }}, 'Export CSV')
        ),
        React.createElement('div', { className:'mb-3 flex flex-wrap items-center gap-3' },
          React.createElement('button', { className:'px-3 py-2 bg-gray-500 text-white rounded', onClick:()=>{
            const headers = [
              { key:'id', label:'ID' },
              { key:'description', label:'Description' },
              { key:'steel_diameter', label:'Steel Dia (mm)' },
              { key:'copper_coating', label:'Cu Coating (um)' },
              { key:'length', label:'Length (mm)' }
            ];
            downloadCSV('products-template.csv', headers, []);
          }}, 'Download Template CSV'),
          React.createElement('button', { className:'px-3 py-2 bg-red-600 text-white rounded', onClick: async ()=>{
            const txt = prompt('Enter product IDs to delete (comma-separated)');
            if(!txt) return;
            const ids = txt.split(',').map(s=>s.trim()).filter(Boolean);
            if(ids.length===0) return;
            if(!confirm(`Delete ${ids.length} product(s)? This cannot be undone.`)) return;
            const resp = await fetch(`${API_URL}/products/bulk-delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids }) });
            const res = await resp.json();
            if(!resp.ok){ alert(res.error||'Delete failed'); return; }
            alert(res.message || 'Deleted');
            onRefresh?.();
          }}, 'Delete Products (IDs)'),
          React.createElement('label', { className:'text-sm text-gray-700 flex items-center gap-2' },
            React.createElement('input', { type:'checkbox', checked: replaceAll, onChange:e=>setReplaceAll(e.target.checked) }),
            'Replace all products'
          ),
          React.createElement('input', { type:'file', accept:'.csv,text/csv', onChange: importCsvFile, disabled: importing })
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' },
                ['ID','Description','Steel Dia (mm)','Length (mm)','Length (ft)','Cu Coating (Âµm)','CBG Dia (mm)','CBG Weight (kg)'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h))
              )
            ),
            React.createElement('tbody', null,
              products.map(p => {
                const edit = (typeof editingId !== 'undefined') && (editingId === p.id);
                const currentDia = (p.steel_diameter ?? p.diameter ?? 0);
                const currentCoat = (p.copper_coating ?? p.coating ?? 0);
                const w = calculateWeights(currentDia, currentCoat, p.length);
                return React.createElement('tr', { key:p.id, className:'border-b' },
                  React.createElement('td', { className:'p-2 font-mono' },
                    edit
                      ? React.createElement('input', { className:'border rounded px-2 py-1 w-32 font-mono', defaultValue:p.id, onChange:e=>p._new_id = e.target.value })
                      : p.id
                  ),
                  React.createElement('td', { className:'p-2' },
                    edit
                      ? React.createElement('div', { className:'flex items-center gap-2' },
                          React.createElement('input', { className:'border rounded px-2 py-1 flex-1', defaultValue:p.description, onChange:e=>p.description=e.target.value }),
                          React.createElement('button', { onClick:async ()=>{
                            const oldId = p.id;
                            const newId = (p._new_id||'').trim();
                            if (newId && newId !== oldId){
                              const resp = await fetch(`${API_URL}/products/rename`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ old_id: oldId, new_id: newId }) });
                              const res = await resp.json();
                              if(!resp.ok){ alert(res.error||'Rename failed'); return; }
                              p.id = newId;
                            }
                            await saveProduct(p);
                          }, className:'px-2 py-1 bg-green-600 text-white rounded text-sm' }, 'Save'),
                          React.createElement('button', { onClick:()=>setEditingId(null), className:'px-2 py-1 border rounded text-sm' }, 'Cancel')
                        )
                      : React.createElement('div', { className:'flex items-center justify-between gap-2' },
                          React.createElement('span', null, p.description),
                          React.createElement('button', { onClick:()=>setEditingId(p.id), className:'px-2 py-1 bg-blue-600 text-white rounded text-sm' }, 'Edit')
                        )
                  ),
                  React.createElement('td', { className:'p-2 text-center' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', defaultValue:currentDia, onChange:e=>{ const v=Number(e.target.value||0); p.steel_diameter=v; p.diameter=v; } }) : currentDia),
                  React.createElement('td', { className:'p-2 text-center' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', defaultValue:p.length, onChange:e=>p.length=Number(e.target.value||0) }) : p.length),
                  React.createElement('td', { className:'p-2 text-center' }, (p.length/304.8).toFixed(2)),
                  React.createElement('td', { className:'p-2 text-center' }, edit ? React.createElement('input', { className:'border rounded px-2 py-1 w-24 text-right', type:'number', defaultValue:currentCoat, onChange:e=>{ const v=Number(e.target.value||0); p.copper_coating=v; p.coating=v; } }) : currentCoat),
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
root.render(React.createElement(ToastProvider, null, React.createElement(GroundRodERP)));

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


// Build Purchase Order HTML with letterhead and totals/taxes footer
function buildPOHtml({ company, headerTitle, partyName, partyAddress, po, items, totals }){
  const c = company || {};
  const cp = {
    name: c.name || 'NIKKON FERRO PRIVATE LIMITED',
    logo: c.logo_url || '',
    website: c.website || '',
    phone: c.phone || '',
    cin: c.cin || '',
    iso: c.iso || '',
    gstin: c.gstin || '',
    registered: c.registered_address || '',
    factory: c.factory_address || ''
  };
  const fallbackSvg = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="48"><rect width="180" height="48" fill="white"/><text x="8" y="32" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="800" fill="#167DB7">Nikkon Ferro</text></svg>`);
  const logoSrc = cp.logo ? (cp.logo.startsWith('http') ? cp.logo : (window.location.origin + (cp.logo.startsWith('/')? cp.logo : '/' + cp.logo))) : fallbackSvg;
  let contacts = [];
  try { if (company && company.contacts_json) contacts = JSON.parse(company.contacts_json||'[]'); } catch(_){ contacts = []; }
  const currency = po.currency || 'INR';
  const subtotal = Number(totals||0);
  const taxRate = currency === 'INR' ? 0.18 : 0; // default 18% GST for INR
  const taxAmt = +(subtotal * taxRate).toFixed(2);
  const grand = +(subtotal + taxAmt).toFixed(2);
  const fmt = (n)=> (n==null? '' : new Intl.NumberFormat('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 }).format(n));
  const safe = (s)=> (s==null?'':String(s).replace(/</g,'&lt;'));
  const itemRows = (items||[]).map((it,i)=>{
    const qty = Number(it.quantity||it.qty||0);
    const up = Number(it.unit_price||0);
    const lt = up ? qty*up : (Number(it.line_total||0));
    const pid = it.product_id || it.item || '';
    const desc = it.description || it.product_description || '';
    return `<tr>
      <td style="border:1px solid #ddd; padding:6px; text-align:left;">${safe(pid)}</td>
      <td style="border:1px solid #ddd; padding:6px; text-align:left;">${safe(desc)}</td>
      <td style="border:1px solid #ddd; padding:6px; text-align:right;">${qty}</td>
      <td style="border:1px solid #ddd; padding:6px; text-align:right;">${up?fmt(up):''}</td>
      <td style="border:1px solid #ddd; padding:6px; text-align:right;">${fmt(lt)}</td>
    </tr>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family: Inter, Arial, sans-serif; color:#111;}
    .hdr{display:flex; align-items:center; gap:16px; border-bottom:2px solid ${'#167DB7'}; padding-bottom:8px;}
    .hdr img{height:48px}
    .hdr .nm{font-size:20px; font-weight:800; color:#167DB7}
    .meta{font-size:11px; color:#333}
    h1{font-size:18px; margin:12px 0;}
    table{border-collapse:collapse; width:100%;}
  </style></head><body>
    <div class="hdr"><img src="${logoSrc}"><div><div class="nm">${safe(cp.name)}</div>
      ${cp.registered?`<div class="meta">Registered Office: ${safe(cp.registered)}</div>`:''}
      ${cp.factory?`<div class="meta">Factory: ${safe(cp.factory)}</div>`:''}
      <div class="meta">${cp.phone?`Phone: ${safe(cp.phone)} | `:''}${cp.website?`Web: ${safe(cp.website)} | `:''}${cp.gstin?`GSTIN: ${safe(cp.gstin)} | `:''}${cp.cin?`CIN: ${safe(cp.cin)} | `:''}${cp.iso?`ISO: ${safe(cp.iso)}`:''}</div>
      ${contacts && contacts.length ? `<div class="meta">Contacts: ${contacts.map(c=>`${safe(c.name)} (${safe(c.title)}): ${safe(c.email)} | ${safe(c.phone)}`).join('  •  ')}</div>` : ''}
    </div></div>
    <h1>${safe(headerTitle)}</h1>
    <table style="margin-bottom:10px">
      <tr>
        <td style="vertical-align:top; width:60%">
          <div style="font-weight:700;">To:</div>
          <div>${safe(partyName)}</div>
          ${partyAddress?`<div style="white-space:pre-wrap">${safe(partyAddress)}</div>`:''}
        </td>
        <td style="vertical-align:top; width:40%">
          <table style="width:100%">
            ${po.id?`<tr><td style="padding:2px 4px;">PO ID</td><td style="padding:2px 4px; font-weight:600; text-align:right;">${safe(po.id)}</td></tr>`:''}
            ${po.po_date?`<tr><td style="padding:2px 4px;">PO Date</td><td style="padding:2px 4px; text-align:right;">${safe(po.po_date)}</td></tr>`:''}
            ${po.due_date?`<tr><td style="padding:2px 4px;">Due Date</td><td style="padding:2px 4px; text-align:right;">${safe(po.due_date)}</td></tr>`:''}
            ${po.delivery_terms?`<tr><td style="padding:2px 4px;">Delivery Terms</td><td style="padding:2px 4px; text-align:right;">${safe(po.delivery_terms)}</td></tr>`:''}
            ${po.payment_terms?`<tr><td style="padding:2px 4px;">Payment Terms</td><td style="padding:2px 4px; text-align:right;">${safe(po.payment_terms)}</td></tr>`:''}
            ${po.currency?`<tr><td style="padding:2px 4px;">Currency</td><td style="padding:2px 4px; text-align:right;">${safe(po.currency)}</td></tr>`:''}
          </table>
        </td>
      </tr>
    </table>
    <table>
      <thead>
        <tr style="background:#f3f4f6">
          <th style="border:1px solid #ddd; padding:6px; text-align:left;">Item</th>
          <th style="border:1px solid #ddd; padding:6px; text-align:left;">Description</th>
          <th style="border:1px solid #ddd; padding:6px;">Qty</th>
          <th style="border:1px solid #ddd; padding:6px;">Unit Price</th>
          <th style="border:1px solid #ddd; padding:6px;">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || ''}
      </tbody>
    </table>
    <table style="margin-top:10px; width:100%">
      <tr>
        <td style="width:60%"></td>
        <td style="width:40%">
          <table style="width:100%">
            <tr><td style="padding:4px;">Subtotal</td><td style="padding:4px; text-align:right; font-weight:600;">${fmt(subtotal)}</td></tr>
            ${taxRate?`<tr><td style=\"padding:4px;\">Tax (${(taxRate*100).toFixed(0)}%)</td><td style=\"padding:4px; text-align:right; font-weight:600;\">${fmt(taxAmt)}</td></tr>`:''}
            <tr><td style="padding:4px; font-weight:700;">Grand Total</td><td style="padding:4px; text-align:right; font-weight:700;">${fmt(grand)}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body></html>`;
}


// Letters panel to compose on letterhead and export PDF/DOC
function LettersPanel({ company }){
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  function companyProfile(){
    const c = company||{};
    return {
      name: c.name || 'NIKKON FERRO PRIVATE LIMITED',
      logo: c.logo_url || 'assets/logo-nikkon.png',
      website: c.website || '',
      phone: c.phone || '',
      cin: c.cin || '',
      iso: c.iso || '',
      registered: c.registered_address || '',
      factory: c.factory_address || '',
      gstin: c.gstin || '',
      contacts: (function(){ try { return JSON.parse(c.contacts_json||'[]'); } catch(_){ return []; } })()
    };
  }
  function buildLetterHTML(){
    const cp = companyProfile();
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family: Inter, Arial, sans-serif; color:#111;}
      .hdr{display:flex; align-items:center; gap:16px; border-bottom:2px solid ${'#167DB7'}; padding-bottom:8px;}
      .hdr img{height:48px}
      .hdr .nm{font-size:20px; font-weight:800; color:#167DB7}
      .meta{font-size:11px; color:#333}
      h1{font-size:18px; margin:16px 0;}
      .content{white-space:pre-wrap; line-height:1.5;}
      .ftr{margin-top:24px; font-size:12px; color:#444}
    </style></head><body>
    <div class="hdr"><img src="${cp.logo}"><div><div class="nm">${cp.name}</div>
      ${cp.registered?`<div class="meta">Registered Office: ${cp.registered}</div>`:''}
      ${cp.factory?`<div class="meta">Factory: ${cp.factory}</div>`:''}
      <div class="meta">${cp.phone?`Phone: ${cp.phone} | `:''}${cp.website?`Web: ${cp.website} | `:''}${cp.gstin?`GSTIN: ${cp.gstin} | `:''}${cp.cin?`CIN: ${cp.cin} | `:''}${cp.iso?`ISO: ${cp.iso}`:''}</div>
      ${cp.contacts && cp.contacts.length ? `<div class="meta">Contacts: ${cp.contacts.map(c=>`${c.name} (${c.title}): ${c.email} | ${c.phone}`).join('  •  ')}</div>` : ''}
    </div></div>
    ${title?`<h1>${title}</h1>`:''}
    <div class="content">${body.replace(/</g,'&lt;')}</div>
    ${footer?`<div class="ftr">${footer.replace(/</g,'&lt;')}</div>`:''}
    </body></html>`;
  }
  async function exportPDF(){ const html = buildLetterHTML(); const el = document.createElement('div'); el.innerHTML = html; document.body.appendChild(el); await html2pdf().from(el).set({ margin:10, filename:`letter-${Date.now()}.pdf` }).save(); document.body.removeChild(el); }
  function exportDOC(){ const html = buildLetterHTML(); const blob = new Blob([html], { type:'application/msword' }); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href = url; a.download = `letter-${Date.now()}.doc`; a.click(); URL.revokeObjectURL(url); }
  return (
    React.createElement('div', { className:'bg-white rounded-xl shadow-md p-6 border border-gray-200 space-y-3' },
      React.createElement('h3', { className:'text-lg font-bold text-gray-800' }, 'Letter Generator'),
      React.createElement('input', { className:'border rounded px-3 py-2 w-full', placeholder:'Letter Title (optional)', value:title, onChange:e=>setTitle(e.target.value) }),
      React.createElement('textarea', { className:'border rounded px-3 py-2 w-full h-60', placeholder:'Write your letter here...', value:body, onChange:e=>setBody(e.target.value) }),
      React.createElement('input', { className:'border rounded px-3 py-2 w-full', placeholder:'Footer / Sign-off (optional)', value:footer, onChange:e=>setFooter(e.target.value) }),
      React.createElement('div', { className:'flex gap-2' },
        React.createElement('button', { className:'px-3 py-2 bg-blue-600 text-white rounded', onClick:exportPDF }, 'Generate PDF'),
        React.createElement('button', { className:'px-3 py-2 border rounded', onClick:exportDOC }, 'Generate DOC')
      ),
      React.createElement('div', { className:'text-xs text-gray-500' }, 'Note: Place your logo at public/assets/logo-nikkon.png for branding.')
    )
  );
}

// Simple Company Settings UI
function CompanySettingsPanel({ company, products, rawMaterials, onSaved }){
  const [form, setForm] = useState({ name:'', phone:'', website:'', cin:'', iso:'', gstin:'', registered_address:'', factory_address:'', logo_url:'assets/logo-nikkon.png' });
  const [contacts, setContacts] = useState([]);
  useEffect(()=>{
    (async()=>{
      try{
        const r = await fetch(`${API_URL}/company`);
        const data = await r.json();
        setForm({
          name: data.name||'', phone: data.phone||'', website: data.website||'', cin: data.cin||'', iso: data.iso||'',
          gstin: data.gstin||'', registered_address: data.registered_address||'', factory_address: data.factory_address||'', logo_url: data.logo_url||'assets/logo-nikkon.png'
        });
        try { setContacts(JSON.parse(data.contacts_json||'[]')); } catch(_) { setContacts([]); }
      }catch{}
    })();
  }, []);
  async function save(){
    const payload = { ...form, contacts_json: JSON.stringify(contacts||[]) };
    const r = await fetch(`${API_URL}/company`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const res = await r.json();
    if(!r.ok){ alert(res.error||'Save failed'); return; }
    alert('Company settings saved');
    onSaved && onSaved(res);
  }
  return (
    React.createElement('div', { className:'bg-white rounded-xl shadow-md p-6 border border-gray-200 space-y-4' },
      React.createElement('h3', { className:'text-lg font-bold text-gray-800' }, 'Company Settings'),
      React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-2 gap-3' },
        React.createElement('input', { className:'border rounded px-3 py-2', placeholder:'Company Name', value:form.name, onChange:e=>setForm({...form,name:e.target.value}) }),
        React.createElement('input', { className:'border rounded px-3 py-2', placeholder:'Phone', value:form.phone, onChange:e=>setForm({...form,phone:e.target.value}) }),
        React.createElement('input', { className:'border rounded px-3 py-2', placeholder:'Website', value:form.website, onChange:e=>setForm({...form,website:e.target.value}) }),
        React.createElement('input', { className:'border rounded px-3 py-2', placeholder:'GSTIN', value:form.gstin, onChange:e=>setForm({...form,gstin:e.target.value}) }),
        React.createElement('input', { className:'border rounded px-3 py-2', placeholder:'CIN', value:form.cin, onChange:e=>setForm({...form,cin:e.target.value}) }),
        React.createElement('input', { className:'border rounded px-3 py-2', placeholder:'ISO', value:form.iso, onChange:e=>setForm({...form,iso:e.target.value}) }),
        React.createElement('input', { className:'border rounded px-3 py-2 md:col-span-2', placeholder:'Logo URL (relative or absolute)', value:form.logo_url, onChange:e=>setForm({...form,logo_url:e.target.value}) }),
        React.createElement('textarea', { className:'border rounded px-3 py-2 md:col-span-2', rows:2, placeholder:'Registered Address', value:form.registered_address, onChange:e=>setForm({...form,registered_address:e.target.value}) }),
        React.createElement('textarea', { className:'border rounded px-3 py-2 md:col-span-2', rows:2, placeholder:'Factory Address', value:form.factory_address, onChange:e=>setForm({...form,factory_address:e.target.value}) })
      ),
      React.createElement('div', { className:'space-y-2' },
        React.createElement('div', { className:'font-semibold text-gray-800' }, 'Contacts for Letterhead'),
        React.createElement('div', { className:'text-xs text-gray-600' }, 'Name, Title, Email, Phone'),
        React.createElement('div', { className:'space-y-2' },
          (contacts||[]).map((c, i) => (
            React.createElement('div', { key:i, className:'grid grid-cols-1 md:grid-cols-4 gap-2' },
              React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Name', value:c.name||'', onChange:e=>{ const a=[...contacts]; a[i]={...a[i], name:e.target.value}; setContacts(a); } }),
              React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Title', value:c.title||'', onChange:e=>{ const a=[...contacts]; a[i]={...a[i], title:e.target.value}; setContacts(a); } }),
              React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Email', value:c.email||'', onChange:e=>{ const a=[...contacts]; a[i]={...a[i], email:e.target.value}; setContacts(a); } }),
              React.createElement('div', { className:'flex gap-2' },
                React.createElement('input', { className:'border rounded px-2 py-1 flex-1', placeholder:'Phone', value:c.phone||'', onChange:e=>{ const a=[...contacts]; a[i]={...a[i], phone:e.target.value}; setContacts(a); } }),
                React.createElement('button', { className:'px-2 py-1 border rounded text-sm', onClick:()=>{ const a=[...contacts]; a.splice(i,1); setContacts(a); } }, 'Remove')
              )
            )
          )),
          React.createElement('button', { className:'px-2 py-1 bg-gray-100 border rounded', onClick:()=> setContacts([...(contacts||[]), { name:'', title:'', email:'', phone:'' }]) }, 'Add Contact')
        )
      ),
      React.createElement('div', { className:'flex gap-2' },
        React.createElement('button', { className:'px-3 py-2 bg-blue-600 text-white rounded', onClick:save }, 'Save')
      )
      ,
      // BOM editor removed from Settings per request
    )
  );
}

// Simple BOM editor under Settings
function BOMEditor({ products, rawMaterials }){
  const [selected, setSelected] = useState(products?.[0]?.id || '');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ material:'', qty_per_unit:0 });
  useEffect(()=>{ (async()=>{ if(!selected) return; try{ const r=await fetch(`${API_URL}/bom/${encodeURIComponent(selected)}`); setRows(await r.json()); } catch{ setRows([]); } })(); }, [selected]);
  async function add(){ if(!selected || !form.material || !(form.qty_per_unit>0)) return; const body={ product_id:selected, material:form.material, qty_per_unit:Number(form.qty_per_unit) }; const r=await fetch(`${API_URL}/bom`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}); const res=await r.json(); if(!r.ok){ alert(res.error||'Save failed'); return; } setForm({ material:'', qty_per_unit:0 }); const rr=await fetch(`${API_URL}/bom/${encodeURIComponent(selected)}`); setRows(await rr.json()); }
  async function del(material){ if(!confirm('Delete from BOM?')) return; const r=await fetch(`${API_URL}/bom/${encodeURIComponent(selected)}/${encodeURIComponent(material)}`, { method:'DELETE' }); const res=await r.json(); if(!r.ok){ alert(res.error||'Delete failed'); return; } const rr=await fetch(`${API_URL}/bom/${encodeURIComponent(selected)}`); setRows(await rr.json()); }
  return React.createElement('div', { className:'bg-white rounded-xl shadow-md p-6 border border-gray-200 space-y-3' },
    React.createElement('h3', { className:'text-lg font-bold text-gray-800' }, 'Bill of Materials (Consumption)'),
    React.createElement('div', { className:'flex items-center gap-3' },
      React.createElement('label', { className:'text-sm font-semibold' }, 'Product'),
      React.createElement('select', { className:'border rounded px-2 py-1', value:selected, onChange:e=>setSelected(e.target.value) },
        (products||[]).map(p=> React.createElement('option', { key:p.id, value:p.id }, `${p.id} - ${p.description}`))
      )
    ),
    React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-4 gap-2' },
      React.createElement('select', { className:'border rounded px-2 py-1', value:form.material, onChange:e=>setForm({...form, material:e.target.value}) },
        [React.createElement('option',{key:'',value:''},'-- Select Material --')].concat((rawMaterials||[]).map(m=> React.createElement('option', { key:m.material, value:m.material }, m.material)))
      ),
      React.createElement('input', { className:'border rounded px-2 py-1', type:'number', step:'0.001', placeholder:'Qty per Unit (kg)', value:form.qty_per_unit, onChange:e=>setForm({...form, qty_per_unit:e.target.value}) }),
      React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:add }, 'Add/Update')
    ),
    React.createElement('div', { className:'overflow-x-auto' },
      React.createElement('table', { className:'min-w-full border-collapse' },
        React.createElement('thead', null,
          React.createElement('tr', { className:'bg-gray-100' }, ['Material','Qty per Unit (kg)','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
        ),
        React.createElement('tbody', null,
          (rows||[]).map(r => React.createElement('tr', { key:r.material, className:'border-b' },
            React.createElement('td', { className:'p-2 font-mono' }, r.material),
            React.createElement('td', { className:'p-2 text-right' }, r.qty_per_unit),
            React.createElement('td', { className:'p-2 text-right' },
              React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>del(r.material) }, 'Delete')
            )
          ))
        )
      )
    )
  );
}
// Job Work tab: create orders, add items, and receive cores
function JobWorkTab({ products, onRefresh }){
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ id:'', vendor_id:'', jw_date:'', due_date:'', status:'Open', notes:'' });
  const [openItems, setOpenItems] = useState({});
  const [itemsCache, setItemsCache] = useState({});
  const [newItem, setNewItem] = useState({ product_id:'', qty:0 });
  const [grn, setGrn] = useState({ open:false, order:null, items:[] });
  async function load(){
    try{
      const r = await fetch(`${API_URL}/jobwork/orders`);
      const data = await r.json().catch(()=>[]);
      setOrders(Array.isArray(data) ? data : []);
    } catch(_){ setOrders([]); }
  }
  useEffect(()=>{ load(); },[]);
  async function add(){ const r=await fetch(`${API_URL}/jobwork/orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) }); const res=await r.json(); if(!r.ok){ alert(res.error||'Failed'); return; } setForm({ id:'', vendor_id:'', jw_date:'', due_date:'', status:'Open', notes:'' }); load(); }
  async function save(o){ const r=await fetch(`${API_URL}/jobwork/orders/${encodeURIComponent(o.id)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(o) }); const res=await r.json(); if(!r.ok){ alert(res.error||'Failed'); return; } load(); }
  async function del(id){ if(!confirm('Delete Job Work Order?')) return; const r=await fetch(`${API_URL}/jobwork/orders/${encodeURIComponent(id)}`, { method:'DELETE' }); const res=await r.json(); if(!r.ok){ alert(res.error||'Failed'); return; } load(); }
  async function toggle(o){ const opened=!!openItems[o.id]; setOpenItems({ ...openItems, [o.id]: !opened }); if(!opened && !itemsCache[o.id]){ const r=await fetch(`${API_URL}/jobwork/orders/${encodeURIComponent(o.id)}/items`); setItemsCache({ ...itemsCache, [o.id]: await r.json() }); } }
  async function addItem(o){ const body={ product_id:newItem.product_id, qty:Number(newItem.qty||0) }; const r=await fetch(`${API_URL}/jobwork/orders/${encodeURIComponent(o.id)}/items`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); if(r.ok){ const rr=await fetch(`${API_URL}/jobwork/orders/${encodeURIComponent(o.id)}/items`); setItemsCache({ ...itemsCache, [o.id]: await rr.json() }); setNewItem({ product_id:'', qty:0 }); } }
  async function deleteItem(o, it){ const r=await fetch(`${API_URL}/jobwork/orders/${encodeURIComponent(o.id)}/items/${encodeURIComponent(it.id)}`, { method:'DELETE' }); if(r.ok){ const rr=await fetch(`${API_URL}/jobwork/orders/${encodeURIComponent(o.id)}/items`); setItemsCache({ ...itemsCache, [o.id]: await rr.json() }); } }
  function openGrn(o){ const rows=(itemsCache[o.id]||[]).map(it=>({ product_id:it.product_id, qty:0 })); setGrn({ open:true, order:o, items:rows }); }
  async function postGrn(){ const payload={ items:(grn.items||[]).filter(x=>Number(x.qty||0)>0) }; if(!payload.items.length){ alert('Enter at least one qty'); return; } const r=await fetch(`${API_URL}/jobwork/orders/${encodeURIComponent(grn.order.id)}/receive`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }); const res=await r.json(); if(!r.ok){ alert(res.error||'Failed'); return; } alert('Cores received'); setGrn({ open:false, order:null, items:[] }); onRefresh?.(); }
  return React.createElement('div', { className:'space-y-6' },
    React.createElement(Section, { title:'New Job Work Order' },
      React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-6 gap-3' },
        React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'JWO ID', value:form.id, onChange:e=>setForm({ ...form, id:e.target.value }) }),
        React.createElement('input', { className:'border rounded px-2 py-1', placeholder:'Jobber (Vendor ID)', value:form.vendor_id, onChange:e=>setForm({ ...form, vendor_id:e.target.value }) }),
        React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value:form.jw_date, onChange:e=>setForm({ ...form, jw_date:e.target.value }) }),
        React.createElement('input', { className:'border rounded px-2 py-1', type:'date', value:form.due_date, onChange:e=>setForm({ ...form, due_date:e.target.value }) }),
        React.createElement('select', { className:'border rounded px-2 py-1', value:form.status, onChange:e=>setForm({ ...form, status:e.target.value }) }, ['Open','In Process','Closed','Cancelled'].map(s=> React.createElement('option', { key:s, value:s }, s))),
        React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:add }, 'Create')
      )
    ),
    React.createElement(Section, { title:'Job Work Orders' },
      React.createElement('div', { className:'overflow-x-auto' },
        React.createElement('table', { className:'min-w-full border-collapse' },
          React.createElement('thead', null,
            React.createElement('tr', { className:'bg-gray-100' }, ['JWO ID','Jobber','JWO Date','Due Date','Status','Notes','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
          ),
          React.createElement('tbody', null,
            orders.map(o => React.createElement('tr', { key:o.id, className:'border-b' },
              React.createElement('td', { className:'p-2 font-mono' }, o.id),
              React.createElement('td', { className:'p-2' }, o.vendor_id||''),
              React.createElement('td', { className:'p-2' }, o.jw_date||''),
              React.createElement('td', { className:'p-2' }, o.due_date||''),
              React.createElement('td', { className:'p-2' }, o.status||''),
              React.createElement('td', { className:'p-2' }, React.createElement('input', { className:'border rounded px-2 py-1 w-full', defaultValue:o.notes||'', onChange:e=>o.notes=e.target.value })),
              React.createElement('td', { className:'p-2 text-right space-x-2' },
                React.createElement('button', { className:'px-2 py-1 bg-blue-600 text-white rounded text-sm', onClick:()=>save(o) }, 'Save'),
                React.createElement('button', { className:'px-2 py-1 border rounded text-sm', onClick:()=>toggle(o) }, openItems[o.id]?'Hide Items':'Items'),
                React.createElement('button', { className:'px-2 py-1 border rounded text-sm', onClick:()=>openGrn(o) }, 'Receive'),
                React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>del(o.id) }, 'Delete')
              )
            ))
          )
        )
      ),
      Object.keys(openItems).filter(id=>openItems[id]).map(id => React.createElement('div', { key:id, className:'mt-3 ml-2 border-l-4 border-blue-300 pl-4' },
        React.createElement('div', { className:'mb-2 font-semibold' }, 'Items for JWO ' + id),
        React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-4 gap-2 mb-2' },
          React.createElement('select', { className:'border rounded px-2 py-1', value:newItem.product_id, onChange:e=>setNewItem({ ...newItem, product_id:e.target.value }) },
            [React.createElement('option',{key:'',value:''},'-- Select Product --')].concat((products||[]).map(p=> React.createElement('option', { key:p.id, value:p.id }, `${p.id} - ${p.description}`)))
          ),
          React.createElement('input', { className:'border rounded px-2 py-1', type:'number', placeholder:'Qty', value:newItem.qty, onChange:e=>setNewItem({ ...newItem, qty:Number(e.target.value||0) }) }),
          React.createElement('button', { className:'px-3 py-1 bg-green-600 text-white rounded', onClick:()=>addItem({ id }) }, 'Add Item')
        ),
        React.createElement('div', { className:'overflow-x-auto' },
          React.createElement('table', { className:'min-w-full border-collapse' },
            React.createElement('thead', null,
              React.createElement('tr', { className:'bg-gray-100' }, ['Product','Qty','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2' }, h)))
            ),
            React.createElement('tbody', null,
              (itemsCache[id]||[]).map(it => React.createElement('tr', { key:it.id, className:'border-b' },
                React.createElement('td', { className:'p-2' }, it.product_id),
                React.createElement('td', { className:'p-2' }, it.qty),
                React.createElement('td', { className:'p-2 text-right' }, React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>deleteItem({ id }, it) }, 'Delete'))
              ))
            )
          )
        ))
      ),
      grn.open && React.createElement('div', { className:'fixed inset-0 bg-black/30 flex items-center justify-center z-50' },
        React.createElement('div', { className:'bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl space-y-3' },
          React.createElement('h4', { className:'text-lg font-bold' }, 'Receive Cores for ' + ((grn.order&&grn.order.id)||'')),
          React.createElement('div', { className:'overflow-x-auto' },
            React.createElement('table', { className:'min-w-full border-collapse' },
              React.createElement('thead', null,
                React.createElement('tr', { className:'bg-gray-100' }, ['Product','Qty to Receive'].map(h=> React.createElement('th', { key:h, className:'p-2 text-left' }, h)))
              ),
              React.createElement('tbody', null,
                (grn.items||[]).map((it, idx)=> React.createElement('tr', { key:idx, className:'border-b' },
                  React.createElement('td', { className:'p-2' }, it.product_id),
                  React.createElement('td', { className:'p-2' }, React.createElement('input', { type:'number', className:'border rounded px-2 py-1 w-32 text-right', value:it.qty, onChange:e=>{ const arr=[...grn.items]; arr[idx].qty=Number(e.target.value||0); setGrn({ ...grn, items: arr }); } }))
                ))
              )
            )
          ),
          React.createElement('div', { className:'flex justify-end gap-2' },
            React.createElement('button', { className:'px-3 py-2 border rounded', onClick:()=>setGrn({ open:false, order:null, items:[] }) }, 'Cancel'),
            React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:postGrn }, 'Post Receipt')
          )
        )
      )
    )
  );
}
// BOM tab (per-product editor with auto-generate)
function BOMTab({ products, rawMaterials, calculateWeights }){
  const [selected, setSelected] = useState(products?.[0]?.id || '');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ material:'', qty_per_unit:0 });
  useEffect(()=>{ (async()=>{ if(!selected) return; try{ const r=await fetch(`${API_URL}/bom/${encodeURIComponent(selected)}`); setRows(await r.json()); } catch{ setRows([]); } })(); }, [selected]);
  async function add(){ if(!selected || !form.material || !(form.qty_per_unit>0)) return; const body={ product_id:selected, material:form.material, qty_per_unit:Number(form.qty_per_unit) }; const r=await fetch(`${API_URL}/bom`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}); const res=await r.json(); if(!r.ok){ alert(res.error||'Save failed'); return; } setForm({ material:'', qty_per_unit:0 }); const rr=await fetch(`${API_URL}/bom/${encodeURIComponent(selected)}`); setRows(await rr.json()); }
  async function del(material){ if(!confirm('Delete from BOM?')) return; const r=await fetch(`${API_URL}/bom/${encodeURIComponent(selected)}/${encodeURIComponent(material)}`, { method:'DELETE' }); const res=await r.json(); if(!r.ok){ alert(res.error||'Delete failed'); return; } const rr=await fetch(`${API_URL}/bom/${encodeURIComponent(selected)}`); setRows(await rr.json()); }
  async function autoGen(){ const p=(products||[]).find(x=>x.id===selected); if(!p){ alert('Select a product'); return; } const w = (typeof calculateWeights === 'function') ? calculateWeights(p.diameter||p.steel_diameter||0, p.coating||p.copper_coating||0, p.length||0) : null; const plan=[{ material:'Steel', qty: Number(w?.steel||0) }, { material:'Copper', qty: Number(w?.copper||0) }]; for(const it of plan){ if(it.qty>0){ const body={ product_id:selected, material:it.material, qty_per_unit:it.qty }; const r=await fetch(`${API_URL}/bom`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); await r.json().catch(()=>({})); } } const rr=await fetch(`${API_URL}/bom/${encodeURIComponent(selected)}`); setRows(await rr.json()); }
  return React.createElement('div', { className:'space-y-4' },
    React.createElement(Section, { title:'Per-Product BOM' },
      React.createElement('div', { className:'flex items-center gap-3 mb-3' },
        React.createElement('label', { className:'text-sm font-semibold' }, 'Product'),
        React.createElement('select', { className:'border rounded px-2 py-1', value:selected, onChange:e=>setSelected(e.target.value) },
          (products||[]).map(p=> React.createElement('option', { key:p.id, value:p.id }, `${p.id} - ${p.description}`))
        ),
        React.createElement('button', { className:'ml-auto px-3 py-2 border rounded', onClick:autoGen }, 'Auto from Weights (Steel/Copper)')
      ),
      React.createElement('div', { className:'grid grid-cols-1 md:grid-cols-4 gap-2 mb-2' },
        React.createElement('div', { className:'flex items-center gap-2' },
          React.createElement('input', { className:'border rounded px-2 py-1', list:'materials-list', placeholder:'Material (e.g., Steel)', value:form.material, onChange:e=>setForm({ ...form, material:e.target.value }) }),
          React.createElement('datalist', { id:'materials-list' },
            (rawMaterials||[]).map(m=> React.createElement('option', { key:m.material, value:m.material }))
          )
        ),
        React.createElement('input', { className:'border rounded px-2 py-1', type:'number', step:'0.001', placeholder:'Qty per Unit (kg)', value:form.qty_per_unit, onChange:e=>setForm({ ...form, qty_per_unit:e.target.value }) }),
        React.createElement('button', { className:'px-3 py-2 bg-green-600 text-white rounded', onClick:()=>{
          if(!selected){ alert('Please select a product'); return; }
          if(!form.material){ alert('Please enter a material'); return; }
          if(!(Number(form.qty_per_unit)>0)){ alert('Enter a quantity greater than 0'); return; }
          add();
        } }, 'Add/Update')
      ),
      React.createElement('div', { className:'overflow-x-auto' },
        React.createElement('table', { className:'min-w-full border-collapse' },
          React.createElement('thead', null,
            React.createElement('tr', { className:'bg-gray-100' }, ['Material','Qty per Unit (kg)','Actions'].map(h=> React.createElement('th', { key:h, className:'p-2 text-left' }, h)))
          ),
          React.createElement('tbody', null,
            (rows||[]).map(r => React.createElement('tr', { key:r.material, className:'border-b' },
              React.createElement('td', { className:'p-2 font-mono' }, r.material),
              React.createElement('td', { className:'p-2 text-right' }, r.qty_per_unit),
              React.createElement('td', { className:'p-2 text-right' }, React.createElement('button', { className:'px-2 py-1 bg-red-600 text-white rounded text-sm', onClick:()=>del(r.material) }, 'Delete'))
            ))
          )
        )
      )
    )
  );
}
