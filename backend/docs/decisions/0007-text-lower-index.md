# 0007 — `text` + `lower()` index instead of `citext`

**Status:** accepted

## Context

Email must be unique case-insensitively: `Ada@School.test` and `ada@school.test`
are one person. The same question appears for slugs, usernames, and role keys.
Postgres offers `citext` for this, but it is an extension: it must be installed
on every environment (including managed Postgres and CI), it is not portable,
and it hides the case-folding from the query author.

## Decision

Use plain `text` columns and make case-insensitivity explicit:

- `users.email` is `text`, with `CREATE UNIQUE INDEX users_email_lower_uq ON
  users (lower(email))`.
- Lookups use the same expression: `WHERE lower(email) = $1`.
- Input is normalised first (`normalizeEmail` trims and lowercases), so stored
  emails are consistently cased even though the column does not force it.
- Usernames and slugs are validated by CHECK constraints
  (`memberships_username_chk`, `schools_slug_chk`) and unique indexes scoped to
  the tenant (`memberships_school_username_uq`, `roles_school_key_uq`).

## Alternatives considered

- **`citext`.** Concise and correct, at the cost of an extension dependency on
  every environment, a non-standard type in a portable schema, and invisible
  behaviour: `WHERE email = $1` silently becomes case-insensitive, which is
  convenient until it is not.
- **Application-only lowercasing.** One script or direct `psql` insert bypasses
  it; the unique index would then allow both cases.
- **`UNIQUE (email)` on the raw column.** Wrong for the product: two accounts
  for one person.
- **Storing a separate `email_normalized` column.** Works, but it is a second
  source of truth that can drift; an expression index cannot drift.

## Consequences

- Queries must use `lower(email)` to benefit from the index. A query on the raw
  column is still correct (case-sensitive) but scans and can miss a row. This
  is centralised in the two `findUserByEmail` implementations and
  `normalizeEmail` at the boundary.
- The functional index allows multiple `NULL` emails (students without email),
  which is required. A `NOT NULL` unique email column would not.
- The index is expression-based, so Drizzle's schema declares it as
  `uniqueIndex(...).on(sql\`lower(${users.email})\`)`; generated migrations keep
  it. Any future change to the expression requires a new index and a data
  backfill.
- Nothing extra to install: a clean Postgres, a managed provider, and CI all
  behave identically.
- The same pattern is reusable for any future case-insensitive field without
  another extension decision.
