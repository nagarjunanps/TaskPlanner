"""Async Timefold solver job manager for the daily task-assignment domain."""
import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from timefold.solver import SolverFactory
from timefold.solver.config import (
    Duration,
    ScoreDirectorFactoryConfig,
    SolverConfig,
    TerminationConfig,
)

from solver.task_constraints import _slot_window, is_long_turnaround, required_sets_for_leg, task_assignment_constraints
from solver.task_domain import RoleSlot, TaskPlanSolution, TaskStaffFact, TurnaroundFact


@dataclass
class TaskSolveJob:
    job_id: str
    team_id: int
    date: str
    status: str = "SOLVING"
    best_score: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    error: Optional[str] = None
    solution: Optional[TaskPlanSolution] = None
    persisted: bool = False
    retry_count: int = 0
    conflicts: list[dict] = field(default_factory=list)
    diagnostic: Optional[str] = None

    @property
    def time_spent_seconds(self) -> float:
        end = self.finished_at or time.time()
        return end - self.started_at


_task_jobs: dict[str, TaskSolveJob] = {}


def _build_task_solver(time_limit_seconds: int = 60):
    config = SolverConfig(
        solution_class=TaskPlanSolution,
        entity_class_list=[RoleSlot],
        score_director_factory_config=ScoreDirectorFactoryConfig(
            constraint_provider_function=task_assignment_constraints,
        ),
        termination_config=TerminationConfig(
            spent_limit=Duration(seconds=time_limit_seconds),
        ),
    )
    return SolverFactory.create(config).build_solver()


def _build_task_problem(plan_data: dict) -> TaskPlanSolution:
    # `legs` (e.g. ["ARRIVAL", "DEPARTURE"] or ["BOTH"]) tells us which leg(s)
    # of each turnaround are relevant to *this* solve job — see
    # routers.task_planner._build_plan_data, which decides per shift window
    # whether a long turnaround's arrival leg, departure leg, or both fall
    # inside it. It isn't a TurnaroundFact field, so pop it before
    # constructing the dataclass.
    raw_turnarounds = [dict(t) for t in plan_data["turnarounds"]]
    legs_by_id: dict[int, list[str]] = {}
    for t in raw_turnarounds:
        legs = t.pop("legs", None)
        legs_by_id[t["id"]] = legs if legs else (
            ["ARRIVAL", "DEPARTURE"] if is_long_turnaround(t["sta_minutes"], t["std_minutes"]) else ["BOTH"]
        )

    turnarounds = [TurnaroundFact(**t) for t in raw_turnarounds]
    staff_list = [TaskStaffFact(**s) for s in plan_data["staff"]]

    slots: list[RoleSlot] = []
    slot_id = 0
    for ta in turnarounds:
        for leg in legs_by_id[ta.id]:
            # 1 RLS slot per leg
            slots.append(RoleSlot(id=slot_id, turnaround=ta, task_role="RLS", set_number=0, slot_index=1, leg=leg))
            slot_id += 1
            # 1 TOWER slot per leg
            slots.append(RoleSlot(id=slot_id, turnaround=ta, task_role="TOWER", set_number=0, slot_index=1, leg=leg))
            slot_id += 1
            # per set: 1 DRIVER + 3 LOADERs — arrival/departure legs can need
            # a different number of sets since their cargo can differ.
            for set_num in range(1, required_sets_for_leg(ta, leg) + 1):
                slots.append(RoleSlot(id=slot_id, turnaround=ta, task_role="DRIVER", set_number=set_num, slot_index=1, leg=leg))
                slot_id += 1
                for loader_idx in range(1, 4):
                    slots.append(RoleSlot(id=slot_id, turnaround=ta, task_role="LOADER", set_number=set_num, slot_index=loader_idx, leg=leg))
                    slot_id += 1

    return TaskPlanSolution(
        team_id=plan_data["team_id"],
        date=plan_data["date"],
        turnarounds=turnarounds,
        staff_list=staff_list,
        slots=slots,
    )


