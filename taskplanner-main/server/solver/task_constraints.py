"""Constraint provider for the daily task-assignment solver (GTR NB Ramp).

Constraint hierarchy
--------------------
HARD  H-T1   Role / certification must match slot type.
HARD  H-T5   No double-booking (overlapping work windows).
HARD  H-T6   One staff member can only fill one slot per turnaround.
HARD  H-T7   A turnaround running more than one loader set must have at
             least one driver assigned somewhere across its sets.
SOFT  S-T1   Minimise unassigned slots (non-RLS roles).
SOFT  S-T2   Balance assignments per staff (linear penalty beyond 8
             turnarounds/shift — a light tie-breaker, not a capacity cap).
SOFT  S-T3   Staggered meal break (60 min, later in the shift) — staff only
             penalised for turnarounds in their own break half.
SOFT  S-T4   Enforce minimum travel gap — penalise consecutive assignments
             to the same staff member when the gap is smaller than the
             bay-to-bay travel time. RLS gets a shorter required gap and an
             earlier window open (no pre-arrival buffer) since RLS routinely
             starts late or after the turnaround is already under way.
SOFT  S-T5   Bay locality — reward same bay-sector consecutive assignments.
SOFT  S-T6   Minimise unassigned RLS slots — weighted lower than S-T1
             because RLS is mandatory in principle but in practice
             turnarounds are routinely worked without one (RLS shows up
             late or not at all), so going unfilled is tolerated more.
SOFT  S-T7   Staggered tea break (30 min, earlier in the shift) — a second,
             independent break window from S-T3's meal break, placed at a
             different third of the shift so the two breaks land well apart
             instead of one stretched/doubled-up rest period.
"""
from timefold.solver.score import (
    Constraint,
    ConstraintCollectors,
    ConstraintFactory,
    HardSoftScore,
    Joiners,
    constraint_provider,
)

from solver.task_domain import RoleSlot

# KLIA T2 NB apron sector layout (linear): J — L — P — Q
_SECTOR_POS = {'J': 0, 'L': 1, 'P': 2, 'Q': 3}


def _travel_minutes(sector_a: str, sector_b: str, task_role: str = "") -> int:
    """Estimated walk/drive time between two bay sectors (minutes).

    Uses explicit equality checks to avoid JPyInterpreter __bool__ issues
    with string truthiness (``not sector_a`` is unsupported).

    RLS gets a shorter requirement — they're not tied to GSE/loader timing
    the same way, so a tighter back-to-back schedule is acceptable.
    """
    if sector_a == "" or sector_b == "" or sector_a == sector_b:
        base = 3   # same sector or unknown → short reposition
    else:
        pos_a = _SECTOR_POS.get(sector_a, 0)
        pos_b = _SECTOR_POS.get(sector_b, 0)
        dist = abs(pos_a - pos_b)
        if dist == 1:
            base = 8
        elif dist == 2:
            base = 12
        else:
            base = 15   # dist == 3 (J↔Q)
    return base // 2 if task_role == "RLS" else base


def _prep_buffer_minutes(task_role: str) -> int:
    """Minutes before STA a role is expected to already be at the bay.

    RLS routinely starts after the aircraft is already on chocks — or after
    the turnaround is already under way — so their window opens at STA
    itself rather than the standard 15-minute pre-arrival buffer every
    other role needs.
    """
    return 0 if task_role == "RLS" else 15


# ── Long-turnaround leg splitting ────────────────────────────────────────────
# A normal quick turn (30-45 min) is worked start-to-finish by one crew, so
# its slots cover the full [STA, STD] span. A long turnaround (e.g. a
# maintenance hold or late-cargo delay) can run for hours — long enough that
# the team on duty at arrival has gone off shift by departure. For those, the
# planner splits each role into an ARRIVAL-leg slot (worked near STA) and a
# DEPARTURE-leg slot (worked near STD), which can be filled by two different
# crews. See routers.task_planner._build_plan_data for the shift-window side
# of this and solver.task_solver_manager._build_task_problem for slot
# generation.
LONG_TURNAROUND_THRESHOLD_MIN = 55
ARRIVAL_LEG_MINUTES = 45    # how long arrival-leg work (unload/marshal) lasts
DEPARTURE_LEG_MINUTES = 45  # how long departure-leg work (load/pushback) lasts


