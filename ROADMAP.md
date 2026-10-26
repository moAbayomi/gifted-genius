# Roadmap

What is done, what is deliberately not done yet, and what would make each
deferred item worth doing. Dates are intentionally absent; order is the plan.

**Done:** schema and migrations, composite-FK tenancy, session auth, RBAC
(permissions, per-school roles, rank, delegation), users (invite, list, update,
reset, suspend, reactivate, role add/remove), roles (list, permission editing),
audit log (append-only, transactional, school-scoped, cursor-paginated), seed,
test suite, OpenAPI 3.1 + Swagger UI generated from Zod, and the docs in this
repository.

---

## Before the first deploy

| # | Item | Why it is not done | Done looks like |
| - | ---- | ------------------ | --------------- |
| 1 | **`git init` and a first commit** | The project grew in a single working directory. There is no history, no diff to review, and no safe rollback — this is the one item that blocks everything else. | A repository, a first commit, and a remote. Deploy platforms build from it. |
| 2 | **Production start path** | `npm start` runs `tsx`, which is a dev dependency, and `tsc` emits `dist/src/index.js`. A runtime install with `--omit=dev` cannot start the app. | `build` produces `dist/`, `start` runs compiled JS with production dependencies only, `engines.node` is declared. |
| 3 | **Migrations on deploy** | `drizzle-kit migrate` is a build-time tool and nothing runs it against the production database. A fresh database has no tables while `/health` still reports `ok`. | A pre-deploy/release command runs migrations; `/health` checks the database connection. |
| 4 | **Cookie/CORS decision for the real domains** | The session cookie is `sameSite=lax` and `secure` only when `APP_STAGE=production`. If the frontend and API live on different registrable domains, the browser will not send the cookie. | API and app on one site (e.g. `api.example.com` + `app.example.com`), exact `ALLOWED_ORIGINS`, and a verified login from the deployed frontend. |
| 5 | **Hosting choice** | Not a code problem. Single Node process + Postgres does not need AWS. | A platform with managed Postgres and a persistent process (Render, Fly, Railway). A Dockerfile keeps the option open for ECS/App Runner later. |
| 6 | **CI** | There is no pipeline, so `npm run check` and `npm test` are conventions, not gates. | CI runs lint, typecheck, and the integration suite against a Postgres service. |
| 7 | **Graceful shutdown** | The server never closes the pool and has no `SIGTERM` handling; a platform restart drops in-flight requests. | `SIGTERM` stops accepting connections, drains, closes the pool. |

---

## Documentation surface

**Done:** OpenAPI 3.1 + Swagger UI are generated from the same Zod schemas the
routes parse (`src/openapi/registry.ts`, `src/modules/*/openapi.ts`), served at
`/docs` and `/openapi.json` behind `DOCS_ENABLED`, with the spec committed at
`docs/openapi.json`. The docs-only CSP relaxation, a path-coverage test, and a
response-contract test are in place.

Still deferred:

| Item | Why deferred | Done looks like |
| ---- | ------------ | --------------- |
| **Response validation** | Parsing every response adds cost and surfaces drift loudly. The contract test parses representative responses instead. | Critical endpoints (auth, users, audit) parse responses through their Zod schema in every environment, so docs cannot lie silently. |
| **Uniform success envelopes** | Changing `{ ok: true }`, `{ data, page }`, bare objects, and the login union would break clients for cosmetic gain. The current shapes are documented explicitly instead. | A documented decision: either standardise on one envelope at the next breaking version, or keep per-endpoint shapes. |
| **Docs in production** | Docs default off in production and there is no gate other than the flag. If they should be reachable publicly, that needs a deliberate decision. | `DOCS_ENABLED` set intentionally, optionally behind auth or on an internal hostname. |
| **README screenshot / live URL** | Nothing is deployed and there is no frontend to screenshot yet. | The placeholders at the top of `README.md` replaced with a real URL and image. |

---

## Auth and account lifecycle

| Item | Why deferred | Done looks like |
| ---- | ------------ | --------------- |
| **`POST /auth/switch-school`** | The login flow can select a school at sign-in; there is no in-session switch. `NOTES.md` describes it but no endpoint exists. | A switch endpoint that validates an active membership for the same user, rotates the session's `active_membership_id` (or issues a new session), and audits the switch. |
| **Forgot password** | Needs email delivery. Until then, multi-school users who forget a password cannot be helped by any school's admin (admin reset is blocked for shared accounts) and go to support. | Token-based self-service reset with a short TTL, single use, session revocation, and an audit row. |
| **Email invitations and verification** | Needs email infrastructure. It also closes the `POST /users` enumeration leak: the response becomes identical whether the email exists. | Invite emails; `email_verified_at` populated; temp passwords never appear in an API response. |
| **Username login for students** | Student accounts are created username-only but `/auth/login` accepts email only. The demo student is deliberately visible as a gap. | `identifier` login (email or `schoolSlug` + username), same timing and enumeration defences. |
| **Sign out everywhere** | Logout and password change revoke sessions, but there is no explicit "all devices" endpoint. The service primitive (`deleteSessionsForUser` with no exception) exists. | `POST /auth/logout-all`, audited, current session optional. |
| **User-level suspension** | Only memberships are suspended. `users.status` exists but no admin action sets it to `suspended`; suspending at one school must not silently log the person out everywhere. | A deliberate platform-level action, separate from membership suspension, with audit and session revocation. |
| **Expired session cleanup** | Expired rows are filtered on read, so correctness does not depend on it. Disk hygiene can wait. | A scheduled `DELETE FROM sessions WHERE expires_at < now()`, or a job, with an audit counter. |
| **Per-account login throttling** | The limiter is per IP, so distributed attempts against one email are not slowed. The current limit is enough for a demo, not for a public launch. | A second limiter keyed by normalised email (or a backoff table), plus alerting. |
| **CSRF strategy if cross-site** | `sameSite=lax` blocks cross-site state-changing requests today. That stops being sufficient if the cookie becomes `sameSite=none`. | A CSRF token (double-submit or synchroniser) applied to mutating routes, or a documented same-site deployment constraint. |

