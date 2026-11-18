# 0012 — Session lock semantics

**Status:** Accepted
**Date:** 2026-10-31
**Deciders:** Project owner
**Amends:** 0010 — Calendar tables (documents `closed_at`, which 0010's
             schema sketch omitted)

## Context

ADR 0010 rejected a `status` column on `academic_sessions` because a
derived session state could disagree with the terms. That decision stands.

ADR 0010's schema sketch did not include `closed_at`, but the calendar
migration added it to solve the promotion catch-22:

- Promotion writes to enrollments (ends source, creates target).
- If "session closed" is derived from "all terms closed," closing Term 3
  closes the session, and promotion (which requires an open session) can
  never run.

`closed_at` records an **explicit act**, not a derived state. That is why
it survives the ADR 0010 reasoning: an explicit act cannot contradict the
terms in the way a redundant status column could.

`closed_at` was added without being documented in any ADR. This ADR
documents it, states the rules, and notes where they are enforced.

## Decision

`academic_sessions.closed_at` is a nullable timestamp. It is set by an
explicit admin action — `POST /sessions/:id/lock` — with three rules:

1. **Precondition.** `closed_at` may only be set when every term in the
   session has `status = 'closed'`. A lock attempt while any term is
   `planned` or `active` is refused (`409 SESSION_HAS_OPEN_TERMS`).

2. **Clearing.** `closed_at` may be cleared by an admin with
   `calendar:manage` and a mandatory reason. The reason is written into
   the audit row (`academic_year.reopened`). Reopening does **not**
   resurrect ended enrollments — those stay ended. Reopening only
   re-enables *new* writes for the session.

3. **Audit.** Both setting and clearing write an audit row
   (`academic_year.closed`, `academic_year.reopened`). The audit row
   carries the acting membership, or null for import/system actions.

**`closed_at` is not derived from "all terms closed."** Deriving it
reintroduces the catch-22. The precondition (rule 1) couples the act to
the terms, so the two cannot contradict in the harmful way: a session
cannot be locked while a term is still open.

## Why sessions have `closed_at` but terms do not

The asymmetry is deliberate and reflects a structural difference:

- **Terms** have a state machine (`planned → active → closed`).
  `terms.status = 'closed'` **is** the term's closed state. The audit log
  records *when* each transition happened (`term.activated`,
  `term.closed`). A `terms.closed_at` column would duplicate the audit
  timestamp and invite the two to drift.

- **Sessions** have no state machine and no `status` column. The single
  administrative act of locking the year is captured by `closed_at`
  (null vs. not-null). That is the only place the session's "closed"
  state lives, so it carries both the state and the timestamp.

Adding `terms.closed_at` for symmetry would duplicate the audit log and
introduce a new drift point. The two tables are not symmetric by design.

## Where the precondition is enforced

**Service layer only.** The precondition (rule 1) references `terms`. A
`CHECK` constraint cannot see another table, and a trigger is not worth
the complexity for MVP:

- The service (`POST /sessions/:id/lock`) is the only writer for
  `closed_at`.
- ADR 0010 has an established precedent: service-enforced preconditions
  where the DB cannot provide a cheap invariant ("Overlap between terms
  is checked in the service while holding a row lock; there is no
  range-exclusion constraint in MVP"). The same reasoning applies here.
- A trigger that queries `terms` on every UPDATE to `academic_sessions`
  would fail for any future "import historical session as already-locked"
  path, forcing a trigger-disable wrapper — worse than the current
  service-only enforcement.

**If a non-service writer ever appears**, add the trigger then. Until
then, the lock endpoint is the only path, and it enforces the
precondition before it sets `closed_at`.

## What this does not mean

- `closed_at` is not a session state machine. It is one nullable
  timestamp for one act.
- Setting `closed_at` does not change any term's `status`. Terms stay
  `closed`. The lock is on the session, not on its children.
- Clearing `closed_at` does not re-open any term. Terms remain `closed`;
  the year is merely unlocked for new session-scoped writes (a late
  enrollment, for example).
- Setting `closed_at` while a term is `active` is refused by the
  service. If it ever happens (via a direct SQL write), the DB will not
  stop it — but the session-wide read-only guard would then contradict
  the still-active term, which is a signal to repair, not a normal state.

## Consequences

- **Promotion sets `closed_at` in the same transaction** that ends source
  enrollments. There is no separate "close session" click for the target
  session.
- **New session-scoped writes** (new classes, new enrollments) check
  `closed_at IS NULL`. Different writes have different guards — the
  guard for post-promotion writes is `closed_at IS NULL`, not `status`.
- **`currentSession(school)`** is a reader. It returns the active-term's
  session, or the most recent by label when none is active, regardless of
  `closed_at`. Callers that need writability check `closed_at`
  separately (`assertSessionWritable`).
- **Import path** (future): a historical session created directly as
  `closed_at = now()` bypasses the precondition. That is intentional —
  import is a distinct path, and the precondition applies to the lock
  endpoint. Document the import path when it exists.

## Rejected alternatives

- **Drop `closed_at`, derive from "all terms closed."** Reintroduces the
  promotion catch-22.
- **Add `academic_sessions.status` (planned/active/closed).** Rejected in
  ADR 0010 — a derived state can disagree with the terms.
- **Add `terms.closed_at` for symmetry.** Rejected — `terms.status =
  'closed'` already encodes the closed state, and the audit log records
  when. A `closed_at` on terms duplicates the audit timestamp and invites
  drift. The asymmetry is real, not accidental.
- **Enforce the precondition via a Postgres trigger.** Rejected for MVP
  — the service is the only writer, and the project's precedent (ADR
  0010's service-enforced overlap check) applies.

## Endpoints

The transition and lock endpoints are implemented:

- `POST /sessions/:sessionId/lock` — permissioned to `calendar:manage`;
  precondition all terms closed; sets `closed_at = now()`; audit
  `academic_year.closed`.
- `POST /sessions/:sessionId/unlock` — permissioned to `calendar:manage`;
  mandatory reason; sets `closed_at = NULL`; audit
  `academic_year.reopened`.
- `POST /terms/:termId/activate` — permissioned to `calendar:manage` and
  requires `confirm: true`. The target must be `planned`, its session
  unlocked, and term N-1 (if any) closed. If another term is active, it is
  closed in the same transaction before the target activates. Only the next
  planned term can be activated; skipping a planned term returns
  `409 TERM_NOT_SEQUENTIAL`. Promotion is a separate endpoint that runs after
  all terms are closed and locks the source session.
- `POST /terms/:termId/close` — permissioned to `calendar:manage`; requires
  `confirm: true`; `active → closed` only.

`currentSession(school)` is implemented as a service reader: the active term's
session, else the most recent session by label, regardless of `closed_at`.
`assertSessionWritable` remains a future guard.