def ground_minutes(sta_minutes: int, std_minutes: int) -> int:
    """Ground time in minutes, handling a turnaround that spans midnight."""
    return (std_minutes - sta_minutes) % 1440


def is_long_turnaround(sta_minutes: int, std_minutes: int) -> bool:
    return ground_minutes(sta_minutes, std_minutes) >= LONG_TURNAROUND_THRESHOLD_MIN


def _slot_window(task_role: str, leg: str, sta_minutes: int, std_minutes: int) -> tuple[int, int]:
    """(work_start_min, work_end_min) for a role-slot, accounting for which
    leg of a (possibly split) turnaround it belongs to."""
    if leg == "ARRIVAL":
        return sta_minutes - _prep_buffer_minutes(task_role), sta_minutes + ARRIVAL_LEG_MINUTES
    if leg == "DEPARTURE":
        return std_minutes - DEPARTURE_LEG_MINUTES, std_minutes
    return sta_minutes - _prep_buffer_minutes(task_role), std_minutes


def _window(slot: RoleSlot) -> tuple[int, int]:
    return _slot_window(slot.task_role, slot.leg, slot.turnaround.sta_minutes, slot.turnaround.std_minutes)


def required_sets_for_leg(turnaround, leg: str) -> int:
    """Arrival and departure cargo can differ, so a split turnaround's two
    legs can each need a different number of loader sets — fall back to the
    combined value for an unsplit ("BOTH") turnaround."""
    if leg == "ARRIVAL":
        return turnaround.arrival_required_sets
    if leg == "DEPARTURE":
        return turnaround.departure_required_sets
    return turnaround.required_sets


@constraint_provider
def task_assignment_constraints(cf: ConstraintFactory) -> list[Constraint]:
    return [
        # ── HARD ──────────────────────────────────────────────────────────
        rls_slot_must_have_rls_staff(cf),
        driver_slot_must_have_driver_qualified(cf),
        tower_slot_must_have_tower_qualified(cf),
        loader_slot_must_have_ra(cf),
        no_double_booking(cf),
        no_multiple_roles_same_turnaround(cf),
        multi_set_turnaround_needs_driver(cf),
        # ── SOFT ──────────────────────────────────────────────────────────
        minimize_unassigned_slots(cf),
        minimize_unassigned_rls(cf),
        balance_assignments_per_staff(cf),
        protect_meal_break_window(cf),
        protect_tea_break_window(cf),
        enforce_travel_gap(cf),
        prefer_same_sector_assignments(cf),
    ]


# ── HARD ─────────────────────────────────────────────────────────────────────

def rls_slot_must_have_rls_staff(cf: ConstraintFactory) -> Constraint:
    # for_each (not including_unassigned) → only fires when staff IS assigned
    # Unassigned slots are handled as a soft penalty by S-T1
    return (
        cf.for_each(RoleSlot)
        .filter(lambda s: s.task_role == "RLS")
        .filter(lambda s: s.staff.role != "RLS")
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H-T1: RLS slot needs RLS staff")
    )


def driver_slot_must_have_driver_qualified(cf: ConstraintFactory) -> Constraint:
    return (
        cf.for_each(RoleSlot)
        .filter(lambda s: s.task_role == "DRIVER")
        .filter(lambda s: s.staff.is_driver_qualified == False)
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H-T1: Driver slot needs GSE_DRIVING cert")
    )


def tower_slot_must_have_tower_qualified(cf: ConstraintFactory) -> Constraint:
    return (
        cf.for_each(RoleSlot)
        .filter(lambda s: s.task_role == "TOWER")
        .filter(lambda s: s.staff.is_tower_qualified == False)
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H-T1: Tower slot needs TOWER_OPS cert")
    )


def loader_slot_must_have_ra(cf: ConstraintFactory) -> Constraint:
    return (
        cf.for_each(RoleSlot)
        .filter(lambda s: s.task_role == "LOADER")
        .filter(lambda s: s.staff.role != "RA")
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H-T1: Loader slot needs RA staff")
    )


