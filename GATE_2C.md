# Gate 2c — evidence bundle

Generated: 2026-11-13 (local). Committed source: current `main`.

## Status

Green.

```text
Full suite: 768 passed (46 files)
Matrix + scoped list loop: 301 passed
```

## 1. Generated SQL — assignments

Migration `0021_past_korath.sql` creates `subject_teacher_assignments` and adds
`classes.form_teacher_membership_id`:

```sql
CREATE TABLE "subject_teacher_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "class_subject_id" uuid NOT NULL,
  "teacher_membership_id" uuid NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "classes" ADD COLUMN "form_teacher_membership_id" uuid;

ALTER TABLE "subject_teacher_assignments"
  ADD CONSTRAINT "subject_teacher_assignments_class_subject_class_fk"
  FOREIGN KEY ("class_subject_id","class_id")
  REFERENCES "class_subjects"("id","class_id");

ALTER TABLE "subject_teacher_assignments"
  ADD CONSTRAINT "subject_teacher_assignments_class_school_fk"
  FOREIGN KEY ("class_id","school_id")
  REFERENCES "classes"("id","school_id");

ALTER TABLE "subject_teacher_assignments"
  ADD CONSTRAINT "subject_teacher_assignments_teacher_membership_school_fk"
  FOREIGN KEY ("teacher_membership_id","school_id")
  REFERENCES "memberships"("id","school_id");

CREATE UNIQUE INDEX "subject_teacher_assignments_active_uq"
  ON "subject_teacher_assignments" ("class_subject_id","teacher_membership_id")
  WHERE "ended_at" IS NULL;

CREATE INDEX "subject_teacher_assignments_teacher_school_idx"
  ON "subject_teacher_assignments" ("teacher_membership_id","school_id");
CREATE INDEX "subject_teacher_assignments_class_school_idx"
  ON "subject_teacher_assignments" ("class_id","school_id");
CREATE INDEX "subject_teacher_assignments_class_subject_class_idx"
  ON "subject_teacher_assignments" ("class_subject_id","class_id");

ALTER TABLE "classes"
  ADD CONSTRAINT "classes_form_teacher_membership_school_fk"
  FOREIGN KEY ("form_teacher_membership_id","school_id")
  REFERENCES "memberships"("id","school_id");
```

The generated migration was read before applying. A fresh temp database migrated
successfully.

## 2. Assignment constraint tests

File: `tests/integration/db/assignment-constraints.test.ts` — **5 passed**.

- same-school form teacher accepted; another-school form teacher rejected;
- duplicate active offering/teacher assignment rejected; accepted after the first ends;
- class/offering mismatch rejected;
- teacher membership from another school rejected;
- correct assignment accepted.

## 3. `can()` and `scopeFor` unit tests

Files:

- `tests/unit/rbac/can.test.ts` — **15 passed**
- `tests/unit/rbac/scope.test.ts` — **9 passed**

Coverage:

- `_all` grants school-wide access;
- scoped access inside/outside a class;
- offering-only teacher can read that offering's class roster;
- wrong school denied;
- no permission denied;
- no resource means permission only;
- `scopeFor` returns `"all"`, a class set, or an empty set.

**Existing `can()` tests changed only by adding the optional `scope` field to the
`Actor` type.** No existing assertion or expected authorization result changed.

## 4. Matrix scope fixtures and list loop

`tests/integration/permission-matrix.test.ts` now includes:

- demo teacher assigned as form teacher of JSS 2 A;
- one taught offering in JSS 2 A;
- JSS 1 A deliberately out of scope;
- in-scope roster → teacher `200`;
- out-of-scope roster → teacher `404`;
- scoped enrollment list → teacher `200`;
- in-scope enrollment by ID → teacher `200`;
- out-of-scope enrollment by ID → teacher `404`.

`tests/integration/academics/scope-list-loop.test.ts` walks every scoped list
endpoint (currently `GET /enrollments`) and asserts no returned row belongs to a
class outside the teacher's scope.

Result: **301 passed** for matrix + loop.

## 5. Rollover completion

`rolloverSession` now copies:

- active form-teacher assignments (`classes.form_teacher_membership_id`) into
  matching target classes;
- active subject-teacher assignments into matching target offerings;
- skips teachers whose membership is not active and reports
  `{ membershipId, reason: "MEMBERSHIP_INACTIVE" }`;
- skips a target form teacher that is already set, leaving it untouched.

Second run inserts nothing and remains idempotent.

`tests/integration/academics/rollover.test.ts` — **3 passed**, including active
assignment copy, inactive-teacher reporting, and second-run idempotence.

## 6. Decision record

Step 27 decision: `docs/decisions/0019-scope-by-assignment.md`.

It records:

- scope from assignment rows, not roles;
- form teacher as a class column, subject teachers as assignment rows;
- `_all` permission means school-wide;
- out-of-scope is `404`, not `403`;
- rejected alternatives (role-based scope, class on membership/role,
  polymorphic assignment table, 403 for scope, route-level filtering).

## 7. Guide changes and reasons

- **Assignment schema uses `ended_at`, not a boolean.** History is required for
  replacements; the partial unique index allows one active row per offering/teacher.
- **Form teacher is a column, subject teachers are rows.** A class has one form
  teacher; subject teaching is many-to-many.
- **Scope is loaded per request.** A reassignment must apply on the next request,
  not after re-login.
- **`taughtClassIds` was added to scope.** An offering-only teacher needs the
  class ID to read that class's roster.
- **Out-of-scope is 404.** A 403 would confirm that the student/class exists.
- **Rollover reports skipped teachers instead of silently dropping them.**
- **Audit cursor timestamp validation was relaxed to an opaque non-empty string.**
  Postgres text formatting varies; the cursor is server-generated.
- **Tests use `buildApp()`.** The test-only probes at `/__test/*` exercise the
  real middleware stack.

## 8. Full test run

```text
Test Files  46 passed (46)
Tests       768 passed (768)
Duration    203.31s
```

## Caveat

Migrations `0010` and `0018` were edited during earlier work. Current migration
chain was verified only on temporary local databases; if those edited versions
were applied to a kept database, add a new reconciliation migration rather than
editing again.
