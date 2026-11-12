# Gate 2b — evidence bundle

Generated: 2026-11-11 (local)
Branch: none (workspace is not a git repository)

> **Status: green.** Full suite: **721 passed, 1 skipped** across 40 files. Matrix: **275 passed**. Scale timings and targeted evidence below.

## 1. Step 26 additions

- `POST /sessions/:id/rollover` (`:id` = source session, body `{ "toSessionId": "..." }`)
  - `structure:manage`
  - calls `rolloverSession`, returns `{ classesCloned, groupsCopied, offeringsCopied }`
  - OpenAPI path registered; matrix row added.
- Fixed routes that were mounted incorrectly:
  - `requireAuth` was passed as a middleware instead of `requireAuth()` in offerings, subjects, elective-groups, and students routers.
  - `offeringsRouter` existed but was not mounted in `src/app.ts`.
- Fixed the roster route: it passed a string to `getClassRoster`, which expects `{ classId }`.
- Fixed the matrix test app to mount subjects, elective groups, offerings, students, and enrollments routers.
- Extended the seed with:
  - subjects `ENG`, `MTH`, `BSC`, `CRS`, `IRS`;
  - the `Religion` elective group on JSS 2 A;
  - compulsory English/Mathematics/Basic Science and elective CRS/IRS offerings;
  - a demo student profile, active JSS 2 A enrollment, and IRS `student_subjects` row.
- Added `src/scripts/scale-check.ts` and `npm run scale:check`.
- Added scale timings to `NOTES.md`.

## 2. Generated SQL and database check

Migrations are applied in order from `migrations/`; the relevant ones are:

- `0013_warm_captain_universe.sql` — subjects, elective groups, student profiles, class subjects, class enrollments, student subjects.
- `0014_silky_echo.sql` — `class_subjects.is_compulsory` + compulsory/elective check.
- `0015_rapid_robin_chapel.sql` — `elective_groups.archived_at`.
- `0016_silly_wrecker.sql` — `class_subjects.archived_at`.
- `0017_short_ravenous.sql` — `student_subjects.dropped_at`.
- `0018_boring_galactus.sql` — adds nullable `class_enrollments.status` (safe for existing rows).
- `0019_perfect_sage.sql` — backfills `status`, sets default + `NOT NULL`, adds the status/ended check.

Key `student_subjects` constraints from the generated SQL:

```sql
CREATE TABLE "student_subjects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "school_id" uuid NOT NULL,
  "enrollment_id" uuid NOT NULL,
  "class_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "class_subject_id" uuid,
  "subject_id" uuid,
  "is_extra" boolean GENERATED ALWAYS AS (class_subject_id IS NULL) STORED NOT NULL,
  "dropped_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "student_subjects_enrollment_offering_uq" UNIQUE("enrollment_id","class_subject_id"),
  CONSTRAINT "student_subjects_id_class_uq" UNIQUE("id","class_id"),
  CONSTRAINT "student_subjects_one_choice_chk" CHECK (num_nonnulls("class_subject_id","subject_id") = 1)
);
```

And the composite foreign keys:

```sql
ALTER TABLE "student_subjects"
  ADD CONSTRAINT "student_subjects_enrollment_class_fk"
  FOREIGN KEY ("enrollment_id","class_id")
  REFERENCES "class_enrollments"("id","class_id")
  ON DELETE restrict;

ALTER TABLE "student_subjects"
  ADD CONSTRAINT "student_subjects_offering_class_fk"
  FOREIGN KEY ("class_subject_id","class_id")
  REFERENCES "class_subjects"("id","class_id")
  ON DELETE restrict;

ALTER TABLE "student_subjects"
  ADD CONSTRAINT "student_subjects_class_session_fk"
  FOREIGN KEY ("class_id","session_id")
  REFERENCES "classes"("id","session_id")
  ON DELETE restrict;

ALTER TABLE "student_subjects"
  ADD CONSTRAINT "student_subjects_class_school_fk"
  FOREIGN KEY ("class_id","school_id")
  REFERENCES "classes"("id","school_id")
  ON DELETE restrict;

ALTER TABLE "student_subjects"
  ADD CONSTRAINT "student_subjects_subject_school_fk"
  FOREIGN KEY ("subject_id","school_id")
  REFERENCES "subjects"("id","school_id")
  ON DELETE restrict;
```