def no_double_booking(cf: ConstraintFactory) -> Constraint:
    """H-T5: A staff member cannot be assigned to two overlapping turnarounds."""
    return (
        cf.for_each(RoleSlot)
        .filter(lambda a: a.staff is not None)
        .join(
            RoleSlot,
            Joiners.equal(lambda a: a.staff.id, lambda b: b.staff.id),
            Joiners.filtering(lambda a, b: a.id < b.id),
            Joiners.filtering(lambda a, b: b.staff is not None),
            Joiners.filtering(lambda a, b: a.turnaround.id != b.turnaround.id),
            Joiners.filtering(
                lambda a, b: _window(a)[0] < _window(b)[1] and _window(b)[0] < _window(a)[1]
            ),
        )
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H-T5: Staff double-booked across overlapping turnarounds")
    )


def no_multiple_roles_same_turnaround(cf: ConstraintFactory) -> Constraint:
    """H-T6: A staff member can't simultaneously be e.g. Driver on one set and
    Loader on another set of the SAME turnaround — one person, one slot."""
    return (
        cf.for_each(RoleSlot)
        .filter(lambda a: a.staff is not None)
        .join(
            RoleSlot,
            Joiners.equal(lambda a: a.staff.id, lambda b: b.staff.id),
            Joiners.equal(lambda a: a.turnaround.id, lambda b: b.turnaround.id),
            Joiners.filtering(lambda a, b: a.id < b.id),
            Joiners.filtering(lambda a, b: b.staff is not None),
        )
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H-T6: Staff assigned to multiple slots on the same turnaround")
    )


def multi_set_turnaround_needs_driver(cf: ConstraintFactory) -> Constraint:
    """H-T7: A turnaround with more than one loader set (required_sets > 1)
    must have at least one DRIVER assigned somewhere across its sets — you
    can't run multiple GSE loader sets with zero qualified driver, even
    though an individual DRIVER slot going unassigned is otherwise only a
    soft (S-T1) concern like any other role."""
    return (
        cf.for_each_including_unassigned(RoleSlot)
        .filter(lambda s: s.task_role == "DRIVER" and required_sets_for_leg(s.turnaround, s.leg) > 1)
        .group_by(
            lambda s: (s.turnaround.id, s.leg),
            ConstraintCollectors.sum(lambda s: 1 if s.staff is not None else 0),
        )
        .filter(lambda key, assigned_count: assigned_count == 0)
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H-T7: Multi-set turnaround has zero drivers assigned")
    )


# ── SOFT ─────────────────────────────────────────────────────────────────────

def minimize_unassigned_slots(cf: ConstraintFactory) -> Constraint:
    return (
        cf.for_each_including_unassigned(RoleSlot)
        .filter(lambda s: s.staff is None and s.task_role != "RLS")
        .penalize(HardSoftScore.of_soft(10))
        .as_constraint("S-T1: Unassigned role slot")
    )


def minimize_unassigned_rls(cf: ConstraintFactory) -> Constraint:
    """S-T6: RLS unassigned slots are penalised far more lightly than other
    roles — turnarounds routinely start before RLS arrives, or run without
    one entirely, so this is tolerated rather than chased as hard as e.g. an
    unfilled DRIVER or LOADER slot."""
    return (
        cf.for_each_including_unassigned(RoleSlot)
        .filter(lambda s: s.staff is None and s.task_role == "RLS")
        .penalize(HardSoftScore.of_soft(3))
        .as_constraint("S-T6: Unassigned RLS slot")
    )


def balance_assignments_per_staff(cf: ConstraintFactory) -> Constraint:
    """S-T2: Light tie-breaker discouraging one staff member from being
    loaded with a disproportionate number of turnarounds while others on
    the same shift sit idle. Turnarounds are short (30-45 min), so a staff
    member can legitimately work many across an 8-10h shift — real overload
    is already guarded against by the travel-gap (S-T4) and break-window
    (S-T3) constraints. Only penalise *linearly* beyond a generous per-shift
    threshold, so this never competes with S-T1's unassigned-slot penalty
    (a combinatorial version of this constraint was previously creating a
    hard ceiling around 5-6 turnarounds/staff, leaving slots unfilled even
    when idle on-duty staff were available for the rest of their shift)."""
    THRESHOLD = 8
    return (
        cf.for_each(RoleSlot)
        .filter(lambda a: a.staff is not None)
        .group_by(lambda a: a.staff.id, ConstraintCollectors.count_distinct(lambda a: a.turnaround.id))
        .filter(lambda staff_id, n: n > THRESHOLD)
        .penalize(HardSoftScore.of_soft(2), lambda staff_id, n: n - THRESHOLD)
        .as_constraint("S-T2: Staff loaded beyond realistic shift capacity")
    )


