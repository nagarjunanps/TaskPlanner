"""Run once to seed reference data: org hierarchy, 4 shifts, 6 NB teams, sample staff + certifications."""
import asyncio
from datetime import date, timedelta

from sqlalchemy import select

from database import SessionLocal, init_db
from models.db_models import (
    CertStatus, CertificationType, Department, Role, Shift, Staff,
    StaffCertification, SubDepartment, Team,
)

SHIFTS = [
    {"code": "S1", "label": "Morning",   "start_time": "05:00", "end_time": "15:00", "duration_hours": 10},
    {"code": "S2", "label": "Mid-day",   "start_time": "11:00", "end_time": "23:00", "duration_hours": 12},
    {"code": "S3", "label": "Afternoon", "start_time": "14:30", "end_time": "00:30", "duration_hours": 10},
    {"code": "S4", "label": "Night",     "start_time": "23:00", "end_time": "11:00", "duration_hours": 12},
]

DEPARTMENTS = [
    {"code": "RAMP", "name": "Ramp Operations"},
    {"code": "PAX", "name": "Guest Services (PAX)"},
]

# Sub-departments per department code, from the GTR org chart.
SUB_DEPARTMENTS = {
    "RAMP": [
        {"code": "NB", "name": "Narrow Body (NB)"},
        {"code": "WB", "name": "Wide Body (WB)"},
        {"code": "TECHRAMP", "name": "Techramp"},
        {"code": "AIC", "name": "AIC (Night Stops)"},
        {"code": "ACC", "name": "Airport Control Centre (ACC)"},
        {"code": "LOAD_CONTROL", "name": "Load Control"},
        {"code": "FOCA", "name": "FOCA / FRT (Foreign Carrier Operations)"},
    ],
    "PAX": [
        {"code": "PAX_COUNTER", "name": "Counter Operations"},
        {"code": "PAX_GATE", "name": "Gate Operations"},
        {"code": "PAX_TRANSFER", "name": "Transfer Desk"},
    ],
}

TEAMS = [
    {"code": "T1", "name": "NB Ramp Team 1"},
    {"code": "T2", "name": "NB Ramp Team 2"},
    {"code": "T3", "name": "NB Ramp Team 3"},
    {"code": "T4", "name": "NB Ramp Team 4"},
    {"code": "T5", "name": "NB Ramp Team 5"},
    {"code": "T6", "name": "NB Ramp Team 6"},
]


def _sample_staff(team_id: int, team_code: str) -> list[dict]:
    members = []
    # 1 DM
    members.append({"employee_id": f"{team_code}-DM-001", "name": f"DM {team_code} 1", "role": Role.DM, "team_id": team_id})
    # 12 RLS
    for i in range(1, 13):
        members.append({"employee_id": f"{team_code}-RLS-{i:03d}", "name": f"RLS {team_code} {i}", "role": Role.RLS, "team_id": team_id})
    # 40 RA
    for i in range(1, 41):
        members.append({"employee_id": f"{team_code}-RA-{i:03d}", "name": f"RA {team_code} {i}", "role": Role.RA, "team_id": team_id})
    return members


