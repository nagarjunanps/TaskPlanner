import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import SessionLocal, init_db
from routers import attendance, org, overtime, rosters, shifts, solver, staff, teams
from routers import certifications, flights, task_planner, auth


async def _run_cert_refresh():
    from services.cert_monitor import refresh_cert_statuses
    async with SessionLocal() as db:
        n = await refresh_cert_statuses(db)
        if n:
            print(f"[cert-monitor] Updated {n} certification status(es).")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _run_cert_refresh()

    # Schedule daily cert-status refresh every 24 hours
    async def _daily_cert_task():
        while True:
            await asyncio.sleep(86400)
            await _run_cert_refresh()

    task = asyncio.create_task(_daily_cert_task())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="GTR Malaysia Task Planner", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(org.router)
app.include_router(teams.router)
app.include_router(staff.router)
app.include_router(shifts.router)
app.include_router(rosters.router)
app.include_router(attendance.router)
app.include_router(overtime.router)
app.include_router(solver.router)
app.include_router(certifications.router)
app.include_router(flights.router)
app.include_router(task_planner.router)
app.include_router(auth.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
