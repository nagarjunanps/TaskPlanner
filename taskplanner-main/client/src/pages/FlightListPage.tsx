import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getFlights, getTeams, updateFlight, checkFlightImpact, startTaskSolve, getTaskSolveStatus,
} from '../api/client'
import type { ConflictInfo, Flight, FlightImpact } from '../api/types'
import {
  Plane, Edit2, Save, X, AlertTriangle, CheckCircle,
  RefreshCw, Zap, Info, ArrowDown, ArrowUp, LayoutList, GanttChartSquare,
} from 'lucide-react'
import Pagination from '../components/common/Pagination'
import FlightTimeline from '../components/FlightTimeline'

const PAGE_SIZE = 25

const DIR_BADGE: Record<string, string> = {
  ARRIVAL:   'bg-sky-500/15 text-sky-300',
  DEPARTURE: 'bg-emerald-500/15 text-emerald-300',
}

const URGENCY_STYLE: Record<string, string> = {
  high:   'border-red-500/40 bg-red-500/10',
  medium: 'border-amber-500/40 bg-amber-500/10',
  low:    'border-green-500/40 bg-green-500/10',
}

const URGENCY_ICON: Record<string, React.ReactNode> = {
  high:   <AlertTriangle size={16} className="text-red-400" />,
  medium: <AlertTriangle size={16} className="text-amber-400" />,
  low:    <CheckCircle  size={16} className="text-green-400" />,
}

function nowHHMM() {
  const d = new Date()
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
}

// ── Edit modal ────────────────────────────────────────────────────────────────

interface EditModalProps {
  flight: Flight
  onClose: () => void
  onSaved: (updated: Flight) => void
}

