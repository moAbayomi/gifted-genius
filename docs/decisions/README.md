# ADR index

Each decision below is a short record: context, the decision, what else was
considered, and what it costs. They describe the system as built, not as
imagined.

| #    | Decision                                                | One-line summary                                                                 |
| ---- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0001 | [Roles per school, not global](0001-roles-per-school.md) | `roles.school_id` + unique `(school_id, key)`; every school gets its own five roles |
| 0002 | [Composite foreign keys for tenancy](0002-composite-foreign-keys.md) | Children carry `school_id` and reference `(parent_id, school_id)` |
| 0003 | [Server sessions, revoked by deletion](0003-server-sessions.md) | Opaque token, SHA-256 at rest, one `sessions` row per device |
| 0004 | [Rank to act on people, permission subset to grant](0004-rank-and-permission-subset.md) | Two independent gates; neither alone is sufficient |
| 0005 | [No soft deletes](0005-no-soft-deletes.md) | State is a status column; revocation is a `DELETE` |
| 0006 | [Audit written in the same transaction](0006-audit-in-transaction.md) | No mutation without its audit row, no audit row without its mutation |
| 0007 | [`text` + `lower()` index instead of `citext`](0007-text-lower-index.md) | Case-insensitive uniqueness without an extension |
| 0008 | [Terms as data, not an enumeration](0008-terms-as-data.md) | A `terms` row per session; dates and status live on the term, not in code |
| 0009 | [`roles.kind` instead of checks on role keys](0009-roles-kind.md) | Category (`staff`/`student`/`guardian`) is separate from authorization |
| 0010 | [Calendar tables: sessions, terms, and term state](0010-calendar-tables.md) | `academic_sessions` + per-session `terms`; calendar status and data-entry state are separate axes |
| 0011 | [Classes belong to a session](0011-classes-belong-to-a-session.md) | A class is `(session, level, arm, track)`; history stays per session |
| 0012 | [Session lock semantics](0012-session-lock-semantics.md) | `closed_at` is an explicit act; terms must all be closed before locking |
| 0013 | [Archive semantics for structure entities](0013-archive-semantics.md) | `archived_at`; archived rows are read-only and idempotently archived |
| 0014 | [Enrollment belongs to a class](0014-enrollment-belongs-to-class.md) | Dated enrollment rows; the session is copied from the class and pinned by FK |
| 0015 | [Offerings belong to a class](0015-offerings-belong-to-class.md) | A class-subject offering is the teaching/assessment unit; students reference it |
| 0016 | [Composite keys pin class and session](0016-composite-class-session-keys.md) | Children carry class/session/school and reference the parent pair |
| 0017 | [Elective groups with min/max](0017-elective-groups-min-max.md) | Groups are data; count rules are service logic, not a rule engine |
| 0018 | [Transfers end the old enrolment](0018-transfers-ended-row-new-row.md) | A transfer is an ended row plus a new row, never a class_id mutation |
| 0019 | [Scope by assignment](0019-scope-by-assignment.md) | Assignment rows, not roles, decide class visibility; out-of-scope is 404; `_all` means school-wide |
| 0020 | [Promotion is explicit, previewed, and idempotent](0020-promotion-explicit-previewed-idempotent.md) | Preview first; apply confirmed rows; never auto-promote; repeats and track choices are explicit |
| 0021 | [Import accepts JSON rows](0021-import-accepts-json.md) | Frontend parses CSV; backend validates JSON rows and never handles uploads |

Related working notes and trade-offs that did not merit a full ADR live in
[../../NOTES.md](../../NOTES.md). Deferred work lives in
[../../ROADMAP.md](../../ROADMAP.md).
