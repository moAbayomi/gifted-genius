# 0014 — enrollment belongs to a class, with the session coming through the class

**Status:** Accepted
**Date:** 2026-11-04
**Deciders:** Project owner
**Related:** [0011 — Classes belong to a session](0011-classes-belong-to-a-session.md),
[0016 — Composite keys pin class and session](0016-composite-class-session-keys.md)

## Context

A student’s academic placement is not a property of the student row. A person can
be in JSS 1 A in 2026/2027, JSS 2 A in 2027/2028, and a different arm after a
transfer. Scores, attendance, report cards, and fees must stay attached to the
placement that was true when they were recorded. A mutable
`student_profiles.class_id` or `student_profiles.session_id` pointer destroys that history the
first time a student moves.

The phase also has a specific constraint: the caller should choose a **class**,
not independently choose a class and a session. A class already belongs to one
session (ADR 0011), so “JSS 1 A” in 2026/2027 and “JSS 1 A” in 2027/2028 are
different rows.

## Decision

Create `class_enrollments` as the student’s dated placement in a class:

```text
class_enrollments (
  id,
  school_id,
  student_id,              -- student_profiles.id (school-local)
  class_id,
  session_id,              -- copied from the class, not chosen by the caller
  started_at,
  ended_at,                -- null = active
  ended_reason,
  transferred_from_enrollment_id, -- nullable; see 0018
  created_at,
  updated_at
)
```

Rules:

- The API accepts `student_id` and `class_id`. It does **not** accept
  `session_id` from the caller.
- The service loads the class, copies `class.session_id` into the enrollment, and
  inserts. The composite FK `(class_id, session_id)` to
  `classes(id, session_id)` makes the copied value impossible to disagree with
  the class.
- A unique partial index on `(student_id, session_id) WHERE ended_at
  IS NULL` allows **one active class per student per session**. Historical
  enrollments are unlimited.
- A student moves by ending the old enrollment and inserting a new one. The old
  row is never re-pointed at another class (ADR 0018).
- Scores, attendance, and student-subject rows reference `enrollment_id`, not a
  student or class directly.

The session column exists because it is needed for the one-active rule, session
queries, and composite FKs. It is still “coming through the class”: it is
derived from the class and guarded, never independently editable.

## Alternatives rejected

- **`student_profiles.class_id` / `student_profiles.session_id` columns.** One row per student
  cannot hold history; the first transfer overwrites the past. Rejected.
- **enrollment by `(level, arm, track)` strings.** Repeats class identity in every
  row, cannot be foreign-keyed, and drifts when an arm is renamed.
- **A caller-supplied `session_id` alongside `class_id`.** Invites “class from
  2026/2027, session 2027/2028” rows. If the session is copied from the class and
  pinned by a composite key, it is safe; as an independent input it is not.
- **One enrollment row per student per school, mutated on promotion.** Destroys
  the old class, old scores, and the audit trail. Rejected in favour of dated
  rows.
- **enrollment directly in a session with no class.** Loses the arm/track and
  makes “which class was this score for?” unanswerable.

## Consequences

- Promotion and transfer are insert-and-end operations, not updates to
  `class_id`.
- A student can be enrolled in one class per session, but any number of
  historical sessions.
- Every result, attendance record, and subject choice can point at the exact
  enrollment that existed when it was recorded.
- Queries for “the current class” filter on `ended_at IS NULL`; the partial
  unique index makes “two active enrollments” impossible.
- The session is repeated on the enrollment. That redundancy is deliberate and is
  protected by the composite key in ADR 0016; it is not a second source of truth.
- Transfer between schools is a new student profile/membership, not an enrollment
  transfer. Within a school, it is an ended row plus a new row (ADR 0018).
