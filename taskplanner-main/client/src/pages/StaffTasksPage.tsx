import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ClipboardList, Plane, ArrowDown, ArrowUp, Clock,
  MapPin, ChevronLeft, ChevronRight, Calendar,
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
// assignments on the same turnaround into a single flight row.
function dedupeByFlight(tasks: StaffTask[]): StaffTask[] {
  const seen = new Map<number, StaffTask>()
  for (const t of tasks) {
    if (!seen.has(t.turnaround_id)) seen.set(t.turnaround_id, t)
  }
  return [...seen.values()]
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
          {flights.map(t => (
            <FlightRow key={t.turnaround_id} task={t} />
          ))}
        </div>

        {/* Bottom spacer for mobile bottom nav */}
        <div className="h-4" />
      </div>
    </div>
  )
}
