import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePagination<T>(items: T[], pageSize = 25) {
  const [page, setPage] = useState(1)

  // Reset to first page whenever the source list changes
  useEffect(() => { setPage(1) }, [items.length])

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage   = Math.min(page, totalPages)
  const paged      = items.slice((safePage - 1) * pageSize, safePage * pageSize)

  return {
    page: safePage,
    setPage,
    totalPages,
    paged,
    total: items.length,
    pageSize,
    from: items.length === 0 ? 0 : (safePage - 1) * pageSize + 1,
    to:   Math.min(safePage * pageSize, items.length),
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  page:       number
  totalPages: number
  total:      number
  from:       number
  to:         number
  onPage:     (p: number) => void
  dark?:      boolean
}

export default function Pagination({ page, totalPages, total, from, to, onPage, dark = false }: Props) {
  if (totalPages <= 1) return null

  // Window of up to 5 page numbers centred on current page
  const pageNums: number[] = []
  const half = 2
  let start = Math.max(1, page - half)
  let end   = Math.min(totalPages, page + half)
  if (end - start < 4) {
    if (start === 1) end   = Math.min(totalPages, start + 4)
    else             start = Math.max(1, end - 4)
  }
  for (let i = start; i <= end; i++) pageNums.push(i)

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-2">
      <span className={`text-xs order-2 sm:order-1 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        Showing <span className={`font-medium ${dark ? 'text-slate-200' : 'text-slate-700'}`}>{from}–{to}</span> of{' '}
        <span className={`font-medium ${dark ? 'text-slate-200' : 'text-slate-700'}`}>{total}</span>
      </span>

      <div className="flex items-center gap-1 order-1 sm:order-2">
        <NavBtn dark={dark} onClick={() => onPage(1)}          disabled={page === 1}          title="First page">
          <ChevronsLeft size={14} />
        </NavBtn>
        <NavBtn dark={dark} onClick={() => onPage(page - 1)}   disabled={page === 1}          title="Previous">
          <ChevronLeft size={14} />
        </NavBtn>

        {start > 1 && (
          <>
            <PageBtn dark={dark} n={1} current={page} onPage={onPage} />
            {start > 2 && <span className={`text-xs px-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>…</span>}
          </>
        )}

        {pageNums.map(n => (
          <PageBtn key={n} dark={dark} n={n} current={page} onPage={onPage} />
        ))}

        {end < totalPages && (
          <>
            {end < totalPages - 1 && <span className={`text-xs px-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>…</span>}
            <PageBtn dark={dark} n={totalPages} current={page} onPage={onPage} />
          </>
        )}

        <NavBtn dark={dark} onClick={() => onPage(page + 1)}   disabled={page === totalPages} title="Next">
          <ChevronRight size={14} />
        </NavBtn>
        <NavBtn dark={dark} onClick={() => onPage(totalPages)} disabled={page === totalPages} title="Last page">
          <ChevronsRight size={14} />
        </NavBtn>
      </div>
    </div>
  )
}

function NavBtn({ onClick, disabled, title, children, dark }: {
  onClick: () => void; disabled: boolean; title: string; children: React.ReactNode; dark: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded-lg border disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs ${
        dark ? 'border-slate-700 text-slate-400 hover:bg-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

function PageBtn({ n, current, onPage, dark }: { n: number; current: number; onPage: (p: number) => void; dark: boolean }) {
  const active = n === current
  return (
    <button
      onClick={() => onPage(n)}
      className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-medium transition-colors border ${
        active
          ? 'bg-indigo-600 text-white border-indigo-600'
          : dark
            ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
            : 'border-slate-200 text-slate-600 hover:bg-slate-100'
        }`}
    >
      {n}
    </button>
  )
}
