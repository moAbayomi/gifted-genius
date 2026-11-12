
# 0015 — Offerings belong to a class

**Status:** Accepted
**Date:** 2026-11-04
**Deciders:** Project owner
**Related:** [0011 — Classes belong to a session](0011-classes-belong-to-a-session.md),
[0016 — Composite keys pin class and session](0016-composite-class-session-keys.md)

## Context

A subject is not taught to a bare student or to a level; it is taught to a
specific class in a specific session by a specific teacher. "Mathematics for JSS
1 A in 2026/2027" is a real, assignable thing: it has a subject, a class, an
optional teacher assignment, and eventually assessment components and results.
Putting `subject_id` directly on an enrolment would make every student's subject
list a special case and leave nowhere to attach the class-wide teacher or
assessment setup.

Separately, a principal occasionally approves a single student to take a subject
the class does not offer — an extra subject for that one student. The class does
not start offering it to everyone; it is a fact about that student. The model
has to hold both cases without turning the class's offering list into a place
where per-student exceptions hide.

## Decision

### Class offerings — what the class teaches

Create `class_subjects` as the class's subject instance:

```text
class_subject_offerings (
  id,
  school_id,
  class_id,
  session_id,    -- copied from the class and pinned by composite FK
  subject_id,
  created_at,
  updated_at,

  unique (class_id, subject_id),
  unique (id, class_id)      -- FK target for student_subjects
)
```

An offering belongs to exactly one class. The class supplies the session and the
school. `class_subjects` deliberately does **not** carry `session_id`: the class
is the single source of the session. Every downstream row that needs the session
reads it from the class (or carries it with the composite guard in ADR 0016).

Teacher assignment is a separate concern (`offering_teachers` or an
`assigned_teacher_membership_id` on the offering, depending on whether a class
may share a subject between teachers). Do not put the teacher on the subject or
on the class; a teacher is assigned to an offering.

The **normal** subject list for a class comes from its offerings. The offering
table does not carry per-student flags — it answers "what does this class
teach?", not "what has this student been approved for?".

### Extra subjects

Extra subjects (a student-specific offering) are **not supported**. They were
removed before 2c because no school confirmed the workflow and they break the
teacher/offering scope chain: a teacher is assigned to an offering, so an extra
row would have no teacher who may score it. See `PARKING.md`.

## Alternatives rejected

- **A student-specific `class_subjects` row for every extra subject,
  marked `is_extra=true`.** Makes the class's normal offering list ambiguous —
  is `is_extra=true` an offering the class has, or a per-student exception
  dressed as one? — and duplicates teacher configuration per extra. The
  approved exception is a fact about one student, not about the class; it
  belongs on `student_subjects`, not on the offering. This option would also
  silently break the schema's plain meaning: "offerings" would stop meaning
  "what the class teaches."
- **Subjects on the enrolment only.** Repeats the subject configuration for
  every student, and leaves no class-wide teacher/assessment owner.
- **A `subjects` list on `classes` (JSON or text array).** Cannot foreign-key,
  cannot attach a teacher or assessment scheme, and cannot be queried by subject
  without parsing strings.
- **A global offering per subject.** "Mathematics" would not know its class,
  session, teacher, or assessment setup.
- **A subject with no offering row, referenced only by results.** Results would
  have no class/session owner and no teacher assignment. (For extras,
  `student_subjects.subject_id` provides the guaranteed reference; results
  attach to `student_subjects` rows, which may be normal or extra.)

## Consequences

- Every score, assessment, and report-card line points at a `student_subjects`
  row (normal or extra) and through it at the class and session.
- Adding a subject to a class is one offering row, not one row per student.
- The class's offering list stays accurate: it lists what the class offers, not
  what individual students have been approved for.
- Teacher assignment can change without rewriting the class or the subject.
- The class supplies the session; it is not repeated on the offering.
- - **Archiving a subject does not refuse on existing offerings.** When
  `class_subjects` and `student_subjects` exist, existing rows that reference
  an archived subject remain valid — they are historical facts. The offering
  service (not this one) refuses *new* offerings under an archived subject:
  `createClassSubject` and `updateClassSubject` must pre-check
  `subject.archivedAt === null` and reject with `409 SUBJECT_ARCHIVED`
  otherwise. The catalogue service does not guard, because it does not know
  about its children (dependency direction: parents do not know children).
  This choice is deliberate — see ADR 0017 archive semantics.
```
