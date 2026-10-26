# ADR index

Each decision below is half a page: context, the decision, what else was
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

Related working notes and trade-offs that did not merit a full ADR live in
[../../NOTES.md](../../NOTES.md). Deferred work lives in
[../../ROADMAP.md](../../ROADMAP.md).
