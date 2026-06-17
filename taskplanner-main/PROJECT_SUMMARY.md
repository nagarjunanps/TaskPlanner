# GTR Malaysia — Shift & Task Planner: Project Summary

## Overview

The GTR Malaysia Task Planner is a web-based workforce scheduling application built for **Ground Team Red (GTRMY)**, the AirAsia ground handling operator at KLIA Terminal 2. The system replaces a fully manual Excel-based rostering process with an **AI-powered, constraint-driven roster planner** for the Narrowbody (NB) Ramp department.

The core scheduling engine is powered by **Timefold AI** — a constraint satisfaction and optimisation solver (successor to OptaPlanner). It automatically generates monthly shift rosters that satisfy all operational, legal, and safety constraints extracted from GTR Malaysia's documented workflows.

---

## Operational Context

| Metric | Value |
|---|---|
| Daily turnaround flights | ~255 NB flights |
| Daily total movements | ~570 (arrivals + departures) |
| NB Ramp teams | 6 teams |
| Staff per team | 1 DM + 12 RLS + 40 RA = 53 |
| Total NB Ramp staff | 318 |
| Shift patterns | 4 fixed shifts (S1–S4) |
| Turnaround time (A320) | ~30 minutes |
| Turnaround time (A330) | ~105 minutes |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (React)                      │
│  Dashboard · Roster · Staff · Attendance · Overtime     │
└───────────────────┬─────────────────────────────────────┘
                    │  HTTP / REST  (proxied via Vite dev)
┌───────────────────▼─────────────────────────────────────┐
│                 FastAPI Backend (Python)                  │
│  /api/teams  /api/staff  /api/rosters  /api/solver …    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Timefold AI Solver                  │    │
│  │  RosterSolution → StaffShiftAssignment           │    │
│  │  Constraint Streams: H1–H12 hard + S1–S7 soft   │    │
│  │  JVM 21 (JPype bridge)                           │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  SQLite DB  (SQLAlchemy async + aiosqlite)               │
│  Tables: teams · staff · shifts · monthly_rosters        │
│           roster_entries · ot_volunteers                 │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS · React Query · Axios |
| Backend | Python 3.10 · FastAPI · Uvicorn · Pydantic v2 |
| AI Solver | Timefold AI 1.24.0b0 (constraint programming, JVM 21) |
| Database | SQLite · SQLAlchemy 2.0 async · aiosqlite |
| Icons | Lucide React |

---

## Domain Model

### Entities

| Entity | Description |
|---|---|
| `Team` | One of 6 NB Ramp teams (T1–T6), each requiring 1 DM + 12 RLS + 40 RA |
| `Staff` | Individual employee with role (DM / RLS / RA) and team assignment |
| `Shift` | One of 4 fixed shift definitions (S1–S4) |
| `MonthlyRoster` | A roster for a specific team × month × year, with status DRAFT / SOLVING / PUBLISHED |
| `RosterEntry` | One entry per (staff × date): shift assignment, entry type, and runner flag |
| `OTVolunteer` | Overtime signup record with FIFO ordering and DM approval |

### Shift Definitions

| Code | Label | Start | End | Duration |
|---|---|---|---|---|
| S1 | Morning | 05:00 | 15:00 | 10h |
| S2 | Mid-day | 11:00 | 23:00 | 12h |
| S3 | Afternoon | 14:30 | 00:30 | 10h |
| S4 | Night | 23:00 | 11:00 | 12h |

### Entry Types

| Type | Meaning |
|---|---|
| `ON_DUTY` | Assigned to a shift and working |
| `OFF` | Rostered day off (part of 4-ON/2-OFF cycle) |
| `MC` | Medical leave (sick day) |
| `EL` | Earned / annual leave |
| `OT` | Voluntary overtime (DM-approved) |

---

## Timefold AI Planning Model

### Planning Domain

```
RosterSolution  (Planning Solution)
│
├── shifts[]          — 4 ShiftFact problem facts (value range for solver)
├── staff_list[]      — StaffFact problem facts (immutable during solve)
│
└── assignments[]     — StaffShiftAssignment (Planning Entities)
        │
        ├── staff          ← problem fact reference (immutable)
        ├── date           ← calendar date (immutable)
        ├── day_of_month   ← plain int (1–31); used in constraint lambdas instead of
        │                     date arithmetic, which fails silently on JPype-proxied
        │                     LocalDate objects when evaluated inside the JVM.
        └── assigned_shift ← @PlanningVariable  (None = OFF, or S1/S2/S3/S4)
```

The solver explores all possible shift-to-assignment combinations and finds the solution that satisfies all hard constraints and minimises soft constraint penalties.

