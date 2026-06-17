import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Calendar, Clock, Star } from 'lucide-react'
import { getStaffRoster } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { StaffRosterDay } from '../api/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number)   { return new Date(year, month, 0).getDate() }
function firstDayOfMonth(year: number, month: number) {
  const dow = new Date(year, month - 1, 1).getDay()
  return dow === 0 ? 6 : dow - 1   // Mon=0 … Sun=6
}

// ── Shift / entry styles ──────────────────────────────────────────────────────

const SHIFT_STYLE: Record<string, string> = {
  S1: 'bg-blue-100   text-blue-700   border-blue-200',
  S2: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  S3: 'bg-amber-100  text-amber-700  border-amber-200',
  S4: 'bg-purple-100 text-purple-700 border-purple-200',
}

const ENTRY_STYLE: Record<string, string> = {
  ON_DUTY: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  OFF:     'bg-slate-100  text-slate-500  border-slate-200',
  MC:      'bg-red-100    text-red-700    border-red-200',
  EL:      'bg-teal-100   text-teal-700   border-teal-200',
  OT:      'bg-orange-100 text-orange-700 border-orange-200',
}

const SHIFT_TIMES: Record<string, string> = {
  S1: '05:00–15:00',
  S2: '11:00–23:00',
  S3: '14:30–00:30',
  S4: '23:00–11:00',
}

// ── Day cell ──────────────────────────────────────────────────────────────────

function DayCell({
  day, rosterMap, year, month, today,
}: {
  day: number | null
  rosterMap: Map<string, StaffRosterDay>
  year: number; month: number; today: string
}) {
  if (day === null) return <div className="aspect-square sm:h-[72px]" />

  const dateStr    = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const entry      = rosterMap.get(dateStr)
  const isToday    = dateStr === today
  const shiftCode  = entry?.shift_code ?? null
  const entryType  = entry?.entry_type ?? null
  const isRunner   = entry?.is_runner ?? false
  const badgeStyle = shiftCode
    ? (SHIFT_STYLE[shiftCode] ?? ENTRY_STYLE.ON_DUTY)
    : entryType
    ? (ENTRY_STYLE[entryType] ?? ENTRY_STYLE.OFF)
    : ENTRY_STYLE.OFF
  const label = shiftCode ?? entryType ?? 'OFF'

  return (
    <div className={`
      aspect-square sm:h-[72px] rounded-xl border p-1 flex flex-col gap-0.5 transition-all
      ${isToday
        ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300/50'
        : 'border-slate-100 bg-white hover:bg-slate-50'}
    `}>
      <div className="flex items-start justify-between">
        <span className={`text-[10px] sm:text-xs font-semibold leading-none ${isToday ? 'text-indigo-700' : 'text-slate-600'}`}>
          {day}
        </span>
        {isRunner && (
          <Star size={8} className="text-amber-500 fill-amber-400 shrink-0" title="Runner" />
        )}
      </div>

      {entry ? (
        <span className={`
          text-center text-[9px] sm:text-xs font-bold px-0.5 py-0.5 rounded border leading-none truncate
          ${badgeStyle}
        `}>
          {label}
        </span>
      ) : (
        <span className="text-center text-[9px] text-slate-300 leading-none">—</span>
      )}

      {/* Shift time — only on larger cells */}
      {shiftCode && SHIFT_TIMES[shiftCode] && (
        <span className="hidden sm:block text-center text-[8px] text-slate-400 leading-none">
          {SHIFT_TIMES[shiftCode]}
        </span>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']
const DAY_NAMES_SHORT = ['M','T','W','T','F','S','S']
const DAY_NAMES_FULL  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

export default function StaffShiftPage() {
  const { user } = useAuth()

  const now  = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const today = todayLocal()

  const staffId = user?.staff_id ?? null

  const { data: days = [], isFetching } = useQuery<StaffRosterDay[]>({
    queryKey:  ['staff-roster', staffId, year, month],
    queryFn:   () => getStaffRoster(staffId!, year, month),
    enabled:   staffId != null,
    staleTime: 60_000,
  })

  const rosterMap = new Map(days.map(d => [d.date, d]))

  const startOffset = firstDayOfMonth(year, month)
  const totalDays   = daysInMonth(year, month)
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const summary = days.reduce<Record<string, number>>((acc, d) => {
    const key = d.shift_code ?? d.entry_type ?? 'OFF'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  if (!staffId) {
    return (
      <div className="p-8 text-center text-slate-500">
        Staff account required to view shift calendar.
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-800 flex items-center gap-2">
                <Calendar size={20} className="text-indigo-500" /> My Shift Calendar
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                {user?.name} · {user?.employee_id}
              </p>
            </div>

            {/* Month navigator */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={prevMonth}
                className="p-2 rounded-xl border hover:bg-slate-100 text-slate-600 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold text-slate-700 w-32 sm:w-40 text-center">
                {MONTH_NAMES[month - 1]} {year}
              </span>
              <button
                onClick={nextMonth}
                className="p-2 rounded-xl border hover:bg-slate-100 text-slate-600 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 space-y-4">

        {/* Summary chips */}
        {days.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary).map(([k, n]) => (
              <span
                key={k}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
                  SHIFT_STYLE[k] ?? ENTRY_STYLE[k] ?? 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
              >
                {k} × {n}
              </span>
            ))}
          </div>
        )}

        {/* Loading */}
        {isFetching && (
          <div className="flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 rounded-xl px-4 py-2.5 border border-indigo-100">
            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Loading roster…
          </div>
        )}

        {/* Calendar grid */}
        <div className="bg-white rounded-2xl border shadow-sm p-3 sm:p-4">
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-1.5">
            {DAY_NAMES_FULL.map((d, i) => (
              <div key={d} className="text-center py-1">
                <span className="hidden sm:inline text-xs font-semibold text-slate-400 uppercase tracking-wide">{d}</span>
                <span className="sm:hidden text-[10px] font-semibold text-slate-400 uppercase">{DAY_NAMES_SHORT[i]}</span>
              </div>
            ))}
          </div>

          {/* Weeks */}
          {Array.from({ length: cells.length / 7 }, (_, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-1 sm:mb-1.5">
              {cells.slice(wi * 7, wi * 7 + 7).map((day, di) => (
                <DayCell
                  key={di}
                  day={day}
                  rosterMap={rosterMap}
                  year={year}
                  month={month}
                  today={today}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Legend</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries({ ...SHIFT_STYLE, ...ENTRY_STYLE }).map(([k, v]) => (
              <span key={k} className={`text-xs px-2 py-0.5 rounded border font-medium ${v}`}>{k}</span>
            ))}
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Star size={10} className="text-amber-500 fill-amber-400" /> Runner
            </span>
          </div>
        </div>

        {/* Shift times reference */}
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            <Clock size={13} /> Shift Hours
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {Object.entries(SHIFT_TIMES).map(([code, time]) => (
              <div key={code} className={`rounded-xl border p-3 text-center ${SHIFT_STYLE[code]}`}>
                <div className="font-bold text-base">{code}</div>
                <div className="text-xs mt-0.5 opacity-80">{time}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="h-4" />
      </div>
    </div>
  )
}
