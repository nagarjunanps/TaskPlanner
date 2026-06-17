import { useEffect, useState } from 'react'
import { getSolverStatus } from '../../api/client'
import type { SolverStatus } from '../../api/types'

interface Props {
  jobId: string
  onComplete: (status: SolverStatus) => void
}

export default function SolverProgress({ jobId, onComplete }: Props) {
  const [status, setStatus] = useState<SolverStatus | null>(null)

  useEffect(() => {
    let stopped = false

    const poll = async () => {
      while (!stopped) {
        try {
          const s = await getSolverStatus(jobId)
          setStatus(s)
          if (s.status !== 'SOLVING') {
            onComplete(s)
            return
          }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    poll()
    return () => { stopped = true }
  }, [jobId, onComplete])

  if (!status) return <div className="text-sm text-slate-500 animate-pulse">Starting solver…</div>

  const isRunning = status.status === 'SOLVING'
  const statusColor = status.status === 'SOLVING_COMPLETED' ? 'text-emerald-600'
    : status.status === 'ERROR' ? 'text-red-600'
    : 'text-slate-600'

  return (
    <div className="border rounded-lg bg-white px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Timefold AI Solver</span>
        <span className={`text-xs font-medium ${statusColor}`}>{status.status.replace('_', ' ')}</span>
      </div>

      {isRunning && (
        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
          <div className="bg-blue-500 h-1.5 rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      )}

      <div className="flex gap-4 text-xs text-slate-500">
        {status.best_score && (
          <span>Score: <code className="text-slate-700">{status.best_score}</code></span>
        )}
        {status.time_spent_seconds != null && (
          <span>{status.time_spent_seconds.toFixed(1)}s elapsed</span>
        )}
      </div>

      {status.error && (
        <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{status.error}</div>
      )}
    </div>
  )
}
