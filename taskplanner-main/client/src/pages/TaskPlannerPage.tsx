import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  getTeams, getStaff, getTurnarounds, updateTurnaround,
  startAllTeamsSolve, getTaskSolveStatus, stopTaskSolve,
  getTaskAssignments, updateTaskAssignment, validateTaskAssignments,
} from '../api/client'
import type { Staff, TaskAssignment, TaskRole, TaskSolverStatus, Turnaround } from '../api/types'
import {
  Plane, Play, Square, AlertCircle,
  CheckCircle2, XCircle, Loader2, Filter, ShieldCheck, ShieldAlert,
  Minus, X, Clock, Users2, PlaneTakeoff, PlaneLanding, MapPin, Timer, Package,
} from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────

const ROLE_ORDER: TaskRole[] = ['RLS', 'TOWER', 'DRIVER', 'LOADER']
const ROLE_COLORS: Record<TaskRole, string> = {
  RLS:    'bg-indigo-50 text-indigo-700 border-indigo-200',
  TOWER:  'bg-blue-50 text-blue-700 border-blue-200',
  DRIVER: 'bg-amber-50 text-amber-700 border-amber-200',
  LOADER: 'bg-slate-50 text-slate-600 border-slate-200',
}

function roleLabel(role: TaskRole, setNum: number, slotIdx: number): string {
  if (role === 'RLS' || role === 'TOWER') return role
  if (role === 'DRIVER') return `Driver S${setNum}`
  return `Loader S${setNum}.${slotIdx}`
}

function localDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PAGE_SIZE = 20

// ── types ─────────────────────────────────────────────────────────────────────

type TeamJob = Pick<TaskSolverStatus,
  'job_id' | 'team_id' | 'status' | 'best_score' | 'error' |
  'retry_count' | 'total_slots' | 'unassigned_count' | 'diagnostic' | 'time_spent_seconds' |
  'pooled_with_team_id'
>