> **Implementation note — `for_each_including_unassigned`**:
> Timefold's `ConstraintFactory.for_each(EntityClass)` silently **excludes** entities
> whose planning variable is `None` (unassigned). Constraints that need to detect
> OFF/unassigned entities — specifically H1b — must use
> `for_each_including_unassigned(EntityClass)` instead, and must also pass that same
> stream as the right-hand side of every `.join()` in the chain so that both sides
> include null-variable entities.

---

## Constraint Catalogue

### Hard Constraints (H) — Must Never Be Violated

| ID | Rule | Source |
|---|---|---|
| H1a | Max 4 consecutive ON-DUTY days per staff member | Ramp Rostering §3.1 |
| H1b | Max 2 consecutive OFF days per staff member | Ramp Rostering §3.1 |
| H2 | Exactly 4 of 6 teams must be on duty on any given day | Ramp Rostering §3.3 |
| H3 | No staff member on the same shift code more than 3 consecutive days | Ramp Rostering §3.4 |
| H5 | No shift may exceed 12 hours total duration | Ramp Rostering §5 |
| H6 | Forbidden shift pairs with < 8h rest between consecutive days (S3→S1, S4→S3) | JK Labor Rules |
| H7 | OT volunteer list capped at 6 active slots per date (FIFO enforced) | Ramp Rostering §5.1 |
| H8 | Overtime entries require DM approval — unapproved OT blocked at API layer | Ramp Rostering §5 |
| H9 | Weekly morning/afternoon shift block rotation per team | Ramp Rostering §3.1 |
| H10 | Each team on duty must have ≥ 1 DM + 12 RLS + 40 RA present | Ramp Rostering §3.2 |
| H11 | Each team must designate exactly 2 RA staff as runners on every ON-DUTY day | Process Overview §3 |
| H12 | Number of available runners must ≥ number of MC absences on any given day | Process Overview §3 |

### Soft Constraints (S) — Minimised for Quality

| ID | Rule | Weight |
|---|---|---|
| S1 | Prefer balanced morning/afternoon shift distribution across teams | Low |
| S3 | Prefer stable shift code within a 4-day work block (avoid mid-block changes) | Low |
| S5 | Distribute runner duty fairly — avoid same RA being runner on consecutive days | Low |
| S6 | Prefer earlier OT signup order (FIFO on volunteer list) | Low |
| S7 | Maintain OT buffer coverage: ≥ 2 approved OT volunteers per duty day | Low |

### Where Each Constraint Is Enforced

| Enforcement point | Constraints |
|---|---|
| **Timefold solver** (during solving) | H1a, H1b, H3, H5, H6, S1, S3 |
| **API layer** (immediate rejection) | H7 (OT cap), H8 (DM approval) |
| **Publish-time validation** | H1a, H1b, H3, H11, H12, S3 (full sequential check) |
| **Attendance page** (manual toggle) | H11 runner designation, H12 MC coverage |

> H1b uses `for_each_including_unassigned` in the solver because standard `for_each`
> excludes entities with a null planning variable; H1a uses standard `for_each` since
> it only fires once entities have been assigned a shift.

---

## End-to-End User Flows

### 1. Monthly Roster Generation

```
Planner opens Roster page
  → Selects team (T1–T6) + month/year
  → Clicks "Create Roster" (if none exists)
      Backend creates 1 RosterEntry (OFF) per staff × day
  → Clicks "Solve with Timefold AI"
      Backend builds RosterSolution with all staff facts + 30-day assignment entities
      Timefold solver runs for up to 30 seconds
      Finds optimal shift assignments satisfying H1, H3, H5, H6, S1, S3
      Solution persisted to DB as RosterEntry rows (shift_id + entry_type = ON_DUTY/OFF)
  → Frontend polls /api/solver/status every 2 seconds
      Live score shown: e.g. "0hard / -4soft"
  → On completion, calendar grid auto-refreshes
  → Planner reviews calendar, clicks "Validate"
      /api/solver/validate runs full H1–H12, S1–S7 check
      ConstraintWarnings panel lists violations
  → Planner designates 2 runners per duty day (Attendance page)
  → Clicks "Publish" — only enabled when hard violation count = 0
```

### 2. Daily Attendance & Runner Management

```
Duty Manager opens Attendance page
  → Selects date + team
  → Sees all 53 staff with their pre-solved shift assignments
  → For any MC (medical leave): changes entry_type to MC via dropdown
  → Designates 2 RA staff as runners using "Set Runner" toggle
      H11 (min 2 runners) and H12 (runners ≥ MC) auto-validated
  → Summary bar shows On Duty / MC / EL / Runner counts live
```

### 3. Overtime Management

```
Staff member reports to DM, requests OT
  → DM opens Overtime page
  → Selects team + staff member + date → clicks "Sign Up"
      API checks: slot count < 6 (H7), no duplicate signup
      Creates OTVolunteer record with status = PENDING
  → Visual slot counter shows e.g. "3/6 slots filled"
  → DM selects approving DM from dropdown
  → Clicks "Approve" on pending volunteer → status = APPROVED (H8 satisfied)
  → Rejected volunteers are cleared, freeing a slot for others
```

