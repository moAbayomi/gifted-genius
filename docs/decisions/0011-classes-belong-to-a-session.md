# 0011 — Classes belong to a session

**Status:** Accepted
**Date:** 2026-10-30
**Deciders:** Project owner
**Amends:** 0010 — Calendar tables (adds `unique (id, session_id)` to `terms`, and
clarifies the calendar → classes chain)

## Decision in one paragraph

A class is not a thing that exists forever. **A class is (session, level, arm,
track)** — “JSS 1 Diamond in 2026/2027” is a distinct class from “JSS 1 Diamond
in 2027/2028.” They share the label but not the students, form teacher, subject
offerings, results, or fee schedule. The database models this by giving
`classes` its own `session_id`. Every session, the school creates or clones a
fresh set of classes. This keeps history intact (2026/2027's results never
silently re-scope to 2027/2028's students) and makes promotion simple: end the
old year's enrolments and create the new year's enrolments.

## Context

Two models were considered.

**Persistent classes.** One `JSS 1A` row exists forever. Every child table
(enrolments, offerings, results, attendance, fees) carries a `session_id` to say
which year's JSS 1A it belongs to. This can be made safe with composite foreign
keys — for example, `(class_id, session_id)` on every child and a
`UNIQUE (id, session_id)` on `classes` — so the claim is not that persistent
classes cannot be enforced. The cost is that the session key is repeated in
every child table and every child FK, and the class row itself does not know
which year it represents.

**Per-session classes.** Every year, a new `JSS 1A` row exists for that session.
Children carry only `class_id`; the session is implicit in the class. This is the
model chosen here.

The deciding reasons are:

- The arm label is often stable year to year (JSS 1A stays JSS 1A), but the
  cohort, form teacher, subject offerings, results, and fee schedule change
  every session. The school calls it “the same class,” but the data is
  different.
- Arms are sometimes renamed (A/B → Gold/Silver), merged, or discontinued.
  Under persistent classes, renaming the arm rewrites history — 2024/2025's
  report cards would suddenly say “JSS 1 Gold” even though the school never
  called it that.
- Promotion is a bulk write: end the source year's enrolments, create the
  target year's enrolments. With per-session classes, the target class is a
  real row. With persistent classes, every enrolment carries a redundant
  session key that must stay in sync with the class.
- A class row that carries its own session makes “which classes did this school
  run in 2026/2027?” a direct query, with no join through enrolments.

## Decision

```sql
classes (
  id uuid primary key,
  school_id uuid not null,
  session_id uuid not null,
  level_id uuid not null,
  arm_label text not null,               -- 'A', 'Diamond', 'Science A', display text
  track text not null default 'general', -- general for JSS; science/arts/commercial for SS
  archived_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (session_id, level_id, arm_label, track), -- one JSS 1A; one A per SS track
  unique (id, session_id),                         -- FK target for enrolments etc.
  unique (id, school_id),                          -- FK target for levels etc.

  check (length(trim(arm_label)) > 0),
  check (track in ('general', 'science', 'arts', 'commercial')),

  foreign key (session_id, school_id) references academic_sessions (id, school_id),
  foreign key (level_id, school_id)   references levels (id, school_id)
)
```

`arm_label` is a display label, not a stable code. The tuple
`(session, level, arm_label, track)` is the class identity for that session.

### Track values

The four track values are hard-coded in the check constraint for the MVP. The
2025 curriculum uses broader group names (Humanities, Sciences, Business), so
adding a track later is a **migration**: update the check, update the service
rule, and decide whether existing classes need remapping. Do not treat the four
strings as permanently complete.

### Track versus level stage

A JSS class must use `general`; an SS class must use `science`, `arts`, or
`commercial`. A CHECK constraint cannot reference `levels.stage`, so this rule
lives in the class service. If it becomes a data-integrity problem, add a
composite FK to a `(levels.id, levels.stage)` unique index and a paired check.

## Rejected alternatives

- **Persistent classes with `session_id` on every child.** Enforceable with
  composite keys, but it repeats the session key across enrolments, offerings,
  results, attendance, and fees, and every one of those tables needs its own
  composite FK. The class row also loses the direct answer to “which year is
  this?” Revisit only if a stable cross-year class identity becomes a hard
  requirement (for example, a cross-year timetable or a class-level audit trail
  that must survive rollover).

- **A separate `class_definitions` table (level + arm + track) plus
  per-session `classes`.** This is a sound normalization and keeps a stable
  definition row across years. It costs an extra join and a second lifecycle
  (definition and instance), and a rename of the definition still needs a
  decision about whether history changes. Revisit if the product needs a
  stable cross-year class identity, or if schools start sharing definitions
  across sessions for reporting.

- **A nullable `track` with a functional unique index using
  `coalesce(track, 'general')`.** Correct, but every query that means “not
  track-specific” must spell `IS NULL OR = 'general'`, and the promotion matcher
  must use `IS NOT DISTINCT FROM`. A non-null `'general'` has one spelling and
  one meaning.

- **A single `classes` table with a session label in the name.** Strings are
  not referential integrity; a rename would break every child key. The session
  must be a foreign key.

- **Soft-deleting a class instead of archiving it.** Archive keeps the row and
  its foreign keys, but the unique tuple still belongs to the archived class.
  See [0013](0013-archive-semantics.md); creating a class that matches an
  archived one must return a clear “unarchive first” error, not a generic
  duplicate.

## Consequences

- Classes are created or cloned at every session start. The clone copies live
  classes at the **same level, arm, and track** into the new session; it does
  not promote students.
- Promotion matches a source class to a target class by **level sequence + 1,
  the same arm label, and the same track**. A JSS 3 class therefore needs a
  deliberate target-track decision at the JSS 3 → SS 1 boundary; it is not a
  blind sequence + 1 clone.
- Renaming an arm changes only that session's class. Past report cards keep the
  old label because they point at the old class row.
- Every downstream table references `classes.id`; that id is stable within the
  session and never reused across sessions.
- Archived classes are excluded from clone and promotion matching. They remain
  valid FK targets for history.
- Adding a track is a migration, not a data edit.
