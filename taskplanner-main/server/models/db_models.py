from datetime import date, datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Role(str, PyEnum):
    DM = "DM"
    RLS = "RLS"
    RA = "RA"


class RosterStatus(str, PyEnum):
    DRAFT = "DRAFT"
    SOLVING = "SOLVING"
    PUBLISHED = "PUBLISHED"


class EntryType(str, PyEnum):
    ON_DUTY = "ON_DUTY"
    OFF = "OFF"
    MC = "MC"
    EL = "EL"
    OT = "OT"


class OTStatus(str, PyEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class FlightDirection(str, PyEnum):
    ARRIVAL = "ARRIVAL"
    DEPARTURE = "DEPARTURE"


class TaskRole(str, PyEnum):
    RLS = "RLS"
    TOWER = "TOWER"
    DRIVER = "DRIVER"
    LOADER = "LOADER"


class AssignmentSource(str, PyEnum):
    SOLVER = "SOLVER"
    MANUAL = "MANUAL"


class CertStatus(str, PyEnum):
    ACTIVE = "ACTIVE"
    EXPIRING_SOON = "EXPIRING_SOON"
    EXPIRED = "EXPIRED"
    SUSPENDED = "SUSPENDED"


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)  # RAMP, PAX
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    sub_departments: Mapped[list["SubDepartment"]] = relationship("SubDepartment", back_populates="department")


class SubDepartment(Base):
    __tablename__ = "sub_departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)  # NB, WB, TECHRAMP, ...
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"), nullable=False)

    department: Mapped["Department"] = relationship("Department", back_populates="sub_departments")
    teams: Mapped[list["Team"]] = relationship("Team", back_populates="sub_department")


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)  # T1…T6
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sub_department_id: Mapped[int] = mapped_column(ForeignKey("sub_departments.id"), nullable=False)

    sub_department: Mapped["SubDepartment"] = relationship("SubDepartment", back_populates="teams")
    staff: Mapped[list["Staff"]] = relationship("Staff", back_populates="team")
    rosters: Mapped[list["MonthlyRoster"]] = relationship("MonthlyRoster", back_populates="team")


class Staff(Base):
    __tablename__ = "staff"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    role: Mapped[Role] = mapped_column(Enum(Role), nullable=False)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    team: Mapped["Team"] = relationship("Team", back_populates="staff")
    roster_entries: Mapped[list["RosterEntry"]] = relationship("RosterEntry", back_populates="staff")
    ot_volunteers: Mapped[list["OTVolunteer"]] = relationship("OTVolunteer", back_populates="staff")


class Shift(Base):
    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(5), unique=True, nullable=False)  # S1-S4
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)   # "05:00"
    end_time: Mapped[str] = mapped_column(String(5), nullable=False)     # "15:00"
    duration_hours: Mapped[int] = mapped_column(Integer, nullable=False)

    roster_entries: Mapped[list["RosterEntry"]] = relationship("RosterEntry", back_populates="shift")


