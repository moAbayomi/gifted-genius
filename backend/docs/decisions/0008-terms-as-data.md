# 0008 — Terms as data, not an enumeration

**Status:** Accepted
**Date:** 2026-10-28
**Deciders:** Project owner
**Amended by:** [0010 — Calendar tables](0010-calendar-tables.md) (status
semantics and the “closed is final” rule)

## Context

A Nigerian academic session contains three terms (First, Second, Third).
Multiple features need to reference a term: results, fees, attendance,
report cards, timetables. Each term has its own calendar dates, a lifecycle
state, and belongs to exactly one session. Schools differ in terminology
("Term" vs "Semester"), and while 3 terms is the norm, a school may deviate.
The system must support session-scoped dates: First Term of 2024/2025 has
different start/end dates than First Term of 2025/2026, even though both
are "First Term."

The auth `sessions` table already exists (login sessions). The academic
session table will be named `academic_sessions` to avoid collision.

## Decision

Model terms as a `terms` table: `id`, `session_id`, `number`, `name`,
`start_date`, `end_date`, `status`. Terms are per-session rows — Term 1 of
2024/2025 is a distinct row from Term 1 of 2025/2026. Every feature that
references a term references `terms.id`.

The column is `session_id`, not `academic_session_id`. The table name
`academic_sessions` already disambiguates the two concepts; the shorter
column name matches the rest of the docs, the PRD, and the offering and
enrolment keys that will reference it.

Status uses `planned → active → closed` (not `planning → active → archived`).
`archived` is reserved for classes and subjects, where it means hidden but
reversible. A closed session is final and no further changes are permitted.

> **Amended by [ADR 0010](0010-calendar-tables.md):** a closed term is closed
> for ordinary data entry, not immutable. Data-entry state is a separate axis
> from calendar status, and authorised corrections remain possible after a
> term closes.

## Alternatives rejected

- **Fixed columns on the session** (`term1_start`, `term1_end`, `term2_start`,
  `term2_end`, `term3_start`, `term3_end`): the closest rival to this decision,
  and the one a beginner reaches for first. It hard-codes three terms, leaves
  no room for a fourth or a summer term, and — most importantly — has nowhere
  to store a status per term (a session can have Term 1 closed, Term 2 active,
  Term 3 planned simultaneously). It also duplicates six date columns across
  every session row and offers no natural place to attach term-scoped data
  like term results or term fees.

- **Enum on each feature table** (`term: "first" | "second" | "third"`):
  cannot store dates, cannot store status, cannot support schools with
  non-3-term systems, cannot rename "First Term" to "First Semester" without
  a code change. Every downstream feature would duplicate the term's dates in
  its own table — six copies of "when is Term 1," which will drift.

- **Term number on each feature table** (`term_number: 1 | 2 | 3`): same
  limitations, plus the number is meaningless without session context.
  "Term 1" could mean 2024/2025 or 2025/2026.

- **Global enum shared by all sessions**: makes it impossible to express that
  Term 1 of 2024/2025 runs September–December and Term 1 of 2025/2026 runs
  slightly different dates.

## Consequences

- One extra table and one extra join per query.
- Terms are first-class entities with their own state machine
  (`planned → active → closed`).
- Adding a fourth term, a special summer term, or a school with 2 terms is a
  data change, not a code change.
- Terms carry actual calendar dates per session — every downstream feature
  (attendance, fees due dates, report card period) reads those dates from one
  place instead of duplicating them.
- The academic session table is named `academic_sessions` to avoid collision
  with the auth `sessions` table.