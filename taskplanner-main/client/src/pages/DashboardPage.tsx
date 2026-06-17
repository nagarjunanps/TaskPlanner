import { useQuery } from '@tanstack/react-query'
import { getTeams, getStaff } from '../api/client'
import { Users, Layers, CheckCircle, AlertCircle } from 'lucide-react'

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof Users; label: string; value: number | string; sub?: string; color: string
}) {
  return (
    <div className="bg-white rounded-xl border p-5 flex gap-4 items-start">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => getTeams() })
  const { data: allStaff = [] } = useQuery({ queryKey: ['staff-all'], queryFn: () => getStaff({ active: true }) })

  const totalStaff = allStaff.length
  const totalDMs = allStaff.filter(s => s.role === 'DM').length
  const totalRLS = allStaff.filter(s => s.role === 'RLS').length
  const totalRA = allStaff.filter(s => s.role === 'RA').length
  const teamsWithFullComposition = teams.filter(t => t.dm_count >= 1 && t.rls_count >= 12 && t.ra_count >= 40).length

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Operations Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">GTR Malaysia · Ramp NB Department</p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={Layers} label="NB Teams" value={teams.length} sub="Narrowbody Ramp" color="bg-blue-500" />
        <StatCard icon={Users} label="Active Staff" value={totalStaff} sub={`DM:${totalDMs} · RLS:${totalRLS} · RA:${totalRA}`} color="bg-indigo-500" />
        <StatCard icon={CheckCircle} label="Teams at Full Strength" value={teamsWithFullComposition} sub="≥1 DM + 12 RLS + 40 RA" color="bg-emerald-500" />
        <StatCard icon={AlertCircle} label="Teams Below Strength" value={teams.length - teamsWithFullComposition} sub="Need staffing" color="bg-amber-500" />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-600 mb-3">Team Composition</h2>
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Team</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">DM</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">RLS</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">RA</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Total</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {teams.map(t => {
                const full = t.dm_count >= 1 && t.rls_count >= 12 && t.ra_count >= 40
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-700">{t.code} — {t.name}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={t.dm_count >= 1 ? 'text-emerald-600' : 'text-red-600'}>{t.dm_count}/1</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={t.rls_count >= 12 ? 'text-emerald-600' : 'text-red-600'}>{t.rls_count}/12</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={t.ra_count >= 40 ? 'text-emerald-600' : 'text-red-600'}>{t.ra_count}/40</span>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">{t.dm_count + t.rls_count + t.ra_count}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${full ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {full ? 'Full' : 'Understaffed'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-2">Constraint Rules Active</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-blue-700">
          {[
            'H1: 4-ON / 2-OFF rotation', 'H2: 4 teams on duty per day',
            'H3: Max 3 consecutive same shift', 'H5: Max 12 hours/day',
            'H6: Min 8h rest between shifts', 'H7: OT volunteer cap (6 slots)',
            'H9: Weekly shift block rotation', 'H10: Role composition per team',
            'H11: Min 2 runners per duty day', 'H12: Runners cover MC absences',
          ].map(r => (
            <div key={r} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
              {r}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
