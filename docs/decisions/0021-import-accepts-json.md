# 0021 — Import accepts JSON rows; the frontend parses CSV

**Status:** Accepted
**Date:** 2026-11-14
**Deciders:** Project owner
**Related:** [0002 — Composite foreign keys for tenancy](0002-composite-foreign-keys.md),
[0014 — Enrollment belongs to a class](0014-enrollment-belongs-to-class.md)

## Context

Schools keep student and result data in spreadsheets and export CSV. The import
feature must accept that data without turning the API into a file-processing
service. CSV is deceptively hard: quoted commas, embedded newlines, BOMs,
encoding, duplicate headers, formula injection, and user-selected column
mappings all live on the client side of the problem.

## Decision

The backend import endpoint accepts **JSON rows**, not files.

- The frontend chooses the file, detects encoding, parses CSV (with a real CSV
  parser, not `split(",")`), maps columns, previews errors, and sends an array of
  row objects.
- The backend validates every row with a strict Zod schema, enforces school and
  session scope, and reports row-level errors by index.
- The backend does not accept `multipart/form-data`, does not store uploaded
  files, and does not guess column names.
- Large imports are sent in bounded batches; the API does not stream a file.

## Alternatives considered

- **Accept `multipart/form-data` and parse CSV server-side.** Rejected. It adds
  file size limits, temporary storage, encoding detection, parser dependencies,
  and a second place where column mapping can be wrong.
- **Accept CSV text in a JSON field.** Rejected. It moves the hard parsing
  problem into the backend while still requiring the frontend to choose and
  read the file.
- **Let the server infer columns from headers.** Rejected. Header names vary by
  school and silently importing the wrong column is worse than an explicit map.
- **Stream a huge CSV directly into the database.** Rejected for this phase. It
  makes partial-failure reporting and transaction boundaries much harder;
  bounded JSON batches keep the failure unit clear.

## Consequences

- The API stays JSON-only and uses the same validation/error shape as every
  other endpoint.
- CSV correctness is owned by the frontend, where the user can see the preview
  and correct the mapping before submission.
- A non-browser client must parse CSV itself or send JSON directly.
- Import batch size is a client concern, bounded by the API's request limits.
