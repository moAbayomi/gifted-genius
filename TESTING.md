# Testing

The suite runs against a **real PostgreSQL database**, not a mock. Authorization
bugs in this system are mostly SQL-shaped (missing school filter, wrong join,
constraint that does not fire), so mocking the database would test the mock
instead of the system.

## Running it

Prerequisites: Docker running, and `.env.test` present (copy
`.env.test.example`).

```bash
npm test               # one run
npm run test-watch     # watch mode
npm run test-coverage  # coverage report (needs `npm i -D @vitest/coverage-v8`)
npm run check          # ESLint + tsc --noEmit (no database needed)
```

`npm test` does the infrastructure work itself:

1. `tests/global-setup.ts` runs `docker compose up -d --wait db-test`, a
   tmpfs-backed Postgres on port **5433**. It then applies all migrations with
   `drizzle-kit migrate` to that empty database. If migration fails, the
   container is torn down so the next run starts clean.
2. `tests/setup.ts` truncates `users` and `schools` (cascade) **before every
   test**, so tests never share rows.
3. Tests run serially (`pool: "forks"`, `maxWorkers: 1`) because they share one
   database and mutate global state such as rate-limiter counters.
4. Teardown runs `docker compose down db-test`. The dev database (`db`) is left
   running.

The login rate limiter is disabled when `APP_STAGE=test`, so tests can log in
repeatedly. The limiter itself is tested in isolation with its own instance
(`tests/integration/auth/login-rate-limit.test.ts`).

## Layout

| Folder | What it covers | Nature |
| ------ | -------------- | ------ |
| `tests/unit/rbac/` | `can`, `canManageMember`, `canAssignRole`; invariants of the permission catalogue and default roles | Pure functions, no database |
| `tests/integration/auth/` | Login (including multi-school selection and timing), logout, `mustChangePassword`, session invalidation, rate limiting | HTTP + database, except the limiter test which is HTTP only |
| `tests/integration/users/` | Invite, list, reset password, suspend/reactivate, remove role; rollback and mass-assignment cases | HTTP + database |
| `tests/integration/roles/` | Role listing, assignment guards, permission editing, immediate effect of permission changes on a live cookie | HTTP + database |
| `tests/integration/audit/` | School isolation, cursor pagination, filters, malformed cursors, redaction | HTTP + database |
| `tests/integration/school.test.ts` | School creation transaction, rollback, two-school isolation, composite FK enforcement | Service + direct SQL |
| `tests/integration/rank.test.ts` | Rank guards, multi-role rank, cross-school 404, role assignment guards | Service + database |
| `tests/integration/permission-matrix.test.ts` | Every route × every default role, as a table | HTTP + database |
| `tests/integration/require-permission.test.ts` | Middleware wiring: 401, 403, 200 | HTTP + database |
| `tests/integration/seed.test.ts` | Idempotence and one demo user per role | Service + database |
| `tests/integration/app.test.ts` | Health route and JSON 404 | HTTP only |
| `tests/integration/openapi.test.ts` | Document has exactly the mounted paths; `/openapi.json` and `/docs` are served; CSP relaxed for `/docs` only | HTTP only, no database |
| `tests/integration/openapi-contract.test.ts` | Real responses parse against the documented response schemas (login, `/me`, users, roles, audit, error envelope) | HTTP + database |

Helpers live in `tests/helpers/auth.ts`: `loginAgent` returns a supertest agent
that persists the session cookie, and `loginAsRole` logs in as one of the demo
accounts.

## Three tests worth reading

### 1. The late-failure rollback — `tests/integration/school.test.ts:271`

> "rolls back everything when a late step fails"

School creation is a single transaction with seven steps: school, five roles,
every role permission, owner membership, owner role assignment, audit row. The
test passes an owner user ID that does not exist, so the FK fails at step 5 —
**after** the school and all roles and permissions have already been inserted.
It then asserts that every table is empty:

```ts
expect(c).toEqual({ schools: 0, roles: 0, perms: 0, memberships: 0, membershipRoles: 0, audit: 0 });
```

This is the test that proves the `db.transaction` is real rather than assumed.
`tests/integration/users/create-user.test.ts:228` applies the same idea to the
invite flow: a failure after the user row is created must leave no user,
membership, role assignment, or audit row.

**Why it matters:** partial tenant creation is the kind of bug that only shows
up in production, months later, as an orphaned role set. A service that looks
correct can still be missing its transaction; only a failure injected *after*
early writes proves otherwise.

### 2. The constraint tests — `tests/integration/school.test.ts:361`

> "composite FK enforcement" → "rejects a role from another school", "rejects a
> membership from another school", "rejects an assignedBy from another school",
> and a same-school control

These tests deliberately **bypass the service layer** and insert directly into
`membership_roles` with a mismatched pair. Each assertion checks the specific
constraint that fired:

```ts
await expect(
  db.insert(membershipRoles).values({ membershipId: a.ownerMembership.id, roleId: roleInB.id, schoolId: a.school.id }),
).rejects.toSatisfy((e) => isForeignKeyViolation(e, "membership_roles_role_school_fk"));
```

The control case (same school) must succeed, so the test cannot pass merely by
rejecting everything.

**Why it matters:** this is the difference between "we check tenancy in the
service" and "the database cannot store a cross-tenant row". Service tests
prove the current code path; constraint tests prove every future path,
including scripts and psql.

### 3. The permission matrix — `tests/integration/permission-matrix.test.ts`

A data-driven table where each row is a request builder and a map of
`{ owner, principal, teacher, guardian } → expected status`. One nested
`describe`/`it` is generated per row and role, so adding a route means adding
one row, not four tests.

The fixture choice is the interesting part. Destructive rows target the
**student** membership (rank 20), because:

- every test role outranks the student, so the rank guard always passes;
- no test role *is* the student, so the self-check never fires.

That isolates the permission gate as the only reason a request can be
forbidden. Target a teacher and the teacher rows fail on self-check while the
guardian rows fail on rank — the test would pass even if
`requirePermission` were deleted. The file documents this trap in a comment.

**Why it matters:** it is a regression net around the whole authorization
surface. A new route without a guard, or a guard on the wrong permission, shows
up as one failing row instead of a production incident.

## Writing a new test

- Start from the seed (`await seed({ password: TEST_PASSWORD })`) and log in
  through the real endpoint; do not fabricate `req.actor`.
- Assert both the HTTP response **and** the database side effects (session
  deleted, audit row written, role row gone). A 200 with no side effect is a
  failure.
- Prefer `buildApp()` from `src/app.ts` when the route is mounted there. A few
  older tests assemble a local Express app; that is how a missing router mount
  stayed invisible in the past.
- Use `isForeignKeyViolation` / `isUniqueViolation` with the constraint name
  when asserting a constraint, not a generic `toThrow`.
- Never assert on timing unless you control the environment, except for the one
  deliberately generous 50 ms login-timing test.

## Known gaps

- No tests for `PATCH /users/:id` (profile updates), so the shared-account guard
  on email change and the username-taken path are unproven.
- No test for a wrong `currentPassword`, or for other sessions being revoked on
  self-service password change.
- The last-owner endpoint test is skipped; only the helper is tested (see
  `SECURITY.md` row 8).
- No concurrent-transaction test for the last-owner lock.
- No CI workflow yet; the intended gate is `npm run check && npm test`.
