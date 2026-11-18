# 0010 — Calendar tables: sessions, terms, and term state

**Status:** Accepted
**Date:** 2026-10-28
**Deciders:** Project owner
**Amends:** [0008 — Terms as data](0008-terms-as-data.md) (status semantics; the
“closed is final” rule is superseded)

## Context

The academic calendar needs two levels of structure: an **academic session**
(“2026/2027”) and the **terms** inside it (First, Second, Third). Every
downstream feature — enrolments, class offerings, attendance, scores, report
cards, fee schedules — must reference a term, not a bare number, because the
same “First Term” recurs every year with different dates and a different state.

The operational reality (Osun State, 2025/2026) shapes the model:

- Three terms per session is normal, but not universal. A school may run two,
  or add a holiday/coaching block.
- Term dates are Ministry-published and shift between sessions. They are data,
  never code.
- A term is not finished when its end date passes. Late score entry and
  corrections continue into the next term, and a published result may need to
  be superseded. **A closed term is not an immutable term.**
- At most one term is the school’s current teaching term at a time.
- Every table is school-scoped. Tenancy is enforced with `school_id` and
  composite foreign keys, not only in services.

ADR 0008 decided that terms are rows rather than fixed columns or an enum. It
left four things unresolved: who owns the tenant key, which table owns status,
what “closed” means, and how corrections remain possible after closure. This
ADR settles those before the migration is written.

## Decision

### 1. Two tables: `academic_sessions` and `terms`

`academic_sessions` is the container. `terms` are the instances. A term is a
distinct row every session — First Term 2025/2026 is not First Term 2026/2027.

The table is named `academic_sessions`, not `sessions`, because `sessions`
already means login sessions. The foreign-key column stays `terms.session_id`
for continuity with ADR 0008, the product documents, and the keys that offerings
and enrolments will use. Code that reads `terms.session_id` must qualify it
(`term.sessionId` is the academic session, `authSessionId` is the login one).

Illustrative shape (not a migration):

```sql
academic_sessions (
  id uuid primary key,
  school_id uuid not null references schools(id) on delete restrict,
  label text not null,                    -- '2026/2027'
  closed_at timestamptz null,             -- explicit year lock, see ADR 0012
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, label),
  unique (id, school_id),                 -- enables composite FKs from children
  check (label ~ '^[0-9]{4}/[0-9]{4}$')
)

terms (
  id uuid primary key,
  school_id uuid not null,
  session_id uuid not null,
  number smallint not null check (number >= 1),
  name text not null,                     -- 'First Term', 'First Semester'
  start_date date not null,
  end_date date not null,
  status text not null default 'planned'
    check (status in ('planned', 'active', 'closed')),
  data_entry_state text not null default 'closed'
    check (data_entry_state in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (session_id, number),
  unique (id, school_id),                 -- enables composite FKs from results, etc.
  check (end_date >= start_date),
  foreign key (session_id, school_id)
    references academic_sessions (id, school_id)
)

-- A school has at most one current teaching term.
create unique index terms_one_active_per_school
  on terms (school_id) where status = 'active';
```

`academic_sessions` deliberately has **no dates and no status**. Its dates are
the min/max of its terms; its state is the state of its terms. Duplicating
either would create two sources of truth that drift when a Ministry circular
moves a term. The one exception is `closed_at`, an explicit year lock
documented in ADR 0012 — it is an administrative act, not a derived status.

### 2. Dates belong to terms, and they are `date`, not timestamptz

`start_date` and `end_date` are calendar dates. There is no meaningful time of
day for “term ends on Friday”; storing a timestamp invites timezone bugs for a
value that is always local (Africa/Lagos) and only ever compared to another
date.

Both dates are editable by `calendar:manage`; a date change is audited, in the
same transaction, with before/after values. No code may assume September,
January, or a fixed term length.

`end_date >= start_date` is a database check. Overlap between terms in the same
session is checked in the service while holding a row lock on the academic
session (see consequences); there is no range-exclusion constraint in MVP.

### 3. Term status and data-entry state are different axes

`status` answers **“where is this term in the school year?”**:

```
planned → active → closed
```

`data_entry_state` answers **“may ordinary teachers enter or edit scores
right now?”**:

```
open ↔ closed
```

They are intentionally independent:

