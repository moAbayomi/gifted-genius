# Frontend F0 — Design Brief and Screen Plan

Status: working design document for Step 7.
Scope: the first three journeys only. Not the full school portal.

This file exists so frontend decisions do not get lost in chat. Update it as the
design changes. Treat it as the source of truth for F0.

---

## 1. Why this feels harder than the backend

The backend has explicit correctness rules: constraints, transactions, locks,
permissions, tests. You can prove it is right.

The frontend has different problems:

- every screen has several states (loading, empty, error, forbidden);
- the same data has different meanings for owner, teacher, and student;
- mobile layout is a constraint, not an afterthought;
- "nice" is subjective, so without references every choice feels arbitrary;
- a lot of frontend work is deciding what **not** to show.

The way to make it tractable is the same way the backend was made tractable:

1. define the contract;
2. define the states;
3. build one vertical slice;
4. test it with real accounts;
5. only then add the next slice.

Do not design a dashboard first. A dashboard is a summary of features that do
not exist yet.

---

## 2. F0 scope

F0 has three journeys:

1. **Owner creates a teacher**
2. **Teacher opens a class**
3. **Student logs in**

Anything outside these journeys is deferred.

### Explicitly out of scope for F0

- results and report cards;
- fees and payments;
- attendance;
- timetables;
- messaging/WhatsApp;
- analytics charts;
- per-school custom domains;
- a full platform-admin UI;
- drag-and-drop class setup;
- bulk promotion UI beyond a basic preview later.

---

## 3. Backend facts the design must respect

### API base

```text
/api/v1
```

The SPA and API share the same public origin through the Cloudflare proxy.

### Auth

Email login:

```json
{ "email": "owner@school.test", "password": "..." }
```

Username login:

```json
{
  "schoolSlug": "demo",
  "username": "jss1-2026-001",
  "password": "..."
}
```

Multi-school email login may return:

```json
{
  "kind": "select_school",
  "schools": [{ "slug": "demo", "name": "Demo Grammar School" }]
}
```

A successful login returns `kind: "success"` and sets an HttpOnly session
cookie.

### `/api/v1/me`

The shell can render from this single call:

```json
{
  "user": {
    "id": "...",
    "email": "owner@school.test",
    "firstName": "Ada",
    "lastName": "Okafor"
  },
  "school": {
    "id": "...",
    "name": "Demo Grammar School",
    "slug": "demo"
  },
  "roles": ["owner"],
  "permissions": ["school:read", "users:create"],
  "mustChangePassword": false,
  "session": { "id": "...", "label": "2026/2027" },
  "activeTerm": {
    "id": "...",
    "name": "First Term",
    "number": 1,
    "startDate": "2026-09-15",
    "endDate": "2026-12-19",
    "status": "active"
  }
}
```

`session` and `activeTerm` can be `null`.

### Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid Request Data",
    "fields": {
      "email": "Invalid email address"
    }
  }
}
```

Common codes:

- `UNAUTHENTICATED` / `INVALID_CREDENTIALS`
- `FORBIDDEN`
- `NOT_FOUND`
- `VALIDATION_ERROR`
- `RATE_LIMITED`
- `ALREADY_ENROLLED`
- `SESSION_LOCKED`
- `CLASS_ARCHIVED`

### List envelope

All list endpoints return:

```json
{
  "data": [],
  "pagination": {
    "limit": 25,
    "offset": 0,
    "total": 0,
    "hasMore": false,
    "nextCursor": null
  }
}
```

The audit log uses cursor pagination but the same `pagination` block.

### Permissions that shape navigation

Do not hardcode roles for authorization. Use permission keys:

```text
users:read / users:create
roles:read / roles:manage
academics:read
structure:manage
calendar:manage
enrollments:read / enrollments:read_all / enrollments:manage
assignments:manage
audit:read
```

Hide UI the user cannot use, but always rely on the server's `403`/`404`.

### Scope behaviour

- Teacher roster outside assignment scope → `404`, not `403`.
- A teacher with no assignments sees an empty enrollment list.
- Do not display a 403-specific message for out-of-scope academic resources.
  Treat it as "not found".

---

## 4. Roles and their first screens

### Owner

Primary job in F0:

- see school context;
- invite a teacher;
- see the staff list;
- verify the teacher can log in.

Owner home should be a **starting point**, not an analytics dashboard.

### Teacher

Primary job in F0:

- see own assignments;
- open a class roster;
- know when they have no assignments.

### Student

Primary job in F0:

- log in with school slug + username;
- change the temporary password;
- see their class and subjects.

---

## 5. Screen inventory

| ID | Screen | Route | Role | Priority |
|----|--------|-------|------|----------|
| 01 | Login | `/login` | public | F0 |
| 02 | School picker | `/select-school` | public | F0 |
| 03 | Change password | `/change-password` | any | F0 |
| 04 | Login: invalid credentials | `/login` | public | F0 |
| 05 | Login: rate limited | `/login` | public | F0 |
| 10 | Owner home | `/app` | owner | F0 |
| 11 | Staff list | `/app/staff` | owner/principal | F0 |
| 12 | Invite teacher | `/app/staff/new` | owner/principal | F0 |
| 13 | Teacher credentials | `/app/staff/new/success` | owner/principal | F0 |
| 14 | Staff empty | `/app/staff` | owner/principal | F0 |
| 15 | Staff loading | `/app/staff` | owner/principal | F0 |
| 16 | Staff error | `/app/staff` | owner/principal | F0 |
| 20 | Teacher home | `/app` | teacher | F0 |
| 21 | My classes | `/app/classes` | teacher | F0 |
| 22 | Class roster | `/app/classes/:classId` | teacher | F0 |
| 23 | Student detail | `/app/students/:id` | teacher | F0 |
| 24 | No assignments | `/app/classes` | teacher | F0 |
| 25 | Roster loading | `/app/classes/:classId` | teacher | F0 |
| 26 | Roster error | `/app/classes/:classId` | teacher | F0 |
| 30 | Student home | `/app` | student | F0 |
| 31 | My subjects | `/app/subjects` | student | F0 |
| 32 | No subjects | `/app/subjects` | student | F0 |

The same `/app` route renders different home content by role. That is normal for
a shell, but the content must be permission-aware and clearly role-specific.

---

## 6. Detailed screen specifications

### 01 — Login

Purpose: get into the product with the least friction.

Content:

- product mark/name;
- heading: "Sign in";
- field: "Email or username";
- field: "School slug" with helper text: "Required for student usernames";
- field: "Password";
- primary button: "Sign in";
- small helper: "Students sign in with their school slug and username."

Behaviour:

- email identifier: school slug optional unless multiple schools;
- username identifier: school slug required;
- submit disabled while pending;
- show inline form error above the fields;
- 401: "Invalid email or password";
- 429: "Too many attempts. Try again in 15 minutes.";
- successful login: fetch `/me`;
- `mustChangePassword` → `/change-password`;
- otherwise → `/app`.

States:

- default;
- field validation;
- pending;
- invalid credentials;
- rate limited;
- network/server error with retry.

Do not reveal whether the email, school slug, or password was wrong.

### 02 — School picker

Purpose: choose which school to enter when an email belongs to several.

Content:

- "Choose a school";
- list of school names and slugs;
- each row is a full-width button;
- cancel/back to login.

Behaviour:

- choose → re-submit login with `schoolSlug`;
- pending row shows a subtle progress state;
- error returns to login with the message.

Do not ask for the password again on this screen; keep it from the login attempt.

### 03 — Change password

Purpose: replace a temporary password before entering the workspace.

Content:

- heading;
- short explanation;
- current/temporary password;
- new password (minimum 10 characters);
- confirm new password;
- primary: "Update password";
- secondary: "Sign out instead".

Behaviour:

- client checks match and minimum length;
- server remains authoritative;
- success → `/app`;
- wrong current password → inline error;
- 401 → `/login`.

### 04 / 05 — Login error states

- Invalid credentials: one clear line, no field-level "email exists" hint.
- Rate limited: show the window and a disabled retry until it passes.
- Server error: preserve the entered identifier, not the password.

### 10 — Owner home

Purpose: confirm context and provide the first actions.

Content, in order:

1. Page title: "Good morning/afternoon, Ada" or neutral "Welcome".
2. School name and slug.
3. Current session and active term as two small blocks.
4. Primary action: "Invite a teacher".
5. Secondary actions:
   - "Staff" (if `users:read`);
   - "Classes" (if `academics:read`);
   - "Audit log" (if `audit:read`).
6. Small status line: role and password state.

Do not show fake counts. The API does not return dashboard totals.

States:

- loading skeleton for the context block;
- no active session: explain that setup is incomplete and link to setup when
  that screen exists;
- no active term: same;
- error: retry.

### 11 — Staff list

Content:

- title "Staff";
- primary "Invite teacher";
- search field (client-side in F0);
- table/list of members:
  - name;
  - email or username;
  - role keys;
  - status.
- pagination controls when `hasMore`.

At 360px, use a stacked list, not a wide table:

```text
Ada Okafor
ada@school.test
owner · active
```

Behaviour:

- paginated via `limit`/`offset`;
- empty state: "No staff yet. Invite a teacher to get started.";
- 403: permission message;
- error: retry;
- loading: 5 skeleton rows.

### 12 — Invite teacher

Fields:

- first name;
- last name;
- email (required for teacher);
- role: teacher (F0 fixed; principal later).

Behaviour:

- submit to `POST /api/v1/users` with `roleKeys: ["teacher"]`;
- 400 field errors map to inputs;
- 409: already a member;
- success → credentials screen.

Do not collect a password. The server generates it.

### 13 — Teacher credentials

This is a one-time secret screen.

Content:

- success heading;
- teacher name/email;
- temporary password in a monospace block;
- "Copy" button;
- warning: "This password is shown once. Ask the teacher to change it at
  first login.";
- action: "Done" → staff list;
- optional secondary: "Create another".

Do not put the password in the URL, localStorage, or analytics.
Do not offer "show password" after leaving this screen. It cannot be recovered.

### 20 — Teacher home

Content:

- greeting and school;
- current session/term;
- "My classes" card/list from `/me/assignments`;
- if no assignments: "You have no assignments yet. Ask your principal to assign
  you a class.";
- link to assignments/classes if any.

Do not show owner actions.

### 21 — My classes

Content:

- list of form-teacher classes and taught offerings;
- each class opens the roster.

Data:

```text
GET /api/v1/me/assignments
```

States:

- loading;
- empty: no assignments;
- error: retry.

### 22 — Class roster

Content:

- class name (level + arm);
- student count;
- list of students:
  - name;
  - admission number;
  - subjects summary;
  - completeness badge if selection incomplete.
- pagination.

At 360px:

```text
Ada Okafor
ADM-001
English, Maths +1      [Incomplete]
```

Behaviour:

- out-of-scope class → 404 screen;
- empty roster → "No students are enrolled in this class yet.";
- loading skeleton;
- error retry.

### 23 — Student detail

Only if the roster API provides enough data. Otherwise defer.

Minimum:

- name;
- admission number;
- class;
- subjects;
- completeness/problems.

Do not invent guardian contact, fees, or results.

### 30 — Student home

Content:

- greeting;
- school;
- class;
- session/term;
- link to subjects.

No staff actions, no school-wide links.

### 31 — My subjects

Content:

- subject code/name;
- compulsory/elective label;
- class.

States:

- loading;
- no subjects: "No subjects have been assigned to your class yet.";
- error.

---

## 7. State matrix

Every core screen must have these states designed:

| State | What it looks like |
|-------|--------------------|
| Default | Real content, normal density |
| Loading | Skeleton matching the final layout |
| Empty | Explanation + action to fix, if the user can |
| Error | What failed + retry |
| Unauthorized | Redirect to login |
| Forbidden | "You do not have access" or 404 policy |
| Offline/network | Retry without losing the form |
| Pending submit | Disabled controls, clear progress |

Rules:

- do not use a centered spinner as the whole page;
- do not show raw error codes to users, except a support reference;
- keep entered form values on validation/network errors;
- never clear a password field on a generic server error unless necessary.

---

## 8. Mobile layout rules at 360px

- Page padding: 16px.
- Header height: 56px.
- Touch targets: at least 44px high.
- One primary action per screen.
- Use stacked cards/lists, not horizontal tables.
- Forms: label above input; full-width controls.
- Long names/emails wrap, never clip.
- Sticky primary action on long forms is allowed.
- Bottom navigation is optional; a simple header + back link is enough for F0.
- Avoid horizontal scroll except for deliberately scrollable code/password blocks.
- Test at 360×640 and 390×844.

---

## 9. Token sheet

Keep this small. If a value is not here, do not invent it.

### Color

| Token | Value | Use |
|-------|-------|-----|
| background | #F7F7F8 | page |
| surface | #FFFFFF | cards, header |
| border | #E4E4E7 | dividers, inputs |
| text | #18181B | primary text |
| text-muted | #71717A | helper/meta |
| primary | #2563EB | primary action |
| primary-hover | #1D4ED8 | hover |
| danger | #DC2626 | errors |
| danger-bg | #FEF2F2 | error panel |
| success | #15803D | success text |
| success-bg | #F0FDF4 | success panel |
| warning | #B45309 | warnings |
| focus | #2563EB | focus ring |

Contrast target: WCAG AA for body text.

### Type

| Token | Size / line height | Use |
|-------|--------------------|-----|
| text-xs | 12 / 16 | metadata |
| text-sm | 14 / 20 | body controls |
| text-base | 16 / 24 | body |
| text-lg | 18 / 28 | section title |
| text-xl | 20 / 28 | page title |
| text-2xl | 24 / 32 | auth heading |

Weights: 400, 500, 600. Avoid 700+ except product mark.

### Space

```text
1 = 4px
2 = 8px
3 = 12px
4 = 16px
5 = 20px
6 = 24px
8 = 32px
12 = 48px
```

### Radius

```text
sm = 6px
md = 8px
lg = 12px
full = 999px
```

### Borders / focus

```text
border = 1px solid #E4E4E7
focus ring = 2px #2563EB + 2px offset
error border = #DC2626
```

### Layout

```text
mobile width = 360
content max width = 720 (forms) / 960 (lists)
page padding = 16
header height = 56
button height = 40 / 44
input height = 40
```

---

## 10. Component inventory

Use **shadcn/ui** components in code where possible:

- Button
- Input
- Label
- Form
- Card
- Table (desktop) / list (mobile)
- Badge
- Alert
- Dialog
- Dropdown menu
- Skeleton
- Toast / Sonner
- Sheet (mobile filters)
- Pagination

Do not build custom primitives unless shadcn lacks the behaviour.

### Navigation in F0

```text
Header:
  school name | user menu | logout

