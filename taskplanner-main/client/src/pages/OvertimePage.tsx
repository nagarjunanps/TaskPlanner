import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getStaff, getOTVolunteers, signupOT, approveOT, rejectOT } from '../api/client'
import type { OTVolunteer } from '../api/types'
import { Check, X, Clock, Users } from 'lucide-react'
import OrgTeamSelector from '../components/common/OrgTeamSelector'

const MAX_SLOTS = 6

const STATUS_COLORS = {
  PENDING:  'bg-amber-100 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-100 text-red-700 border-red-200',
}

export default function OvertimePage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date,          setDate]          = useState(today)
  const [teamId,        setTeamId]        = useState<number | null>(null)
  const [selectedStaff, setSelectedStaff] = useState<number | ''>('')
  const [approverId,    setApproverId]    = useState<number | ''>('')

  const { data: staff = [] } = useQuery({
    queryKey: ['staff', teamId],
    queryFn:  () => teamId ? getStaff({ team_id: teamId, active: true }) : Promise.resolve([]),
    enabled:  !!teamId,
  })
  const { data: volunteers = [], refetch } = useQuery({
    queryKey: ['ot-volunteers', date],
    queryFn:  () => getOTVolunteers(date),
  })

  const signupMutation = useMutation({
    mutationFn: () => signupOT(Number(selectedStaff), date),
    onSuccess:  () => { refetch(); setSelectedStaff('') },
  })
  const approveMutation = useMutation({
    mutationFn: ({ id }: { id: number }) => approveOT(id, Number(approverId)),
    onSuccess:  () => refetch(),
  })
  const rejectMutation = useMutation({
    mutationFn: (id: number) => rejectOT(id),
    onSuccess:  () => refetch(),
  })

  const activeSlots = volunteers.filter(v => v.status !== 'REJECTED').length
  const slotsLeft   = MAX_SLOTS - activeSlots
  const staffById: Record<number, string> = Object.fromEntries(staff.map(s => [s.id, s.name]))
  const dmStaff     = staff.filter(s => s.role === 'DM')

  return (
    <div className="p-4 sm:p-6 space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Clock size={20} /> Overtime Management
        </h1>
        <input
          type="date"
          className="border rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 self-start sm:self-auto"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
      </div>

      {/* Slot counter */}
      <div className="bg-white border rounded-xl p-4 flex flex-wrap items-center gap-3 shadow-sm">
        <div className="flex gap-1.5">
          {Array.from({ length: MAX_SLOTS }).map((_, i) => (
            <div
              key={i}
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                i < activeSlots
                  ? 'bg-indigo-500 border-indigo-500 text-white'
                  : 'border-slate-300 text-slate-300'
              }`}
            >
              {i + 1}
            </div>
          ))}
        </div>
        <div className="text-sm text-slate-600">
          <span className="font-bold text-slate-800">{activeSlots}/{MAX_SLOTS}</span> OT slots filled
          {slotsLeft > 0
            ? <span className="text-emerald-600 ml-2 text-xs font-medium">({slotsLeft} available)</span>
            : <span className="text-red-600 ml-2 text-xs font-medium">(Full)</span>
          }
        </div>
      </div>

      {/* Sign-up form */}
      <div className="bg-white border rounded-xl p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Users size={15} /> Sign Up for OT
        </h2>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <OrgTeamSelector value={teamId} onChange={setTeamId} />
          <select
            className="border rounded-lg px-3 py-2 text-sm bg-white flex-1 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
            value={selectedStaff}
            onChange={e => setSelectedStaff(e.target.value ? Number(e.target.value) : '')}
            disabled={!teamId}
          >
            <option value="">Select staff…</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
          </select>
          <button
            onClick={() => signupMutation.mutate()}
            disabled={!selectedStaff || slotsLeft === 0 || signupMutation.isPending}
            className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors font-medium"
          >
            Sign Up
          </button>
        </div>
        {signupMutation.isError && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
            {(signupMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error signing up'}
          </p>
        )}
      </div>

      {/* Volunteer list */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {/* Table header with DM selector */}
        <div className="px-4 py-3 border-b bg-slate-50 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <span className="text-sm font-semibold text-slate-700">Volunteer List — {date}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 whitespace-nowrap">Approving DM:</span>
            <select
              className="border rounded-lg px-2 py-1.5 text-xs bg-white flex-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={approverId}
              onChange={e => setApproverId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— select DM —</option>
              {dmStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {volunteers.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">No OT volunteers for {date}.</div>
        )}

        {/* Desktop table */}
        {volunteers.length > 0 && (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-600 w-10">#</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Staff</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-slate-600">Signed Up</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-slate-600">Status</th>
                    <th className="text-center px-4 py-2.5 font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {volunteers.map((v, i) => (
                    <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 text-slate-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-700">
                        {staffById[v.staff_id] ?? `Staff #${v.staff_id}`}
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-slate-500">
                        {new Date(v.signed_up_at).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[v.status]}`}>
                          {v.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <VolunteerActions v={v} approverId={approverId} onApprove={id => approveMutation.mutate({ id })} onReject={id => rejectMutation.mutate(id)} approving={approveMutation.isPending} rejecting={rejectMutation.isPending} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-slate-100">
              {volunteers.map((v, i) => (
                <div key={v.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs text-slate-400 mr-2">#{i + 1}</span>
                      <span className="font-medium text-slate-700 text-sm">
                        {staffById[v.staff_id] ?? `Staff #${v.staff_id}`}
                      </span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${STATUS_COLORS[v.status]}`}>
                      {v.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      {new Date(v.signed_up_at).toLocaleTimeString()}
                    </span>
                    <VolunteerActions v={v} approverId={approverId} onApprove={id => approveMutation.mutate({ id })} onReject={id => rejectMutation.mutate(id)} approving={approveMutation.isPending} rejecting={rejectMutation.isPending} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Rules note */}
      <div className="text-xs text-slate-400 bg-white border rounded-xl px-4 py-3 shadow-sm">
        <span className="font-semibold">Rules:</span> Max 6 OT slots per day (H7) · OT is voluntary only ·
        DM approval required (H8) · First-come-first-served (S6)
      </div>
    </div>
  )
}

// ── Volunteer action buttons (shared between table and mobile cards) ───────────

interface ActionProps {
  v:              OTVolunteer
  approverId:     number | ''
  onApprove:      (id: number) => void
  onReject:       (id: number) => void
  approving:      boolean
  rejecting:      boolean
}

function VolunteerActions({ v, approverId, onApprove, onReject, approving, rejecting }: ActionProps) {
  if (v.status !== 'PENDING') return <span className="text-slate-300 text-xs">—</span>

  return (
    <div className="flex gap-1.5">
      <button
        onClick={() => onApprove(v.id)}
        disabled={!approverId || approving}
        title={!approverId ? 'Select an approving DM first' : ''}
        className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-300
                   rounded-lg text-xs hover:bg-emerald-100 disabled:opacity-50 transition-colors"
      >
        <Check size={11} /> Approve
      </button>
      <button
        onClick={() => onReject(v.id)}
        disabled={rejecting}
        className="flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 border border-red-300
                   rounded-lg text-xs hover:bg-red-100 disabled:opacity-50 transition-colors"
      >
        <X size={11} /> Reject
      </button>
    </div>
  )
}
