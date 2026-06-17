from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import Role, Staff, Team
from models.schemas import TeamCreate, TeamOut
from routers.auth import require_admin

router = APIRouter(prefix="/api/teams", tags=["teams"], dependencies=[Depends(require_admin)])


@router.get("", response_model=list[TeamOut])
async def list_teams(sub_department_id: int | None = None, db: AsyncSession = Depends(get_db)):
    query = select(Team).order_by(Team.code)
    if sub_department_id is not None:
        query = query.where(Team.sub_department_id == sub_department_id)
    teams = (await db.execute(query)).scalars().all()
    result = []
    for t in teams:
        counts = {}
        for role in Role:
            cnt = (await db.execute(
                select(func.count()).where(Staff.team_id == t.id, Staff.role == role, Staff.is_active == True)
            )).scalar()
            counts[role.value.lower() + "_count"] = cnt
        out = TeamOut.model_validate(t)
        out.dm_count = counts["dm_count"]
        out.rls_count = counts["rls_count"]
        out.ra_count = counts["ra_count"]
        result.append(out)
    return result


@router.post("", response_model=TeamOut, status_code=201)
async def create_team(payload: TeamCreate, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(Team).where(Team.code == payload.code))).scalar_one_or_none()
    if existing:
        raise HTTPException(400, f"Team code '{payload.code}' already exists.")
    team = Team(**payload.model_dump())
    db.add(team)
    await db.commit()
    await db.refresh(team)
    out = TeamOut.model_validate(team)
    return out
