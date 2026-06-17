import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plane, Lock, User, AlertCircle, Eye, EyeOff,
  ChevronRight, Shield, Users, ChevronDown,
} from 'lucide-react'
import { loginUser } from '../api/client'
import { useAuth } from '../context/AuthContext'

// ── Demo accounts ─────────────────────────────────────────────────────────────

const DEMO_ACCOUNTS = [
  {
    group:       'Admin',
    icon:        'shield' as const,
    employee_id: 'ADMIN001',
    password:    'admin123',
    name:        'Administrator',
    access:      'Full management access',
    color:       'border-red-200 bg-red-50 hover:bg-red-100',
    badge:       'bg-red-100 text-red-700',
  },
  {
    group:       'Duty Manager',
    icon:        'users' as const,
    employee_id: 'T1-DM-001',
    password:    'T1-DM-001',
    name:        'DM T1 1  (Team 1)',
    access:      'My Tasks · My Shift',
    color:       'border-violet-200 bg-violet-50 hover:bg-violet-100',
    badge:       'bg-violet-100 text-violet-700',
  },
  {
    group:       'Ramp Lead (RLS)',
    icon:        'users' as const,
    employee_id: 'T1-RLS-001',
    password:    'T1-RLS-001',
    name:        'RLS T1 1  (Team 1)',
    access:      'My Tasks · My Shift',
    color:       'border-blue-200 bg-blue-50 hover:bg-blue-100',
    badge:       'bg-blue-100 text-blue-700',
  },
  {
    group:       'Ramp Agent (RA)',
    icon:        'users' as const,
    employee_id: 'T1-RA-001',
    password:    'T1-RA-001',
    name:        'RA T1 1  (Team 1)',
    access:      'My Tasks · My Shift',
    color:       'border-emerald-200 bg-emerald-50 hover:bg-emerald-100',
    badge:       'bg-emerald-100 text-emerald-700',
  },
]

// ── Login page ─────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login }  = useAuth()
  const navigate   = useNavigate()

  const [employeeId, setEmployeeId] = useState('')
  const [password,   setPassword]   = useState('')
  const [showPw,     setShowPw]     = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [demoOpen,   setDemoOpen]   = useState(false)

  async function doLogin(emp: string, pw: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await loginUser(emp.trim(), pw)
      login(res.access_token)
      navigate(res.is_admin ? '/' : '/my-tasks', { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail ?? 'Login failed. Check your credentials.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!employeeId.trim() || !password.trim()) {
      setError('Please enter your Employee ID and password.')
      return
    }
    doLogin(employeeId, password)
  }

  function fillForm(emp: string, pw: string) {
    setEmployeeId(emp)
    setPassword(pw)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-4 sm:p-6">

      <div className="w-full max-w-sm">

        {/* ── Brand ── */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 mb-4 shadow-lg">
            <Plane size={30} className="text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">GTR Malaysia</h1>
          <p className="text-slate-400 text-sm mt-1">Ramp NB Task Planner</p>
        </div>

        {/* ── Login card ── */}
        <div className="bg-white/8 backdrop-blur border border-white/12 rounded-2xl p-7 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Employee ID */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Employee ID
              </label>
              <div className="relative">
                <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="e.g. T1-RLS-001"
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  className="w-full pl-9 pr-3.5 py-3 bg-white/10 border border-white/20 rounded-xl text-white
                             placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/50
                             focus:border-red-400/50 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type={showPw ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full pl-9 pr-10 py-3 bg-white/10 border border-white/20 rounded-xl text-white
                             placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/50
                             focus:border-red-400/50 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3.5 py-3 text-xs text-red-300">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-red-500 hover:bg-red-600 active:bg-red-700 disabled:opacity-60
                         text-white font-semibold rounded-xl text-sm transition-colors
                         flex items-center justify-center gap-2 mt-2 shadow-lg shadow-red-500/20"
            >
              {loading && (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              )}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* ── Demo accounts (collapsible) ── */}
        <div className="mt-4 bg-white/5 backdrop-blur border border-white/10 rounded-2xl overflow-hidden shadow-xl">
          <button
            onClick={() => setDemoOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left"
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-semibold text-amber-300 uppercase tracking-widest">
                Demo Credentials
              </span>
            </div>
            <ChevronDown
              size={14}
              className={`text-slate-400 transition-transform duration-200 ${demoOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {demoOpen && (
            <div className="px-4 pb-4 space-y-3 border-t border-white/8 pt-3">
              <p className="text-xs text-slate-500 mb-3">
                Click a card to fill the credentials, then press Sign In.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {DEMO_ACCOUNTS.map(acc => (
                  <button
                    key={acc.employee_id}
                    onClick={() => { fillForm(acc.employee_id, acc.password); setDemoOpen(false) }}
                    disabled={loading}
                    className={`
                      text-left rounded-xl border p-3.5 transition-all disabled:opacity-50 group
                      ${acc.color}
                    `}
                  >
                    <div className="flex items-center justify-between gap-1 mb-2">
                      <div className="flex items-center gap-1.5">
                        {acc.icon === 'shield'
                          ? <Shield size={12} className="text-red-500 shrink-0" />
                          : <Users  size={12} className="text-slate-500 shrink-0" />}
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${acc.badge}`}>
                          {acc.group}
                        </span>
                      </div>
                      <ChevronRight size={12} className="text-slate-400 group-hover:text-slate-600 shrink-0" />
                    </div>
                    <div className="text-sm font-semibold text-slate-800 mb-1">{acc.name}</div>
                    <div className="flex items-center gap-1 text-xs text-slate-600">
                      <User size={9} className="shrink-0" />
                      <span className="font-mono">{acc.employee_id}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1.5 border-t border-slate-200/60 pt-1.5">
                      {acc.access}
                    </div>
                  </button>
                ))}
              </div>

              <p className="text-[10px] text-slate-500 pt-1">
                Staff password = Employee ID.&nbsp;
                More accounts: T1–T6 prefix, DM-001, RLS-001…012, RA-001…040.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
