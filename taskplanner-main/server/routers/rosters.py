import calendar
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import (
    EntryType, MonthlyRoster, RosterEntry, RosterStatus, Shift, Staff, SubDepartment, Team
)
from models.schemas import (
    BulkEntryUpdate, RosterCreate, RosterEntryUpdate, RosterOut,
    TeamDaySummaryOut, TeamDayUpdate, TeamMonthSummaryOut,
)
from routers.auth import require_admin

router = APIRouter(prefix="/api/rosters", tags=["rosters"], dependencies=[Depends(require_admin)])

# 12-day rotation cycle: S1,S1,S3,S3,OFF,OFF,S2,S2,S4,S4,OFF,OFF
# — 4 working days (2 shift blocks) then 2 off; repeats; covers all 4 shifts.
# SHORT_REST check: S3→S1 and S4→S3 forbidden; S1→S3 and S2→S4 are OK.
_ROTATION_CYCLE = ["S1", "S1", "S3", "S3", None, None, "S2", "S2", "S4", "S4", None, None]
_EPOCH = date(2026, 1, 1)   # position-0 anchor for T1 (first team by code order)


async def _get_roster_with_entries(roster_id: int, db: AsyncSession) -> MonthlyRoster:
    result = await db.execute(
        select(MonthlyRoster)
        .options(selectinload(MonthlyRoster.entries))
        .where(MonthlyRoster.id == roster_id)
    )
    roster = result.scalar_one_or_none()
    if not roster:
        raise HTTPException(404, "Roster not found.")
    return roster


@router.get("/overview", response_model=list[TeamMonthSummaryOut])
async def get_roster_overview(
    year: int,
    month: int,
    sub_dept_code: str = "NB",
    db: AsyncSession = Depends(get_db),
):
    """Compact team-shift summary for the all-teams overview grid."""
    sub_dept = (await db.execute(
        select(SubDepartment).where(SubDepartment.code == sub_dept_code)
    )).scalar_one_or_none()
    if not sub_dept:
        raise HTTPException(404, f"Sub-department '{sub_dept_code}' not found.")

    teams = (await db.execute(
        select(Team).where(Team.sub_department_id == sub_dept.id).order_by(Team.code)
    )).scalars().all()

    _, num_days = calendar.monthrange(year, month)
    all_dates = [date(year, month, d) for d in range(1, num_days + 1)]
    result = []

    for team in teams:
        roster = (await db.execute(
            select(MonthlyRoster).where(
                MonthlyRoster.team_id == team.id,
                MonthlyRoster.year == year,
                MonthlyRoster.month == month,
            )
        )).scalar_one_or_none()

        if not roster:
            result.append(TeamMonthSummaryOut(
                team_id=team.id, team_code=team.code, team_name=team.name,
                roster_id=None, status=None,
                days=[TeamDaySummaryOut(date=str(d)) for d in all_dates],
            ))
            continue

        staff_count = (await db.execute(
            select(func.count()).select_from(Staff)
            .where(Staff.team_id == team.id, Staff.is_active == True)
        )).scalar() or 0

        # Get dominant shift per day (GROUP BY date, shift_code, take highest count)
        rows = (await db.execute(
            select(
                RosterEntry.date,
                Shift.code.label("shift_code"),
                func.count().label("cnt"),
            )
            .join(Shift, RosterEntry.shift_id == Shift.id, isouter=True)
            .where(
                RosterEntry.roster_id == roster.id,
                RosterEntry.entry_type.in_([EntryType.ON_DUTY, EntryType.OT]),
            )
            .group_by(RosterEntry.date, Shift.code)
            .order_by(RosterEntry.date, func.count().desc())
        )).all()

        day_map: dict = {}
        for row in rows:
            d = row.date if isinstance(row.date, date) else date.fromisoformat(str(row.date))
            if d not in day_map:
                day_map[d] = (row.shift_code, row.cnt)

        days = []
        for d in all_dates:
            shift_code, on_duty = day_map.get(d, (None, 0))
            days.append(TeamDaySummaryOut(
                date=str(d), shift_code=shift_code,
                on_duty_count=on_duty, total_staff=staff_count,
            ))

        result.append(TeamMonthSummaryOut(
            team_id=team.id, team_code=team.code, team_name=team.name,
            roster_id=roster.id, status=roster.status, days=days,
        ))

    return result


