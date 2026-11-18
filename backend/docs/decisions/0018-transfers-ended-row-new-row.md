# 0018 — Transfers end the old enrollment and create a new one

**Status:** Accepted
**Date:** 2026-11-04
**Deciders:** Project owner
**Related:** [0014 — Enrollment belongs to a class](0014-enrollment-belongs-to-class.md),
[0011 — Classes belong to a session](0011-classes-belong-to-a-session.md)

## Context

A student can change class or arm mid-session: a parent requests a move, a class
is merged, a student moves from JSS 2 A to JSS 2 B, or a senior changes track.
The tempting implementation is to update `class_enrollments.class_id`. That
silently re-scopes every score, attendance record, and subject choice linked to
the enrollment: past work suddenly belongs to a class the student never attended.
It also destroys the answer to “which class was this result for?”

A transfer must preserve the old placement as history and create a new placement
for the future. Separately, a student may leave the school — that is a
withdrawal, and it must not leave a phantom replacement enrollment behind.

## Decision

### Lifecycle fields

`class_enrollments` carries both a status and an end timestamp. They serve
different purposes and are kept consistent by a database check:

- **`status text NOT NULL`** — the lifecycle state:
  `'active' | 'transferred' | 'withdrawn'`.
- **`ended_at timestamptz NULL`** — the timestamp. `ended_at IS NULL` remains the
  single authoritative test for “is this enrollment active.” The partial unique
  index keys on `(student_id, session_id) WHERE ended_at IS NULL`.
- **`ended_reason text NULL`** — free-text human detail (“moved to Kano”,
  “transferred to JSS 2 B”). Kept for audit and reading, not for querying.

`class_enrollments_status_ended_chk` enforces:

```sql
status IN ('active', 'transferred', 'withdrawn')
AND (
  (status = 'active' AND ended_at IS NULL)
  OR
  (status <> 'active' AND ended_at IS NOT NULL)
)
```

There is no way for `status` and `ended_at` to disagree.

### Transfer

A transfer is **two enrollment rows**, not an update.

1. End the existing row:
   - `status = 'transferred'`
   - `ended_at = now()` (or the effective transfer date)
   - `ended_reason = 'transferred'` (or a caller-supplied detail)
   - never delete it and never change its `class_id`.
2. Insert the new row:
   - same student and school;
   - the target class (and therefore the target session);
   - `status = 'active'`;
   - `started_at = now()` (or the effective date);
   - `ended_at = null`;
   - `transferred_from_enrollment_id` pointing at the old row.

**Order is not negotiable.** End the old row before inserting the new one, inside
one transaction. If both rows are in the same session, the partial unique index
rejects the new insert while the old row is still active. Ending first keeps the
constraint honest and keeps the two writes atomic.

The new enrollment is created through the same shared core used by
`enrollStudent` (`createEnrollmentCore`). It therefore gets the target class’s
active compulsory `student_subjects` rows. It does **not** copy elective
choices. The student chooses electives for the new class explicitly; the old
subject rows stay attached to the old enrollment.

The transaction writes two audit rows:

- `enrollment.transferred` on the old row;
- `enrollment.created` on the new row, with `metadata.via = 'transfer'`.

### Withdrawal

A withdrawal is **one enrollment row**, not two:

- `status = 'withdrawn'`
- `ended_at = now()`
- `ended_reason = <caller reason> ?? 'withdrawn'`

No replacement enrollment is created. Withdrawal is terminal: the student has
left, so there is no destination. The old `student_subjects` rows are preserved
unchanged; they are the historical record of what the student was taking when
they left.

### Cross-school moves

A move between schools is **not** an enrollment transfer. The student profile is
school-local, so it is a new membership/profile plus a new enrollment in the
target school. Do not cross the tenant boundary with a direct `class_enrollments`
update.

## Alternatives rejected

- **Update `class_id` on the current enrollment.** Rewrites history and silently
  re-scopes every child record. Rejected outright.
- **Delete the old enrollment and create a new one.** Loses the row that scores
  and attendance reference; deletion also hits FK restrictions. End, do not
  delete.
- **A mutable `student_profiles.class_id` pointer.** Same history loss at the
  student level, and it cannot express one placement per session.
- **A separate `transfers` table as the source of truth.** Duplicates enrollment
  state; every query then has to merge “current enrollment” with “transfer
  history.” A transfer is an event over enrollments; the enrollment rows are the
  source of truth.
- **One row with a list of date ranges per class.** Makes “current class” and
  foreign keys ambiguous; the row would change identity whenever a range changes.
- **Treat a cross-school move as an in-school transfer.** Crosses the tenant
  boundary and reuses a school-local profile.
- **`is_dropped boolean` on `student_subjects` instead of `dropped_at`.** Same
  reasoning as `archived_at` in ADR 0013: a boolean loses “when?” and needs a
  second column. A nullable timestamp answers both.

## Consequences

- “Current class” is always `ended_at IS NULL`; history is every other row.
  `status` is the queryable reason a row is not active.
- A transfer is auditable: who did it, when, from which class, to which class,
  and why.
- A withdrawal is auditable: one `enrollment.withdrawn` row with before/after
  status and the caller’s reason.
- Old results and `student_subjects` remain valid and correctly scoped after a
  move. The new enrollment starts with only its target compulsory subjects.
- A failed transfer leaves the old enrollment active: the end, insert, and
  audit rows share one transaction, and the unique index backs up the rule.
- Session-level moves still require the target class to belong to the target
  session, enforced by the composite keys in ADR 0016.
- Both writes are in `tests/integration/academics/session-locked-writes.test.ts`:
  a closed session returns `409 SESSION_LOCKED` before any status/end-date
  change or new row persists.
