# Gifted Mind — School Portal API

A multi-tenant backend for a school portal. One person, one account, one
membership per school: a teacher can also be a parent at the same school, and
a principal can belong to two schools without sharing an identity or a role.
Authorization is per-school, auditable, and enforced in the database as well as
in application code.

Built for school owners, principals, and administrators who need role-based
access without a separate database per school — and for developers who want to
read the security model, not guess at it.

> **Live demo:** _not deployed yet — replace this line with the URL after the
> first deploy._
>
> **Screenshot:** _add `docs/screenshot.png` (login → `/me` → audit log is a
> good three-panel shot) and embed it here._

**Status:** active development. The RBAC, auth, users, roles, and audit modules
are implemented and tested, and the API is documented with OpenAPI 3.1 +
Swagger UI at `/docs`. Frontend and several deferred flows are tracked in
[ROADMAP.md](ROADMAP.md).

---

## Stack

| Concern      | Choice                                                        |
| ------------ | ------------------------------------------------------------- |
| Runtime      | Node.js 22+, ES modules, TypeScript in strict mode            |
| HTTP         | Express 5                                                     |
| Database     | PostgreSQL 16                                                 |
| Data access  | Drizzle ORM + drizzle-kit migrations                          |
| Validation   | Zod 4 (`z.object(...).strict()` at every request boundary)     |
| API docs     | OpenAPI 3.1 + Swagger UI, generated from the same Zod schemas   |
| Passwords    | argon2id                                                      |
| Sessions     | Opaque token, SHA-256 hash at rest, `httpOnly` cookie          |
| Logging      | pino + pino-http, with cookie/authorization redaction          |
| Tests        | Vitest + Supertest against a real Postgres                    |
| Hardening    | helmet, CORS allowlist, per-IP login rate limit               |

No JWT, no ORM magic, no soft-delete flags. The reasons are in
[docs/decisions/](docs/decisions/).

---

## Quickstart

Prerequisites: **Node 22+**, **npm**, **Docker**.

One-time setup:

```bash
cp .env.example .env && cp .env.test.example .env.test && npm install
```

Then, from `backend/`:

```bash
docker compose up -d     # Postgres — dev on :5432, test on :5433
npm run db:migrate       # apply migrations to the dev database
npm run seed             # demo school + one user per role
npm run dev              # API on :3000, Swagger UI at http://localhost:3000/docs
npm test                 # Vitest + Supertest against the test database
```

`npm test` starts and stops the `db-test` container itself; it leaves the dev
database running. The test database is tmpfs-backed, so every run starts from
an empty database and applies migrations from zero.

Other useful commands:

| Command                | What it does                                      |
| ---------------------- | ------------------------------------------------- |
| `npm run check`        | ESLint + `tsc --noEmit`                           |
| `npm run db:generate`  | Generate a migration after a schema change        |
| `npm run db:studio`    | Drizzle Studio                                    |
| `npm run docs:openapi` | Rewrite the committed `docs/openapi.json`          |
| `npm run test-coverage`| Coverage report (needs `npm i -D @vitest/coverage-v8` first) |

---

## Demo logins

`npm run seed` is idempotent. Every demo user shares the value of
`SEED_PASSWORD` (the example env file uses `demo-password-1234`).

| Role      | Log in with             | Notes                                      |
| --------- | ----------------------- | ------------------------------------------ |
| Owner     | `owner@demo.test`       | Full permission catalogue; owner role locked |
| Principal | `principal@demo.test`   | Staff, roles, audit — no permission editing |
| Teacher   | `teacher@demo.test`     | `school:read` only                          |
| Guardian  | `guardian@demo.test`    | `school:read` only                          |
| Student   | `jss1-2026-001`         | Username only — email login is the only login path today, so this account cannot sign in yet ([ROADMAP](ROADMAP.md)) |

Login is email + password only; school selection happens after authentication
when a user has more than one active membership.

---

## API documentation

- **Swagger UI:** <http://localhost:3000/docs> (on by default outside production)
- **Raw spec:** `/openapi.json`
- **Committed spec:** [docs/openapi.json](docs/openapi.json), regenerated with
  `npm run docs:openapi`
- **Off switch:** set `DOCS_ENABLED=false` (defaults to off in production).

The spec is generated from the same Zod schemas the routes parse, via
`@asteasolutions/zod-to-openapi`. Request schemas live in each module's
`schema.ts`; response schemas and path registration live in
`src/modules/*/openapi.ts`; the single registry is `src/openapi/registry.ts`.

Cookie auth: Swagger UI's Authorize button cannot set cookies, but `/docs` is
served from the API origin — call `POST /auth/login` with Try it out first, then
authenticated calls carry the `session` cookie. Each operation's description
states the required permission and the rank rule that applies.

Two tests keep the docs honest: one asserts the document contains exactly the
mounted paths and that `/docs` is served with a docs-only CSP, and a contract
suite parses real responses against the documented schemas.

---

## Where to read next

| Document                                          | What it answers                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)                | Request journey, layer rules, permission/rank/scope model, ERD          |
| [SECURITY.md](SECURITY.md)                        | Threats, the defence for each, and the test that proves it              |
| [TESTING.md](TESTING.md)                          | How to run the suite, what each folder covers, which tests to read      |
| [EXTENDING.md](EXTENDING.md)                      | Adding a permission or an endpoint, step by step                        |
| [ROADMAP.md](ROADMAP.md)                          | What is deferred and why                                               |
| [docs/decisions/](docs/decisions/)                | Seven ADRs: tenancy, sessions, ranks, audit, no soft deletes, `citext`  |
| [NOTES.md](NOTES.md)                              | Working notes and the retrospective behind the decisions                |

---

## API surface today

```
POST   /auth/login              POST   /auth/logout
POST   /auth/change-password    GET    /me
GET    /health

GET    /users                   POST   /users
GET    /users/:id               PATCH  /users/:id
POST   /users/:id/roles         DELETE /users/:id/roles/:roleId
POST   /users/:id/reset-password
POST   /users/:id/suspend       POST   /users/:id/reactivate

GET    /roles                   PUT    /roles/:id/permissions
GET    /audit-log
```

Every school-scoped endpoint takes its school from the session, never from the
request. Cross-school IDs return the same `404` as nonexistent ones.
