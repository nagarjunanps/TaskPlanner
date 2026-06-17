# GTR Malaysia Task Planner

AI-powered shift roster planner for AirAsia Ground Team Red (GTRMY) Narrowbody Ramp operations at KLIA Terminal 2. Uses **Timefold AI** (constraint programming) to generate monthly rosters that satisfy all operational, legal, and safety constraints.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | For the React client |
| Python | 3.10 | Server venv uses Python 3.10 specifically |
| JDK | 21 | Required by Timefold AI (JVM-based solver) |
| npm | 8+ | Package manager |

> **Windows note:** This guide uses PowerShell syntax. Git Bash / WSL commands are similar but `$env:` becomes `export`.

---

## First-Time Setup

### 1. Install JDK 21 (if not already installed)

```powershell
winget install Microsoft.OpenJDK.21 --accept-source-agreements --accept-package-agreements
```

After installation, set `JAVA_HOME` (required every terminal session, or add to system environment variables permanently):

```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot"
$env:Path = $env:Path + ";$env:JAVA_HOME\bin"
```

To make it permanent (run once in an elevated PowerShell):

```powershell
[System.Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot", "Machine")
```

### 2. Create the Python virtual environment

```powershell
cd server
py -3.10 -m venv venv
.\venv\Scripts\pip install -r requirements.txt
```

### 3. Seed the database

```powershell
# still inside server/
.\venv\Scripts\python seed.py
```

Expected output:
```
Seeded 4 shifts.
Seeded 6 teams.
Seeded 53 sample staff in T1.
Seeded 53 sample staff in T2.
Seeded 53 sample staff in T3.
Seeded 53 sample staff in T4.
Seeded 53 sample staff in T5.
Seeded 53 sample staff in T6.
Seed complete.
```

> `seed.py` is idempotent — it only seeds teams whose staff list is empty, so re-running on a partially-seeded database is safe.

### 4. Install client dependencies

```powershell
cd ..\client
npm install
```

---

## Starting the Application

Open **two separate terminal windows**.

### Terminal 1 — Python / FastAPI server (port 8000)

```powershell
# Set JAVA_HOME (required for Timefold AI)
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot"
$env:Path = $env:Path + ";$env:JAVA_HOME\bin"

cd server
.\venv\Scripts\uvicorn main:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
```

### Terminal 2 — React / Vite client (port 5173)

```powershell
cd client
npm run dev
```

You should see:
```
VITE v8.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
```

Open `http://localhost:5173` in your browser.

> The Vite dev server proxies all `/api/*` requests to `http://localhost:8000`, so no CORS issues during development.

---

## Testing the Functionality

### Manual API Tests (PowerShell)

Run these against the running server at `http://localhost:8000`.

**Health check**
```powershell
Invoke-RestMethod "http://localhost:8000/api/health"
# Expected: @{status=ok}
```

**List teams and check composition**
```powershell
Invoke-RestMethod "http://localhost:8000/api/teams"
# Expected: 6 teams, T1 should show dm_count=1, rls_count=12, ra_count=40
```

**List the 4 fixed shifts**
```powershell
Invoke-RestMethod "http://localhost:8000/api/shifts"
# Expected: S1 (05:00-15:00), S2 (11:00-23:00), S3 (14:30-00:30), S4 (23:00-11:00)
```

**List staff for any team (team_id 1–6)**
```powershell
Invoke-RestMethod "http://localhost:8000/api/staff?team_id=1"
# Expected: 53 staff (1 DM, 12 RLS, 40 RA) — same for team_id 2 through 6
```

---

### Testing Roster Creation + Solver (H1a, H1b, H3, H6)

> The solver works for **any team (T1–T6)**. Change `team_id` to 1–6 below.

**Step 1: Create a roster for any team and month**
```powershell
$teamId = 1   # change to 1-6 for any team
$body = "{""team_id"":$teamId,""year"":2026,""month"":6}"
$roster = Invoke-RestMethod -Uri "http://localhost:8000/api/rosters" -Method Post -Body $body -ContentType "application/json"
Write-Host "Roster ID: $($roster.id)  Entries: $($roster.entries.Count)"
# Expected: Roster ID: N  Entries: 1590  (53 staff × 30 days)
```

