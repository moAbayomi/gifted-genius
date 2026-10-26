# 0003 — Server sessions, revoked by deleting the row

**Status:** accepted

## Context

The portal needs instant revocation (suspend a user, reset a password, sign out
a device), multiple devices per user, and a session that is always scoped to
one school. A stateless token cannot be un-issued; a denylist reintroduces the
database lookup it was meant to avoid, and adds a second source of truth that
can fail open.

## Decision

Sessions are rows. Login creates a random 32-byte token, returns it in an
`httpOnly` cookie, and stores only its SHA-256 hash in `sessions`. The raw
token is never persisted. A session row is valid; no row means invalid.

`sessions.active_membership_id` is `NOT NULL`, with a composite FK
`(active_membership_id, user_id) → memberships(id, user_id)`. A session can
therefore never point at another user's membership, and every session has a
school from the moment it exists. Revocation is a `DELETE`:

| Event                   | Rows deleted                                         |
| ----------------------- | ---------------------------------------------------- |
| Logout                  | the current session                                  |
| Password change         | all of the user's sessions except the current one     |
| Membership suspended    | sessions whose `active_membership_id` is that row     |
| User suspended / deleted| all of the user's sessions (user delete cascades)     |
| Session expired         | filtered out in SQL; physical cleanup is deferred     |

`requireAuth` resolves the token hash against `sessions`, joins the active
membership and school, and rejects the request if the user, membership, or
school is not active. Suspension therefore takes effect on the **next
request**, with no token blacklist to maintain.

## Alternatives considered

- **JWT.** No instant revocation, no per-school active membership without
  encoding it and re-issuing on switch, and "logout everywhere" needs a
  denylist — which is this table with worse ergonomics.
- **JWT + denylist.** Two stores, one of which can be stale. A stolen token
  works until the denylist is consulted; here, a deleted row cannot work.
- **Signed cookie carrying the session.** Same revocation problem; signing
  adds nothing once the database is authoritative.
- **Soft-revoked sessions (`revoked_at`).** Every query must remember the
  filter; forgetting it silently re-enables revoked sessions. Deletion makes
  the query itself the security check.

## Consequences

- Every authenticated request performs a session lookup (plus permissions and
  rank, three queries total). That cost buys immediate revocation; it is
  measured and acceptable at this scale.
- Expired rows are filtered, not reaped. A cleanup job is deferred; the index
  on `expires_at` is ready for it.
- `sessions_membership_user_fk` uses `ON DELETE RESTRICT`, so a membership
  cannot be hard-deleted while a session references it. The app must revoke
  first. This is intentional: it makes the missing step a loud error.
- Revocations are not a separate event type in the audit log today: the action
  that caused them (`user.password_reset`, `membership.suspended`, …) is the
  audited event. Logout is not audited, to avoid noise. A dedicated
  `session.revoked` entry with a reason and count is sketched in `NOTES.md` and
  remains an option if device-level history is needed.
- A stolen cookie can read and act until the session is revoked or expires.
  Requiring the current password to change a password limits the damage; the
  session still cannot escalate privileges.
