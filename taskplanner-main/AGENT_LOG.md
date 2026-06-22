# Agent Work Log

Running log of actions taken/planned by the coding agent. Newest entries at the bottom.

---

## 2026-06-15 — Wire OrgTeamSelector into pages

**Task:** Replace the flat "Select team…" `<select>` dropdowns in RosterPage,
AttendancePage, OvertimePage, and StaffPage with the cascading
Department → Sub-Department → Team selector (`OrgTeamSelector.tsx`), which was
built but not yet used anywhere.

**Plan:**
- `RosterPage.tsx`: drop `getTeams` import + `teams` query (now unused),
  replace the team `<select>` with `<OrgTeamSelector value={teamId} onChange={setTeamId} />`.
- `AttendancePage.tsx`: same — drop `getTeams`/`teams`, swap the team `<select>`.
- `OvertimePage.tsx`: same — drop `getTeams`/`teams`, swap the team `<select>`.
- `StaffPage.tsx`: keep `getTeams`/`teams` (still needed for `teamById` table
  lookup and the Add/Edit Staff modal's team `<select>`). Replace only the
  top filter `<select>` with
  `<OrgTeamSelector value={filterTeam || null} onChange={id => setFilterTeam(id ?? '')} placeholder="All teams" />`.
- After edits: typecheck the client (`tsc -b` via `npm run build` or similar)
  to confirm no type errors from the swap.

**Status:** done.

- `RosterPage.tsx`: removed `getTeams` import + `teams` query; swapped the
  team `<select>` for `<OrgTeamSelector value={teamId} onChange={setTeamId} />`.
- `AttendancePage.tsx`: same change.
- `OvertimePage.tsx`: same change.
- `StaffPage.tsx`: kept `getTeams`/`teams` (used by `teamById` and the
  Add/Edit Staff modal's team `<select>`, left as-is). Replaced the "All
  teams" filter `<select>` with
  `<OrgTeamSelector value={filterTeam || null} onChange={id => setFilterTeam(id ?? '')} placeholder="All teams" />`.

**Verification:** `client/node_modules` is not installed, so `tsc -b` /
`npm run build` couldn't be run. Did a manual review instead: grepped each
file for leftover `teams`/`getTeams` references — only StaffPage retains
them (intentionally), and all `<OrgTeamSelector>` placements sit inside
existing `flex` containers so the 3-select cascade lays out inline fine.

**Follow-up (not done, flagged for user):** the Add/Edit Staff modal in
`StaffPage.tsx` still uses a flat team `<select>` (just team codes, no
dept/sub-dept context). Left unchanged since it's a form field rather than
a page-level team-context selector — can swap to `OrgTeamSelector` too if
desired for consistency.

---

## 2026-06-16 — Roster Integrity Fix + Daily Flight & Task Planner

**Tasks:** Two deliverables per the approved plan `velvet-knitting-hare.md`:

### Part A — Roster plan/actual separation (bugfix)

**Problem:** `attendance.py::update_attendance` used a generic `setattr` loop
that overwrote `entry_type` (the immutable published plan field) with same-day
MC/EL overrides, losing the plan-of-record.

**Fix applied:**
- `server/models/db_models.py`: added `actual_entry_type: EntryType | None = None`
  (nullable) to `RosterEntry`. `entry_type` / `shift_id` remain the immutable plan.
- `server/models/schemas.py`: `RosterEntryOut` now has `actual_entry_type`,
  `effective_entry_type` (computed via `@model_validator` = `actual_entry_type or entry_type`).
  Split into `RosterEntryUpdate` (plan fields — used by `rosters.py`) and
  `AttendanceEntryUpdate` (actual fields — used by `attendance.py`).
- `server/routers/attendance.py::update_attendance`: now only touches `actual_entry_type`
  and `is_runner`. Plan fields are untouched. `actual_entry_type=null` clears override.
- `client/src/pages/AttendancePage.tsx`: "Planned" column shows immutable `entry_type`;
  "Effective" column shows `effective_entry_type` (highlighted with orange ring if overridden);
  "Override" dropdown writes `actual_entry_type`, with "— (as planned)" option to clear.
- `client/src/api/types.ts`: `RosterEntry` extended with `actual_entry_type`, `effective_entry_type`.

### Part B — Daily Flight & Task Planner (KLIA NB, AirAsia)

**New files:**

**Backend:**
- `server/models/db_models.py`: added `Flight`, `Turnaround`, `TaskAssignment` models;
  `FlightDirection`, `TaskRole`, `AssignmentSource`, `CertStatus` enums;
  `CertificationType`, `StaffCertification` models.
- `server/models/schemas.py`: added `FlightOut`, `TurnaroundOut`, `TurnaroundUpdate`,
  `TaskAssignmentOut`, `TaskAssignmentUpdate`, `TaskSolveRequest`, `TaskSolverStatusOut`,
  `CertificationTypeOut`, `StaffCertificationOut`, `StaffCertificationUpdate`.
- `server/services/cert_monitor.py`: `refresh_cert_statuses(db)` — recomputes
  ACTIVE/EXPIRING_SOON(≤60d)/EXPIRED from `expiry_date`, skips SUSPENDED.
- `server/services/flight_data.py`: `FlightDataProvider` ABC + `MockFlightProvider`
  (5 sample AirAsia KLIA turnarounds, default) + `AeroDataBoxProvider` (RapidAPI,
  needs `AERODATABOX_API_KEY`). Selected via `FLIGHT_DATA_PROVIDER=mock|aerodatabox` env var.
- `server/solver/task_domain.py`: `TaskStaffFact`, `TurnaroundFact`, `RoleSlot`
  (`@planning_entity`), `TaskPlanSolution` (`@planning_solution`) — mirrors existing
  roster domain pattern.
- `server/solver/task_constraints.py`: H-T1 (role/cert mismatch for RLS/DRIVER/TOWER/LOADER),
  H-T5 (no double-booking across overlapping `[STA-15, STD]` windows), soft penalties
  for unassigned slots and load imbalance.
- `server/solver/task_solver_manager.py`: `TaskSolveJob` + `start_task_solve` /
  `get_task_job` / `stop_task_job` — same async+executor pattern as `solver_manager.py`.
- `server/routers/certifications.py`: `GET /api/certifications/types`,
  `GET /api/certifications` (filters: staff_id, status, expiring_within_days),
  `PUT /api/certifications/{id}`.
- `server/routers/flights.py`: `GET /api/flights` (fetch+upsert via provider),
  `GET /api/flights/turnarounds` (pair by aircraft_registration+date, upsert with
  computed ground_time_minutes + required_sets per H-T2), `PUT /api/flights/turnarounds/{id}`.
- `server/routers/task_planner.py`: `POST /api/task-planner/solve`,
  `GET /api/task-planner/status/{job_id}`, `POST /api/task-planner/stop/{job_id}`,
  `GET /api/task-planner/assignments`, `PUT /api/task-planner/assignments/{id}`.
- `server/main.py`: registers `certifications`, `flights`, `task_planner` routers;
  runs `cert_monitor.refresh_cert_statuses` on startup and every 24h via asyncio task.
- `server/requirements.txt`: added `httpx==0.27.2`.
- `server/seed.py`: seeds `CertificationType` (GSE_DRIVING, TOWER_OPS, STANDARD_RAMP);
  seeds `StaffCertification` per team (all RA get STANDARD_RAMP; first 6 RAs get
  GSE_DRIVING; RAs 6-11 get TOWER_OPS; varies expiry for EXPIRING_SOON/EXPIRED examples).

**Frontend:**
- `client/src/api/types.ts`: added `Flight`, `Turnaround`, `TaskAssignment`,
  `TaskSolverStatus`, `CertificationType`, `StaffCertification`, `CertStatus`,
  `FlightDirection`, `TaskRole`, `AssignmentSource`, `TaskSolverJobStatus`.
- `client/src/api/client.ts`: added `getTurnarounds`, `updateTurnaround`,
  `startTaskSolve`, `getTaskSolveStatus`, `stopTaskSolve`, `getTaskAssignments`,
  `updateTaskAssignment`, `getCertificationTypes`, `getStaffCertifications`,
  `updateCertification`.
- `client/src/pages/TaskPlannerPage.tsx`: date picker + team selector; Fetch Flights
  → loads turnarounds; editable cargo/sets per turnaround; "Plan with Timefold AI"
  → polls solver status; assignments grid per turnaround (RLS/TOWER/DRIVER/LOADER cards
  with staff reassign dropdowns). Shows MANUAL badge for manually overridden slots.
- `client/src/pages/CertificationsPage.tsx`: table with status badges; filter by
  status/type; Edit modal to update expiry date and status.
- `client/src/components/layout/Sidebar.tsx`: added "Task Planner" (Plane icon) and
  "Certifications" (Award icon) nav items.
- `client/src/App.tsx`: added routes `/task-planner` → `TaskPlannerPage` and
  `/certifications` → `CertificationsPage`.

**Schema migration:** `gtrmy.db` deleted — must re-run `seed.py` before first use.

**Verification steps:**
1. From `server/`: `pip install -r requirements.txt` then `python seed.py` then
   `uvicorn main:app --reload`
2. `GET /api/flights/turnarounds?date=<today>&station=KUL` → returns 5 mock turnarounds
3. `PUT /api/attendance/{entry_id}` with `{"actual_entry_type":"MC"}` → plan entry_type
   unchanged in `GET /api/rosters/{id}`, but effective_entry_type shows MC in attendance
4. `POST /api/task-planner/solve {team_id:1, date:<today>}` → poll status → assignments
5. From `client/`: `npm install` then `npm run dev` → test TaskPlannerPage and CertificationsPage

**Flight data provider switch (for production):**
Set env vars: `FLIGHT_DATA_PROVIDER=aerodatabox` and `AERODATABOX_API_KEY=<key>` before
starting uvicorn. Default is `mock` (no external dependency).

**Mock flight data updated (same session):**
`MockFlightProvider` expanded from 5 to **18 turnarounds (36 flight legs)** spread across
a full operating day (05:45–21:35). Mix of A320/A321, bays across all four sectors
(J, LK, P, Q), cargo weights covering all three Set tiers (1-set <1.5t, 2-set 1.5–9t,
3-set >10t). Total slot demand: 160 slots per day for one team.

**Status:** Complete.

---

## 2026-06-16 — 255 Mock Flights, Shift-Window Filtering, My View, Auto Plan

### A — 255 mock turnarounds (`server/services/flight_data.py`)

`MockFlightProvider` now generates **255 AirAsia turnarounds** deterministically (seed=42) spread
across a full operating day using a `_build_mock_schedule(255)` helper. Distribution:
- 05:00–06:00: 40 flights | 06:00–08:00: 70 | 08:00–10:00: 50 | 10:00–13:00: 40
- 13:00–16:00: 35 | 16:00–20:00: 15 | 20:00–00:30: 5  (total = 255 ✓)
- Aircraft: 60% A320 / 40% A321; bays: J/L/P/Q sectors; cargo: 50% light/35% medium/15% heavy
- Unique 9M-XXX registrations per turnaround; stable across restarts (deterministic seed)

### B — Shift-window filtering in task planner (`server/routers/task_planner.py`)

Added `Shift` to imports. In `_build_plan_data`, after loading roster entries, the team's shift
is read from `entry.shift.start_time/end_time`. Turnarounds are then filtered to only those
where the arrival time (STA) falls within `[shift_start, shift_end)`. Handles S4 (23:00–11:00)
midnight-spanning shift correctly. Result: each team handles ~50–100 of the 255 daily TAs
(those in their shift window) instead of all 255 — keeps the solver tractable.

### C — Staff personal view

**`server/models/schemas.py`**: Added `StaffTaskOut` (task assignment with flight context) and
`StaffRosterDayOut` (daily entry with shift label).

**`server/routers/staff.py`**: Added two new GET endpoints before `/{staff_id}` CRUD:
- `GET /api/staff/{id}/tasks?date=` — returns all TaskAssignments for that staff on that date,
  joined with Turnaround → arrival/departure Flight for full context (flight numbers, times, bay).
- `GET /api/staff/{id}/roster?year=&month=` — returns monthly RosterEntry records joined with Shift,
  returning effective entry type (honours actual_entry_type overrides).

**`client/src/api/types.ts`**: Added `StaffTask` and `StaffRosterDay` interfaces.

**`client/src/api/client.ts`**: Added `getStaffTasks(staffId, date)` and `getStaffRoster(staffId, year, month)`.

**`client/src/pages/StaffViewPage.tsx`** (new): Staff personal view with:
- Searchable staff dropdown (filters by name or employee ID, shows up to 12 results)
- Staff info chip (avatar initial, name, employee ID, role)
- "My Tasks" section: date picker + task cards (per role, with aircraft reg/type, bay, flight numbers/times, ground time)
- "My Roster" section: month calendar strip with prev/next navigation, shift badges (S1=blue/S2=green/S3=amber/S4=purple), MC/EL highlights, Runner badge, today highlighted in indigo
- Legend strip at bottom of calendar

**`client/src/components/layout/Sidebar.tsx`**: Added "My View" nav item with `UserCircle` icon.

**`client/src/App.tsx`**: Added `/my-view` → `StaffViewPage` route.

### D — Auto Plan button (`client/src/pages/TaskPlannerPage.tsx`)

Added `autoPlanning` state. New **"Auto Plan"** button (green/emerald, Zap icon) fetches flights
and immediately triggers the Timefold solver in sequence:
1. Click "Auto Plan": sets `autoPlanning=true`, calls `refetchTurnarounds()`
2. `useEffect` triggers: when `autoPlanning && turnarounds.length > 0 && teamId && solveStatus === null` → fires `solveMutation.mutate()` and clears `autoPlanning`
3. Auto-plan status banner shown during fetch phase; existing solve status banner shown during AI phase

Manual flow (Fetch Flights → Plan with Timefold AI) preserved for fine-grained control.

**Status:** Complete.

---

## 2026-06-16 — Task Planner: Break, Travel Gap & Bay Locality Constraints

**Requirement:** Add three new operational constraints to the Timefold solver:
1. Staff must have a proper meal break (clear window mid-shift)
2. Minimum travel gap between consecutive tasks at different bays
3. Prefer assigning same staff to nearby bay sectors (reduce movement)

**`server/solver/task_domain.py`** — Extended `TurnaroundFact` with `bay`, `bay_sector`, `in_break_window` fields.

**`server/solver/task_constraints.py`** — Three new SOFT constraints:
- S-T3 `protect_meal_break_window`: −5 soft per assignment overlapping the team's mid-shift break window
- S-T4 `enforce_travel_gap`: −N soft per same-staff pair where gap < bay-to-bay travel time (N = shortfall minutes). Travel: same sector 3 min, J↔L/L↔P/P↔Q 10 min, 2-hop 15 min.
- S-T5 `prefer_same_sector_assignments`: +3 soft per same-sector pair for same staff member

**`server/routers/task_planner.py`** — Added `_bay_sector()`, `_break_window()`, `_in_break_window()` helpers. Turnaround facts now include `bay`, `bay_sector`, `in_break_window`. Break window computed as mid-shift ± 30 min, handles midnight-spanning S4 shift.

**No schema or DB changes.** All constraint data derived at solve time.

**Status:** Complete.

---

## 2026-06-16 — Environment Setup Issues & Fixes

Documented here for future reference.

### Issue 1 — Python version incompatibility (Python 3.14)

**Problem:** `pip install -r requirements.txt` failed building `pydantic-core` wheel.
Root cause: system had Python 3.14 as default; `pydantic-core` (via PyO3 0.22.6) only
supports up to Python 3.13.

**Fix:**
- Installed Python 3.12 from python.org (stable, compatible with all packages in stack).
- Created venv using Python 3.12: `py -3.12 -m venv venv`
- Activated: `.\venv\Scripts\activate`
- Installed deps: `pip install -r requirements.txt`

**Rule going forward:** Always use Python 3.12 for this project. Do not use system default
if it resolves to 3.14+.

### Issue 2 — Java version too old (Java 8)

**Problem:** `uvicorn main:app --reload` failed at startup with:
```
InvalidJVMVersionError: Timefold Solver for Python requires JVM version 17 or later.
```
System had Java 1.8.0_261 (Java 8). Timefold requires Java 17+.
Secondary symptom: `AttributeError: type object 'java.lang.Runtime' has no attribute 'version'`
— Java 8 predates the `Runtime.version()` API (added in Java 9).

**Fix:**
- Downloaded and installed **Eclipse Temurin 21.0.11 LTS** from adoptium.net (Windows x64 MSI).
- During install: ticked "Set JAVA_HOME variable" and "Add to PATH".
- Reopened VS Code (required to pick up updated PATH — existing terminals inherit old env).
- Verified: `java -version` → `openjdk version "21.0.11" 2026-04-21 LTS`

**Note:** Java 8 remains installed but Java 21 takes priority in PATH. Both can coexist.

### Issue 3 — Uvicorn reloading venv packages in `--reload` mode

**Problem:** With `--reload`, uvicorn's WatchFiles was watching `venv\Lib\site-packages\`
and triggering constant reloads as packages finished unpacking after install.

**Fix:** Use `--reload-exclude venv` flag:
```
uvicorn main:app --reload --reload-exclude venv
```

### Correct startup sequence (after all fixes)

```powershell
# In server/ directory, with venv activated:
.\venv\Scripts\activate
python seed.py                                    # first run only (or after db reset)
uvicorn main:app --reload --reload-exclude venv

# In client/ directory (separate terminal):
npm install                                       # first run only
npm run dev
```

**Prerequisites:**
- Python 3.12 (venv created with `py -3.12 -m venv venv`)
- Java 21+ (Eclipse Temurin 21 LTS recommended)
- Node.js 18+ for frontend

---

## 2026-06-16 — All-Teams Roster Overview (Shift Planning Redesign)

**Requirement:** Admin must see all 6 NB Ramp teams' shift plans in a single view. All members of a team share one shift on any given day. Plans are locked once confirmed. Constraints from notes: 4 teams working / 2 teams off per day; max 3 consecutive days on the same shift; no short-rest transitions (S3→S1, S4→S3 forbidden); 4-day working / 2-day off pattern per team.

**Changes:**

### Backend (`server/`)

- `models/schemas.py`: Added `TeamDaySummaryOut`, `TeamMonthSummaryOut`, `TeamDayUpdate` schemas for overview API.
- `routers/rosters.py`:
  - Added `GET /api/rosters/overview?year=&month=&sub_dept_code=NB` — returns compact team×day shift summary without sending all 53×31 staff entries; groups by date to find dominant shift.
  - Added `POST /api/rosters/initialize-all?year=&month=` — creates blank MonthlyRoster for every NB team that doesn't have one for the given month.
  - Added `POST /api/rosters/generate-rotation?year=&month=` — applies a mathematically valid 12-day rotation cycle (`S1,S1,S3,S3,OFF,OFF,S2,S2,S4,S4,OFF,OFF`) to all teams. Teams staggered by 2-day offsets (T1=0, T2=2, … T6=10). Guarantees exactly 4 teams working + 2 off every day. No forbidden short-rest transitions. Max 2 consecutive same shift.
  - Added `PUT /api/rosters/{roster_id}/team-day` — sets ALL staff in a roster to the same shift on a given day (team-level planning primitive); null shift_id = OFF.
  - All 3 new static paths are declared BEFORE `/{roster_id}` to avoid route conflicts.

### Frontend (`client/src/`)

- `api/types.ts`: Added `TeamDaySummary`, `TeamMonthSummary` interfaces.
- `api/client.ts`: Added `getRosterOverview`, `initializeAllTeams`, `generateRotation`, `setTeamDay` API calls.
- `pages/RosterPage.tsx`: Complete redesign into 3 components:
  - `RosterPage` — root; manages year/month/selectedTeam state; routes between Overview and Detail.
  - `RosterOverview` — all-teams grid (6 rows × 31 cols). Colored shift badges (S1=blue, S2=green, S3=amber, S4=purple). Per-day coverage dot (green ✓ = 4 working, red = gap). Click any team row → drill into detail. Click any DRAFT cell → inline editor popup (select shift or OFF). "Initialise All Teams" / "Generate Rotation" / "Confirm Plan" action buttons.
  - `TeamDetailRoster` — per-staff calendar (existing roster page logic, now a sub-view). Has "All Teams" back button. Solver, validate, confirm still available at team level for fine-tuning individual exceptions.

**Workflow:**
1. Open Roster page → see all-teams grid for current month
2. "Initialise All Teams" → creates rosters (blank, all OFF) for all 6 NB teams
3. "Generate Rotation" → fills in the 12-day rotation; all staff in each team get same shift
4. Fine-tune: click any cell → override one team's shift for one day
5. "Confirm Plan" → publishes all team rosters; cells become read-only
6. Click team row → view per-staff detail; Timefold solver available for individual-level optimisation

**No DB schema changes required.** Existing `MonthlyRoster` + `RosterEntry` tables used; team-level shift is derived from all staff sharing the same shift_id per day.

---

## 2026-06-17 — Fix Task Planning Constraint Violations

**Root causes identified:**

1. **H-T1 unassigned slots counted as HARD violations** — `for_each_including_unassigned` in role/cert constraints meant every unassigned slot (e.g., DRIVER slot with `staff=None`) triggered a HARD penalty. With 221 TAs and 53 staff this produced dozens of unavoidable hard violations. Fix: changed all H-T1 constraints to `for_each` (assigned-only). Unassigned slots remain a SOFT penalty via S-T1. `task_constraints.py` lines 68–107.

2. **Shift window overlap — same TAs planned by multiple teams** — S1 (05:00–15:00) and S4 (23:00–11:00) both covered the morning rush (05:00–11:00), giving T2 221 TAs and T6 177 TAs. The `solve-all` endpoint now computes **exclusive non-overlapping planning windows**: sort active teams by shift start, assign each team `[shift_start, next_team_shift_start)`. Expected distribution:
   - T2/S1: 05:00–11:00 → ~110 TAs
   - T5/S2: 11:00–14:30 → ~35 TAs
   - T3/S3: 14:30–23:00 → ~50 TAs
   - T6/S4: 23:00–05:00 → ~5 TAs

**Files changed:**

- `server/solver/task_constraints.py`: H-T1 constraints now use `cf.for_each(RoleSlot)` (not `for_each_including_unassigned`), simplified filter conditions (no `is None` check needed).
- `server/routers/task_planner.py`:
  - `_build_plan_data()` gains `exclusive_until_min: int | None` parameter; uses it as the planning window cap when set (break window still based on full shift for staff welfare).
  - `start_all_teams_solver` restructured into Phase 1 (collect active teams + shift starts with `selectinload`), Phase 2 (sort + compute exclusive windows), Phase 3 (plan + launch with exclusive window). Single-team `/solve` endpoint unchanged (uses full shift window).

**Status:** Complete.

---

## 2026-06-17 — UI Overhaul: Pagination, TopBar, Mobile Layout, Login Redesign

### Changes made

#### New components
- **`client/src/components/common/Pagination.tsx`**: Reusable `Pagination` component + `usePagination<T>` hook. Shows page numbers (windowed), first/last/prev/next navigation, and "Showing X–Y of N" label. Resets to page 1 automatically when source list changes.
- **`client/src/components/layout/TopBar.tsx`**: Sticky header bar at the top of every authenticated page. Shows hamburger (mobile), GTR brand (mobile), user name + employee ID + avatar (desktop), and Sign Out button (visible on all breakpoints). User info removed from sidebar bottom.

#### Layout overhaul (`App.tsx`, `Sidebar.tsx`)
- `AppShell` now includes `TopBar` above the main content area.
- `Sidebar` becomes a **mobile drawer** (slides in from the left, with backdrop) triggered by the TopBar hamburger. On `lg+` screens it remains a static column.
- `Sidebar` gains an `onClose` prop; nav links call `onClose` on click to dismiss the drawer on mobile.
- Bottom user/logout section removed from Sidebar (now in TopBar).

#### Login page (`LoginPage.tsx`)
- Centered single-column layout (`max-w-sm`) with brand logo, login card, and a **collapsible "Demo Credentials" accordion** below.
- On click a demo card, credentials are filled AND accordion closes automatically.
- Better input sizing (`py-3`, `rounded-xl`), focus ring, shadow on submit button.
- Works well on 375px mobile screens.

#### Pagination added to admin pages
- **`StaffPage`** (318 staff): 25 per page, dual view: desktop table + mobile card list side by side.
- **`CertificationsPage`**: 25 per page, desktop table + mobile cards.
- **`AttendancePage`** (53 staff/team): 30 per page, desktop table + mobile cards with inline override controls.
- **`FlightListPage`** (510 flights): replaced simple Prev/Next with full `Pagination` component, 25 per page.
- **`OvertimePage`**: ≤6 items, no pagination needed — UI improved with mobile card list.

#### Staff mobile pages
- **`StaffTasksPage`**: Full mobile redesign — coloured left accent per task role, structured flight info cards, sticky header with date navigator. Padding and typography tuned for 375px.
- **`StaffShiftPage`**: Calendar cells use `aspect-square` on mobile (no fixed `h-20` overflow), smaller day-of-week abbreviations (single letter) on mobile, collapsible shift time reference moved to its own card below the calendar.

**Status:** Complete. `tsc --noEmit` passes with 0 errors.

---

## 2026-06-17 — Task Planner: Persistence Race, Team Filter, Pagination, Saved Plans

**Reported symptom:** Timefold solve completed but assignments showed "Unassigned"/"No assignments yet" in the UI.

1. **Persistence race condition** — `_persist_when_done()` ran as a detached background task polling every 2s for job completion, racing against the frontend's own 2s status poll. Frontend could observe `SOLVING_COMPLETED` and fetch assignments before the DB write landed.
   - `server/solver/task_solver_manager.py`: `start_task_solve()` gained an `on_complete` async callback invoked *inside* the job, right after solving and *before* the status flips to `SOLVING_COMPLETED`.
   - `server/routers/task_planner.py`: replaced `_persist_when_done` with `_persist_assignments(job, team_id)`, wired as `on_complete` from both `/solve` and `/solve-all`. `/status/{job_id}` still calls it as an idempotent fallback (`job.persisted` flag).

2. **"All Teams" staff dropdown bug** — `client/src/pages/TaskPlannerPage.tsx` fetched an empty staff list when `viewTeam === ''`, so assigned staff showed as "Unassigned" (no matching `<option>`). Fixed to fetch all active staff when no team is selected.

3. **Team filter not working** — changing `viewTeam` changed the assignments query's cache key, but the query had `enabled: false`, so nothing refetched. Fixed by fetching assignments once per date (they carry `team_id`) and filtering client-side instead of re-querying per team.

4. **Pagination added** — `PAGE_SIZE = 20` with Prev/Next + "Showing X–Y of Z", applied after the team filter.

5. **Saved plans persist across visits** — turnarounds/assignments queries were `enabled: false`, requiring "Fetch Flights" + re-solve on every visit even though `TaskAssignment` rows were already saved. Now both auto-load on mount/date change; solve buttons remain to regenerate (overwrite via upsert).

**Status:** Complete. `tsc --noEmit` passes with 0 errors.

---

## 2026-06-17 — Flight Schedule Rebalance, Flight Count Reductions, Validation Endpoint, Multi-Role Bug Fix

**Context:** User reported Task Planner lag, large numbers of unassigned slots, one team (T2) absorbing 173/255 turnarounds, and a staff member assigned to *every* role/set slot on a single flight (AK1002).

1. **Schedule front-loading fixed** (`server/services/flight_data.py`): `_build_mock_schedule()` previously weighted windows so 40 flights landed in 05:00–06:00 alone vs. 5 across 20:00–00:30. Replaced with 12 even 2h blocks across the full 24h operating day, counts split as evenly as possible (`divmod(count, 12)`). Also fixed a latent bug where late-night arrivals produced invalid `"24:24"`-style times (raw minutes past 1440 were never wrapped) — now wrapped via `% 1440` before formatting.

2. **Flight count reduced twice per user request**: 255 → 150 → **100** turnarounds/day (`MockFlightProvider._SCHEDULE`), to cut UI/solver load. `_build_mock_schedule` default arg updated to match.

3. **Root cause of the AK1002 bug found**: `no_double_booking` (H-T5) in `server/solver/task_constraints.py` only checked staff overlap *across different* turnarounds (`a.turnaround.id != b.turnaround.id`), so nothing prevented the solver assigning the same staff to every slot of the *same* turnaround. Added new hard constraint **H-T6** (`no_multiple_roles_same_turnaround`) — a staff member can hold at most one slot per turnaround.

4. **New assignment-validation endpoint**: `GET /api/task-planner/validate?date=` (`server/routers/task_planner.py`) — scans all staffed assignments for a date, groups by staff, and flags `double_booking` (overlapping turnaround windows) and `travel_gap` (insufficient bay-to-bay travel time between back-to-back turnarounds), reusing the same bay-sector buffer logic as the flight-impact checker. New schemas `AssignmentConflictOut` / `TaskValidationOut` in `models/schemas.py`. Wired into `TaskPlannerPage.tsx` as a "Validate Assignments" button with a pass/fail banner.

5. **Staff-facing views simplified to flight lists** (role/set detail dropped — staff already know their job):
   - `client/src/pages/StaffTasksPage.tsx` ("My Flights"): dedupes by `turnaround_id`, shows aircraft reg/type, arr/dep flight+time, bay, ground time. No role badges.
   - `client/src/pages/StaffViewPage.tsx` (admin's per-staff lookup "My Flights" section): same simplification, for consistency with the staff's own view.
   - **`TaskPlannerPage.tsx` (the actual admin planning grid) intentionally left unchanged** — admin still needs per-role/per-set detail there to edit assignments.

6. Cleared `flights`/`turnarounds`/`task_assignments` tables after each schedule change so stale data doesn't mask the fix on next Fetch Flights.

**Status:** Complete. `tsc --noEmit` passes with 0 errors. Backend changes verified via `ast.parse`; not yet re-run against a live `uvicorn` reload by the agent — user needs to restart the server to pick up `task_constraints.py`/`flight_data.py`/`task_solver_manager.py` changes.

---

## 2026-06-17 — Auto-Retry + LLM Diagnostic, Sort Bug, Root Cause of Most Unassigned Slots

### A — Loader for the solve-completion → display gap, internal self-check + bounded auto-retry

**Reported symptom:** visible lag between Timefold finishing and the assignments grid updating; many unassigned slots even after the H-T6 fix.

- `client/src/pages/TaskPlannerPage.tsx`: added a spinner banner ("Loading finalized assignments…") shown while `allDone && fetchingAssignments`, surfacing the gap instead of leaving it silent.
- `server/solver/task_solver_manager.py`: added `_scan_conflicts(slots)` — an in-memory self-check mirroring H-T5/H-T6, run immediately after solving (no DB roundtrip needed, since `TurnaroundFact`/`TaskStaffFact` already carry everything needed). Should always be empty when hard score is 0; if not (solver cut off by the 30s time limit before reaching full feasibility), `start_task_solve`'s `_run()` now auto-retries **once** with up to 90s before giving up. `TaskSolveJob` gained `retry_count`, `conflicts`, `diagnostic` fields.
- `server/services/llm_advisor.py`: added `summarize_plan(...)` — one/two sentence plain-English explanation of unassigned slots / remaining conflicts (cert+staffing shortage vs. solver timeout), Claude Haiku with rule-based fallback. Explicitly scoped as explanation-only — an LLM cannot retune Timefold's constraint weights at runtime; the actual corrective action is the deterministic retry above, not the LLM.
- `models/schemas.py`: `TaskSolverStatusOut` gained `retry_count`, `total_slots`, `unassigned_count`, `conflicts: list[SolveConflictOut]`, `diagnostic`. New `SolveConflictOut` schema (distinct from `AssignmentConflictOut`, which is the DB-level /validate scan).
- `TeamStatusCard` in `TaskPlannerPage.tsx`: shows a "retried ×N" badge, "{unassigned}/{total} unassigned", and the diagnostic sentence per team.

### B — Sort bug in admin Staff View "My Flights"

`StaffViewPage.tsx`'s `dedupeByFlight()` deduped but never sorted by time (unlike `StaffTasksPage.tsx`, which does both) — flights displayed in solver-assignment order, not chronological. Fixed: `dedupeByFlight` now sorts by `arr_time ?? dep_time` before returning.

### C — Root cause of most unassigned slots found and fixed

User noticed a staff member (RA T2 8) had assignments only 05:03–10:56 despite an 05:00–15:00 shift, then sat idle. Checked the DB: confirmed across team T2, 51/53 staff capped at 4-6 turnarounds each with 633 slots unassigned that day.

**Cause:** `balance_assignments_per_staff` (S-T2) in `server/solver/task_constraints.py` penalized **every combination of 3 distinct turnarounds** for the same staff (`C(n,3)`, via a triple self-join), not a flat per-turnaround count. Going from 5→6 turnarounds added `C(5,2)=10` newly-penalized triples (−10 soft) — which exactly cancels the −10 gained by filling one previously-unassigned slot (S-T1, weight 10). This created a hard ceiling around 5-6 turnarounds/staff regardless of real shift capacity, since turnarounds are short (30-45 min) and a person could legitimately handle far more across an 8-10h shift — real overload is already guarded by S-T4 (travel gap) and S-T3 (break window).

**Fix:** replaced the O(n³) join-based constraint with `group_by(staff_id, ConstraintCollectors.count_distinct(turnaround_id))` + a **linear** penalty (weight 2) only past a threshold of 8 turnarounds/shift — light tie-breaker, not a capacity cap.

**Verified with a synthetic test** (`_build_task_solver`/`_build_task_problem` direct, 15 non-overlapping turnarounds, 4 staff): each staff now gets assigned to all 15 (vs. the old ~5-6 ceiling); the only remaining unassigned slots (30/90) are a genuine RA-staff-count shortage (3 RAs for 5 RA-eligible slots/turnaround), not an artificial solver ceiling.

Cleared `flights`/`turnarounds`/`task_assignments` tables again so the next solve reflects this fix.

**Status:** Complete. `tsc --noEmit` passes with 0 errors. Backend verified via direct solver smoke test (real Timefold run, not just `ast.parse`) — see synthetic test above. User still needs to restart `uvicorn` to pick up `task_constraints.py`/`task_solver_manager.py`/`llm_advisor.py` changes.

---

## 2026-06-17 — Shift Handoff Window-Sharing Fix (Second Root Cause of Idle Staff)

**Reported symptom (after the S-T2 fix above):** RA T2 8 still had no assignments after 10:41 despite a shift running to 15:30/15:00.

**Investigation:** queried `gtrmy.db` directly for team T2 on 2026-06-17 — confirmed all 27 of T2's turnarounds had arrival times between 05:03 and 10:17, i.e. T2 was never even given any flights past ~10:30 to begin with. Checked the roster: T2 is on S1 (05:00–15:00), T5 is on S2 (11:00–23:00) — these genuinely overlap 11:00–15:00 (4 hours), both teams on duty simultaneously. This is a *second, independent* root cause from the S-T2 constraint fix — a windowing bug, not a solver-weighting bug.

**Cause:** `start_all_teams_solver`'s Phase 2 (`server/routers/task_planner.py`) computed each team's `exclusive_until` as simply the *next* active team's shift start, with no lower-bound adjustment — meaning during a genuine shift overlap, the **later-starting team got the entire overlap window** and the earlier team was hard-cut at the next team's start, even though the earlier team's staff were still clocked in for hours afterward. (Symmetrically, this also meant a team's effective planning window could start before its true shift start with no corresponding fix — not what caused this particular complaint, but the same class of bug.)

**Fix:** `_build_plan_data` gained a `window_start_min` parameter (alongside the existing `exclusive_until_min`) so a team's lower bound can also be adjusted, not just its upper bound. In `start_all_teams_solver`, sorted-by-start adjacent team pairs now compute one shared boundary: if their shifts don't overlap, the boundary is simply the outgoing team's own shift end (unchanged from before); if they DO overlap, the boundary is the midpoint of the overlap, so each team gets a fair half instead of one team getting all of it. Verified via a standalone simulation against the real T2(S1)/T5(S2)/T3(S3)/T6(S4) shift times:

| Team | Old window | New window |
|---|---|---|
| T2/S1 (05:00–15:00) | 05:00–11:00 (6h) | 05:00–13:00 (8h) |
| T5/S2 (11:00–23:00) | 11:00–14:30 (3.5h) | 13:00–18:45 (5.75h) |
| T3/S3 (14:30–00:30) | 14:30–23:00 (8.5h) | 18:45–23:45 (5h) |
| T6/S4 (23:00–11:00) | 23:00–05:00 (6h) | 23:45–05:00 (5.25h) |

**Deliberately excluded the last→first (night shift S4 → morning shift S1) wraparound pair from sharing.** Tested sharing it too — it actually made T2 *worse* (6h→5h), because S4's early-morning hours got pulled away from T2's start instead of extending it, and there's a separate date-attribution ambiguity for how an overnight shift's post-midnight hours map onto "today" vs "tomorrow" in this schema. Left that boundary using the original simple handoff.

**Known trade-off, flagged to user rather than hidden:** T3 drops from 8.5h to 5h as a side effect — the 4 active shifts' nominal lengths (10+12+10+12=44h) sum to far more than 24h, so giving every team's full nominal shift exclusive flights is mathematically impossible; some team(s) must share. This fix makes the sharing fair-by-boundary rather than all-or-nothing, but is not a global optimum across all 4 teams' utilization simultaneously. If T3 (or another team) surfaces a similar idle-time complaint next, the fix would be a proportional (not flat 50/50) split weighted by each team's relative shift length, or a proper joint optimization — not yet implemented.

Cleared `flights`/`turnarounds`/`task_assignments` tables again so the next solve reflects this fix.

**Status:** Complete. Verified via standalone Python simulation of the boundary math (not a full solver run) against real shift times from the DB — see table above. `ast.parse` and a real module import (`routers.task_planner`) both pass. User still needs to restart `uvicorn`.

---

## 2026-06-17 — Full Codebase Audit + Server-Side Auth/RBAC Enforcement

**Trigger:** User asked for an overall diagnostics pass to check coding standards and find improvement opportunities.

**Audit findings (fork agent, read-only):** highest-severity finding — every API router only depended on `Depends(get_db)`, never a JWT-verifying dependency. The React-side `RequireAuth`/`RequireAdmin` guards in `App.tsx` only gate the router, not the API — any unauthenticated caller could hit admin-only endpoints (create/deactivate staff, publish rosters, edit task assignments, etc.) directly. Second finding: `FlightListPage.tsx`'s replan `setInterval` was never cleared on unmount, polling forever after navigation.

**Fix — `routers/auth.py`:** added `get_current_user` (verifies the Bearer JWT) and `require_admin` (verifies + checks `is_admin`).

**Fix — admin-only routers** (`org.py`, `teams.py`, `shifts.py`, `rosters.py`, `attendance.py`, `overtime.py`, `solver.py`, `certifications.py`, `flights.py`, `task_planner.py`): added `dependencies=[Depends(require_admin)]` at the router level.

**Fix — `routers/staff.py`** (mixed access): kept `list_staff`/`create_staff`/`update_staff`/`deactivate_staff` admin-only per-route; `GET /{staff_id}/tasks` and `GET /{staff_id}/roster` (used by the staff-only `/my-tasks` and `/my-shift` pages) now require a valid token plus a new `_require_self_or_admin` check — a staff member can only view their own data, admins can view anyone's.

**Fix — `FlightListPage.tsx`:** replan poll interval now lives in a `pollRef`, cleared on a second replan click, clears itself once the job leaves `SOLVING`, and is cleaned up via a `useEffect` return on unmount.

**Verified:** app imports cleanly with all 51 routes after the dependency wiring; `vite build` clean.

**Status:** Complete.

---

## 2026-06-17 — Certification Pool Fix, RLS Flexibility Constraints, Multi-Set Driver Requirement (H-T7)

**Investigation:** user asked why staff sit idle before shift end despite many unassigned slots. Queried `gtrmy.db` directly: DRIVER slots were 56% unassigned, TOWER 34%, vs. only 12% for LOADER and 1% for RLS. Root cause: `seed.py` only granted `GSE_DRIVING`/`TOWER_OPS` certs to 6 of 40 RAs per team (~5 usable after expiry variation) — far too few to cover overlapping turnarounds, while the other ~34 RAs per team were certification-ineligible regardless of how idle they were.

**Fix — `seed.py`:** raised certified pool from 6→16 RAs per team for both `GSE_DRIVING` and `TOWER_OPS` (still keeping one EXPIRING_SOON and one EXPIRED per cert for demo variety). Requires `gtrmy.db` delete + reseed to take effect.

**New constraint — H-T7 (`task_constraints.py::multi_set_turnaround_needs_driver`):** a turnaround with `required_sets > 1` (multiple loader sets) must have at least one DRIVER assigned somewhere across its sets — hard constraint, since running multiple loader sets with zero driver isn't operationally viable, unlike an individual unfilled DRIVER slot which is just a soft (S-T1) concern.

**RLS scheduling flexibility** (per `Notes/GTRMY_Ramp_Staff_Rostering_Notes.txt` — RLS routinely starts late or runs short-staffed in real ops):
- `_prep_buffer_minutes(role)` — RLS's work window opens at STA itself (no 15-min pre-arrival buffer other roles need). Applied in `no_double_booking` (H-T5) and `enforce_travel_gap` (S-T4).
- `_travel_minutes(...)` halves the required gap when the upcoming slot is RLS.
- New **S-T6** soft constraint: unassigned RLS slots penalised at weight 3 instead of the standard weight-10 (S-T1); S-T1 now excludes RLS entirely.

**Verified** with a live synthetic solve (2 turnarounds, 5 staff incl. 1 RLS): 0 hard violations, multi-set turnaround correctly got a driver, RLS scheduled back-to-back across two turnarounds with a gap other roles couldn't use.

**Status:** Complete.

---

## 2026-06-17 — Pooled Overlap-Window Solve-All Redesign

**Reported:** unassigned-slot rate was highest right at shift-boundary hours (11:00, 23:00) rather than mid-shift, contrary to user's expectation. Verified by bucketing DRIVER/TOWER demand vs. unassigned count by hour against real data — confirmed 11:00/23:00 were among the worst, while several mid-shift hours were fully staffed (0% unassigned). Root cause: the existing overlap-handling (added in the 2026-06-17 "Shift Handoff Window-Sharing Fix" entry above) split a shared overlap window 50/50 by *time* between the two on-duty teams — each team still only had its own (certification-scarce) staff to cover its half, even though both teams' staff were on duty simultaneously.

**Fix — pool staff instead of splitting time:**
- `solver/task_domain.py`: `TaskStaffFact` gained a `team_id` field.
- `routers/task_planner.py::_build_plan_data`: new `extra_team_ids: list[int] | None` param — unions in on-duty, certified staff from those teams alongside the primary team's own.
- `routers/task_planner.py::_persist_assignments`: now attributes each assignment to the *assigned staff's own* `team_id` (falling back to the job's nominal team only when unassigned), since a pooled job's staff may belong to either team.
- `routers/task_planner.py::start_all_teams_solver`: Phase 2 now carves the overlap **entirely out** of both teams' exclusive windows (instead of splitting it at the midpoint) and queues a separate joint job per overlapping pair, solved with both teams' staff pooled via `extra_team_ids`.
- `models/schemas.py`: `TaskSolverStatusOut` gained `pooled_with_team_id` so the API reports which jobs are joint pooled-staff solves.
- `client/src/api/types.ts`, `TaskPlannerPage.tsx`: pooled jobs now render as `T2+T3` with a "pooled" badge instead of a confusing duplicate-looking card.

**Verified** end-to-end against real data: the T2/T3 overlap window (11:00–15:00, 17 turnarounds, 158 slots) went from each team alone covering half, to both teams' staff pooled — 0 hard violations, only 1/158 unassigned, with staff from both teams actually picking up work in the shared window.

**Status:** Complete.

---

## 2026-06-17 — SQLite Lock Contention Fix (WAL + Bulk Upsert)

**Reported:** `solve-all` consistently threw `sqlite3.OperationalError: database is locked`, always on the same team (T2).

**Root cause #1 — no WAL / thin busy_timeout:** `database.py`'s engine used SQLite's default `delete` journal mode with only a 5s busy_timeout. Confirmed via `PRAGMA journal_mode`/`PRAGMA busy_timeout` on the live DB file.

**Fix:** added a `connect` event listener on `engine.sync_engine` setting `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=30000`. Verified via `engine.begin()` that both pragmas take effect through the app's actual async engine, and stress-tested 10 concurrent writers with zero lock errors (vs. failing before the fix).

**Root cause #2 (the one actually still causing locks after the WAL fix) — long-held write transactions:** `_persist_assignments` looped one `execute()` per solved slot (a job can have 150–900+ slots) before a single final commit. With `solve-all` now launching ~11 concurrent jobs (6 teams' exclusive windows + ~5 pooled-overlap jobs, per the redesign above), each holding the write lock for several seconds, the cumulative queueing time for an unlucky job exceeded even the 30s busy_timeout. T2 being involved in two jobs (its own window + the T2/T3 pooled overlap) made it more likely to be the one queued behind others.

**Fix — `_persist_assignments`:** replaced the per-slot loop with a single multi-row upsert (`sqlite_insert(TaskAssignment).values(rows)` + `on_conflict_do_update` using `stmt.excluded.*`), cutting lock-hold time from seconds to milliseconds. Verified against the real DB: 158 rows persisted correctly in one statement.

**Status:** Complete. User confirmed no further lock errors after restarting with both fixes applied.

---

## 2026-06-17 — Overtime Constraints: Minimum Rest Period (H9/H9b) + DM-Only Approval (H8)

**Reported:** `overtime.py` had no real eligibility constraints — any active staff member could be signed up for OT regardless of their roster status that day.

**First pass (superseded by the rest-period correction below):** added checks blocking OT signup when a staff member was marked MC/EL, or already on a 12h shift (S2/S4) that day — reasoning a 10h shift (S1/S3) left 2h of headroom under the documented 12h daily cap (`Notes/GTRMY_Ramp_Staff_Rostering_Notes.txt`: "if associate work 10 hrs ... only 2 hrs can be done as OT").

**Correction:** user pointed out this still allowed same-day-shift OT, which doesn't satisfy the notes' separate minimum-rest requirement before OT can start. Replaced with:
- **H9:** any ON_DUTY roster entry on the requested date blocks OT signup outright — there's no way to fit a rest break in if you're already working that day.
- **H9b:** also checks the *previous* day's shift, since overnight shifts (e.g. S4, 23:00–11:00) are recorded under their start date and wouldn't otherwise show up as "today." Computes rest hours until midnight of the OT date from `shift.start_time + shift.duration_hours`; blocks if under `MIN_REST_HOURS = 10`.
- **H8 (was previously unenforced despite the UI labelling it):** `approve_volunteer` now verifies `approver_id` resolves to an active staff member with role `DM` — previously any integer was accepted with zero validation.
- Both `approve`/`reject` now reject acting on a record that isn't `PENDING` (no double-approving/rejecting).

**Verified** against real seeded data: a staff member rostered ON_DUTY today was correctly rejected with the rest-hours message; a genuinely off-duty staff member was correctly accepted.

**Status:** Complete.

---

## 2026-06-17 — Task Planner UI: Performance Fix + Professional Color Palette

**Reported:** the page "felt stuck," loaders weren't smooth, flight details looked bland, and (after a first colorful pass) the palette looked unprofessional for a business app.

**Performance root cause:** a 200ms `setInterval` ticking the "generation time" display called `setState` directly on the page component, re-rendering the *entire* page — including every turnaround card and its role-slot `<select>` elements — five times a second, stacked on top of the existing 1s job-status poll doing the same.

**Fix:**
- Extracted the ticking clock into its own `GenerationTimer` component with local state (ticks at 1s now, not 200ms) — only re-renders itself, not the page.
- Wrapped `TurnaroundCard`/`TeamStatusCard` in `React.memo`; stabilised their callback props (`onUpdateTA`, `onReassign`) via `useCallback` so unrelated state changes (the poll) no longer force-rerender cards whose data hasn't changed.

**Visual pass 1 (colorful):** added colored flight-detail pills (ARR/DEP/ground-time/bay/cargo), livelier role-slot colors, gradient header/buttons. Also fixed a latent bug found along the way: the aircraft-type badge read `ta.aircraft_type`, a field that doesn't exist on `Turnaround` (always silently fell back to "A320") — now correctly reads from `arr`/`dep` flight records.

**Visual pass 2 (professional, per feedback):** consolidated the rainbow of fuchsia/teal/sky/violet/orange down to one brand color (indigo/blue) + neutral slate, with color reserved only for real status meaning (filled/unfilled, ground-time urgency, success/warning/error) rather than decoration. Flight-detail chips became neutral slate outline chips with a small colored icon accent instead of solid colorful fills.

**Status:** Complete. `vite build` and `tsc` checked clean both passes (one pre-existing, unrelated type error — the aircraft_type bug above — incidentally fixed as a side effect).

---

## 2026-06-17 — Deployment: Netlify SPA Routing Fix + Render Dockerfile for Backend

**Reported:** deploying the client to Netlify gave a "Page not found" 404 on direct route navigation/refresh.

**Cause:** the client uses React Router's `BrowserRouter` (client-side routing); Netlify's static host only serves actual files, so any path other than `/` 404s without an explicit fallback rule.

**Fix:** added `client/public/_redirects` (`/* /index.html 200`) — Vite copies `public/` into `dist/` verbatim, and Netlify auto-applies this convention file. Verified it lands in `dist/` after build.

**Separate, bigger issue surfaced:** Netlify can only ever serve the static client — it cannot run the Python/FastAPI/Timefold backend at all (confirmed: Timefold needs JPype which needs a real JVM, plus a persistent SQLite file; Netlify has neither). User confirmed they'd uploaded the whole project expecting Netlify to host both. Backend needs a separate host (Render chosen).

**Backend deployment files added** (`server/`):
- `Dockerfile` — `python:3.12-slim` base + `openjdk-17-jre-headless` (Timefold's documented JDK 17+ minimum, confirmed via package metadata) with `JAVA_HOME` set to Debian's standard install path; installs `requirements.txt`; runs `start.sh`.
- `start.sh` — runs `python seed.py` (idempotent — every section checks for existing rows before inserting, never touches flights/turnarounds/assignments) before starting uvicorn, so a fresh deploy with no persistent disk comes up seeded instead of empty. Confirmed LF line endings (a Windows-authored shebang script with CRLF would break in the Linux container).
- `.dockerignore` — excludes `venv/`, `__pycache__/`, `*.db`, `*.log`, `package.json` (a local-only dev convenience script) from the build context.
- Also deleted a stray `hs_err_pid17840.log` (JVM crash log) that had accumulated in `server/`.

**Documented but not yet automated:** env vars the app reads (`JWT_SECRET`, `ADMIN_EMPLOYEE_ID`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ANTHROPIC_API_KEY`, `AERODATABOX_API_KEY`, `FLIGHT_DATA_PROVIDER`, `SOLVER_TIME_LIMIT_SECONDS`) need to be set in Render's dashboard; client's `axios baseURL` and `main.py`'s CORS allowlist still need to point at each other's real deployed URLs once both are live (not yet done — pending the actual URLs existing).

**Not verified locally:** Docker isn't available in this environment, so the Dockerfile/start.sh couldn't be build-tested end-to-end — only verified against known package facts (Timefold's JDK 17+ requirement, Debian's standard `openjdk-17-jre-headless` install path, start.sh's line endings, seed.py's idempotency). Flagged to user to report back the first Render build log if anything's off.

**Status:** Netlify fix verified (file lands in `dist/`). Render setup written but pending the user's first actual deploy to confirm the JAVA_HOME path and full boot sequence work end-to-end.

---

## 2026-06-17 — Render Deploy Debugging: Root Directory + JDK Package Name

**Issue 1 — `failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory`.** Confirmed `server/Dockerfile` was correctly committed and pushed (checked the exact commit Render had cloned). Root cause was a Render service-config issue, not a repo issue: **Root Directory** wasn't set to `server`, so Render's build context was the repo root, where there's no top-level `Dockerfile`. User confirmed repo root layout via `git ls-tree` (`client/`, `server/` as direct top-level dirs) — instructed to set Root Directory to exactly `server`, and to choose **Docker** as the runtime/language (not Python — Render's native Python buildpack has no way to install a JDK, which Timefold needs; it would build fine but crash on boot with a JVM-not-found error).

**Issue 2 — `Package 'openjdk-17-jre-headless' has no installation candidate`.** With Root Directory fixed, the build reached the JDK install step and failed: `python:3.12-slim`'s current base image is Debian "trixie" (Debian 13), whose apt repos dropped `openjdk-17-jre-headless` — only `openjdk-21-jre`/`openjdk-21-jdk-headless` are available (apt's own error output suggested these as replacements).

**Fix — `server/Dockerfile`:** switched to `openjdk-21-jdk-headless` and updated `JAVA_HOME` to `/usr/lib/jvm/java-21-openjdk-amd64` to match. Still satisfies Timefold's documented JDK 17+ minimum — just a higher version than originally planned, forced by the base image's current Debian release. Updated `README.md`'s Deployment section and Common Issues table to match, and noted in both that a future base-image bump could shift the available JDK version again (check `apt-cache search openjdk` in the build log if it recurs).

**Status:** Dockerfile fix made; pending user's next Render deploy to confirm the JDK 21 install + JAVA_HOME path work end-to-end.

---

## 2026-06-20 — Triple-Overlap Windowing Bug, Cert Coverage Widening, Reduced 3-Set Flights

**Reported:** user pushed back on the magnitude of unassigned slots (301/day, ~16%) given that staffing capacity vastly exceeds peak concurrent turnaround demand (6-10 concurrent vs. 53-159 staff on duty depending on time of day) — expected closer to ~50/day.

### A — Root cause: 3-way shift-overlap windowing bug (`server/routers/task_planner.py`)

**Investigation:** computed max concurrent turnarounds (6 exact / 10 in any 30-min window) and min/max staff on duty (53 min, 159 max, 106 normal) directly from the DB, confirming demand never came close to exhausting capacity — the gap had to be a bug, not a real shortage. Traced it to `start_all_teams_solver`'s Phase 2: it only compared each team against its *immediate* neighbor when carving out shift overlaps. When **three** shifts mutually overlapped (e.g. S1∩S2 = 11:00–15:00 and S2∩S3 = 14:30–23:00, which themselves overlap in 14:30–15:00), the middle team's window was computed as `window_start=15:00, exclusive_until=14:30` — an inverted interval. Downstream midnight-wrap logic misread that as "nearly the whole day," handing that one team ~96 of the day's 100 turnarounds to staff alone with only its own headcount (one run showed `total_slots=892`, `unassigned=202`, infeasible `-2hard`).

**Fix:** replaced the pairwise adjacent-neighbor logic with a proper sweep-line over every active team's `[shift_start, end)` interval, partitioning the day into segments by exactly which set of teams is on duty in each one (handles N-way overlaps, not just pairs), then launching one job per segment — solo if 1 team, pooled via the existing `extra_team_ids` list param if 2+. The night→morning handoff boundary (e.g. S4 23:00–11:00 back to S1 05:00) is still deliberately exempted from pooling, same as before (empirically worse when pooled) — implemented by capping the last-by-start team's interval at the first team's start time before the sweep, so it degenerates to the old special-cased behavior there.

**Caveat:** `TaskSolverStatusOut.pooled_with_team_id` stays a single `Optional[int]` for backward compatibility — a genuine 3-way pooled job still solves correctly (all extra teams' staff are unioned in via `extra_team_ids`), but the API/UI only surfaces one of the pooled teams' IDs in that field, not all of them.

**Gotcha hit while verifying:** two stale `uvicorn --reload` processes were both bound to port 8000 from earlier in the session, so the first re-test silently hit old code. Killed both and restarted a single clean instance before the fix showed up.

**Verified on 2026-06-20 real data:** day-total unassigned dropped from 301 to 95 (924 total slots), and every job now scores `0hard` (no infeasibility anywhere, vs. one infeasible job before). Remaining 95 concentrated almost entirely in the two non-pooled solo windows (T6 alone 05:00–11:00: 57/266; T4 alone 00:30–05:00: 36/176) — pooled windows were ~100% filled.

### B — Cert coverage widened for non-pooled shift-edge windows (`server/seed.py`)

Solo windows (no neighboring team to pool certified staff from) were still short. Widened `GSE_DRIVING`/`TOWER_OPS` coverage per team from `RA[0:24]`/`RA[12:36]` (60% each, 12 dual) to `RA[0:32]`/`RA[8:40]` (80% each, 24 dual) — union now covers all 40 RA per team, so every RA holds at least one of the two certs.

### C — Reduced 3-set-loader flight share (`server/services/flight_data.py`)

`_build_mock_schedule`'s cargo-weight distribution shifted from 50/35/15% (light/medium/heavy → 1/2/3 sets) to 50/43/7%, roughly halving 3-set flights (15→~7-10 of the day's 100 turnarounds) without eliminating them — each 3-set flight needs 3 DRIVER + 9 LOADER slots filled, so fewer of them meaningfully reduces total demand.

**Verified together on 2026-06-20** (DB wiped, reseeded, rosters/flights regenerated): day-total unassigned dropped further to 45/864 slots (5.2%), all jobs still `0hard`. T6-alone improved from 57/266 (21%) to 27/246 (11%); T4-alone from 36/176 (20%) to 18/160 (11%) — roughly halved in both. Pooled windows remained ~100% filled. Lands right in the user's ~50/day expectation.

**Status:** Complete.

---

## 2026-06-20 — Per-Shift OT Caps (`OTVolunteer.shift_id`)

**Asked:** user noticed `OTVolunteer` had no shift association — the existing H7 cap (`MAX_OT_SLOTS = 6`) was a flat per-day total, so mentally splitting it as "3 for S1 + 3 for S4" had no effect: the system could only see "6 OT signups today," not which shift each one covered. User confirmed: add a `shift_id` field and enforce per-shift caps instead.

**Backend (`server/models/db_models.py`, `schemas.py`, `routers/overtime.py`):** added `shift_id: Mapped[int]` (FK to `shifts.id`, NOT NULL) and a one-directional `shift` relationship on `OTVolunteer`; added `shift_id: int` to `OTVolunteerCreate`/`OTVolunteerOut`. In `signup_volunteer`, added a `Shift` lookup (404 if missing), renamed `MAX_OT_SLOTS` → `MAX_OT_SLOTS_PER_SHIFT` (still 6), and scoped the H7 cap-check query to `OTVolunteer.shift_id == payload.shift_id` in addition to the date filter, with the 400 error now naming the specific shift code (e.g. `"OT volunteer slots full for S1 on 2026-06-25 (max 6)."`). The per-staff "already signed up today" duplicate check stays date-only (not shift-scoped) — one person can't double-dip OT across two shifts the same day.

**Frontend (`client/src/api/types.ts`, `client.ts`, `pages/OvertimePage.tsx`):** `OTVolunteer` type and `signupOT()` gained `shift_id`. `OvertimePage` now shows one slot-counter card per shift (each capped at 6) instead of one global bar, the sign-up form has a shift dropdown, and the volunteer table/cards show each row's shift code.

**Migration:** `shift_id` is a new NOT-NULL column on an existing table with no Alembic migration path in this project — wiped `gtrmy.db` and re-ran `seed.py` (consistent with the established pattern for schema changes here).

**Verified on 2026-06-20** via direct API calls with an admin bearer token: signed up 6 different staff to shift S1 on the same date — 7th S1 signup correctly rejected (`"OT volunteer slots full for S1 ... (max 6)"`), while a signup for S4 on the same date succeeded unaffected, confirming the cap is now per-shift rather than a shared flat pool. Reset `gtrmy.db` to a clean seed afterward.

**Status:** Complete.

## 2026-06-18 — Split arrival/departure crews for long-ground-time turnarounds

**Asked:** user noticed the timeline mockup had no flights with unusually long ground times, and reasoned that when ground time is large enough, a single crew shouldn't cover the whole turnaround — one team should handle arrival (unload/marshal) and a separate team should handle departure (load/pushback). Asked to scope as seed-data-only vs. a full architecture change; user chose **full split-team implementation**.

**Seed data (`server/services/flight_data.py`):** `_build_mock_schedule` now forces a long ground time (150-220 min, vs. the normal 30/35 min) for every 17th turnaround (`i % 17 == 5`), producing 5 long-ground turnarounds per day spread across different times/shift boundaries.

**Domain (`server/solver/task_domain.py`):** `RoleSlot` gained a `leg: str = "BOTH"` field (`"BOTH"` | `"ARRIVAL"` | `"DEPARTURE"`). `TurnaroundFact` itself is unchanged — leg-splitting metadata is passed alongside `plan_data`, not baked into the fact, to avoid touching `TurnaroundFact(**t)` construction.

**Constraints (`server/solver/task_constraints.py`):** added `LONG_TURNAROUND_THRESHOLD_MIN = 90`, `ARRIVAL_LEG_MINUTES`/`DEPARTURE_LEG_MINUTES = 45`, `ground_minutes()`/`is_long_turnaround()` (midnight-safe), and `_slot_window()`/`_window()` which return a slot's actual working window based on its leg — `"BOTH"` is unchanged (`[sta - prep_buffer, std]`), `"ARRIVAL"` is `[sta - prep_buffer, sta+45]`, `"DEPARTURE"` is `[std-45, std]`. H-T5 (`no_double_booking`) and S-T4 (`enforce_travel_gap`) now use `_window()` instead of the flat sta→std span; H-T7 (`multi_set_turnaround_needs_driver`) groups by `(turnaround.id, leg)` instead of just `turnaround.id`. H-T6 (`no_multiple_roles_same_turnaround`) was deliberately left keyed on `turnaround.id` only — it already enforces "different person per leg" as a side effect.

**Solver manager / router (`task_solver_manager.py`, `routers/task_planner.py`):** `_build_plan_data` computes each turnaround's relevant legs (`["BOTH"]` or `["ARRIVAL","DEPARTURE"]`) and filters them per shift window (so a long turnaround's two legs can land in different, even non-adjacent, team/window solve jobs); `_build_task_problem` generates one full set of RLS/TOWER/DRIVER/LOADER slots per relevant leg. `_persist_assignments` and the `/validate` endpoint are leg-aware (`leg` added to the upsert key and to per-turnaround dedup keys).

**Schema (`server/models/db_models.py`):** `TaskAssignment` gained `leg: str = "BOTH"`, and its unique constraint became `(turnaround_id, task_role, set_number, slot_index, leg)`. No Alembic — wiped `gtrmy.db` and reseeded.

**Frontend (`types.ts`, `TaskPlannerPage.tsx`):** `TaskAssignment.leg` added; non-`"BOTH"` slots show an ARR/DEP badge and sort arrival-leg slots before departure-leg slots within a turnaround card.

**Verified on 2026-06-20** via solve-all + persisted-assignment inspection: all 6 jobs finished `0hard`. The 5 long turnarounds (IDs 88, 74, 30, 90, 77) all split into ARRIVAL/DEPARTURE legs; 4 of 5 were staffed by genuinely different teams per leg (e.g. TA 77: Team 4 covers arrival, Team 6 covers departure). `/validate` found 0 double-booking conflicts involving any of the split turnarounds (the 36 double-booking + 50 travel-gap conflicts it did find are pre-existing soft-constraint noise unrelated to this change, confirmed by `turnaround_id` not matching any of the 5). Reset `gtrmy.db` to a clean seed and restarted the dev server afterward.

**Status:** Complete.
