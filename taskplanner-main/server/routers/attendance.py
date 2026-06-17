from datetime import date as DateType

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import MonthlyRoster, RosterEntry, Staff
from models.schemas import AttendanceEntryUpdate, RosterEntryOut
from routers.auth import require_admin

router = APIRouter(prefix="/api/attendance", tags=["attendance"], dependencies=[Depends(require_admin)])


@router.get("", response_model=list[RosterEntryOut])
async def get_daily_attendance(
    date: DateType,
    team_id: int,
    db: AsyncSession = Depends(get_db),
):
    roster = (await db.execute(
        select(MonthlyRoster).where(
            MonthlyRoster.team_id == team_id,
            MonthlyRoster.year == date.year,
            MonthlyRoster.month == date.month,
        )
    )).scalar_one_or_none()
    if not roster:
        return []

    entries = (await db.execute(
        select(RosterEntry)
        .options(selectinload(RosterEntry.staff))
        .where(RosterEntry.roster_id == roster.id, RosterEntry.date == date)
        .order_by(RosterEntry.staff_id)
    )).scalars().all()
    return entries


@router.put("/{entry_id}", response_model=RosterEntryOut)
async def update_attendance(
    entry_id: int,
    payload: AttendanceEntryUpdate,
    db: AsyncSession = Depends(get_db),
):
    entry = (await db.execute(
        select(RosterEntry).where(RosterEntry.id == entry_id)
    )).scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found.")

    data = payload.model_dump(exclude_unset=True)
    if "actual_entry_type" in data:
        entry.actual_entry_type = data["actual_entry_type"]
    if "is_runner" in data:
        entry.is_runner = data["is_runner"]
    await db.commit()
    await db.refresh(entry)
    return entry
