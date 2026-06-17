"""Simple JWT-based auth — employee_id is also the password for staff (demo)."""
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import Staff

router = APIRouter(prefix="/api/auth", tags=["auth"])

_SECRET   = os.environ.get("JWT_SECRET",          "gtr-malaysia-demo-secret-key-2024!!")
_ADMIN_ID = os.environ.get("ADMIN_EMPLOYEE_ID",   "ADMIN001")
_ADMIN_PW = os.environ.get("ADMIN_PASSWORD",       "admin123")
_ADMIN_NM = os.environ.get("ADMIN_NAME",           "Administrator")
_ALGO     = "HS256"
_EXP_H    = 12


class LoginRequest(BaseModel):
    employee_id: str
    password: str


def _token(payload: dict) -> str:
    payload["exp"] = datetime.now(timezone.utc) + timedelta(hours=_EXP_H)
    return jwt.encode(payload, _SECRET, algorithm=_ALGO)


@router.post("/login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    emp = body.employee_id.strip()

    # Admin
    if emp.upper() == _ADMIN_ID.upper() and body.password == _ADMIN_PW:
        return {
            "access_token": _token({
                "sub":         "admin",
                "employee_id": _ADMIN_ID,
                "name":        _ADMIN_NM,
                "role":        "ADMIN",
                "is_admin":    True,
                "team_id":     None,
                "staff_id":    None,
            }),
            "token_type": "bearer",
            "is_admin":   True,
            "name":       _ADMIN_NM,
            "employee_id": _ADMIN_ID,
        }

    # Staff (password == employee_id for demo)
    staff = (await db.execute(
        select(Staff).where(Staff.employee_id == emp, Staff.is_active == True)  # noqa: E712
    )).scalar_one_or_none()

    if not staff or body.password != staff.employee_id:
        raise HTTPException(status_code=401, detail="Invalid employee ID or password.")

    return {
        "access_token": _token({
            "sub":         str(staff.id),
            "employee_id": staff.employee_id,
            "name":        staff.name,
            "role":        staff.role.value,
            "is_admin":    False,
            "team_id":     staff.team_id,
            "staff_id":    staff.id,
        }),
        "token_type": "bearer",
        "is_admin":   False,
        "name":       staff.name,
        "employee_id": staff.employee_id,
    }


async def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    """Verify the Bearer JWT on every protected request. Raises 401 if missing/invalid/expired."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1]
    try:
        return jwt.decode(token, _SECRET, algorithms=[_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Gate admin-only endpoints. Use after get_current_user for any role-restricted route."""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin privileges required.")
    return user
