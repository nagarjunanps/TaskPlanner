import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getCertificationTypes, getStaffCertifications, updateCertification } from '../api/client'
import type { CertStatus, StaffCertification } from '../api/types'
import { Award, AlertTriangle, XCircle, CheckCircle } from 'lucide-react'
import Pagination, { usePagination } from '../components/common/Pagination'

const STATUS_CONFIG: Record<CertStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  ACTIVE:        { label: 'Active',        cls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle  size={11} /> },
  EXPIRING_SOON: { label: 'Expiring Soon', cls: 'bg-amber-100  text-amber-700',   icon: <AlertTriangle size={11} /> },
  EXPIRED:       { label: 'Expired',       cls: 'bg-red-100    text-red-700',      icon: <XCircle      size={11} /> },
  SUSPENDED:     { label: 'Suspended',     cls: 'bg-slate-100  text-slate-500',    icon: <XCircle      size={11} /> },
}

export default function CertificationsPage() {
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterType,   setFilterType]   = useState<string>('')
  const [editing,      setEditing]      = useState<StaffCertification | null>(null)
  const [editForm,     setEditForm]     = useState({ expiry_date: '', status: '' })

  const { data: types = [] } = useQuery({ queryKey: ['cert-types'], queryFn: getCertificationTypes })
  const { data: certs = [], refetch } = useQuery({
    queryKey: ['certifications', filterStatus, filterType],
    queryFn: () => getStaffCertifications({
      status: filterStatus || undefined,
      expiring_within_days: filterStatus === 'EXPIRING_SOON' ? 60 : undefined,
    }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, string> }) => updateCertification(id, data),
    onSuccess: () => { refetch(); setEditing(null) },
  })

  const filtered = filterType
    ? certs.filter(c => c.cert_type?.code === filterType || String(c.cert_type_id) === filterType)
    : certs

  const pg = usePagination(filtered, 25)

  const openEdit = (c: StaffCertification) => {
    setEditing(c)
    setEditForm({ expiry_date: c.expiry_date, status: c.status })
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Award size={20} /> Certifications
        </h1>
        <span className="text-sm text-slate-500">{filtered.length} records</span>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select
          className="border rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="EXPIRING_SOON">Expiring Soon</option>
          <option value="EXPIRED">Expired</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
        <select
          className="border rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="">All types</option>
          {types.map(t => <option key={t.id} value={t.code}>{t.name}</option>)}
        </select>
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden sm:block bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Staff</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Certification</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Issued</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Expires</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Status</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pg.paged.map(c => {
                const cfg = STATUS_CONFIG[c.status]
                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-slate-700">
                      {c.staff_name ?? `Staff #${c.staff_id}`}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {c.cert_type?.name ?? `Type #${c.cert_type_id}`}
                    </td>
                    <td className="px-4 py-2.5 text-center text-slate-500 text-xs">{c.issued_date}</td>
                    <td className="px-4 py-2.5 text-center text-slate-500 text-xs">{c.expiry_date}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>
                        {cfg.icon}{cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => openEdit(c)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline font-medium"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-14 text-slate-400 text-sm">No certifications found.</div>
          )}
        </div>
        {filtered.length > 0 && (
          <div className="border-t px-4 py-2 bg-slate-50">
            <Pagination {...pg} onPage={pg.setPage} />
          </div>
        )}
      </div>

      {/* ── Mobile cards ── */}
      <div className="sm:hidden space-y-3">
        {pg.paged.map(c => {
          const cfg = STATUS_CONFIG[c.status]
          return (
            <div key={c.id} className="bg-white rounded-xl border shadow-sm p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-800 text-sm">
                    {c.staff_name ?? `Staff #${c.staff_id}`}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {c.cert_type?.name ?? `Type #${c.cert_type_id}`}
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${cfg.cls}`}>
                  {cfg.icon}{cfg.label}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2">
                <span>Issued: {c.issued_date} · Expires: {c.expiry_date}</span>
                <button onClick={() => openEdit(c)} className="text-indigo-600 font-medium hover:underline">
                  Edit
                </button>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center py-14 text-slate-400 text-sm">No certifications found.</div>
        )}
        {filtered.length > 0 && (
          <div className="bg-white rounded-xl border px-4 py-2">
            <Pagination {...pg} onPage={pg.setPage} />
          </div>
        )}
      </div>

      {/* ── Edit modal ── */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-800 mb-1">Edit Certification</h2>
            <p className="text-sm text-slate-500 mb-5">
              {editing.staff_name} — {editing.cert_type?.name}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Expiry Date</label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  value={editForm.expiry_date}
                  onChange={e => setEditForm(f => ({ ...f, expiry_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Status</label>
                <select
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  value={editForm.status}
                  onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="EXPIRING_SOON">Expiring Soon</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => updateMutation.mutate({ id: editing.id, data: editForm })}
                disabled={updateMutation.isPending}
                className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
