# GTR Airport Ground Operations — AI Task Planner
## Complete Project Plan

**Project:** GTR (Ground Team Red) AI-Powered Task & Shift Planning Application
**Airport:** KLIA T2 — AirAsia Operations
**Departments:** RAMP · PAX (Guest Services)
**Prepared:** June 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Departments & Organisational Structure](#2-departments--organisational-structure)
3. [Shift Structure](#3-shift-structure)
4. [Team Composition](#4-team-composition)
5. [Operational Constraints](#5-operational-constraints)
6. [Certification & Qualification Matrix](#6-certification--qualification-matrix)
7. [Application Modules & Pages](#7-application-modules--pages)
8. [Functional Flow](#8-functional-flow)
9. [Technology Stack](#9-technology-stack)
10. [Database Schema](#10-database-schema)
11. [AI Planning Architecture](#11-ai-planning-architecture)
12. [Real-Time Disruption Handling](#12-real-time-disruption-handling)
13. [Build Phases](#13-build-phases)
14. [Open Decisions](#14-open-decisions)

---

## 1. Project Overview

### Objective

Replace the current manual, WhatsApp-driven, Excel-based ground operations workflow with a system-driven, near-real-time application that:

- Automates shift and task planning for RAMP and PAX staff
- Handles live flight schedule changes on D-day with AI-powered re-planning
- Gives staff visibility of their monthly roster via a login-based interface
- Gives supervisors and admins full control with override and edit capabilities
- Monitors staff certifications and flags expiries proactively

### Scale

| Metric | Value |
|---|---|
| Daily turnaround flights | ~255–256 |
| Total daily flight events (arr + dep) | ~570 |
| Flights with schedule/bay/timing changes | 70–80% |
| Best OTP | ~98.9% |
| Worst OTP | ~77% |
| Turnaround window — A320 | 30 minutes |
| Turnaround window — A321 | 35 minutes |
| Turnaround window — A330 (WB) | 105 minutes (1 hr 45 min) |

### Current Pain Points Being Solved

- Manual copy-paste of flight schedules from Redwatch into Excel
- 100+ WhatsApp groups for communication — noisy, version mismatch, screenshots unreadable
- No real-time staff reallocation when flight changes occur
- No cert expiry tracking or enforcement
- No visibility of who has actually reported to the bay
- DTM cannot focus on critical flights — spending time monitoring all flights manually
- Vendor staff not visible in rostering tools

---

## 2. Departments & Organisational Structure

```
GTR Ground Operations
├── RAMP
│   ├── AirAsia NB (Narrow Body) — 6 teams
│   ├── WB (Wide Body) — 8 teams
│   ├── Techramp
│   ├── AIC (Night Stops)
│   ├── ACC (Airport Control Centre — DTM / Command Centre)
│   ├── Load Control
│   └── FOCA / FRT (Foreign Carrier Operations)
└── PAX (Guest Services)
    ├── Counter Operations
    ├── Gate Operations
    └── Transfer Desk
```

### Key Rules
- A user belongs to one department only — RAMP or PAX. No cross-department movement.
- Sub-department assignment is fixed per user.
- NB and WB staff are never interchangeable.

---

## 3. Shift Structure

### RAMP Shifts

| Code | Timing |
|---|---|
| S1 | 05:00 – 15:00 |
| S2 | 11:00 – 23:00 |
| S3 | 14:30 – 00:30 |
| S4 | 23:00 – 11:00 |

### PAX Shifts

| Code | Period | Start Times |
|---|---|---|
| AM1 | Morning | 02:00 |
| AM2 | Morning | 03:00 |
| AM3 | Morning | 05:00 |
| PM1 | Afternoon | 11:00 |
| PM2 | Afternoon | 12:00 |
| PM3 | Afternoon | 14:30 |

All shifts are 10 hours duration.

### Working Pattern
- 4 days working, 2 days off — continuous rotating cycle
- Teams rotate AM ↔ PM every 4 days (PAX)
- Within 4 working days, shift timing may vary
- No more than 3 consecutive days on the same shift
- Minimum rest period enforced between shifts (Malaysia JK labour rules)

### Working Hours Policy
- Maximum 12 hours/day on working days
- Regular duty: 10 hours
- Overtime (OT): maximum 2 hours on working days
- Off days: OT allowed — volunteer OT list, max 6 people per day

---

## 4. Team Composition

### RAMP — Narrow Body (NB) Teams

**6 teams total**

Each team:
- 1 Duty Manager (DM)
- 1 Ramp Loading Supervisor (RLS) — up to 40 members per RLS
- 12 Ramp Agents per RLS

**Per-flight assignment:**

| Condition | Assignment |
|---|---|
| Cargo < 1.5 tons | 1 RLS + 1 Driver + 1 Loader Set (3 agents) + 1 Tower |
| Cargo > 1.5 tons or dual-hold | 2 Loader Sets |
| Heavy sector (~10T+) | 3 Loader Sets |
| Ground time ≤ 45 min | Same team handles full turnaround |
| Ground time > 45 min | Separate arrival and departure teams |

**Runner pool:** 26 RLS required; typically 18–20 available. Shortfall must be flagged.

### RAMP — Wide Body (WB) Teams

**8 teams — 56 staff total**

Each team (7 members):
- 1 RLS
- 2 JCPL Operators (container loader)
- 2 Drivers
- 2 Loaders

WB operations must complete within 1 hour total.

### PAX — Guest Services Teams

**4 teams (A, B, C, D)**

Each team (~12 officers minimum):
- 2–3 Duty Managers per shift
- 5–6 GSOs per sector
- 50–55 GSAs per shift

**Gate Sectors:**

| Sector | Gates | GSO Count |
|---|---|---|
| J | J1 – J24 | 5–6 |
| LK | L1 – K22 | 5–6 |
| P | P1 – P16 | 5–6 |
| Q | Q1 – Q16 | 5–6 |

Per sector: 1 GSO + 2–4 Runners (GSA) + 2 GSA per gate (Gate Controller + Coordinator)

**Counter Zones:**
- Domestic: Counters S and T
- International: Counters U through Y

---

## 5. Operational Constraints

### Hard Constraints — Must Never Be Violated

| # | Constraint | Rule |
|---|---|---|
| H1 | NB/WB separation | WB-certified staff cannot be assigned to NB flights and vice versa |
| H2 | FOCA certification | Each foreign carrier requires its own certification clearance |
| H3 | Maximum daily hours | No more than 12 hours/day on working days |
| H4 | Department lock | Staff cannot cross RAMP ↔ PAX boundary |
| H5 | Team integrity | No inter-team transfers except in incident situations; intra-team changes allowed |
| H6 | T-15 readiness | Entire team must be on-site 15 minutes before aircraft arrival |
| H7 | Expired certification | Staff with expired certs are blocked from assignment |
| H8 | Ground time rule | Ground time > 45 min → split arrival/departure teams; ≤ 45 min → same team |
| H9 | WB turnaround cap | Full WB ramp operations must complete within 1 hour |
| H10 | Loader set rule | Cargo weight determines minimum loader sets required |

### Soft Constraints — Optimise Where Possible

| # | Constraint | Rule |
|---|---|---|
| S1 | Consecutive shift cap | No more than 3 consecutive days on the same shift |
| S2 | Rest between shifts | Minimum rest enforced per Malaysia JK labour rules |
| S3 | OT volunteer priority | Pull from volunteer OT list before mandatory OT |
| S4 | Gate distance | Minimise travel distance between gate assignments (PAX) |
| S5 | PAX rotation | Rotate duty station (counter/gate) every 3 hours based on passenger flow |
| S6 | Absence notice | Absences must be reported at least 4 hours before shift start |
| S7 | D-1 plan prep | Full day plan prepared the night before, finalized at shift start minus 3 hours |
| S8 | Runner pool | Flag when available runners fall below required minimum |

### D-Day Event Triggers for Re-Planning

| Event | Impact | Action |
|---|---|---|
| Flight delay | Team may be freed → reassign to next flight | Re-plan; notify DM |
| Bay/gate change | Move equipment + staff to new location | Instant push notification |
| Flight cancellation | Full team freed | Reallocate or place on standby |
| New flight added | Additional staffing required | Pull from OT volunteer list |
| Staff no-show | Coverage gap | Pull replacement; flag to DM |
| Cargo weight change | Loader set count may need adjustment | Silent re-plan |

---

## 6. Certification & Qualification Matrix

| Role | Required Certification | Scope |
|---|---|---|
| WB Loader / Driver / JCPL | WB Operational Cert | WB flights only |
| FOCA Handler | Per-airline FOCA cert | Specific foreign carrier |
| NB Ramp Agent | Standard Ramp cert | NB flights only |
| GSE / Driver | GSE / EDR licence | Equipment-specific |
| Pushback Operator | Pushback licence | NB or WB specific |
| PAX GSO | GSO certification | Gate and counter operations |

### Monitoring Rules
- Flag certifications expiring within **60 days** — surface on admin dashboard
- Block task assignment when certification status is `expired` or `suspended`
- Cert status values: `active` · `expiring_soon` · `expired` · `suspended`
- Cert records must include: issued date, expiry date, status, document reference

---

## 7. Application Modules & Pages

### Staff (All Users)
- Login with employee credentials
- **Monthly Shift View** — full calendar of assigned shifts for the month
- **Today's Tasks** — present-day task assignments, bay, report time, flight details
- Real-time push notifications for shift and task changes

### Supervisor (DM / GSO / RLS)
- Team attendance view for the current shift
- Task reassignment controls (intra-team)
- Re-plan approval / rejection interface
- Flight status feed

### Admin / DTM / ACC
- Full staff roster view — all teams, all departments, full month
- Today's presence dashboard — who is present, by department and team
- Shift edit interface — change individual slots, reassign staff
- OT volunteer management
- Certification expiry dashboard
- Flight schedule feed and change log
- AI plan log — view every planning decision, input, output, approval status

---

## 8. Functional Flow

### Phase 1 — System Setup
Staff profiles → Teams → Certifications → Shift patterns → Gate sectors → Counter zones

### Phase 2 — Monthly Roster Planning
```
Admin triggers plan
      ↓
AI Scheduler reads: staff roster, certs, shift patterns, leave, OT list
      ↓
Shifts assigned to teams (4-on/2-off, no 3+ same shift, rest rules)
      ↓
Staff slotted within teams (role match, cert validity, NB/WB separation)
      ↓
Timefold constraint solver validates
      ↓
Violations? → Re-plan loop
No violations? → DTM/Admin review
      ↓
Cert expiry alerts flagged (60-day window)
      ↓
Approved → Roster published → Staff notified via push
```

### Phase 3 — D-Day Operations
```
03:00 — AirAsia Redwatch CSV ingested → flights loaded
      ↓
AI generates day task plan (NB/WB split, loader sets, T-15 times)
      ↓
Staff clock in via PITSTOP → ACC confirms attendance
      ↓
Absent staff? → Pull from OT volunteer list
      ↓
Tasks assigned per flight → pushed to staff app
      ↓
T-15 — Team assembles at bay (GSE positioned, VDGS set, RLS confirms)
      ↓
Aircraft arrives → Chocks, VDGS/marshalling, PLB time logged
      ↓
Unloading: baggage → belt; cargo → warehouse (parallel)
      ↓
Ground time > 45 min? → Separate departure team assigned
Ground time ≤ 45 min? → Same team continues
      ↓
Departure loading: baggage + cargo loaded, AirAsia staff verifies
      ↓
RLS sign-off → Captain approval → Pushback → Flight departs → Logged
```

### Phase 4 — Live Disruption Handling (Continuous Loop)
```
Flight change received (bay, STD, ETD, cargo, cancellation)
      ↓
Disruption Agent classifies: Minor / Major
      ↓
AI Optimizer re-plans affected flights (freed staff reallocated)
      ↓
Timefold constraint solver validates re-plan
      ↓
Major impact → Supervisor approval gate
  Rejected → Re-plan loop
  Approved → Continue
Minor impact → Auto-approved
      ↓
Affected staff notified instantly (push)
DTM dashboard updates live
Change logged → AI plan audit trail saved
      ↓
↻ Loop continues monitoring all flights throughout the day
```

---

## 9. Technology Stack

| Layer | Technology | Reason |
|---|---|---|
| Backend API | ASP.NET Core (C#) | Team's existing expertise |
| Real-time | SignalR | Microsoft-native WebSocket, managed via Azure SignalR Service |
| Planning engine | Timefold AI (Java microservice) | Purpose-built for constraint-based shift and task scheduling |
| AI orchestrator | Claude API (Anthropic) | Edge case reasoning, disruption triage, natural language alerts |
| Constraint solver | Timefold CP-SAT | Deterministic hard constraint enforcement |
| ORM | Entity Framework Core + Npgsql | Standard .NET PostgreSQL integration |
| Primary database | Neon (PostgreSQL) | Free tier, production-grade, never pauses, branching for dev/staging |
| Cache / live state | Upstash Redis | Free tier, REST-compatible, StackExchange.Redis in .NET |
| Background jobs | Hangfire | Shift planning jobs, cert expiry monitoring, flight parser |
| Push notifications | Firebase Cloud Messaging (FCM) | Cross-platform, free, reliable |
| Auth | ASP.NET Core Identity + JWT | Built-in RBAC |
| Frontend web | React.js | Rich ecosystem, real-time UI |
| Mobile / staff app | PWA (Phase 1) → React Native (Phase 2) | PWA for fast MVP; no app store approval needed |
| Hosting | Azure (preferred for .NET) | Native SignalR Service, Azure DevOps for CI/CD |
| Flight data ingestion | CSV/email parser (MVP) | Parses AirAsia Redwatch exports automatically |

### AI Model Tiering

| Task | Model | Reason |
|---|---|---|
| Monthly roster planning | Claude Opus 4.6 | Best reasoning, runs once/month, latency not critical |
| D-day initial plan (03:00) | Claude Sonnet 4.5 | Strong reasoning, faster and cheaper than Opus |
| Live disruption re-plans | Claude Haiku 4.5 | Fastest, cheapest, focused re-plan scope per call |
| Hard constraint enforcement | Timefold solver | Deterministic, not an LLM |

### Timefold Deployment
Timefold runs as a **Java microservice** called from the ASP.NET Core backend via REST. This uses the mature, production-hardened Java SDK while keeping the main application in .NET.

---

## 10. Database Schema

### Core Tables

| Table | Purpose |
|---|---|
| `DEPARTMENT` | RAMP or PAX, with code and type |
| `SUB_DEPARTMENT` | NB, WB, Techramp, AIC, ACC, Load Control, PAX Counter, PAX Gate |
| `TEAM` | Named teams within each sub-department |
| `USER` | Staff profiles with role, department, team, staff type (permanent/vendor) |
| `CERTIFICATION_TYPE` | Cert definitions with validity period and scope |
| `STAFF_CERTIFICATION` | Per-staff cert records with issued date, expiry, status, document ref |

### Shift & Roster Tables

| Table | Purpose |
|---|---|
| `SHIFT_PATTERN` | Defined shift codes with start/end times and duration |
| `TEAM_ROSTER` | Team-level roster assignments per date |
| `STAFF_ROSTER` | Individual staff roster entries with OT flag, absence reason |
| `ATTENDANCE` | Clock-in/clock-out records from PITSTOP |
| `OT_VOLUNTEER` | Staff who have registered for voluntary OT on specific dates |

### Flight & Task Tables

| Table | Purpose |
|---|---|
| `FLIGHT` | Full flight record: STD, ETD, ATA, ATD, bay, cargo weight, body type, FOCA |
| `FLIGHT_CHANGE_LOG` | Audit log of every change to a flight (bay, timing, cargo) |
| `GROUND_HANDLING_PLAN` | Links a flight to its assignment plan; captures split-team flag, WB cert requirement |
| `TASK_DEFINITION` | Master list of task types per department, body type, and phase |
| `TASK_ASSIGNMENT` | Per-staff task records with role, phase, report time, status, reassign reason |

### PAX & Support Tables

| Table | Purpose |
|---|---|
| `GATE_SECTOR` | Sector definitions (J, LK, P, Q) with gate ranges and minimum staff |
| `COUNTER_ZONE` | Counter zone definitions with domestic/international split |
| `GATE_ASSIGNMENT` | Per-flight gate staff assignments |
| `COUNTER_ASSIGNMENT` | Counter duty rotation assignments per staff per shift |
| `NOTIFICATION` | Push notification log per user — type, channel, read status |
| `AI_PLAN_LOG` | Every AI planning call — input, output, constraint violations, approval status, approver |

### Key Design Decisions

- `body_type` on `FLIGHT` (`NB` / `WB`) drives team assignment, cert requirements, equipment, and turnaround window
- `TEAM_ROSTER` → `STAFF_ROSTER` is a two-level model — AI plans at team level first, individuals slotted within
- `working_day_sequence` tracks the 4-on/2-off cycle and enforces the 3-consecutive-shift cap
- `GROUND_HANDLING_PLAN.is_split_team` captures the ≤45 min / >45 min turnaround rule automatically
- `FLIGHT_CHANGE_LOG` is the trigger source for the Disruption Agent
- `AI_PLAN_LOG` stores every AI decision for audit, compliance, and model improvement

---

## 11. AI Planning Architecture

### How It Works

```
Claude API (Orchestrator)
    Reads: flight manifest, staff availability, cert status, current assignments
    Outputs: structured problem definition (JSON)
          ↓
Timefold Solver
    Applies: hard constraints (H1–H10), soft constraints (S1–S8)
    Optimises: workload balance, OT minimisation, travel distance (PAX)
    Outputs: validated assignment plan
          ↓
ASP.NET Core API
    Stores plan → notifies staff → logs to AI_PLAN_LOG
```

### Claude's Role vs Timefold's Role

| Claude handles | Timefold handles |
|---|---|
| Ambiguous situation interpretation | All mathematical constraint satisfaction |
| Disruption severity classification | Incremental real-time re-planning |
| Edge cases not modelled in Timefold | Hard constraint guarantee |
| Natural language supervisor alerts | Soft constraint optimisation |
| Audit log summarisation | Multi-objective scheduling |

### Planning Prompt Structure (per call)

Each Claude API call receives:
- Flight manifest for the period (date, flight number, aircraft type, bay, STD, ETD, cargo weight)
- Available staff list with roles, certifications, and current assignments
- Active constraints summary
- Current plan state (for disruption re-plans)
- Instruction to output structured JSON for Timefold ingestion

---

## 12. Real-Time Disruption Handling

### Change Sources
- AirAsia Redwatch email/CSV (polled every 2–3 minutes)
- Manual ACC input for ad-hoc changes

### Impact Classification

| Type | Examples | Handling |
|---|---|---|
| Minor | Small delay (<30 min), cargo weight adjustment | Auto-approve; silent re-plan |
| Major | Large delay (>30 min), bay change, cancellation, new flight | Supervisor approval required |

### Re-Plan Flow
1. Change detected → `FLIGHT_CHANGE_LOG` record created
2. Disruption Agent (Claude Haiku) classifies severity
3. Timefold re-plans incrementally — only affected assignments change
4. Constraint solver validates the new plan
5. If major: supervisor notified via SignalR → approval UI → approve/reject
6. If minor: auto-committed
7. Affected staff receive push notification (FCM)
8. DTM dashboard updates live via SignalR
9. Full audit record written to `AI_PLAN_LOG`

### Incremental Re-Planning Advantage
Timefold re-plans incrementally — only the affected assignments are recalculated. A bay change at 14:32 produces a result in milliseconds, not seconds, with no disruption to already-stable assignments elsewhere in the day.

---

## 13. Build Phases

### Phase 1 — Foundation (Weeks 1–4)
- Project scaffold: ASP.NET Core API, Neon DB, EF Core migrations
- Entity models for all schema tables
- Staff management: profiles, departments, teams, certifications
- Authentication: JWT + RBAC (Staff / Supervisor / Admin roles)
- Monthly shift calendar UI (read-only)
- Admin roster management UI (view + edit)
- Cert expiry monitoring background job (Hangfire)

### Phase 2 — Static Day Plan (Weeks 5–8)
- Flight schedule ingestion: CSV parser for Redwatch exports
- Flight data model and admin upload UI
- Claude API integration: day plan generation prompt
- Timefold Java microservice: initial setup, constraint model for NB/WB
- D-day task assignment generation
- Staff task view: today's assignments per user
- DTM dashboard: today's flights + assigned staff

### Phase 3 — Constraint Engine (Weeks 9–12)
- Full hard constraint implementation in Timefold (H1–H10)
- Soft constraint implementation (S1–S8)
- Constraint violation reporting in admin UI
- OT volunteer list management
- Absence handling and replacement logic
- Attendance tracking integration (PITSTOP clock-in feed)

### Phase 4 — Live Disruption Handling (Weeks 13–18)
- Flight change poller (email/CSV monitoring)
- `FLIGHT_CHANGE_LOG` pipeline
- Disruption Agent: Claude Haiku integration for severity classification
- Timefold incremental re-planning on change events
- SignalR hub: live DTM dashboard updates
- Supervisor approval UI for major re-plans
- FCM push notifications to staff on re-assignment

### Phase 5 — Notifications + Polish (Weeks 19–22)
- Full push notification system (FCM) for all event types
- PWA packaging for mobile staff access
- Performance tuning: Redis caching for live state
- AI plan audit log UI for DTM
- Cert expiry alert dashboard
- OTP (on-time performance) reporting
- End-to-end testing + load testing (255 flights/day simulation)

---

## 14. Open Decisions

| # | Decision | Options | Status |
|---|---|---|---|
| 1 | Timefold deployment | Java microservice (REST) vs .NET SDK | Pending user selection |
| 2 | Mobile strategy | PWA first vs React Native from day one | Pending user selection |
| 3 | Flight data ingestion (MVP) | CSV upload vs automated email polling vs manual admin UI | Pending user selection |
| 4 | PITSTOP attendance integration | Direct API vs manual ACC sync vs file import | To be confirmed |
| 5 | OT volunteer list management | In-app registration vs imported from existing system | To be confirmed |
| 6 | Cert data migration | Manual entry vs import from HR system | To be confirmed |
| 7 | Hosting environment | Azure vs AWS vs hybrid | To be confirmed |

---

## Reference: Key Operational Rules

### NB Turnaround User Journey
1. Team on-site T-15 before arrival
2. Aircraft arrives → chocks placed → VDGS/marshalling
3. PLB connected by airport authority → RLS logs time
4. Baggage unloading → driver tows to belt
5. Cargo unloading in parallel → warehouse
6. Departure loading: baggage + cargo
7. AirAsia staff verifies completion
8. RLS oversees all ground ops
9. RLS obtains captain signature
10. Pushback → departure

### WB Additional Requirements
- LDM and CPM documents received from origin station — verified by RLS before unloading
- PAX steps mandatory for cargo door access (doors not ground-accessible)
- Container loading via JCPL operators
- Captain-signed load plan mandatory before pushback
- For FOCA/foreign carriers: load plan from FM Altea or Sabre system

### PAX Gate Rules
- Gate opens 60 minutes before departure (domestic and international)
- Gate opens 90 minutes before departure for WB flights
- Counter closes 1 hour before STD
- No-shows identified 20 min before departure (morning flights) or 10 min (later flights)
- NX17 initiated via Work Vivo for no-show baggage removal

---

*Document version 1.0 — prepared from stakeholder meeting notes and operational workflow analysis.*
*Next step: Review existing codebase → finalise open decisions → begin Phase 1 scaffold.*
