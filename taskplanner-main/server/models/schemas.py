from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, model_validator

from models.db_models import (
    AssignmentSource, CertStatus, EntryType, FlightDirection,
    OTStatus, Role, RosterStatus, TaskRole,
)


# ── Department / SubDepartment ─────────────────────────────────────────────────

class DepartmentOut(BaseModel):
    id: int
    code: str
    name: str
    model_config = {"from_attributes": True}

class SubDepartmentOut(BaseModel):
    id: int
    code: str
    name: str
    department_id: int
    model_config = {"from_attributes": True}


# ── Team ─────────────────────────────────────────────────────────────────────

class TeamBase(BaseModel):
    code: str
    name: str
    sub_department_id: int

class TeamCreate(TeamBase):
    pass

class TeamOut(TeamBase):
    id: int
    dm_count: int = 0
    rls_count: int = 0
    ra_count: int = 0
    model_config = {"from_attributes": True}


# ── Staff ─────────────────────────────────────────────────────────────────────

class StaffBase(BaseModel):
    employee_id: str
    name: str
    role: Role
    team_id: int

class StaffCreate(StaffBase):
    pass

class StaffUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Role] = None
    team_id: Optional[int] = None
    is_active: Optional[bool] = None

class StaffOut(StaffBase):
    id: int
    is_active: bool
    model_config = {"from_attributes": True}


# ── Shift ─────────────────────────────────────────────────────────────────────

class ShiftOut(BaseModel):
    id: int
    code: str
    label: str
    start_time: str
    end_time: str
    duration_hours: int
    model_config = {"from_attributes": True}


# ── RosterEntry ───────────────────────────────────────────────────────────────

class RosterEntryOut(BaseModel):
    id: int
    staff_id: int
    date: date
    shift_id: Optional[int]
    entry_type: EntryType
    actual_entry_type: Optional[EntryType] = None
    effective_entry_type: EntryType = EntryType.OFF
    is_runner: bool
    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _compute_effective(self) -> "RosterEntryOut":
        self.effective_entry_type = self.actual_entry_type if self.actual_entry_type is not None else self.entry_type
        return self

class RosterEntryUpdate(BaseModel):
    entry_type: Optional[EntryType] = None
    shift_id: Optional[int] = None
    is_runner: Optional[bool] = None

class AttendanceEntryUpdate(BaseModel):
    actual_entry_type: Optional[EntryType] = None
    is_runner: Optional[bool] = None


# ── MonthlyRoster ─────────────────────────────────────────────────────────────

class RosterCreate(BaseModel):
    team_id: int
    year: int
    month: int

class RosterOut(BaseModel):
    id: int
    team_id: int
    year: int
    month: int
    status: RosterStatus
    entries: list[RosterEntryOut] = []
    model_config = {"from_attributes": True}

class BulkEntryUpdate(BaseModel):
    updates: list[dict]   # [{"entry_id": int, ...RosterEntryUpdate fields}]


# ── OTVolunteer ───────────────────────────────────────────────────────────────

class OTVolunteerCreate(BaseModel):
    staff_id: int
    date: date

class OTVolunteerOut(BaseModel):
    id: int
    staff_id: int
    date: date
    signed_up_at: datetime
    approved_by: Optional[int]
    status: OTStatus
    model_config = {"from_attributes": True}


# ── Solver ────────────────────────────────────────────────────────────────────

class SolverStartRequest(BaseModel):
    roster_id: int

class SolverStatusOut(BaseModel):
    job_id: str
    roster_id: int
    status: str   # SOLVING | SOLVING_COMPLETED | SOLVING_STOPPED | ERROR
    best_score: Optional[str] = None
    time_spent_seconds: Optional[float] = None
    error: Optional[str] = None


# ── Flight / Turnaround ───────────────────────────────────────────────────────

class FlightOut(BaseModel):
    id: int
    flight_number: str
    airline: str
    station: str
    scheduled_date: date
    direction: FlightDirection
    scheduled_time: str
    estimated_time: Optional[str] = None
    aircraft_registration: Optional[str] = None
    aircraft_type: str
    bay: Optional[str] = None
    cargo_weight_tons: Optional[float] = None
    status: str
    model_config = {"from_attributes": True}

class TurnaroundOut(BaseModel):
    id: int
    scheduled_date: date
    station: str
    aircraft_registration: Optional[str] = None
    arrival_flight_id: Optional[int] = None
    departure_flight_id: Optional[int] = None
    ground_time_minutes: Optional[int] = None
    cargo_weight_tons: Optional[float] = None
    required_sets: int
    arrival_flight: Optional[FlightOut] = None
    departure_flight: Optional[FlightOut] = None
    model_config = {"from_attributes": True}

class TurnaroundUpdate(BaseModel):
    cargo_weight_tons: Optional[float] = None
    required_sets: Optional[int] = None