function EditModal({ flight, onClose, onSaved }: EditModalProps) {
  const [estTime, setEstTime]  = useState(flight.estimated_time ?? flight.scheduled_time)
  const [bay,     setBay]      = useState(flight.bay ?? '')
  const [status,  setStatus]   = useState(flight.status)
  const [saving,  setSaving]   = useState(false)
  const [error,   setError]    = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateFlight(flight.id, {
        estimated_time: estTime || undefined,
        bay: bay || undefined,
        status,
      })
      onSaved(updated)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto my-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-100 flex items-center gap-2">
            <Edit2 size={16} /> Edit {flight.flight_number}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        <div className="text-xs text-slate-400">
          {flight.direction} · {flight.aircraft_registration ?? '—'} · Sched: {flight.scheduled_time}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-300">Estimated Time (HH:MM)</span>
            <input
              type="time"
              style={{ colorScheme: 'dark' }}
              className="mt-1 w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200"
              value={estTime ?? ''}
              onChange={e => setEstTime(e.target.value)}
            />
            <span className="text-xs text-slate-500">Scheduled: {flight.scheduled_time}</span>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-300">Bay</span>
            <input
              type="text"
              className="mt-1 w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200 uppercase"
              placeholder="e.g. J01"
              value={bay}
              onChange={e => setBay(e.target.value.toUpperCase())}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-300">Status</span>
            <select
              className="mt-1 w-full border border-slate-700 rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200"
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              {['SCHEDULED','ON_TIME','DELAYED','EARLY','LANDED','DEPARTED','CANCELLED'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 border border-slate-700 rounded-lg py-2 text-sm text-slate-300 hover:bg-slate-800"
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white rounded-lg py-2 text-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            Save &amp; Check Impact
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Impact panel ──────────────────────────────────────────────────────────────

interface ImpactPanelProps {
  impact: FlightImpact
  flightNumber: string
  onClose: () => void
  onReplan: (fromTime: string, teamId: number) => void
  teams: { id: number; code: string; name: string }[]
}

function ImpactPanel({ impact, flightNumber, onClose, onReplan, teams }: ImpactPanelProps) {
  const [teamId, setTeamId]       = useState<number | ''>(teams[0]?.id ?? '')
  const [replanTime, setReplanTime] = useState(nowHHMM())

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className={`bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border-2 max-h-[90vh] overflow-y-auto my-auto ${URGENCY_STYLE[impact.llm_urgency] ?? 'border-slate-700'}`}>
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-100 flex items-center gap-2">
              {URGENCY_ICON[impact.llm_urgency]}
              Flight Impact: {flightNumber}
            </h2>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
              <X size={18} />
            </button>
          </div>

          {/* Conflicts */}
          {impact.conflicts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-300 bg-green-500/10 rounded-lg p-3">
              <CheckCircle size={14} />
              No assignment conflicts detected.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                {impact.conflicts.length} Conflict{impact.conflicts.length > 1 ? 's' : ''} Found
              </div>
              <div className="divide-y divide-slate-800 border border-slate-700 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {impact.conflicts.map((c: ConflictInfo, i: number) => (
                  <div key={i} className="px-3 py-2 text-xs flex gap-2 items-start bg-slate-900">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                      c.conflict_type === 'double_booking'
                        ? 'bg-red-500/15 text-red-300'
                        : 'bg-amber-500/15 text-amber-300'
                    }`}>
                      {c.conflict_type === 'double_booking' ? 'DOUBLE BOOK' : 'TRAVEL GAP'}
                    </span>
                    <div>
                      <span className="font-medium text-slate-200">{c.staff_name}</span>
                      <span className="text-slate-400 ml-1">— {c.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LLM recommendation */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">
              <Info size={12} /> AI Recommendation
              <span className={`ml-auto px-2 py-0.5 rounded text-xs font-bold ${
                impact.llm_urgency === 'high'   ? 'bg-red-500/15 text-red-300' :
                impact.llm_urgency === 'medium' ? 'bg-amber-500/15 text-amber-300' :
                'bg-green-500/15 text-green-300'
              }`}>{impact.llm_urgency.toUpperCase()}</span>
            </div>
            <p className="text-sm text-slate-300">{impact.llm_reason}</p>
            <p className="text-xs text-slate-500">
              {impact.upcoming_count} upcoming turnaround{impact.upcoming_count !== 1 ? 's' : ''} can be replanned.
            </p>
          </div>

          {/* Replan controls */}
          {impact.should_replan && (
            <div className="space-y-3 border-t border-slate-700 pt-3">
              <div className="text-xs font-medium text-slate-300">Replan options</div>
              <div className="flex gap-3 flex-wrap">
                <label className="flex-1 min-w-32">
                  <span className="text-xs text-slate-400">Team</span>
                  <select
                    className="mt-1 w-full border border-slate-700 rounded-lg px-2 py-1.5 text-sm bg-slate-800 text-slate-200"
                    value={teamId}
                    onChange={e => setTeamId(Number(e.target.value))}
                  >
                    {teams.map(t => <option key={t.id} value={t.id}>{t.code}</option>)}
                  </select>
                </label>
                <label className="flex-1 min-w-28">
                  <span className="text-xs text-slate-400">Replan flights from</span>
                  <input
                    type="time"
                    style={{ colorScheme: 'dark' }}
                    className="mt-1 w-full border border-slate-700 rounded-lg px-2 py-1.5 text-sm bg-slate-800 text-slate-200"
                    value={replanTime}
                    onChange={e => setReplanTime(e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 border border-slate-700 rounded-lg py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Keep Current Plan
            </button>
            {impact.upcoming_count > 0 && teamId && (
              <button
                onClick={() => onReplan(replanTime, Number(teamId))}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 text-white rounded-lg py-2 text-sm hover:bg-emerald-700"
              >
                <Zap size={14} /> Replan Upcoming ({impact.upcoming_count})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FlightListPage() {
  const qc      = useQueryClient()
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const [date,      setDate]      = useState(today)
  const [view,      setView]      = useState<'timeline' | 'table'>('timeline')
  const [dirFilter, setDirFilter] = useState<'ALL'|'ARRIVAL'|'DEPARTURE'>('ALL')
  const [missingOnly, setMissingOnly] = useState(false)
  const [search,    setSearch]    = useState('')
  const [page,      setPage]      = useState(1)
  const [editFlight,   setEditFlight]   = useState<Flight | null>(null)
  const [impactData,   setImpactData]   = useState<{ impact: FlightImpact; flight: Flight } | null>(null)
  const [solveStatus,  setSolveStatus]  = useState<string | null>(null)
  const [,             setSolveJobId]   = useState<string | null>(null)
  const [checkingId,   setCheckingId]   = useState<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clear any in-flight replan poll on unmount so it doesn't keep calling
  // setState after the page is navigated away from.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const { data: flights = [], isFetching, isError, error, refetch } = useQuery({
    queryKey: ['flights', date],
    queryFn:  () => getFlights(date),
    staleTime: 0,
  })

  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })

  const filtered = useMemo(() => {
    let list = flights
    if (dirFilter !== 'ALL')
      list = list.filter(f => f.direction === dirFilter)
    if (missingOnly)
      list = list.filter(f => f.unfilled_slot_count > 0)
    if (search.trim())
      list = list.filter(f =>
        f.flight_number.toLowerCase().includes(search.toLowerCase()) ||
        (f.aircraft_registration ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (f.bay ?? '').toLowerCase().includes(search.toLowerCase())
      )
    return [...list].sort((a, b) => {
      const ta = a.estimated_time ?? a.scheduled_time
      const tb = b.estimated_time ?? b.scheduled_time
      return ta.localeCompare(tb)
    })
  }, [flights, dirFilter, missingOnly, search])

  const missingCount = useMemo(() => flights.filter(f => f.unfilled_slot_count > 0).length, [flights])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  async function handleSaved(updated: Flight) {
    setEditFlight(null)
    qc.invalidateQueries({ queryKey: ['flights', date] })

    // Immediately check impact
    setCheckingId(updated.id)
    try {
      const impact = await checkFlightImpact(updated.id, nowHHMM())
      setImpactData({ impact, flight: updated })
    } catch (e) {
      console.error('Impact check failed', e)
    } finally {
      setCheckingId(null)
    }
  }

  function handleReplan(fromTime: string, teamId: number) {
    if (pollRef.current) clearInterval(pollRef.current)
    setImpactData(null)
    setSolveStatus('SOLVING')
    startTaskSolve(teamId, date, fromTime).then(job => {
      setSolveJobId(job.job_id)
      pollRef.current = setInterval(async () => {
        try {
          const s = await getTaskSolveStatus(job.job_id)
          setSolveStatus(s.status)
          if (s.status !== 'SOLVING' && pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        } catch {
          if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        }
      }, 2000)
    }).catch(() => setSolveStatus('ERROR'))
  }

  return (
    <div className="p-6 space-y-4 bg-slate-950 min-h-screen">
      {/* Header — title + view tabs always anchored here, regardless of view */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Plane size={20} /> Flight Dashboard
        </h1>
        <div className="flex border border-slate-700 rounded-lg overflow-hidden text-sm">
          <button
            onClick={() => setView('timeline')}
            className={`flex items-center gap-1.5 px-3 py-1.5 ${view === 'timeline' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            <GanttChartSquare size={14} /> Timeline
          </button>
          <button
            onClick={() => setView('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 ${view === 'table' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
          >
            <LayoutList size={14} /> Table
          </button>
        </div>
      </div>

      {/* Toolbar — view-specific controls; date + refresh stay put, table adds filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          style={{ colorScheme: 'dark' }}
          className="border border-slate-700 rounded-lg px-3 py-1.5 text-sm bg-slate-800 text-slate-200"
          value={date}
          onChange={e => { setDate(e.target.value); setPage(1) }}
        />
        {view === 'table' && (
          <>
            {/* Direction filter */}
            <div className="flex border border-slate-700 rounded-lg overflow-hidden text-sm">
              {(['ALL','ARRIVAL','DEPARTURE'] as const).map(d => (
                <button
                  key={d}
                  onClick={() => { setDirFilter(d); setPage(1) }}
                  className={`px-3 py-1.5 ${dirFilter === d ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                >
                  {d === 'ALL' ? 'All' : d === 'ARRIVAL' ? '▼ ARR' : '▲ DEP'}
                </button>
              ))}
            </div>
            <input
              type="search"
              placeholder="Search flight / reg / bay…"
              className="border border-slate-700 rounded-lg px-3 py-1.5 text-sm bg-slate-800 text-slate-200 placeholder-slate-500 w-52"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
            />
            <button
              onClick={() => { setMissingOnly(v => !v); setPage(1) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border ${
                missingOnly
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'border-slate-700 text-slate-400 hover:bg-slate-800'
              }`}
              title="Show only flights whose turnaround still has unfilled task slots"
            >
              <AlertTriangle size={12} /> Missing slots {missingCount > 0 && `(${missingCount})`}
            </button>
            <span className="text-xs text-slate-500">{filtered.length} flights</span>
          </>
        )}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 px-3 py-1.5 border border-slate-700 rounded-lg text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Solve status banner */}
      {solveStatus && (
        <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg border ${
          solveStatus === 'SOLVING'            ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' :
          solveStatus === 'SOLVING_COMPLETED'  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
          'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>
          {solveStatus === 'SOLVING' && <RefreshCw size={14} className="animate-spin" />}
          {solveStatus === 'SOLVING'            && 'Replanning upcoming flights with Timefold AI…'}
          {solveStatus === 'SOLVING_COMPLETED'  && '✓ Replan complete — assignments updated in Task Planner.'}
          {solveStatus === 'SOLVING_STOPPED'    && 'Replan stopped.'}
          {solveStatus === 'ERROR'              && 'Replan failed — check server logs.'}
        </div>
      )}

      {/* Timeline */}
      {view === 'timeline' && <FlightTimeline date={date} teams={teams} />}

      {/* Table */}
      {view === 'table' && (
      <div className="space-y-3">
        {isFetching && (
          <div className="px-4 py-2 text-xs text-indigo-300 bg-indigo-500/10 border border-slate-700 rounded-lg flex items-center gap-2">
            <RefreshCw size={12} className="animate-spin" /> Loading flights…
          </div>
        )}
        {isError && (
          <div className="px-4 py-3 text-xs text-red-300 bg-red-500/10 border border-slate-700 rounded-lg flex items-center gap-3 flex-wrap">
            <AlertTriangle size={14} className="shrink-0" />
            <span>
              Failed to load flights — check that the server is running on port 8000.{' '}
              <span className="font-mono opacity-70">{(error as Error)?.message ?? 'Network error'}</span>
            </span>
            <button onClick={() => refetch()} className="ml-auto flex items-center gap-1 px-2 py-1 bg-red-500/15 hover:bg-red-500/25 rounded">
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        )}

        {/* ── Desktop table ── */}
        <div className="hidden sm:block bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 w-20">Dir</th>
                  <th className="text-left px-4 py-3">Flight</th>
                  <th className="text-left px-4 py-3">Aircraft</th>
                  <th className="text-left px-4 py-3">Scheduled</th>
                  <th className="text-left px-4 py-3">Estimated</th>
                  <th className="text-left px-4 py-3">Bay</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Slots</th>
                  <th className="text-left px-4 py-3 w-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-16 text-sm">
                      {isFetching
                        ? <span className="flex items-center justify-center gap-2 text-slate-500"><RefreshCw size={14} className="animate-spin" /> Loading flights…</span>
                        : isError
                          ? <span className="text-red-400">
                              Could not reach the server on port 8000.
                              <br /><span className="text-xs mt-1 block text-slate-500">Make sure the FastAPI backend is running: <code className="font-mono bg-slate-800 px-1 rounded">uvicorn main:app --port 8000 --reload</code></span>
                            </span>
                          : <span className="text-slate-500">
                              {missingOnly ? 'No flights with missing task slots for this date.' : 'No flights found for this date.'}
                            </span>
                      }
                    </td>
                  </tr>
                ) : paged.map(f => {
                  const delayed = f.estimated_time && f.estimated_time > f.scheduled_time
                  const early   = f.estimated_time && f.estimated_time < f.scheduled_time
                  const isChecking = checkingId === f.id
                  return (
                    <tr key={f.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${DIR_BADGE[f.direction] ?? ''}`}>
                          {f.direction === 'ARRIVAL' ? <ArrowDown size={10} /> : <ArrowUp size={10} />}
                          {f.direction === 'ARRIVAL' ? 'ARR' : 'DEP'}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-100">{f.flight_number}</td>
                      <td className="px-4 py-2 text-slate-400 font-mono text-xs">{f.aircraft_registration ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-slate-400">{f.scheduled_time}</td>
                      <td className="px-4 py-2 font-mono">
                        {f.estimated_time ? (
                          <span className={delayed ? 'text-red-400 font-semibold' : early ? 'text-green-400 font-semibold' : 'text-slate-400'}>
                            {f.estimated_time}
                            {delayed && ' ▲'}
                            {early   && ' ▼'}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {f.bay ? (
                          <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded font-mono text-xs">{f.bay}</span>
                        ) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          f.status === 'DELAYED'   ? 'bg-red-500/15 text-red-300' :
                          f.status === 'LANDED' || f.status === 'DEPARTED' ? 'bg-slate-800 text-slate-400' :
                          f.status === 'CANCELLED' ? 'bg-red-500/25 text-red-200' :
                          'bg-blue-500/15 text-blue-300'
                        }`}>{f.status}</span>
                      </td>
                      <td className="px-4 py-2">
                        {f.unfilled_slot_count > 0 ? (
                          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-medium">
                            <AlertTriangle size={10} /> {f.unfilled_slot_count} missing
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => setEditFlight(f)}
                          disabled={isChecking}
                          className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                        >
                          {isChecking
                            ? <RefreshCw size={12} className="animate-spin" />
                            : <Edit2 size={12} />
                          }
                          {isChecking ? 'Checking…' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Mobile cards ── */}
        <div className="sm:hidden space-y-2">
          {paged.length === 0 ? (
            <div className="text-center py-14 text-sm bg-slate-900 border border-slate-700 rounded-xl">
              {isFetching
                ? <span className="flex items-center justify-center gap-2 text-slate-500"><RefreshCw size={14} className="animate-spin" /> Loading flights…</span>
                : isError
                  ? <span className="text-red-400 px-4">
                      Could not reach the server on port 8000.
                      <br /><span className="text-xs mt-1 block text-slate-500">Make sure the FastAPI backend is running.</span>
                    </span>
                  : <span className="text-slate-500">
                      {missingOnly ? 'No flights with missing task slots for this date.' : 'No flights found for this date.'}
                    </span>
              }
            </div>
          ) : paged.map(f => {
            const delayed = f.estimated_time && f.estimated_time > f.scheduled_time
            const early   = f.estimated_time && f.estimated_time < f.scheduled_time
            const isChecking = checkingId === f.id
            return (
              <div key={f.id} className="bg-slate-900 border border-slate-700 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${DIR_BADGE[f.direction] ?? ''}`}>
                      {f.direction === 'ARRIVAL' ? <ArrowDown size={10} /> : <ArrowUp size={10} />}
                      {f.direction === 'ARRIVAL' ? 'ARR' : 'DEP'}
                    </span>
                    <span className="font-medium text-slate-100 text-sm">{f.flight_number}</span>
                    <span className="text-slate-500 font-mono text-xs">{f.aircraft_registration ?? '—'}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                    f.status === 'DELAYED'   ? 'bg-red-500/15 text-red-300' :
                    f.status === 'LANDED' || f.status === 'DEPARTED' ? 'bg-slate-800 text-slate-400' :
                    f.status === 'CANCELLED' ? 'bg-red-500/25 text-red-200' :
                    'bg-blue-500/15 text-blue-300'
                  }`}>{f.status}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400 border-t border-slate-800 pt-2">
                  <span className="font-mono">
                    Sched {f.scheduled_time}
                    {f.estimated_time && (
                      <span className={`ml-1.5 ${delayed ? 'text-red-400 font-semibold' : early ? 'text-green-400 font-semibold' : 'text-slate-400'}`}>
                        → {f.estimated_time}{delayed && ' ▲'}{early && ' ▼'}
                      </span>
                    )}
                  </span>
                  {f.bay && <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded font-mono text-xs">{f.bay}</span>}
                </div>
                <div className="flex items-center justify-between pt-1">
                  {f.unfilled_slot_count > 0 ? (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-medium">
                      <AlertTriangle size={10} /> {f.unfilled_slot_count} missing
                    </span>
                  ) : <span className="text-xs text-slate-600">No missing slots</span>}
                  <button
                    onClick={() => setEditFlight(f)}
                    disabled={isChecking}
                    className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                  >
                    {isChecking
                      ? <RefreshCw size={12} className="animate-spin" />
                      : <Edit2 size={12} />
                    }
                    {isChecking ? 'Checking…' : 'Edit'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="border border-slate-700 rounded-xl px-4 py-2 bg-slate-800/40">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={filtered.length}
              from={filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
              to={Math.min(page * PAGE_SIZE, filtered.length)}
              onPage={setPage}
              dark
            />
          </div>
        )}
      </div>
      )}

      {/* Edit modal */}
      {editFlight && (
        <EditModal
          flight={editFlight}
          onClose={() => setEditFlight(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Impact panel */}
      {impactData && (
        <ImpactPanel
          impact={impactData.impact}
          flightNumber={impactData.flight.flight_number}
          onClose={() => setImpactData(null)}
          onReplan={handleReplan}
          teams={teams}
        />
      )}
    </div>
  )
}