- A term is `closed` (the teaching period is over) but its data entry may be
  reopened for a correction window.
- A term is `active` but data entry may be closed early while results are
  moderated.
- Two terms can have data entry open at once (Term 1 corrections while Term 2
  entry is running). Only one term can be `active`.

Opening data entry on a term requires `calendar:manage` (or a future
`results:manage` permission) and a reason when reopening a term that was
already closed. Both transitions are audited.

**`closed` does not mean immutable.** Corrections to already-published results
are handled at the result level (a new version that supersedes the old one),
not by reopening the calendar term. The calendar table only records the
school’s term boundaries and whether mass data entry is allowed.

> **Implementation note (2026-10-31):** the `data_entry_state` column exists on
> `terms`, but no endpoint reads or writes it yet. Opening/closing data entry is
> deferred to the results phase; until then it stays at its default `closed` and
> must not be treated as an active lock.

### 4. At most one active term per school

The partial unique index above is the database guarantee. “Active” means the
term currently being taught; a school cannot have two. Switching terms is one
transaction: close the current term, then activate the new one. If two
transactions race, the loser gets a unique violation, which the service maps to
`409 TERM_ALREADY_ACTIVE` (or an equivalent domain error) rather than silently
leaving two active terms.

Historical terms are created directly as `closed` by an import path; they do
not pass through `active`.

A holiday/coaching block that runs alongside a regular term is a
**calendar event**, not a second active term. If a school ever needs a genuinely
parallel teaching period, that is a schema decision with its own ADR, not a
reason to drop the index now.

### 5. Tenancy is enforced on `terms`, not only through the session

`terms` carries `school_id` even though it is reachable through
`academic_sessions.school_id`. That redundancy is the same mechanism used by
`membership_roles`, `sessions`, and `audit_log` (ADR 0002): it enables the
composite FK

```
(session_id, school_id) → academic_sessions (id, school_id)
```

so a term cannot be attached to another school’s session, and it gives every
child table (results, attendance, fee schedules) a `(term_id, school_id)` pair
to reference. Relying on a join through the session would leave that guarantee
to application code.

`terms` also carries `unique (id, school_id)` so downstream tables can use the
same pattern.

### 6. Calendar events are a separate table, later

Mid-term breaks, open days, public holidays, examination weeks, and sports days
are **not** columns on `terms`. They are many-to-one, can span dates, can be
school-wide or class-specific, and change without changing the term’s
boundaries. When the printed calendar needs them:

```sql
calendar_events (
  id, school_id, term_id nullable, kind, title,
  start_date, end_date, audience, created_by, ...
)
```

Until then, `terms` stores only the boundary dates the rest of the system needs.

### 7. Sessions and terms are never soft-deleted; referenced rows are never deleted

There is no `deleted_at` and no `archived` status for terms. A term that has
ever been referenced by an enrolment or a result is history and must remain.
Deleting it is blocked by `ON DELETE RESTRICT` from those tables.

A session or term created by mistake may be hard-deleted **only while nothing
references it**. Once referenced, the correction paths are: edit the dates
(audited), change `data_entry_state`, close/reopen data entry, or supersede a
result. "Closed" is the terminal calendar state for a real term; it is not a
tombstone.

### 8. Read and write permissions

- Reading sessions and terms requires `academics:read`.
- Creating, editing dates, activating, closing, and opening/closing data entry
  require `calendar:manage`.
- `calendar:manage` does not imply score entry or approval; those are result
  permissions and will be added with the results module.

Existing schools do **not** receive new permissions automatically.
`DEFAULT_ROLES` is applied at school creation, and the seed skips an existing
school. The migration that adds these permissions must also grant them to
existing owner/principal/teacher roles, or the first calendar request at the
demo school will be a `403`.

### 9. Audit every calendar mutation

Every mutation writes `audit_log` in the same transaction:

| Action | When |
| ------ | ---- |
| `academic_session.created` | Session created |
| `term.created` | Term created (planned or imported closed) |
| `term.updated` | Name and/or dates changed, with before/after |
| `term.activated` | `planned → active` |
| `term.closed` | `active → closed` |
| `term.data_entry_opened` | Data entry opened, including a reopened term |
| `term.data_entry_closed` | Data entry closed |
| `term.deleted` | Unreferenced term deleted |

