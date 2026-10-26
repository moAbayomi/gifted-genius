# 0002 — Composite foreign keys enforce tenancy

**Status:** accepted

## Context

A multi-tenant table stores `school_id` on every row, but "every row" is a
promise the application must keep. Application checks can be forgotten,
bypassed by a script, or skipped by a race. A row whose `role_id` belongs to
school A and whose `school_id` says B is not a valid state — yet a plain
single-column FK will happily accept it.

## Decision

Every parent table that children reference carries a unique constraint on
`(id, school_id)` — `memberships_id_school_uq`, `roles_id_school_uq`. Child
tables denormalize `school_id` and declare a **composite** FK on both columns:

```sql
FOREIGN KEY (role_id, school_id) REFERENCES roles (id, school_id)
```

This is used by `membership_roles` (membership, role, and `assigned_by`),
`sessions` (`(active_membership_id, user_id) → memberships(id, user_id)`),
`audit_log` (`(actor_membership_id, school_id)`), and `students`. The database,
not the service layer, is the last line of defence.

## Alternatives considered

- **Application-only checks.** The current design already checks in services;
  the FK is what catches the one path that forgets.
- **Postgres row-level security.** Good isolation, but policy lives outside the
  schema, is easy to misconfigure silently, and complicates the connection
  model (per-request role/session variables). Worth revisiting at scale.
- **Schema-per-tenant.** See ADR 0001.

## Consequences

- Every child row repeats `school_id`. That redundancy is the mechanism, not an
  accident.
- Composite FKs need the parent's `(id, school_id)` unique constraint, so
  parent tables carry constraints that exist only to make tenancy enforceable.
- Writes from any path — HTTP, seed script, psql — are rejected if they mix
  schools. `tests/integration/school.test.ts` proves all three directions.
- `MATCH SIMPLE` is the default: the FK is skipped if **either** column is
  NULL. That is desirable for nullable `assigned_by`, and dangerous for
  `audit_log`, which is why `audit_actor_needs_school_chk` exists. Any future
  composite FK with a nullable column needs the same reasoning.
- Deletion order becomes explicit. `sessions` RESTRICTs deleting a membership
  until sessions are gone; audit rows RESTRICT deleting the actor. That is
  intentional (ADR 0005).