def protect_meal_break_window(cf: ConstraintFactory) -> Constraint:
    """S-T3: Staggered meal break (60 min, two-thirds through the shift).

    Each staff member has a ``break_group`` (0 or 1).  Each turnaround has a
    ``meal_break_half`` (0 = first half of the window, 1 = second half,
    -1 = outside the window).  We only penalise when the turnaround's half
    matches the staff member's group — so group-0 staff are free during the
    second half and group-1 staff during the first half, creating staggered
    breaks rather than a team-wide blackout.
    """
    return (
        cf.for_each(RoleSlot)
        .filter(lambda s: s.staff is not None)
        .filter(lambda s: s.turnaround.meal_break_half >= 0)          # in break window
        .filter(lambda s: s.turnaround.meal_break_half == s.staff.break_group)  # matches staff group
        .penalize(HardSoftScore.of_soft(5))
        .as_constraint("S-T3: Assignment during staff meal break window slot")
    )


def protect_tea_break_window(cf: ConstraintFactory) -> Constraint:
    """S-T7: Staggered tea break (30 min, one-third through the shift).

    Mirrors S-T3 but for a second, independent break window placed at a
    different point in the shift (1/3 through, vs 2/3 for the meal break) —
    so the two breaks are separated by roughly a third of the shift's
    duration by construction, rather than landing back-to-back as two
    incidental idle gaps would. Weighted lighter than the meal break since
    a missed tea break is a smaller welfare concern than a missed meal break.
    """
    return (
        cf.for_each(RoleSlot)
        .filter(lambda s: s.staff is not None)
        .filter(lambda s: s.turnaround.tea_break_half >= 0)
        .filter(lambda s: s.turnaround.tea_break_half == s.staff.break_group)
        .penalize(HardSoftScore.of_soft(4))
        .as_constraint("S-T7: Assignment during staff tea break window slot")
    )


def enforce_travel_gap(cf: ConstraintFactory) -> Constraint:
    """S-T4: Penalise insufficient travel time between consecutive assignments."""
    return (
        cf.for_each(RoleSlot)
        .filter(lambda a: a.staff is not None)
        .join(
            RoleSlot,
            Joiners.equal(lambda a: a.staff.id, lambda b: b.staff.id),
            Joiners.filtering(lambda a, b: a.id < b.id),
            Joiners.filtering(lambda a, b: b.staff is not None),
            Joiners.filtering(lambda a, b: a.turnaround.id != b.turnaround.id),
            Joiners.filtering(lambda a, b: _window(a)[1] <= _window(b)[0]),
        )
        .penalize(
            HardSoftScore.of_soft(1),
            lambda a, b: max(
                0,
                _travel_minutes(a.turnaround.bay_sector, b.turnaround.bay_sector, b.task_role)
                - (_window(b)[0] - _window(a)[1]),
            ),
        )
        .as_constraint("S-T4: Insufficient travel gap between tasks")
    )


def prefer_same_sector_assignments(cf: ConstraintFactory) -> Constraint:
    """S-T5: Reward same bay-sector consecutive assignments (+3 soft per pair)."""
    return (
        cf.for_each(RoleSlot)
        .filter(lambda a: a.staff is not None)
        .filter(lambda a: a.turnaround.bay_sector != "")
        .join(
            RoleSlot,
            Joiners.equal(lambda a: a.staff.id, lambda b: b.staff.id),
            Joiners.equal(lambda a: a.turnaround.bay_sector, lambda b: b.turnaround.bay_sector),
            Joiners.filtering(lambda a, b: a.id < b.id),
            Joiners.filtering(lambda a, b: b.staff is not None),
            Joiners.filtering(lambda a, b: a.turnaround.id != b.turnaround.id),
        )
        .reward(HardSoftScore.of_soft(3))
        .as_constraint("S-T5: Same bay sector assignments preferred")
    )
