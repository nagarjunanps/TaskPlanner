import axios from 'axios'

export interface LoginResponse {
  access_token: string
  token_type:   string
  is_admin:     boolean
  name:         string
  employee_id:  string
}
import type {
  CertificationType,
  Department,
  Flight,
  FlightImpact,
  OTVolunteer,
  Roster,
  RosterEntry,
  Shift,
  SolverStatus,
  Staff,
  StaffCertification,
  StaffRosterDay,
  StaffTask,
  SubDepartment,
  TaskAssignment,
  TaskSolverStatus,
  TaskValidation,
  Team,
  TeamMonthSummary,
  Turnaround,
  ValidationResult,
} from './types'

const api = axios.create({ baseURL: '/api' })

// Attach JWT on every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('gtr_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401, clear token and redirect to login
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('gtr_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const loginUser = (employee_id: string, password: string) =>
  api.post<LoginResponse>('/auth/login', { employee_id, password }).then(r => r.data)

// ── Org ───────────────────────────────────────────────────────────────────────
export const getDepartments = () => api.get<Department[]>('/departments').then(r => r.data)
export const getSubDepartments = (params?: { department_id?: number }) =>
  api.get<SubDepartment[]>('/subdepartments', { params }).then(r => r.data)

// ── Teams ─────────────────────────────────────────────────────────────────────
export const getTeams = (params?: { sub_department_id?: number }) =>
  api.get<Team[]>('/teams', { params }).then(r => r.data)
export const createTeam = (data: { code: string; name: string; sub_department_id: number }) =>
  api.post<Team>('/teams', data).then(r => r.data)

// ── Staff ─────────────────────────────────────────────────────────────────────
export const getStaff = (params?: { team_id?: number; role?: string; active?: boolean }) =>
  api.get<Staff[]>('/staff', { params }).then(r => r.data)
export const createStaff = (data: Omit<Staff, 'id' | 'is_active'>) =>
  api.post<Staff>('/staff', data).then(r => r.data)
export const updateStaff = (id: number, data: Partial<Staff>) =>
  api.put<Staff>(`/staff/${id}`, data).then(r => r.data)
export const deactivateStaff = (id: number) => api.delete(`/staff/${id}`)
export const getStaffTasks = (staffId: number, date: string) =>
  api.get<StaffTask[]>(`/staff/${staffId}/tasks`, { params: { date } }).then(r => r.data)
export const getStaffRoster = (staffId: number, year: number, month: number) =>
  api.get<StaffRosterDay[]>(`/staff/${staffId}/roster`, { params: { year, month } }).then(r => r.data)

// ── Shifts ────────────────────────────────────────────────────────────────────
export const getShifts = () => api.get<Shift[]>('/shifts').then(r => r.data)

// ── Rosters ───────────────────────────────────────────────────────────────────
export const getRosters = (params?: { team_id?: number; year?: number; month?: number }) =>
  api.get<Roster[]>('/rosters', { params }).then(r => r.data)
export const getRoster = (id: number) => api.get<Roster>(`/rosters/${id}`).then(r => r.data)
export const createRoster = (data: { team_id: number; year: number; month: number }) =>
  api.post<Roster>('/rosters', data).then(r => r.data)
export const bulkUpdateEntries = (rosterId: number, updates: Array<{ entry_id: number } & Partial<RosterEntry>>) =>
  api.put<Roster>(`/rosters/${rosterId}/entries`, { updates }).then(r => r.data)
export const publishRoster = (id: number) =>
  api.post<Roster>(`/rosters/${id}/publish`).then(r => r.data)
export const setTeamDay = (rosterId: number, date: string, shiftId: number | null) =>
  api.put<Roster>(`/rosters/${rosterId}/team-day`, { date, shift_id: shiftId }).then(r => r.data)

// ── Roster Overview ───────────────────────────────────────────────────────────
export const getRosterOverview = (year: number, month: number, subDeptCode = 'NB') =>
  api.get<TeamMonthSummary[]>('/rosters/overview', { params: { year, month, sub_dept_code: subDeptCode } }).then(r => r.data)
export const initializeAllTeams = (year: number, month: number, subDeptCode = 'NB') =>
  api.post('/rosters/initialize-all', null, { params: { year, month, sub_dept_code: subDeptCode } }).then(r => r.data)
export const generateRotation = (year: number, month: number, subDeptCode = 'NB') =>
  api.post('/rosters/generate-rotation', null, { params: { year, month, sub_dept_code: subDeptCode } }).then(r => r.data)

// ── Solver ────────────────────────────────────────────────────────────────────
export const startSolver = (roster_id: number) =>
  api.post<SolverStatus>('/solver/start', { roster_id }).then(r => r.data)
export const getSolverStatus = (job_id: string) =>
  api.get<SolverStatus>(`/solver/status/${job_id}`).then(r => r.data)
export const stopSolver = (job_id: string) =>
  api.post<SolverStatus>(`/solver/stop/${job_id}`).then(r => r.data)
export const validateRoster = (roster_id: number) =>
  api.post<ValidationResult>(`/solver/validate/${roster_id}`).then(r => r.data)

// ── Attendance ────────────────────────────────────────────────────────────────
export const getAttendance = (date: string, team_id: number) =>
  api.get<RosterEntry[]>('/attendance', { params: { date, team_id } }).then(r => r.data)
export const updateAttendance = (entry_id: number, data: Partial<RosterEntry>) =>
  api.put<RosterEntry>(`/attendance/${entry_id}`, data).then(r => r.data)

// ── Overtime ──────────────────────────────────────────────────────────────────
export const getOTVolunteers = (date: string) =>
  api.get<OTVolunteer[]>('/overtime/volunteers', { params: { date } }).then(r => r.data)
export const signupOT = (staff_id: number, shift_id: number, date: string) =>
  api.post<OTVolunteer>('/overtime/volunteers', { staff_id, shift_id, date }).then(r => r.data)
export const approveOT = (id: number, approver_id: number) =>
  api.put<OTVolunteer>(`/overtime/volunteers/${id}/approve`, null, { params: { approver_id } }).then(r => r.data)
export const rejectOT = (id: number) =>
  api.put<OTVolunteer>(`/overtime/volunteers/${id}/reject`).then(r => r.data)

// ── Flights / Turnarounds ─────────────────────────────────────────────────────
export const getTurnarounds = (date: string, station = 'KUL') =>
  api.get<Turnaround[]>('/flights/turnarounds', { params: { date, station } }).then(r => r.data)
export const updateTurnaround = (id: number, data: { cargo_weight_tons?: number | null; required_sets?: number; arrival_required_sets?: number; departure_required_sets?: number }) =>
  api.put<Turnaround>(`/flights/turnarounds/${id}`, data).then(r => r.data)
export const getFlights = (date: string, station = 'KUL') =>
  api.get<Flight[]>('/flights', { params: { date, station } }).then(r => r.data)
export const updateFlight = (id: number, data: { scheduled_time?: string; estimated_time?: string; bay?: string; status?: string }) =>
  api.put<Flight>(`/flights/${id}`, data).then(r => r.data)
export const checkFlightImpact = (id: number, currentTime: string) =>
  api.post<FlightImpact>(`/flights/${id}/check-impact`, null, { params: { current_time: currentTime } }).then(r => r.data)

// ── Task Planner ──────────────────────────────────────────────────────────────
export const startTaskSolve = (team_id: number, date: string, replan_from_time?: string) =>
  api.post<TaskSolverStatus>('/task-planner/solve', { team_id, date, replan_from_time }).then(r => r.data)
export const startAllTeamsSolve = (date: string) =>
  api.post<TaskSolverStatus[]>('/task-planner/solve-all', { date }).then(r => r.data)
export const getTaskSolveStatus = (job_id: string) =>
  api.get<TaskSolverStatus>(`/task-planner/status/${job_id}`).then(r => r.data)
export const stopTaskSolve = (job_id: string) =>
  api.post(`/task-planner/stop/${job_id}`).then(r => r.data)
export const getTaskAssignments = (date: string, team_id?: number) =>
  api.get<TaskAssignment[]>('/task-planner/assignments', { params: { date, team_id } }).then(r => r.data)
export const updateTaskAssignment = (id: number, staff_id: number | null) =>
  api.put<TaskAssignment>(`/task-planner/assignments/${id}`, { staff_id }).then(r => r.data)
export const validateTaskAssignments = (date: string) =>
  api.get<TaskValidation>('/task-planner/validate', { params: { date } }).then(r => r.data)

// ── Certifications ────────────────────────────────────────────────────────────
export const getCertificationTypes = () =>
  api.get<CertificationType[]>('/certifications/types').then(r => r.data)
export const getStaffCertifications = (params?: {
  staff_id?: number
  status?: string
  expiring_within_days?: number
}) => api.get<StaffCertification[]>('/certifications', { params }).then(r => r.data)
export const updateCertification = (id: number, data: { issued_date?: string; expiry_date?: string; status?: string }) =>
  api.put<StaffCertification>(`/certifications/${id}`, data).then(r => r.data)
