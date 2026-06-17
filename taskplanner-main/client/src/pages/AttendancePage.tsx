import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getStaff, getAttendance, updateAttendance } from '../api/client'
import type { EntryType, RosterEntry } from '../api/types'
import EntryBadge from '../components/roster/EntryBadge'
import OrgTeamSelector from '../components/common/OrgTeamSelector'
import Pagination, { usePagination } from '../components/common/Pagination'
import { ClipboardCheck } from 'lucide-react'

function effectiveType(entry: RosterEntry): EntryType {
  return entry.actual_entry_type ?? entry.entry_type
}

export default function AttendancePage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date,   setDate]   = useState(today)
  const [teamId, setTeamId] = useState<number | null>(null)

  const { data: staff = [] } = useQuery({
    queryKey: ['staff', teamId],
    queryFn:  () => teamId ? getStaff({ team_id: teamId, active: true }) : Promise.resolve([]),
    enabled:  !!teamId,
  })
  const { data: attendance = [], refetch } = useQuery({
    queryKey: ['attendance', date, teamId],
    queryFn:  () => teamId ? getAttendance(date, teamId) : Promise.resolve([]),
    enabled:  !!teamId,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<RosterEntry> }) => updateAttendance(id, data),
    onSuccess:  () => refetch(),
  })

  const entryByStaff: Record<number, RosterEntry> = Object.fromEntries(
    attendance.map(e => [e.staff_id, e])
  )

  const summary = {
    on_duty: attendance.filter(e => effectiveType(e) === 'ON_DUTY').length,
    mc:      attendance.filter(e => effectiveType(e) === 'MC').length,
    el:      attendance.filter(e => effectiveType(e) === 'EL').length,
    runners: attendance.filter(e => e.is_runner && effectiveType(e) === 'ON_DUTY').length,
  }

  const pg = usePagination(staff, 30)

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <ClipboardCheck size={20} /> Daily Attendance
        </h1>
        <div className="flex flex-wrap gap-2">
          <input
            type="date"
            className="border rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
          <OrgTeamSelector value={teamId} onChange={setTeamId} />
        </div>
      </div>

      {/* Summary chips */}
      {teamId && attendance.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-medium text-xs">
            On Duty: {summary.on_duty}
          </span>
          <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full font-medium text-xs">
            MC: {summary.mc}
          </span>
          <span className="bg-teal-100 text-teal-700 px-3 py-1 rounded-full font-medium text-xs">
            EL: {summary.el}
          </span>
          <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full font-medium text-xs">
            Runners: {summary.runners}/2
          </span>
        </div>
      )}

      {!teamId && (
        <div className="text-center py-20 text-slate-400 text-sm bg-white rounded-xl border">
          Select a team to view attendance.
        </div>
      )}

      {/* ── Desktop table ── */}
      {teamId && staff.length > 0 && (
        <>
          <div className="hidden sm:block bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Staff</th>
                    <th className="text-center px-4 py-3 font-semibold text-slate-600">Role</th>
                    <th className="text-center px-4 py-3 font-semibold text-slate-600">Planned</th>
                    <th className="text-center px-4 py-3 font-semibold text-slate-600">Effective</th>
                    <th className="text-center px-4 py-3 font-semibold text-slate-600">Runner</th>
                    <th className="text-center px-4 py-3 font-semibold text-slate-600">Override</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pg.paged.map(s => {
                    const entry      = entryByStaff[s.id]
                    const eff        = entry ? effectiveType(entry) : null
                    const hasOverride = entry && entry.actual_entry_type !== null
                    return (
                      <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-slate-700">{s.name}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{s.role}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {entry
                            ? <EntryBadge entryType={entry.entry_type} isRunner={entry.is_runner} />
                            : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {entry && eff ? (
                            <span className={hasOverride ? 'ring-1 ring-orange-400 rounded' : ''}>
                              <EntryBadge entryType={eff} isRunner={entry.is_runner} />
                            </span>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {entry && s.role === 'RA' && eff === 'ON_DUTY' ? (
                            <button
                              onClick={() => updateMutation.mutate({ id: entry.id, data: { is_runner: !entry.is_runner } })}
                              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                                entry.is_runner
                                  ? 'bg-yellow-100 border-yellow-400 text-yellow-700'
                                  : 'bg-white border-slate-300 text-slate-500 hover:border-yellow-400'
                              }`}
                            >
                              {entry.is_runner ? 'Runner ✓' : 'Set Runner'}
                            </button>
                          ) : <span className="text-slate-200 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {entry ? (
                            <select
                              className="border rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              value={entry.actual_entry_type ?? ''}
                              onChange={e => updateMutation.mutate({
                                id: entry.id,
                                data: { actual_entry_type: (e.target.value || null) as EntryType | null },
                              })}
                            >
                              <option value="">— (as planned)</option>
                              {(['ON_DUTY', 'OFF', 'MC', 'EL', 'OT'] as EntryType[]).map(t => (
                                <option key={t} value={t}>{t.replace('_', ' ')}</option>
                              ))}
                            </select>
                          ) : <span className="text-slate-300 text-xs">No entry</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-2 bg-slate-50">
              <Pagination {...pg} onPage={pg.setPage} />
            </div>
          </div>

          {/* ── Mobile cards ── */}
          <div className="sm:hidden space-y-3">
            {pg.paged.map(s => {
              const entry       = entryByStaff[s.id]
              const eff         = entry ? effectiveType(entry) : null
              const hasOverride = entry && entry.actual_entry_type !== null
              return (
                <div key={s.id} className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-800 text-sm">{s.name}</div>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 mt-0.5 inline-block">
                        {s.role}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {entry && eff ? (
                        <span className={hasOverride ? 'ring-1 ring-orange-400 rounded' : ''}>
                          <EntryBadge entryType={eff} isRunner={entry.is_runner} />
                        </span>
                      ) : <span className="text-slate-300 text-xs">No entry</span>}
                    </div>
                  </div>

                  {/* Controls */}
                  {entry && (
                    <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-slate-100">
                      {s.role === 'RA' && eff === 'ON_DUTY' && (
                        <button
                          onClick={() => updateMutation.mutate({ id: entry.id, data: { is_runner: !entry.is_runner } })}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                            entry.is_runner
                              ? 'bg-yellow-100 border-yellow-400 text-yellow-700'
                              : 'bg-white border-slate-300 text-slate-500 hover:border-yellow-400'
                          }`}
                        >
                          {entry.is_runner ? 'Runner ✓' : 'Set Runner'}
                        </button>
                      )}
                      <select
                        className="border rounded-lg px-2 py-1 text-xs bg-white flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        value={entry.actual_entry_type ?? ''}
                        onChange={e => updateMutation.mutate({
                          id: entry.id,
                          data: { actual_entry_type: (e.target.value || null) as EntryType | null },
                        })}
                      >
                        <option value="">— as planned</option>
                        {(['ON_DUTY', 'OFF', 'MC', 'EL', 'OT'] as EntryType[]).map(t => (
                          <option key={t} value={t}>{t.replace('_', ' ')}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="bg-white rounded-xl border px-4 py-2">
              <Pagination {...pg} onPage={pg.setPage} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
