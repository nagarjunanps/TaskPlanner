"""Task planner router — solve daily turnaround staff assignments via Timefold."""
from datetime import date as DateType
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import SessionLocal, get_db
from models.db_models import (
    AssignmentSource, CertStatus, CertificationType, EntryType,
    MonthlyRoster, RosterEntry, Shift, Staff, StaffCertification,
    TaskAssignment, TaskRole, Team, Turnaround,
)
from models.schemas import (
    AssignmentConflictOut, TaskAssignmentOut, TaskAssignmentUpdate, TaskSolveAllRequest,
    TaskSolveRequest, TaskSolverStatusOut, TaskValidationOut,
)
from routers.auth import require_admin
from solver.task_constraints import _prep_buffer_minutes
from solver.task_solver_manager import get_task_job, start_task_solve, stop_task_job

router = APIRouter(prefix="/api/task-planner", tags=["task-planner"], dependencies=[Depends(require_admin)])


def _time_to_minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _bay_sector(bay: str | None) -> str:
    """Extract leading letter sector from bay name: 'J01' → 'J', 'L12' → 'L'."""
    return bay[0].upper() if bay and bay[0].isalpha() else ""


def _break_window(shift_start: int, shift_end: int) -> tuple[int, int]:
    """Return (break_start, break_end) minutes from midnight for the meal break.
    Break is centred at mid-shift ± 30 min."""
    spans_midnight = shift_end < shift_start
    duration = (1440 - shift_start + shift_end) if spans_midnight else (shift_end - shift_start)
    midpoint = (shift_start + duration // 2) % 1440
    return (midpoint - 30) % 1440, (midpoint + 30) % 1440


def _in_break_window(sta_min: int, std_min: int, bw_start: int, bw_end: int) -> bool:
    """True if [STA-15, STD] overlaps with the break window [bw_start, bw_end]."""
    if bw_start == bw_end == 0:
        return False
    work_start = (sta_min - 15) % 1440
    work_end   = std_min
    if bw_start <= bw_end:  # normal window
        return work_start < bw_end and work_end > bw_start
    else:                    # midnight-spanning window
        return work_start < bw_end or work_end > bw_start


def _break_half(sta_min: int, bw_start: int) -> int:
    """Returns 0 if sta falls in first 30-min half of break window, 1 otherwise."""
    bw_mid = (bw_start + 30) % 1440
    if bw_start <= bw_mid:          # normal (no midnight crossing)
        return 0 if sta_min < bw_mid else 1
    # bw_mid crosses midnight (bw_start near 23:30)
    return 0 if sta_min >= bw_start else 1


async def _build_plan_data(
    team_id: int,
    plan_date: DateType,
    db: AsyncSession,
    from_time_minutes: int | None = None,
    exclusive_until_min: int | None = None,
    window_start_min: int | None = None,
    extra_team_ids: list[int] | None = None,
) -> dict:
    # Get all turnarounds for the date
    turnarounds_db = (await db.execute(
        select(Turnaround)
        .options(selectinload(Turnaround.arrival_flight), selectinload(Turnaround.departure_flight))
        .where(Turnaround.scheduled_date == plan_date)
    )).scalars().all()

    if not turnarounds_db:
        raise HTTPException(422, f"No turnarounds found for {plan_date}. Fetch flights first via GET /api/flights/turnarounds.")

    turnaround_facts = []
    for ta in turnarounds_db:
        arr = ta.arrival_flight
        dep = ta.departure_flight
        sta_min = _time_to_minutes(arr.scheduled_time) if arr else 0
        std_min = _time_to_minutes(dep.scheduled_time) if dep else sta_min + 45
        bay = (dep.bay if dep else None) or (arr.bay if arr else None) or ""
        turnaround_facts.append({
            "id": ta.id,
            "aircraft_registration": ta.aircraft_registration or "",
            "arrival_flight_number": arr.flight_number if arr else "",
            "departure_flight_number": dep.flight_number if dep else "",
            "sta_minutes": sta_min,
            "std_minutes": std_min,
            "required_sets": ta.required_sets,
            "bay": bay,
            "bay_sector": _bay_sector(bay),
            "break_half": -1,           # filled in after shift window is known
        })

    # Get on-duty staff for team+date via effective_entry_type
    roster = (await db.execute(
        select(MonthlyRoster).where(
            MonthlyRoster.team_id == team_id,
            MonthlyRoster.year == plan_date.year,
            MonthlyRoster.month == plan_date.month,
        )
    )).scalar_one_or_none()

    on_duty_staff_ids: set[int] = set()
    staff_team_map: dict[int, int] = {}
    shift_start_min: int | None = None
    shift_end_min:   int | None = None
    if roster:
        entries = (await db.execute(
            select(RosterEntry)
            .options(selectinload(RosterEntry.staff), selectinload(RosterEntry.shift))
            .where(RosterEntry.roster_id == roster.id, RosterEntry.date == plan_date)
        )).scalars().all()
        for entry in entries:
            # Capture shift window from any entry that has a shift set
            if shift_start_min is None and entry.shift:
                shift_start_min = _time_to_minutes(entry.shift.start_time)
                shift_end_min   = _time_to_minutes(entry.shift.end_time)
            effective = entry.actual_entry_type if entry.actual_entry_type is not None else entry.entry_type
            if effective == EntryType.ON_DUTY:
                on_duty_staff_ids.add(entry.staff_id)
                staff_team_map[entry.staff_id] = team_id

    # Pool in certified staff from other teams whose shift overlaps this
    # window (see start_all_teams_solver) instead of each team being stuck
    # covering the shared time alone with only its own headcount.
    for extra_id in (extra_team_ids or []):
        extra_roster = (await db.execute(
            select(MonthlyRoster).where(
                MonthlyRoster.team_id == extra_id,
                MonthlyRoster.year == plan_date.year,
                MonthlyRoster.month == plan_date.month,
            )
        )).scalar_one_or_none()
        if not extra_roster:
            continue
        extra_entries = (await db.execute(
            select(RosterEntry).where(RosterEntry.roster_id == extra_roster.id, RosterEntry.date == plan_date)
        )).scalars().all()
        for entry in extra_entries:
            effective = entry.actual_entry_type if entry.actual_entry_type is not None else entry.entry_type
            if effective == EntryType.ON_DUTY:
                on_duty_staff_ids.add(entry.staff_id)
                staff_team_map[entry.staff_id] = extra_id

    # Filter turnarounds to those whose arrival falls within this planning window.
    # In solve-all mode, exclusive_until_min/window_start_min either carve out a
    # team's own exclusive (non-overlapping) slice of its shift, or define a
    # joint overlap window solved with pooled staff from two teams — see
    # start_all_teams_solver.
    if shift_start_min is not None and shift_end_min is not None:
        planning_start = window_start_min if window_start_min is not None else shift_start_min
        planning_end = exclusive_until_min if exclusive_until_min is not None else shift_end_min
        spans_midnight_plan = planning_end < planning_start

        def _in_shift_window(sta_min: int) -> bool:
            if spans_midnight_plan:
                return sta_min >= planning_start or sta_min < planning_end
            return planning_start <= sta_min < planning_end

        turnaround_facts = [t for t in turnaround_facts if _in_shift_window(t["sta_minutes"])]

        # Break window uses full shift (not exclusive) — this is a staff-welfare concern
        bw_start, bw_end = _break_window(shift_start_min, shift_end_min)
        for t in turnaround_facts:
            if _in_break_window(t["sta_minutes"], t["std_minutes"], bw_start, bw_end):
                t["break_half"] = _break_half(t["sta_minutes"], bw_start)
            else:
                t["break_half"] = -1

        in_bw = sum(1 for t in turnaround_facts if t["break_half"] >= 0)
        print(
            f"[task-planner] team={team_id} "
            f"shift={shift_start_min//60:02d}:{shift_start_min%60:02d}"
            f"-{shift_end_min//60:02d}:{shift_end_min%60:02d} "
            f"planning_window={planning_start//60:02d}:{planning_start%60:02d}"
            f"-{planning_end//60:02d}:{planning_end%60:02d} "
            f"— {len(turnaround_facts)} TAs in window, {in_bw} in break window "
            f"({bw_start//60:02d}:{bw_start%60:02d}-{bw_end//60:02d}:{bw_end%60:02d})"
        )

    # If replanning from a specific time, only include upcoming turnarounds
    if from_time_minutes is not None:
        before = len(turnaround_facts)
        turnaround_facts = [t for t in turnaround_facts if t["sta_minutes"] >= from_time_minutes]
        print(f"[task-planner] replan from {from_time_minutes//60:02d}:{from_time_minutes%60:02d} — {len(turnaround_facts)}/{before} TAs are upcoming")

    if not turnaround_facts:
        raise HTTPException(422, "No upcoming turnarounds to plan after the specified time.")

    if not on_duty_staff_ids:
        all_staff = (await db.execute(
            select(Staff).where(Staff.team_id.in_([team_id, *(extra_team_ids or [])]), Staff.is_active == True)
        )).scalars().all()
        on_duty_staff_ids = {s.id for s in all_staff}
        staff_team_map = {s.id: s.team_id for s in all_staff}

    # Get active certifications for on-duty staff
    gse_cert = (await db.execute(
        select(CertificationType).where(CertificationType.code == "GSE_DRIVING")
    )).scalar_one_or_none()
    tower_cert = (await db.execute(
        select(CertificationType).where(CertificationType.code == "TOWER_OPS")
    )).scalar_one_or_none()

    gse_cert_id = gse_cert.id if gse_cert else None
    tower_cert_id = tower_cert.id if tower_cert else None

    driver_qualified_ids: set[int] = set()
    tower_qualified_ids: set[int] = set()
    if on_duty_staff_ids:
        certs = (await db.execute(
            select(StaffCertification).where(
                StaffCertification.staff_id.in_(on_duty_staff_ids),
                StaffCertification.status.in_([CertStatus.ACTIVE, CertStatus.EXPIRING_SOON]),
            )
        )).scalars().all()
        for c in certs:
            if c.cert_type_id == gse_cert_id:
                driver_qualified_ids.add(c.staff_id)
            if c.cert_type_id == tower_cert_id:
                tower_qualified_ids.add(c.staff_id)

    staff_rows = (await db.execute(
        select(Staff).where(Staff.id.in_(on_duty_staff_ids))
    )).scalars().all()

    staff_facts = [
        {
            "id": s.id,
            "employee_id": s.employee_id,
            "name": s.name,
            "role": s.role.value,
            "team_id": staff_team_map.get(s.id, s.team_id),
            "is_driver_qualified": s.id in driver_qualified_ids,
            "is_tower_qualified": s.id in tower_qualified_ids,
            "is_runner": False,
            "break_group": i % 2,   # alternate 0/1 so breaks are staggered
        }
        for i, s in enumerate(staff_rows)
    ]

    return {
        "team_id": team_id,
        "date": plan_date.isoformat(),
        "turnarounds": turnaround_facts,
        "staff": staff_facts,
    }


async def _persist_assignments(job, team_id: int):
    """Write a completed job's solution to the DB. Idempotent — marks job.persisted.
    Called from within the solver job itself right after solving (before the
    status flips to SOLVING_COMPLETED), and as a fallback from /status.

    `team_id` is the job's nominal/fallback team (used for unassigned slots,
    or for jobs solved with a single team's own staff). For joint overlap
    jobs (see start_all_teams_solver), slots may be filled by staff pooled in
    from a second team — those persist under the *assigned staff's own*
    team_id rather than the job's nominal one, so each assignment is
    attributed to whoever is actually doing the work.
    """
    if job.persisted or not job.solution:
        return
    job.persisted = True

    rows = [
        {
            "turnaround_id": slot.turnaround.id,
            "team_id": slot.staff.team_id if slot.staff else team_id,
            "task_role": TaskRole(slot.task_role),
            "set_number": slot.set_number,
            "slot_index": slot.slot_index,
            "staff_id": slot.staff.id if slot.staff else None,
            "source": AssignmentSource.SOLVER,
        }
        for slot in job.solution.slots
    ]
    if not rows:
        return

    async with SessionLocal() as db:
        # Single multi-row upsert instead of one execute() per slot — a job
        # can have hundreds of slots, and looping individual statements held
        # the write transaction open long enough to make 'database is locked'
        # far more likely when several solve-all jobs commit around the same
        # time (see start_all_teams_solver's per-team + pooled-overlap jobs).
        stmt = sqlite_insert(TaskAssignment).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["turnaround_id", "task_role", "set_number", "slot_index"],
            set_={
                "staff_id": stmt.excluded.staff_id,
                "source": stmt.excluded.source,
                "team_id": stmt.excluded.team_id,
            },
        )
        await db.execute(stmt)
        await db.commit()


