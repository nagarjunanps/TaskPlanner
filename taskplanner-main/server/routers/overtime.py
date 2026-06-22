from datetime import date as DateType, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import EntryType, MonthlyRoster, OTStatus, OTVolunteer, Role, RosterEntry, Shift, Staff
from models.schemas import OTVolunteerCreate, OTVolunteerOut
from routers.auth import require_admin

router = APIRouter(prefix="/api/overtime", tags=["overtime"], dependencies=[Depends(require_admin)])

MAX_OT_SLOTS_PER_SHIFT = 6   # H7: max 6 volunteers pulled per shift per day
MIN_REST_HOURS = 10          # H9: minimum rest before OT can start


def _time_to_minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


async def _on_duty_entry(db: AsyncSession, team_id: int, staff_id: int, d: DateType) -> RosterEntry | None:
    roster = (await db.execute(
        select(MonthlyRoster).where(
            MonthlyRoster.team_id == team_id, MonthlyRoster.year == d.year, MonthlyRoster.month == d.month,
        )
    )).scalar_one_or_none()
    if not roster:
        return None
    return (await db.execute(
        select(RosterEntry)
        .options(selectinload(RosterEntry.shift))
        .where(RosterEntry.roster_id == roster.id, RosterEntry.staff_id == staff_id, RosterEntry.date == d)
    )).scalar_one_or_none()


@router.get("/volunteers", response_model=list[OTVolunteerOut])
async def list_volunteers(date: DateType, db: AsyncSession = Depends(get_db)):
    volunteers = (await db.execute(
        select(OTVolunteer)
        .where(OTVolunteer.date == date)
        .order_by(OTVolunteer.signed_up_at)
    )).scalars().all()
    return volunteers