async def seed():
    await init_db()
    async with SessionLocal() as db:
        # Shifts
        existing_shifts = (await db.execute(select(Shift))).scalars().all()
        if not existing_shifts:
            for s in SHIFTS:
                db.add(Shift(**s))
            await db.flush()
            print("Seeded 4 shifts.")

        # Departments
        existing_departments = (await db.execute(select(Department))).scalars().all()
        existing_dept_codes = {d.code for d in existing_departments}
        seeded_depts = 0
        for d in DEPARTMENTS:
            if d["code"] not in existing_dept_codes:
                db.add(Department(**d))
                seeded_depts += 1
        if seeded_depts:
            await db.flush()
            print(f"Seeded {seeded_depts} departments.")

        departments_by_code = {
            d.code: d for d in (await db.execute(select(Department))).scalars().all()
        }

        # Sub-departments
        existing_sub_departments = (await db.execute(select(SubDepartment))).scalars().all()
        existing_subdept_codes = {sd.code for sd in existing_sub_departments}
        seeded_subdepts = 0
        for dept_code, sub_departments in SUB_DEPARTMENTS.items():
            for sd in sub_departments:
                if sd["code"] not in existing_subdept_codes:
                    db.add(SubDepartment(**sd, department_id=departments_by_code[dept_code].id))
                    seeded_subdepts += 1
        if seeded_subdepts:
            await db.flush()
            print(f"Seeded {seeded_subdepts} sub-departments.")

        nb_sub_department = (
            await db.execute(select(SubDepartment).where(SubDepartment.code == "NB"))
        ).scalar_one()

        # Teams
        existing_teams = (await db.execute(select(Team))).scalars().all()
        if not existing_teams:
            for t in TEAMS:
                db.add(Team(**t, sub_department_id=nb_sub_department.id))
            await db.flush()
            print("Seeded 6 teams.")

        # Sample staff — seed each team independently so re-running is safe
        all_teams = (await db.execute(select(Team).order_by(Team.code))).scalars().all()
        for team in all_teams:
            team_staff = (await db.execute(
                select(Staff).where(Staff.team_id == team.id)
            )).scalars().all()
            if not team_staff:
                for s in _sample_staff(team.id, team.code):
                    db.add(Staff(**s, is_active=True))
                print(f"Seeded 53 sample staff in {team.code}.")

        # Certifications
        existing_cert_types = (await db.execute(select(CertificationType))).scalars().all()
        if not existing_cert_types:
            cert_types_data = [
                {"code": "GSE_DRIVING",    "name": "GSE Driving Licence"},
                {"code": "TOWER_OPS",      "name": "Tower / VDGS / Pushback Cert"},
                {"code": "STANDARD_RAMP",  "name": "Standard Ramp Ops Cert"},
            ]
            for ct in cert_types_data:
                db.add(CertificationType(**ct))
            await db.flush()
            print("Seeded 3 certification types.")

        cert_type_by_code = {
            ct.code: ct
            for ct in (await db.execute(select(CertificationType))).scalars().all()
        }

        today = date.today()
        all_teams_for_certs = (await db.execute(select(Team).order_by(Team.code))).scalars().all()
        for team in all_teams_for_certs:
            team_staff = (await db.execute(
                select(Staff).where(Staff.team_id == team.id).order_by(Staff.employee_id)
            )).scalars().all()

            existing_certs = (await db.execute(
                select(StaffCertification).where(
                    StaffCertification.staff_id.in_([s.id for s in team_staff])
                )
            )).scalars().all()
            if existing_certs:
                continue  # already seeded for this team

            ra_staff = [s for s in team_staff if s.role == Role.RA]
            gse_ct = cert_type_by_code["GSE_DRIVING"]
            tower_ct = cert_type_by_code["TOWER_OPS"]
            std_ct = cert_type_by_code["STANDARD_RAMP"]

            # All RA get STANDARD_RAMP
            for s in ra_staff:
                db.add(StaffCertification(
                    staff_id=s.id,
                    cert_type_id=std_ct.id,
                    issued_date=today - timedelta(days=365),
                    expiry_date=today + timedelta(days=730),
                    status=CertStatus.ACTIVE,
                ))

            # First 16 RAs get GSE_DRIVING (vary expiry for demo)
            for i, s in enumerate(ra_staff[:16]):
                if i == 4:
                    expiry = today + timedelta(days=30)   # EXPIRING_SOON
                    status = CertStatus.EXPIRING_SOON
                elif i == 5:
                    expiry = today - timedelta(days=10)   # EXPIRED
                    status = CertStatus.EXPIRED
                else:
                    expiry = today + timedelta(days=365)
                    status = CertStatus.ACTIVE
                db.add(StaffCertification(
                    staff_id=s.id,
                    cert_type_id=gse_ct.id,
                    issued_date=today - timedelta(days=365),
                    expiry_date=expiry,
                    status=status,
                ))

            # Next 16 RAs (indices 16-31) get TOWER_OPS
            for i, s in enumerate(ra_staff[16:32]):
                if i == 4:
                    expiry = today + timedelta(days=45)
                    status = CertStatus.EXPIRING_SOON
                elif i == 5:
                    expiry = today - timedelta(days=5)
                    status = CertStatus.EXPIRED
                else:
                    expiry = today + timedelta(days=365)
                    status = CertStatus.ACTIVE
                db.add(StaffCertification(
                    staff_id=s.id,
                    cert_type_id=tower_ct.id,
                    issued_date=today - timedelta(days=365),
                    expiry_date=expiry,
                    status=status,
                ))
            print(f"Seeded certifications for {team.code}.")

        await db.commit()
    print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