@router.post("/solve", response_model=TaskSolverStatusOut)
async def start_task_solver(
    payload: TaskSolveRequest,
    db: AsyncSession = Depends(get_db),
):
    from_time_minutes: int | None = None
    if payload.replan_from_time:
        h, m = payload.replan_from_time.split(":")
        from_time_minutes = int(h) * 60 + int(m)
    plan_data = await _build_plan_data(payload.team_id, payload.date, db, from_time_minutes)
    job_id = await start_task_solve(
        payload.team_id, payload.date.isoformat(), plan_data,
        on_complete=lambda job: _persist_assignments(job, payload.team_id),
    )

    return TaskSolverStatusOut(
        job_id=job_id,
        team_id=payload.team_id,
        date=payload.date.isoformat(),
        status="SOLVING",
    )


@router.post("/solve-all", response_model=list[TaskSolverStatusOut])
async def start_all_teams_solver(
    payload: TaskSolveAllRequest,
    db: AsyncSession = Depends(get_db),
):
    """Start a solve job for every on-duty team.

    Phase 1 — collect active teams and their shift start/end times.
    Phase 2 — sort by shift start and, per adjacent pair, carve out any
               overlap (e.g. one shift ends 15:00, the next starts 11:00 —
               both teams are on duty 11:00-15:00) from BOTH teams' own
               exclusive windows entirely, rather than splitting it in half
               between them. Splitting in half used to leave each team
               covering its slice of the shared time alone with only its
               own (often certification-scarce) headcount — exactly when
               both teams' staff are actually on duty and available.
    Phase 3 — plan each team's own exclusive window with just its own staff,
               then plan each overlap window separately as a joint job that
               pools both teams' certified staff together.
    """
    all_teams = (await db.execute(select(Team).order_by(Team.code))).scalars().all()
    if not all_teams:
        raise HTTPException(422, "No teams found in database.")

    # Phase 1 — collect active teams ──────────────────────────────────────────
    active: list[dict] = []
    for team in all_teams:
        roster = (await db.execute(
            select(MonthlyRoster).where(
                MonthlyRoster.team_id == team.id,
                MonthlyRoster.year == payload.date.year,
                MonthlyRoster.month == payload.date.month,
            )
        )).scalar_one_or_none()
        if not roster:
            print(f"[solve-all] {team.code}: no roster — skipped")
            continue

        entries = (await db.execute(
            select(RosterEntry)
            .options(selectinload(RosterEntry.shift))
            .where(RosterEntry.roster_id == roster.id, RosterEntry.date == payload.date)
        )).scalars().all()

        on_duty = [
            e for e in entries
            if (e.actual_entry_type if e.actual_entry_type is not None else e.entry_type) == EntryType.ON_DUTY
        ]
        if not on_duty:
            print(f"[solve-all] {team.code}: no on-duty staff — skipped")
            continue

        shift_entry = next((e for e in entries if e.shift), None)
        if not shift_entry:
            print(f"[solve-all] {team.code}: no shift assigned — skipped")
            continue

        active.append({
            "team": team,
            "shift_start": _time_to_minutes(shift_entry.shift.start_time),
            "shift_end":   _time_to_minutes(shift_entry.shift.end_time),
        })

    if not active:
        raise HTTPException(
            422,
            f"No teams have on-duty staff for {payload.date}. Check rosters and ensure flights are fetched first.",
        )

    # Phase 2 — carve out overlaps into separate joint windows ────────────────
    # Sort ascending by shift start.  S4 starts at 23:00 (1380) → naturally last.
    active.sort(key=lambda td: td["shift_start"])
    n = len(active)

    # Express each team's shift end relative to its own start, unwrapped past
    # 1440 if the shift spans midnight (e.g. S4 23:00–11:00 → end = 660+1440).
    for td in active:
        td["_end_unwrapped"] = td["shift_end"] if td["shift_end"] > td["shift_start"] else td["shift_end"] + 1440

    overlap_jobs: list[dict] = []   # {team_a, team_b, window_start, exclusive_until}

    for i, td in enumerate(active):
        if n == 1:
            td["exclusive_until"] = td["shift_end"]
            continue
        nxt = active[(i + 1) % n]
        if i == n - 1:
            # Last→first wraparound (e.g. night shift S4 handing off to the
            # next morning's S1): keep the old simple handoff here. Pooling
            # this boundary too pulls time away from whichever team starts
            # the day, which empirically made things worse, not better —
            # and "today's" date attribution of an overnight shift's early-
            # morning hours is already a separate ambiguity of its own.
            td["exclusive_until"] = nxt["shift_start"]
            continue
        end_i = td["_end_unwrapped"]
        start_next = nxt["shift_start"]
        if start_next >= end_i:
            td["exclusive_until"] = end_i % 1440   # gap or exact handoff — nothing shared
        else:
            # Overlap — exclude it from both teams' own exclusive windows;
            # it gets one joint solve with both teams' staff pooled instead.
            td["exclusive_until"] = start_next % 1440
            nxt["_window_start"] = end_i % 1440
            overlap_jobs.append({
                "team_a": td["team"], "team_b": nxt["team"],
                "window_start": start_next % 1440, "exclusive_until": end_i % 1440,
            })

    # Phase 3 — plan and launch each team's own exclusive window ──────────────
    results = []
    for td in active:
        team = td["team"]
        excl = td["exclusive_until"]
        win_start = td.get("_window_start") if td.get("_window_start") is not None else td["shift_start"]
        print(
            f"[solve-all] {team.code}: exclusive window "
            f"{win_start//60:02d}:{win_start%60:02d}–"
            f"{excl//60:02d}:{excl%60:02d} (own shift "
            f"{td['shift_start']//60:02d}:{td['shift_start']%60:02d}–"
            f"{td['shift_end']//60:02d}:{td['shift_end']%60:02d})"
        )
        if win_start == excl:
            print(f"[solve-all] {team.code}: zero-length exclusive window — fully overlapped, skipped")
            continue
        try:
            plan_data = await _build_plan_data(
                team.id, payload.date, db,
                exclusive_until_min=excl,
                window_start_min=win_start,
            )
        except HTTPException as exc:
            print(f"[solve-all] {team.code}: skipped — {exc.detail}")
            continue
        except Exception as exc:
            print(f"[solve-all] {team.code}: error building plan — {exc}")
            continue

        job_id = await start_task_solve(
            team.id, payload.date.isoformat(), plan_data,
            on_complete=lambda job, _team_id=team.id: _persist_assignments(job, _team_id),
        )

        results.append(TaskSolverStatusOut(
            job_id=job_id,
            team_id=team.id,
            date=payload.date.isoformat(),
            status="SOLVING",
        ))

    # Phase 3b — plan and launch each overlap window with pooled staff ────────
    for ov in overlap_jobs:
        team_a, team_b = ov["team_a"], ov["team_b"]
        win_start, excl = ov["window_start"], ov["exclusive_until"]
        print(
            f"[solve-all] {team_a.code}+{team_b.code}: pooled overlap window "
            f"{win_start//60:02d}:{win_start%60:02d}–{excl//60:02d}:{excl%60:02d}"
        )
        try:
            plan_data = await _build_plan_data(
                team_a.id, payload.date, db,
                exclusive_until_min=excl,
                window_start_min=win_start,
                extra_team_ids=[team_b.id],
            )
        except HTTPException as exc:
            print(f"[solve-all] {team_a.code}+{team_b.code}: skipped — {exc.detail}")
            continue
        except Exception as exc:
            print(f"[solve-all] {team_a.code}+{team_b.code}: error building plan — {exc}")
            continue

        job_id = await start_task_solve(
            team_a.id, payload.date.isoformat(), plan_data,
            on_complete=lambda job, _team_id=team_a.id: _persist_assignments(job, _team_id),
        )

        results.append(TaskSolverStatusOut(
            job_id=job_id,
            team_id=team_a.id,
            date=payload.date.isoformat(),
            status="SOLVING",
            pooled_with_team_id=team_b.id,
        ))

    if not results:
        raise HTTPException(422, "No teams had turnarounds to plan for this date.")

    return results


