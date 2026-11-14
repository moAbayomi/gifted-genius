# 0020 — Promotion is explicit, previewed, and idempotent

**Status:** Accepted
**Date:** 2026-11-14
**Deciders:** Project owner
**Related:** [0011 — Classes belong to a session](0011-classes-belong-to-a-session.md),
[0014 — Enrollment belongs to a class](0014-enrollment-belongs-to-class.md),
[0018 — Transfers end the old enrolment](0018-transfers-ended-row-new-row.md)

## Context

Promotion is the highest-blast-radius operation in the school year. One bad
automatic run can move hundreds of students into the wrong class, and fixing it
means reconstructing history from enrolment rows. The data needed to decide is
also not always present: JSS 3 → SS 1 requires a track choice, an arm may not
exist in the next session, and a student may be repeating a level rather than
moving up.

## Decision

Promotion is a two-step, administrator-driven operation:

1. **Preview** computes suggestions without writing anything. It reports the
   source class, proposed target class, and any warning (`CHOOSE_TRACK`,
   `NO_MATCHING_CLASS`, or graduation).
2. **Apply** receives the confirmed selections explicitly. It creates a new
   enrolment in the target session for each student, with the target class's
   compulsory offerings. The old enrolment remains as history.

Promotion never runs automatically when a session is opened, closed, rolled
over, or activated. A missing target class is a warning, not an instruction to
create one; the rollover must run first.

**Idempotency** comes from the partial unique index on
`(student_id, session_id) WHERE ended_at IS NULL`: applying the same promotion
twice cannot create a second active enrolment in the target session. The second
run reports the student as already promoted / no-op rather than inserting again.

A repeat is an explicit choice on the preview row and keeps the student at the
same level and arm. JSS 3 → SS 1 is never inferred: it returns `CHOOSE_TRACK`
with no target class until an administrator chooses the track.

## Alternatives considered

- **Auto-promote on session close or rollover.** Rejected. It makes a calendar
  action silently move students, and one bad mapping becomes a mass data repair.
- **Mutate the existing enrolment's `class_id`.** Rejected by ADR 0018: it
  re-scopes past scores and destroys the history that makes corrections possible.
- **Infer a track at JSS 3 → SS 1.** Rejected. Track is a student/guardian and
  school decision, not a property that can be copied from JSS 3.
- **Create missing target classes automatically.** Rejected. It hides a failed
  rollover and can create classes with the wrong arm or track.
- **Make apply non-idempotent and rely on the UI not to double-submit.**
  Rejected. Retries are normal; the database must make the operation safe.

## Consequences

- Promotion can be previewed and corrected before any row changes.
- The source enrolment stays active for its session; the target session gets a
  new active enrolment.
- A repeat and a promotion are the same write shape, differing only in target.
- Applying twice is safe, but the report must distinguish “created” from
  “already active”.
- Rollover is a prerequisite for promotion when the target session is new.