---

## Users, roles, and ownership

| Item | Why deferred | Done looks like |
| ---- | ------------ | --------------- |
| **Tests for `PATCH /users/:id`** | The route exists but has no tests, so the shared-account guard on email change and the username-taken path are unproven. | Happy path, duplicate username (`409`), multi-school email change (`409 SHARED_ACCOUNT`), cross-school target (`404`). |
| **Password-change negative tests** | Success path and `mustChangePassword` clearing are tested; wrong current password and "other sessions revoked" are not. | Tests for `401 INVALID_PASSWORD`, `400 SAME_PASSWORD`, and a second session becoming invalid. |
| **Transfer ownership** | Only an owner can remove an owner role and strict rank prevents acting on a peer, so ownership cannot move. The last-owner lock and count exist for this future path. | `POST /schools/transfer-ownership` with both-side validation, lock, audit, and a concurrency test. |
| **Last-owner concurrency test** | Timing-based tests are slow and flaky; the guard is unreachable through the API today (see `SECURITY.md` row 8). | Two concurrent removals under `FOR UPDATE`; one succeeds, one fails, at least one owner remains. |
| **Custom roles** | Roles are per school and editable in permissions, but there is no create/delete role endpoint. Five system roles cover the MVP. | Create/delete a non-system role, rank assignment within allowed bounds, and guards so a custom role cannot outrank its creator. |
| **User/membership deletion + NDPA erasure** | The append-only trigger forbids the `UPDATE` that anonymisation needs. Deciding this badly would either break the audit guarantee or the erasure obligation. | A deliberate erasure design: either a controlled trigger disable for anonymisation with an audit record of the erasure itself, or a separate tombstone/identity-severance model. Documented, tested, and reflected in `ADR 0006`. |
| **Audit retention policy** | Append-only is not the same as "keep forever". A retention period needs a legal/product decision and a privileged maintenance path. | Documented retention, export, and a maintenance procedure that is itself audited. |

---

## Students and the product surface

| Item | Why deferred | Done looks like |
| ---- | ------------ | --------------- |
| **`students` table** | `src/db/schema/students.ts` exists but is not exported from `src/db/schema/index.ts`, so drizzle-kit never generated it. It is not used by any route. | Export it, generate and review the migration, add the school-scoped composite FK and admission-number uniqueness tests, and build the enrollment endpoints. |
| **Enrollment and fees** | These features will force the open permission question: a principal currently cannot assign the guardian role if guardian gains `fees:pay`, because the principal does not hold it. | A product decision: give the principal the permission, or add a structural role-assignment path. Then add the permissions and migrations. |
| **Frontend** | This repository is the backend. The multi-school picker, role switcher, and audit views have no client yet. | A client that uses `/me`, the login union, and the audit cursor correctly; the README gains a screenshot. |

---

## Engineering hygiene

| Item | Why deferred | Done looks like |
| ---- | ------------ | --------------- |
| **Remove the test-only `/protected` route** | `tests/integration/auth/login.test.ts` uses it to prove `mustChangePassword` blocks feature routes. It is mounted in the real app. | A test-only route defined in the test app, or a test fixture router; `app.ts` exposes only real routes. |
| **Consolidate duplicated code** | `assignRoleSchema` exists in both users and roles schemas (users' copy unused), `pathParam` is duplicated, `findUserByEmail` exists in two repositories. Harmless now; will matter for the OpenAPI registry. | One schema per concept, one shared helper per pattern, imports from the owning module. |
| **`env.ts` cleanup** | The dev-load mismatch is fixed. Remaining: `custom-env` has no types, `DATABASE_URL_DIRECT` is unused, `ALLOW_DEMO_SEED` parse is awkward, `isTest`/`isDev` are unused. | A typed env module, no unused keys, one source for stage booleans. |
| **Lint warnings** | `npm run lint` passes with warnings (`no-console`, unused imports in `express.d.ts`). Warnings are allowed to stay so the build is not blocked. | Zero warnings, or explicit ignores with reasons; `no-console` allowed only in scripts. |
| **Repository tidying** | `src/.DS_Store` and an empty `src/shared/types` file are in the tree; there is no `.nvmrc`/Dockerfile. | Ignore OS files, remove empty files, pin Node, add a Dockerfile. |
| **Dependency audit and scanning** | No CI, so no `npm audit`/Dependabot/container scan. | Automated dependency updates and a scan gate. |
| **Observability** | pino logs requests and redacts secrets; there is no error tracker, metrics, or uptime monitor. | Error tracking with request IDs, a basic dashboard (latency, 5xx, login failures), and an alert on repeated `RATE_LIMITED`. |

---

## Explicit non-goals (decided, not deferred)

These are settled; revisit only if the stated trigger happens.

- **JWT instead of server sessions.** Revisit if horizontal scale makes the
  session lookup the bottleneck, or if a third-party API needs stateless
  tokens. Revocation would have to be solved again.
- **Soft deletes.** Revisit only if "undo a deletion" becomes a product
  requirement.
- **`citext`.** Revisit never, unless a case-insensitive type is needed beyond
  email and the expression-index pattern becomes unmanageable.
- **A database per school.** Revisit only if a customer requires physical
  isolation for compliance.
