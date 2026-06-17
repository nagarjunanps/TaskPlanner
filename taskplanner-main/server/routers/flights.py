from datetime import date as DateType

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import Flight, FlightDirection, Staff, TaskAssignment, Turnaround
from models.schemas import (
    ConflictInfo, FlightImpactOut, FlightOut, FlightUpdate,
    TurnaroundOut, TurnaroundUpdate,
)
from routers.auth import require_admin
from services.flight_data import get_provider
from services.llm_advisor import analyze_impact

router = APIRouter(prefix="/api/flights", tags=["flights"], dependencies=[Depends(require_admin)])


def _time_to_minutes(t: str) -> int:
    """Convert 'HH:MM' to minutes from midnight."""
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _required_sets_from_cargo(cargo_tons: float | None) -> int:
    if cargo_tons is None:
        return 1
    if cargo_tons < 1.5:
        return 1
    if cargo_tons < 10.0:
        return 2
    return 3


@router.get("", response_model=list[FlightOut])
async def get_flights(
    date: DateType,
    station: str = "KUL",
    db: AsyncSession = Depends(get_db),
):
    try:
        provider = get_provider()
        raw_flights = provider.fetch_flights(station, date)
        for raw in raw_flights:
            direction = FlightDirection(raw["direction"])
            # Ensure scheduled_date is a date object, not a string
            sched_date = raw["scheduled_date"]
            if isinstance(sched_date, str):
                from datetime import date as _date
                sched_date = _date.fromisoformat(sched_date)
            stmt = sqlite_insert(Flight).values(
                flight_number=raw["flight_number"],
                airline=raw.get("airline", "AK"),
                station=raw.get("station", station),
                scheduled_date=sched_date,
                direction=direction,
                scheduled_time=raw["scheduled_time"],
                estimated_time=raw.get("estimated_time"),
                aircraft_registration=raw.get("aircraft_registration"),
                aircraft_type=raw.get("aircraft_type", "A320"),
                bay=raw.get("bay"),
                cargo_weight_tons=raw.get("cargo_weight_tons"),
                status=raw.get("status", "SCHEDULED"),
                raw_json=raw.get("raw_json"),
            ).on_conflict_do_update(
                index_elements=["flight_number", "scheduled_date", "direction"],
                set_={
                    "estimated_time": raw.get("estimated_time"),
                    "bay": raw.get("bay"),
                    "cargo_weight_tons": raw.get("cargo_weight_tons"),
                    "status": raw.get("status", "SCHEDULED"),
                },
            )
            await db.execute(stmt)
        await db.commit()
    except Exception as exc:
        print(f"[flights] Provider upsert failed: {exc} — serving cached data.")
        await db.rollback()

    rows = (await db.execute(
        select(Flight).where(Flight.scheduled_date == date, Flight.station == station)
        .order_by(Flight.scheduled_time)
    )).scalars().all()
    return rows


