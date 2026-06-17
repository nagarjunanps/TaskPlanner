from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import Shift
from models.schemas import ShiftOut
from routers.auth import require_admin

router = APIRouter(prefix="/api/shifts", tags=["shifts"], dependencies=[Depends(require_admin)])


@router.get("", response_model=list[ShiftOut])
async def list_shifts(db: AsyncSession = Depends(get_db)):
    shifts = (await db.execute(select(Shift).order_by(Shift.id))).scalars().all()
    return shifts