### `\d student_subjects` (fresh database with all migrations)

```text
                                              Table "public.student_subjects"
      Column      |           Type           | Collation | Nullable |                        Default
------------------+--------------------------+-----------+----------+-------------------------------------------------------
 id               | uuid                     |           | not null | gen_random_uuid()
 school_id        | uuid                     |           | not null |
 enrollment_id    | uuid                     |           | not null |
 class_id         | uuid                     |           | not null |
 session_id       | uuid                     |           | not null |
 class_subject_id | uuid                     |           |          |
 subject_id       | uuid                     |           |          |
 is_extra         | boolean                  |           | not null | generated always as (class_subject_id IS NULL) stored
 dropped_at       | timestamp with time zone |           |          |
 created_at       | timestamp with time zone |           | not null | now()
 updated_at       | timestamp with time zone |           | not null | now()
Indexes:
    "student_subjects_pkey" PRIMARY KEY, btree (id)
    "student_subjects_class_session_idx" btree (class_id, session_id)
    "student_subjects_enrollment_class_idx" btree (enrollment_id, class_id)
    "student_subjects_enrollment_offering_uq" UNIQUE CONSTRAINT, btree (enrollment_id, class_subject_id)
    "student_subjects_enrollment_subject_extra_uq" UNIQUE, btree (enrollment_id, subject_id) WHERE subject_id IS NOT NULL
    "student_subjects_id_class_uq" UNIQUE CONSTRAINT, btree (id, class_id)
    "student_subjects_offering_class_idx" btree (class_subject_id, class_id)
    "student_subjects_subject_school_idx" btree (subject_id, school_id)
Check constraints:
    "student_subjects_one_choice_chk" CHECK (num_nonnulls(class_subject_id, subject_id) = 1)
Foreign-key constraints:
    "student_subjects_class_school_fk" FOREIGN KEY (class_id, school_id) REFERENCES classes(id, school_id) ON DELETE RESTRICT
    "student_subjects_class_session_fk" FOREIGN KEY (class_id, session_id) REFERENCES classes(id, session_id) ON DELETE RESTRICT
    "student_subjects_enrollment_class_fk" FOREIGN KEY (enrollment_id, class_id) REFERENCES class_enrollments(id, class_id) ON DELETE RESTRICT
    "student_subjects_offering_class_fk" FOREIGN KEY (class_subject_id, class_id) REFERENCES class_subjects(id, class_id) ON DELETE RESTRICT
    "student_subjects_subject_school_fk" FOREIGN KEY (subject_id, school_id) REFERENCES subjects(id, school_id) ON DELETE RESTRICT
```

## 3. Tests

### Chain constraint tests

`tests/integration/db/enrollment-constraints.test.ts` — **13 passed**.

Covers: offering from another class; offering from another school; class/session mismatch; valid subject; one active enrollment; ended enrollment; transfer source school; compulsory/elective rule; duplicate offering; duplicate admission within/across schools; elective group class/school; group min/max.

### `computeSelection` tests

`tests/unit/academics/enrollment/selection.test.ts` — **24 passed**.

Covers CRS/IRS 1–1, a 1–2 group, two groups, ungrouped electives, no electives, over/under selection, duplicate choices, unknown offering/group, immutability.

### Session-locked loop test

`tests/integration/academics/session-locked-writes.test.ts` — **28 passed**.

