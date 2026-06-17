import { Menu, LogOut, Shield, Plane } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

interface Props {
  onMenuToggle: () => void
}

export default function TopBar({ onMenuToggle }: Props) {
  const { user, logout } = useAuth()
  const navigate         = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 sticky top-0 z-30 shrink-0">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuToggle}
        className="lg:hidden p-2 -ml-1 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
        aria-label="Toggle menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile brand (hidden on desktop — sidebar shows it) */}
      <div className="flex lg:hidden items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-red-500/20 border border-red-500/30 flex items-center justify-center">
          <Plane size={12} className="text-red-400" />
        </div>
        <span className="text-sm font-bold text-slate-800">GTR Malaysia</span>
      </div>

      <div className="flex-1" />

      {/* User info + sign out */}
      {user && (
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Name + role (desktop / large mobile) */}
          <div className="hidden sm:flex flex-col items-end min-w-0">
            <span className="text-xs font-semibold text-slate-700 leading-tight truncate max-w-36">
              {user.name}
            </span>
            <span className="text-[10px] text-slate-400 leading-tight truncate max-w-36">
              {user.is_admin ? 'Administrator' : `${user.role} · ${user.employee_id}`}
            </span>
          </div>

          {/* Avatar */}
          <div className={`
            w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0
            ${user.is_admin ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-indigo-700'}
          `}>
            {user.is_admin ? <Shield size={14} /> : user.name.charAt(0).toUpperCase()}
          </div>

          {/* Sign out */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-500
                       hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors
                       border border-slate-200"
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      )}
    </header>
  )
}
