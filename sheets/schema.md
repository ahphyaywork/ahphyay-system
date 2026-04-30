# Google Sheets Schema — AhPhyay System

Create one Google Spreadsheet with 5 sheets (tabs) exactly as named below.

---

## Sheet 1: Staff

| Column | Example | Notes |
|---|---|---|
| ID | STAFF-001 | Unique, e.g. STAFF-001 |
| Name | Phwe Phwe | Full name |
| Role | Project Coordinator | Job title |
| Type | Consultant | Consultant or Contractor |
| ProjectID | PROJ-001 | Primary project (can be multiple, comma-separated) |
| Active | true | true or false |

**Seed data:**
```
ID,Name,Role,Type,ProjectID,Active
STAFF-001,Phwe Phwe,Project Coordinator,Consultant,PROJ-001,true
STAFF-002,Alic,Training Officer,Consultant,PROJ-001,true
STAFF-003,Ko Htun,Digital Platform Officer,Contractor,PROJ-001,true
STAFF-004,David,Membership Officer,Contractor,PROJ-001,true
STAFF-005,Noe,Content & M&E Officer,Consultant,PROJ-002,true
```

---

## Sheet 2: Projects

| Column | Example | Notes |
|---|---|---|
| ID | PROJ-001 | Unique |
| Name | SN@IL 2026 | Project full name |
| ShortName | SN@IL | Used in dropdowns |
| StartDate | 2026-01-01 | YYYY-MM-DD |
| EndDate | 2027-12-31 | YYYY-MM-DD |
| Status | Active | Active / Completed / On Hold |
| Description | Supporting women... | Brief description |

**Seed data:**
```
ID,Name,ShortName,StartDate,EndDate,Status,Description
PROJ-001,SN@IL 2026-2027,SN@IL,2026-01-01,2027-12-31,Active,Community women digital marketplace project
PROJ-002,VSDP 2026,VSDP,2026-01-01,2026-12-31,Active,Village Sustainable Development Programme
```

---

## Sheet 3: Tasks

| Column | Example | Notes |
|---|---|---|
| ID | TASK-001 | Unique |
| ProjectID | PROJ-001 | Links to Projects sheet |
| Name | Textile quality workshop | Task name |
| Category | Training | Category for grouping |
| Target | 60 | Numeric target |
| Unit | participants | Unit of measurement |
| Active | true | true or false |

**Seed data:**
```
ID,ProjectID,Name,Category,Target,Unit,Active
TASK-001,PROJ-001,Textile quality workshop,Training,60,participants,true
TASK-002,PROJ-001,E-commerce product uploads,Digital,8,products,true
TASK-003,PROJ-001,Lean management contract,Contract,1,contract,true
TASK-004,PROJ-001,Member onboarding webinar,Membership,20,members,true
TASK-005,PROJ-001,Social media content posts,Content,4,posts,true
TASK-006,PROJ-001,Stakeholder meeting,Meeting,1,session,true
TASK-007,PROJ-002,Community site visits,Field,3,visits,true
TASK-008,PROJ-002,Beneficiary coaching sessions,Coaching,10,sessions,true
```

---

## Sheet 4: WorkLog

| Column | Example | Notes |
|---|---|---|
| ID | WL-1714000000000 | Auto-generated timestamp ID |
| StaffID | STAFF-001 | Links to Staff sheet |
| ProjectID | PROJ-001 | Links to Projects sheet |
| TaskID | TASK-001 | Links to Tasks sheet |
| Date | 2026-04-17 | YYYY-MM-DD |
| Actual | 42 | Actual number achieved |
| Unit | participants | Copy from Task |
| Status | Done | Done / In Progress / Late |
| Note | Good turnout | Optional note |
| CreatedAt | 2026-04-17T14:30:00Z | ISO timestamp, auto |

*This sheet starts empty. Entries are added via the system.*

---

## Sheet 5: Config

| Key | Value |
|---|---|
| ActivityTypes | Training,Workshop,Contract,Site Visit,Meeting,Upload,Coaching,Audit,Report |
| StatusOptions | Done,In Progress,Late |
| SystemVersion | 1.0.0 |
| LastUpdated | 2026-04-30 |
