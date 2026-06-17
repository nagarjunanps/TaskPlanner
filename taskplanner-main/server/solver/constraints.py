"""
Timefold AI constraint provider for GTR Malaysia NB Ramp rostering.

Solver constraints use Constraint Streams API (pair/bi joins, group_by).
Sequential constraints (H1, H3) are also validated at publish time via
validate_roster_entries() which performs full window analysis on DB entries.
"""
from collections import defaultdict

from timefold.solver.score import (
    Constraint,
    ConstraintCollectors,
    ConstraintFactory,
    HardSoftScore,
    Joiners,
    constraint_provider,
)

from solver.domain import StaffShiftAssignment

SHORT_REST_COMBOS = {("S3", "S1"), ("S4", "S3")}  # gaps < 8h between consecutive days


@constraint_provider
def roster_constraints(cf: ConstraintFactory) -> list[Constraint]:
    return [
        # ── HARD ──────────────────────────────────────────────────────────────
        no_more_than_2_consecutive_off_days(cf),   # H1b — for_each_including_unassigned
        no_more_than_4_consecutive_on_days(cf),    # H1a — forces the OFF days
        max_3_consecutive_same_shift(cf),
        forbidden_short_rest(cf),
        shift_max_12_hours(cf),
        # ── SOFT ──────────────────────────────────────────────────────────────
        prefer_stable_shift_consecutive_days(cf),
        prefer_morning_afternoon_balance(cf),
    ]


# ─────────────────────────────────────────────────────────────────────────────
# HARD CONSTRAINTS
# ─────────────────────────────────────────────────────────────────────────────

def no_more_than_2_consecutive_off_days(cf: ConstraintFactory) -> Constraint:
    """H1b: Detect 3 consecutive OFF/unassigned days (violates 2-OFF limit).

    Must use for_each_including_unassigned because for_each() silently excludes
    entities where the planning variable is null (unassigned). Without this,
    the stream starts empty and the solver sees 0hard/0soft with all-OFF.
    The join() also receives the including-unassigned stream so that b and c
    match OFF entities too.
    """
    all_ssa = cf.for_each_including_unassigned(StaffShiftAssignment)
    return (
        all_ssa
        .filter(lambda a: a.assigned_shift is None)
        .join(
            all_ssa,
            Joiners.equal(lambda a: a.staff.id),
            Joiners.equal(lambda a: a.day_of_month + 1, lambda b: b.day_of_month),
            Joiners.filtering(lambda a, b: b.assigned_shift is None),
        )
        .join(
            all_ssa,
            Joiners.equal(lambda a, b: a.staff.id, lambda c: c.staff.id),
            Joiners.equal(lambda a, b: b.day_of_month + 1, lambda c: c.day_of_month),
            Joiners.filtering(lambda a, b, c: c.assigned_shift is None),
        )
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H1b: 3+ consecutive OFF days")
    )


def no_more_than_4_consecutive_on_days(cf: ConstraintFactory) -> Constraint:
    """H1a: Detect 5+ consecutive ON-DUTY days (violates 4-ON limit).

    Without this, H1b (max 2 OFF) can be trivially satisfied by assigning
    ON_DUTY every day — no OFF days at all.  This constraint forces the solver
    to insert rest days.

    Uses a Quad stream (a,b,c,d = 4 consecutive ON days) + if_exists to check
    for a 5th consecutive ON day without requiring a Quint stream.
    """
    return (
        cf.for_each(StaffShiftAssignment)
        .filter(lambda a: a.assigned_shift is not None)
        .join(
            StaffShiftAssignment,
            Joiners.equal(lambda a: a.staff.id),
            Joiners.equal(lambda a: a.day_of_month + 1, lambda b: b.day_of_month),
            Joiners.filtering(lambda a, b: b.assigned_shift is not None),
        )
        .join(
            StaffShiftAssignment,
            Joiners.equal(lambda a, b: a.staff.id, lambda c: c.staff.id),
            Joiners.equal(lambda a, b: b.day_of_month + 1, lambda c: c.day_of_month),
            Joiners.filtering(lambda a, b, c: c.assigned_shift is not None),
        )
        .join(
            StaffShiftAssignment,
            Joiners.equal(lambda a, b, c: a.staff.id, lambda d: d.staff.id),
            Joiners.equal(lambda a, b, c: c.day_of_month + 1, lambda d: d.day_of_month),
            Joiners.filtering(lambda a, b, c, d: d.assigned_shift is not None),
        )
        .if_exists(
            StaffShiftAssignment,
            Joiners.equal(lambda a, b, c, d: a.staff.id, lambda e: e.staff.id),
            Joiners.equal(lambda a, b, c, d: d.day_of_month + 1, lambda e: e.day_of_month),
            Joiners.filtering(lambda a, b, c, d, e: e.assigned_shift is not None),
        )
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H1a: 5+ consecutive ON days")
    )


