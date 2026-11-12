# 0009 — roles.kind instead of checks on role keys

**Status:** Accepted
**Date:** 2026-10-28
**Deciders:** Project owner

## Context

System roles (`owner`, `principal`, `teacher`, `student`, `guardian`) are
the starting point. Schools will eventually create custom roles ("Vice
Principal", "Bursar", "House Captain", "Librarian"). Code needs to answer
*categorical* questions: "does this role need a student profile?", "can
this member be enrolled as a student?", "can this member be assigned as a
teacher?" These are questions about **who a person is**, not about what
they are allowed to do.

Authorization questions ("can this person reset that password?", "can this
person grant that role?") are answered by `can()` using permissions, and by
rank comparison for target-selection. Category and authorization are
different axes and must not be conflated.

## Decision

Add a `kind` column to `roles`: `staff | student | guardian`. It answers
categorical questions only — may this member be enrolled as a student, may
they be assigned as a teacher. It never answers authorization questions.
Authority comes from permissions and rank through `can()`. There is
deliberately **no `admin` kind**: an admin is simply a staff member with
broad permissions and a high rank.

## Alternatives rejected

- **A fourth kind `admin`**: rejected because it invites kind checks in place
  of permission checks. If any code asks `role.kind === "admin"`, it creates
  a second authorization path that bypasses `can()` — a "super-role" backdoor
  that will grow over time as more sensitive actions want a quick "is admin"
  shortcut. Authorization must flow through permissions only. An owner and a
  principal are both `staff`; they differ in permissions and rank.

- **Checks on role keys** (`role.key === "owner" || role.key === "principal"`):
  - Fragile: a typo in the key string breaks the check silently.
  - Scattered: the list of "staff" roles appears in multiple places across
    the codebase.
  - Does not scale to custom roles: a school-created "Librarian" role would
    not be recognized as staff without adding its key to every check.

- **Checks on `rank`**: rank is authority, not category. Two roles can share
  the same rank but belong to different kinds. A custom "House Captain" role
  (student kind, rank 30) and a custom "Librarian" role (staff kind, rank 30)
  sit at the same rank but belong to entirely different categories —
  "House Captain" members can be enrolled as students, "Librarian" members
  can be assigned as teachers. Rank alone cannot distinguish them; only
  `kind` can.

- **Checks on `permissions`**: permissions are specific capabilities, not
  categories. "Staff" is not a single permission. A role could have zero
  permissions and still be staff-kind (e.g., a new teacher awaiting
  assignment).

## Consequences

- One extra column on `roles` — additive, no behavior change for existing rows.
- Every role must have a kind, including custom roles. System roles backfill:
  `owner`, `principal`, `teacher` → `staff`; `student` → `student`;
  `guardian` → `guardian`. The migration touches only the two non-staff rows
  by name and defaults everything else to `staff`.
- Adding a new staff role (system or custom) is a data change, not a code
  change.
- Categorical queries become simple: "all staff roles" is `WHERE kind = 'staff'`.
- `kind` is never consulted for authorization. Two very specific checks —
  the last-owner invariant and the owner-role-immutable rule — use
  `role.key === "owner"` because they ask a specific-key question ("is this
  THE owner role"), not a category question. Those two checks live in one
  small module and are covered by tests. They are the only legitimate
  `role.key` comparisons in the codebase, and they reference the exported
  `OWNER_ROLE_KEY` constant, never the literal string `"owner"`.