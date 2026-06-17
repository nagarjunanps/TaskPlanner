export type Role = 'DM' | 'RLS' | 'RA'
export type RosterStatus = 'DRAFT' | 'SOLVING' | 'PUBLISHED'
export type EntryType = 'ON_DUTY' | 'OFF' | 'MC' | 'EL' | 'OT'
export type OTStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type SolverJobStatus = 'SOLVING' | 'SOLVING_COMPLETED' | 'SOLVING_STOPPED' | 'ERROR'

export interface Department {
  id: number
  code: string
  name: string
}

export interface SubDepartment {
  id: number
  code: string
  name: string
  department_id: number
}

export interface Team {
  id: number
  code: string
  name: string
  sub_department_id: number
  dm_count: number
  rls_count: number
  ra_count: number
}

export interface Staff {
  id: number
  employee_id: string
  name: string
  role: Role
  team_id: number
  is_active: boolean
}

export interface Shift {
  id: number
  code: string
  label: string
  start_time: string
  end_time: string
  duration_hours: number
}

export interface RosterEntry {
  id: number
  staff_id: number
  date: string
  shift_id: number | null
  entry_type: EntryType
  actual_entry_type: EntryType | null
  effective_entry_type: EntryType
  is_runner: boolean
}

export interface Roster {
  id: number
  team_id: number
  year: number
  month: number
  status: RosterStatus
  entries: RosterEntry[]
}

export interface OTVolunteer {
  id: number
  staff_id: number
  date: string
  signed_up_at: string
  approved_by: number | null
  status: OTStatus
}

export interface SolverStatus {
  job_id: string
  roster_id: number
  status: SolverJobStatus
  best_score: string | null
  time_spent_seconds: number | null
  error: string | null
}

export interface Violation {
  constraint: string
  severity: 'HARD' | 'SOFT'
  date: string
  message: string
}

export interface ValidationResult {
  roster_id: number
  violation_count: number
  hard_count: number
  soft_count: number
  violations: Violation[]
}

// ── Roster Overview ────────────────────────────────────────────────────────

export interface TeamDaySummary {
  date: string
  shift_code: string | null
  on_duty_count: number
  total_staff: number
}

export interface TeamMonthSummary {
  team_id: number
  team_code: string
  team_name: string
  roster_id: number | null
  status: RosterStatus | null
  days: TeamDaySummary[]
}

// ── Flight / Turnaround ────────────────────────────────────────────────────

export type FlightDirection = 'ARRIVAL' | 'DEPARTURE'
export type TaskRole = 'RLS' | 'TOWER' | 'DRIVER' | 'LOADER'
export type AssignmentSource = 'SOLVER' | 'MANUAL'
export type CertStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'SUSPENDED'
export type TaskSolverJobStatus = 'SOLVING' | 'SOLVING_COMPLETED' | 'SOLVING_STOPPED' | 'ERROR'

export interface Flight {
  id: number
  flight_number: string
  airline: string
  station: string
  scheduled_date: string
  direction: FlightDirection
  scheduled_time: string
  estimated_time: string | null
  aircraft_registration: string | null
  aircraft_type: string
  bay: string | null
  cargo_weight_tons: number | null
  status: string
}

export interface Turnaround {
  id: number
  scheduled_date: string
  station: string
  aircraft_registration: string | null
  arrival_flight_id: number | null
  departure_flight_id: number | null
  ground_time_minutes: number | null
  cargo_weight_tons: number | null
  required_sets: number
  arrival_flight: Flight | null
  departure_flight: Flight | null
}

export interface TaskAssignment {
  id: number
  turnaround_id: number
  team_id: number
  task_role: TaskRole
  set_number: number
  slot_index: number
  staff_id: number | null
  source: AssignmentSource
  staff_name: string | null
}

export interface SolveConflict {
  staff_id: number
  staff_name: string
  conflict_type: 'double_booking' | 'multi_role_same_turnaround'
  description: string
  turnaround_id: number
  other_turnaround_id: number | null
}

export interface TaskSolverStatus {
  job_id: string
  team_id: number
  date: string
  status: TaskSolverJobStatus
  best_score: string | null
  time_spent_seconds: number | null
  error: string | null
  retry_count: number
  total_slots: number
  unassigned_count: number
  conflicts: SolveConflict[]
  diagnostic: string | null
  pooled_with_team_id: number | null
}

export interface AssignmentConflict {
  staff_id: number
  staff_name: string
  conflict_type: 'double_booking' | 'travel_gap'
  description: string
  turnaround_id: number
  other_turnaround_id: number
  assignment_id: number
  other_assignment_id: number
}

export interface TaskValidation {
  date: string
  checked_assignments: number
  conflicts: AssignmentConflict[]
}

// ── Flight edit & impact ──────────────────────────────────────────────────────

export interface ConflictInfo {
  staff_id: number
  staff_name: string
  conflict_type: 'double_booking' | 'travel_gap'
  description: string
  turnaround_id: number
}

export interface FlightImpact {
  flight_id: number
  turnaround_id: number | null
  conflicts: ConflictInfo[]
  should_replan: boolean
  llm_reason: string
  llm_urgency: 'high' | 'medium' | 'low'
  upcoming_count: number
}

// ── Staff personal view ───────────────────────────────────────────────────────

export interface StaffTask {
  assignment_id: number
  turnaround_id: number
  task_role: TaskRole
  set_number: number
  slot_index: number
  aircraft_registration: string | null
  aircraft_type: string | null
  bay: string | null
  arr_flight_number: string | null
  arr_time: string | null
  dep_flight_number: string | null
  dep_time: string | null
  ground_time_minutes: number | null
}

export interface StaffRosterDay {
  date: string
  entry_type: EntryType
  shift_code: string | null
  shift_label: string | null
  is_runner: boolean
}

// ── Certifications ────────────────────────────────────────────────────────

export interface CertificationType {
  id: number
  code: string
  name: string
}

export interface StaffCertification {
  id: number
  staff_id: number
  cert_type_id: number
  issued_date: string
  expiry_date: string
  status: CertStatus
  cert_type: CertificationType | null
  staff_name: string | null
}
