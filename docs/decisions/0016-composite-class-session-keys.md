# 0016 — Composite keys pin class and session together

**Status:** Accepted
**Date:** 2026-11-04
**Deciders:** Project owner
**Related:** [0002 — Composite foreign keys for tenancy](0002-composite-foreign-keys.md),
[0011 — Classes belong to a session](0011-classes-belong-to-a-session.md),
[0014 — enrollment belongs to a class](0014-enrollment-belongs-to-class.md)

## Context

A class already determines its session and school. But child tables still need
`session_id` and `school_id` in practice: the one-active-enrollment rule needs a
session column, result queries filter by session without joining every parent,
and a student-subject row must prove that its enrollment and its offering are in
the **same class and session**. A single `class_id` FK proves the class exists;
it does not prove that two children agree with each other.

Application checks catch the common path, not a script, a migration, or a future
service that forgets one condition. The database needs to reject the impossible
pair directly.

## Decision

Use the same composite-key pattern established in ADR 0002, extended to the
class/session boundary:

- `classes` has `unique (id, session_id)` and `unique (id, school_id)`.
- `class_enrollments` and `class_subjects` each carry
  `unique (id, class_id)` so they can be composite-FK targets for
  `student_subjects`. Neither publishes `(id, class_id, session_id)`; the
  session is checked separately against the class.
- Child tables that carry both values reference the pair:


```
enrollments:
  unique (id, class_id)
  foreign key (class_id, session_id) references classes (id, session_id)
  foreign key (class_id, school_id) references classes (id, school_id)

class_subject_offerings:
  unique (id, class_id)
  foreign key (class_id, session_id) references classes (id, session_id)   ← added
  foreign key (class_id, school_id) references classes (id, school_id)

student_subjects:
  foreign key (enrollment_id, class_id) references enrollments (id, class_id)
  foreign key (offering_id, class_id) references class_subject_offerings (id, class_id)
  foreign key (class_id, session_id) references classes (id, session_id)   ← added
```

The child carries redundant `class_id`, `session_id`, and `school_id`. The
service copies them from the class/enrollment it has already validated; it never
lets the caller choose them independently. The composite FK is what makes the
redundancy safe.

For `student_subjects`, the two composite FKs are the point: an enrollment and an
offering can both be real and still belong to **different classes or sessions**
if only single-column FKs are used. The pair makes “this choice is for the class
I am enrolled in, in the session I am enrolled in” a database rule.

## Alternatives rejected

- **A single `class_id` FK plus service checks.** Correct on the happy path, but
  a script or a missed service check can attach a 2026/2027 offering to a
  2027/2028 enrollment. Rejected.
- **No `session_id` on children, always join through the class.** Cleaner in
  theory, but it makes the one-active-enrollment partial index impossible without
  a trigger, makes session-scoped queries join every time, and cannot express a
  composite FK between two children.
- **A free-standing `session_id` with no composite FK.** The exact drift this ADR
  exists to prevent.
- **A trigger to compare parent values.** More moving parts and harder to read
  than a declarative FK; triggers also complicate imports and migrations.
- **One wide denormalized table for enrollment/offering/result.** Removes the
  join but makes each row responsible for repeating and maintaining every
  parent fact.

## Consequences

- Every child key carries `class_id`, `session_id`, and `school_id`; the columns
  are redundant by design.
- Parent tables need the two unique constraints (`id, session_id` and
  `id, school_id`) even when they have a primary key. Those indexes serve the
  FKs and are cheap.
- Cross-class or cross-session combinations fail at insert time, including
  direct SQL, seed scripts, and future services.
- The service must copy values from the already-validated parent, not trust
  request fields. A caller cannot “move” a child by sending another session.
- Queries can filter by session directly, and the one-active-enrollment partial
  unique index is enforceable.
- This pattern composes with tenant isolation: the class FK already includes
  `school_id`, so the session key does not weaken the tenancy guarantee.
