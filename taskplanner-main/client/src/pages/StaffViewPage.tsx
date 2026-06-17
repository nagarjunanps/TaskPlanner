import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getStaff, getStaffTasks, getStaffRoster } from '../api/client'
import type { Staff, StaffRosterDay, StaffTask } from '../api/types'
import {
  User, Calendar, ClipboardList, Search, ChevronLeft, ChevronRight,
  Plane, ArrowDown, ArrowUp, MapPin, Clock,
} from 'lucide-react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW    = 'SMTWTFS'

const SHIFT_STYLE: Record<string, string> = {
  S1: 'bg-blue-100 text-blue-800',
  S2: 'bg-green-100 text-green-800',
  S3: 'bg-amber-100 text-amber-800',
  S4: 'bg-purple-100 text-purple-800',
}

// Staff already know what to do on each flight — show which flights they're
// on, not the per-role/per-set breakdown. Collapse multiple slot assignments
// on the same turnaround into a single flight row, sorted by time.
function dedupeByFlight(tasks: StaffTask[]): StaffTask[] {
  const seen = new Map<number, StaffTask>()
  for (const t of tasks) {
    if (!seen.has(t.turnaround_id)) seen.set(t.turnaround_id, t)
  }
  return [...seen.values()].sort((a, b) => {
    const ta = a.arr_time ?? a.dep_time ?? '99:99'
    const tb = b.arr_time ?? b.dep_time ?? '99:99'
    return ta.localeCompare(tb)
  })
}

