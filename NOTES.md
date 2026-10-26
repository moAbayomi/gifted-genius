# Notes

Working notes recorded during the build: the trade-offs as they were made, then
a retrospective written after auth, RBAC, users, roles, and audit were
finished. For the system overview see [ARCHITECTURE.md](ARCHITECTURE.md); for
deferred work see [ROADMAP.md](ROADMAP.md).

## Retrospective

### What was harder than expected

**Multi-tenancy turned out to be a schema problem, not a service problem.** The
first version checked `schoolId` in every service. It read correctly and was
still the wrong shape: a single missed check, a seed script, or a future route
would write a cross-tenant pair. Moving the guarantee into composite foreign
keys took longer than the service checks did, but it changed the question from
"did we remember?" to "can the database even store this?". The cost is
redundant `school_id` columns and a set of unique constraints that exist only
to make FKs possible. Worth it.

**Session semantics were subtler than expected.** The hard part was not hashing
or cookies; it was deciding what "revoked" means, what happens to sessions when
a membership is suspended versus a user, and how a multi-school login picks an
active membership without inventing a state where a session exists without a
school. `active_membership_id NOT NULL` plus a composite FK to
`memberships(id, user_id)` removed a whole class of edge cases. Deletion as
revocation removed another: the security check became the query itself, rather
than a filter every future query must remember.

**Status codes are a design surface.** It is tempting to let a missing row
surface as a 500 because that is what `one()` does. Writing down the rule —
user-supplied IDs get a 404, invariants use `one()` — made the API honest and
closed the cross-school probing leak at the same time: a row outside your
school produces the same 404 as a row that does not exist.

**The last-owner invariant is more interesting than it looks.** The
read-then-write race is real, so there is a `SELECT ... FOR UPDATE` on the
school. But the guard is effectively unreachable through the API: only an owner
can remove an owner role, and strict rank means an owner cannot act on another
owner (or on themselves). The self-check fires first, and that is what actually
protects the last owner. The lock and the owner count are there for ownership
transfer and a future super-admin; the endpoint-level test is skipped with that
explanation rather than pretending the guard is exercised. Writing that down
was more valuable than adding a timing-based concurrency test for a path no
user can reach.

**Keeping the permission catalogue and per-school grants in sync is a
migration problem.** Adding a permission to code does not grant it to existing
schools, by design — a live tenant should not silently gain a capability
because someone deployed. That decision is right, and it means every new
permission has a code change, a default-role change, and sometimes a data
migration. Renaming is worse: the database stores strings, so migrate before
deploying the rename or the grants become silent no-ops.

### What paid off

- **Pure predicates.** `can`, `canManageMember`, and `canAssignRole` take plain
  objects and are exhaustively unit-tested. The integration tests then only
  need to prove the wiring and the data loading.
- **Audit in the same transaction.** It made every service signature honest
  (`tx` first) and removed a class of "the change happened but the record did
  not" bugs before they could exist.
- **The permission matrix.** One table row per route, one generated test per
  role. It is the cheapest regression net in the project.
- **Real database tests.** Constraint tests cannot be written against a mock.
  The composite-FK tests are the ones that would have caught a tenancy bug that
  all the service tests missed.
- **Writing constraints down before writing services.** The `MATCH SIMPLE`
  trap in `audit_log` (an actor with a NULL school would skip the composite FK)
  was caught at schema time because the invariant was written as a sentence
  first.

### What I would do differently

- **Mount every router in one place and test through `buildApp()`.** Three
  routers existed, passed their tests, and were not mounted in `app.ts`. The
  tests assembled their own Express apps, so the real app 404'd. The fix is
  structural: one router tree, used by the app, the tests, and (later) the
  OpenAPI document.
- **Put the request schemas where the docs can find them from day one.** Auth
  schemas are inline in `auth/routes.ts`; reset-password is inline in
  `users/routes.ts`. That is fine until the OpenAPI work needs a single
  discoverable schema per endpoint, at which point it becomes a refactor.
- **Initialise git before the first line of code.** There is no repository yet,
  which means no history, no diffs to review, and no safe way to experiment.
  This is the one piece of process debt that affects everything else.
- **Make the dev environment a five-command story early.** `.env` and
  `.env.test` were local-only with no examples, and the dev env loader had a
  one-word mismatch that made `npm run dev` fail on a fresh checkout. The
  README now has the commands; they should have existed before the first module.