def _scan_conflicts(slots: list[RoleSlot]) -> list[dict]:
    """In-memory self-check mirroring the H-T5/H-T6 hard constraints. This
    should always come back empty when the solver's hard score is 0 — it's a
    safety net for the rare case the 30s time limit cuts off the search
    before a fully hard-feasible solution is found, so we can detect that and
    auto-retry with more time rather than silently persisting a bad plan."""
    by_staff: dict[int, list[RoleSlot]] = {}
    for s in slots:
        if s.staff is not None:
            by_staff.setdefault(s.staff.id, []).append(s)

    conflicts: list[dict] = []
    for staff_id, staff_slots in by_staff.items():
        staff_name = staff_slots[0].staff.name
        for i in range(len(staff_slots)):
            for j in range(i + 1, len(staff_slots)):
                a, b = staff_slots[i], staff_slots[j]
                if a.turnaround.id == b.turnaround.id:
                    conflicts.append({
                        "staff_id": staff_id, "staff_name": staff_name,
                        "conflict_type": "multi_role_same_turnaround",
                        "description": (
                            f"{staff_name} assigned to multiple roles on the same "
                            f"turnaround ({a.turnaround.aircraft_registration})."
                        ),
                        "turnaround_id": a.turnaround.id,
                        "other_turnaround_id": None,
                    })
                    continue
                a_start, a_end = _slot_window(a.task_role, a.leg, a.turnaround.sta_minutes, a.turnaround.std_minutes)
                b_start, b_end = _slot_window(b.task_role, b.leg, b.turnaround.sta_minutes, b.turnaround.std_minutes)
                if a_start < b_end and b_start < a_end:
                    conflicts.append({
                        "staff_id": staff_id, "staff_name": staff_name,
                        "conflict_type": "double_booking",
                        "description": (
                            f"{staff_name} double-booked between "
                            f"{a.turnaround.aircraft_registration} and {b.turnaround.aircraft_registration}."
                        ),
                        "turnaround_id": a.turnaround.id,
                        "other_turnaround_id": b.turnaround.id,
                    })
    return conflicts


async def start_task_solve(
    team_id: int,
    date_str: str,
    plan_data: dict,
    time_limit: int = 60,
    on_complete: Optional[Callable[["TaskSolveJob"], Awaitable[None]]] = None,
) -> str:
    job_id = str(uuid.uuid4())
    job = TaskSolveJob(job_id=job_id, team_id=team_id, date=date_str)
    _task_jobs[job_id] = job

    async def _run():
        try:
            loop = asyncio.get_event_loop()
            attempt_time = time_limit
            max_attempts = 2   # initial solve + 1 bounded retry if hard-infeasible
            for attempt in range(max_attempts):
                solver = _build_task_solver(attempt_time)
                problem = _build_task_problem(plan_data)
                solution: TaskPlanSolution = await loop.run_in_executor(None, solver.solve, problem)
                job.solution = solution
                job.best_score = str(solution.score) if solution.score else "unknown"
                job.conflicts = _scan_conflicts(solution.slots)

                # Persist before flipping status so any caller that observes
                # SOLVING_COMPLETED is guaranteed the DB write already happened.
                job.persisted = False
                if on_complete:
                    await on_complete(job)

                if not job.conflicts or attempt == max_attempts - 1:
                    break
                job.retry_count = attempt + 1
                attempt_time = min(attempt_time + 60, 180)

            # One short LLM (or rule-based) explanation of the final result —
            # this only *explains* why slots are unassigned/conflicted; it
            # does not and cannot retune Timefold's weights at runtime. The
            # actual corrective action is the bounded retry above.
            from services.llm_advisor import summarize_plan
            total = len(job.solution.slots) if job.solution else 0
            unassigned = sum(1 for s in job.solution.slots if s.staff is None) if job.solution else 0
            job.diagnostic = await loop.run_in_executor(
                None, summarize_plan, team_id, date_str, total, unassigned, job.conflicts, job.retry_count > 0,
            )
            job.status = "SOLVING_COMPLETED"
        except Exception as exc:
            job.status = "ERROR"
            job.error = str(exc)
        finally:
            job.finished_at = time.time()

    asyncio.create_task(_run())
    return job_id


def get_task_job(job_id: str) -> Optional[TaskSolveJob]:
    return _task_jobs.get(job_id)


def stop_task_job(job_id: str) -> bool:
    job = _task_jobs.get(job_id)
    if not job:
        return False
    if job.status == "SOLVING":
        job.status = "SOLVING_STOPPED"
        job.finished_at = time.time()
    return True