Covers class create/update/archive/unarchive, class clone, elective-group create/update/archive, offering add/withdraw, enrollment, electives, transfer, withdraw; every locked case asserts `409 SESSION_LOCKED` and no persisted state change.

Targeted command and result:

```text
npx vitest run tests/integration/db/enrollment-constraints.test.ts \
  tests/unit/academics/enrollment/selection.test.ts \
  tests/integration/academics/session-locked-writes.test.ts
# 65 passed
```

### Seed and OpenAPI

- `tests/integration/seed.test.ts` — passed.
- `tests/integration/openapi.test.ts` — **7 passed**.

### Full suite

Last run:

```text
Test Files  40 passed (40)
Tests       721 passed | 1 skipped (722)
Duration    103.81s
```

The matrix is now green: **275 passed**. The earlier failures were caused by bare `requireAuth` in the enrollment router, a missing student role on the transfer fixture, a session/class mismatch in fixtures, and the offerings query/body schemas.

## 4. Scale timings

Command:

```bash
APP_STAGE=test DB_URL=postgres://…/gate2a_scale npm run scale:check
```

Output:

```json
{
  "students": 1500,
  "setupMs": 412,
  "rosterPageSize": 100,
  "rosterRows": 100,
  "rosterMs": 17,
  "bulkEnrollMs": 2625,
  "rolloverMs": 3,
  "rollover": {
    "classesCloned": 1,
    "groupsCopied": 0,
    "offeringsCopied": 1
  }
}
```

These are local development PostgreSQL timings, not Neon production timings.

## 5. Decision records

- **0014 — Enrollment belongs to a class.** Dated `class_enrollments`; session copied from class and pinned by composite FK; one active enrollment per student/session.
- **0015 — Offerings belong to a class.** `class_subjects` is the teaching/assessment unit; no `session_id` on it; extra subjects stay student-level.
- **0016 — Composite keys pin class and session.** Children carry `class_id`, `session_id`, `school_id`; composite FKs prevent mixed parents.
- **0017 — Elective groups have min/max; no rule engine.** Groups are data; count rules live in `computeSelection`.
- **0018 — Transfers end the old enrollment and create a new one.** `status` + `ended_at`; end old first, then insert new; old subjects untouched; electives not copied; withdrawal is one row.
- **0019/0020 policy additions:** `compulsory_not_elective` check and `dropped_at` for elective rows.

## 6. Guide changes and reasons

- Added `is_compulsory` and the compulsory/elective check because Step 15 required “elective group on a compulsory offering is refused” but the six-table plan had no compulsory marker.
- Added `dropped_at` instead of a boolean for elective drops; it preserves “when?” and matches the archive-as-timestamp pattern.
- Added `status` to `class_enrollments`; transfer/withdraw need a queryable lifecycle reason, while `ended_at IS NULL` remains the active test.
- Made `0018` add `status` nullable and let `0019` backfill before `NOT NULL`/check. The first version would have failed on existing ended rows.
- Restored the missing `0018_boring_galactus.sql` file referenced by the journal.
- Rewrote ADR 0018: it had an unclosed SQL fence and a duplicated second copy of the decision.
- Added class-subject archive guards for classes, subjects, and elective groups; they filter active offerings.
- Fixed lock order in elective groups to session → class, matching class writes.
- Added the shared `assertSessionOpen` guard and wired class create/clone/update/archive/unarchive.
- Fixed `requireAuth` being passed bare instead of called in the new routers; those routes would have hung.
- Mounted the offerings router and updated the matrix test app.
- Fixed the roster route to pass `{ classId }` to the rich roster service.
- Fixed tests that set `ended_at` without `status`; the new check correctly rejects that and the fixtures needed updating.
- Renamed `withdraw.ts` to `withdraw.test.ts`; Vitest was not running it.
- Added the missing student role to the session-locked transfer fixture; transfer’s student-kind check was correct.

## 7. Final status

No remaining test blocker. The matrix and full suite are green. Gate 2b is ready to submit.
