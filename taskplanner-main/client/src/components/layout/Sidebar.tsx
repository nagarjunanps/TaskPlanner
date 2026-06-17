import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Users, Calendar, ClipboardCheck, Clock,
  Plane, Award, UserCircle, List, ClipboardList,
  Shield, ChevronDown, X,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'

// ── Nav structure ─────────────────────────────────────────────────────────────

interface NavItem  { to: string; icon: React.ComponentType<{ size?: number }>; label: string }
interface NavGroup { heading: string; items: NavItem[] }

const ADMIN_GROUPS: NavGroup[] = [
  {
    heading: 'Operations',
    items: [
      { to: '/',             icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/flights',      icon: List,            label: 'Flight Dashboard' },
      { to: '/task-planner', icon: Plane,           label: 'Task Planner' },
    ],
  },
  {
    heading: 'Workforce',
    items: [
      { to: '/staff',      icon: Users,          label: 'Staff' },
      { to: '/roster',     icon: Calendar,       label: 'Roster' },
      { to: '/attendance', icon: ClipboardCheck, label: 'Attendance' },
      { to: '/overtime',   icon: Clock,          label: 'Overtime' },
    ],
  },
  {
    heading: 'Compliance',
    items: [
      { to: '/certifications', icon: Award, label: 'Certifications' },
    ],
  },
  {
    heading: 'Admin Tools',
    items: [
      { to: '/my-view', icon: UserCircle, label: 'Staff View' },
    ],
  },
]

const STAFF_GROUPS: NavGroup[] = [
  {
    heading: 'My Schedule',
    items: [
      { to: '/my-tasks', icon: ClipboardList, label: 'My Tasks' },
      { to: '/my-shift', icon: Calendar,      label: 'My Shift Calendar' },
    ],
  },
]

// ── Collapsible group ─────────────────────────────────────────────────────────

function NavGroupSection({
  group, onClose, defaultOpen = true,
}: {
  group: NavGroup; onClose?: () => void; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
      >
        {group.heading}
        <ChevronDown
          size={11}
          className={`transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>

      {open && (
        <div>
          {group.items.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 pl-5 pr-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white font-medium border-r-2 border-red-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarProps { onClose?: () => void }

export default function Sidebar({ onClose }: SidebarProps) {
  const { user } = useAuth()
  const groups   = user?.is_admin ? ADMIN_GROUPS : STAFF_GROUPS

  return (
    <aside className="w-56 min-h-screen bg-slate-900 text-slate-100 flex flex-col">

      {/* Brand + close button (X only visible in drawer mode) */}
      <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0">
            <Plane size={14} className="text-red-400" />
          </div>
          <div>
            <div className="text-xs font-bold text-white leading-tight">GTR Malaysia</div>
            <div className="text-[10px] text-slate-400 leading-tight">Ramp NB Planner</div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded text-slate-500 hover:text-slate-300"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Role badge */}
      {user && (
        <div className="px-5 py-2.5 border-b border-slate-800">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
            user.is_admin
              ? 'bg-red-500/20 text-red-300'
              : 'bg-indigo-500/20 text-indigo-300'
          }`}>
            {user.is_admin ? 'Administrator' : `${user.role} — ${user.employee_id ?? ''}`}
          </span>
        </div>
      )}

      {/* Nav groups */}
      <nav className="flex-1 py-3 space-y-1 overflow-y-auto">
        {groups.map(group => (
          <NavGroupSection key={group.heading} group={group} onClose={onClose} />
        ))}
      </nav>
    </aside>
  )
}