- **Write the threat table while the tests are fresh.** Reconstructing "which
  test proves this?" afterwards is slower and tempts you to overstate.

### Surprises

- `citext` was not needed. A `lower(email)` unique index plus one normalisation
  function covered every case, with no extension to install on Neon or CI.
- Expired sessions can simply be filtered out in SQL; no job is required for
  correctness, only for disk hygiene.
- A username-only student account is creatable but cannot log in yet, because
  login is email-only. The seed creates one anyway, which makes the gap visible
  in the demo data instead of hiding it.
- The append-only audit trigger and the NDPA erasure plan in these notes are in
  direct tension: erasure wants to `UPDATE` the actor identity, the trigger
  forbids `UPDATE`. That needs a deliberate decision, not a workaround in a
  service.

---

# Session lifecycle

## Approach: hard-delete (no soft-delete)

Sessions are **deleted**, not marked revoked. A row in `sessions` is a valid
session; no row means invalid. Rationale:

- No `revoked_at IS NULL` filter to remember in every query — the security
  check is the query itself.
- History belongs in `audit_log`, not in the sessions table.
- The composite FK `sessions_membership_user_fk ON DELETE RESTRICT` already
  enforces "delete sessions before hard-deleting a membership."

## Revocation triggers

| Event                            | SQL                                                                                         | Notes                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Logout (single device)           | `DELETE FROM sessions WHERE token_hash = ?`                                                 | The current session only                       |
| Password change                  | `DELETE FROM sessions WHERE user_id = ? AND id != ?`                                        | Keep current device logged in                  |
| "Sign out everywhere" (explicit) | `DELETE FROM sessions WHERE user_id = ?`                                                    | All devices, current included                  |
| User suspended                   | `DELETE FROM sessions WHERE user_id = ?`                                                    | User-level status change, all schools          |
| Membership suspended             | `DELETE FROM sessions WHERE active_membership_id = ?`                                       | One school only; other-school sessions survive |
| User hard-deleted                | Cascade via `sessions_user_fk ON DELETE CASCADE`                                            | Automatic                                      |
| Membership hard-deleted          | Blocked by `sessions_membership_user_fk ON DELETE RESTRICT` — session must be deleted first | Enforced by DB, not app                        |

**Every revocation writes an `audit_log` row** with `action = 'session.revoked'`,
`target_type = 'user'`, `target_id = userId`, `metadata: { reason, count }`.
Logout alone may be omitted if you find it noisy; password change, suspension,
and admin "sign out everywhere" must be audited.

## Atomicity

Status changes and session deletion happen in **the same transaction**:

```ts
await db.transaction(async (tx) => {
  await tx.update(users).set({ status: "suspended" }).where(eq(users.id, userId));
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.insert(auditLog).values({ /* session.revoked */ });
});




## Login flow (invisible multi-tenancy)

Users log in with email + password only. No school slug, no picker.

1. Verify password → user row
2. Query: `SELECT * FROM memberships WHERE user_id = ? AND status = 'active'`
3. Auto-select the membership:
   - 1 result → use it
   - 2+ results → use the one from the user's most recent session
     (fallback: oldest active membership)
   - 0 results → reject login: "Your account is not currently active at any school"
4. Create session with `active_membership_id = selected.id` (NOT NULL)

### `POST /auth/switch-school`
**Status: not implemented.**
Schema supports it — `sessions.active_membership_id` is a mutable column.
A route that verifies the actor owns the target membership and updates
the session column would be ~20 lines. Multi-membership users (teachers
at two schools, teacher-parents) currently have to log out and log back
in to switch schools. Add when the first multi-school user asks.## Registration (self-serve owner)

`POST /auth/register-owner` is atomic. One transaction:

user → school → owner membership → owner role (with permissions) → session

`active_membership_id` is never NULL because the membership is created
in the same transaction as the session.

## Invited users

Invite creates membership (no session). User sets password, then logs in
normally. Session is created with `active_membership_id` set from the
membership that already exists. No session before membership, ever.

## Why NOT NULL

With `active_membership_id` NOT NULL:
- No "authenticated but no school" state for requireAuth to handle
- Every session is provably scoped to a membership belonging to the user
  (composite FK enforces this — no MATCH SIMPLE skip)
- Fewer edge cases, fewer tests, fewer bugs

Reversible later if needed (NOT NULL → nullable is one migration, no data risk).



## Audit log retention and NDPA erasure

`audit_log` is append-only (trigger `audit_log_no_change` blocks all
UPDATE and DELETE). Rows, once written, cannot be mutated through normal
DML — this is enforced at the database level, not by code discipline.

**Policy: audit logs are retained under NDPA's "legal obligation" and
"legitimate interest" grounds. They are exempt from automated erasure
requests.**

This is standard practice. The audit log contains identifiers (user ID,
email) but not sensitive personal data — passwords, tokens, and secrets
are stripped at write time via `redactUser` / `redactSchool` / etc.
before the row ever hits the DB.

**What an erasure request actually means for audit data:** nothing, by
default. The rows stay. They prove "who did what," which is a legal
obligation, not an optional feature.

**If erasure is legally mandated** (regulatory order, court ruling,
specific user request approved by legal): anonymize the affected rows.
Do NOT delete them — deleting breaks the timeline. Scrub only the
identity, keep the event.

```sql
-- Requires elevated DB privileges. Cannot be called from app code
-- (db.update() cannot disable triggers). Postgres logs this under
-- log_statement = 'ddl'.

