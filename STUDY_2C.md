# How to study Gate 2c quickly

Goal: understand assignment scope well enough to explain it, then move to promotion.

## 1. Read the decision first (10 minutes)

`docs/decisions/0019-scope-by-assignment.md`

Answer these before reading code:

- Why does scope come from assignment rows instead of roles?
- What does `_all` mean, and why is it a suffix rather than a separate mechanism?
- Why is out-of-scope `404`, not `403`?
- Why is the form teacher a column on `classes`, while subject teachers get a table?
- Why does `subject_teacher_assignments` carry `class_id` when it already has `class_subject_id`?

If you can answer those five, the schema will look obvious.

## 2. Read the schema (10 minutes)

In order:

1. `src/db/schema/classes.ts` — `formTeacherMembershipId`, `(id, school)` unique.
2. `src/db/schema/subject-teacher-assignments.ts` — `ended_at`, partial unique index, three composite FKs.
3. `migrations/0021_past_korath.sql` — the same rules as SQL.

Look for:

- one active form teacher per class (single nullable column);
- one active subject-teacher row per offering/teacher pair (partial unique index);
- composite keys that prevent cross-school or class/offering mismatches;
- replacement = end old row, insert new row, never update in place.

## 3. Read scope loading (10 minutes)

`src/modules/rbac/scope.ts`

- `loadScope` resolves the current session.
- It queries classes where the actor is form teacher **or** has an active student enrollment.
- It queries offerings with active teacher assignments and records their class IDs in `taughtClassIds`.
- This is loaded per request in `require-auth.ts`, so a reassignment applies on the next request.

Then read `src/modules/rbac/can.ts`:

- `scopeFor` returns `"all"`, a class set, or empty.
- `can` checks school, permission, then resource class/offering.

## 4. Read the services (15 minutes)

- `src/modules/academics/assignments/service.ts`
  - `requireStaff` → 404 missing member, 403 inactive, 403 not staff.
  - `loadOpenClass` → school row lock, class, session open, class lock.
  - `assignFormTeacher` updates the class column and writes before/after audit.
  - `replaceSubjectTeacher` ends the old active row, inserts the new one, audits both.
- `src/modules/auth/assignments.ts`
  - `GET /me/assignments` uses `loadScope` and returns named classes/offerings.
- `src/modules/academics/enrollment/roster.ts` and `service.ts`
  - roster and enrollment list apply `can`/`scopeFor` and return 404 outside scope.
- `src/modules/academics/rollover.ts`
  - copies form/subject assignments; skips inactive memberships and reports them;
  - second run is idempotent through unique keys.

## 5. Read the tests in this order (15 minutes)

1. `tests/integration/db/assignment-constraints.test.ts` — what the database guarantees.
2. `tests/unit/rbac/scope.test.ts` — what scope means mathematically.
3. `tests/integration/academics/assignments/assignment-services.test.ts` — refusal, history, locked session.
4. `tests/integration/academics/scope.test.ts` — real teacher, `/me/assignments`, student/guardian refusal.
5. `tests/integration/academics/enrollment-scope.test.ts` — own class 200, other class 404, filtered list, empty list.
6. `tests/integration/academics/scope-list-loop.test.ts` — every scoped list is checked.
7. `tests/integration/permission-matrix.test.ts` — every role/endpoint pair.
8. `tests/integration/academics/session-locked-writes.test.ts` — every session-keyed write refuses a locked session.
9. `tests/integration/academics/rollover.test.ts` — assignment copy, skipped inactive teacher, idempotence.

While reading, ask: “what would break if this line were removed?”

## 6. Reproduce it yourself (10 minutes)

```bash
cd backend
npx tsc --noEmit
APP_STAGE=test DB_URL=postgres://1337mo@localhost:5432/gate2a_assign2 \
  npx vitest run --config "$TMPDIR/vitest.assign.config.ts" \
  tests/integration/academics/assignments \
  tests/integration/academics/scope.test.ts \
  tests/integration/academics/enrollment-scope.test.ts \
  tests/integration/academics/scope-list-loop.test.ts \
  tests/integration/academics/rollover.test.ts
```

Then open `/docs` and `GET /me/assignments`:

- log in as `teacher@demo.test`;
- check the Authorize/session flow;
- look at the assignment endpoints in Swagger UI.

## The five invariants to memorize

1. **Scope is data, not role.** Roles say “teacher”; assignments say “which class”.
2. **One active form teacher per class; one active subject teacher per offering/teacher.**
3. **Scope failures are 404.** A 403 would confirm the row exists.
4. **`_all` wins inside the school; wrong school loses first.**
5. **Replacement keeps history.** End the old row; never mutate or delete it.

## Checklist status

- Assignment service tests: `assignment-services.test.ts` — student-kind refused, history kept, locked session refused.
- Locked-session loop: `session-locked-writes.test.ts` includes both assignment writes.
- `GET /me/assignments`: staff works; student/guardian 403 — `scope.test.ts`.
- Teacher with no assignments: empty `GET /enrollments` — `enrollment-scope.test.ts`.
- OpenAPI: `/classes/{classId}/form-teacher`, `/offerings/{classSubjectId}/teacher`, `/me/assignments` registered; OpenAPI document/smoke/contract tests pass.

## What to read next (promotion)

Promotion reuses the same ideas you just learned:

- per-session classes;
- dated enrollments, never moving history;
- level sequence + one, same arm label, same track;
- a new enrollment in the target class, not an update of the old one.
