# 0019 — Scope by assignment, with an `_all` permission suffix

**Status:** Accepted
**Date:** 2026-11-12
**Deciders:** Project owner
**Related:** [0004 — Rank and permission subset](0004-rank-and-permission-subset.md),
[0011 — Classes belong to a session](0011-classes-belong-to-a-session.md),
[0014 — Enrollment belongs to a class](0014-enrollment-belongs-to-class.md)

## Context

A teacher is not a school-wide reader. A subject teacher may see the classes and
students they teach; a form teacher may see the class they are responsible for.
A principal or owner may see the whole school. A role such as `teacher` says what
kind of member a person is, but it cannot say **which class** they teach. Roles
are also school-scoped and admin-managed, so using a role as the scope key would
make every teacher share the same visibility.

Scope must therefore come from assignment data that an administrator controls.
It must also be safe when the resource exists but the actor may not see it: an
out-of-scope ID should not reveal whether that row exists.

## Decision

### Assignment data

- **Form teacher** is a nullable column on `classes`:
  `form_teacher_membership_id → memberships(id)`.
  A class has at most one form teacher, so a column is the correct cardinality.
- **Subject teacher** is an assignment row, not a role:
  `class_subject_teachers` (or the equivalent offering-teacher table) links
  `membership_id → class_subject_id`, scoped by `school_id`.
  A teacher may teach many offerings, and an offering may have one or more
  teachers; that is a many-to-many table.
- Assignments are created, changed, and removed by an administrator with
  `assignments:manage`. A teacher cannot assign themselves to a class. Every
  assignment change is audited.

### Permission naming

The base permission means **assigned scope**:

```text
enrollments:read      → only classes/offerings assigned to this membership
enrollments:manage    → only within assigned scope
```

The `_all` suffix means **school-wide scope**:

```text
enrollments:read_all  → every class in the actor's school
```

`_all` is an additional permission, not an implicit grant from rank. A
principal/owner typically has both the base permission and `_all`; a teacher has
only the base permission and is restricted by assignment rows. A future
`attendance:read_all`, `results:read_all`, etc. follows the same convention.

### Authorization and visibility

For a request:

1. `requireAuth()` establishes the school and membership.
2. `requirePermission(...)` decides whether the actor has the capability at all.
3. The service computes **effective scope**:
   - if the actor has the corresponding `_all` permission, no assignment filter;
   - otherwise:
     - form-teacher access: `classes.form_teacher_membership_id = actor.membership_id`;
     - subject-teacher access: an assignment row exists for the actor and the
       relevant `class_subject_id` / class;
   - always intersect with `school_id = actor.school_id`.
4. List queries apply the scope predicate in SQL. Single-resource lookups include
   it in the `WHERE`.

**Out-of-scope is reported as `404 NOT_FOUND`**, the same response as a
nonexistent ID. It is not `403`, and it is not an empty `200` for a single
resource. `403` is reserved for the permission gate — the actor does not have the
capability at all. This prevents ID probing and avoids revealing the existence of
another class or student.

## Alternatives rejected

- **Derive scope from the role.** A role says “teacher”, not “JSS 2 A”; every
  teacher would share the same scope, and changing a teacher’s class would mean
  editing a role. Rejected.
- **Put `class_id` on the membership or role.** A teacher can have several
  classes/offerings, and a role is shared by many people. Rejected.
- **Return `403` for out-of-scope resources.** It confirms the row exists and
  leaks class/student IDs. Rejected.
- **Return an empty list for out-of-scope single resources.** Callers cannot
  distinguish “missing” from “forbidden”, and the API becomes inconsistent.
  Rejected.
- **Use one generic polymorphic assignment table for form teachers and subject
  teachers.** It would need a type discriminator and would not enforce “one form
  teacher per class” as cleanly as a nullable column. Rejected.
- **Put form teacher in the assignment table and parse the first row as the form
  teacher.** Ambiguous and race-prone. The class column is the clearer model.
- **Ignore scope in the service and filter in each route.** One missed route is a
  data leak. Scope belongs in the shared service/query layer.

## Consequences

- A teacher's visibility changes when an admin changes assignments, not when a
  role is edited.
- The form-teacher column gives a database-level one-per-class guarantee; subject
  teachers use the assignment table.
- Every scoped endpoint must apply the same predicate and the same 404 rule.
  Tests should cover owner/principal (school-wide), assigned teacher, and
  unassigned teacher.
- `_all` is explicit: a teacher cannot gain school-wide access merely by rank or
  by holding a role called “principal”.
- Assignment changes are auditable and remain separate from role changes.
- The scope table is the next schema step; until it exists, only the `_all`
  path and the form-teacher column can be enforced.