@router.post("/volunteers", response_model=OTVolunteerOut, status_code=201)
async def signup_volunteer(payload: OTVolunteerCreate, db: AsyncSession = Depends(get_db)):
    # Check staff exists and is active
    staff = (await db.execute(
        select(Staff).where(Staff.id == payload.staff_id, Staff.is_active == True)  # noqa: E712
    )).scalar_one_or_none()
    if not staff:
        raise HTTPException(404, "Staff not found or inactive.")

    shift = (await db.execute(select(Shift).where(Shift.id == payload.shift_id))).scalar_one_or_none()
    if not shift:
        raise HTTPException(404, "Shift not found.")

    # Prevent duplicate signup
    duplicate = (await db.execute(
        select(OTVolunteer).where(
            OTVolunteer.staff_id == payload.staff_id,
            OTVolunteer.date == payload.date,
        )
    )).scalar_one_or_none()
    if duplicate:
        raise HTTPException(400, "Staff already signed up for OT on this date.")

    # H9: per ramp rostering policy, OT is for staff who are OFF that day —
    # a same-day shift leaves no way to get a minimum 10h rest break in
    # before OT starts, so staff already ON_DUTY (any shift length) on the
    # requested date are not eligible. Marked MC/EL (absent) is also not
    # eligible — not actually present to work.
    today_entry = await _on_duty_entry(db, staff.team_id, payload.staff_id, payload.date)
    if today_entry:
        effective = today_entry.actual_entry_type if today_entry.actual_entry_type is not None else today_entry.entry_type
        if effective in (EntryType.MC, EntryType.EL):
            raise HTTPException(
                400, f"{staff.name} is marked {effective.value} on {payload.date} — not eligible for OT."
            )
        if effective == EntryType.ON_DUTY:
            raise HTTPException(
                400,
                f"{staff.name} is rostered ON_DUTY on {payload.date} — OT requires a minimum "
                f"{MIN_REST_HOURS}h rest break beforehand, so OT and a same-day shift can't combine.",
            )

    # H9b: also check the previous day's shift for the same rest requirement
    # — e.g. an S4 night shift (23:00–11:00) is recorded under its start
    # date but runs into the small hours of `payload.date`, so it must be
    # checked too even though it won't show up as "today" above.
    prev_entry = await _on_duty_entry(db, staff.team_id, payload.staff_id, payload.date - timedelta(days=1))
    if prev_entry and prev_entry.shift:
        prev_effective = prev_entry.actual_entry_type if prev_entry.actual_entry_type is not None else prev_entry.entry_type
        if prev_effective == EntryType.ON_DUTY:
            # Rest is measured against the actual start time of the requested OT
            # shift, not midnight — a prev-day shift ending at 11:00 leaves 12h
            # of rest before a 23:00 OT start, even though its raw end-of-shift
            # minute count (start + duration) spills past 1440 into `payload.date`.
            prev_shift_end_min = (
                _time_to_minutes(prev_entry.shift.start_time) + prev_entry.shift.duration_hours * 60
            )
            ot_start_min = _time_to_minutes(shift.start_time)
            rest_hours = (ot_start_min + 1440 - prev_shift_end_min) / 60
            if rest_hours < MIN_REST_HOURS:
                raise HTTPException(
                    400,
                    f"{staff.name} finishes a shift the day before {payload.date} with only "
                    f"~{max(0, rest_hours):.1f}h rest before the {shift.code} OT shift starts — needs at least "
                    f"{MIN_REST_HOURS}h rest before OT.",
                )

    # H7: max 6 OT slots per shift per day (count PENDING + APPROVED for that date+shift)
    active_count = (await db.execute(
        select(func.count()).where(
            OTVolunteer.date == payload.date,
            OTVolunteer.shift_id == payload.shift_id,
            OTVolunteer.status.in_([OTStatus.PENDING, OTStatus.APPROVED]),
        )
    )).scalar()
    if active_count >= MAX_OT_SLOTS_PER_SHIFT:
        raise HTTPException(
            400, f"OT volunteer slots full for {shift.code} on {payload.date} (max {MAX_OT_SLOTS_PER_SHIFT})."
        )

    volunteer = OTVolunteer(staff_id=payload.staff_id, shift_id=payload.shift_id, date=payload.date)
    db.add(volunteer)
    await db.commit()
    await db.refresh(volunteer)
    return volunteer


@router.put("/volunteers/{volunteer_id}/approve", response_model=OTVolunteerOut)
async def approve_volunteer(volunteer_id: int, approver_id: int, db: AsyncSession = Depends(get_db)):
    vol = (await db.execute(select(OTVolunteer).where(OTVolunteer.id == volunteer_id))).scalar_one_or_none()
    if not vol:
        raise HTTPException(404, "Volunteer record not found.")
    if vol.status != OTStatus.PENDING:
        raise HTTPException(400, f"Volunteer record is already {vol.status.value}.")

    # H8: only an active Duty Manager can approve OT.
    approver = (await db.execute(
        select(Staff).where(Staff.id == approver_id, Staff.is_active == True)  # noqa: E712
    )).scalar_one_or_none()
    if not approver or approver.role != Role.DM:
        raise HTTPException(400, "Approver must be an active Duty Manager (DM).")

    vol.status = OTStatus.APPROVED
    vol.approved_by = approver_id
    await db.commit()
    await db.refresh(vol)
    return vol


@router.put("/volunteers/{volunteer_id}/reject", response_model=OTVolunteerOut)
async def reject_volunteer(volunteer_id: int, db: AsyncSession = Depends(get_db)):
    vol = (await db.execute(select(OTVolunteer).where(OTVolunteer.id == volunteer_id))).scalar_one_or_none()
    if not vol:
        raise HTTPException(404, "Volunteer record not found.")
    if vol.status != OTStatus.PENDING:
        raise HTTPException(400, f"Volunteer record is already {vol.status.value}.")
    vol.status = OTStatus.REJECTED
    await db.commit()
    await db.refresh(vol)
    return vol