### 4. New Staff Onboarding

```
RLS supervisor opens Staff page
  → Clicks "Add Staff"
  → Fills Employee ID, Full Name, Role (DM/RLS/RA), Team
  → Staff appears in roster immediately for future solves
Dashboard team composition card reflects updated counts (e.g. T2: RLS 11/12 → 12/12)
```

---

## REST API Reference

### Teams
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/teams` | List all 6 teams with live composition counts |
| POST | `/api/teams` | Create a new team |

### Staff
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/staff?team_id=&role=&active=` | List staff with optional filters |
| POST | `/api/staff` | Add new staff member |
| PUT | `/api/staff/{id}` | Update name / role / team / active status |
| DELETE | `/api/staff/{id}` | Deactivate staff (soft delete) |

### Shifts
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/shifts` | List all 4 fixed shift definitions |

### Rosters
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/rosters?team_id=&year=&month=` | Fetch rosters with entries |
| GET | `/api/rosters/{id}` | Fetch a single roster with all entries |
| POST | `/api/rosters` | Create blank DRAFT roster (generates OFF entries) |
| PUT | `/api/rosters/{id}/entries` | Bulk update entry fields |
| POST | `/api/rosters/{id}/publish` | Publish (blocked if hard violations exist) |

### Solver
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/solver/start` | Start Timefold solve job, returns `job_id` |
| GET | `/api/solver/status/{job_id}` | Poll solver status + best score |
| POST | `/api/solver/stop/{job_id}` | Terminate solve early, keep best solution |
| POST | `/api/solver/validate/{roster_id}` | Run full constraint validation, return violations |

### Attendance
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/attendance?date=&team_id=` | Daily attendance entries for a team |
| PUT | `/api/attendance/{entry_id}` | Update entry type or runner flag |

### Overtime
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/overtime/volunteers?date=` | List OT volunteers for a date |
| POST | `/api/overtime/volunteers` | Staff signs up (400 if 6 slots full) |
| PUT | `/api/overtime/volunteers/{id}/approve?approver_id=` | DM approves OT |
| PUT | `/api/overtime/volunteers/{id}/reject` | Reject OT application |

---

## UI Pages

| Page | Route | Key Features |
|---|---|---|
| Dashboard | `/` | Team composition cards, constraint rules overview, understaffed alerts |
| Roster | `/roster` | Monthly calendar grid, Timefold AI solver trigger, live score, constraint warnings, publish flow |
| Staff | `/staff` | Staff table with role/team filters, add/edit modal, deactivate |
| Attendance | `/attendance` | Daily status grid, MC/EL updates, runner toggle per RA staff |
| Overtime | `/overtime` | Slot counter, volunteer signup, DM approve/reject with FIFO ordering |

---

## Key Design Decisions

**Why Timefold AI?**
Roster scheduling is an NP-hard constraint satisfaction problem. Timefold's constraint programming solver (built on OptaPlanner/Drools) handles the combinatorial complexity far better than hand-coded heuristics, and the Constraint Streams API makes constraints readable and maintainable.

**Why SQLite for MVP?**
Zero-config, file-based, no separate DB server needed. The async driver (`aiosqlite`) allows non-blocking FastAPI operation. Can be swapped to PostgreSQL by changing `DATABASE_URL` in `database.py`.

**Why `is_runner` handled as post-processing rather than a solver variable?**
Adding a boolean second planning variable to each entity roughly doubles the search space. For MVP, the solver finds optimal shift assignments, and runners are designated via the Attendance page (or automatically by a D-day DM). H11 and H12 are enforced at publish time, not during solving.

**Why separate hard/soft constraint enforcement points?**
Some constraints (H7, H8) are stateful API-layer rules that must fire immediately. Sequential window constraints (H1, H3) are approximated in the solver for speed and validated exactly at publish time. This pattern avoids expensive multi-entity joins in the solver while guaranteeing correctness at the point that matters (publish).

**Why both H1a and H1b in the solver?**
H1b alone (max 2 consecutive OFF) can be trivially satisfied by assigning ON_DUTY every day — no OFF days at all. H1a (max 4 consecutive ON) is required as a counterbalance to force the solver to insert rest days. Together they create a corridor that naturally produces the 4-ON/2-OFF cycle.

**Seed data covers all 6 teams.**
`seed.py` idempotently checks staff per team, so re-running never duplicates rows. Each of the 6 teams (T1–T6) is seeded with 53 staff (1 DM + 12 RLS + 40 RA = 318 total). Rostering works for any team — the solver endpoint filters staff by `roster.team_id`.