@router.post("/initialize-all", status_code=201)
async def initialize_all_teams(
    year: int,
    month: int,
    sub_dept_code: str = "NB",
    db: AsyncSession = Depends(get_db),
):
    """Create blank (all-OFF) MonthlyRosters for every team that doesn't have one yet."""
    sub_dept = (await db.execute(
        select(SubDepartment).where(SubDepartment.code == sub_dept_code)
    )).scalar_one_or_none()
    if not sub_dept:
        raise HTTPException(404, f"Sub-department '{sub_dept_code}' not found.")

    teams = (await db.execute(
        select(Team).where(Team.sub_department_id == sub_dept.id).order_by(Team.code)
    )).scalars().all()

    _, num_days = calendar.monthrange(year, month)
    created: list[str] = []

    for team in teams:
        existing = (await db.execute(
            select(MonthlyRoster).where(
                MonthlyRoster.team_id == team.id,
                MonthlyRoster.year == year,
                MonthlyRoster.month == month,
            )
        )).scalar_one_or_none()
        if existing:
            continue

        roster = MonthlyRoster(team_id=team.id, year=year, month=month, status=RosterStatus.DRAFT)
        db.add(roster)
        await db.flush()

        staff_list = (await db.execute(
            select(Staff).where(Staff.team_id == team.id, Staff.is_active == True)
        )).scalars().all()

        for s in staff_list:
            for day in range(1, num_days + 1):
                db.add(RosterEntry(
                    roster_id=roster.id, staff_id=s.id,
                    date=date(year, month, day),
                    shift_id=None, entry_type=EntryType.OFF, is_runner=False,
                ))
        created.append(team.code)

    await db.commit()
    return {"created": created, "message": f"Initialized {len(created)} roster(s)."}


@router.post("/generate-rotation", status_code=200)
async def generate_rotation(
    year: int,
    month: int,
    sub_dept_code: str = "NB",
    db: AsyncSession = Depends(get_db),
):
    """Apply the 12-day balanced rotation (S1,S1,S3,S3,OFF,OFF,S2,S2,S4,S4,OFF,OFF)
    to all DRAFT rosters in a sub-department, ensuring 4 teams working / 2 off every day."""
    sub_dept = (await db.execute(
        select(SubDepartment).where(SubDepartment.code == sub_dept_code)
    )).scalar_one_or_none()
    if not sub_dept:
        raise HTTPException(404, f"Sub-department '{sub_dept_code}' not found.")

    teams = (await db.execute(
        select(Team).where(Team.sub_department_id == sub_dept.id).order_by(Team.code)
    )).scalars().all()

    shifts_by_code: dict[str, Shift] = {
        s.code: s for s in (await db.execute(select(Shift))).scalars().all()
    }

    _, num_days = calendar.monthrange(year, month)
    updated = 0

    for team_idx, team in enumerate(teams):
        cycle_offset = team_idx * 2   # 0, 2, 4, 6, 8, 10 …

        roster = (await db.execute(
            select(MonthlyRoster)
            .options(selectinload(MonthlyRoster.entries))
            .where(
                MonthlyRoster.team_id == team.id,
                MonthlyRoster.year == year,
                MonthlyRoster.month == month,
            )
        )).scalar_one_or_none()

        if not roster:
            # Auto-create if missing
            staff_list = (await db.execute(
                select(Staff).where(Staff.team_id == team.id, Staff.is_active == True)
            )).scalars().all()
            roster = MonthlyRoster(team_id=team.id, year=year, month=month, status=RosterStatus.DRAFT)
            db.add(roster)
            await db.flush()
            for s in staff_list:
                for day in range(1, num_days + 1):
                    db.add(RosterEntry(
                        roster_id=roster.id, staff_id=s.id,
                        date=date(year, month, day),
                        shift_id=None, entry_type=EntryType.OFF, is_runner=False,
                    ))
            await db.flush()
            roster = (await db.execute(
                select(MonthlyRoster)
                .options(selectinload(MonthlyRoster.entries))
                .where(MonthlyRoster.id == roster.id)
            )).scalar_one()

        if roster.status == RosterStatus.PUBLISHED:
            continue   # never touch a confirmed plan

        entry_by_date: dict[date, list[RosterEntry]] = {}
        for e in roster.entries:
            entry_by_date.setdefault(e.date, []).append(e)

        for day in range(1, num_days + 1):
            d = date(year, month, day)
            days_since_epoch = (d - _EPOCH).days
            cycle_pos = (days_since_epoch + cycle_offset) % 12
            shift_code = _ROTATION_CYCLE[cycle_pos]

            shift = shifts_by_code.get(shift_code) if shift_code else None
            entry_type = EntryType.ON_DUTY if shift else EntryType.OFF

            for entry in entry_by_date.get(d, []):
                entry.shift_id = shift.id if shift else None
                entry.entry_type = entry_type
                updated += 1

    await db.commit()
    return {"updated": updated, "message": f"Rotation generated for {year}-{month:02d}."}


