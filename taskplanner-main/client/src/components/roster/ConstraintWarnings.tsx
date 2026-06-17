import type { Violation } from '../../api/types'
import { AlertTriangle, Info } from 'lucide-react'

interface Props {
  violations: Violation[]
  isLoading?: boolean
}

export default function ConstraintWarnings({ violations, isLoading }: Props) {
  const hard = violations.filter(v => v.severity === 'HARD')
  const soft = violations.filter(v => v.severity === 'SOFT')

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Constraint Violations</span>
        <span className="text-xs text-slate-500">
          {hard.length} hard · {soft.length} soft
        </span>
      </div>

      {isLoading && (
        <div className="px-4 py-6 text-center text-sm text-slate-400">Validating…</div>
      )}

      {!isLoading && violations.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-emerald-600 font-medium">
          ✓ No violations — ready to publish
        </div>
      )}

      {!isLoading && violations.length > 0 && (
        <div className="divide-y max-h-80 overflow-y-auto">
          {hard.map((v, i) => (
            <div key={i} className="flex gap-2 px-4 py-2.5">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <span className="text-xs font-semibold text-red-600 mr-1">[{v.constraint}]</span>
                <span className="text-xs text-slate-700">{v.message}</span>
              </div>
            </div>
          ))}
          {soft.map((v, i) => (
            <div key={i} className="flex gap-2 px-4 py-2.5">
              <Info size={14} className="text-amber-500 mt-0.5 shrink-0" />
              <div>
                <span className="text-xs font-semibold text-amber-600 mr-1">[{v.constraint}]</span>
                <span className="text-xs text-slate-700">{v.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
