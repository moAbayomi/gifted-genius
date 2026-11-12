# ADR 0013 — Archive semantics for structure entities (levels, classes)

**Status:** Accepted
**Date:** 2026-11-02
**Deciders:** Project owner
**Context:** Structure entities need retirement without deletion, because
downstream features (offerings, enrolments, attendance, results, fees) will
reference them and audit history must survive.

## Decision

### 1. `archived_at TIMESTAMPTZ NULL`, not `is_archived BOOLEAN`

`NULL` = live; timestamp = archived on that date. Rejected the boolean
because:

- **Duplication.** `archived_at IS NOT NULL` is exactly `is_archived`.
  With a boolean, you'd need `archived_at` anyway for audit views and
  archive-bin sorting — two columns that must stay in sync.
- **Uniform filter.** Every "live only" query is `archived_at IS NULL`.
  Sessions use `closed_at`; the same shape will apply when new
  state-bearing entities land. A `boolean` family (`is_archived`,
  `is_closed`, `is_deleted`, …) invites drift.
- **Audit trail for free.** Archive date lives on the row.

### 2. Archived rows keep their unique identity (plain unique constraints)

`levels_school_name_uq`, `levels_school_sequence_uq`, and
`classes_session_level_arm_track_uq` are **plain** uniques — not partial.
An archived row still occupies its slots.

Consequences:

- **You cannot reuse an archived level's name or sequence.** The archived
  row owns it until (hypothetically) permanent deletion — which is
  forbidden (§7). A school that archives "JSS1" must unarchive it or pick
  a different name.
- **Unarchive cannot collide** with a live row, because no live row
  could have taken the archived row's identity.
- **Create can collide with an archived row** — intentional. Silent reuse
  would make past and future "JSS1" indistinguishable in audit and
  results. The class service detects the archived match and returns
  `409 CLASS_ARCHIVED_EXISTS` with an instruction to unarchive it; a live
  match returns `409 CLASS_ALREADY_EXISTS`. Class lists exclude archived rows,
  and class cloning/promotion matching ignores them.

**Partial-index alternative** (`UNIQUE ... WHERE archived_at IS NULL`)
was considered and rejected:

- It allows name reuse after archive, which sounds nice but forces
  unarchive to handle a 23505 ("JSS1 is now in use"). That path needs an
  error code, a UI decision, and a test. Cost exceeds benefit — schools
  rename far less often than they archive.
- If a future requirement demands reuse, the migration is a one-line
  `DROP INDEX` + `CREATE UNIQUE INDEX ... WHERE archived_at IS NULL` —
  reversible.

### 3. Archived rows are read-only

Archiving is not just a list filter. An archived level or class rejects
mutations with a domain error:

| Operation | Archived row | Error |
| --------- | ------------ | ----- |
| `updateLevel` | `levels.archived_at IS NOT NULL` | `409 LEVEL_ARCHIVED` |
| `updateClass` | `classes.archived_at IS NOT NULL` | `409 CLASS_ARCHIVED` |
| `updateClass` | parent level archived | `409 LEVEL_ARCHIVED` |
| `unarchiveClass` | parent level archived | `409 LEVEL_ARCHIVED` |

Unarchive the entity (or its level) first. This keeps the invariant
“no live class exists under an archived level” true for every write path,
not just create.

### 4. Archive and unarchive are idempotent

For all four operations, applying the same transition twice is a no-op:
the row is returned unchanged, no new timestamp is written, and no second
audit row is created. Retries after a timeout are therefore safe. The
only way to change an archived row's date is to unarchive and archive it
again.

### 5. Identity is exact-case (trimmed, not lower-cased)

Names and arm labels are trimmed at both the schema and service
boundaries, but not lower-cased. `"JSS1"` and `"jss1"`, or `"A"` and
`"a"`, are distinct identities for uniqueness. This preserves the exact
label the school uses on the door. If case-insensitive identity is needed
later, it is a migration to expression indexes (the same pattern as
`lower(email)`), not a service change.

### 6. Guard state at ship time

| Entity  | Guard                                                         | Status  |
|---------|---------------------------------------------------------------|---------|
| levels  | Refuse archive if any live class references it (`LEVEL_HAS_ACTIVE_CLASSES`) | ✅ shipped |
| classes | Refuse archive if any future referencer blocks it              | ⏳ placeholder |

The class guard is `assertClassCanBeArchived(tx, schoolId, classId)` — a
no-op today, called by `archiveClass` so future implementation is a
body-fill, not a structural change. Two `it.todo` tests in
`classes.test.ts` are the reminder.

### 7. Archive is reversible and non-destructive

- Archiving does **not** delete the row. All FKs continue to resolve.
- Archiving is **reversible** via `unarchiveLevel` / `unarchiveClass`
  (`archived_at = NULL`).
- Archiving does **not** cascade. Referencing rows (enrolments, results,
  audit) are unaffected. Archived entities are excluded from live
  listings via `WHERE archived_at IS NULL`.
- **No hard-delete path** for structure entities. If a school needs a
  level permanently gone, the answer is archive + retention policy, not
  deletion. The DB permits `DELETE`, but no code path issues one.

## Consequences

**Positive**

- Audit history preserved for any row referenced by future features.
- FKs stay intact across archive; downstream features can assume a
  `class_id` that resolved yesterday still resolves today, archived or
  not.
- `archived_at IS NULL` is uniform across entities — easy to enforce,
  easy to review.
- Archived entities are read-only, so the “no live class under an
  archived level” invariant holds for update and unarchive paths too, not
  only create.
- Archive/unarchive are idempotent: retrying a request never writes a
  second timestamp or audit row.

**Negative**

- Archive is not deletion. A school cannot free an archived name for a
  different meaning without a rename operation (not yet built).
- Plain uniques couple create and unarchive: unarchive can't 23505, but
  that's *because* create refuses to reuse archived names. Changing one
  side of that trade-off changes the other.
- Identity is exact-case. Two labels that differ only by case can coexist;
  if that becomes a problem, it needs an expression-index migration, not a
  service tweak.
- Editing an archived row requires unarchiving it first — an extra step,
  but a deliberate one.
- Class guard is incomplete until 2b. Acceptable — no referencers exist
  yet. The two `it.todo` tests are the visible debt.

**Neutral**

- One nullable `timestamptz` per structure table. Negligible.
- Guard stub costs one function call per archive (a no-op today).

## Related

- ADR 0012 — session locking (`SESSION_LOCKED`). Same philosophy:
  retire by state transition, never by delete.
- Calendar transitions (`terms.status`): uses an enum not `archived_at`,
  because terms pass through *ordered* states (planned → active →
  closed). Structure entities have only two states (live, archived), for
  which a nullable timestamp is simpler.