export default function StaffViewPage() {
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const [date, setDate]           = useState(todayStr)
  const [year, setYear]           = useState(now.getFullYear())
  const [month, setMonth]         = useState(now.getMonth() + 1)
  const [search, setSearch]       = useState('')
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null)
  const [dropdownOpen, setDropdownOpen]   = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { data: allStaff = [] } = useQuery({
    queryKey: ['staff-all'],
    queryFn: () => getStaff({ active: true }),
  })

  const filtered = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    return allStaff
      .filter(s => s.name.toLowerCase().includes(q) || s.employee_id.toLowerCase().includes(q))
      .slice(0, 12)
  }, [search, allStaff])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['staff-tasks', selectedStaff?.id, date],
    queryFn: () => getStaffTasks(selectedStaff!.id, date),
    enabled: !!selectedStaff,
  })

  const { data: rosterDays = [] } = useQuery({
    queryKey: ['staff-roster', selectedStaff?.id, year, month],
    queryFn: () => getStaffRoster(selectedStaff!.id, year, month),
    enabled: !!selectedStaff,
  })

  function selectMember(s: Staff) {
    setSelectedStaff(s)
    setSearch(s.name)
    setDropdownOpen(false)
  }

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
        <User size={20} /> My View
      </h1>

      {/* Staff search */}
      <div className="relative max-w-md" ref={dropdownRef}>
        <label className="block text-xs font-medium text-slate-500 mb-1 uppercase tracking-wide">
          Search staff
        </label>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            placeholder="Name or employee ID…"
            value={search}
            onChange={e => { setSearch(e.target.value); setDropdownOpen(true) }}
            onFocus={() => { if (search) setDropdownOpen(true) }}
          />
        </div>
        {dropdownOpen && filtered.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 bg-white border rounded-lg shadow-xl mt-1 divide-y max-h-72 overflow-auto">
            {filtered.map(s => (
              <button
                key={s.id}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm flex items-center justify-between"
                onClick={() => selectMember(s)}
              >
                <span className="font-medium text-slate-800">{s.name}</span>
                <span className="text-xs text-slate-400">{s.employee_id} · {s.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!selectedStaff ? (
        <div className="py-24 text-center text-slate-400 text-sm">
          Search and select a staff member above to view their tasks and shift roster.
        </div>
      ) : (
        <div className="space-y-8">
          {/* Staff info chip */}
          <div className="flex items-center gap-4 bg-white border rounded-xl p-4 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
              <span className="text-xl font-bold text-indigo-600">{selectedStaff.name.charAt(0)}</span>
            </div>
            <div>
              <div className="font-semibold text-slate-800 text-base">{selectedStaff.name}</div>
              <div className="text-sm text-slate-500 mt-0.5">
                {selectedStaff.employee_id}
                <span className="mx-2 text-slate-300">·</span>
                <span className="font-medium text-slate-700">{selectedStaff.role}</span>
              </div>
            </div>
          </div>

          {/* ── My Flights ───────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-semibold text-slate-700 flex items-center gap-2 text-base">
                <ClipboardList size={16} /> My Flights
              </h2>
              <input
                type="date"
                className="border rounded-lg px-3 py-1 text-sm bg-white shadow-sm"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>

            {tasksLoading ? (
              <div className="text-sm text-slate-400 animate-pulse">Loading flights…</div>
            ) : tasks.length === 0 ? (
              <div className="bg-white border rounded-xl p-10 text-center text-slate-400 text-sm shadow-sm">
                No flights assigned for <strong>{date}</strong>.
                <br />
                <span className="text-xs">
                  Flights appear once the Task Planner has been run for your team on this date.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {dedupeByFlight(tasks).map(t => (
                  <div
                    key={t.turnaround_id}
                    className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex items-center gap-4"
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                      <Plane size={18} className="text-slate-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-800 text-base leading-tight">
                        {t.aircraft_registration ?? '—'}
                        <span className="text-xs font-normal text-slate-400 ml-2">{t.aircraft_type ?? ''}</span>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
                        {t.arr_flight_number && (
                          <span className="flex items-center gap-1">
                            <ArrowDown size={11} className="text-sky-500" />
                            {t.arr_flight_number}
                            {t.arr_time && <span className="font-mono">{t.arr_time}</span>}
                          </span>
                        )}
                        {t.dep_flight_number && (
                          <span className="flex items-center gap-1">
                            <ArrowUp size={11} className="text-emerald-500" />
                            {t.dep_flight_number}
                            {t.dep_time && <span className="font-mono">{t.dep_time}</span>}
                          </span>
                        )}
                        {t.bay && (
                          <span className="flex items-center gap-1">
                            <MapPin size={11} className="text-slate-400" />
                            Bay {t.bay}
                          </span>
                        )}
                        {t.ground_time_minutes != null && (
                          <span className="flex items-center gap-1">
                            <Clock size={11} className="text-slate-400" />
                            {t.ground_time_minutes} min
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── My Roster ────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="font-semibold text-slate-700 flex items-center gap-2 text-base">
                <Calendar size={16} /> My Roster
              </h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={prevMonth}
                  className="p-1 rounded hover:bg-slate-200 text-slate-600"
                ><ChevronLeft size={14} /></button>
                <span className="text-sm font-medium text-slate-700 min-w-24 text-center">
                  {MONTHS[month - 1]} {year}
                </span>
                <button
                  onClick={nextMonth}
                  className="p-1 rounded hover:bg-slate-200 text-slate-600"
                ><ChevronRight size={14} /></button>
              </div>
            </div>

            {rosterDays.length === 0 ? (
              <div className="bg-white border rounded-xl p-8 text-center text-slate-400 text-sm shadow-sm">
                No roster found for {MONTHS[month - 1]} {year}.
                <br />
                <span className="text-xs">The admin must initialize and publish the team roster first.</span>
              </div>
            ) : (
              <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <div className="flex min-w-max">
                    {rosterDays.map((d: StaffRosterDay) => {
                      const dt  = new Date(d.date)
                      const dow = dt.getDay()
                      const day = dt.getDate()
                      const isWeekend = dow === 0 || dow === 6
                      const isOff     = d.entry_type === 'OFF'
                      const shiftSty  = d.shift_code ? SHIFT_STYLE[d.shift_code] ?? '' : ''
                      const isToday   = d.date === todayStr
                      return (
                        <div
                          key={d.date}
                          className={`flex flex-col items-center px-2 pt-2 pb-3 min-w-[3rem] border-r last:border-r-0 ${
                            isWeekend ? 'bg-slate-50' : ''
                          } ${isToday ? 'bg-indigo-50' : ''}`}
                        >
                          <div className={`text-xs mb-0.5 ${isWeekend ? 'text-slate-400' : 'text-slate-400'}`}>
                            {DOW[dow]}
                          </div>
                          <div className={`text-sm font-semibold mb-2 ${isToday ? 'text-indigo-700' : 'text-slate-700'}`}>
                            {day}
                          </div>
                          {isOff ? (
                            <span className="text-xs text-slate-300 font-medium">—</span>
                          ) : d.entry_type === 'MC' ? (
                            <span className="text-xs px-1 py-0.5 rounded bg-red-100 text-red-700 font-medium">MC</span>
                          ) : d.entry_type === 'EL' ? (
                            <span className="text-xs px-1 py-0.5 rounded bg-teal-100 text-teal-700 font-medium">EL</span>
                          ) : (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${shiftSty}`}>
                              {d.shift_code ?? 'ON'}
                            </span>
                          )}
                          {d.is_runner && (
                            <span className="text-xs text-yellow-500 font-bold mt-0.5" title="Runner">R</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                {/* Legend */}
                <div className="flex gap-4 px-4 py-2 border-t bg-slate-50 text-xs text-slate-500">
                  {Object.entries(SHIFT_STYLE).map(([code, cls]) => (
                    <span key={code} className={`px-2 py-0.5 rounded font-medium ${cls}`}>{code}</span>
                  ))}
                  <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium">MC</span>
                  <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-700 font-medium">EL</span>
                  <span className="ml-auto text-yellow-500 font-bold">R = Runner</span>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
