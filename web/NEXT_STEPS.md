# Next Steps — after the F0 shell works

This is the working order from here. It assumes owner login, teacher invite,
forced password change, teacher/student homes, and the staff list already work.

---

## 1. Finish the school setup flow first

The setup wizard is the highest-value next slice because almost every other
screen is empty until a school has a session, terms, classes, subjects and
offerings.

### Where it lives

Frontend route:

```text
/app/setup
```

Current file/route:

```text
web/src/router.tsx → setupRoute
```

It is currently a placeholder. Turn it into a real multi-step flow.

Suggested folder:

```text
web/src/routes/setup/
  setup-layout.tsx
  setup-index.tsx       # progress + resume
  session-step.tsx
  terms-step.tsx
  classes-step.tsx
  subjects-step.tsx
  offerings-step.tsx
  teachers-step.tsx
  students-step.tsx
  review-step.tsx
```

There is no separate backend "setup" module required. The wizard calls the
existing APIs:

- `POST /api/v1/sessions`
- `POST /api/v1/terms`
- `POST /api/v1/terms/:id/activate`
- `GET /api/v1/levels`
- `POST /api/v1/classes`
- `POST /api/v1/subjects`
- `POST /api/v1/classes/:classId/offerings`
- `POST /api/v1/classes/:classId/form-teacher`
- `POST /api/v1/offerings/:id/teacher`
- `POST /api/v1/students`
- `POST /api/v1/enrollments`

Optional later: add:

```text
GET /api/v1/setup/status
```

returning whether the school has a session, active term, classes, offerings,
teachers and students. That gives the wizard a reliable resume point instead of
probing every list.

### Wizard order

1. Academic session.
2. Terms.
3. Activate the first term.
4. Classes.
5. Subjects.
6. Offerings per class.
7. Assign teachers.
8. Students / import.
9. Review.

Do not allow skipping terms/class setup silently. The owner home already warns
when session or term is missing.

### Wizard states

- loading;
- empty step;
- validation errors;
- permission denied;
- network/server error with retry;
- partial completion / resume;
- completed.

---

## 2. Teacher assignment UI

The backend supports:

```text
POST /api/v1/classes/:classId/form-teacher
POST /api/v1/offerings/:classSubjectId/teacher
```

The setup wizard needs this because a teacher with no assignment sees no classes
and gets `404` on class rosters.

Add a class detail screen:

```text
/app/classes/:classId/settings
```

with:

- form teacher selector;
- subject teacher selectors per offering;
- assigned teacher history later.

This is more important than a generic owner Classes page.

---

## 3. Student creation and import

Backend has:

- `POST /api/v1/students`
- `POST /api/v1/enrollments`
- `POST /api/v1/enrollments/bulk`
- student import service, but **no import routes yet**.

Next:

1. Add import routes:
   - `POST /api/v1/students/import/validate`
   - `POST /api/v1/students/import`
   - dry-run and save.
2. Add the import UI:
   - frontend parses CSV;
   - previews mapping and errors;
   - sends JSON rows;
   - shows one-time credentials.
3. Add student create/enrol UI.

Order inside the wizard:

```text
subjects → offerings → students → enrol students
```

Students must be in a class before rosters and teacher screens become useful.

---

## 4. Student “My subjects” endpoint

The student home exists, but there is no student-facing subjects endpoint yet.

Needed backend:

```text
GET /api/v1/me/subjects
```

or a student-scoped read model returning:

- class;
- session;
- subjects;
- compulsory/elective status;
- term.

Then implement:

```text
/app/subjects
```

Do not fake this screen from local state.

---

## 5. Where the guardian comes in

The guardian is **not** another kind of student and should not share a student
account.

Current backend state:

- `guardian` exists as a role kind;
- guardian users can be created through the users flow;
- there is **no guardian-to-student link table yet**.

### Required backend model

Add something like:

```text
guardian_students
  id
  school_id
  guardian_membership_id
  student_id
  relationship        -- mother, father, uncle, sponsor, etc.
  is_primary_contact
  created_at
```

Optionally a `guardian_profiles` table for phone, occupation, address, but do
not duplicate user identity.

Rules:

- a guardian may have several wards;
- a student may have several guardians;
- only school admins link/unlink;
- guardian access is scoped to linked students only;
- guardian scope belongs in the RBAC scope loader, not in route checks.

### Guardian portal, after the link exists

Minimum screens:

```text
/app/wards                 # list of linked students
/app/wards/:studentId      # child overview
/app/wards/:studentId/subjects
/app/wards/:studentId/results   # later
/app/wards/:studentId/fees      # later
```

First guardian slice:

- login by email;
- see one or more wards;
- view ward’s class and subjects;
- no school-wide staff/class/student permissions.

Do not reuse `student_profiles` as the guardian record. The guardian is a
membership of kind `guardian`, linked to student profile IDs.

### Where to put guardian work in the order

After students exist and after the student subjects read model:

```text
students + enrolments
→ student subjects
→ guardian link table
→ guardian invite/link UI
→ guardian portal
→ results/fees
```

Guardian features before results are premature: there is nothing useful to show
except identity.

---

## 6. Owner Classes and Audit Log

These are placeholders now.

Order:

1. Class detail/settings and teacher assignment (needed for teachers).
2. Owner class list/overview.
3. Audit log viewer.

Audit is read-only and safe to defer until after setup works.

---

## 7. Operational work before a real school

- owner password reset CLI/API;
- teacher/guardian invite delivery (email/WhatsApp/manual);
- backup/restore procedure on Neon;
- production migration discipline;
- rate-limit monitoring;
- request logs without secrets;
- health check and readiness check;
- a platform-admin way to create/reactivate/suspend schools.

---

## Recommended order

1. Setup wizard: session → terms → classes → subjects → offerings.
2. Class settings + teacher assignment UI.
3. Student create/enrol UI.
4. Student import routes + CSV import UI.
5. Student subjects endpoint + student screen.
6. Guardian link table + guardian invite/link UI.
7. Guardian portal.
8. Owner Classes / Audit Log.
9. Results, attendance, fees, messaging.

---

## Short answer to “where does the guardian come in?”

The guardian comes **after the student exists and is enrolled** and after a
`guardian_students` link exists. The first guardian screen is “My wards”, not a
dashboard. Do not let guardians see school-wide data; scope them to their linked
student IDs.
