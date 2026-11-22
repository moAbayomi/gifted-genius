# Swagger and School Setup — Working Notes

This file is the reference for local school setup, Swagger testing, and the
current gaps. Update it as the setup UI replaces the API calls below.

---

## 1. Fixes made

### Swagger UI now uses `/api/v1`

The API is mounted at:

```text
/api/v1
```

The OpenAPI document now declares:

```json
"servers": [
  { "url": "/api/v1", "description": "GiftedMind API" }
]
```

Operation paths remain relative (`/auth/login`, `/users`, ...), so Swagger UI
resolves them against `/api/v1`:

```text
POST /api/v1/auth/login
GET  /api/v1/users
```

Before this change, Swagger called `/auth/login` at the server root.

### Health alias

`/health` still exists. Swagger's health call uses the server base, so there is
also:

```text
GET /api/v1/health
```

Both return:

```json
{ "status": "ok" }
```

### Change password now logs out

After a successful forced password change, the frontend:

1. calls `POST /api/v1/auth/logout`;
2. clears the query cache;
3. navigates to `/login`.

The user must sign in again with the new password.

### Important: restart the backend

The OpenAPI document is built and memoized when the app starts. After changing
the document, restart:

```bash
cd backend
npm run dev
```

Then hard-refresh:

```text
http://localhost:3000/docs
```

If Swagger still shows the old base URL, open:

```text
http://localhost:3000/openapi.json
```

and confirm `servers` contains `/api/v1`.

---

## 2. Local setup against a Neon branch

Use a Neon **branch**, not the production branch. Local test users and schools
should not mix with real data.

### Backend `.env`

```env
APP_STAGE=development
DB_URL=postgres://...neon-branch.../neondb?sslmode=require
DATABASE_URL_DIRECT=postgresql://...neon-branch-direct.../neondb?sslmode=require
ALLOWED_ORIGINS=http://localhost:5173
DOCS_ENABLED=true
```

Use `APP_STAGE=development` locally.

Do not use `APP_STAGE=production` locally, because production cookies are
`Secure` and will not be stored over HTTP.

Do not run the demo seed against a database you care about.

### Migrate

```bash
cd backend
npm run db:migrate
```

### Create the school and owner

```bash
cd backend

npm run school:create -- \
  --name "Greenfield Academy" \
  --slug greenfield \
  --owner-email owner@greenfield.test \
  --owner-name "Ada Okafor"
```

Save the temporary password printed once.

### Run

```bash
cd backend && npm run dev
cd web && npm run dev
```

Open:

```text
http://localhost:5173
```

Log in as the owner, change the password, and confirm you are returned to the
login page.

---

## 3. Set up a school through Swagger

Open:

```text
http://localhost:3000/docs
```

First call:

```text
POST /api/v1/auth/login
```

with the owner credentials. The session cookie is set and later Swagger calls
carry it.

The order below matters.

### 3.1 Create an academic session

```http
POST /api/v1/sessions
Content-Type: application/json

{
  "label": "2026/2027"
}
```

Save the returned session ID.

### 3.2 Create terms

```http
POST /api/v1/terms
Content-Type: application/json

{
  "sessionId": "<session-id>",
  "number": 1,
  "name": "First Term",
  "startDate": "2026-09-15",
  "endDate": "2026-12-19"
}
```

Create Term 2 and Term 3 similarly.

### 3.3 Activate the first term

```http
POST /api/v1/terms/<term-id>/activate
Content-Type: application/json

{
  "confirm": true
}
```

Activation closes any other active term in the same transaction.

After this, `/api/v1/me` should return a non-null `session` and `activeTerm`,
and the owner-home amber setup notice should disappear.

### 3.4 Get levels

```http
GET /api/v1/levels
```

The SCHOOL gets default JSS 1–3 and SS 1–3 levels. Save the JSS 1 level ID.

### 3.5 Create a class

```http
POST /api/v1/classes
Content-Type: application/json

{
  "sessionId": "<session-id>",
  "levelId": "<jss1-level-id>",
  "armLabel": "A",
  "track": "general"
}
```

Save the class ID.