class FlightUpdate(BaseModel):
    scheduled_time: Optional[str] = None   # "HH:MM" — use for major retime
    estimated_time: Optional[str] = None   # "HH:MM" — ops delay/early
    bay: Optional[str] = None
    status: Optional[str] = None

class ConflictInfo(BaseModel):
    staff_id: int
    staff_name: str
    conflict_type: str   # "double_booking" | "travel_gap"
    description: str
    turnaround_id: int

class FlightImpactOut(BaseModel):
    flight_id: int
    turnaround_id: Optional[int] = None
    conflicts: list[ConflictInfo] = []
    should_replan: bool = False
    llm_reason: str = ""
    llm_urgency: str = "low"   # "high" | "medium" | "low"
    upcoming_count: int = 0


# ── TaskAssignment ────────────────────────────────────────────────────────────

class TaskAssignmentOut(BaseModel):
    id: int
    turnaround_id: int
    team_id: int
    task_role: TaskRole
    set_number: int
    slot_index: int
    staff_id: Optional[int] = None
    source: AssignmentSource
    staff_name: Optional[str] = None
    model_config = {"from_attributes": True}

class TaskAssignmentUpdate(BaseModel):
    staff_id: Optional[int] = None

class TaskSolveRequest(BaseModel):
    team_id: int
    date: date
    replan_from_time: Optional[str] = None   # "HH:MM" — only plan TAs with STA ≥ this time

class TaskSolveAllRequest(BaseModel):
    date: date

class SolveConflictOut(BaseModel):
    """A conflict found by the solver's own in-memory self-check, right after
    solving — distinct from AssignmentConflictOut, which comes from the
    DB-level /validate scan and references persisted assignment rows."""
    staff_id: int
    staff_name: str
    conflict_type: str   # "double_booking" | "multi_role_same_turnaround"
    description: str
    turnaround_id: int
    other_turnaround_id: Optional[int] = None

class TaskSolverStatusOut(BaseModel):
    job_id: str
    team_id: int
    date: str
    status: str
    best_score: Optional[str] = None
    time_spent_seconds: Optional[float] = None
    error: Optional[str] = None
    retry_count: int = 0
    total_slots: int = 0
    unassigned_count: int = 0
    conflicts: list[SolveConflictOut] = []
    diagnostic: Optional[str] = None
    # Set when this job is a joint solve for a shared overlap window between
    # two teams (pooled certified staff) rather than one team's own shift.
    pooled_with_team_id: Optional[int] = None


class AssignmentConflictOut(BaseModel):
    staff_id: int
    staff_name: str
    conflict_type: str   # "double_booking" | "travel_gap"
    description: str
    turnaround_id: int
    other_turnaround_id: int
    assignment_id: int
    other_assignment_id: int

class TaskValidationOut(BaseModel):
    date: str
    checked_assignments: int
    conflicts: list[AssignmentConflictOut] = []


# ── Roster Overview (team-level shift planning) ───────────────────────────────

class TeamDaySummaryOut(BaseModel):
    date: str
    shift_code: Optional[str] = None   # None = OFF or no roster
    on_duty_count: int = 0
    total_staff: int = 0

class TeamMonthSummaryOut(BaseModel):
    team_id: int
    team_code: str
    team_name: str
    roster_id: Optional[int] = None
    status: Optional[RosterStatus] = None
    days: list[TeamDaySummaryOut] = []

class TeamDayUpdate(BaseModel):
    date: date
    shift_id: Optional[int] = None   # None = mark as OFF


# ── Staff personal view ───────────────────────────────────────────────────────

class StaffTaskOut(BaseModel):
    assignment_id: int
    turnaround_id: int
    task_role: TaskRole
    set_number: int
    slot_index: int
    aircraft_registration: Optional[str] = None
    aircraft_type: Optional[str] = None
    bay: Optional[str] = None
    arr_flight_number: Optional[str] = None
    arr_time: Optional[str] = None
    dep_flight_number: Optional[str] = None
    dep_time: Optional[str] = None
    ground_time_minutes: Optional[int] = None

class StaffRosterDayOut(BaseModel):
    date: str
    entry_type: EntryType
    shift_code: Optional[str] = None
    shift_label: Optional[str] = None
    is_runner: bool


# ── Certifications ────────────────────────────────────────────────────────────

class CertificationTypeOut(BaseModel):
    id: int
    code: str
    name: str
    model_config = {"from_attributes": True}

class StaffCertificationOut(BaseModel):
    id: int
    staff_id: int
    cert_type_id: int
    issued_date: date
    expiry_date: date
    status: CertStatus
    cert_type: Optional[CertificationTypeOut] = None
    staff_name: Optional[str] = None
    model_config = {"from_attributes": True}

class StaffCertificationUpdate(BaseModel):
    issued_date: Optional[date] = None
    expiry_date: Optional[date] = None
    status: Optional[CertStatus] = None
