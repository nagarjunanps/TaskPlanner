import type { EntryType } from '../../api/types'

interface Props {
  entryType: EntryType
  shiftCode?: string | null
  isRunner?: boolean
}

const SHIFT_COLORS: Record<string, string> = {
  S1: 'bg-blue-100 text-blue-800 border-blue-300',
  S2: 'bg-green-100 text-green-800 border-green-300',
  S3: 'bg-amber-100 text-amber-800 border-amber-300',
  S4: 'bg-purple-100 text-purple-800 border-purple-300',
}

const TYPE_COLORS: Record<EntryType, string> = {
  ON_DUTY: 'bg-slate-100 text-slate-700 border-slate-300',
  OFF:     'bg-gray-50 text-gray-400 border-gray-200',
  MC:      'bg-red-100 text-red-700 border-red-300',
  EL:      'bg-teal-100 text-teal-700 border-teal-300',
  OT:      'bg-orange-100 text-orange-700 border-orange-300',
}

export default function EntryBadge({ entryType, shiftCode, isRunner }: Props) {
  if (entryType === 'OFF') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs border bg-gray-50 text-gray-400 border-gray-200">
        OFF
      </span>
    )
  }

  if (entryType === 'MC') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs border bg-red-100 text-red-700 border-red-300 font-medium">
        MC
      </span>
    )
  }

  if (entryType === 'EL') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs border bg-teal-100 text-teal-700 border-teal-300 font-medium">
        EL
      </span>
    )
  }

  if (entryType === 'OT') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border bg-orange-100 text-orange-700 border-orange-300 font-medium">
        {shiftCode ?? 'OT'}
        <span className="text-orange-500">+</span>
      </span>
    )
  }

  // ON_DUTY — show shift code with optional Runner indicator
  const colorClass = shiftCode ? (SHIFT_COLORS[shiftCode] ?? TYPE_COLORS.ON_DUTY) : TYPE_COLORS.ON_DUTY
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border font-medium ${colorClass} ${isRunner ? 'ring-1 ring-yellow-400' : ''}`}>
      {shiftCode ?? '?'}
      {isRunner && <span className="text-yellow-600 font-bold">R</span>}
    </span>
  )
}