### 3.6 Create subjects

```http
POST /api/v1/subjects
Content-Type: application/json

{
  "code": "ENG",
  "name": "English"
}
```

Repeat for Mathematics, Basic Science, etc.

Subject codes are unique within the school.

### 3.7 Add offerings to the class

```http
POST /api/v1/classes/<class-id>/offerings
Content-Type: application/json

{
  "subjects": [
    {
      "subjectId": "<english-subject-id>",
      "isCompulsory": true
    },
    {
      "subjectId": "<maths-subject-id>",
      "isCompulsory": true
    }
  ]
}
```

Compulsory offerings auto-enrol every active student in that class.

### 3.8 Invite and assign a teacher

The UI path is:

```text
Staff → Invite teacher
```

The API equivalent is:

```http
POST /api/v1/users
Content-Type: application/json

{
  "firstName": "Tunde",
  "lastName": "Teacher",
  "email": "tunde.teacher@greenfield.test",
  "roleKeys": ["teacher"]
}
```

The response contains the teacher's membership ID in `user.id` and a one-time
`temporaryPassword`.

Assign the teacher as form teacher:

```http
POST /api/v1/classes/<class-id>/form-teacher
Content-Type: application/json

{
  "teacherMembershipId": "<teacher-membership-id>"
}
```

Or assign them to one offering:

```http
POST /api/v1/offerings/<class-subject-id>/teacher
Content-Type: application/json

{
  "teacherMembershipId": "<teacher-membership-id>"
}
```

Without an assignment, the teacher's roster access returns `404` by design.

### 3.9 Create a student

```http
POST /api/v1/students
Content-Type: application/json

{
  "firstName": "Tunde",
  "lastName": "Student",
  "username": "tunde.student",
  "admissionNumber": "ADM-001"
}
```

A student without an email must have a username.

The response contains:

- `member` / membership information;
- `student.id` — the student profile ID;
- `temporaryPassword`.

### 3.10 Enroll the student

```http
POST /api/v1/enrollments
Content-Type: application/json

{
  "studentId": "<student-profile-id>",
  "classId": "<class-id>"
}
```

Use `student.id`, not the membership ID.

---

## 4. Test the three roles

### Owner

- owner home shows session and term;
- Staff list shows the invited teacher;
- Invite teacher produces a one-time password;
- no fake counts.

### Teacher

Log in with the teacher email and temporary password.

Expected:

- forced password change;
- after changing, logout and return to `/login`;
- log in again;
- teacher home shows My Classes;
- `/app/classes` lists the assigned class;
- roster shows the enrolled student;
- student detail shows subjects and completeness.

### Student

Log in with:

```json
{
  "schoolSlug": "greenfield",
  "username": "tunde.student",
  "password": "..."
}
```

Expected:

- forced password change;
- logout and return to login;
- student home;
- no owner/staff navigation.

Student “My subjects” is still deferred because there is no student-facing
subjects endpoint yet.

---

## 5. Common failures

### Swagger still calls `/auth/login`

1. Restart the backend.
2. Hard-refresh `/docs`.
3. Check `/openapi.json` contains `servers: [{ "url": "/api/v1" }]`.

### 429 from login

The production limiter allows five failures per identifier per 15 minutes.
Restart the API to clear the in-memory limiter, then try once with the exact
credentials.

### Login says invalid credentials online but works locally

The deployed database has different users. Local `.env` and Render environment
are different databases. Create the owner on the deployed database with
`school:create`, or use a Neon branch deliberately.

### Teacher gets 404 on a roster

The teacher is not assigned to that class. Assign a form teacher or subject
teacher first.

### Teacher has no classes

Run the session/term/class setup above and assign the teacher.

### Setup notice on owner home

`session` or `activeTerm` is null. Create a session, create a term, and activate
it.

---

## 6. Still missing

- School setup wizard — `/app/setup` is a placeholder.
- Student “My subjects” — no endpoint.
- Owner Classes and Audit Log — placeholders.
- Password reset for a lost temporary owner password.
- Per-school custom domains.

Until the setup wizard exists, Swagger is the temporary admin interface.