The audit row carries `school_id` and the acting membership. System/import
actions use a null actor, as elsewhere.

## Alternatives rejected

- **Fixed columns on the session** (`term1_start`, `term1_end`, …). Rejected in
  ADR 0008 and still wrong: hard-codes three terms, cannot store a status per
  term, duplicates six dates per session, and has nowhere to attach term-scoped
  data. A fourth term or a school with two terms becomes a migration.

- **A single `terms` table with a global enum** (`first | second | third`).
  Cannot carry dates or status, cannot rename “First Term” to “First Semester”,
  and cannot support a two-term or four-term school. Every feature would
  duplicate the term’s dates and drift.

- **A `term_number` column on each feature table.** Meaningless without session
  context (“Term 1” could be 2025/2026 or 2026/2027), and every table would need
  its own copy of the dates.

- **One calendar table with JSONB dates** (`{ first: {...}, second: {...} }`).
  Unqueryable with constraints, unindexable, and impossible to reference from a
  foreign key. It also hides the schema from the migration tool.

- **Dates and status on `academic_sessions`.** A session-level date range
  duplicates the terms, and a session status would be a second state machine
  that can disagree with the terms. The session is a container; its dates are
  `min(start_date)`/`max(end_date)` and its state is derived from its terms.

- **`is_current boolean` instead of status.** A boolean cannot express
  `planned` or `closed`, and “exactly one true” is not enforceable without a
  partial unique index anyway. It also hides the distinction between “current
  teaching term” and “data entry open”.

- **`closed` means immutable.** This is the rule the operational review
  rejected. Late Term 1 corrections in the first weeks of Term 2 are normal; a
  system that forbids them gets bypassed with spreadsheets or a developer
  running SQL. Immutability belongs to published results (versioned), not to
  the calendar row.

- **Reopening a closed term by flipping `status` back to `active`.** It
  conflates “the term is being taught” with “score entry is allowed”, breaks
  the one-active-term invariant, and gives no place to record why it was
  reopened. The separate `data_entry_state` axis solves the actual problem.

- **One active term per session, not per school.** A school can have two
  sessions in the table (historical + current, or a delayed session). Per-session
  uniqueness would allow both to be active, which is not a teaching state a
  school wants. The invariant is school-wide.

- **Application-only validation of the active term.** A read-then-write check
  races under concurrency and has no answer for scripts. The partial unique
  index is the guarantee; the service only maps the violation to a clear error.

- **`timestamptz` for term dates.** It implies a time of day that policy does
  not define, and forces every consumer to reason about timezone conversion for
  a value that is always a local calendar date. `date` is the honest type.

- **A database exclusion constraint for overlapping terms** (for example
  `EXCLUDE USING gist (school_id WITH =, daterange(start_date, end_date) WITH &&)`).
  Correct, but it needs the `btree_gist` extension on every environment,
  including managed Postgres and CI. For MVP the service checks overlap while
  holding the academic-session row lock; the constraint can be added later
  without changing the table shape.

- **Storing mid-term breaks, open days, and holidays as columns on `terms`.**
  Every new kind of event becomes a migration, and multi-day or class-specific
  events do not fit a single pair of columns. They belong in `calendar_events`.

- **Soft-deleting sessions/terms (`deleted_at` or `archived`).** It reintroduces
  the “remember the filter” problem in every query and conflicts with ADR 0005.
  A referenced term must stay visible; an unreferenced mistake can be deleted.

- **A global `academic_sessions` table shared by all schools.** Session labels
  repeat across tenants and dates differ; a shared row would either be
  meaningless or force per-school overrides. Sessions and terms are per-school,
  like roles.

- **Naming the column `academic_session_id`.** Clearer in isolation, but it
  breaks the naming used by ADR 0008, the product documents, and the keys that
  offerings and enrolments will reference. Keep `session_id`, qualify it in
  code, and rely on the table name and FK context to disambiguate it from the
  auth session.

- **A `name` rather than `number` as the ordering key.** `name` is free text
  (“First Term”, “First Semester”, “Term One”) and cannot be safely sorted.
  `number` is the ordering and uniqueness key; `name` is the display label.

## Consequences

- Every feature that needs a term joins `terms`; that is one extra join and the
  correct place for the dates. Class offerings, enrolments, results, attendance,
  and fee schedules all reference `terms.id`, not a number or an enum.