@router.get("", response_model=list[RosterOut])
async def list_rosters(
    team_id: int | None = None,
    year: int | None = None,
    month: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(MonthlyRoster).options(selectinload(MonthlyRoster.entries))
    if team_id:
        q = q.where(MonthlyRoster.team_id == team_id)
    if year:
        q = q.where(MonthlyRoster.year == year)
    if month:
        q = q.where(MonthlyRoster.month == month)
    rosters = (await db.execute(q)).scalars().all()
    return rosters


@router.get("/{roster_id}", response_model=RosterOut)
async def get_roster(roster_id: int, db: AsyncSession = Depends(get_db)):
    return await _get_roster_with_entries(roster_id, db)


@router.post("", response_model=RosterOut, status_code=201)
async def create_roster(payload: RosterCreate, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(
        select(MonthlyRoster).where(
            MonthlyRoster.team_id == payload.team_id,
            MonthlyRoster.year == payload.year,
            MonthlyRoster.month == payload.month,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(400, "Roster already exists for this team/month.")

    roster = MonthlyRoster(
        team_id=payload.team_id,
        year=payload.year,
        month=payload.month,
        status=RosterStatus.DRAFT,
    )
    db.add(roster)
    await db.flush()

    # Create blank OFF entries for every staff × every day in the month
    staff_list = (await db.execute(
        select(Staff).where(Staff.team_id == payload.team_id, Staff.is_active == True)
    )).scalars().all()

    _, num_days = calendar.monthrange(payload.year, payload.month)
    for s in staff_list:
        for day in range(1, num_days + 1):
            db.add(RosterEntry(
                roster_id=roster.id,
                staff_id=s.id,
                date=date(payload.year, payload.month, day),
                shift_id=None,
                entry_type=EntryType.OFF,
                is_runner=False,
            ))

    await db.commit()
    return await _get_roster_with_entries(roster.id, db)


@router.put("/{roster_id}/entries", response_model=RosterOut)
async def bulk_update_entries(
    roster_id: int,
    payload: BulkEntryUpdate,
    db: AsyncSession = Depends(get_db),
):
    roster = await _get_roster_with_entries(roster_id, db)
    if roster.status == RosterStatus.PUBLISHED:
        raise HTTPException(400, "Cannot edit a published roster.")

    entry_map = {e.id: e for e in roster.entries}
    for upd in payload.updates:
        entry_id = upd.get("entry_id")
        entry = entry_map.get(entry_id)
        if not entry:
            continue
        update = RosterEntryUpdate(**{k: v for k, v in upd.items() if k != "entry_id"})
        for field, value in update.model_dump(exclude_unset=True).items():
            setattr(entry, field, value)

    await db.commit()
    return await _get_roster_with_entries(roster_id, db)


@router.put("/{roster_id}/team-day", response_model=RosterOut)
async def update_team_day(
    roster_id: int,
    payload: TeamDayUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Set ALL staff in a roster to the same shift on a given day (team-level planning)."""
    roster = await _get_roster_with_entries(roster_id, db)
    if roster.status == RosterStatus.PUBLISHED:
        raise HTTPException(400, "Cannot edit a confirmed roster.")

    shift: Shift | None = None
    if payload.shift_id is not None:
        shift = (await db.execute(
            select(Shift).where(Shift.id == payload.shift_id)
        )).scalar_one_or_none()
        if not shift:
            raise HTTPException(404, "Shift not found.")

    entry_type = EntryType.ON_DUTY if shift else EntryType.OFF
    for entry in roster.entries:
        if entry.date == payload.date:
            entry.shift_id = shift.id if shift else None
            entry.entry_type = entry_type

    await db.commit()
    return await _get_roster_with_entries(roster_id, db)


@router.post("/{roster_id}/publish", response_model=RosterOut)
async def publish_roster(roster_id: int, db: AsyncSession = Depends(get_db)):
    from solver.constraints import validate_roster_entries

    roster = await _get_roster_with_entries(roster_id, db)
    if roster.status == RosterStatus.PUBLISHED:
        raise HTTPException(400, "Already published.")
    if roster.status == RosterStatus.SOLVING:
        raise HTTPException(400, "Solver is still running. Wait for completion.")

    violations = validate_roster_entries(roster.entries)
    hard_violations = [v for v in violations if v["severity"] == "HARD"]
    if hard_violations:
        raise HTTPException(
            422,
            {"message": "Cannot publish: hard constraint violations exist.", "violations": hard_violations},
        )

    roster.status = RosterStatus.PUBLISHED
    await db.commit()
    return await _get_roster_with_entries(roster_id, db)
