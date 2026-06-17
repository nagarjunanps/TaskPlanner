import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getFlights, getTeams, updateFlight, checkFlightImpact, startTaskSolve, getTaskSolveStatus,
} from '../api/client'
import type { ConflictInfo, Flight, FlightImpact } from '../api/types'
import {
  Plane, Edit2, Save, X, AlertTriangle, CheckCircle,
  RefreshCw, Zap, Info, ArrowDown, ArrowUp,
} from 'lucide-react'
import Pagination from '../components/common/Pagination'

const PAGE_SIZE = 25

const DIR_BADGE: Record<string, string> = {
  ARRIVAL:   'bg-sky-100 text-sky-700',
  DEPARTURE: 'bg-emerald-100 text-emerald-700',
}

const URGENCY_STYLE: Record<string, string> = {
  high:   'border-red-300 bg-red-50',
  medium: 'border-amber-300 bg-amber-50',
  low:    'border-green-300 bg-green-50',
}

const URGENCY_ICON: Record<string, React.ReactNode> = {
  high:   <AlertTriangle size={16} className="text-red-500" />,
  medium: <AlertTriangle size={16} className="text-amber-500" />,
  low:    <CheckCircle  size={16} className="text-green-500" />,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <Edit2 size={16} /> Edit {flight.flight_number}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="text-xs text-slate-500">
          {flight.direction} · {flight.aircraft_registration ?? '—'} · Sched: {flight.scheduled_time}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Estimated Time (HH:MM)</span>
            <input
              type="time"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
              value={estTime ?? ''}
              onChange={e => setEstTime(e.target.value)}
            />
            <span className="text-xs text-slate-400">Scheduled: {flight.scheduled_time}</span>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Bay</span>
            <input
              type="text"
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white uppercase"
              placeholder="e.g. J01"
              value={bay}
              onChange={e => setBay(e.target.value.toUpperCase())}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">Status</span>
            <select
              className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-white"
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              {['SCHEDULED','ON_TIME','DELAYED','EARLY','LANDED','DEPARTED','CANCELLED'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>

        {error && <div className="text-xs text-red-600">{error}</div>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 border rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-lg border-2 ${URGENCY_STYLE[impact.llm_urgency] ?? 'border-slate-200'}`}>
        <div className="p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              {URGENCY_ICON[impact.llm_urgency]}
              Flight Impact: {flightNumber}
            </h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>

          {/* Conflicts */}
          {impact.conflicts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg p-3">
              <CheckCircle size={14} />
              No assignment conflicts detected.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                {impact.conflicts.length} Conflict{impact.conflicts.length > 1 ? 's' : ''} Found
              </div>
              <div className="divide-y border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {impact.conflicts.map((c: ConflictInfo, i: number) => (
                  <div key={i} className="px-3 py-2 text-xs flex gap-2 items-start bg-white">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                      c.conflict_type === 'double_booking'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {c.conflict_type === 'double_booking' ? 'DOUBLE BOOK' : 'TRAVEL GAP'}
                    </span>
                    <div>
                      <span className="font-medium text-slate-700">{c.staff_name}</span>
                      <span className="text-slate-500 ml-1">— {c.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LLM recommendation */}
          <div className="rounded-lg border bg-slate-50 p-4 space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <Info size={12} /> AI Recommendation
              <span className={`ml-auto px-2 py-0.5 rounded text-xs font-bold ${
                impact.llm_urgency === 'high'   ? 'bg-red-100 text-red-700' :
                impact.llm_urgency === 'medium' ? 'bg-amber-100 text-amber-700' :
                'bg-green-100 text-green-700'
              }`}>{impact.llm_urgency.toUpperCase()}</span>
            </div>
            <p className="text-sm text-slate-700">{impact.llm_reason}</p>
            <p className="text-xs text-slate-400">
              {impact.upcoming_count} upcoming turnaround{impact.upcoming_count !== 1 ? 's' : ''} can be replanned.
            </p>
          </div>

          {/* Replan controls */}
          {impact.should_replan && (
            <div className="space-y-3 border-t pt-3">
              <div className="text-xs font-medium text-slate-600">Replan options</div>
              <div className="flex gap-3 flex-wrap">
                <label className="flex-1 min-w-32">
                  <span className="text-xs text-slate-500">Team</span>
                  <select
                    className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                    value={teamId}
                    onChange={e => setTeamId(Number(e.target.value))}
                  >
                    {teams.map(t => <option key={t.id} value={t.id}>{t.code}</option>)}
                  </select>
                </label>
                <label className="flex-1 min-w-28">
                  <span className="text-xs text-slate-500">Replan flights from</span>
                  <input
                    type="time"
                    className="mt-1 w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
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
              className="flex-1 border rounded-lg py-2 text-sm text-slate-600 hover:bg-slate-50"
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
  const [dirFilter, setDirFilter] = useState<'ALL'|'ARRIVAL'|'DEPARTURE'>('ALL')
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
    retry: 2,
    retryDelay: 2000,
  })

  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })

  const filtered = useMemo(() => {
    let list = flights
    if (dirFilter !== 'ALL')
      list = list.filter(f => f.direction === dirFilter)
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
  }, [flights, dirFilter, search])

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
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Plane size={20} /> Flight Dashboard
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
            value={date}
            onChange={e => { setDate(e.target.value); setPage(1) }}
          />
          {/* Direction filter */}
          <div className="flex border rounded-lg overflow-hidden text-sm">
            {(['ALL','ARRIVAL','DEPARTURE'] as const).map(d => (
              <button
                key={d}
                onClick={() => { setDirFilter(d); setPage(1) }}
                className={`px-3 py-1.5 ${dirFilter === d ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {d === 'ALL' ? 'All' : d === 'ARRIVAL' ? '▼ ARR' : '▲ DEP'}
              </button>
            ))}
          </div>
          <input
            type="search"
            placeholder="Search flight / reg / bay…"
            className="border rounded-lg px-3 py-1.5 text-sm bg-white w-52"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
          <span className="text-xs text-slate-400">{filtered.length} flights</span>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Solve status banner */}
      {solveStatus && (
        <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg border ${
          solveStatus === 'SOLVING'            ? 'bg-indigo-50 border-indigo-200 text-indigo-700' :
          solveStatus === 'SOLVING_COMPLETED'  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
          'bg-red-50 border-red-200 text-red-700'
        }`}>
          {solveStatus === 'SOLVING' && <RefreshCw size={14} className="animate-spin" />}
          {solveStatus === 'SOLVING'            && 'Replanning upcoming flights with Timefold AI…'}
          {solveStatus === 'SOLVING_COMPLETED'  && '✓ Replan complete — assignments updated in Task Planner.'}
          {solveStatus === 'SOLVING_STOPPED'    && 'Replan stopped.'}
          {solveStatus === 'ERROR'              && 'Replan failed — check server logs.'}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
        {isFetching && (
          <div className="px-4 py-2 text-xs text-indigo-600 bg-indigo-50 border-b flex items-center gap-2">
            <RefreshCw size={12} className="animate-spin" /> Loading flights…
          </div>
        )}
        {isError && (
          <div className="px-4 py-3 text-xs text-red-700 bg-red-50 border-b flex items-center gap-3">
            <AlertTriangle size={14} className="shrink-0" />
            <span>
              Failed to load flights — check that the server is running on port 8000.{' '}
              <span className="font-mono opacity-70">{(error as Error)?.message ?? 'Network error'}</span>
            </span>
            <button onClick={() => refetch()} className="ml-auto flex items-center gap-1 px-2 py-1 bg-red-100 hover:bg-red-200 rounded">
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 w-20">Dir</th>
                <th className="text-left px-4 py-3">Flight</th>
                <th className="text-left px-4 py-3">Aircraft</th>
                <th className="text-left px-4 py-3">Scheduled</th>
                <th className="text-left px-4 py-3">Estimated</th>
                <th className="text-left px-4 py-3">Bay</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3 w-20">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-16 text-sm">
                    {isFetching
                      ? <span className="flex items-center justify-center gap-2 text-slate-400"><RefreshCw size={14} className="animate-spin" /> Loading flights…</span>
                      : isError
                        ? <span className="text-red-400">
                            Could not reach the server on port 8000.
                            <br /><span className="text-xs mt-1 block text-slate-400">Make sure the FastAPI backend is running: <code className="font-mono bg-slate-100 px-1 rounded">uvicorn main:app --port 8000 --reload</code></span>
                          </span>
                        : <span className="text-slate-400">No flights found for this date.</span>
                    }
                  </td>
                </tr>
              ) : paged.map(f => {
                const delayed = f.estimated_time && f.estimated_time > f.scheduled_time
                const early   = f.estimated_time && f.estimated_time < f.scheduled_time
                const isChecking = checkingId === f.id
                return (
                  <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${DIR_BADGE[f.direction] ?? ''}`}>
                        {f.direction === 'ARRIVAL' ? <ArrowDown size={10} /> : <ArrowUp size={10} />}
                        {f.direction === 'ARRIVAL' ? 'ARR' : 'DEP'}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-800">{f.flight_number}</td>
                    <td className="px-4 py-2 text-slate-600 font-mono text-xs">{f.aircraft_registration ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-slate-600">{f.scheduled_time}</td>
                    <td className="px-4 py-2 font-mono">
                      {f.estimated_time ? (
                        <span className={delayed ? 'text-red-600 font-semibold' : early ? 'text-green-600 font-semibold' : 'text-slate-600'}>
                          {f.estimated_time}
                          {delayed && ' ▲'}
                          {early   && ' ▼'}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {f.bay ? (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-mono text-xs">{f.bay}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        f.status === 'DELAYED'   ? 'bg-red-100 text-red-700' :
                        f.status === 'LANDED' || f.status === 'DEPARTED' ? 'bg-slate-100 text-slate-500' :
                        f.status === 'CANCELLED' ? 'bg-red-200 text-red-800' :
                        'bg-blue-50 text-blue-700'
                      }`}>{f.status}</span>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => setEditFlight(f)}
                        disabled={isChecking}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
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

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="border-t px-4 py-2 bg-slate-50">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={filtered.length}
              from={filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
              to={Math.min(page * PAGE_SIZE, filtered.length)}
              onPage={setPage}
            />
          </div>
        )}
      </div>

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