**Step 2: Start the Timefold AI solver**
```powershell
$body = "{""roster_id"":$($roster.id)}"
$job = Invoke-RestMethod -Uri "http://localhost:8000/api/solver/start" -Method Post -Body $body -ContentType "application/json"
Write-Host "Job ID: $($job.job_id)  Status: $($job.status)"
# Expected: Status: SOLVING
```

**Step 3: Poll until complete**
```powershell
do {
    Start-Sleep -Seconds 3
    $status = Invoke-RestMethod "http://localhost:8000/api/solver/status/$($job.job_id)"
    Write-Host "$($status.status) | Score: $($status.best_score) | $($status.time_spent_seconds)s"
} while ($status.status -eq "SOLVING")
# Expected: SOLVING_COMPLETED | Score: 0hard/-Xsoft | ~30-40s
# Score will be 0 hard (no violations) and some negative soft (shift variety penalties)
```

**Step 4: Validate the solved roster**
```powershell
$validation = Invoke-RestMethod -Uri "http://localhost:8000/api/solver/validate/$($roster.id)" -Method Post
Write-Host "Hard violations: $($validation.hard_count)  Soft: $($validation.soft_count)"
$validation.violations | Format-Table constraint, severity, date, message -AutoSize
```

**Step 5: Publish the roster (only works if hard violations = 0)**
```powershell
Invoke-RestMethod -Uri "http://localhost:8000/api/rosters/$($roster.id)/publish" -Method Post
# Expected: status = PUBLISHED
```

---

### Testing the OT Volunteer Cap (H7 — max 6 slots)

```powershell
$date = "2026-06-20"
for ($i = 1; $i -le 7; $i++) {
    try {
        $body = "{""staff_id"":$i,""date"":""$date""}"
        Invoke-RestMethod -Uri "http://localhost:8000/api/overtime/volunteers" -Method Post -Body $body -ContentType "application/json" | Out-Null
        Write-Host "Slot $i: ACCEPTED"
    } catch {
        Write-Host "Slot $i: REJECTED (400 - cap enforced)"
    }
}
# Expected: Slots 1-6 ACCEPTED, Slot 7 REJECTED
```

---

### Testing OT Approval (H8)

```powershell
# List pending volunteers
$volunteers = Invoke-RestMethod "http://localhost:8000/api/overtime/volunteers?date=2026-06-20"
$pendingId = ($volunteers | Where-Object { $_.status -eq "PENDING" } | Select-Object -First 1).id

# Approve using DM staff id=1 (T1-DM-001)
Invoke-RestMethod -Uri "http://localhost:8000/api/overtime/volunteers/$pendingId/approve?approver_id=1" -Method Put
# Expected: status = APPROVED, approved_by = 1

# Reject another
$pendingId2 = ($volunteers | Where-Object { $_.status -eq "PENDING" } | Select-Object -First 1).id
Invoke-RestMethod -Uri "http://localhost:8000/api/overtime/volunteers/$pendingId2/reject" -Method Put
# Expected: status = REJECTED
```

---

### Testing Attendance & Runner Designation (H11, H12)

```powershell
# Fetch daily attendance for T1 on a date in the solved month
$entries = Invoke-RestMethod "http://localhost:8000/api/attendance?date=2026-06-15&team_id=1"
Write-Host "Entries for 2026-06-15: $($entries.Count)"

# Find an RA staff ON_DUTY entry and toggle runner flag
$raEntry = $entries | Where-Object { $_.entry_type -eq "ON_DUTY" } | Select-Object -First 1
$body = '{"is_runner":true}'
Invoke-RestMethod -Uri "http://localhost:8000/api/attendance/$($raEntry.id)" -Method Put -Body $body -ContentType "application/json"
# Expected: is_runner = true

# Mark a staff member as MC
$mcEntry = $entries | Select-Object -Index 5
$body = '{"entry_type":"MC"}'
Invoke-RestMethod -Uri "http://localhost:8000/api/attendance/$($mcEntry.id)" -Method Put -Body $body -ContentType "application/json"
# Expected: entry_type = MC
```

