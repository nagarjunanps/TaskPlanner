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
┌──────────────────────────────────────────────────────────────────┐
│                          Browser (React)                          │
│  Login (JWT) · Dashboard · Roster · Staff · Attendance · Overtime │
│  Flight Dashboard · Task Planner · Certifications                 │
│  Staff self-service: My Flights · My Shift                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │  HTTP / REST + Bearer JWT
                            │  (proxied via Vite dev / Netlify+Render in prod)
┌───────────────────────────▼─────────────────────────────────────┐
│                    FastAPI Backend (Python)                       │
│  /api/auth  /api/teams  /api/staff  /api/rosters  /api/solver     │
│  /api/flights  /api/task-planner  /api/certifications  /api/overtime │
│  Every route except /api/auth/login + /api/health requires a     │
│  verified JWT; most require role=ADMIN (server-enforced, not     │
│  just hidden in the UI)                                          │
│                                                                    │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐  │
│  │   Monthly Roster Solver   │  │   Daily Task Planner Solver   │  │
│  │  RosterSolution →         │  │  TaskPlanSolution →           │  │
│  │  StaffShiftAssignment     │  │  RoleSlot (per turnaround)    │  │
│  │  H1–H12 hard + S1–S7 soft │  │  H-T1–H-T7 hard + S-T1–S-T6   │  │
│  └──────────────────────────┘  └──────────────────────────────┘  │
│              JVM 17+ (JPype bridge, both solvers)                 │
│                                                                    │
│  SQLite DB  (SQLAlchemy async + aiosqlite, WAL mode)               │
│  Tables: teams · staff · shifts · monthly_rosters · roster_entries │
│  ot_volunteers · flights · turnarounds · task_assignments          │
│  certification_types · staff_certifications                       │
└────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS · React Query · Axios · React Router |
| Backend | Python 3.12 · FastAPI · Uvicorn · Pydantic v2 · PyJWT |
| AI Solver | Timefold AI 1.24.0b0 (constraint programming, JVM 17+ via JPype) — two independent solver domains (monthly roster, daily task planner) |
| Database | SQLite · SQLAlchemy 2.0 async · aiosqlite (WAL journal mode + 30s busy_timeout) |
| LLM | Anthropic Claude Haiku — flight-impact analysis & plan diagnostics (optional, rule-based fallback if `ANTHROPIC_API_KEY` unset) |
| Icons | Lucide React |
| Deployment | Backend: Docker → Render (needs a JDK alongside Python). Frontend: Netlify (static, with SPA fallback redirect) |

---

## Authentication & Authorization

JWT-based (PyJWT, HS256, 12h expiry). `POST /api/auth/login` accepts an employee ID +
password and returns a token carrying `sub`, `employee_id`, `name`, `role`, `is_admin`,
`team_id`, `staff_id`.

- **Admin**: fixed demo credentials (`ADMIN_EMPLOYEE_ID`/`ADMIN_PASSWORD` env vars,
  defaulting to `ADMIN001`/`admin123`). Full access to every page and API route.
