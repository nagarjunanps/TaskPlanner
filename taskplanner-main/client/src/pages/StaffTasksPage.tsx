import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ClipboardList, Plane, ArrowDown, ArrowUp, Clock,
  MapPin, ChevronLeft, ChevronRight, Calendar, Coffee,
} from 'lucide-react'
import { getStaffTasks } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { StaffTask } from '../api/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function offsetDate(base: string, days: number): string {
  const d = new Date(base + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDate(s: string): string {
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

const ROLE_LABEL: Record<string, string> = {
  RLS:    'Ramp Lead Supervisor',
  TOWER:  'Tower Operator',
  DRIVER: 'Ground Equipment Driver',
  LOADER: 'Cargo Loader',
}

// Staff already know what to do on each flight — just show which flights
// they're on, not the per-role/per-set breakdown. Collapse multiple slot
// assignments on the same turnaround+leg into a single flight row. A split
// (long) turnaround's ARRIVAL and DEPARTURE legs are worked at different
// times, so they must stay as separate rows rather than collapsing together.
function flightKey(t: StaffTask): string {
  return `${t.turnaround_id}:${t.leg}`
}

function dedupeByFlight(tasks: StaffTask[]): StaffTask[] {
  const seen = new Map<string, StaffTask>()
  for (const t of tasks) {
    const key = flightKey(t)
    if (!seen.has(key)) seen.set(key, t)
  }
  return [...seen.values()]
}

// ── Breaks ────────────────────────────────────────────────────────────────────
// Only surface gaps long enough to actually be a break (> 20 min) — shorter
// gaps are just normal turnaround buffer and would clutter the list.
//
// A shift gets at most two planned breaks — a 60-min meal break and a 30-min
// tea break — so even if the actual idle gap between flights runs longer
// than that, the displayed break is capped rather than shown at its full raw
// length (an uncapped gap was previously rendering as e.g. two 90-min
// breaks, which overstates how much break time staff are actually owed).
// The meal break is placed on whichever idle gap falls closest to the
// midpoint of the staff's working span, not just the first gap of the day —
// a break parked right at shift-start isn't real rest partway through a long
// shift. The second (tea) break must also sit at least MIN_GAP_BETWEEN_BREAKS
// away from the meal break — two idle gaps that just happen to be adjacent,
// split only by a single quick turnaround, aren't two separate rest periods.
const MIN_BREAK_MINUTES = 20
const BREAK_CAPS_MINUTES = [60, 30]
const MIN_GAP_BETWEEN_BREAKS = 60

function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

interface Break {
  start: number
  end: number
}

function computeBreaks(flights: StaffTask[]): Map<string, Break> {
  const breaks = new Map<string, Break>()
  if (flights.length < 2) return breaks

  const gaps: { key: string; start: number; end: number; gap: number }[] = []
  for (let i = 0; i < flights.length - 1; i++) {
    const cur = flights[i]
    const next = flights[i + 1]
    const curEnd = toMinutes(cur.dep_time ?? cur.arr_time)
    const nextStart = toMinutes(next.arr_time ?? next.dep_time)
    if (curEnd == null || nextStart == null) continue
    const gap = nextStart - curEnd
    if (gap > MIN_BREAK_MINUTES) {
      gaps.push({ key: flightKey(cur), start: curEnd, end: nextStart, gap })
    }
  }
  if (gaps.length === 0) return breaks

  const shiftStart = toMinutes(flights[0].arr_time ?? flights[0].dep_time)
  const last = flights[flights.length - 1]
  const shiftEnd = toMinutes(last.dep_time ?? last.arr_time)
  const midpoint = shiftStart != null && shiftEnd != null ? (shiftStart + shiftEnd) / 2 : gaps[0].start

  // Rank gaps by how close their midpoint sits to the shift's midpoint —
  // the closest becomes the 60-min meal break (real mid-shift rest), the
  // next-closest the 30-min tea break. Any further gaps stay unflagged.
  const ranked = [...gaps].sort((a, b) => {
    const distA = Math.abs((a.start + a.end) / 2 - midpoint)
    const distB = Math.abs((b.start + b.end) / 2 - midpoint)
    return distA - distB
  })

  const chosen: { start: number; end: number }[] = []
  for (const g of ranked) {
    if (chosen.length >= BREAK_CAPS_MINUTES.length) break
    const tooClose = chosen.some(c => g.start < c.end + MIN_GAP_BETWEEN_BREAKS && c.start < g.end + MIN_GAP_BETWEEN_BREAKS)
    if (tooClose) continue
    const cap = BREAK_CAPS_MINUTES[chosen.length]
    const brk = { start: g.start, end: g.start + Math.min(g.gap, cap) }
    breaks.set(g.key, brk)
    chosen.push(brk)
  }

  return breaks
}

function BreakRow({ brk }: { brk: Break }) {
  const duration = brk.end - brk.start
  return (
    <div className="flex items-center gap-3 px-1 py-1">
      <div className="flex-1 border-t border-dashed border-amber-300" />
      <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 shrink-0">
        <Coffee size={12} /> Break {fmtMinutes(brk.start)}–{fmtMinutes(brk.end)} · {duration} min
      </span>
      <div className="flex-1 border-t border-dashed border-amber-300" />
    </div>
  )
}

// ── Flight row ────────────────────────────────────────────────────────────────

function FlightRow({ task }: { task: StaffTask }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
        <Plane size={18} className="text-slate-500" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="font-bold text-slate-800 text-base leading-tight">
          {task.aircraft_registration ?? '—'}
          <span className="text-xs font-normal text-slate-400 ml-2">{task.aircraft_type ?? ''}</span>
          {task.leg !== 'BOTH' && (
            <span className="text-xs font-medium text-indigo-500 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5 ml-2">
              {task.leg === 'ARRIVAL' ? 'Arrival crew' : 'Departure crew'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
          {task.arr_flight_number && (
            <span className="flex items-center gap-1">
              <ArrowDown size={11} className="text-sky-500" />
              {task.arr_flight_number}
              {task.arr_time && <span className="font-mono">{task.arr_time}</span>}
            </span>
          )}
          {task.dep_flight_number && (
            <span className="flex items-center gap-1">
              <ArrowUp size={11} className="text-emerald-500" />
              {task.dep_flight_number}
              {task.dep_time && <span className="font-mono">{task.dep_time}</span>}
            </span>
          )}
          {task.bay && (
            <span className="flex items-center gap-1">
              <MapPin size={11} className="text-slate-400" />
              Bay {task.bay}
            </span>
          )}
          {task.ground_time_minutes != null && (
            <span className="flex items-center gap-1">
              <Clock size={11} className="text-slate-400" />
              {task.ground_time_minutes} min
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StaffTasksPage() {
  const { user } = useAuth()
  const [date, setDate] = useState(todayLocal)

  const staffId = user?.staff_id ?? null

  const { data: tasks = [], isFetching, isError } = useQuery<StaffTask[]>({
    queryKey:  ['staff-tasks', staffId, date],
    queryFn:   () => getStaffTasks(staffId!, date),
    enabled:   staffId != null,
    staleTime: 30_000,
  })

  const flights = dedupeByFlight(tasks).sort((a, b) => {
    const ta = a.arr_time ?? a.dep_time ?? '99:99'
    const tb = b.arr_time ?? b.dep_time ?? '99:99'
    return ta.localeCompare(tb)
  })

  const breaksAfter = computeBreaks(flights)
  const isToday = date === todayLocal()

  if (!staffId) {
    return (
      <div className="p-8 text-center text-slate-500">
        Staff account required to view tasks.
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50">

      {/* Page header */}
      <div className="bg-white border-b px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-800 flex items-center gap-2">
                <ClipboardList size={20} className="text-indigo-500" /> My Flights
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                {user?.name} · {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
              </p>
            </div>

            {/* Date navigator */}
            <div className="flex items-center gap-1 bg-slate-50 border rounded-xl overflow-hidden shadow-sm">
              <button
                onClick={() => setDate(d => offsetDate(d, -1))}
                className="px-3 py-2.5 hover:bg-white text-slate-600 border-r transition-colors"
                aria-label="Previous day"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="flex items-center gap-1.5 px-3">
                <Calendar size={13} className="text-slate-400" />
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="text-sm bg-transparent focus:outline-none text-slate-700 cursor-pointer"
                />
              </div>
              <button
                onClick={() => setDate(d => offsetDate(d, 1))}
                className="px-3 py-2.5 hover:bg-white text-slate-600 border-l transition-colors"
                aria-label="Next day"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Date label */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-slate-600 font-medium">{formatDate(date)}</span>
            {isToday && (
              <span className="text-xs bg-indigo-500 text-white px-2 py-0.5 rounded-full font-medium">Today</span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-4">

        {/* Loading */}
        {isFetching && (
          <div className="flex items-center gap-2 text-sm text-indigo-600 bg-indigo-50 rounded-xl px-4 py-3 border border-indigo-100">
            <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Loading flights…
          </div>
        )}

        {isError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4">
            Failed to load flights. Check that the backend server is running.
          </div>
        )}

        {/* Summary badge */}
        {!isFetching && !isError && flights.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">
              {flights.length} flight{flights.length > 1 ? 's' : ''} assigned
            </span>
            <span className="text-xs text-slate-400">for this date</span>
          </div>
        )}

        {/* Empty state */}
        {!isFetching && !isError && flights.length === 0 && (
          <div className="bg-white border rounded-2xl p-10 text-center space-y-3">
            <ClipboardList size={40} className="text-slate-200 mx-auto" />
            <div>
              <p className="text-slate-600 font-medium">No flights assigned</p>
              <p className="text-slate-400 text-sm mt-1">
                Flights appear here once your team's planner has run.
              </p>
            </div>
          </div>
        )}

        {/* Flight list */}
        <div className="space-y-2">
          {flights.map(t => {
            const brk = breaksAfter.get(flightKey(t))
            return (
              <Fragment key={flightKey(t)}>
                <FlightRow task={t} />
                {brk && <BreakRow brk={brk} />}
              </Fragment>
            )
          })}
        </div>

        {/* Bottom spacer for mobile bottom nav */}
        <div className="h-4" />
      </div>
    </div>
  )
}