---

### UI Walkthrough

Open `http://localhost:5173` and navigate through each page:

| Page | What to verify |
|---|---|
| **Dashboard** | 6 teams listed, T1 shows Full Strength (1 DM / 12 RLS / 40 RA), constraint rules panel visible |
| **Staff → Add Staff** | Create a new RA for T1 → appears in table immediately |
| **Roster → Select T1 + June 2026** | Calendar grid shows solved entries (S1/S2/S3/S4 badges per staff per day) |
| **Roster → Validate** | Violations panel shows hard/soft counts; green "ready to publish" if clean |
| **Roster → Publish** | Button disabled if hard violations exist; changes status badge to PUBLISHED |
| **Attendance → June 15** | Staff list with ON_DUTY/OFF/MC/EL/OT dropdowns; Set Runner toggles show yellow "R" badge |
| **Overtime → Sign up 7 volunteers** | 7th signup shows error: "OT volunteer slots full" |
| **Overtime → Approve** | Select DM from dropdown, approve pending — status changes to APPROVED |

---

## Interactive API Docs

FastAPI auto-generates an interactive API explorer:

- **Swagger UI:** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`

---

## Project Structure

```
taskplanner/
├── client/                    # React 18 + TypeScript + Vite + Tailwind
│   ├── src/
│   │   ├── api/               # API client (axios) + TypeScript types
│   │   ├── components/
│   │   │   ├── layout/        # Sidebar navigation
│   │   │   └── roster/        # EntryBadge, ConstraintWarnings, SolverProgress
│   │   └── pages/             # Dashboard, Roster, Staff, Attendance, Overtime
│   └── vite.config.ts         # Proxy /api → :8000
│
├── server/                    # Python 3.10 + FastAPI
│   ├── main.py                # App entry point, CORS, router registration
│   ├── database.py            # SQLAlchemy async engine + session
│   ├── models/
│   │   ├── db_models.py       # ORM models (Team, Staff, Shift, Roster, Entry, OT)
│   │   └── schemas.py         # Pydantic v2 request/response schemas
│   ├── routers/               # One file per resource (teams, staff, rosters, …)
│   ├── solver/
│   │   ├── domain.py          # Timefold planning domain (Solution, Entity, Facts)
│   │   ├── constraints.py     # @constraint_provider: H1-H12, S1-S7 + validation fn
│   │   └── solver_manager.py  # Async job management, solution persistence
│   ├── seed.py                # One-time DB seed (4 shifts, 6 teams, 53 staff)
│   └── requirements.txt
│
├── .gitignore
├── README.md                  # This file
├── PROJECT_SUMMARY.md         # Full architecture & constraint documentation
└── package.json               # Root: concurrently script
```

---

## Environment Variables

Create a `.env` file in `server/` to override defaults:

```env
SOLVER_TIME_LIMIT_SECONDS=30   # How long Timefold runs before returning best solution
```

---

## Common Issues

| Problem | Solution |
|---|---|
| `JVMNotFoundException: No JVM shared library` | Set `$env:JAVA_HOME` before starting the server (see Setup §1) |
| `InvalidJVMVersionError: requires JVM version 17 or later` | Install JDK 17+ — JDK 21 recommended |
| `Port 8000 already in use` | Kill the existing process: `Get-Process -Name uvicorn \| Stop-Process` |
| `Port 5173 already in use` | Vite will auto-increment to 5174 — update proxy target if needed |
| `Roster already exists` | Delete `server/gtrmy.db` and re-run `seed.py` to reset |
| Solver returns `ERROR` status | Check server logs — usually a JVM classpath issue or constraint stream error |
| Solver score stays `0hard/0soft` with all entries OFF | Ensure constraints use `for_each_including_unassigned` for OFF-day detection (H1b) |
| Only T1 has staff after seeding | Run `seed.py` again — it adds missing teams idempotently |