@router.get("/status/{job_id}", response_model=TaskSolverStatusOut)
async def task_solver_status(job_id: str):
    job = get_task_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    if job.status == "SOLVING_COMPLETED" and not job.persisted:
        await _persist_assignments(job, job.team_id)
    total = len(job.solution.slots) if job.solution else 0
    unassigned = sum(1 for s in job.solution.slots if s.staff is None) if job.solution else 0
    return TaskSolverStatusOut(
        job_id=job.job_id,
        team_id=job.team_id,
        date=job.date,
        status=job.status,
        best_score=job.best_score,
        time_spent_seconds=job.time_spent_seconds,
        error=job.error,
        retry_count=job.retry_count,
        total_slots=total,
        unassigned_count=unassigned,
        conflicts=job.conflicts,
        diagnostic=job.diagnostic,
    )


@router.post("/stop/{job_id}")
async def stop_task_solver(job_id: str):
    if not stop_task_job(job_id):
        raise HTTPException(404, "Job not found.")
    return {"stopped": True}


@router.get("/assignments", response_model=list[TaskAssignmentOut])
async def get_assignments(
    date: DateType,
    team_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(TaskAssignment)
        .options(
            selectinload(TaskAssignment.turnaround).selectinload(Turnaround.arrival_flight),
            selectinload(TaskAssignment.turnaround).selectinload(Turnaround.departure_flight),
            selectinload(TaskAssignment.staff),
        )
        .join(Turnaround, TaskAssignment.turnaround_id == Turnaround.id)
        .where(Turnaround.scheduled_date == date)
    )
    if team_id is not None:
        q = q.where(TaskAssignment.team_id == team_id)

    rows = (await db.execute(q.order_by(
        Turnaround.id, TaskAssignment.task_role, TaskAssignment.set_number, TaskAssignment.slot_index
    ))).scalars().all()

    result = []
    for row in rows:
        out = TaskAssignmentOut.model_validate(row)
        out.staff_name = row.staff.name if row.staff else None
        result.append(out)
    return result


