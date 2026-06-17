"""Timefold AI planning domain for GTR Malaysia NB Ramp roster solver."""
from dataclasses import dataclass, field
from datetime import date as Date
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
class ShiftFact:
    id: int
    code: str           # S1-S4
    label: str
    start_time: str     # "05:00"
    end_time: str       # "15:00"
    duration_hours: int

    def __eq__(self, other):
        return isinstance(other, ShiftFact) and self.id == other.id

    def __hash__(self):
        return hash(self.id)


@dataclass
class StaffFact:
    id: int
    employee_id: str
    name: str
    role: str           # DM | RLS | RA
    team_id: int

    def __eq__(self, other):
        return isinstance(other, StaffFact) and self.id == other.id

    def __hash__(self):
        return hash(self.id)


@planning_entity
@dataclass
class StaffShiftAssignment:
    id: Annotated[int, PlanningId]
    staff: StaffFact
    date: Date
    # Integer day within the month (1-31). Used in constraints instead of date
    # arithmetic, because date subtraction is unreliable on JPype-proxied LocalDate
    # objects when Timefold evaluates lambdas on the Java side.
    day_of_month: int
    # None = OFF / MC / EL; one of ShiftFact = ON_DUTY
    assigned_shift: Annotated[
        Optional[ShiftFact],
        PlanningVariable(allows_unassigned=True, value_range_provider_refs=["shiftRange"]),
    ] = field(default=None)

    def __repr__(self) -> str:
        code = self.assigned_shift.code if self.assigned_shift else "OFF"
        return f"<{self.staff.employee_id} {self.date} {code}>"


@planning_solution
@dataclass
class RosterSolution:
    team_id: int
    year: int
    month: int

    # Problem facts — shifts double as the value range
    shifts: Annotated[
        list[ShiftFact],
        ProblemFactCollectionProperty,
        ValueRangeProvider(id="shiftRange"),
    ] = field(default_factory=list)

    staff_list: Annotated[
        list[StaffFact],
        ProblemFactCollectionProperty,
    ] = field(default_factory=list)

    # Planning entities
    assignments: Annotated[
        list[StaffShiftAssignment],
        PlanningEntityCollectionProperty,
    ] = field(default_factory=list)

    score: Annotated[Optional[HardSoftScore], PlanningScore] = field(default=None)
