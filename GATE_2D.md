# Gate 2d — promotion and import evidence

Generated: 2026-11-14. Commit: current `main`.

## Status

Green.

```text
Full suite: 50 files passed, 793 tests passed
```

## 1. Promotion tests

File: `tests/integration/academics/promotion/service.test.ts` — **9 passed**

Covered:

- preview writes nothing and groups rows by target class;
- preview warns `NO_OFFERINGS` when the target class has no offerings;
- commit creates the target enrolment and compulsory subjects, then a second
  run is a no-op;
- a target class with no offerings blocks the whole commit, leaving the source
  enrolment active and no target enrolment;
- locked target session → `409 SESSION_LOCKED`;
- earlier target session → `400 TARGET_SESSION_NOT_LATER`;
- duplicate rows → `400 DUPLICATE_ENROLLMENT` before any write;
- graduation ends the source enrolment and creates no target enrolment;
- **two concurrent commits create exactly one target enrolment** (school-row
  lock + active-enrolment unique index).

Pure suggestion tests: `tests/unit/academics/promotion/suggest.test.ts` —
**7 passed** (ordinary promotion, repeat, graduation, JSS 3 → SS 1
`CHOOSE_TRACK`, missing arm, archived target, track preservation).

## 2. Timings

### Promotion — 1,500 students / 40 classes / 12 offerings each

Recorded in `NOTES.md`:

```text
setup                      525 ms
roster (40 rows)            14 ms
whole-school enrolment   4,366 ms
rollover                    57 ms
promotion commit         1,023 ms
```

Promotion commit:

```text
created          1,500 enrolments
source ended     1,500 enrolments
subjects        18,000 compulsory subject rows
skipped              0
```

### Import — 200-row request cap

Recorded in `NOTES.md`:

```text
rows                     200
import + hash + enrol  6,733 ms
created                  200
credentials              200
```

Hashing runs four at a time; the endpoint caps a request at 200 rows.

## 3. Import tests

File: `tests/integration/academics/student-import/import.test.ts` —
**6 passed**

- returns every mistake with the right row numbers:
  - unknown class;
  - duplicate admission inside the file;
  - duplicate email inside the file;
  - duplicate admission already in the database;
  - invalid row shape;
- resolves class names ignoring case and spacing (`"  jss 1   a "`);
- dry run validates but writes nothing;
- clean chunk creates users, profiles, enrolments, compulsory subjects, and
  returns one-time credentials;
- **save-time conflict rollback**: a PostgreSQL trigger forces a second profile
  insert to fail; the first student’s user, membership, profile, and enrolment
  are all rolled back;
- **log check**: a captured pino logger contains none of the returned temporary
  passwords.

## 4. Full test run

```text
Test Files  50 passed (50)
Tests       793 passed (793)
Duration    155.10s
```

Command:

```bash
cd backend
APP_STAGE=test \
DB_URL=postgres://1337mo@localhost:5432/gate2a_assign2 \
npx vitest run --config "$TMPDIR/vitest.assign.config.ts"
```

## 5. Decision records

### ADR 0020 — Promotion is explicit, previewed, and idempotent

`docs/decisions/0020-promotion-explicit-previewed-idempotent.md`

- Preview first; apply confirmed rows.
- Never auto-promote on session open/close/rollover.
- Idempotency from the active-enrolment-per-session unique index.
- Repeats and JSS 3 → SS 1 track choices are explicit.
- Rejected: automatic promotion, class mutation, inferred tracks,
  auto-created target classes, non-idempotent apply.

### ADR 0021 — Import accepts JSON rows; the frontend parses CSV

`docs/decisions/0021-import-accepts-json.md`

- Backend accepts JSON rows only.
- Frontend parses CSV, maps columns, previews errors.
- No multipart upload, no server-side file storage, no inferred headers.
- Bounded batches; row-level validation errors by index.
- Rejected: server CSV parsing, CSV-in-JSON, inferred headers, direct streaming.

Both are linked from `docs/decisions/README.md`.

## 6. Guide changes and reasons

- **Promotion is preview + explicit apply.** A wrong automatic promotion of
  hundreds of students is a data repair job; the preview is the review step.
- **Graduation is a first-class commit row with `targetClassId: null`.** It ends
  the source enrolment and creates no target row, so graduates do not appear in
  the next session by accident.
- **JSS 3 → SS 1 is `CHOOSE_TRACK`, not a copied track.** Track is a choice, not
  a property of JSS 3.
- **Commit validates everything before the first write.** A target with no
  offerings, a locked/earlier session, a duplicate row, or an inactive source
  enrolment blocks the entire plan.
- **School row is locked first.** Promotion serialises against calendar,
  rollover, and other assignment/enrolment writes in one lock order.
- **Commit chunks enrolments and subjects.** 1,500 students produced 18,000
  subject rows without a single giant statement.
- **Second commit is a no-op.** Source rows are ended; target rows are active;
  the row is reported `ALREADY_PROMOTED`.
- **Import validates before saving and returns all problems with row numbers.**
  The admin fixes one file, not five separate failures.
- **Class matching ignores case and repeated spaces.** Spreadsheet exports vary;
  this is display-name matching, not a new identity rule.
- **Import is JSON rows, not files.** CSV parsing belongs in the frontend where
  the user can see the mapping and preview.
- **Passwords are hashed four at a time and batches are capped at 200.** Argon2
  is intentionally expensive; the cap and timing make the cost visible.
- **Import save is one transaction.** A conflict after validation rolls back the
  entire chunk; no half-imported class.
- **Temporary passwords are returned once and never logged.** The log-capture
  test enforces that promise.

## Caveat

The 1,500-student and 200-row timings are from a local temporary PostgreSQL
database, not production hardware or a remote database. Treat them as relative
costs and a regression baseline, not an SLA.
