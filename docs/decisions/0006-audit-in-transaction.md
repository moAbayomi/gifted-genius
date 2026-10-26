# 0006 — Audit written in the same transaction

**Status:** accepted

## Context

An audit log that can disagree with the data is worse than none: it invites
false confidence. Writing after the business transaction commits means a crash
between the two loses the record. Writing asynchronously (queue, outbox worker)
means the log is eventually consistent — and "eventually" is exactly when an
investigation happens. Writing before the mutation means recording events that
may roll back.

## Decision

`recordAudit(tx, ...)` is called with the **transaction handle** of the
mutation it describes, never the base client. If the mutation rolls back, the
audit row rolls back with it. If the audit insert fails, the mutation fails
too. There is no code path that changes a row without its audit entry.

Snapshots are field-picked, never spread rows: `redactUser`, `redactSchool`,
`redactMembership`, and `redactRole` select safe fields, and password hashes,
tokens, IPs, and user agents never enter `before`/`after`. `metadata` carries
non-snapshot context (`via`, `roleKey`).

The table itself is append-only: `0001_audit_append_only.sql` installs a
trigger that raises on `UPDATE` and `DELETE`. This is a guard against
application bugs, not a defence against a database superuser (who can disable
it). Two constraints keep the actor honest:

- `audit_actor_school_fk` — if both actor and school are set, the actor's
  membership must belong to that school.
- `audit_actor_needs_school_chk` — an actor cannot be recorded without a
  school. Without it, `MATCH SIMPLE` would skip the composite FK when
  `school_id` is NULL.

## Alternatives considered

- **Database triggers for every table.** Complete capture, but triggers cannot
  see application intent (which action name, which actor membership, which
  metadata) without session variables, and they run regardless of whether the
  app considers the action audit-worthy.
- **Transactional outbox + async writer.** Survives process crashes and keeps
  writes fast, at the cost of a worker, a delivery guarantee, and lag. A
  reasonable future step; unnecessary at current volume.
- **Audit after commit.** Simple and wrong: a failure between commit and insert
  is silently unaudited.
- **Log lines as the audit trail.** Not queryable by entity, not immutable, and
  rotated away.

## Consequences

- Audit is on the critical path. An audit insert failure fails the user's
  request. That is deliberate: a change with no record is not allowed.
- Rows cannot be updated, so **erasure/anonymisation cannot be done with
  `UPDATE`** despite the plan in `NOTES.md`. NDPA erasure needs a deliberate
  path — disable the trigger for a controlled rewrite, or model erasure as a
  new audited fact. This is an open tension, recorded in ROADMAP.
- `target_id` has no FK because targets are polymorphic (`user`, `membership`,
  `role`, `school`); retention therefore does not cascade, which is the point.
- Reads are school-scoped and cursor-paginated. The cursor carries the
  microsecond-precision `created_at::text` plus `id`, because `Date` truncates
  to milliseconds and would skip or duplicate rows at ties.
- Every revocation caused by an admin action is audited in the same
  transaction as the suspension or password reset.
