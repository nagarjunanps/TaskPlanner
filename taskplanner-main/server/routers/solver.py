import asyncio
import calendar
import os
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, SessionLocal
from models.db_models import (
    EntryType, MonthlyRoster, RosterEntry, RosterStatus, Shift, Staff
)
from models.schemas import SolverStartRequest, SolverStatusOut
from routers.auth import require_admin
from solver import solver_manager
from solver.constraints import validate_roster_entries

router = APIRouter(prefix="/api/solver", tags=["solver"], dependencies=[Depends(require_admin)])

SOLVER_TIME_LIMIT = int(os.getenv("SOLVER_TIME_LIMIT_SECONDS", "30"))

# Keep strong references to background tasks so the GC doesn't collect them mid-run.
_background_tasks: set[asyncio.Task] = set()


async def _build_roster_data(roster: MonthlyRoster, db: AsyncSession) -> dict:
    shifts = (await db.execute(select(Shift).order_by(Shift.id))).scalars().all()
    staff = (await db.execute(
        select(Staff).where(Staff.team_id == roster.team_id, Staff.is_active == True)
    )).scalars().all()

    _, num_days = calendar.monthrange(roster.year, roster.month)
    dates = [str(date(roster.year, roster.month, d)) for d in range(1, num_days + 1)]

    return {
        "team_id": roster.team_id,
        "year": roster.year,
        "month": roster.month,
        "shifts": [
            {"id": s.id, "code": s.code, "label": s.label,
             "start_time": s.start_time, "end_time": s.end_time,
             "duration_hours": s.duration_hours}
            for s in shifts
        ],
        "staff": [
            {"id": s.id, "employee_id": s.employee_id, "name": s.name,
             "role": s.role.value, "team_id": s.team_id}
            for s in staff
        ],
        "dates": dates,
    }


@router.post("/start", response_model=SolverStatusOut)
async def start_solver(payload: SolverStartRequest, db: AsyncSession = Depends(get_db)):
    roster = (await db.execute(
        select(MonthlyRoster).where(MonthlyRoster.id == payload.roster_id)
    )).scalar_one_or_none()
    if not roster:
        raise HTTPException(404, "Roster not found.")
    if roster.status == RosterStatus.PUBLISHED:
        raise HTTPException(400, "Roster is already published.")
    if roster.status == RosterStatus.SOLVING:
        raise HTTPException(400, "Solver is already running for this roster.")

    roster.status = RosterStatus.SOLVING
    await db.commit()

    roster_data = await _build_roster_data(roster, db)
    job_id = await solver_manager.start_solve(payload.roster_id, roster_data, SOLVER_TIME_LIMIT)

    # Register callback to persist solution when done.
    # Hold a reference in _background_tasks to prevent GC before the task finishes.
    task = asyncio.create_task(_persist_when_done(job_id, payload.roster_id))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return SolverStatusOut(job_id=job_id, roster_id=payload.roster_id, status="SOLVING")


async def _persist_when_done(job_id: str, roster_id: int):
    """Poll until solve completes, then write solution back to DB.

    Uses a fresh session — the request-scoped session has already been closed
    by the time the solver finishes (~30 s after the endpoint returned).
    """
    try:
        print(f"[persist] task started for roster {roster_id}", flush=True)
        while True:
            await asyncio.sleep(2)
            job = solver_manager.get_job(job_id)
            if not job or job.status in ("SOLVING_COMPLETED", "SOLVING_STOPPED", "ERROR"):
                break

        job = solver_manager.get_job(job_id)
        print(f"[persist] job status={job.status if job else 'None'} has_solution={bool(job and job.solution)}", flush=True)
        if not job or not job.solution:
            async with SessionLocal() as db:
                roster = (await db.execute(
                    select(MonthlyRoster).where(MonthlyRoster.id == roster_id)
                )).scalar_one_or_none()
                if roster:
                    roster.status = RosterStatus.DRAFT
                    await db.commit()
            return

        solution = job.solution
        print(f"[persist] writing {len(solution.assignments)} assignments to roster {roster_id}", flush=True)

        async with SessionLocal() as db:
            roster = (await db.execute(
                select(MonthlyRoster)
                .options(selectinload(MonthlyRoster.entries))
                .where(MonthlyRoster.id == roster_id)
            )).scalar_one_or_none()
            if not roster:
                return

            entry_map = {(e.staff_id, e.date): e for e in roster.entries}
            shift_map = {s["code"]: s["id"] for s in await _get_shifts(db)}

            for assignment in solution.assignments:
                key = (assignment.staff.id, assignment.date)
                entry = entry_map.get(key)
                if not entry:
                    entry = RosterEntry(
                        roster_id=roster_id,
                        staff_id=assignment.staff.id,
                        date=assignment.date,
                    )
                    db.add(entry)

                if assignment.assigned_shift:
                    entry.shift_id = shift_map.get(assignment.assigned_shift.code)
                    entry.entry_type = EntryType.ON_DUTY
                else:
                    entry.shift_id = None
                    entry.entry_type = EntryType.OFF
                # is_runner is left as-is; runners are designated via the Attendance page

            roster.status = RosterStatus.DRAFT
            await db.commit()
            print(f"[persist] roster {roster_id} persisted OK", flush=True)

    except Exception as exc:
        import traceback
        print(f"[persist] ERROR for roster {roster_id}: {exc}", flush=True)
        traceback.print_exc()


async def _get_shifts(db: AsyncSession) -> list[dict]:
    shifts = (await db.execute(select(Shift))).scalars().all()
    return [{"code": s.code, "id": s.id} for s in shifts]


@router.get("/status/{job_id}", response_model=SolverStatusOut)
async def solver_status(job_id: str):
    job = solver_manager.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    return SolverStatusOut(
        job_id=job.job_id,
        roster_id=job.roster_id,
        status=job.status,
        best_score=job.best_score,
        time_spent_seconds=round(job.time_spent_seconds, 1),
        error=job.error,
    )


@router.post("/stop/{job_id}", response_model=SolverStatusOut)
async def stop_solver(job_id: str):
    job = solver_manager.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    solver_manager.stop_job(job_id)
    return SolverStatusOut(
        job_id=job.job_id,
        roster_id=job.roster_id,
        status=job.status,
        best_score=job.best_score,
        time_spent_seconds=round(job.time_spent_seconds, 1),
    )


@router.post("/validate/{roster_id}")
async def validate_roster(roster_id: int, db: AsyncSession = Depends(get_db)):
    roster = (await db.execute(
        select(MonthlyRoster)
        .options(selectinload(MonthlyRoster.entries).selectinload(RosterEntry.shift))
        .where(MonthlyRoster.id == roster_id)
    )).scalar_one_or_none()
    if not roster:
        raise HTTPException(404, "Roster not found.")

    violations = validate_roster_entries(roster.entries)
    return {
        "roster_id": roster_id,
        "violation_count": len(violations),
        "hard_count": sum(1 for v in violations if v["severity"] == "HARD"),
        "soft_count": sum(1 for v in violations if v["severity"] == "SOFT"),
        "violations": violations,
    }
