import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTeams, getStaff, createStaff, updateStaff, deactivateStaff } from '../api/client'
import type { Role, Staff } from '../api/types'
import { UserPlus, Pencil, UserX, Users } from 'lucide-react'
import OrgTeamSelector from '../components/common/OrgTeamSelector'
import Pagination, { usePagination } from '../components/common/Pagination'

const ROLE_COLORS: Record<Role, string> = {
  DM:  'bg-purple-100 text-purple-700',
  RLS: 'bg-blue-100 text-blue-700',
  RA:  'bg-slate-100 text-slate-600',
}

interface FormData { employee_id: string; name: string; role: Role; team_id: number }
const EMPTY: FormData = { employee_id: '', name: '', role: 'RA', team_id: 0 }

export default function StaffPage() {
  useQueryClient()
  const [filterTeam, setFilterTeam] = useState<number | ''>('')
  const [filterRole, setFilterRole] = useState<string>('')
  const [showModal,  setShowModal]  = useState(false)
  const [editing,    setEditing]    = useState<Staff | null>(null)
  const [form,       setForm]       = useState<FormData>(EMPTY)

  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: getTeams })
  const { data: staff = [], refetch } = useQuery({
    queryKey: ['staff', filterTeam, filterRole],
    queryFn: () => getStaff({
      team_id:  filterTeam || undefined,
      role:     filterRole || undefined,
      active:   true,
    }),
  })

  const createMutation = useMutation({
    mutationFn: (data: FormData) => createStaff(data),
    onSuccess: () => { refetch(); closeModal() },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Staff> }) => updateStaff(id, data),
    onSuccess: () => { refetch(); closeModal() },
  })
  const deactivateMutation = useMutation({
    mutationFn: (id: number) => deactivateStaff(id),
    onSuccess: () => refetch(),
  })

  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowModal(true) }
  const openEdit   = (s: Staff) => {
    setEditing(s)
    setForm({ employee_id: s.employee_id, name: s.name, role: s.role, team_id: s.team_id })
    setShowModal(true)
  }
  const closeModal = () => { setShowModal(false); setEditing(null) }

  const handleSubmit = () => {
    if (!form.name || !form.employee_id || !form.team_id) return
    if (editing) updateMutation.mutate({ id: editing.id, data: form })
    else         createMutation.mutate(form)
  }

  const teamById: Record<number, string> = Object.fromEntries(teams.map(t => [t.id, t.code]))

  // Pagination
  const pg = usePagination(staff, 25)

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Users size={20} /> Staff Management
        </h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <UserPlus size={15} /> Add Staff
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <OrgTeamSelector value={filterTeam || null} onChange={id => setFilterTeam(id ?? '')} placeholder="All teams" />
        <select
          className="border rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          value={filterRole}
          onChange={e => setFilterRole(e.target.value)}
        >
          <option value="">All roles</option>
          <option value="DM">DM</option>
          <option value="RLS">RLS</option>
          <option value="RA">RA</option>
        </select>
        <span className="text-sm text-slate-500 ml-1">
          {staff.length} staff
        </span>
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden sm:block bg-white rounded-xl border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Employee ID</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Name</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Role</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Team</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pg.paged.map(s => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{s.employee_id}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-700">{s.name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[s.role]}`}>
                      {s.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center text-slate-500 text-xs">
                    {teamById[s.team_id] ?? `Team ${s.team_id}`}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-3">
                      <button onClick={() => openEdit(s)} className="text-slate-400 hover:text-indigo-600 transition-colors" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => deactivateMutation.mutate(s.id)} className="text-slate-400 hover:text-red-600 transition-colors" title="Deactivate">
                        <UserX size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {staff.length === 0 && (
            <div className="text-center py-14 text-slate-400 text-sm">No staff found.</div>
          )}
        </div>

        {/* Pagination inside table card */}
        {staff.length > 0 && (
          <div className="border-t px-4 py-2 bg-slate-50">
            <Pagination {...pg} onPage={pg.setPage} />
          </div>
        )}
      </div>

      {/* ── Mobile cards ── */}
      <div className="sm:hidden space-y-3">
        {pg.paged.map(s => (
          <div key={s.id} className="bg-white rounded-xl border shadow-sm p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-slate-800 truncate">{s.name}</div>
                <div className="text-xs text-slate-400 font-mono mt-0.5">{s.employee_id}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[s.role]}`}>
                  {s.role}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100">
              <span className="text-xs text-slate-500">{teamById[s.team_id] ?? `Team ${s.team_id}`}</span>
              <div className="flex gap-3">
                <button onClick={() => openEdit(s)} className="text-slate-400 hover:text-indigo-600 transition-colors">
                  <Pencil size={15} />
                </button>
                <button onClick={() => deactivateMutation.mutate(s.id)} className="text-slate-400 hover:text-red-600 transition-colors">
                  <UserX size={15} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {staff.length === 0 && (
          <div className="text-center py-14 text-slate-400 text-sm">No staff found.</div>
        )}

        {staff.length > 0 && (
          <div className="bg-white rounded-xl border px-4 py-2">
            <Pagination {...pg} onPage={pg.setPage} />
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-800 mb-5">{editing ? 'Edit Staff' : 'Add Staff'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Employee ID</label>
                <input
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  value={form.employee_id}
                  onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
                  disabled={!!editing}
                  placeholder="e.g. T1-RA-001"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Full Name</label>
                <input
                  className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Full name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Role</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}
                  >
                    <option>DM</option><option>RLS</option><option>RA</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Team</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    value={form.team_id || ''}
                    onChange={e => setForm(f => ({ ...f, team_id: Number(e.target.value) }))}
                  >
                    <option value="">Select…</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.code}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                {editing ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
