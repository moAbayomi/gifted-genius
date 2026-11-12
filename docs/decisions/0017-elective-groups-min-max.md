# 0017 — Elective groups have minimums and maximums; no rule engine

**Status:** Accepted
**Date:** 2026-11-04
**Deciders:** Project owner
**Related:** [0015 — Offerings belong to a class](0015-offerings-belong-to-class.md),
[0016 — Composite keys pin class and session](0016-composite-class-session-keys.md)

## Context

A class does not simply choose “any three subjects.” The real requirements are
grouped rules: choose at least one religion, one trade, one Nigerian language, or
three to four subjects from one senior track. Those rules change by class,
session, and school. A generic rule engine would turn a handful of counters into
a language, an interpreter, a UI, and a new source of bugs. Hard-coding every
rule into the service would make a school’s configuration impossible to change
without a deploy.

The useful middle ground is a **group with a minimum and a maximum**. That covers
the actual curriculum rules without introducing expressions, scripts, or a
generic predicate language.

- **Archive is not refused by live dependents.** Archived subjects and archived
  elective groups remain valid parents for existing children (`class_subjects`,
  `student_subjects`). Historical references are preserved. The *child* service
  refuses new writes under an archived parent:
  - `class_subjects`: refuse new/updated rows whose `subject` or
    `elective_group` is archived (`409 SUBJECT_ARCHIVED`,
    `409 ELECTIVE_GROUP_ARCHIVED`).
  - `student_subjects`: refuse new choices referencing an archived offering or
    group (`409 OFFERING_ARCHIVED`, `409 ELECTIVE_GROUP_ARCHIVED`).
  The catalogue services (`subjects`, `elective_groups`) do not guard against
  children — parents do not know their children. The guard lives in the child
  service, which is the only layer that knows the dependency exists.

## Decision

Model elective groups as data, and keep validation in code:

```text
elective_groups (
  id,
  school_id,
  session_id,   -- copied from the class and pinned by composite FK
  class_id,
  name,         -- 'Religion', 'Trade', 'Science electives'
  min_choices,  -- >= 0
  max_choices,  -- >= min_choices
  unique (class_id, name),   -- group name unique within a class
  unique (id, class_id)      -- published target for class_subjects FK
)

class_subjects (             -- the offering table (ADR 0015)
  id,
  class_id,
  session_id,
  subject_id,
  elective_group_id (nullable),
  -- a subject in a class belongs to at most one elective group of that class
  foreign key (elective_group_id, class_id)
    references elective_groups (id, class_id)
)
```

- A group belongs to one class/session. A class's elective subjects are the
  `class_subjects` rows whose `elective_group_id` matches the group. The
  composite FK `(elective_group_id, class_id)` guarantees a subject cannot be
  assigned to an elective group belonging to a different class.
- A nullable `elective_group_id` on `class_subjects` records which group a
  subject satisfies in that class. `student_subjects` rows are the truth of what
  a student chose; the service checks the group's `min_choices` and `max_choices`
  when choices are saved and before results are published.
- The database enforces only shape invariants: `min_choices >= 0`,
  `max_choices >= min_choices`, group and offering share class/session, and no
  duplicate choice. The **count rule** is service logic.
- A new kind of rule — “one of these must be a trade,” “these two are mutually
  exclusive,” “a student may exceed the max with principal approval” — is a code
  change and a migration, not a configuration expression. Do not build a rule
  engine for it.

## Alternatives rejected

- A seventh table `elective_group_offerings` modelling a many-to-many
  relationship. A subject taught in a class belongs to at most one elective
  group — the domain does not support "Further Math is elective for both the
  Science and Arts tracks simultaneously." The seventh table expresses a
  flexibility the domain does not want, at the cost of an extra join per query,
  an extra composite FK on `student_subjects`, and a schema that no longer holds
  to the six-table shape. A nullable FK column expresses the actual
  relationship. If the domain later needs many-to-many (e.g., a cross-track
  enrichment programme), a join table can be introduced as an ADR amendment —
  widening is easier than narrowing.
