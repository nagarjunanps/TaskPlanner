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
SOFT  S-T3   Staggered meal break — staff only penalised for turnarounds in
             their own break half (0 = first 30 min, 1 = second 30 min).
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
                lambda a, b: (
                    (a.turnaround.sta_minutes - _prep_buffer_minutes(a.task_role)) < b.turnaround.std_minutes
                    and (b.turnaround.sta_minutes - _prep_buffer_minutes(b.task_role)) < a.turnaround.std_minutes
                )
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
        .filter(lambda s: s.task_role == "DRIVER" and s.turnaround.required_sets > 1)
        .group_by(
            lambda s: s.turnaround.id,
            ConstraintCollectors.sum(lambda s: 1 if s.staff is not None else 0),
        )
        .filter(lambda turnaround_id, assigned_count: assigned_count == 0)
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
    """S-T3: Staggered meal breaks.

    Each staff member has a ``break_group`` (0 or 1).  Each turnaround has a
    ``break_half`` (0 = first 30 min of break window, 1 = second 30 min,
    -1 = outside break window).  We only penalise when the turnaround's half
    matches the staff member's group — so group-0 staff are free during the
    second half and group-1 staff during the first half, creating staggered
    breaks rather than a team-wide blackout.
    """
    return (
        cf.for_each(RoleSlot)
        .filter(lambda s: s.staff is not None)
        .filter(lambda s: s.turnaround.break_half >= 0)          # in break window
        .filter(lambda s: s.turnaround.break_half == s.staff.break_group)  # matches staff group
        .penalize(HardSoftScore.of_soft(5))
        .as_constraint("S-T3: Assignment during staff break window slot")
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
            Joiners.filtering(
                lambda a, b: a.turnaround.std_minutes <= (b.turnaround.sta_minutes - _prep_buffer_minutes(b.task_role))
            ),
        )
        .penalize(
            HardSoftScore.of_soft(1),
            lambda a, b: max(
                0,
                _travel_minutes(a.turnaround.bay_sector, b.turnaround.bay_sector, b.task_role)
                - ((b.turnaround.sta_minutes - _prep_buffer_minutes(b.task_role)) - a.turnaround.std_minutes),
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
