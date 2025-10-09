// Clean app entry used to bypass syntax issues in app.js
const { useState, useEffect } = React;

const API_URL = window.location.origin + '/api';

function GroundRodERP() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [clientPurchaseOrders, setClientPurchaseOrders] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAllData(); }, []);

  async function fetchAllData() {
    setLoading(true);
    try {
      const [productsRes, customersRes, inventoryRes, purchaseOrdersRes, shipmentsRes, rawRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/products`),
        fetch(`${API_URL}/customers`),
        fetch(`${API_URL}/inventory`),
        fetch(`${API_URL}/purchase-orders`),
        fetch(`${API_URL}/shipments`),
        fetch(`${API_URL}/raw-materials`),
        fetch(`${API_URL}/dashboard/stats`)
      ]);

      setProducts(await productsRes.json());
      setCustomers(await customersRes.json());
      setInventory(await inventoryRes.json());
      setClientPurchaseOrders(await purchaseOrdersRes.json());
      setShipments(await shipmentsRes.json());
      setRawMaterials(await rawRes.json());
      setDashboardStats(await statsRes.json());
    } catch (err) {
      console.error('Data load error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-400 mx-auto"></div>
          <p className="mt-4 text-gray-700 text-lg font-semibold">Loading Ground Rod ERP...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <header className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Ground Rod ERP</h1>
              <p className="text-blue-100 text-sm">Copper Bonded Ground Rod Manufacturing & Export</p>
            </div>
            <button onClick={fetchAllData} className="px-4 py-2 bg-white text-blue-600 rounded-lg hover:bg-blue-50 font-semibold transition">Refresh</button>
          </div>
        </div>
      </header>

      <nav className="bg-white shadow-md border-b-2 border-gray-200">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1 overflow-x-auto">
            {[
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'inventory', label: 'Inventory' },
              { id: 'products', label: 'Products' },
              { id: 'customers', label: 'Customers' },
              { id: 'shipments', label: 'Shipments' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-3 font-semibold transition-all whitespace-nowrap rounded-t-lg ${activeTab === tab.id ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-blue-50'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === 'dashboard' && <Dashboard stats={dashboardStats} clientPurchaseOrders={clientPurchaseOrders} inventory={inventory} rawMaterials={rawMaterials} products={products} customers={customers} />}
        {activeTab === 'inventory' && <InventoryView inventory={inventory} products={products} />}        
        {activeTab === 'products' && <SimpleList title="Products" items={products.map(p => `${p.id} � ${p.description}`)} />}
        {activeTab === 'customers' && <SimpleList title="Customers" items={customers.map(c => `${c.id} � ${c.name}`)} />}
        {activeTab === 'shipments' && <SimpleList title="Shipments" items={shipments.map(s => `${s.id} � ${s.shipment_date}`)} />}
      </main>
    </div>
  );
}

function Dashboard({ stats, clientPurchaseOrders, inventory }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total WIP" value={(stats.total_wip || 0).toLocaleString()} color="blue" />
        <MetricCard title="Finished Goods" value={(stats.total_finished || 0).toLocaleString()} color="green" />
        <MetricCard title="Pending Orders" value={(stats.pending_orders || 0).toLocaleString()} color="orange" />
        <MetricCard title="Overdue Orders" value={stats.overdue_orders || 0} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <h3 className="text-lg font-bold mb-4 text-gray-800">Recent Client Orders</h3>
          <ul className="space-y-2">
            {clientPurchaseOrders.slice(0, 5).map(po => (
              <li key={po.id} className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex justify-between">
                  <span className="font-semibold">{po.id}</span>
                  <span className="text-sm text-gray-600">{po.due_date}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <h3 className="text-lg font-bold mb-4 text-gray-800">Top Inventory</h3>
          <ul className="space-y-2">
            {inventory.sort((a, b) => (b.packed - a.packed)).slice(0, 5).map(item => (
              <li key={item.product_id} className="flex justify-between items-center p-3 bg-green-50 rounded-lg border border-green-200">
                <span className="font-semibold text-sm">{item.product_description}</span>
                <span className="font-bold text-green-700">{item.packed} units</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function InventoryView({ inventory }) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
      <h3 className="text-lg font-bold mb-4 text-gray-800">Inventory</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="p-4 font-bold text-left">Product</th>
              <th className="p-4 font-bold text-center">Plated</th>
              <th className="p-4 font-bold text-center">Machined</th>
              <th className="p-4 font-bold text-center">QC</th>
              <th className="p-4 font-bold text-center">Stamped</th>
              <th className="p-4 font-bold text-center">Packed</th>
              <th className="p-4 font-bold text-center">Total</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((item, idx) => {
              const total = item.plated + item.machined + item.qc + item.stamped + item.packed;
              return (
                <tr key={item.product_id} className={`border-b-2 border-gray-200 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className="p-4 font-bold text-left">{item.product_description}</td>
                  <td className="p-4 font-semibold text-center">{item.plated}</td>
                  <td className="p-4 font-semibold text-center">{item.machined}</td>
                  <td className="p-4 font-semibold text-center">{item.qc}</td>
                  <td className="p-4 font-semibold text-center">{item.stamped}</td>
                  <td className="p-4 font-semibold text-center">{item.packed}</td>
                  <td className="p-4 font-bold text-center">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ title, value, color }) {
  const colors = {
    blue: 'from-blue-400 to-blue-600 border-blue-300',
    green: 'from-green-400 to-green-600 border-green-300',
    orange: 'from-orange-400 to-orange-600 border-orange-300',
    red: 'from-red-400 to-red-600 border-red-300'
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} rounded-xl shadow-lg p-6 border-2 text-white`}>
      <div className="text-sm font-bold opacity-90 mb-2">{title}</div>
      <div className="text-4xl font-bold">{value}</div>
    </div>
  );
}

function SimpleList({ title, items }) {
  return (
    <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
      <h3 className="text-lg font-bold mb-4 text-gray-800">{title}</h3>
      <ul className="space-y-2">
        {items.map((t, i) => (
          <li key={i} className="p-3 bg-gray-50 rounded-lg border border-gray-200">{t}</li>
        ))}
      </ul>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<GroundRodERP />);