@router.get("/turnarounds", response_model=list[TurnaroundOut])
async def get_turnarounds(
    date: DateType,
    station: str = "KUL",
    db: AsyncSession = Depends(get_db),
):
    # Always fetch fresh data from the provider first, then build turnarounds
    try:
        provider = get_provider()
        raw_flights = provider.fetch_flights(station, date)
        for raw in raw_flights:
            direction = FlightDirection(raw["direction"])
            stmt = sqlite_insert(Flight).values(
                flight_number=raw["flight_number"],
                airline=raw.get("airline", "AK"),
                station=raw.get("station", station),
                scheduled_date=raw["scheduled_date"],
                direction=direction,
                scheduled_time=raw["scheduled_time"],
                estimated_time=raw.get("estimated_time"),
                aircraft_registration=raw.get("aircraft_registration"),
                aircraft_type=raw.get("aircraft_type", "A320"),
                bay=raw.get("bay"),
                cargo_weight_tons=raw.get("cargo_weight_tons"),
                status=raw.get("status", "SCHEDULED"),
                raw_json=raw.get("raw_json"),
            ).on_conflict_do_update(
                index_elements=["flight_number", "scheduled_date", "direction"],
                set_={
                    "estimated_time": raw.get("estimated_time"),
                    "bay": raw.get("bay"),
                    "cargo_weight_tons": raw.get("cargo_weight_tons"),
                    "status": raw.get("status", "SCHEDULED"),
                },
            )
            await db.execute(stmt)
        await db.commit()
    except Exception as exc:
        print(f"[flights] Provider fetch failed: {exc} — serving cached data.")

    flights = (await db.execute(
        select(Flight).where(Flight.scheduled_date == date, Flight.station == station)
    )).scalars().all()

    arrivals = {f.aircraft_registration: f for f in flights if f.direction == FlightDirection.ARRIVAL and f.aircraft_registration}
    departures = {f.aircraft_registration: f for f in flights if f.direction == FlightDirection.DEPARTURE and f.aircraft_registration}

    regs = set(arrivals) | set(departures)
    for reg in regs:
        arr = arrivals.get(reg)
        dep = departures.get(reg)
        cargo = (arr.cargo_weight_tons if arr else None) or (dep.cargo_weight_tons if dep else None)
        ground_min: int | None = None
        if arr and dep:
            ground_min = _time_to_minutes(dep.scheduled_time) - _time_to_minutes(arr.scheduled_time)

        stmt = sqlite_insert(Turnaround).values(
            scheduled_date=date,
            station=station,
            aircraft_registration=reg,
            arrival_flight_id=arr.id if arr else None,
            departure_flight_id=dep.id if dep else None,
            ground_time_minutes=ground_min,
            cargo_weight_tons=cargo,
            required_sets=_required_sets_from_cargo(cargo),
        ).on_conflict_do_update(
            index_elements=["scheduled_date", "station", "aircraft_registration"],
            set_={
                "arrival_flight_id": arr.id if arr else None,
                "departure_flight_id": dep.id if dep else None,
                "ground_time_minutes": ground_min,
                "cargo_weight_tons": cargo,
            },
        )
        await db.execute(stmt)

    await db.commit()

    rows = (await db.execute(
        select(Turnaround)
        .options(selectinload(Turnaround.arrival_flight), selectinload(Turnaround.departure_flight))
        .where(Turnaround.scheduled_date == date, Turnaround.station == station)
    )).scalars().all()
    return rows


@router.put("/turnarounds/{turnaround_id}", response_model=TurnaroundOut)
async def update_turnaround(
    turnaround_id: int,
    payload: TurnaroundUpdate,
    db: AsyncSession = Depends(get_db),
):
    ta = (await db.execute(
        select(Turnaround)
        .options(selectinload(Turnaround.arrival_flight), selectinload(Turnaround.departure_flight))
        .where(Turnaround.id == turnaround_id)
    )).scalar_one_or_none()
    if not ta:
        raise HTTPException(404, "Turnaround not found.")

    data = payload.model_dump(exclude_unset=True)
    if "cargo_weight_tons" in data:
        ta.cargo_weight_tons = data["cargo_weight_tons"]
        if "required_sets" not in data:
            ta.required_sets = _required_sets_from_cargo(data["cargo_weight_tons"])
    if "required_sets" in data:
        ta.required_sets = data["required_sets"]

    await db.commit()
    await db.refresh(ta)
    return ta


# ── Flight edit + impact analysis ────────────────────────────────────────────