@router.put("/assignments/{assignment_id}", response_model=TaskAssignmentOut)
async def update_assignment(
    assignment_id: int,
    payload: TaskAssignmentUpdate,
    db: AsyncSession = Depends(get_db),
):
    asgn = (await db.execute(
        select(TaskAssignment)
        .options(selectinload(TaskAssignment.staff))
        .where(TaskAssignment.id == assignment_id)
    )).scalar_one_or_none()
    if not asgn:
        raise HTTPException(404, "Assignment not found.")

    asgn.staff_id = payload.staff_id
    asgn.source = AssignmentSource.MANUAL
    await db.commit()
    await db.refresh(asgn)

    out = TaskAssignmentOut.model_validate(asgn)
    if asgn.staff_id:
        staff = (await db.execute(select(Staff).where(Staff.id == asgn.staff_id))).scalar_one_or_none()
        out.staff_name = staff.name if staff else None
    return out


@router.get("/validate", response_model=TaskValidationOut)
async def validate_assignments(
    date: DateType,
    db: AsyncSession = Depends(get_db),
):
    """Check every staffed assignment for a date for double-bookings (same
    staff assigned to two overlapping turnarounds) or impossible bay-to-bay
    travel gaps between back-to-back turnarounds — independent of whether
    those assignments came from the solver or a manual edit."""
    rows = (await db.execute(
        select(TaskAssignment)
        .options(
            selectinload(TaskAssignment.turnaround).selectinload(Turnaround.arrival_flight),
            selectinload(TaskAssignment.turnaround).selectinload(Turnaround.departure_flight),
            selectinload(TaskAssignment.staff),
        )
        .join(Turnaround, TaskAssignment.turnaround_id == Turnaround.id)
        .where(Turnaround.scheduled_date == date, TaskAssignment.staff_id.is_not(None))
    )).scalars().all()

    # Collapse multiple slots for the same staff on the same turnaround into
    # one window — that's not a conflict, just multiple roles on one flight.
    by_staff: dict[int, dict[int, dict]] = {}
    for row in rows:
        ta = row.turnaround
        if not ta:
            continue
        arr, dep = ta.arrival_flight, ta.departure_flight
        sta = _time_to_minutes(arr.scheduled_time) if arr else 0
        std = _time_to_minutes(dep.scheduled_time) if dep else sta + 45
        bay = (dep.bay if dep else None) or (arr.bay if arr else None) or ""
        role = row.task_role.value if hasattr(row.task_role, "value") else str(row.task_role)
        windows = by_staff.setdefault(row.staff_id, {})
        if ta.id not in windows:
            windows[ta.id] = {
                "turnaround_id": ta.id,
                "window_start": sta - _prep_buffer_minutes(role),
                "window_end": std,
                "bay": bay,
                "role": role,
                "assignment_id": row.id,
                "staff_name": row.staff.name if row.staff else f"Staff {row.staff_id}",
                "reg": ta.aircraft_registration or (arr.flight_number if arr else "") or "?",
            }
        else:
            windows[ta.id]["assignment_id"] = min(windows[ta.id]["assignment_id"], row.id)

    conflicts: list[AssignmentConflictOut] = []
    for staff_id, ta_map in by_staff.items():
        windows = sorted(ta_map.values(), key=lambda w: w["window_start"])
        for i in range(len(windows)):
            a = windows[i]
            for j in range(i + 1, len(windows)):
                b = windows[j]
                if a["window_start"] < b["window_end"] and b["window_start"] < a["window_end"]:
                    conflicts.append(AssignmentConflictOut(
                        staff_id=staff_id,
                        staff_name=a["staff_name"],
                        conflict_type="double_booking",
                        description=(
                            f"{a['staff_name']} double-booked: {a['reg']} "
                            f"({a['window_start']//60:02d}:{a['window_start']%60:02d}"
                            f"-{a['window_end']//60:02d}:{a['window_end']%60:02d}) overlaps {b['reg']} "
                            f"({b['window_start']//60:02d}:{b['window_start']%60:02d}"
                            f"-{b['window_end']//60:02d}:{b['window_end']%60:02d})"
                        ),
                        turnaround_id=a["turnaround_id"],
                        other_turnaround_id=b["turnaround_id"],
                        assignment_id=a["assignment_id"],
                        other_assignment_id=b["assignment_id"],
                    ))
                    continue
                if j == i + 1:
                    gap = b["window_start"] - a["window_end"]
                    a_sec, b_sec = _bay_sector(a["bay"]), _bay_sector(b["bay"])
                    need = 3 if (not a_sec or not b_sec or a_sec == b_sec) else min(5 + abs(ord(a_sec) - ord(b_sec)) * 4, 15)
                    if a["role"] == "RLS" or b["role"] == "RLS":
                        need = need // 2
                    if 0 <= gap < need:
                        conflicts.append(AssignmentConflictOut(
                            staff_id=staff_id,
                            staff_name=a["staff_name"],
                            conflict_type="travel_gap",
                            description=(
                                f"{a['staff_name']}: only {gap} min to get from bay {a['bay'] or '?'} "
                                f"({a['reg']}) to bay {b['bay'] or '?'} ({b['reg']}) — needs {need} min"
                            ),
                            turnaround_id=a["turnaround_id"],
                            other_turnaround_id=b["turnaround_id"],
                            assignment_id=a["assignment_id"],
                            other_assignment_id=b["assignment_id"],
                        ))

    return TaskValidationOut(
        date=date.isoformat(),
        checked_assignments=len(rows),
        conflicts=conflicts,
    )