Owner nav:
  Home, Staff

Teacher nav:
  Home, My classes

Student nav:
  Home, My subjects
```

Derive nav from permissions, not role strings, where the permission exists.
Role can decide copy/tone; permissions decide access.

---

## 11. References: what to collect

Collect **patterns**, not identities. For each screen, 3–5 references and a note:

```text
Reference: Mobbin — Teacher roster (school app)
Take:
  - student name as primary line
  - admission number as secondary
  - compact subject chips
Do not take:
  - the brand colors
  - the bottom tab bar
```

Sources:

- **Mobbin** — real product flows; best for mobile app screens.
- **Refero** — real screens by pattern.
- **Figma Community** — “school admin dashboard”, “SaaS dashboard”, “shadcn UI kit”.
- **Untitled UI** — large Figma kit for tables, forms, empty states.
- **shadcn/ui examples** — practical React/Tailwind patterns.
- **Tailwind UI / Headless UI** — real component patterns.
- **Flowbite / Cruip** — dashboard blocks.
- **Dribbble** — visual ideas only; often impractical.
- School products to study: Arbor, SIMS, PowerSchool, ManageBac, Toddle,
  Google Classroom.

Do not copy another school portal’s logo, illustrations, copy, or exact layout.
Use references to answer concrete questions.

### Reference board

Create one Paper page called `00 References`.

Group by screen:

```text
Login
  ref-01, ref-02, ref-03