@router.put("/{flight_id}", response_model=FlightOut)
async def update_flight(
    flight_id: int,
    payload: FlightUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a flight's estimated time, bay, or status.
    Also recalculates the linked turnaround's ground_time_minutes when time changes.
    """
    flight = (await db.execute(
        select(Flight).where(Flight.id == flight_id)
    )).scalar_one_or_none()
    if not flight:
        raise HTTPException(404, "Flight not found.")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(flight, field, value)
    await db.commit()

    # Recompute turnaround ground time if a time changed
    if "scheduled_time" in data or "estimated_time" in data:
        ta = (await db.execute(
            select(Turnaround)
            .options(selectinload(Turnaround.arrival_flight), selectinload(Turnaround.departure_flight))
            .where(
                (Turnaround.arrival_flight_id == flight_id)
                | (Turnaround.departure_flight_id == flight_id)
            )
        )).scalar_one_or_none()
        if ta and ta.arrival_flight and ta.departure_flight:
            arr_time = ta.arrival_flight.estimated_time or ta.arrival_flight.scheduled_time
            dep_time = ta.departure_flight.estimated_time or ta.departure_flight.scheduled_time
            ta.ground_time_minutes = _time_to_minutes(dep_time) - _time_to_minutes(arr_time)
            await db.commit()

    await db.refresh(flight)
    return flight


@router.post("/{flight_id}/check-impact", response_model=FlightImpactOut)
async def check_flight_impact(
    flight_id: int,
    current_time: str = "00:00",   # "HH:MM" — used to determine what is 'upcoming'
    db: AsyncSession = Depends(get_db),
):
    """After a flight change, detect assignment conflicts and ask the LLM whether
    to trigger a replan of upcoming turnarounds.
    """
    flight = (await db.execute(
        select(Flight).where(Flight.id == flight_id)
    )).scalar_one_or_none()
    if not flight:
        raise HTTPException(404, "Flight not found.")

    # Find the associated turnaround
    ta = (await db.execute(
        select(Turnaround)
        .options(selectinload(Turnaround.arrival_flight), selectinload(Turnaround.departure_flight))
        .where(
            (Turnaround.arrival_flight_id == flight_id)
            | (Turnaround.departure_flight_id == flight_id)
        )
    )).scalar_one_or_none()

    if not ta:
        return FlightImpactOut(flight_id=flight_id, llm_reason="No turnaround linked to this flight.")

    # Effective time window for this turnaround (use estimated if set)
    def _eff_time(f: Flight | None) -> str | None:
        return (f.estimated_time or f.scheduled_time) if f else None

    arr_time = _eff_time(ta.arrival_flight)
    dep_time = _eff_time(ta.departure_flight)
    ta_sta = _time_to_minutes(arr_time) if arr_time else 0
    ta_std = _time_to_minutes(dep_time) if dep_time else ta_sta + 45
    ta_window_start = ta_sta - 15
    ta_window_end   = ta_std

    now_min = _time_to_minutes(current_time)

    # How many turnarounds on the same date are upcoming (STA >= now)
    all_tas = (await db.execute(
        select(Turnaround)
        .options(selectinload(Turnaround.arrival_flight))
        .where(Turnaround.scheduled_date == ta.scheduled_date)
    )).scalars().all()
    upcoming_count = sum(
        1 for t in all_tas
        if t.arrival_flight
        and _time_to_minutes(t.arrival_flight.estimated_time or t.arrival_flight.scheduled_time) >= now_min
    )

    # Get all assignments for this turnaround and the staff on them
    ta_assignments = (await db.execute(
        select(TaskAssignment)
        .options(selectinload(TaskAssignment.staff))
        .where(TaskAssignment.turnaround_id == ta.id)
    )).scalars().all()

    staff_ids = {a.staff_id for a in ta_assignments if a.staff_id}
    if not staff_ids:
        # No existing assignments — nothing to conflict with
        llm = analyze_impact(
            {"flight_number": flight.flight_number, "direction": flight.direction.value,
             "aircraft_registration": flight.aircraft_registration, "bay": flight.bay,
             "scheduled_time": flight.scheduled_time, "estimated_time": flight.estimated_time},
            [],
            current_time,
            upcoming_count,
        )
        return FlightImpactOut(
            flight_id=flight_id,
            turnaround_id=ta.id,
            conflicts=[],
            upcoming_count=upcoming_count,
            **llm,
        )

    # Get all other assignments for the same staff on the same date
    other_assignments = (await db.execute(
        select(TaskAssignment)
        .options(
            selectinload(TaskAssignment.staff),
            selectinload(TaskAssignment.turnaround).selectinload(Turnaround.arrival_flight),
            selectinload(TaskAssignment.turnaround).selectinload(Turnaround.departure_flight),
        )
        .join(Turnaround, TaskAssignment.turnaround_id == Turnaround.id)
        .where(
            TaskAssignment.staff_id.in_(staff_ids),
            TaskAssignment.turnaround_id != ta.id,
            Turnaround.scheduled_date == ta.scheduled_date,
        )
    )).scalars().all()

    # Check conflicts
    conflicts: list[ConflictInfo] = []
    seen_pairs: set[tuple[int, int]] = set()   # (staff_id, other_ta_id) to deduplicate

    def _ta_window(asgn: TaskAssignment) -> tuple[int, int]:
        t = asgn.turnaround
        arr = t.arrival_flight
        dep = t.departure_flight
        sta = _time_to_minutes((arr.estimated_time or arr.scheduled_time) if arr else "00:00")
        std = _time_to_minutes((dep.estimated_time or dep.scheduled_time) if dep else "00:45")
        return sta - 15, std

    for other in other_assignments:
        if not other.staff_id or not other.turnaround:
            continue
        key = (other.staff_id, other.turnaround_id)
        if key in seen_pairs:
            continue
        seen_pairs.add(key)

        o_start, o_end = _ta_window(other)
        staff_name = other.staff.name if other.staff else f"Staff {other.staff_id}"

        # Double-booking: windows overlap
        if ta_window_start < o_end and o_start < ta_window_end:
            o_arr = other.turnaround.arrival_flight
            o_dep = other.turnaround.departure_flight
            o_fn  = (o_arr.flight_number if o_arr else None) or (o_dep.flight_number if o_dep else "?")
            ow_start_str = f"{(o_start+15)//60:02d}:{(o_start+15)%60:02d}"
            ow_end_str   = f"{o_end//60:02d}:{o_end%60:02d}"
            conflicts.append(ConflictInfo(
                staff_id=other.staff_id,
                staff_name=staff_name,
                conflict_type="double_booking",
                description=(
                    f"Double-booked with {other.turnaround.aircraft_registration or o_fn} "
                    f"{ow_start_str}–{ow_end_str}"
                ),
                turnaround_id=ta.id,
            ))
            continue

        # Travel gap: sequential non-overlapping assignments
        if ta_std <= o_start + 15:
            # ta finishes first → other starts after; gap = (other_STA-15) - ta_STD
            gap = o_start - ta_window_end   # o_start is already (other_STA - 15)
            ta_bay   = (ta.departure_flight.bay if ta.departure_flight else None) or \
                       (ta.arrival_flight.bay if ta.arrival_flight else "")
            o_bay    = (other.turnaround.departure_flight.bay if other.turnaround.departure_flight else None) or \
                       (other.turnaround.arrival_flight.bay if other.turnaround.arrival_flight else "")
            ta_sec   = ta_bay[0].upper() if ta_bay and ta_bay[0].isalpha() else ""
            o_sec    = o_bay[0].upper() if o_bay and o_bay[0].isalpha() else ""
            need     = 3 if (not ta_sec or not o_sec or ta_sec == o_sec) else min(5 + abs(ord(ta_sec) - ord(o_sec)) * 4, 15)
            if gap < need and gap >= 0:
                conflicts.append(ConflictInfo(
                    staff_id=other.staff_id,
                    staff_name=staff_name,
                    conflict_type="travel_gap",
                    description=f"Only {gap} min gap to reach bay {o_bay or '?'} "
                                f"from bay {ta_bay or '?'} (need {need} min)",
                    turnaround_id=ta.id,
                ))
        elif o_end <= ta_window_start:
            # other finishes → ta starts: same check reversed
            gap  = ta_window_start - o_end
            ta_bay = (ta.arrival_flight.bay if ta.arrival_flight else None) or ""
            o_bay  = (other.turnaround.departure_flight.bay if other.turnaround.departure_flight else None) or \
                     (other.turnaround.arrival_flight.bay if other.turnaround.arrival_flight else "")
            ta_sec = ta_bay[0].upper() if ta_bay and ta_bay[0].isalpha() else ""
            o_sec  = o_bay[0].upper() if o_bay and o_bay[0].isalpha() else ""
            need   = 3 if (not ta_sec or not o_sec or ta_sec == o_sec) else min(5 + abs(ord(ta_sec) - ord(o_sec)) * 4, 15)
            if gap < need and gap >= 0:
                conflicts.append(ConflictInfo(
                    staff_id=other.staff_id,
                    staff_name=staff_name,
                    conflict_type="travel_gap",
                    description=f"Only {gap} min gap after bay {o_bay or '?'} "
                                f"to reach bay {ta_bay or '?'} (need {need} min)",
                    turnaround_id=ta.id,
                ))

    # Call LLM advisor
    flight_dict = {
        "flight_number": flight.flight_number,
        "direction": flight.direction.value,
        "aircraft_registration": flight.aircraft_registration,
        "scheduled_time": flight.scheduled_time,
        "estimated_time": flight.estimated_time,
        "bay": flight.bay,
    }
    llm = analyze_impact(flight_dict, [c.model_dump() for c in conflicts], current_time, upcoming_count)

    return FlightImpactOut(
        flight_id=flight_id,
        turnaround_id=ta.id,
        conflicts=conflicts,
        upcoming_count=upcoming_count,
        should_replan=llm["should_replan"],
        llm_reason=llm["reason"],
        llm_urgency=llm["urgency"],
    )
