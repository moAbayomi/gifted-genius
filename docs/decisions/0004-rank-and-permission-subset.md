# 0004 — Rank to act on people, permission subset to grant

**Status:** accepted

## Context

Permission checks alone answer "may this actor use `roles:assign`?", not "may
this actor use it **on this person**". With only permissions, a principal who
holds `roles:assign` could grant themselves the owner role. Rank checks alone
answer "is this person below me?" but ignore capability: a rank-80 principal
could hand out a permission they do not hold, or grant a role that does.

Both failure modes are escalation. Either check by itself is insufficient.

## Decision

Two independent gates, both required for role work:

1. **Acting on a person** — `canManageMember(actor, targetRank)` requires
   `actor.rank > targetRank`. Strictly higher: peers cannot act on each other,
   and an actor with no roles (rank 0) can act on nobody. `assertCanActOnUser`
   loads the target with `school_id` in the `WHERE`, so a cross-school ID is a
   `404`, indistinguishable from a missing one.
2. **Granting authority** — `canAssignRole(actor, role)` requires
   `role.rank < actor.rank` **and** every permission the role grants to be held
   by the actor. You cannot grant what you do not have. The same subset rule
   protects `PUT /roles/:id/permissions`, so permission editing cannot be used
   to manufacture a role you could then assign.

Self-targeting is rejected explicitly with a message pointing at
`/auth/change-password`, because rank alone would also reject it — with a
confusing "you are not above yourself" error.

The **owner** role is a deliberate exception: its permissions are the full
catalogue and cannot be edited. Otherwise a school could remove
`roles:manage_permissions` from its last owner and become permanently
unadministrable.

## Alternatives considered

- **Permissions only.** Self-escalation through role assignment; the
  `roles:assign` holder becomes effectively omnipotent.
- **Rank only.** A principal can grant any role below rank 80, including
  capabilities they lack. Escalation by delegation.
- **A single "is admin" flag.** Collapses all distinctions and cannot express
  per-school custom roles.
- **Approval workflows for granting permissions you lack.** Correct in theory,
  far too much product surface for an MVP; the conservative rule is cheaper.

## Consequences

- The rule is intentionally conservative: a principal cannot assign the
  guardian role if guardian ever gains a permission the principal lacks (for
  example `fees:pay`). This is documented friction, not a bug. When enrollment
  and fees ship, decide whether the principal should hold those permissions or
  whether structural roles need a separate assignment path.
- Every destructive admin action follows the same shape: self-check → school +
  rank (`assertCanActOnUser`) → permission → work → audit. Predictability is
  the point.
- The last-owner guard (`403`, "Transfer ownership first", plus a
  `SELECT ... FOR UPDATE` lock on the school) exists in
  `removeRoleFromMembership`, but is **unreachable through the API today**:
  only an owner can remove an owner role, and the self-check fires first
  (rank 100 is not strictly greater than 100). The effective protection is
  therefore the self-check. The lock and the owner count become load-bearing
  when ownership transfer or a super-admin exists;
  `tests/integration/users/admin-actions.test.ts` keeps the endpoint-level
  last-owner test skipped for exactly this reason, while the
  `activeOwnerMembershipIds` helper is tested directly.
- Domain invariants stay pure and unit-testable: `can`, `canManageMember`, and
  `canAssignRole` take plain objects, no database. The database-backed
  counterparts are covered by integration tests.
