import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTurnarounds, getTaskAssignments, validateTaskAssignments } from '../api/client'
import type { Team } from '../api/types'
import { Search, AlertTriangle } from 'lucide-react'

const HOURS = 24
const DAY_MINUTES = HOURS * 60
const LONG_TURNAROUND_THRESHOLD_MIN = 55
const LEG_MINUTES = 45

function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function fmt(min: number): string {
  const h = Math.floor(min / 60) % 24
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

interface Row {
  turnaroundId: number
  bay: string
  teamLabel: string
  start: number
  end: number
  arrNum: string | null
  depNum: string | null
  ac: string
  acType: string
  cargo: number | null
  sets: number
  status: string
  conflict: boolean
}

export default function FlightTimeline({ date, teams }: { date: string; teams: Team[] }) {
  const [groupMode, setGroupMode] = useState<'bay' | 'team'>('bay')
  const [search, setSearch] = useState('')
  const [hover, setHover] = useState<{ row: Row; x: number; y: number } | null>(null)

  const { data: turnarounds = [], isFetching, isError } = useQuery({
    queryKey: ['turnarounds', date],
    queryFn: () => getTurnarounds(date),
    staleTime: 0,
  })
  const { data: assignments = [] } = useQuery({
    queryKey: ['taskAssignments', date],
    queryFn: () => getTaskAssignments(date),
    staleTime: 0,
  })
  const { data: validation } = useQuery({
    queryKey: ['taskValidation', date],
    queryFn: () => validateTaskAssignments(date),
    staleTime: 0,
  })

  const teamCodeById = useMemo(() => {
    const m = new Map<number, string>()
    teams.forEach(t => m.set(t.id, t.code))
    return m
  }, [teams])

  const conflictedTurnaroundIds = useMemo(() => {
    const s = new Set<number>()
    validation?.conflicts.forEach(c => {
      s.add(c.turnaround_id)
      s.add(c.other_turnaround_id)
    })
    return s
  }, [validation])

  const teamsByTurnaround = useMemo(() => {
    const m = new Map<number, Set<number>>()
    assignments.forEach(a => {
      if (!m.has(a.turnaround_id)) m.set(a.turnaround_id, new Set())
      m.get(a.turnaround_id)!.add(a.team_id)
    })
    return m
  }, [assignments])

  const rows = useMemo(() => {
    const out: Row[] = []
    for (const t of turnarounds) {
      const arr = t.arrival_flight
      const dep = t.departure_flight
      const startRaw = toMinutes(arr?.estimated_time ?? arr?.scheduled_time)
      const endRaw = toMinutes(dep?.estimated_time ?? dep?.scheduled_time)
      const start = startRaw ?? endRaw ?? 0
      let end = endRaw ?? startRaw ?? start
      if (end < start) end = Math.min(DAY_MINUTES, start + 30)
      end = Math.max(end, start + 10)

      const bay = arr?.bay ?? dep?.bay ?? 'No bay'
      const teamIds = [...(teamsByTurnaround.get(t.id) ?? [])]
      const teamLabel = teamIds.length === 0
        ? 'Unassigned'
        : teamIds.map(id => teamCodeById.get(id) ?? `T${id}`).sort().join(' / ')

      out.push({
        turnaroundId: t.id,
        bay,
        teamLabel,
        start,
        end,
        arrNum: arr?.flight_number ?? null,
        depNum: dep?.flight_number ?? null,
        ac: t.aircraft_registration ?? '—',
        acType: arr?.aircraft_type ?? dep?.aircraft_type ?? '—',
        cargo: t.cargo_weight_tons,
        sets: t.required_sets,
        status: dep?.status ?? arr?.status ?? '—',
        conflict: conflictedTurnaroundIds.has(t.id),
      })
    }
    return out
  }, [turnarounds, teamsByTurnaround, teamCodeById, conflictedTurnaroundIds])

  const key = groupMode === 'bay' ? 'bay' : 'teamLabel'
  const groups = useMemo(() => [...new Set(rows.map(r => r[key]))].sort(), [rows, key])

  const q = search.trim().toLowerCase()
  const visibleGroups = useMemo(() => {
    if (!q) return groups
    return groups.filter(g => {
      const groupRows = rows.filter(r => r[key] === g)
      return g.toLowerCase().includes(q) || groupRows.some(r =>
        (r.arrNum ?? '').toLowerCase().includes(q) ||
        (r.depNum ?? '').toLowerCase().includes(q) ||
        r.ac.toLowerCase().includes(q)
      )
    })
  }, [groups, rows, key, q])

  const now = new Date()
  const isToday = date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const nowMin = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-sm overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-700 bg-slate-800/60">
        <div className="flex border border-slate-700 rounded-lg overflow-hidden text-sm">
          {(['bay', 'team'] as const).map(m => (
            <button
              key={m}
              onClick={() => setGroupMode(m)}
              className={`px-3 py-1.5 ${groupMode === m ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-700'}`}
            >
              Group: {m === 'bay' ? 'Bay' : 'Team'}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            placeholder="Filter bay / team / flight no…"
            className="border border-slate-700 rounded-lg pl-7 pr-3 py-1.5 text-sm bg-slate-800 text-slate-200 placeholder-slate-500 w-60"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="text-xs text-slate-500">
          {visibleGroups.length} {groupMode === 'bay' ? 'bay(s)' : 'team(s)'} with activity · {rows.length} turnarounds
        </span>
        {isFetching && <span className="text-xs text-indigo-400 ml-auto">Loading…</span>}
        {isError && <span className="text-xs text-red-400 ml-auto">Failed to load turnarounds.</span>}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 px-4 py-2 text-xs text-slate-400 border-b border-slate-700 bg-slate-800/60">
        <span className="inline-flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-indigo-500 inline-block" /> Single-crew turnaround</span>
        <span className="inline-flex items-center gap-1.5">
          <i className="w-3 h-3 rounded-sm inline-block" style={{ background: 'linear-gradient(90deg,#0ea5e9,#f59e0b,#10b981)' }} />
          Split crew (arrival / idle / departure)
        </span>
        <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Conflict flagged</span>
      </div>

      {/* Grid */}
      <div className="overflow-auto max-h-[640px]" onMouseLeave={() => setHover(null)} onClick={() => setHover(null)}>
        <div
          className="relative grid"
          style={{ gridTemplateColumns: `120px repeat(${HOURS}, minmax(90px, 1fr))`, minWidth: 2280 }}
        >
          {/* corner */}
          <div className="sticky left-0 top-0 bg-slate-800 border-r border-slate-700 border-b z-20" />
          {Array.from({ length: HOURS }).map((_, h) => (
            <div
              key={h}
              className="sticky top-0 z-10 bg-slate-800 border-b border-r border-slate-700 text-center text-[11px] text-slate-400 py-2"
            >
              {String(h).padStart(2, '0')}:00
            </div>
          ))}

          {visibleGroups.length === 0 ? (
            <div className="col-span-full px-4 py-12 text-center text-sm text-slate-500">
              {isFetching ? 'Loading…' : 'No turnarounds found for this date.'}
            </div>
          ) : visibleGroups.map(g => {
            const groupRows = rows.filter(r => r[key] === g)
            return (
              <Fragment key={g}>
                <div
                  key={`label-${g}`}
                  className="sticky left-0 z-10 bg-slate-900 border-r border-b border-slate-700 px-3 py-2 flex flex-col justify-center gap-0.5"
                >
                  <span className="text-xs font-semibold text-slate-200">{g}</span>
                  <span className="text-[10px] text-slate-500">{groupRows.length} turnaround{groupRows.length > 1 ? 's' : ''}</span>
                </div>
                <div
                  key={`row-${g}`}
                  className="relative border-b border-slate-800 h-[52px]"
                  style={{ gridColumn: `2 / span ${HOURS}` }}
                >
                  {groupRows.map(r => {
                    const long = r.end - r.start >= LONG_TURNAROUND_THRESHOLD_MIN
                    const leftPct = (r.start / DAY_MINUTES) * 100
                    const widthPct = ((r.end - r.start) / DAY_MINUTES) * 100
                    let background = '#6366f1'
                    if (long) {
                      const dur = r.end - r.start
                      const arrPct = Math.min(45, (LEG_MINUTES / dur) * 100)
                      const depPct = Math.min(45, (LEG_MINUTES / dur) * 100)
                      background = `linear-gradient(90deg, #0ea5e9 0 ${arrPct}%, #f59e0b ${arrPct}% ${100 - depPct}%, #10b981 ${100 - depPct}% 100%)`
                    }
                    return (
                      <div
                        key={r.turnaroundId}
                        className={`absolute top-[7px] bottom-[7px] rounded-md text-white text-[11px] flex items-center px-2 overflow-hidden whitespace-nowrap cursor-default shadow-sm border border-white/20 hover:brightness-110 ${r.conflict ? 'outline outline-2 outline-red-500' : ''}`}
                        style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 1.2)}%`, background }}
                        onMouseEnter={e => setHover({ row: r, x: e.clientX, y: e.clientY })}
                        onMouseMove={e => setHover({ row: r, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHover(null)}
                        onClick={e => {
                          e.stopPropagation()
                          setHover(h => h?.row.turnaroundId === r.turnaroundId ? null : { row: r, x: e.clientX, y: e.clientY })
                        }}
                      >
                        {r.arrNum ?? '—'} / {r.depNum ?? '—'}
                        {r.conflict && (
                          <AlertTriangle size={11} className="ml-1.5 shrink-0 text-red-100" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </Fragment>
            )
          })}

          {isToday && nowMin >= 0 && nowMin < DAY_MINUTES && (
            <div
              className="absolute top-0 bottom-0 w-px bg-red-400 z-10"
              style={{ left: `calc(120px + (100% - 120px) * ${nowMin / DAY_MINUTES})` }}
            >
              <span className="absolute -top-4 -left-3 text-[10px] text-red-400 font-semibold bg-slate-900 px-0.5">now</span>
            </div>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {hover && (
        <div
          className="fixed z-50 bg-slate-800 border border-slate-700 rounded-lg shadow-xl text-xs px-3 py-2.5 leading-relaxed pointer-events-none min-w-[220px]"
          style={{ left: Math.min(hover.x + 14, window.innerWidth - 250), top: Math.min(hover.y + 14, window.innerHeight - 200) }}
        >
          <div className="flex justify-between gap-3 font-semibold text-slate-100 mb-1.5">
            <span>{hover.row.ac} · {hover.row.acType}</span>
            <span className="text-slate-500 font-normal">{hover.row.bay}</span>
          </div>
          <div className="flex justify-between gap-4 text-slate-400"><span>Arrival</span><b className="text-slate-200 font-medium">{hover.row.arrNum ?? '—'} @ {fmt(hover.row.start)}</b></div>
          <div className="flex justify-between gap-4 text-slate-400"><span>Departure</span><b className="text-slate-200 font-medium">{hover.row.depNum ?? '—'} @ {fmt(hover.row.end)}</b></div>
          <div className="flex justify-between gap-4 text-slate-400"><span>Ground time</span><b className="text-slate-200 font-medium">{hover.row.end - hover.row.start} min</b></div>
          <div className="flex justify-between gap-4 text-slate-400"><span>Team(s)</span><b className="text-slate-200 font-medium">{hover.row.teamLabel}</b></div>
          <div className="flex justify-between gap-4 text-slate-400"><span>Cargo</span><b className="text-slate-200 font-medium">{hover.row.cargo ?? '—'} t · {hover.row.sets} set{hover.row.sets > 1 ? 's' : ''}</b></div>
          <div className="flex justify-between gap-4 text-slate-400"><span>Status</span><b className="text-slate-200 font-medium">{hover.row.status}</b></div>
          <hr className="my-1.5 border-slate-700" />
          {hover.row.conflict
            ? <div className="text-red-400 font-semibold">⚠ Staffing conflict flagged</div>
            : <div className="text-emerald-400 font-semibold">✓ No conflicts</div>}
        </div>
      )}
    </div>
  )
}
