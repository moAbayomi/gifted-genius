# 0005 — No soft deletes

**Status:** accepted

## Context

A `deleted_at` column is the default answer to "keep the data", and it leaks
into every query: every read must remember `deleted_at IS NULL`, every unique
index must decide whether deleted rows count, and every join must carry the
filter. One forgotten predicate exposes data. In this system, sessions also
need revocation semantics, which is the same question at a smaller scale.

## Decision

Rows are either present or gone. There is no `deleted_at` and no `is_deleted`.

- **Account state is not deletion.** A user is `active` or `suspended`; a
  membership is `active`, `inactive`, or `suspended`. Suspension is a status
  change with defined side effects (sessions revoked, access denied), not a
  tombstone.
- **Sessions are deleted, not marked revoked.** A valid session is a row; no
  row means invalid (ADR 0003).
- **Hard deletion is deliberately constrained.** `sessions` restrict deleting a
  membership; `audit_log` restricts deleting its actor; `schools` restrict
  deleting anything that still belongs to it. History belongs in `audit_log`,
  not in a growing graveyard of invisible rows.
- **Deletion of users and memberships is not implemented yet.** When it is, it
  will be an explicit, audited operation with the constraints above as its
  checklist.

## Alternatives considered

- **`deleted_at` on every table.** Familiar, but every query becomes
  conditional and every "forgot the filter" bug becomes a data leak. The
  failure mode is silent.
- **A separate archive schema.** Keeps hot tables clean but doubles the write
  path and makes restore a manual migration.
- **Event sourcing.** The audit log already provides the history that matters;
  full event sourcing is a much larger architectural commitment.
- **Soft-revoked sessions only.** Inconsistent with the rest of the model and
  reintroduces the filter-everywhere problem in the security-critical path.

## Consequences

- "Undo" is not a feature. A mistaken hard delete is recovered from a backup,
  not from a flag.
- Hard deletes must respect FK order: revoke sessions, then remove the
  membership; audit rows must be anonymised rather than deleted if the actor
  leaves (see ADR 0006).
- Unique constraints stay simple: a suspended user still occupies their email,
  which is correct — the person still exists.
- The audit trail outlives the rows it describes, by design. `target_id` is
  intentionally not a FK so history survives a deletion.
- Suspension semantics are explicit and testable: `requireAuth` rejects the
  next request, and `tests/integration/auth/require-auth.test.ts` proves it for
  membership, user, and school suspension.
- NDPA-style erasure is an open design question: anonymising audit rows
  conflicts with the append-only trigger (ADR 0006). Until that is resolved,
  erasure is a support process, not an endpoint.
