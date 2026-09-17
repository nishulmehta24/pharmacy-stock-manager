import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const API = '/api'

// ── small reusable helpers ──────────────────────────────────────────────────

function Badge({ children, color = 'gray' }) {
  const colors = {
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-800',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[color]}`}>
      {children}
    </span>
  )
}

function Card({ title, children, action }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function Input({ label, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
      <input
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        {...props}
      />
    </div>
  )
}

function Btn({ children, variant = 'primary', ...props }) {
  const styles = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    danger: 'bg-red-500 hover:bg-red-600 text-white',
    ghost: 'bg-gray-100 hover:bg-gray-200 text-gray-700',
  }
  return (
    <button
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${styles[variant]} disabled:opacity-50`}
      {...props}
    >
      {children}
    </button>
  )
}

function Toast({ msg, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [onClose])
  const bg = type === 'error' ? 'bg-red-600' : 'bg-green-600'
  return (
    <div className={`fixed bottom-6 right-6 ${bg} text-white px-5 py-3 rounded-xl shadow-lg z-50 text-sm max-w-xs`}>
      {msg}
    </div>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [medicines, setMedicines] = useState([])
  const [alerts, setAlerts] = useState([])
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState(false)

  const notify = (msg, type = 'success') => setToast({ msg, type })

  const fetchAll = useCallback(async () => {
    try {
      const [medsRes, alertsRes] = await Promise.all([
        axios.get(`${API}/medicines`),
        axios.get(`${API}/alerts/expiring?days=30`),
      ])
      setMedicines(medsRes.data)
      setAlerts(alertsRes.data)
    } catch {
      notify('Failed to load data from server.', 'error')
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Add Medicine ──────────────────────────────────────────────────────────
  const [newMed, setNewMed] = useState({ name: '', description: '' })
  const addMedicine = async (e) => {
    e.preventDefault()
    try {
      setLoading(true)
      await axios.post(`${API}/medicines`, newMed)
      notify(`✅ Medicine "${newMed.name}" added!`)
      setNewMed({ name: '', description: '' })
      fetchAll()
    } catch (err) {
      notify(err.response?.data?.error || 'Error adding medicine.', 'error')
    } finally { setLoading(false) }
  }

  // ── Add Batch ─────────────────────────────────────────────────────────────
  const [newBatch, setNewBatch] = useState({ medicineId: '', quantity: '', expiryDate: '' })
  const addBatch = async (e) => {
    e.preventDefault()
    try {
      setLoading(true)
      await axios.post(`${API}/batches`, newBatch)
      notify('✅ Batch added successfully!')
      setNewBatch({ medicineId: '', quantity: '', expiryDate: '' })
      fetchAll()
    } catch (err) {
      notify(err.response?.data?.error || 'Error adding batch.', 'error')
    } finally { setLoading(false) }
  }

  // ── Dispense ──────────────────────────────────────────────────────────────
  const [dispense, setDispense] = useState({ medicineId: '', quantity: '' })
  const doDispense = async (e) => {
    e.preventDefault()
    try {
      setLoading(true)
      const res = await axios.post(`${API}/dispense`, dispense)
      notify(`💊 ${res.data.message}`)
      setDispense({ medicineId: '', quantity: '' })
      fetchAll()
    } catch (err) {
      notify(err.response?.data?.error || 'Error dispensing.', 'error')
    } finally { setLoading(false) }
  }

  // ── Search ────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const doSearch = async (e) => {
    e.preventDefault()
    if (!query.trim()) return
    try {
      const res = await axios.get(`${API}/medicines/search?q=${encodeURIComponent(query)}`)
      setSearchResults(res.data)
    } catch {
      notify('Search failed.', 'error')
    }
  }

  const tabs = ['dashboard', 'stock', 'dispense', 'search']

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <header className="bg-blue-700 text-white px-6 py-4 shadow-md">
        <h1 className="text-2xl font-bold tracking-tight">💊 Pharmacy Stock Manager</h1>
        <p className="text-blue-200 text-sm mt-0.5">First-Expiry-First-Out · Always in date</p>
      </header>

      {/* Nav */}
      <nav className="bg-white border-b border-gray-200 px-6 flex gap-1 sticky top-0 z-10">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium capitalize transition-colors border-b-2 ${
              tab === t
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6 grid gap-5">

        {/* ── DASHBOARD ── */}
        {tab === 'dashboard' && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-600 text-white rounded-2xl p-5">
                <p className="text-blue-200 text-sm">Total Medicines</p>
                <p className="text-4xl font-bold mt-1">{medicines.length}</p>
              </div>
              <div className="bg-green-600 text-white rounded-2xl p-5">
                <p className="text-green-100 text-sm">In-Date Items</p>
                <p className="text-4xl font-bold mt-1">
                  {medicines.filter(m => m.totalStock > 0).length}
                </p>
              </div>
              <div className="bg-amber-500 text-white rounded-2xl p-5">
                <p className="text-amber-100 text-sm">Expiring in 30d</p>
                <p className="text-4xl font-bold mt-1">{alerts.length}</p>
              </div>
            </div>

            {/* Alerts */}
            {alerts.length > 0 && (
              <Card title="⚠️ Expiring Soon (within 30 days)">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="pb-2">Medicine</th>
                      <th className="pb-2">Qty</th>
                      <th className="pb-2">Expires</th>
                      <th className="pb-2">Days Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map(b => {
                      const days = Math.ceil((new Date(b.expiryDate) - new Date()) / 86400000)
                      return (
                        <tr key={b.id} className="border-b last:border-0">
                          <td className="py-2 font-medium">{b.medicine.name}</td>
                          <td className="py-2">{b.quantity}</td>
                          <td className="py-2">{new Date(b.expiryDate).toLocaleDateString()}</td>
                          <td className="py-2">
                            <Badge color={days <= 7 ? 'red' : 'yellow'}>{days}d</Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Card>
            )}

            {/* All stock */}
            <Card title="📦 All Stock">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2">Medicine</th>
                    <th className="pb-2">In-Date Stock</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {medicines.map(m => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{m.name}</td>
                      <td className="py-2">{m.totalStock}</td>
                      <td className="py-2">
                        <Badge color={m.totalStock > 0 ? 'green' : 'red'}>
                          {m.totalStock > 0 ? 'In Stock' : 'Out of Stock'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {medicines.length === 0 && (
                    <tr><td colSpan={3} className="py-4 text-center text-gray-400">No medicines yet. Add one in the Stock tab.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          </>
        )}

        {/* ── STOCK ── */}
        {tab === 'stock' && (
          <div className="grid md:grid-cols-2 gap-5">
            <Card title="➕ Add New Medicine">
              <form onSubmit={addMedicine} className="flex flex-col gap-3">
                <Input label="Medicine Name *" placeholder="e.g. Paracetamol" value={newMed.name}
                  onChange={e => setNewMed({ ...newMed, name: e.target.value })} required />
                <Input label="Description (optional)" placeholder="e.g. 500mg tablets" value={newMed.description}
                  onChange={e => setNewMed({ ...newMed, description: e.target.value })} />
                <Btn type="submit" disabled={loading}>Add Medicine</Btn>
              </form>
            </Card>

            <Card title="📥 Add Batch to Existing Medicine">
              <form onSubmit={addBatch} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-gray-700">Medicine *</label>
                  <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={newBatch.medicineId} onChange={e => setNewBatch({ ...newBatch, medicineId: e.target.value })} required>
                    <option value="">Select medicine…</option>
                    {medicines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <Input label="Quantity *" type="number" min="1" placeholder="e.g. 100"
                  value={newBatch.quantity} onChange={e => setNewBatch({ ...newBatch, quantity: e.target.value })} required />
                <Input label="Expiry Date *" type="date" value={newBatch.expiryDate}
                  onChange={e => setNewBatch({ ...newBatch, expiryDate: e.target.value })} required />
                <Btn type="submit" disabled={loading}>Add Batch</Btn>
              </form>
            </Card>

            {/* Per-medicine batch detail */}
            <div className="md:col-span-2">
              <Card title="🗃️ Batch Details (In-Date Only)">
                {medicines.map(m => m.batches?.length > 0 && (
                  <div key={m.id} className="mb-4">
                    <p className="font-semibold text-gray-700 mb-1">{m.name}</p>
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-gray-400 border-b">
                        <th className="pb-1">Qty</th><th className="pb-1">Expires</th>
                      </tr></thead>
                      <tbody>
                        {m.batches.map(b => (
                          <tr key={b.id} className="border-b last:border-0">
                            <td className="py-1">{b.quantity}</td>
                            <td className="py-1">{new Date(b.expiryDate).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        )}

        {/* ── DISPENSE ── */}
        {tab === 'dispense' && (
          <Card title="💊 Dispense Medicine (FEFO)">
            <p className="text-sm text-gray-500 mb-4">
              Stock is always dispensed from the batch expiring <strong>soonest first</strong>. Expired batches are never used.
            </p>
            <form onSubmit={doDispense} className="flex flex-col gap-3 max-w-sm">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Medicine *</label>
                <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={dispense.medicineId} onChange={e => setDispense({ ...dispense, medicineId: e.target.value })} required>
                  <option value="">Select medicine…</option>
                  {medicines.filter(m => m.totalStock > 0).map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.totalStock} available)</option>
                  ))}
                </select>
              </div>
              <Input label="Quantity to Dispense *" type="number" min="1" placeholder="e.g. 10"
                value={dispense.quantity} onChange={e => setDispense({ ...dispense, quantity: e.target.value })} required />
              <Btn type="submit" disabled={loading}>Dispense</Btn>
            </form>
          </Card>
        )}

        {/* ── SEARCH ── */}
        {tab === 'search' && (
          <Card title="🔍 Search Medicine">
            <p className="text-sm text-gray-500 mb-4">Ask: "do we have paracetamol in date?"</p>
            <form onSubmit={doSearch} className="flex gap-2 mb-5">
              <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. paracetamol" value={query} onChange={e => setQuery(e.target.value)} />
              <Btn type="submit">Search</Btn>
            </form>
            {searchResults && (
              searchResults.length === 0
                ? <p className="text-gray-400 text-sm">No medicines found.</p>
                : <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500 border-b">
                      <th className="pb-2">Medicine</th><th className="pb-2">In Stock?</th><th className="pb-2">Qty</th>
                    </tr></thead>
                    <tbody>
                      {searchResults.map(m => (
                        <tr key={m.id} className="border-b last:border-0">
                          <td className="py-2 font-medium">{m.name}</td>
                          <td className="py-2"><Badge color={m.inDate ? 'green' : 'red'}>{m.inDate ? 'Yes ✓' : 'No ✗'}</Badge></td>
                          <td className="py-2">{m.totalStock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
            )}
          </Card>
        )}
      </main>

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
