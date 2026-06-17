import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getShifts, getStaff, getRosters, createRoster,
  startSolver, publishRoster, validateRoster,
  getRosterOverview, initializeAllTeams, generateRotation, setTeamDay,
} from '../api/client'
import type { Roster, Shift, SolverStatus, Staff, TeamMonthSummary, Violation } from '../api/types'
import EntryBadge from '../components/roster/EntryBadge'
import SolverProgress from '../components/roster/SolverProgress'
import ConstraintWarnings from '../components/roster/ConstraintWarnings'
import { Play, CheckCircle, RefreshCw, ChevronLeft, Wand2, AlertTriangle, Users } from 'lucide-react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const SHIFT_STYLES: Record<string, string> = {
  S1: 'bg-blue-100 text-blue-800 border-blue-300',
  S2: 'bg-green-100 text-green-800 border-green-300',
  S3: 'bg-amber-100 text-amber-800 border-amber-300',
  S4: 'bg-purple-100 text-purple-800 border-purple-300',
}

const SHIFT_TIMES: Record<string, string> = {
  S1: '05:00–15:00',
  S2: '11:00–23:00',
  S3: '14:30–00:30',
  S4: '23:00–11:00',
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

// ─────────────────────────────────────────────────────────────────────────────
// Root page — switches between Overview and per-team Detail
// ─────────────────────────────────────────────────────────────────────────────

export default function RosterPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [selectedTeamCode, setSelectedTeamCode] = useState<string>('')

  const handleSelectTeam = (id: number, code: string) => {
    setSelectedTeamId(id)
    setSelectedTeamCode(code)
  }

  if (selectedTeamId !== null) {
    return (
      <TeamDetailRoster
        teamId={selectedTeamId}
        teamCode={selectedTeamCode}
        year={year}
        month={month}
        onBack={() => setSelectedTeamId(null)}
      />
    )
  }

  return (
    <RosterOverview
      year={year}
      month={month}
      onYearChange={setYear}
      onMonthChange={setMonth}
      onSelectTeam={handleSelectTeam}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview — all teams grid
// ─────────────────────────────────────────────────────────────────────────────

function RosterOverview({
  year, month,
  onYearChange, onMonthChange,
  onSelectTeam,
}: {
  year: number
  month: number
  onYearChange: (y: number) => void
  onMonthChange: (m: number) => void
  onSelectTeam: (id: number, code: string) => void
}) {
  const qc = useQueryClient()
  const [editingCell, setEditingCell] = useState<{ teamId: number; rosterId: number; date: string } | null>(null)

  const { data: shifts = [] } = useQuery({ queryKey: ['shifts'], queryFn: getShifts })

  const { data: overview = [], isLoading } = useQuery({
    queryKey: ['roster-overview', year, month],
    queryFn: () => getRosterOverview(year, month),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['roster-overview', year, month] })

  const initMutation = useMutation({
    mutationFn: () => initializeAllTeams(year, month),
    onSuccess: invalidate,
  })

  const rotateMutation = useMutation({
    mutationFn: () => generateRotation(year, month),
    onSuccess: invalidate,
  })

  const confirmMutation = useMutation({
    mutationFn: async () => {
      for (const t of overview) {
        if (t.roster_id && t.status !== 'PUBLISHED') {
          await publishRoster(t.roster_id)
        }
      }
    },
    onSuccess: invalidate,
  })

  const teamDayMutation = useMutation({
    mutationFn: ({ rosterId, date, shiftId }: { rosterId: number; date: string; shiftId: number | null }) =>
      setTeamDay(rosterId, date, shiftId),
    onSuccess: () => { invalidate(); setEditingCell(null) },
  })

  const numDays = daysInMonth(year, month)
  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1)
  const dateStr = (d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  // Per-day coverage check: how many teams are working
  const coverageByDate: Record<string, number> = {}
  for (const day of dayNumbers) {
    const ds = dateStr(day)
    coverageByDate[ds] = overview.filter(t => t.days.find(d => d.date === ds)?.shift_code != null).length
  }

  const allConfirmed = overview.length > 0 && overview.every(t => t.status === 'PUBLISHED')
  const anyDraft = overview.some(t => t.roster_id && t.status !== 'PUBLISHED')
  const missingRosters = overview.some(t => !t.roster_id)

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-800">Shift Plan — All Teams</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="border rounded px-3 py-1.5 text-sm bg-white"
            value={month}
            onChange={e => onMonthChange(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input
            type="number"
            className="border rounded px-3 py-1.5 text-sm bg-white w-20"
            value={year}
            onChange={e => onYearChange(Number(e.target.value))}
          />
        </div>
      </div>

      {/* Action bar */}
      <div className="flex gap-2 flex-wrap">
        {missingRosters && (
          <button
            onClick={() => initMutation.mutate()}
            disabled={initMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 text-white rounded text-sm hover:bg-slate-800 disabled:opacity-60"
          >
            <Users size={14} />
            {initMutation.isPending ? 'Initialising…' : 'Initialise All Teams'}
          </button>
        )}
        {!allConfirmed && (
          <button
            onClick={() => rotateMutation.mutate()}
            disabled={rotateMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-60"
            title="Auto-generate a valid 12-day rotation satisfying all shift constraints"
          >
            <Wand2 size={14} />
            {rotateMutation.isPending ? 'Generating…' : 'Generate Rotation'}
          </button>
        )}
        {anyDraft && (
          <button
            onClick={() => confirmMutation.mutate()}
            disabled={confirmMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-60"
            title="Lock the shift plan — no further edits allowed after confirmation"
          >
            <CheckCircle size={14} />
            {confirmMutation.isPending ? 'Confirming…' : 'Confirm Plan'}
          </button>
        )}
        {allConfirmed && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium px-3 py-1.5">
            <CheckCircle size={14} /> Plan confirmed — locked
          </span>
        )}
      </div>

      {/* Constraint legend */}
      <div className="flex gap-4 text-xs text-slate-500 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" /> 4 teams working</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> Coverage gap</span>
        {Object.entries(SHIFT_TIMES).map(([code, time]) => (
          <span key={code} className={`px-1.5 py-0.5 rounded border text-xs font-medium ${SHIFT_STYLES[code]}`}>
            {code} {time}
          </span>
        ))}
      </div>

      {/* Overview grid */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 text-sm animate-pulse">Loading…</div>
      ) : overview.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">No teams found for Ramp NB.</div>
      ) : (
        <div className="overflow-x-auto border rounded-xl bg-white shadow-sm">
          <table className="text-xs border-collapse min-w-max">
            <thead>
              {/* Day-of-week + date row */}
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-20 bg-slate-50 border-b border-r px-4 py-2 text-left font-semibold text-slate-600 min-w-48">
                  Team
                </th>
                <th className="sticky left-48 z-20 bg-slate-50 border-b border-r px-2 py-2 text-center font-semibold text-slate-500 w-20">
                  Status
                </th>
                {dayNumbers.map(d => {
                  const ds = dateStr(d)
                  const dow = new Date(year, month - 1, d).getDay()
                  const isWeekend = dow === 0 || dow === 6
                  const working = coverageByDate[ds] ?? 0
                  const ok = working === 4
                  return (
                    <th
                      key={d}
                      className={`border-b border-r px-1 py-1.5 text-center w-12 ${isWeekend ? 'bg-slate-100' : ''}`}
                    >
                      <div className={`font-medium ${isWeekend ? 'text-slate-400' : 'text-slate-600'}`}>{d}</div>
                      <div className="text-slate-400 font-normal">{'SMTWTFS'[dow]}</div>
                      <div className="mt-0.5 flex justify-center">
                        {overview.length > 0 && overview[0].roster_id && (
                          <span
                            title={`${working} teams working`}
                            className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`}
                          />
                        )}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {overview.map(team => {
                const isConfirmed = team.status === 'PUBLISHED'
                const dayMap: Record<string, string | null> = {}
                for (const d of team.days) dayMap[d.date] = d.shift_code

                return (
                  <tr key={team.team_id} className="border-b hover:bg-slate-50 group">
                    {/* Team name — click to open detail */}
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-r px-4 py-2 font-medium text-slate-700 whitespace-nowrap">
                      <button
                        onClick={() => onSelectTeam(team.team_id, team.team_code)}
                        className="flex items-center gap-2 hover:text-indigo-700 transition-colors text-left"
                        title="View per-staff detail"
                      >
                        <span className="font-semibold text-slate-800">{team.team_code}</span>
                        <span className="text-slate-400 font-normal text-xs">{team.team_name.replace(/NB Ramp /, '')}</span>
                      </button>
                    </td>

                    {/* Status badge */}
                    <td className="sticky left-48 z-10 bg-white group-hover:bg-slate-50 border-r px-2 py-2 text-center">
                      {!team.roster_id ? (
                        <span className="text-xs text-slate-400 italic">No plan</span>
                      ) : (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          isConfirmed
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {isConfirmed ? 'Confirmed' : 'Draft'}
                        </span>
                      )}
                    </td>

                    {/* Shift cells */}
                    {dayNumbers.map(d => {
                      const ds = dateStr(d)
                      const shiftCode = dayMap[ds] ?? null
                      const isEditing = editingCell?.teamId === team.team_id && editingCell?.date === ds
                      const canEdit = !!team.roster_id && !isConfirmed

                      return (
                        <td
                          key={d}
                          className="border-r border-slate-100 px-0.5 py-1 text-center relative"
                        >
                          {canEdit ? (
                            isEditing ? (
                              /* Inline editor dropdown */
                              <div className="absolute z-50 top-0 left-0 bg-white border rounded-lg shadow-xl p-1 min-w-28">
                                <button
                                  className="w-full text-left px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 rounded"
                                  onClick={() => teamDayMutation.mutate({ rosterId: team.roster_id!, date: ds, shiftId: null })}
                                >
                                  OFF
                                </button>
                                {shifts.map(s => (
                                  <button
                                    key={s.id}
                                    className={`w-full text-left px-2 py-1 text-xs font-medium hover:opacity-80 rounded ${SHIFT_STYLES[s.code] ?? ''}`}
                                    onClick={() => teamDayMutation.mutate({ rosterId: team.roster_id!, date: ds, shiftId: s.id })}
                                  >
                                    {s.code} — {s.start_time}
                                  </button>
                                ))}
                                <button
                                  className="w-full text-left px-2 py-1 text-xs text-slate-400 hover:bg-slate-50 rounded mt-1"
                                  onClick={() => setEditingCell(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                className={`inline-block px-1.5 py-0.5 rounded border text-xs font-medium w-10 text-center hover:opacity-75 cursor-pointer ${
                                  shiftCode ? SHIFT_STYLES[shiftCode] : 'text-slate-300 border-dashed border-slate-200 bg-transparent'
                                }`}
                                onClick={() => setEditingCell({ teamId: team.team_id, rosterId: team.roster_id!, date: ds })}
                              >
                                {shiftCode ?? '—'}
                              </button>
                            )
                          ) : (
                            <span className={`inline-block px-1.5 py-0.5 rounded border text-xs font-medium w-10 text-center ${
                              shiftCode ? SHIFT_STYLES[shiftCode] : 'text-slate-200 border-transparent'
                            }`}>
                              {shiftCode ?? '—'}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Close editor on outside click */}
      {editingCell && (
        <div className="fixed inset-0 z-40" onClick={() => setEditingCell(null)} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Team detail — per-staff roster grid (existing behaviour, now as a sub-view)
// ─────────────────────────────────────────────────────────────────────────────

function TeamDetailRoster({
  teamId, teamCode, year, month, onBack,
}: {
  teamId: number
  teamCode: string
  year: number
  month: number
  onBack: () => void
}) {
  const qc = useQueryClient()
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [violations, setViolations] = useState<Violation[]>([])
  const [validating, setValidating] = useState(false)

  const { data: shifts = [] } = useQuery({ queryKey: ['shifts'], queryFn: getShifts })
  const shiftById: Record<number, Shift> = Object.fromEntries(shifts.map(s => [s.id, s]))

  const { data: staffList = [] } = useQuery({
    queryKey: ['staff', teamId],
    queryFn: () => getStaff({ team_id: teamId, active: true }),
  })

  const { data: rosters = [], refetch: refetchRosters } = useQuery({
    queryKey: ['rosters', teamId, year, month],
    queryFn: () => getRosters({ team_id: teamId, year, month }),
  })

  const roster: Roster | null = rosters[0] ?? null
  const numDays = daysInMonth(year, month)
  const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1)

  const entryMap: Record<number, Record<string, (typeof roster)['entries'][0]>> = {}
  if (roster) {
    for (const e of roster.entries) {
      if (!entryMap[e.staff_id]) entryMap[e.staff_id] = {}
      entryMap[e.staff_id][e.date] = e
    }
  }

  const createMutation = useMutation({
    mutationFn: () => createRoster({ team_id: teamId, year, month }),
    onSuccess: () => refetchRosters(),
  })

  const solveMutation = useMutation({
    mutationFn: () => startSolver(roster!.id),
    onSuccess: data => setActiveJobId(data.job_id),
  })

  const publishMutation = useMutation({
    mutationFn: () => publishRoster(roster!.id),
    onSuccess: () => { refetchRosters(); setViolations([]) },
  })

  const handleSolveComplete = useCallback(async (_s: SolverStatus) => {
    setActiveJobId(null)
    await refetchRosters()
    if (roster) {
      setValidating(true)
      try {
        const result = await validateRoster(roster.id)
        setViolations(result.violations)
      } finally { setValidating(false) }
    }
  }, [roster, refetchRosters])

  const handleValidate = async () => {
    if (!roster) return
    setValidating(true)
    try {
      const result = await validateRoster(roster.id)
      setViolations(result.violations)
    } finally { setValidating(false) }
  }

  const hardViolations = violations.filter(v => v.severity === 'HARD').length
  const staffByRole = {
    DM:  staffList.filter((s: Staff) => s.role === 'DM'),
    RLS: staffList.filter((s: Staff) => s.role === 'RLS'),
    RA:  staffList.filter((s: Staff) => s.role === 'RA'),
  }
  const dateStr = (day: number) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ChevronLeft size={16} /> All Teams
        </button>
        <span className="text-slate-300">/</span>
        <h1 className="text-xl font-bold text-slate-800">
          {teamCode} — Staff Roster · {MONTHS[month - 1]} {year}
        </h1>
      </div>

      {!roster && (
        <div className="text-center py-16 space-y-3">
          <p className="text-slate-500 text-sm">No roster for {MONTHS[month - 1]} {year}.</p>
          <p className="text-slate-400 text-xs">
            Go back and use "Initialise All Teams" + "Generate Rotation" to create shift plans for all teams at once.
          </p>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-60"
          >
            {createMutation.isPending ? 'Creating…' : 'Create Roster'}
          </button>
        </div>
      )}

      {roster && (
        <div className="flex gap-4">
          {/* ── Calendar ───────────────────────────────────────────────── */}
          <div className="flex-1 overflow-x-auto">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                roster.status === 'PUBLISHED' ? 'bg-emerald-100 text-emerald-700'
                : roster.status === 'SOLVING'  ? 'bg-blue-100 text-blue-700 animate-pulse'
                : 'bg-slate-100 text-slate-600'
              }`}>{roster.status === 'PUBLISHED' ? 'Confirmed' : roster.status}</span>

              {roster.status !== 'PUBLISHED' && !activeJobId && (
                <>
                  <button
                    onClick={() => solveMutation.mutate()}
                    disabled={solveMutation.isPending || roster.status === 'SOLVING'}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700 disabled:opacity-60"
                    title="Run Timefold AI solver for individual staff exceptions (OT, MC coverage)"
                  >
                    <Play size={12} /> Solve with Timefold AI
                  </button>
                  <button
                    onClick={handleValidate}
                    disabled={validating}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 text-white rounded text-xs hover:bg-slate-700 disabled:opacity-60"
                  >
                    <RefreshCw size={12} /> Validate
                  </button>
                  <button
                    onClick={() => publishMutation.mutate()}
                    disabled={publishMutation.isPending || hardViolations > 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 disabled:opacity-60"
                    title={hardViolations > 0 ? 'Fix hard violations before confirming' : ''}
                  >
                    <CheckCircle size={12} /> Confirm
                  </button>
                </>
              )}
            </div>

            <div className="overflow-x-auto border rounded-lg bg-white">
              <table className="text-xs border-collapse min-w-max">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="sticky left-0 bg-slate-50 border-b border-r px-3 py-2 text-left font-semibold text-slate-600 min-w-40">
                      Staff
                    </th>
                    <th className="sticky left-0 bg-slate-50 border-b border-r px-2 py-2 font-semibold text-slate-600 w-12">
                      Role
                    </th>
                    {dayNumbers.map(d => {
                      const dow = new Date(year, month - 1, d).getDay()
                      const isWeekend = dow === 0 || dow === 6
                      return (
                        <th key={d} className={`border-b px-1.5 py-2 font-medium w-14 text-center ${isWeekend ? 'bg-slate-100 text-slate-500' : 'text-slate-600'}`}>
                          <div>{d}</div>
                          <div className="text-slate-400 font-normal">{'SMTWTFS'[dow]}</div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(['DM','RLS','RA'] as const).map(role => (
                    <>
                      <tr key={`header-${role}`} className="bg-slate-50">
                        <td colSpan={numDays + 2} className="px-3 py-1 text-xs font-semibold text-slate-500 border-b">
                          {role === 'DM' ? 'Duty Manager' : role === 'RLS' ? 'Ramp Loading Supervisor' : 'Ramp Agent'}
                          {' '}({staffByRole[role].length})
                        </td>
                      </tr>
                      {staffByRole[role].map((s: Staff) => (
                        <tr key={s.id} className="hover:bg-slate-50 border-b">
                          <td className="sticky left-0 bg-white hover:bg-slate-50 border-r px-3 py-1 text-slate-700 whitespace-nowrap">
                            {s.name}
                          </td>
                          <td className="sticky left-0 bg-white hover:bg-slate-50 border-r px-2 py-1 text-center">
                            <span className="text-xs px-1 py-0.5 rounded bg-slate-100 text-slate-600">{s.role}</span>
                          </td>
                          {dayNumbers.map(d => {
                            const entry = entryMap[s.id]?.[dateStr(d)]
                            const shiftCode = entry?.shift_id ? shiftById[entry.shift_id]?.code : null
                            return (
                              <td key={d} className="px-1 py-1 text-center border-r border-slate-100">
                                {entry ? (
                                  <EntryBadge
                                    entryType={entry.entry_type}
                                    shiftCode={shiftCode}
                                    isRunner={entry.is_runner}
                                  />
                                ) : (
                                  <span className="text-slate-200">—</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-slate-600">
              {[
                { code: 'S1', label: 'Morning 05:00–15:00',   cls: 'bg-blue-100 text-blue-800 border-blue-300' },
                { code: 'S2', label: 'Mid-day 11:00–23:00',   cls: 'bg-green-100 text-green-800 border-green-300' },
                { code: 'S3', label: 'Afternoon 14:30–00:30', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
                { code: 'S4', label: 'Night 23:00–11:00',     cls: 'bg-purple-100 text-purple-800 border-purple-300' },
                { code: 'MC', label: 'Medical Leave',         cls: 'bg-red-100 text-red-700 border-red-300' },
                { code: 'EL', label: 'Earned Leave',          cls: 'bg-teal-100 text-teal-700 border-teal-300' },
              ].map(({ code, label, cls }) => (
                <span key={code} className="flex items-center gap-1.5">
                  <span className={`inline-block px-1.5 py-0.5 rounded border text-xs font-medium ${cls}`}>{code}</span>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* ── Right panel ──────────────────────────────────────────── */}
          <div className="w-72 space-y-3 shrink-0">
            {activeJobId && (
              <SolverProgress jobId={activeJobId} onComplete={handleSolveComplete} />
            )}
            <ConstraintWarnings violations={violations} isLoading={validating} />
          </div>
        </div>
      )}
    </div>
  )
}