- The calendar can change without a deploy. Ministry date shifts, a delayed
  resumption, or an early vacation are data updates with an audit trail.

- “Closed” no longer blocks corrections. The term can stay closed while data
  entry is reopened or a result is superseded. The result module must implement
  result versions and `results:amend`; until it does, reopening data entry is
  the only correction path.

- Switching the active term is a transaction and can fail with a unique
  violation under concurrency. The admin UI must handle that as “another term
  was activated; refresh” rather than a 500. The service should map it to a
  domain error.

- Overlap checking lives in the service and requires a lock on the academic
  session row when terms are created or their dates change. Without the
  `btree_gist` exclusion constraint, a direct SQL insert can still create
  overlapping dates; that is an accepted MVP limitation, recorded here rather
  than discovered later.

- Existing schools need a permission backfill for `academics:read` and
  `calendar:manage` (and the other academics permissions) because
  `DEFAULT_ROLES` only applies at school creation. The demo seed is idempotent
  and skips an existing school, so it will not repair this by itself.

- A session’s dates and status are derived by aggregation. Listing sessions
  without their terms requires a `min`/`max` join; that is cheaper than keeping
  duplicated columns consistent, and sessions are small.

- `terms.session_id` remains ambiguous at a glance in a codebase that also has
  login sessions. The mitigation is naming discipline in code, not a schema
  rename.

- `calendar_events` is deferred. Until it exists, the system can store term
  boundaries but cannot render a complete printed calendar with mid-term breaks
  and holidays. That is a product gap, not a schema one.

- Deleting a referenced term is blocked by foreign keys. That is intentional:
  history outlives the calendar, and corrections are explicit, audited actions.

## Follow-ups

1. `calendar_events` for breaks, holidays, open days, and exam weeks.
2. Result versions and `results:enter` / `results:approve` / `results:publish` /
   `results:amend` — the correction path that lets a term stay closed.
3. Permission backfill migration for existing schools.
4. Revisit the overlap exclusion constraint if direct SQL writes become a real
   risk.

---

## Amendment (2026-10-31, updated 2026-11-04)

`data_entry_state` was omitted from the initial `terms` migration (applied
2026-10-30) but is added by a follow-up migration
(`0009_purple_ben_parker.sql`). The original decision stands: `status` and
`data_entry_state` are independent axes. `status = 'closed'` does not imply
“no data entry,” and `data_entry_state = 'open'` does not imply “the term is
active.”

The reason for the two-step addition was timing, not a change in design — the
calendar migration shipped without the column, and the column is added before
the results module can depend on its absence. Adding it now (rather than
deferring to Phase 4) prevents Phase 4 from reaching for `status` as the
score-entry gate, which would reintroduce the “closed = immutable” rule the
operational review rejected.

New terms default to `data_entry_state = 'closed'`. Activating a term
(`status: planned → active`) may optionally open data entry in the same
transaction; opening a term that was already closed requires an explicit
action, a reason, and an audit row.

### Session lock, `currentSession`, and label validation

These were added after the original decision and are part of the calendar
model:

- **`academic_sessions.closed_at`** is a nullable timestamp set by an explicit
  `POST /sessions/:sessionId/lock`. It is not derived from “all terms closed”
  (that would reintroduce the promotion catch-22). Locking requires every term
  in the session to be `closed`; unlocking requires `calendar:manage` and a
  reason, and never reopens a term. See ADR 0012.
- **`currentSession(school)`** returns the session of the currently active
  term. If no term is active, it returns the most recent session by label.
  It returns a session regardless of `closed_at`; callers that need a writable
  session use a separate `assertSessionWritable` guard. The two readers are
  deliberately separate so “what is current?” and “may I write?” cannot be
  conflated.
- **Session labels** are shaped `YYYY/YYYY` by the database check. The service
  additionally requires the second year to be the first plus one (for example,
  `2026/2027` is valid; `2026/2030` is rejected). The DB check is a shape
  guard, not a calendar rule.

### Delivery order

The migration that introduced the four tables was `0004`–`0007`; the
`data_entry_state` column followed in `0009`, the level backfill in `0010`,
and `archived_at` in `0011`. Earlier environment notes that mention
`000N_terms_data_entry_state` are historical; the real file is
`0009_purple_ben_parker.sql`.
