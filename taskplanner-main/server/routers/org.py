from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import Department, SubDepartment
from models.schemas import DepartmentOut, SubDepartmentOut
from routers.auth import require_admin

router = APIRouter(tags=["org"], dependencies=[Depends(require_admin)])


@router.get("/api/departments", response_model=list[DepartmentOut])
async def list_departments(db: AsyncSession = Depends(get_db)):
    departments = (await db.execute(select(Department).order_by(Department.code))).scalars().all()
    return departments


@router.get("/api/subdepartments", response_model=list[SubDepartmentOut])
async def list_subdepartments(department_id: int | None = None, db: AsyncSession = Depends(get_db)):
    query = select(SubDepartment).order_by(SubDepartment.code)
    if department_id is not None:
        query = query.where(SubDepartment.department_id == department_id)
    sub_departments = (await db.execute(query)).scalars().all()
    return sub_departments
