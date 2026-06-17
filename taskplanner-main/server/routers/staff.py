from datetime import date as DateType

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import (
    EntryType, MonthlyRoster, Role, RosterEntry,
    Staff, TaskAssignment, Team, Turnaround,
)
from models.schemas import (
    StaffCreate, StaffOut, StaffRosterDayOut, StaffTaskOut, StaffUpdate,
)
from routers.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/staff", tags=["staff"])


def _require_self_or_admin(staff_id: int, user: dict) -> None:
    """Staff may only view their own tasks/roster; admins may view anyone's."""
    if not user.get("is_admin") and user.get("staff_id") != staff_id:
        raise HTTPException(status_code=403, detail="Cannot view another staff member's data.")


@router.get("", response_model=list[StaffOut], dependencies=[Depends(require_admin)])
async def list_staff(
    team_id: int | None = None,
    role: Role | None = None,
    active: bool | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Staff)
    if team_id is not None:
        q = q.where(Staff.team_id == team_id)
    if role is not None:
        q = q.where(Staff.role == role)
    if active is not None:
        q = q.where(Staff.is_active == active)
    staff = (await db.execute(q.order_by(Staff.team_id, Staff.role, Staff.name))).scalars().all()
    return staff


# Static sub-paths BEFORE /{staff_id} to avoid route collision

@router.get("/{staff_id}/tasks", response_model=list[StaffTaskOut])
async def get_staff_tasks(
    staff_id: int,
    date: DateType,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    _require_self_or_admin(staff_id, user)
    rows = (await db.execute(
        select(TaskAssignment)
        .options(
            selectinload(TaskAssignment.turnaround).options(
                selectinload(Turnaround.arrival_flight),
                selectinload(Turnaround.departure_flight),
            )
        )
        .join(Turnaround, TaskAssignment.turnaround_id == Turnaround.id)
        .where(
            TaskAssignment.staff_id == staff_id,
            Turnaround.scheduled_date == date,
        )
        .order_by(Turnaround.id, TaskAssignment.task_role, TaskAssignment.set_number, TaskAssignment.slot_index)
    )).scalars().all()

    result = []
    for ta in rows:
        t = ta.turnaround
        arr = t.arrival_flight if t else None
        dep = t.departure_flight if t else None
        result.append(StaffTaskOut(
            assignment_id=ta.id,
            turnaround_id=ta.turnaround_id,
            task_role=ta.task_role,
            set_number=ta.set_number,
            slot_index=ta.slot_index,
            aircraft_registration=t.aircraft_registration if t else None,
            aircraft_type=arr.aircraft_type if arr else (dep.aircraft_type if dep else None),
            bay=dep.bay if dep else (arr.bay if arr else None),
            arr_flight_number=arr.flight_number if arr else None,
            arr_time=arr.scheduled_time if arr else None,
            dep_flight_number=dep.flight_number if dep else None,
            dep_time=dep.scheduled_time if dep else None,
            ground_time_minutes=t.ground_time_minutes if t else None,
        ))
    return result


@router.get("/{staff_id}/roster", response_model=list[StaffRosterDayOut])
async def get_staff_roster(
    staff_id: int,
    year: int,
    month: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    _require_self_or_admin(staff_id, user)
    entries = (await db.execute(
        select(RosterEntry)
        .options(selectinload(RosterEntry.shift))
        .join(MonthlyRoster, RosterEntry.roster_id == MonthlyRoster.id)
        .where(
            RosterEntry.staff_id == staff_id,
            MonthlyRoster.year == year,
            MonthlyRoster.month == month,
        )
        .order_by(RosterEntry.date)
    )).scalars().all()

    return [
        StaffRosterDayOut(
            date=str(e.date),
            entry_type=e.actual_entry_type if e.actual_entry_type is not None else e.entry_type,
            shift_code=e.shift.code if e.shift else None,
            shift_label=e.shift.label if e.shift else None,
            is_runner=e.is_runner,
        )
        for e in entries
    ]


@router.post("", response_model=StaffOut, status_code=201, dependencies=[Depends(require_admin)])
async def create_staff(payload: StaffCreate, db: AsyncSession = Depends(get_db)):
    team = (await db.execute(select(Team).where(Team.id == payload.team_id))).scalar_one_or_none()
    if not team:
        raise HTTPException(404, "Team not found.")
    existing = (await db.execute(select(Staff).where(Staff.employee_id == payload.employee_id))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, f"Employee ID '{payload.employee_id}' already exists.")
    staff = Staff(**payload.model_dump(), is_active=True)
    db.add(staff)
    await db.commit()
    await db.refresh(staff)
    return staff


@router.put("/{staff_id}", response_model=StaffOut, dependencies=[Depends(require_admin)])
async def update_staff(staff_id: int, payload: StaffUpdate, db: AsyncSession = Depends(get_db)):
    staff = (await db.execute(select(Staff).where(Staff.id == staff_id))).scalar_one_or_none()
    if not staff:
        raise HTTPException(404, "Staff not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(staff, field, value)
    await db.commit()
    await db.refresh(staff)
    return staff


@router.delete("/{staff_id}", status_code=204, dependencies=[Depends(require_admin)])
async def deactivate_staff(staff_id: int, db: AsyncSession = Depends(get_db)):
    staff = (await db.execute(select(Staff).where(Staff.id == staff_id))).scalar_one_or_none()
    if not staff:
        raise HTTPException(404, "Staff not found.")
    staff.is_active = False
    await db.commit()
