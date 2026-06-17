import { type ReactNode, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import Sidebar from './components/layout/Sidebar'
import TopBar  from './components/layout/TopBar'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import StaffPage from './pages/StaffPage'
import RosterPage from './pages/RosterPage'
import AttendancePage from './pages/AttendancePage'
import OvertimePage from './pages/OvertimePage'
import TaskPlannerPage from './pages/TaskPlannerPage'
import CertificationsPage from './pages/CertificationsPage'
import StaffViewPage from './pages/StaffViewPage'
import FlightListPage from './pages/FlightListPage'
import StaffShiftPage from './pages/StaffShiftPage'
import StaffTasksPage from './pages/StaffTasksPage'

// Render's free-tier backend spins down when idle and can take 30-50s to
// wake up, which exceeds Netlify's fixed ~30s proxy timeout (504). Retrying
// a few times with backoff rides out that cold-start window. Only retry on
// 502/503/504 or no response (network/timeout) — not on 4xx, since those
// are real errors and mutations may have already succeeded server-side.
function isColdStartError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status
  return status === undefined || status === 502 || status === 503 || status === 504
}
const coldStartRetryDelay = (attempt: number) => Math.min(3000 * (attempt + 1), 10_000)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => failureCount < 3 && isColdStartError(error),
      retryDelay: coldStartRetryDelay,
      staleTime: 30_000,
    },
    mutations: {
      retry: (failureCount, error) => failureCount < 3 && isColdStartError(error),
      retryDelay: coldStartRetryDelay,
    },
  },
})

// ── Route guards ──────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
      Loading…
    </div>
  )
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (!user.is_admin) return <Navigate to="/my-tasks" replace />
  return <>{children}</>
}

function RequireStaff({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (user.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

// ── Authenticated layout shell ────────────────────────────────────────────────

function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen">

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed drawer on mobile, static column on desktop */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50 lg:z-auto shrink-0
        transition-transform duration-250 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main column (TopBar + page content) */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenuToggle={() => setSidebarOpen(v => !v)} />
        <main className="flex-1 overflow-auto bg-slate-50">
          {children}
        </main>
      </div>
    </div>
  )
}

// ── Routes ────────────────────────────────────────────────────────────────────

function AppRoutes() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <Spinner />

  return (
    <Routes>
      {/* Public */}
      <Route
        path="/login"
        element={
          user
            ? <Navigate to={user.is_admin ? '/' : '/my-tasks'} replace />
            : <LoginPage />
        }
      />

      {/* ── Staff-only pages ──────────────────────────────────────── */}
      <Route path="/my-tasks" element={
        <RequireStaff><AppShell><StaffTasksPage /></AppShell></RequireStaff>
      } />
      <Route path="/my-shift" element={
        <RequireStaff><AppShell><StaffShiftPage /></AppShell></RequireStaff>
      } />

      {/* ── Admin-only pages ──────────────────────────────────────── */}
      <Route path="/" element={
        <RequireAdmin><AppShell><DashboardPage /></AppShell></RequireAdmin>
      } />
      <Route path="/staff" element={
        <RequireAdmin><AppShell><StaffPage /></AppShell></RequireAdmin>
      } />
      <Route path="/roster" element={
        <RequireAdmin><AppShell><RosterPage /></AppShell></RequireAdmin>
      } />
      <Route path="/attendance" element={
        <RequireAdmin><AppShell><AttendancePage /></AppShell></RequireAdmin>
      } />
      <Route path="/overtime" element={
        <RequireAdmin><AppShell><OvertimePage /></AppShell></RequireAdmin>
      } />
      <Route path="/task-planner" element={
        <RequireAdmin><AppShell><TaskPlannerPage /></AppShell></RequireAdmin>
      } />
      <Route path="/certifications" element={
        <RequireAdmin><AppShell><CertificationsPage /></AppShell></RequireAdmin>
      } />
      <Route path="/flights" element={
        <RequireAdmin><AppShell><FlightListPage /></AppShell></RequireAdmin>
      } />
      <Route path="/my-view" element={
        <RequireAdmin><AppShell><StaffViewPage /></AppShell></RequireAdmin>
      } />

      {/* Catch-all */}
      <Route path="*" element={
        <Navigate to={user ? (user.is_admin ? '/' : '/my-tasks') : '/login'} replace />
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
