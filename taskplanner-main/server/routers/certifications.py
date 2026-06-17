from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import CertStatus, CertificationType, StaffCertification
from models.schemas import CertificationTypeOut, StaffCertificationOut, StaffCertificationUpdate
from routers.auth import require_admin

router = APIRouter(prefix="/api/certifications", tags=["certifications"], dependencies=[Depends(require_admin)])


@router.get("/types", response_model=list[CertificationTypeOut])
async def get_cert_types(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(CertificationType).order_by(CertificationType.code))).scalars().all()
    return rows


@router.get("", response_model=list[StaffCertificationOut])
async def get_certifications(
    staff_id: Optional[int] = None,
    status: Optional[CertStatus] = None,
    expiring_within_days: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(StaffCertification).options(
        selectinload(StaffCertification.cert_type),
        selectinload(StaffCertification.staff),
    )
    if staff_id is not None:
        q = q.where(StaffCertification.staff_id == staff_id)
    if status is not None:
        q = q.where(StaffCertification.status == status)
    if expiring_within_days is not None:
        threshold = date.today() + timedelta(days=expiring_within_days)
        q = q.where(StaffCertification.expiry_date <= threshold)

    rows = (await db.execute(q)).scalars().all()

    result = []
    for row in rows:
        out = StaffCertificationOut.model_validate(row)
        out.staff_name = row.staff.name if row.staff else None
        result.append(out)
    return result


@router.put("/{cert_id}", response_model=StaffCertificationOut)
async def update_certification(
    cert_id: int,
    payload: StaffCertificationUpdate,
    db: AsyncSession = Depends(get_db),
):
    cert = (await db.execute(
        select(StaffCertification)
        .options(selectinload(StaffCertification.cert_type), selectinload(StaffCertification.staff))
        .where(StaffCertification.id == cert_id)
    )).scalar_one_or_none()
    if not cert:
        raise HTTPException(404, "Certification not found.")

    for field_name, value in payload.model_dump(exclude_unset=True).items():
        setattr(cert, field_name, value)
    await db.commit()
    await db.refresh(cert)

    out = StaffCertificationOut.model_validate(cert)
    out.staff_name = cert.staff.name if cert.staff else None
    return out