function fmtSeconds(s: number | null | undefined): string {
  if (s == null) return '—'
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

// Ticks on its own — keeps the 1s clock update from re-rendering the whole
// page (and every turnaround card) while a solve is running.
function GenerationTimer({
  anyRunning, allDone, maxServerTime, startedAt,
}: {
  anyRunning: boolean
  allDone: boolean
  maxServerTime: number | null
  startedAt: number | null
}) {
  const [liveElapsed, setLiveElapsed] = useState(0)

  useEffect(() => {
    if (!anyRunning) return
    const tick = setInterval(() => {
      if (startedAt) setLiveElapsed((Date.now() - startedAt) / 1000)
    }, 1000)
    return () => clearInterval(tick)
  }, [anyRunning, startedAt])

  const value = allDone ? maxServerTime : (anyRunning ? liveElapsed : null)
  if (value == null) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-white text-xs text-slate-600 shadow-sm">
      {anyRunning
        ? <Loader2 size={13} className="animate-spin text-indigo-500" />
        : <Clock size={13} className="text-emerald-500" />}
      <span>Generation time:</span>
      <span className="font-semibold text-slate-800">{fmtSeconds(value)}</span>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function TaskPlannerPage() {
  const [date, setDate]             = useState(localDateStr)
  const [jobs, setJobs]             = useState<TeamJob[]>([])
  const [viewTeam, setViewTeam]     = useState<number | ''>('')
  const [page, setPage]             = useState(1)
  const [validateOpen, setValidateOpen]       = useState(true)
  const [validateMinimized, setValidateMinimized] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const solveStartRef = useRef<number | null>(null)

  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: getTeams })
  const nbTeams = teams.filter(t => t.sub_department_id)

  const { data: staff = [] } = useQuery({
    queryKey: ['team-staff', viewTeam],
    queryFn: () => getStaff(viewTeam ? { team_id: Number(viewTeam), active: true } : { active: true }),
    enabled: true,
  })

  // Turnarounds and assignments auto-load for the selected date so a
  // previously generated plan is shown immediately — it stays saved in the
  // DB until the solver is re-run for that date.
  const {
    data: turnarounds = [],
    isFetching: fetchingTurnarounds,
  } = useQuery({
    queryKey: ['turnarounds', date],
    queryFn: () => getTurnarounds(date),
  })

  const {
    data: assignments = [],
    refetch: refetchAssignments,
    isFetching: fetchingAssignments,
  } = useQuery({
    queryKey: ['task-assignments', date],
    queryFn: () => getTaskAssignments(date),
    enabled: turnarounds.length > 0,
  })

  const updateTurnaroundMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { cargo_weight_tons?: number | null; required_sets?: number } }) =>
      updateTurnaround(id, data),
  })
  // Stable callback identities so memoized TurnaroundCards don't re-render
  // on every unrelated state change (e.g. the 1s job-status poll tick).
  const handleUpdateTA = useCallback(
    (id: number, data: { cargo_weight_tons?: number | null; required_sets?: number }) =>
      updateTurnaroundMutation.mutate({ id, data }),
    [updateTurnaroundMutation],
  )

  const solveAllMutation = useMutation({
    mutationFn: () => startAllTeamsSolve(date),
    onSuccess: (data) => {
      setJobs(data.map(s => ({
        job_id: s.job_id, team_id: s.team_id, status: s.status, best_score: null, error: null,
        retry_count: 0, total_slots: 0, unassigned_count: 0, diagnostic: null, time_spent_seconds: null,
        pooled_with_team_id: s.pooled_with_team_id,
      })))
      solveStartRef.current = Date.now()
    },
  })

  const reassignMutation = useMutation({
    mutationFn: ({ id, staff_id }: { id: number; staff_id: number | null }) =>
      updateTaskAssignment(id, staff_id),
    onSuccess: () => refetchAssignments(),
  })
  const handleReassign = useCallback(
    (assignmentId: number, staffId: number | null) => reassignMutation.mutate({ id: assignmentId, staff_id: staffId }),
    [reassignMutation],
  )

  const validateMutation = useMutation({
    mutationFn: () => validateTaskAssignments(date),
  })

  // Poll all running jobs
  useEffect(() => {
    const solving = jobs.filter(j => j.status === 'SOLVING')
    if (solving.length === 0) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      if (jobs.some(j => j.status === 'SOLVING_COMPLETED')) refetchAssignments()
      return
    }
    if (pollRef.current) return  // already polling
    pollRef.current = setInterval(async () => {
      const updated = await Promise.all(
        jobs.map(async j => {
          if (j.status !== 'SOLVING') return j
          try {
            const s = await getTaskSolveStatus(j.job_id)
            return {
              ...j, status: s.status, best_score: s.best_score, error: s.error,
              retry_count: s.retry_count, total_slots: s.total_slots,
              unassigned_count: s.unassigned_count, diagnostic: s.diagnostic,
              time_spent_seconds: s.time_spent_seconds, pooled_with_team_id: s.pooled_with_team_id,
            }
          } catch { return j }
        })
      )
      setJobs(updated)
      if (updated.every(j => j.status !== 'SOLVING')) {
        clearInterval(pollRef.current!)
        pollRef.current = null
        refetchAssignments()
      }
    }, 1000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [jobs])

  // Cleanup on date change
  function changeDate(d: string) {
    setDate(d)
    setJobs([])
    setViewTeam('')
    setPage(1)
    validateMutation.reset()
    setValidateOpen(true)
    setValidateMinimized(false)
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    solveStartRef.current = null
  }

  function changeViewTeam(t: number | '') {
    setViewTeam(t)
    setPage(1)
  }

  async function handleStopAll() {
    await Promise.all(jobs.filter(j => j.status === 'SOLVING').map(j => stopTaskSolve(j.job_id)))
    setJobs(prev => prev.map(j => j.status === 'SOLVING' ? { ...j, status: 'SOLVING_STOPPED' } : j))
  }

  // group assignments by turnaround
  const assignmentsByTA: Record<number, TaskAssignment[]> = {}
  for (const a of assignments) {
    if (!assignmentsByTA[a.turnaround_id]) assignmentsByTA[a.turnaround_id] = []
    assignmentsByTA[a.turnaround_id].push(a)
  }

  const anyRunning = jobs.some(j => j.status === 'SOLVING')
  const allDone    = jobs.length > 0 && jobs.every(j => j.status !== 'SOLVING')
  const maxServerTime = jobs.length > 0
    ? Math.max(...jobs.map(j => j.time_spent_seconds ?? 0))
    : null

  // Filter turnarounds by viewing team if selected — each turnaround's
  // assignments carry the team_id that planned them, so filter directly
  // off that rather than re-fetching assignments per team.
  const visibleTurnarounds = viewTeam
    ? turnarounds.filter(ta => (assignmentsByTA[ta.id] ?? []).some(a => a.team_id === Number(viewTeam)))
    : turnarounds

  const totalPages = Math.max(1, Math.ceil(visibleTurnarounds.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedTurnarounds = visibleTurnarounds.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const totalUnassigned = jobs.reduce((sum, j) => sum + j.unassigned_count, 0)
  const totalSlots = jobs.reduce((sum, j) => sum + j.total_slots, 0)

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <PlaneTakeoff size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 leading-tight">Task Planner</h1>
            <p className="text-xs text-slate-400">Timefold AI ramp staff assignment</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {allDone && totalSlots > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-white text-xs text-slate-600 shadow-sm">
              <Users2 size={13} className="text-slate-400" />
              <span className="font-semibold text-slate-800">{totalSlots - totalUnassigned}/{totalSlots}</span>
              <span>slots filled</span>
            </div>
          )}
          <GenerationTimer anyRunning={anyRunning} allDone={allDone} maxServerTime={maxServerTime} startedAt={solveStartRef.current} />
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 flex-wrap items-center bg-white border rounded-xl p-3 shadow-sm">
        <input
          type="date"
          className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          value={date}
          onChange={e => changeDate(e.target.value)}
        />

        <button
          onClick={() => solveAllMutation.mutate()}
          disabled={anyRunning || solveAllMutation.isPending}
          className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-indigo-700 hover:to-blue-700 disabled:opacity-60 shadow-sm transition"
        >
          {solveAllMutation.isPending || anyRunning
            ? <Loader2 size={14} className="animate-spin" />
            : <Play size={14} />}
          Plan with Timefold AI
        </button>

        {anyRunning && (
          <button
            onClick={handleStopAll}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition"
          >
            <Square size={14} /> Stop All
          </button>
        )}

        {assignments.length > 0 && (
          <button
            onClick={() => { validateMutation.mutate(); setValidateOpen(true); setValidateMinimized(false) }}
            disabled={validateMutation.isPending || anyRunning}
            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-60 transition"
          >
            <ShieldCheck size={14} className={validateMutation.isPending ? 'animate-pulse' : ''} />
            {validateMutation.isPending ? 'Validating…' : 'Validate Assignments'}
          </button>
        )}

        {fetchingTurnarounds && (
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin" /> Loading flights…
          </span>
        )}
      </div>

      {/* Validation result — collapsible / dismissible */}
      {validateMutation.data && validateOpen && (
        validateMutation.data.conflicts.length === 0 ? (
          <div className="flex items-center justify-between gap-2 text-sm px-4 py-2 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-700">
            <span className="flex items-center gap-2">
              <ShieldCheck size={14} />
              No double-bookings or impossible travel gaps found across {validateMutation.data.checked_assignments} staffed assignments.
            </span>
            <button onClick={() => setValidateOpen(false)} className="p-1 rounded hover:bg-emerald-100" title="Dismiss">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="rounded-lg border bg-red-50 border-red-200 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-red-700 font-medium">
                <ShieldAlert size={14} />
                {validateMutation.data.conflicts.length} conflict{validateMutation.data.conflicts.length > 1 ? 's' : ''} found
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setValidateMinimized(m => !m)}
                  className="p-1 rounded hover:bg-red-100 text-red-600"
                  title={validateMinimized ? 'Expand' : 'Minimize'}
                >
                  <Minus size={14} />
                </button>
                <button onClick={() => setValidateOpen(false)} className="p-1 rounded hover:bg-red-100 text-red-600" title="Close">
                  <X size={14} />
                </button>
              </div>
            </div>
            {!validateMinimized && (
              <ul className="space-y-1 text-xs text-red-700">
                {validateMutation.data.conflicts.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded bg-red-100 border border-red-200 font-medium">
                      {c.conflict_type === 'double_booking' ? 'Overlap' : 'Travel gap'}
                    </span>
                    <span>{c.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}

      {/* Status banners */}
      {solveAllMutation.isError && (
        <div className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border bg-red-50 border-red-200 text-red-700">
          <AlertCircle size={14} />
          {(solveAllMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            ?? 'Failed to start solver — no flights found for this date.'}
        </div>
      )}

      {/* Per-team progress cards */}
      {jobs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Team Solve Progress</div>
          <div className="flex flex-wrap gap-3">
            {jobs.map(j => {
              const team = nbTeams.find(t => t.id === j.team_id)
              const teamCode = team?.code ?? `T${j.team_id}`
              const pooledTeam = j.pooled_with_team_id != null ? nbTeams.find(t => t.id === j.pooled_with_team_id) : null
              const label = pooledTeam ? `${teamCode}+${pooledTeam.code}` : teamCode
              return (
                <TeamStatusCard key={j.job_id} job={j} teamCode={label} pooled={j.pooled_with_team_id != null} />
              )
            })}
          </div>
        </div>
      )}

      {/* Loading assignment details — covers both the gap right after the
          solver finishes and any manual refetch (team filter, page change). */}
      {fetchingAssignments && (
        <div className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border bg-indigo-50 border-indigo-200 text-indigo-700">
          <Loader2 size={14} className="animate-spin" />
          {allDone ? 'Loading finalized assignments…' : 'Loading assignment details…'}
        </div>
      )}

      {/* Team filter (shown whenever a saved or freshly solved plan exists) */}
      {assignments.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <Filter size={14} className="text-slate-400" />
          <span className="text-slate-500 text-xs">View:</span>
          <button
            onClick={() => changeViewTeam('')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${viewTeam === '' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >All Teams</button>
          {nbTeams.map(t => (
            <button
              key={t.id}
              onClick={() => changeViewTeam(t.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${viewTeam === t.id ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >{t.code}</button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {turnarounds.length === 0 && !fetchingTurnarounds && jobs.length === 0 && (
        <div className="text-center py-16 text-slate-400 text-sm border-2 border-dashed rounded-xl bg-white">
          <PlaneTakeoff size={28} className="mx-auto mb-2 text-slate-300" />
          No flights loaded for this date yet.
          <br />
          <span className="text-xs mt-1 block">Pick a date and click <strong>Plan with Timefold AI</strong> — flights are fetched automatically.</span>
        </div>
      )}

      {/* Turnaround cards */}
      {turnarounds.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing {pagedTurnarounds.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}
              –{(currentPage - 1) * PAGE_SIZE + pagedTurnarounds.length} of {visibleTurnarounds.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-2.5 py-1 rounded border bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >Prev</button>
              <span>Page {currentPage} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-2.5 py-1 rounded border bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >Next</button>
            </div>
          </div>

          <div className="space-y-3">
            {pagedTurnarounds.map(ta => (
              <TurnaroundCard
                key={ta.id}
                turnaround={ta}
                assignments={assignmentsByTA[ta.id] ?? []}
                staff={staff}
                onUpdateTA={handleUpdateTA}
                onReassign={handleReassign}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Team status badge ─────────────────────────────────────────────────────────

const TeamStatusCard = memo(function TeamStatusCard({ job, teamCode, pooled }: { job: TeamJob; teamCode: string; pooled?: boolean }) {
  const solving   = job.status === 'SOLVING'
  const done      = job.status === 'SOLVING_COMPLETED'
  const stopped   = job.status === 'SOLVING_STOPPED'
  const errored   = job.status === 'ERROR'

  return (
    <div
      className={`flex flex-col gap-0.5 px-3 py-2 rounded-lg border text-xs font-medium max-w-xs ${
        solving  ? 'bg-indigo-50 border-indigo-200 text-indigo-700' :
        done     ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
        stopped  ? 'bg-amber-50 border-amber-200 text-amber-700' :
        errored  ? 'bg-red-50 border-red-200 text-red-700' :
                   'bg-slate-50 border-slate-200 text-slate-500'
      } ${pooled ? 'ring-1 ring-indigo-300' : ''}`}
      title={pooled ? 'Shared overlap window — staff pooled from both teams' : (job.diagnostic ?? undefined)}
    >
      <div className="flex items-center gap-2">
        {solving  && <Loader2 size={13} className="animate-spin" />}
        {done     && <CheckCircle2 size={13} />}
        {stopped  && <Square size={13} />}
        {errored  && <XCircle size={13} />}
        <span>{teamCode}</span>
        {pooled && <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-200 text-[10px]">pooled</span>}
        {solving && <span className="text-indigo-500">solving…</span>}
        {done    && <span>{job.best_score ?? 'done'}</span>}
        {stopped && <span>stopped</span>}
        {errored && <span className="truncate max-w-32" title={job.error ?? ''}>{job.error ?? 'error'}</span>}
        {done && job.retry_count > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 text-[10px]">
            retried ×{job.retry_count}
          </span>
        )}
      </div>
      {done && job.total_slots > 0 && (
        <>
          <div className="w-full h-1.5 rounded-full bg-emerald-100 overflow-hidden mt-0.5">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${Math.round(((job.total_slots - job.unassigned_count) / job.total_slots) * 100)}%` }}
            />
          </div>
          <span className="text-[10px] opacity-75">
            {job.unassigned_count}/{job.total_slots} unassigned · {fmtSeconds(job.time_spent_seconds)}
          </span>
        </>
      )}
      {done && job.diagnostic && (
        <span className="text-[10px] opacity-75 truncate">{job.diagnostic}</span>
      )}
    </div>
  )
})

// ── Turnaround card ───────────────────────────────────────────────────────────

const TurnaroundCard = memo(function TurnaroundCard({
  turnaround: ta,
  assignments,
  staff,
  onUpdateTA,
  onReassign,
}: {
  turnaround: Turnaround
  assignments: TaskAssignment[]
  staff: Staff[]
  onUpdateTA: (id: number, d: { cargo_weight_tons?: number | null; required_sets?: number }) => void
  onReassign: (assignmentId: number, staffId: number | null) => void
}) {
  const arr = ta.arrival_flight
  const dep = ta.departure_flight
  const aircraftType = arr?.aircraft_type ?? dep?.aircraft_type ?? 'A320'
  const groundTime = ta.ground_time_minutes
  const groundUrgency = groundTime == null ? null
    : groundTime < 30 ? 'tight' : groundTime < 45 ? 'normal' : 'relaxed'

  const sorted = [...assignments].sort((a, b) => {
    const ri = ROLE_ORDER.indexOf(a.task_role) - ROLE_ORDER.indexOf(b.task_role)
    if (ri !== 0) return ri
    if (a.set_number !== b.set_number) return a.set_number - b.set_number
    return a.slot_index - b.slot_index
  })

  const unfilled = sorted.filter(a => !a.staff_id).length
  const borderColor = sorted.length === 0 ? 'border-slate-200'
    : unfilled === 0 ? 'border-l-4 border-l-emerald-400 border-y border-r border-slate-200'
    : unfilled <= sorted.length / 2 ? 'border-l-4 border-l-amber-400 border-y border-r border-slate-200'
    : 'border-l-4 border-l-red-400 border-y border-r border-slate-200'

  return (
    <div className={`bg-white rounded-xl p-4 space-y-3 shadow-sm hover:shadow-lg transition-all ${borderColor}`}>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="space-y-2 min-w-0">
          <div className="font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shrink-0 shadow-sm">
              <Plane size={15} className="text-white" />
            </div>
            <span className="text-base">{ta.aircraft_registration ?? 'Unknown Reg'}</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{aircraftType}</span>
            {sorted.length > 0 && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                unfilled === 0 ? 'bg-emerald-100 text-emerald-700' :
                unfilled <= sorted.length / 2 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
              }`}>
                {sorted.length - unfilled}/{sorted.length} filled
              </span>
            )}
          </div>

          {/* Flight-detail chips — neutral, with colour reserved for status (ground-time urgency) */}
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            {arr && (
              <span className="flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-700 font-medium">
                <PlaneLanding size={12} className="text-blue-600" /> {arr.flight_number} <span className="text-slate-400">{arr.scheduled_time}</span>
              </span>
            )}
            {arr && dep && <span className="text-slate-300">→</span>}
            {dep && (
              <span className="flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-700 font-medium">
                <PlaneTakeoff size={12} className="text-indigo-600" /> {dep.flight_number} <span className="text-slate-400">{dep.scheduled_time}</span>
              </span>
            )}
            {groundTime != null && (
              <span className={`flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-md border font-medium ${
                groundUrgency === 'tight' ? 'bg-red-50 border-red-200 text-red-700' :
                groundUrgency === 'normal' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}>
                <Timer size={12} /> {groundTime}min ground
              </span>
            )}
            {dep?.bay && (
              <span className="flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-600 font-medium">
                <MapPin size={12} className="text-slate-400" /> Bay {dep.bay}
              </span>
            )}
            {ta.cargo_weight_tons != null && (
              <span className="flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-600 font-medium">
                <Package size={12} className="text-slate-400" /> {ta.cargo_weight_tons}t
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 text-slate-600">
            Cargo (t):
            <input
              type="number" step="0.1" min="0"
              className="border rounded px-2 py-0.5 w-20 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-200"
              defaultValue={ta.cargo_weight_tons ?? ''}
              onBlur={e => onUpdateTA(ta.id, { cargo_weight_tons: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <label className="flex items-center gap-1 text-slate-600">
            Sets:
            <input
              type="number" min="1" max="3"
              className="border rounded px-2 py-0.5 w-12 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-200"
              defaultValue={ta.required_sets}
              onBlur={e => onUpdateTA(ta.id, { required_sets: Number(e.target.value) })}
            />
          </label>
        </div>
      </div>

      {sorted.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {sorted.map(a => (
            <div
              key={a.id}
              className={`border rounded-lg px-3 py-2 text-xs transition hover:scale-[1.02] ${ROLE_COLORS[a.task_role]} ${!a.staff_id ? 'ring-2 ring-red-300 animate-pulse' : ''}`}
            >
              <div className="font-semibold mb-1 flex items-center justify-between">
                {roleLabel(a.task_role, a.set_number, a.slot_index)}
                {!a.staff_id && <AlertCircle size={12} className="text-red-500" />}
              </div>
              <select
                className="w-full bg-white/90 border rounded px-1 py-0.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                value={a.staff_id ?? ''}
                onChange={e => onReassign(a.id, e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Unassigned</option>
                {staff.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                ))}
              </select>
              {a.source === 'MANUAL' && (
                <span className="text-[10px] text-amber-700 font-medium mt-0.5 block">✎ manual</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-slate-400 italic">No assignments yet — run the solver.</div>
      )}
    </div>
  )
})
