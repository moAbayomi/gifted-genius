# Security

The security model is layered, and every claim below points at the test that
exercises it. Where a defence is implemented but not yet tested, that is stated
rather than implied.

## Threat model

Who the system assumes can attack it:

- **An authenticated member of another school.** Holds a valid session, knows
  or guesses IDs, and tries to read or modify another tenant's rows.
- **A malicious or careless admin within a school.** Holds real permissions and
  tries to escalate beyond them, or to reach a peer/superior.
- **An anonymous attacker at the login form.** Tries to discover valid emails,
  guess passwords, or replay a stolen cookie.
- **Someone with a stolen session cookie.** Has a valid token but not the
  password.
- **A future maintainer.** Writes a query or a route that forgets a rule. The
  database constraints are the backstop for this one.

Out of scope for the current build: physical access, a compromised database
superuser (they can disable the audit trigger), supply-chain compromise, and
denial of service beyond the login rate limit.

## Threats and defences

| # | Threat | Defence | Test that proves it |
| - | ------ | ------- | ------------------- |
| 1 | **Cross-school ID probing** — use a guessed UUID to read or modify another school's member, role, or audit row | `school_id = actor.schoolId` is in the `WHERE` of every scoped query, so a cross-school row is indistinguishable from a missing one (`404`). Composite FKs reject mixed-tenant writes even if a service check is missed. | `tests/integration/rank.test.ts` → "cross-school target throws 404 (no id-probing)", "random UUID throws 404". `tests/integration/users/admin-actions.test.ts` → "returns 404 for a cross-school member id". `tests/integration/audit/list-audit-log.test.ts` → "isolates schools — demo owner never sees another school's audit rows". `tests/integration/school.test.ts` → "composite FK enforcement" (three directions). |
| 2 | **Role escalation by granting** — assign yourself (or an accomplice) the owner role, or a role carrying permissions you lack, then use them | `canAssignRole` requires the role's rank to be strictly below the actor's **and** every permission it grants to be held by the actor. The owner role's permissions are immutable. Permission editing applies the same subset rule, so you cannot build a role you could then assign. | `tests/unit/rbac/can.test.ts` → "principal cannot assign the owner role", "principal cannot assign a role holding a permission principal lacks". `tests/integration/roles/manage-roles.test.ts` → "refuses to grant a permission the actor does not hold (subset rule)", "refuses to edit the owner role's permissions". `tests/integration/users/create-user.test.ts` → "principal cannot invite an owner (rank too high)". |
| 3 | **Peer takeover** — act on someone at or above your rank (suspend a co-principal, reset an owner's password, edit a peer's role) | `canManageMember` requires **strictly** greater rank, so peers cannot act on each other; an actor with no roles (rank 0) can act on nobody. Self-targeting is rejected with a dedicated message. | `tests/integration/rank.test.ts` → "principal acting on another principal throws 403 (strictly above)", "principal acting on owner throws 403". `tests/integration/roles/manage-roles.test.ts` → "principal cannot edit the principal role (peer-rank check)". `tests/integration/users/create-user.test.ts` → "principal cannot invite another principal (peer rank)". `tests/integration/users/admin-actions.test.ts` → "rejects self-suspension", "rejects self-target with a helpful message". |
| 4 | **Takeover through a shared account** — School A's admin resets the password or changes the email of a person who is also at School B, taking over their School B identity | `assertNoOtherSchoolMemberships` refuses admin password reset and admin email change when the user has memberships elsewhere (`409 SHARED_ACCOUNT`). The person must use self-service, which requires the current password. | `tests/integration/users/admin-actions.test.ts` → "refuses to reset a multi-school user's password" (asserts `SHARED_ACCOUNT`). **Gap:** the email-change branch uses the same guard but has no integration test (there are no `PATCH /users` tests yet). |
| 5 | **User enumeration** — discover which emails are registered by comparing login responses | Every login failure returns the same `401 INVALID_CREDENTIALS` body; a suspended user gets the same response; no cookie is set and no session or audit row is created. | `tests/integration/auth/login.test.ts` → "returns 401 with generic message for a wrong password", "returns 401 with the SAME message for an unknown email", "returns 401 and creates no session when the user is suspended". **Known, documented gap:** `POST /users` reveals via `temporaryPassword` presence whether an email already exists. Low severity (requires an authenticated admin), tracked in `NOTES.md` and `ROADMAP.md`. |
| 6 | **Timing** — infer a valid email from a fast rejection (no hash to verify) versus a slow one | Unknown emails are verified against a fixed, real argon2id dummy hash, so the expensive work happens either way. | `tests/integration/auth/login.test.ts` → "timing: unknown email responds in similar time to wrong password" (asserts the gap is under 50 ms). |
| 7 | **Mass assignment** — send extra fields (`schoolId`, `status`, `passwordHash`, `roleKeys` on an update) and have them written | Every request body and query uses a Zod object with `.strict()`, so unknown keys are rejected. Services copy fields explicitly; no request object is spread into an insert. | `tests/integration/users/create-user.test.ts` → "rejects unexpected fields in the body (mass assignment)". `tests/integration/roles/manage-roles.test.ts` → "rejects unknown permission strings with 400". |
| 8 | **Last-owner race** — two requests concurrently remove owner roles, leaving the school with zero owners (or a single request orphan the school) | Two independent protections: (a) the self-check makes an owner unable to remove their own role, and no one outranks an owner, so the last owner's role cannot be removed through the API today; (b) when ownership transfer exists, `removeRoleFromMembership` takes a `SELECT ... FOR UPDATE` lock on the school before counting owners, serializing concurrent owner changes. | `tests/integration/users/admin-actions.test.ts` → "activeOwnerMembershipIds returns only the school's active owners" and its three exclusions (suspended membership, suspended user, role lost), plus "last-owner check counts only functioning owners". The endpoint-level test "refuses to remove the last owner role" is **skipped**, with a comment explaining that the self-check fires first; no concurrent-transaction test exists yet (deliberate, see `NOTES.md`). |
| 9 | **Stolen session cookie plus password change** — a cookie thief changes the password e-mail style, locking the real owner out | A password change requires the **current password**, not just a session. On success, every *other* session of that user is deleted; the current one stays. Admin resets delete all of the target's sessions and set `mustChangePassword`. Tokens are stored only as SHA-256 hashes in an `httpOnly` cookie. | `tests/integration/auth/login.test.ts` → "allows /auth/change-password when mustChangePassword is true", "clears mustChangePassword after a successful password change", "revokes the session and clears the cookie" (logout). `tests/integration/users/admin-actions.test.ts` → "resets a lower-ranked user's password and revokes their sessions". **Gap:** no test for a wrong `currentPassword`, and no test asserting that other sessions are revoked on self-service change. |
| 10 | **Stale privilege** — keep using a session after the role or permission that granted access is removed | `requireAuth` reloads permissions and rank on every request; nothing is cached in the session. | `tests/integration/roles/manage-roles.test.ts` → "removing users:read from principal role 403s principal's next request on same cookie", "adding users:read back re-enables principal's next request (no re-login)". |
| 11 | **Sensitive data in the audit trail or logs** — hashes, passwords, IPs, or cookies leaking into a readable response or a log line | Audit snapshots are field-picked through `redact*` helpers; IP and user agent are never returned by the audit endpoint. pino redacts `cookie`, `authorization`, and `set-cookie` (removed, not masked). | `tests/integration/audit/list-audit-log.test.ts` → "does not leak passwords, hashes, IPs, or user agents in the response". Log redaction is configured in `src/app.ts` and is not separately tested. |

