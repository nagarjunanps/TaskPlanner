"""Async Timefold solver job manager."""
import asyncio
import time
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from timefold.solver import SolverFactory
from timefold.solver.config import (
    SolverConfig,
    ScoreDirectorFactoryConfig,
    TerminationConfig,
    Duration,
)

from solver.constraints import roster_constraints
from solver.domain import RosterSolution, ShiftFact, StaffFact, StaffShiftAssignment


@dataclass
class SolveJob:
    job_id: str
    roster_id: int
    status: str = "SOLVING"   # SOLVING | SOLVING_COMPLETED | SOLVING_STOPPED | ERROR
    best_score: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    error: Optional[str] = None
    solution: Optional[RosterSolution] = None

    @property
    def time_spent_seconds(self) -> float:
        end = self.finished_at or time.time()
        return end - self.started_at


_jobs: dict[str, SolveJob] = {}


def _build_solver(time_limit_seconds: int = 30):
    config = SolverConfig(
        solution_class=RosterSolution,
        entity_class_list=[StaffShiftAssignment],
        score_director_factory_config=ScoreDirectorFactoryConfig(
            constraint_provider_function=roster_constraints,
        ),
        termination_config=TerminationConfig(
            spent_limit=Duration(seconds=time_limit_seconds),
        ),
    )
    return SolverFactory.create(config).build_solver()


def _build_problem(roster_data: dict) -> RosterSolution:
    shifts = [ShiftFact(**s) for s in roster_data["shifts"]]
    staff_list = [StaffFact(**s) for s in roster_data["staff"]]

    assignments = []
    entity_id = 0
    for s in staff_list:
        for day_str in roster_data["dates"]:
            d = date.fromisoformat(day_str)
            assignments.append(
                StaffShiftAssignment(
                    id=entity_id,
                    staff=s,
                    date=d,
                    day_of_month=d.day,
                    assigned_shift=None,
                )
            )
            entity_id += 1

    return RosterSolution(
        team_id=roster_data["team_id"],
        year=roster_data["year"],
        month=roster_data["month"],
        shifts=shifts,
        staff_list=staff_list,
        assignments=assignments,
    )


async def start_solve(roster_id: int, roster_data: dict, time_limit: int = 30) -> str:
    job_id = str(uuid.uuid4())
    job = SolveJob(job_id=job_id, roster_id=roster_id)
    _jobs[job_id] = job

    async def _run():
        try:
            solver = _build_solver(time_limit)
            problem = _build_problem(roster_data)
            loop = asyncio.get_event_loop()
            solution: RosterSolution = await loop.run_in_executor(None, solver.solve, problem)
            job.solution = solution
            job.best_score = str(solution.score) if solution.score else "unknown"
            job.status = "SOLVING_COMPLETED"
        except Exception as exc:
            job.status = "ERROR"
            job.error = str(exc)
        finally:
            job.finished_at = time.time()

    asyncio.create_task(_run())
    return job_id


def get_job(job_id: str) -> Optional[SolveJob]:
    return _jobs.get(job_id)


def stop_job(job_id: str) -> bool:
    job = _jobs.get(job_id)
    if not job:
        return False
    if job.status == "SOLVING":
        job.status = "SOLVING_STOPPED"
        job.finished_at = time.time()
    return True