def max_3_consecutive_same_shift(cf: ConstraintFactory) -> Constraint:
    """H3: No staff member should have the same shift code 4+ consecutive days."""
    return (
        cf.for_each(StaffShiftAssignment)
        .filter(lambda a: a.assigned_shift is not None)
        .join(
            StaffShiftAssignment,
            Joiners.equal(lambda a: a.staff.id),
            Joiners.equal(lambda a: a.day_of_month + 1, lambda b: b.day_of_month),
            Joiners.filtering(
                lambda a, b: a.assigned_shift is not None
                and b.assigned_shift is not None
                and a.assigned_shift.code == b.assigned_shift.code
            ),
        )
        .join(
            StaffShiftAssignment,
            Joiners.equal(lambda a, b: a.staff.id, lambda c: c.staff.id),
            Joiners.equal(lambda a, b: b.day_of_month + 1, lambda c: c.day_of_month),
            Joiners.filtering(
                lambda a, b, c: a.assigned_shift is not None
                and c.assigned_shift is not None
                and a.assigned_shift.code == c.assigned_shift.code
            ),
        )
        .join(
            StaffShiftAssignment,
            Joiners.equal(lambda a, b, c: a.staff.id, lambda d: d.staff.id),
            Joiners.equal(lambda a, b, c: c.day_of_month + 1, lambda d: d.day_of_month),
            Joiners.filtering(
                lambda a, b, c, d: a.assigned_shift is not None
                and d.assigned_shift is not None
                and a.assigned_shift.code == d.assigned_shift.code
            ),
        )
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H3: 4+ consecutive days on same shift")
    )


def forbidden_short_rest(cf: ConstraintFactory) -> Constraint:
    """H6: Forbidden back-to-back shift sequences leaving < 8h rest between days."""
    return (
        cf.for_each(StaffShiftAssignment)
        .filter(lambda a: a.assigned_shift is not None)
        .join(
            StaffShiftAssignment,
            Joiners.equal(lambda a: a.staff.id),
            Joiners.equal(lambda a: a.day_of_month + 1, lambda b: b.day_of_month),
            Joiners.filtering(
                lambda a, b: a.assigned_shift is not None
                and b.assigned_shift is not None
                and (a.assigned_shift.code, b.assigned_shift.code) in SHORT_REST_COMBOS
            ),
        )
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H6: Forbidden short-rest shift sequence")
    )


def shift_max_12_hours(cf: ConstraintFactory) -> Constraint:
    """H5: Shifts must not exceed 12 hours (all 4 shifts are ≤12h — safety guard)."""
    return (
        cf.for_each(StaffShiftAssignment)
        .filter(lambda a: a.assigned_shift is not None and a.assigned_shift.duration_hours > 12)
        .penalize(HardSoftScore.ONE_HARD)
        .as_constraint("H5: Shift duration exceeds 12h")
    )


# ─────────────────────────────────────────────────────────────────────────────
# SOFT CONSTRAINTS
# ─────────────────────────────────────────────────────────────────────────────

def prefer_stable_shift_consecutive_days(cf: ConstraintFactory) -> Constraint:
    """S3: Penalise shift code changes between consecutive ON-DUTY days."""
    return (
        cf.for_each(StaffShiftAssignment)
        .filter(lambda a: a.assigned_shift is not None)
        .join(
            StaffShiftAssignment,
            Joiners.equal(lambda a: a.staff.id),
            Joiners.equal(lambda a: a.day_of_month + 1, lambda b: b.day_of_month),
            Joiners.filtering(
                lambda a, b: a.assigned_shift is not None
                and b.assigned_shift is not None
                and a.assigned_shift.code != b.assigned_shift.code
            ),
        )
        .penalize(HardSoftScore.of_soft(1))
        .as_constraint("S3: Shift code changes between consecutive days")
    )


def prefer_morning_afternoon_balance(cf: ConstraintFactory) -> Constraint:
    """S1: Prefer balanced morning/afternoon shift distribution per staff per week."""
    MORNING_CODES = {"S1", "S3"}

    return (
        cf.for_each(StaffShiftAssignment)
        .filter(lambda a: a.assigned_shift is not None and a.assigned_shift.code in MORNING_CODES)
        .join(
            StaffShiftAssignment,
            Joiners.equal(lambda a: a.staff.id),
            Joiners.equal(lambda a: a.day_of_month + 3, lambda b: b.day_of_month),
            Joiners.filtering(
                lambda a, b: b.assigned_shift is not None
                and b.assigned_shift.code in MORNING_CODES
            ),
        )
        .penalize(HardSoftScore.of_soft(1))
        .as_constraint("S1: 4+ consecutive morning-block shifts")
    )