## Defence in depth

For a tenant-scoped write, four independent checks must all allow it:

1. **Session** — a live row in `sessions`, with active user, membership, and
   school.
2. **Permission** — `requirePermission` at the route, plus the service-level
   capability check where one is needed.
3. **Rank and scope** — the service loads the target with `school_id` in the
   `WHERE` and requires a strictly higher rank.
4. **Database** — composite FKs reject a mixed-tenant row even if the first
   three are bypassed by a scripted path.

Sessions add three more properties: the token is unguessable and stored hashed;
the `active_membership_id` is `NOT NULL` and composite-FK'd to the session's own
user; and revocation is a row deletion, so a suspended account fails on its
next request.

## Known gaps

These are real, known, and deliberate for now — not overlooked:

- **`POST /users` email enumeration.** A response includes `temporaryPassword`
  only when a new user was created. Fix by moving to email invitations and
  returning the same body in both cases. Requires email infrastructure.
- **No CSRF token.** The session cookie is `sameSite=lax`, which blocks
  cross-site state-changing POSTs in modern browsers. This is the current
  defence; if the API and frontend ever become cross-site, `sameSite=none`
  needs a CSRF strategy alongside it.
- **Login throttling is per IP, not per account.** Distributed attempts against
  one email are not slowed. The limiter is also disabled when
  `APP_STAGE=test`.
- **Self-service password change** requires the current password and revokes
  other sessions, but the wrong-password and revocation paths are untested.
- **Expired sessions are not reaped.** They are filtered on read; a cleanup job
  is deferred. `sessions_expires_at_idx` exists for it.
- **Audit erasure is unresolved.** The append-only trigger blocks the `UPDATE`
  that NDPA-style anonymisation would need. See `ROADMAP.md`.
- **No dependency or container scanning** in CI yet (there is no CI yet).

## Reporting

This is a development project without a production deployment. If you find an
issue, open an issue in the repository (once it exists) or contact the
maintainer directly. Do not test against real school data.
