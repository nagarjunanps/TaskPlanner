"""Timefold planning domain for the daily task/turnaround assignment solver."""
from dataclasses import dataclass, field
from typing import Annotated, Optional

from timefold.solver.domain import (
    PlanningEntityCollectionProperty,
    PlanningId,
    PlanningScore,
    PlanningVariable,
    ProblemFactCollectionProperty,
    ValueRangeProvider,
    planning_entity,
    planning_solution,
)
from timefold.solver.score import HardSoftScore


@dataclass
class TaskStaffFact:
    id: int
    employee_id: str
    name: str
    role: str               # DM | RLS | RA
    team_id: int
    is_driver_qualified: bool
    is_tower_qualified: bool
    is_runner: bool
    break_group: int = 0    # 0 = first half, 1 = second half of break window

    def __eq__(self, other):
        return isinstance(other, TaskStaffFact) and self.id == other.id

    def __hash__(self):
        return hash(self.id)


@dataclass
class TurnaroundFact:
    id: int
    aircraft_registration: str
    arrival_flight_number: str
    departure_flight_number: str
    # Minutes from midnight (int) to avoid JPype date-arithmetic issues
    sta_minutes: int   # STA = scheduled time of arrival
    std_minutes: int   # STD = scheduled time of departure
    required_sets: int
    # Bay and sector info for travel-time and locality constraints
    bay: str = ""           # e.g. "J01", "L12"
    bay_sector: str = ""    # leading letter: "J", "L", "P", "Q"
    # -1 = outside break window; 0 = first 30 min half; 1 = second 30 min half
    break_half: int = -1

    def __eq__(self, other):
        return isinstance(other, TurnaroundFact) and self.id == other.id

    def __hash__(self):
        return hash(self.id)


@planning_entity
@dataclass
class RoleSlot:
    id: Annotated[int, PlanningId]
    turnaround: TurnaroundFact
    task_role: str       # RLS | TOWER | DRIVER | LOADER
    set_number: int      # 0 for RLS/TOWER; 1..required_sets for DRIVER/LOADER
    slot_index: int      # 1 for RLS/TOWER/DRIVER; 1-3 for LOADERs within a set

    staff: Annotated[
        Optional[TaskStaffFact],
        PlanningVariable(allows_unassigned=True, value_range_provider_refs=["staffRange"]),
    ] = field(default=None)

    def __repr__(self) -> str:
        name = self.staff.employee_id if self.staff else "UNASSIGNED"
        return f"<RoleSlot {self.task_role} set={self.set_number}[{self.slot_index}] ta={self.turnaround.id} → {name}>"


@planning_solution
@dataclass
class TaskPlanSolution:
    team_id: int
    date: str

    turnarounds: Annotated[
        list[TurnaroundFact],
        ProblemFactCollectionProperty,
    ] = field(default_factory=list)

    staff_list: Annotated[
        list[TaskStaffFact],
        ProblemFactCollectionProperty,
        ValueRangeProvider(id="staffRange"),
    ] = field(default_factory=list)

    slots: Annotated[
        list[RoleSlot],
        PlanningEntityCollectionProperty,
    ] = field(default_factory=list)

    score: Annotated[Optional[HardSoftScore], PlanningScore] = field(default=None)