# ─────────────────────────────────────────────────────────────────────────────
# Post-solve validation (run at publish time & on-demand)
# ─────────────────────────────────────────────────────────────────────────────

def validate_roster_entries(entries) -> list[dict]:
    """
    Full constraint validation on DB RosterEntry objects.
    Returns list of {constraint, severity, date, message} dicts.
    """
    from models.db_models import EntryType

    violations = []
    by_staff: dict[int, list] = defaultdict(list)
    by_date: dict = defaultdict(list)

    for e in entries:
        by_staff[e.staff_id].append(e)
        by_date[e.date].append(e)

    # H11/H12: only validate runner constraints if runners have been designated.
    # After solving, all is_runner flags are False (runners are set via the
    # Attendance page). Checking H11 before any runner is set would produce
    # a violation for every duty day, giving misleading results.
    total_runners_set = sum(1 for e in entries if e.is_runner)

    if total_runners_set > 0:
        # H11: minimum 2 runners per ON_DUTY date
        for d, day_entries in by_date.items():
            on_duty = [e for e in day_entries if e.entry_type in (EntryType.ON_DUTY, EntryType.OT)]
            runners = [e for e in day_entries if e.is_runner and e.entry_type in (EntryType.ON_DUTY, EntryType.OT)]
            if on_duty and len(runners) < 2:
                violations.append({
                    "constraint": "H11",
                    "severity": "HARD",
                    "date": str(d),
                    "message": f"{d}: {len(runners)} runner(s) designated — need at least 2.",
                })

        # H12: runner count >= MC count
        for d, day_entries in by_date.items():
            mc_count = sum(1 for e in day_entries if e.entry_type == EntryType.MC)
            runner_count = sum(
                1 for e in day_entries
                if e.is_runner and e.entry_type in (EntryType.ON_DUTY, EntryType.OT)
            )
            if mc_count > runner_count:
                violations.append({
                    "constraint": "H12",
                    "severity": "HARD",
                    "date": str(d),
                    "message": f"{d}: {mc_count} MC absence(s) but only {runner_count} runner(s).",
                })

    # H1: 4-ON/2-OFF sequential check per staff
    for staff_id, staff_entries in by_staff.items():
        sorted_entries = sorted(staff_entries, key=lambda e: e.date)
        on_run = off_run = 0
        for e in sorted_entries:
            if e.entry_type in (EntryType.ON_DUTY, EntryType.OT):
                on_run += 1
                off_run = 0
                if on_run > 4:
                    violations.append({
                        "constraint": "H1",
                        "severity": "HARD",
                        "date": str(e.date),
                        "message": f"Staff {staff_id}: {on_run} consecutive ON-DUTY days (max 4).",
                    })
            else:
                off_run += 1
                on_run = 0
                if off_run > 2:
                    violations.append({
                        "constraint": "H1",
                        "severity": "HARD",
                        "date": str(e.date),
                        "message": f"Staff {staff_id}: {off_run} consecutive OFF days (max 2).",
                    })

    # H3: max 3 consecutive same shift per staff
    for staff_id, staff_entries in by_staff.items():
        sorted_entries = sorted(staff_entries, key=lambda e: e.date)
        run_code = None
        run_len = 0
        for e in sorted_entries:
            code = e.shift.code if e.shift else None
            if code and code == run_code:
                run_len += 1
                if run_len > 3:
                    violations.append({
                        "constraint": "H3",
                        "severity": "HARD",
                        "date": str(e.date),
                        "message": f"Staff {staff_id}: {run_len} consecutive {code} shifts (max 3).",
                    })
            else:
                run_code = code
                run_len = 1 if code else 0

    # S3 soft: flag shift changes between consecutive ON days (informational)
    for staff_id, staff_entries in by_staff.items():
        sorted_on = sorted(
            [e for e in staff_entries if e.shift],
            key=lambda e: e.date,
        )
        for i in range(1, len(sorted_on)):
            prev, curr = sorted_on[i - 1], sorted_on[i]
            if (curr.date - prev.date).days == 1 and prev.shift.code != curr.shift.code:
                violations.append({
                    "constraint": "S3",
                    "severity": "SOFT",
                    "date": str(curr.date),
                    "message": f"Staff {staff_id}: shift changes from {prev.shift.code} to {curr.shift.code}.",
                })

    return violations
