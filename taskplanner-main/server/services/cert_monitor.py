"""Recomputes StaffCertification.status based on expiry_date."""
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.db_models import CertStatus, StaffCertification

EXPIRING_SOON_DAYS = 60


async def refresh_cert_statuses(db: AsyncSession) -> int:
    today = date.today()
    threshold = today + timedelta(days=EXPIRING_SOON_DAYS)

    certs = (await db.execute(select(StaffCertification))).scalars().all()
    updated = 0
    for cert in certs:
        if cert.status == CertStatus.SUSPENDED:
            continue
        if cert.expiry_date < today:
            new_status = CertStatus.EXPIRED
        elif cert.expiry_date <= threshold:
            new_status = CertStatus.EXPIRING_SOON
        else:
            new_status = CertStatus.ACTIVE

        if cert.status != new_status:
            cert.status = new_status
            updated += 1

    await db.commit()
    return updated
