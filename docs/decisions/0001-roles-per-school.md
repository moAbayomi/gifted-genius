# 0001 — Roles are per school, not global

**Status:** accepted

## Context

The portal is multi-tenant. The same person can be a teacher at one school and
a guardian at another, and two schools can mean different things by
"principal". A global `roles` table would force one permission policy for every
tenant, or push per-tenant exceptions into a side table that no constraint can
validate.

## Decision

Roles belong to a school. `roles` has a non-null `school_id`, a `rank`, and a
`key` that is unique **within** that school (`roles_school_key_uq`). When a
school is created, `createSchoolWithDefaults` copies `DEFAULT_ROLES` into five
rows owned by that school and grants each role its permissions. A membership
gets a role through `membership_roles`, whose composite FK
`(role_id, school_id) → roles(id, school_id)` makes "this role belongs to
another school" impossible to store.

`role_permissions.permission` is plain text, not a FK. The catalogue of valid
permissions lives in code (`src/modules/rbac/permissions.ts`); the database
stores which role at which school has been granted one.

## Alternatives considered

- **Global roles with a per-school override table.** Two places define
  authority; every check has to merge them, and the override rows are not
  covered by the tenancy FKs.
- **Global roles plus JSON exceptions on the school row.** Unqueryable,
  unvalidated, and invisible to joins.
- **One database (or schema) per school.** Strong isolation, but migration and
  connection management multiply, and cross-school identity becomes a sync
  problem. The composite-FK approach gives most of the isolation inside one
  database.

## Consequences

- Adding a role means inserting a row per school. Five rows per tenant is
  cheap; this is the price of independent policy.
- Changing `DEFAULT_ROLES` affects **new** schools only. Existing schools keep
  their rows. Adding a permission is therefore a code change plus an explicit
  migration for existing tenants — never a silent behaviour change.
- Renaming a permission is a data migration, because `role_permissions` stores
  strings. Deploy order matters: migrate first, then ship code.
- Roles can diverge per school, which is the point. It also means tests that
  assume "every school has these five roles" must create the school through
  `createSchoolWithDefaults`, not by inserting a school row directly.