- **Staff**: password equals employee ID (demo-only pattern). Can only reach `/my-tasks`
  and `/my-shift`, and only their own data — enforced both client-side (route guards) and
  **server-side** (every router except `/api/auth/login`/`/api/health` requires a verified
  token; admin-only routers require `role=ADMIN`; the two staff-self-service endpoints
  check `staff_id` matches the token's own `staff_id` unless the caller is an admin).

This server-side enforcement was added after an audit found every route originally only
depended on `Depends(get_db)` — the React `RequireAuth`/`RequireAdmin` guards looked
correct but only gated the router, not the actual API, so any unauthenticated caller could
hit admin endpoints directly.

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
| H7 | OT volunteer list capped at 6 active slots per date | Ramp Rostering §5.1 |
| H8 | Overtime approval requires an active Duty Manager — `approver_id` is verified to be role=DM at the API layer, not just a free-form ID | Ramp Rostering §5 |
| H9 *(OT)* | OT signup blocked outright if already ON_DUTY that date (any shift length) — no way to fit a rest break in on a working day | Ramp Rostering §5 ("if associate work 10 hrs… only 2 hrs can be done as OT") |
| H9b *(OT)* | Minimum 10h rest required before OT can start — also checks the *previous* day's shift (overnight shifts like S4 are recorded under their start date) | Ramp Rostering §5 |
| H9 *(roster, not yet enforced)* | Weekly morning/afternoon shift block rotation per team | Ramp Rostering §3.1 |
| H10 | Each team on duty must have ≥ 1 DM + 12 RLS + 40 RA present | Ramp Rostering §3.2 |
| H11 | Each team must designate exactly 2 RA staff as runners on every ON-DUTY day | Process Overview §3 |
| H12 | Number of available runners must ≥ number of MC absences on any given day | Process Overview §3 |

> The OT module's `H9`/`H9b` IDs (in `overtime.py` code comments) are unrelated to the
> roster module's separate, currently-unenforced "H9: weekly rotation" rule above — both
> happen to be labelled H9 in their respective source contexts; disambiguated here as
> *(OT)* vs *(roster)* rather than renumbered, to match the code comments as written.

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
| **API layer** (immediate rejection) | H7 (OT cap), H8 (DM approval), H9/H9b (OT rest period) |
| **Publish-time validation** | H1a, H1b, H3, H11, H12, S3 (full sequential check) |
| **Attendance page** (manual toggle) | H11 runner designation, H12 MC coverage |

> H1b uses `for_each_including_unassigned` in the solver because standard `for_each`
> excludes entities with a null planning variable; H1a uses standard `for_each` since
> it only fires once entities have been assigned a shift.

---

## Daily Flight & Task Planner

A second, independent Timefold solver domain — separate from the monthly roster above —
that assigns ramp staff to specific turnaround role-slots (RLS / TOWER / DRIVER / LOADER)
for a single day, across all on-duty teams. Each turnaround needs: 1 RLS slot, 1 TOWER
slot, and per loader set (`required_sets`, derived from cargo weight): 1 DRIVER + 3
LOADER slots.

### Planning Domain (`solver/task_domain.py`)

```
TaskPlanSolution  (Planning Solution)
│
├── turnarounds[]    — TurnaroundFact problem facts (sta/std minutes, bay, bay_sector,
│                       required_sets, break_half)
├── staff_list[]     — TaskStaffFact problem facts (role, team_id, cert flags,
│                       break_group) — value range for the solver
│
└── slots[]          — RoleSlot (Planning Entities)
        ├── turnaround     ← problem fact reference
        ├── task_role      ← RLS | TOWER | DRIVER | LOADER (immutable)
        ├── set_number / slot_index
        └── staff           ← @PlanningVariable (allows_unassigned=True)
```

### Constraint Catalogue (`solver/task_constraints.py`)

| ID | Type | Rule |
|---|---|---|
| H-T1 | Hard | Role/cert match: RLS slot needs RLS staff, DRIVER needs `GSE_DRIVING` cert, TOWER needs `TOWER_OPS` cert, LOADER needs RA role |
| H-T5 | Hard | No double-booking — same staff can't cover two overlapping turnaround windows |
| H-T6 | Hard | One staff member can only fill one slot per turnaround |
| H-T7 | Hard | A turnaround with `required_sets > 1` must have at least one DRIVER assigned somewhere across its sets |
| S-T1 | Soft | Minimise unassigned slots (all roles except RLS — see S-T6) |
| S-T2 | Soft | Light per-staff load tie-breaker beyond 8 turnarounds/shift — not a capacity cap |
| S-T3 | Soft | Staggered meal break — staff only penalised for turnarounds in their own break half |
| S-T4 | Soft | Minimum travel gap between consecutive same-staff assignments at different bays — RLS gets a shorter requirement and an earlier window-open (no 15-min pre-arrival buffer) since RLS routinely starts late |
| S-T5 | Soft | Reward same-bay-sector consecutive assignments (reduce staff movement) |
| S-T6 | Soft | Unassigned RLS slots penalised far more lightly than other roles (weight 3 vs. S-T1's weight 10) — RLS is mandatory in principle but routinely runs short-staffed or starts late in practice |

### Multi-Team Solve-All

`POST /api/task-planner/solve-all` solves every on-duty team for a date in one call:
- Each team's **own exclusive** (non-overlapping) shift window is solved with just its own on-duty, certified staff.
- Where two teams' shifts genuinely overlap (e.g. S1 ending 15:00, S2 starting 11:00 → both on duty 11:00–15:00), that shared window is excluded from both teams' exclusive solves and instead gets **one joint solve with both teams' certified staff pooled together** — rather than splitting the window in half and leaving each team to cover its half alone with only its own (often certification-scarce) headcount. Each resulting assignment is attributed to whichever team's staff actually filled it.

### Certification Tracking (`routers/certifications.py`)

Three cert types seeded: `GSE_DRIVING`, `TOWER_OPS`, `STANDARD_RAMP`. Status (`ACTIVE` /
`EXPIRING_SOON` ≤60d / `EXPIRED`) is recomputed daily by `services/cert_monitor.py`.
Certified headcount directly bounds how many DRIVER/TOWER slots can be filled — `seed.py`
grants `GSE_DRIVING`/`TOWER_OPS` to 16 of 40 RAs per team (raised from an initial 6, which
left DRIVER/TOWER slots over 50% unassigned even with idle uncertified staff available).

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
      API checks, in order: staff active, no duplicate signup,
      not already ON_DUTY that date (H9), 10h rest from previous day's
      shift if any (H9b), not marked MC/EL, slot count < 6 (H7)
      Creates OTVolunteer record with status = PENDING
  → Visual slot counter shows e.g. "3/6 slots filled"
  → DM selects approving DM from dropdown
  → Clicks "Approve" on pending volunteer
      API verifies approver_id is an active staff member with role=DM (H8)
      → status = APPROVED
  → Reject blocked on already-resolved records (no double-approve/-reject)
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

> Every endpoint below except `/api/auth/login` and `/api/health` requires `Authorization: Bearer <token>`; most require an admin token (see [Authentication & Authorization](#authentication--authorization)).

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` | `{employee_id, password}` → JWT + role info |

### Teams
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/teams` | List all 6 teams with live composition counts |
| POST | `/api/teams` | Create a new team |

### Staff
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/staff?team_id=&role=&active=` | List staff with optional filters (admin only) |
| GET | `/api/staff/{id}/tasks?date=` | A staff member's task assignments for a date (self or admin only) |
| GET | `/api/staff/{id}/roster?year=&month=` | A staff member's monthly roster (self or admin only) |
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
| POST | `/api/overtime/volunteers` | Staff signs up — 400 if already on duty that day (H9), insufficient rest from the day before (H9b), marked MC/EL, or 6 slots full (H7) |
| PUT | `/api/overtime/volunteers/{id}/approve?approver_id=` | Approve — `approver_id` must resolve to an active DM (H8) |
| PUT | `/api/overtime/volunteers/{id}/reject` | Reject OT application |

### Flights / Turnarounds
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/flights/turnarounds?date=&station=` | Fetch + upsert the day's turnarounds from the configured provider (mock or AeroDataBox) |
| PUT | `/api/flights/turnarounds/{id}` | Update cargo weight / required sets |
| GET | `/api/flights?date=&station=` | List individual flight legs |
| PUT | `/api/flights/{id}` | Update scheduled/estimated time, bay, status |
| POST | `/api/flights/{id}/check-impact?current_time=` | LLM-assisted impact analysis of a flight change, triggers re-plan |

### Task Planner
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/task-planner/solve` | Solve one team's turnarounds for a date |
| POST | `/api/task-planner/solve-all` | Solve every on-duty team for a date, with pooled-staff joint solves for overlapping shift windows |
| GET | `/api/task-planner/status/{job_id}` | Poll solve status, score, unassigned count, conflicts, diagnostic |
| POST | `/api/task-planner/stop/{job_id}` | Stop a running solve |
| GET | `/api/task-planner/assignments?date=&team_id=` | List persisted assignments |
| PUT | `/api/task-planner/assignments/{id}` | Manually reassign a role slot |
| GET | `/api/task-planner/validate?date=` | Scan persisted assignments for double-bookings / impossible travel gaps |

### Certifications
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/certifications/types` | List cert types (GSE_DRIVING, TOWER_OPS, STANDARD_RAMP) |
| GET | `/api/certifications?staff_id=&status=&expiring_within_days=` | List staff certifications with filters |
| PUT | `/api/certifications/{id}` | Update expiry date / status |

---

## UI Pages

| Page | Route | Key Features |
|---|---|---|
| Login | `/login` | JWT login, demo-credentials accordion |
| Dashboard | `/` | Team composition cards, constraint rules overview, understaffed alerts (admin only) |
| Roster | `/roster` | All-teams overview grid + per-team monthly calendar, Timefold AI solver trigger, live score, constraint warnings, publish flow (admin only) |
| Staff | `/staff` | Staff table with role/team filters, add/edit modal, deactivate (admin only) |
| Attendance | `/attendance` | Daily status grid, MC/EL updates, runner toggle per RA staff (admin only) |
| Overtime | `/overtime` | Slot counter, volunteer signup, DM approve/reject (admin only) |
| Flight Dashboard | `/flights` | Flight CRUD, conflict detection, LLM-assisted impact analysis + replan trigger (admin only) |
| Task Planner | `/task-planner` | Date picker, one-click "Plan with Timefold AI" (auto-fetches flights), per-team solve progress with pooled-overlap labelling, generation-time display, colour-coded turnaround cards, manual reassignment, Validate Assignments (admin only) |
| Certifications | `/certifications` | Cert status table, filters, edit modal (admin only) |
| My Flights | `/my-tasks` | Staff's own flight assignments for any date (staff only) |
| My Shift | `/my-shift` | Staff's own monthly shift calendar (staff only) |
| My View | `/my-view` | Admin per-staff lookup — flights + monthly roster strip for any staff member (admin only) |

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

**Why pool staff for overlapping shift windows instead of splitting the time?**
The first attempt at handling two teams' overlapping shifts split the shared window 50/50 by time, so each team still only had its own (often certification-scarce) headcount to cover its half — even though both teams' staff were genuinely on duty and available during that window. Pooling both teams' certified staff for the shared window solves the actual constraint (not enough certified people at that moment) instead of working around a self-imposed one (each team's solve only sees its own roster).

**Why WAL mode + bulk upsert for persistence?**
`solve-all` runs several solver jobs concurrently (one per team's exclusive window, one per pooled-overlap pair). SQLite only allows one writer at a time; the original per-slot-row `execute()` loop held that write lock open for seconds per job, queueing enough concurrent commits to exceed even a generous busy_timeout. WAL mode plus a single multi-row upsert per job cut lock-hold time to milliseconds, removing the contention rather than just tolerating it with a longer timeout.

---

## Deployment

Client and server deploy to **separate hosts** — Netlify only serves static files and cannot run the Python/Timefold backend at all. See `README.md`'s [Deployment](README.md#deployment) section for the full walkthrough; in short:

- **Backend** → Render (or any Docker-capable host), via `server/Dockerfile` (Python 3.12 + JDK 17 for Timefold/JPype) and `server/start.sh` (idempotent re-seed on boot, then `uvicorn`).
- **Frontend** → Netlify, with `client/public/_redirects` providing the SPA fallback React Router needs.
- **Still pending:** the client's API base URL is hardcoded to the relative `/api` path (works via Vite's dev proxy locally); pointing it at a real deployed backend URL, and updating the backend's CORS allowlist to match, hasn't been wired up yet.