Owner home
  ref-04, ref-05
Staff list
  ref-06, ref-07
Roster
  ref-08, ref-09
```

For each, write the “take / do not take” note.

---

## 12. Paper setup

Paper is a canvas, not a template marketplace. Build the boards yourself from
references and tokens.

File:

```text
GiftedMind — F0
```

Pages:

```text
00 References
01 Tokens
02 Owner journey
03 Teacher journey
04 Student journey
05 States
```

Frames:

- 360px width for phone screens.
- Height: 800 for fixed shells, `fit-content` for long pages.
- Name frames:

```text
01 Login — default
01b Login — invalid
01c Login — pending
01d Login — rate limited
02 School picker
03 Change password
10 Owner home — default
10b Owner home — loading
10c Owner home — no session
11 Staff list — default
11b Staff list — empty
11c Staff list — loading
11d Staff list — error
12 Invite teacher
12b Invite — validation
13 Teacher credentials
20 Teacher home — assigned
20b Teacher home — no assignments
21 My classes
22 Roster — default
22b Roster — empty
22c Roster — loading
22d Roster — error
30 Student home
31 My subjects
31b My subjects — empty
```

### Annotations per frame

Write these on the canvas, not in your head:

- primary action;
- what happens on success;
- what happens on 401/403/404/409/429;
- empty-state copy;
- permissions required;
- data source endpoint;
- mobile behaviour (scroll, sticky action, sheet).

If a screen cannot be built from an existing endpoint, mark it **deferred**.
Do not design against invented APIs.

---

## 13. Screen → API map

| Screen | Endpoint |
|--------|----------|
| Login | `POST /api/v1/auth/login` |
| School picker | same login with `schoolSlug` |
| Change password | `POST /api/v1/auth/change-password` |
| Shell / owner home / teacher home / student home | `GET /api/v1/me` |
| Staff list | `GET /api/v1/users?limit=&offset=` |
| Invite teacher | `POST /api/v1/users` |
| Teacher assignments | `GET /api/v1/me/assignments` |
| Class roster | `GET /api/v1/classes/:classId/roster?limit=&offset=` |
| Student subjects | No dedicated student-facing endpoint yet — defer or derive from roster data |
| Logout | `POST /api/v1/auth/logout` |

Important: there is currently **no student “my subjects” endpoint**. Do not
design a screen that pretends it exists. Either defer screen 31 or add the
endpoint before designing it.

---

## 14. Error handling rules

- `401` → clear session state and go to `/login`.
- `403` → permission message; do not reveal resource details.
- `404` on academic resources → treat as not found; for teachers this can mean
  out of scope.
- `409` → explain the conflict and offer the safe next action.
- `429` → show the retry window; disable submit.
- `VALIDATION_ERROR` → map `error.fields` to inputs; keep values.
- Network error → preserve form values and provide retry.
- Never display a temporary password in an error, URL, or log.

---

## 15. Credentials handling

The temporary password rules:

- generated by the server;
- shown once on screen 13;
- never stored in localStorage;
- never put in a URL;
- never logged;
- copy button allowed;
- leaving the screen loses it;
- if lost, the owner must reset the password (no reset UI in F0 yet — mark as
  a follow-up).

This is a product rule, not just a UI rule.

---

## 16. Build order after design

1. Login + school picker + `/me` shell.
2. Change password.
3. Owner home.
4. Staff list.
5. Invite teacher + credentials screen.
6. Teacher login test.
7. Teacher home + assignments.
8. My classes + roster.
9. Student login test.
10. Student home.
11. My subjects only if the API exists.

Each slice ends with:

- default, loading, empty, error state;
- permission check;
- mobile check at 360px;
- real API call, not mock data.

---

## 17. F0 acceptance checklist

Design is done when:

- [ ] three journeys are drawn end to end;
- [ ] the screen inventory above exists;
- [ ] every core screen has default, loading, empty, and error states;
- [ ] mobile frames are 360px wide;
- [ ] the token sheet exists and is used consistently;
- [ ] references are collected with take/do-not-take notes;
- [ ] every screen maps to a real endpoint;
- [ ] screens that depend on missing APIs are marked deferred;
- [ ] the owner/teacher/student home variants are visibly different;
- [ ] credentials handling is explicit;
- [ ] navigation is permission-aware;
- [ ] a developer can build the login and owner home without asking a design
      question.

---

## 18. Open questions to resolve as we go

1. Should the school picker be a separate route or a dialog on login?
2. Is `/app` role-switched, or should owner/teacher/student have explicit
   route prefixes?
3. Do we need a student “my subjects” API before designing that screen?
4. Do we need a class detail endpoint for teacher student detail?
5. Should staff invitation allow multiple roles in F0, or teacher only?
6. How should the owner reset a lost temporary password?
7. What is the copy/tone for Nigerian secondary schools: formal, warm, or
   neutral?
8. Do we need school branding (logo/colors) in F0, or is product branding
   enough?
9. How should the UI behave when a school has no session or no active term?
10. Should the teacher see only their form class or also all taught offerings on
    the home screen?

---

## 19. What not to do

- Do not design a dashboard with fake metrics.
- Do not design per-school domains for F0.
- Do not design fees, results, attendance, or messaging.
- Do not copy a reference wholesale.
- Do not build custom form/table primitives before trying shadcn.
- Do not design a screen without naming its endpoint.
- Do not hide a permission failure as a generic blank page.
- Do not put temporary passwords anywhere except the one-time credentials
  screen.

---

## 20. Next design session

Bring:

- five owner-home references;
- five staff-list references;
- five roster references;
- one mobile school app reference for each;
- a first attempt at 01 Login, 10 Owner home, and 11 Staff list at 360px.

From those, we can critique the layouts, narrow the token sheet, and lock the
first build slice.