- **A generic rule engine (JSON expressions, scripts, or a predicate DSL).**
  Enormous surface area: parser, validator, evaluation order, admin UI, testing,
  and security. The actual rules are counts over a group; a rule engine is
  overkill and becomes impossible to audit.
- **Hard-coded curriculum rules in the service.** A school cannot change religion
  or trade choices without a deploy, and every class shares the same assumptions.
- **A group as an enum on the offering.** Cannot express per-class groups,
  minimums, maximums, or a student choosing from a set.
- **Database triggers that count choices.** Hard to debug, hard to report, and
  they obscure which service action is allowed. The service owns the policy.
- **No group validation; report cards simply show what was chosen.** A student
  could take zero or five subjects from a three-to-four group, and the error
  surfaces at report time instead of entry time.

## Consequences

- The rule is visible to the UI (`min_choices`, `max_choices`, group members), so
  the client can prevent obvious mistakes before submitting.
- The service is the authority on counts; the database does not try to count
  child rows in a constraint.
- Groups are per class/session, so a school can change the rules next session
  without rewriting history.
- Changing a group after students have chosen requires an audited service action
  and a re-check; existing `student_subjects` rows are not silently rewritten.
- A subject is elective in one group, not several. When the same subject
  legitimately serves two tracks, they should be modelled as one group with
  broader membership, not as two groups sharing a subject.
- Complex future rules need code, tests, and an ADR amendment. That is
  deliberate: the simple rule stays simple.

## What changed, and why

| #   | Change                                                                                                                                             | Why                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Removed** the `elective_group_offerings` table from the schema snippet                                                                           | The brief's six-table plan has no seventh table.                                                                                                                                             |
| 2   | **Added** `elective_group_id (nullable)` to `class_subjects`                                                                                       | The membership is now a column on the offering, not a row in a join table.                                                                                                                   |
| 3   | **Added** `unique (id, class_id)` to `elective_groups`                                                                                             | The composite FK `(elective_group_id, class_id) → elective_groups (id, class_id)` requires this published target. Same pattern as ADR 0016 (`classes` publishing `unique (id, session_id)`). |
| 4   | **Rewrote** the bullet "Its choices are **offerings**, not bare subjects" → now describes `class_subjects.elective_group_id` directly              | The concept is unchanged (choices are class-level subjects, not bare subjects), but the mechanism is now a column, not a join table.                                                         |
| 5   | **Rewrote** the bullet "A nullable `elective_group_id` records which group a choice satisfies" — moved from `student_subjects` to `class_subjects` | The column is now on `class_subjects`, not `student_subjects`. `student_subjects` still records what the student chose.                                                                      |
| 6   | **Added** a new "Alternative rejected" bullet at the top of that section                                                                           | The ADR now explicitly records the seventh-table option and why it was rejected. This is the amendment the brief asked for — the rejected-alternative is the whole point of an ADR.          |
| 7   | **Added** a consequence: "A subject is elective in one group, not several"                                                                         | Documents the narrowing. Someone reading the ADR should know the model is deliberately less general than many-to-many.                                                                       |

## The two patterns this amendment demonstrates

**1. The "rejected alternative" is the load-bearing content.** Before the amendment, the ADR described only what was built. After, it names _what was not built_ (`elective_group_offerings`) and _why_ (domain doesn't need many-to-many; cost is extra join + extra FK + schema drift). A future reader looking at `elective_group_id` and thinking "shouldn't this be a table?" will find the answer in the ADR.

**2. Same composite-key discipline, applied here.** `elective_groups` publishes `unique (id, class_id)` — the exact pattern from ADR 0016 (`classes` publishes `unique (id, session_id)`). The FK `(elective_group_id, class_id)` pins the group to the same class as the subject. One subject cannot be placed in another class's elective group. Same rule, different table.

## One note on the table name

The brief, schema, and ADRs all use `class_subjects`; the earlier `class_subject_offerings` wording was an ADR-only draft and has been corrected.