BEGIN;
ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_change;
UPDATE audit_log
   SET target_id = NULL,
       before  = jsonb_build_object('redacted', true),
       after   = jsonb_build_object('redacted', true),
       metadata = jsonb_build_object('via', 'ndpa_erasure')
 WHERE target_id = '<user-id>';
ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_change;
COMMIT;


## canAssignRole is intentionally conservative

Rule: role.rank < actor.rank AND role.permissions ⊆ actor.permissions.

Consequence: principal (rank 80, no fees:pay) cannot assign guardian role
(rank 25, has fees:pay) because principal doesn't hold fees:pay.

This is deliberate for MVP — you can't grant a capability you don't have.
When enrollment ships, either give principal fees:pay (if "principal can
record fees" is true in product terms) or introduce a separate
structural-role-assignment path for cross-chain roles. Note the friction
and decide then.


## `one()` vs `[x] = ...; if (!x)` — status code discipline

`one()` (from `shared/utils/assert.ts`) throws a plain `Error` when the array
is empty. That plain error becomes a 500 via the global error handler — the
wrong status code for "row not found."

Use `one()` ONLY for rows that must exist by your own logic:
  - `.insert(...).returning()` — you just inserted it
  - References from a row you already validated (session.userId → user)
  - Aggregates that always return one row (MAX, COUNT)

Use destructuring + 404 for ANY row looked up by user-supplied id:
  const [row] = await db.select()...where(eq(id, requestId));
  if (!row) throw new AppError(404, "NOT_FOUND", "...");

Rule of thumb:
  - If a request supplied the ID → destructure + 404
  - If your code's invariants guarantee existence → one()

Why this matters: a mistyped or deleted ID in a request should get a 404
("not found"), not a 500 ("server error"). A 500 also fires the on-call
alerts and files a bug report — for what is actually a normal "you asked
for something that doesn't exist" situation.

Bonus: this also closes the id-probing leak. With the school in the WHERE
(e.g. `WHERE id = X AND school_id = actor.schoolId`), a cross-school ID
returns the same 404 as a nonexistent one. The 404 is truthful (from the
caller's vantage point, that row isn't there) AND doesn't leak that the
row exists in another tenant.

See also:
  - `assertCanActOnUser` / `assertCanAssignRole` — destructure + 404
  - `resetUserPassword` / `suspendUser` — assert first, then one() (safe)
  - `findSessionByToken` — returns null, caller decides


  ## Last-owner invariant requires a lock under concurrency
  
  The "cannot remove the last owner" check is a read-then-write:
    SELECT COUNT(*) owners → if count > 1, DELETE
  
  Under concurrent transactions, this races:
    - T1 reads count = 2
    - T2 reads count = 2
    - T1 deletes 1 → count = 1
    - T2 deletes 1 → count = 0  ← BUG
  
  Fix: acquire a row-level exclusive lock on the school BEFORE the count
  query, so concurrent owner modifications on the same school serialize.
  
    await tx.select().from(schools).where(eq(schools.id, schoolId)).for("update");
    // ... then count ... then delete ...
    // lock released when tx commits or rolls back
  
  Apply the lock ONLY when modifying the owner role. Regular role changes
  (assign teacher, remove guardian) don't have a "last X" invariant and
  don't need the lock — locking the school row would serialize all role
  operations unnecessarily.
  
  Where:
    - removeRoleFromMembership — when role.key === "owner"
    - suspendUser — when target has the owner role (add when implemented)
    - transferOwnership (future) — lock both schools
    - deleteUser (future) — when target is the last owner
  
  Testing the lock requires concurrent transactions and timing-based
  assertions — hard and slow. Defer until you have real concurrency.
  The lock is cheap to add and correct by construction; skip the test
  for MVP.

  ## Password reset: shared accounts are admin-blocked
  
  Multi-school users (teachers at two schools, teacher-parents at the same school,
  etc.) cannot have their password reset by any school's admin. Doing so would
  allow School A's admin to take over the account at School B.
  
  Consequence: if a multi-school user forgets their password, they need the
  email-based self-service reset flow. That flow does not exist yet. Until it
  does, forgotten-password requests from multi-school users go to support
  (manual DB password update).
  
  This is a real UX gap for multi-school users. It closes when
  POST /auth/forgot-password ships.

  ## POST /users: email enumeration via temp-password presence (known, low-severity)
  
  Response differs for new vs. existing users:
    - New user: { user, temporaryPassword: "..." }
    - Existing user: { user }  ← no temp password
  
  This leaks to the caller (an admin with users:create) whether an email
  is registered anywhere on the platform.
  
  Severity: LOW. Requires an authenticated admin who is already inviting the
  target. The information gained ("this email is a customer") is not a
  security compromise on its own.
  
  Fix: switch to email-based invitations. Response becomes identical for
  both cases ({ user, status: "invited" }), the temp password is delivered
  only via email to the target, and the caller learns nothing from the
  response.
  
  When to fix: when email infrastructure exists (before public launch).
  Not before. This is a known tradeoff, not a bug.


  ## POST /users: concurrent same-email race (deferred)
  
  If two requests with the same brand-new email arrive simultaneously:
    - Both run findUserByEmail → both get null
    - Both try INSERT users → one succeeds, one gets 23505 → 500
  
  Consequence: the losing request's client sees 500 (unknown error). Retry
  produces 409 ALREADY_MEMBER (correct state was created by the winner).
  No data corruption, no security issue, no partial state — the transaction
  rolls back.
  
  Realistic trigger: admin double-clicking the invite button (React forms
  without disabled={isSubmitting} send 2 POSTs). Not that rare in practice,
  but the consequence is a confusing status code, not a bug.
  
  Fix when it hurts: use onConflictDoNothing() on the user insert, load
  the existing row on conflict, treat it as "existing user" branch. See
  insertUserOrGetExisting pattern. ~30 lines total including a test.
  
  Mitigation while deferred (cheap): disable the submit button during
  submission on the invite form. That alone makes double-click-induced
  races go away. No server changes needed.


  ## Planned but not implemented
  
  The following are described elsewhere in these notes as if they exist.
  They do not. Do not build on them without implementing them first.
  
  ### `POST /auth/switch-school`
  **Status: not implemented.**
  Schema supports it — `sessions.active_membership_id` is a mutable column.
  A route that verifies the actor owns the target membership and updates
  the session column would be ~20 lines. Multi-membership users (teachers
  at two schools, teacher-parents) currently have to log out and log back
  in to switch schools. Add when the first multi-school user asks.
  
  ### Session cleanup job
  **Status: not implemented.**
  Expired sessions are filtered by `findLiveSession` (they return null and
  can't be used). But the rows are never DELETEd from the DB — they
  accumulate. `sessions_expires_at_idx` exists for a cleanup job that was
  planned but never built.
  
  At current scale this is invisible. Add a nightly cron
  (`DELETE FROM sessions WHERE expires_at < now()`) when the sessions
  table exceeds ~1M rows or when query performance on the sessions table
  starts degrading.
  
  ### User-level suspension
  **Status: not implemented.**
  `users.status` exists in the schema and `findLiveSession` checks it. No
  admin flow updates it. `suspendUser` only sets `memberships.status`.
  
  Consequence:
  - Membership suspension: blocks access to ONE school. Correct for a
    teacher leaving one school.
  - User-level suspension: blocks access to ALL schools. Required for
    abuse/security incidents. NOT IMPLEMENTED.
  
  To suspend an account platform-wide today, you'd have to either:
  - suspend each of the user's memberships one at a time via the API, or
  - manually `UPDATE users SET status = 'suspended' WHERE id = '<id>'` in
    the DB (the `findLiveSession` check will then fire)
  
  Add `POST /users/:userId/suspend-account` when platform-level abuse
  handling is needed. Distinct from the existing `POST /users/:id/suspend`
  which is membership-scoped.