class MonthlyRoster(Base):
    __tablename__ = "monthly_rosters"
    __table_args__ = (UniqueConstraint("team_id", "year", "month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[RosterStatus] = mapped_column(Enum(RosterStatus), default=RosterStatus.DRAFT)

    team: Mapped["Team"] = relationship("Team", back_populates="rosters")
    entries: Mapped[list["RosterEntry"]] = relationship(
        "RosterEntry", back_populates="roster", cascade="all, delete-orphan"
    )


class RosterEntry(Base):
    __tablename__ = "roster_entries"
    __table_args__ = (UniqueConstraint("roster_id", "staff_id", "date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    roster_id: Mapped[int] = mapped_column(ForeignKey("monthly_rosters.id"), nullable=False)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shifts.id"), nullable=True)
    entry_type: Mapped[EntryType] = mapped_column(Enum(EntryType), default=EntryType.OFF)
    actual_entry_type: Mapped[EntryType | None] = mapped_column(Enum(EntryType), nullable=True)
    is_runner: Mapped[bool] = mapped_column(Boolean, default=False)

    roster: Mapped["MonthlyRoster"] = relationship("MonthlyRoster", back_populates="entries")
    staff: Mapped["Staff"] = relationship("Staff", back_populates="roster_entries")
    shift: Mapped["Shift | None"] = relationship("Shift", back_populates="roster_entries")


class OTVolunteer(Base):
    __tablename__ = "ot_volunteers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    signed_up_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    approved_by: Mapped[int | None] = mapped_column(Integer, nullable=True)  # Staff.id of approving DM
    status: Mapped[OTStatus] = mapped_column(Enum(OTStatus), default=OTStatus.PENDING)

    staff: Mapped["Staff"] = relationship(
        "Staff", back_populates="ot_volunteers", foreign_keys="[OTVolunteer.staff_id]"
    )


# ── Flight & Turnaround ───────────────────────────────────────────────────────

class Flight(Base):
    __tablename__ = "flights"
    __table_args__ = (UniqueConstraint("flight_number", "scheduled_date", "direction"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    flight_number: Mapped[str] = mapped_column(String(20), nullable=False)
    airline: Mapped[str] = mapped_column(String(10), nullable=False, default="AK")
    station: Mapped[str] = mapped_column(String(10), nullable=False, default="KUL")
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    direction: Mapped[FlightDirection] = mapped_column(Enum(FlightDirection), nullable=False)
    scheduled_time: Mapped[str] = mapped_column(String(5), nullable=False)   # "HH:MM"
    estimated_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    aircraft_registration: Mapped[str | None] = mapped_column(String(10), nullable=True)
    aircraft_type: Mapped[str] = mapped_column(String(10), nullable=False, default="A320")
    bay: Mapped[str | None] = mapped_column(String(10), nullable=True)
    cargo_weight_tons: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="SCHEDULED")
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class Turnaround(Base):
    __tablename__ = "turnarounds"
    __table_args__ = (UniqueConstraint("scheduled_date", "station", "aircraft_registration"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    station: Mapped[str] = mapped_column(String(10), nullable=False, default="KUL")
    aircraft_registration: Mapped[str | None] = mapped_column(String(10), nullable=True)
    arrival_flight_id: Mapped[int | None] = mapped_column(ForeignKey("flights.id"), nullable=True)
    departure_flight_id: Mapped[int | None] = mapped_column(ForeignKey("flights.id"), nullable=True)
    ground_time_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cargo_weight_tons: Mapped[float | None] = mapped_column(Float, nullable=True)
    required_sets: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    arrival_flight: Mapped["Flight | None"] = relationship("Flight", foreign_keys=[arrival_flight_id])
    departure_flight: Mapped["Flight | None"] = relationship("Flight", foreign_keys=[departure_flight_id])
    assignments: Mapped[list["TaskAssignment"]] = relationship("TaskAssignment", back_populates="turnaround")


class TaskAssignment(Base):
    __tablename__ = "task_assignments"
    __table_args__ = (UniqueConstraint("turnaround_id", "task_role", "set_number", "slot_index"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    turnaround_id: Mapped[int] = mapped_column(ForeignKey("turnarounds.id"), nullable=False)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False)
    task_role: Mapped[TaskRole] = mapped_column(Enum(TaskRole), nullable=False)
    set_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    slot_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    source: Mapped[AssignmentSource] = mapped_column(Enum(AssignmentSource), default=AssignmentSource.SOLVER)

    turnaround: Mapped["Turnaround"] = relationship("Turnaround", back_populates="assignments")
    team: Mapped["Team"] = relationship("Team")
    staff: Mapped["Staff | None"] = relationship("Staff")


# ── Certifications ────────────────────────────────────────────────────────────

class CertificationType(Base):
    __tablename__ = "certification_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    staff_certs: Mapped[list["StaffCertification"]] = relationship("StaffCertification", back_populates="cert_type")


class StaffCertification(Base):
    __tablename__ = "staff_certifications"
    __table_args__ = (UniqueConstraint("staff_id", "cert_type_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff.id"), nullable=False)
    cert_type_id: Mapped[int] = mapped_column(ForeignKey("certification_types.id"), nullable=False)
    issued_date: Mapped[date] = mapped_column(Date, nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[CertStatus] = mapped_column(Enum(CertStatus), default=CertStatus.ACTIVE)

    staff: Mapped["Staff"] = relationship("Staff")
    cert_type: Mapped["CertificationType"] = relationship("CertificationType", back_populates="staff_certs")
