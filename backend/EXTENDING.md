# Extending the system

Two worked recipes: adding a permission, and adding an endpoint. Both follow
the same shape as the existing code, so the diff stays small and reviewable.

Before either, run `npm run check` and `npm test` so you start from green.

---

## Add a permission

Do **not** pre-add permissions for features that do not exist. Every permission
becomes a toggle a school admin can see, and a toggle that does nothing is worse
than no toggle.

### 1. Add the string to the catalogue

`src/modules/rbac/permissions.ts` is the source of truth:

```ts
export const PERMISSIONS = [
  // ...
  "results:read",
  "results:enter",
] as const;
```

Convention: `resource:action`, lowercase, plural resources for collections
(`users`, `roles`), singular for the tenant (`school`) and the single audit log.
Multi-word actions use snake_case (`reset_password`).

TypeScript now rejects any typo'd `requirePermission("results:entr")` at
compile time. Route handlers should always use the `Permission` type, never a
raw string. `isPermission()` exists only for input from a boundary you do not
control (a request body listing permissions, a sanity check over database rows).

### 2. Grant it to the default roles that should have it

`src/modules/rbac/default-roles.ts`:

```ts
{
  key: "teacher",
  // ...
  permissions: ["school:read", "results:read", "results:enter"],
},
```

This changes **new schools only**. Existing schools keep the role rows they
already have — deliberate, so adding a capability never silently changes
behaviour at a live tenant. The unit test
`tests/unit/rbac/catalogue.test.ts` asserts every catalogue entry is granted to
at least one default role; if you skip this step, that test fails.

### 3. Grant it to existing schools (migration)

If the permission should apply to schools that already exist, add a SQL
migration. Use `npx drizzle-kit generate --custom --name grant_results_enter`
and fill the file:

```sql
-- Grant results:enter to every existing principal role.
INSERT INTO role_permissions (role_id, permission)
SELECT id, 'results:enter'
FROM roles
WHERE key = 'principal'
ON CONFLICT DO NOTHING;
```

`ON CONFLICT DO NOTHING` makes it safe to re-run. `role_permissions` has a
composite primary key on `(role_id, permission)`, so the conflict target is
implicit.

Ordering:

- **Adding** a permission: deploy code first (new schools get it), then run the
  migration (existing schools get it). Both orders are safe; this one is
  clearer.
- **Renaming** a permission: migrate **first** (`UPDATE role_permissions SET
  permission = 'new' WHERE permission = 'old'`), then deploy the code. The
  reverse leaves grants orphaned as silent no-ops.

### 4. Guard the endpoint

```ts
router.post(
  "/results",
  requireAuth(),
  requirePermission("results:enter"),
  async (req, res, next) => { /* ... */ },
);
```

Use the permission at the route. Do not also re-check the same permission in
the service unless the decision depends on the target (rank, school, status) —
the middleware already handled the static capability.

### 5. Tests

- The catalogue test covers "granted somewhere" and "owner has everything".
- Add a row to `tests/integration/permission-matrix.test.ts` so the new route is
  checked against every default role in one place.
- If the permission gates a service action with a target, add the rank/scope
  cases next to the existing ones in `tests/integration/users/` or
  `tests/integration/roles/`.

### 6. Documentation

Add the permission to the table in
[ARCHITECTURE.md](ARCHITECTURE.md#permissions) and, if it protects a
security-relevant action, to the relevant row in [SECURITY.md](SECURITY.md).

---

## Add an endpoint

The example below adds `POST /users/:id/notes` — a school-scoped action on a
member that requires `users:update`. Substitute your own resource.

### 1. Decide the contract first

- Path and method. Is `:id` a **membership** ID (school-scoped) or a user ID
  (global)? School-scoped endpoints use membership IDs; see `MemberDto`.
- Required permission, and whether rank applies (does it act on a person?).
- Response shape. Match an existing envelope: `{ ok: true }` for
  acknowledgements, `{ data, page }` for lists, `{ data, nextCursor }` for
  cursor lists.
- Whether it mutates. If yes, it runs in a transaction and writes an audit row.

### 2. Request schema

In `src/modules/users/schema.ts`:

```ts
export const addNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(2_000),
  })
  .strict(); // rejects unknown keys — mass assignment guard

export type AddNoteInput = z.infer<typeof addNoteSchema>;
```

Use `.strict()` on every body and query. Coerce query strings (`z.coerce.number()`)
and validate pagination with the shared `parsePageQuery`, which also clamps
`limit` to 100.

### 3. Repository (SQL only)

In `src/modules/users/repository.ts`. Put the school in the `WHERE`; never
trust an ID without it:

```ts
export async function findMembershipForUpdate(
  tx: Tx,
  schoolId: string,
  membershipId: string,
) {
  const [row] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.schoolId, schoolId), eq(memberships.id, membershipId)));
  return row ?? null; // caller turns null into 404
}
```

Translate constraint violations here when they mean something to the client
(`isUniqueViolation(err, "constraint_name")` → `AppError(409, ...)`).

### 4. Service (invariants + audit)

In `src/modules/users/service.ts`. Take the transaction, not the database
client; take the actor, not a raw school ID:

```ts
export async function addMemberNote(
  tx: Tx,
  actor: Actor,
  targetMembershipId: string,
  input: AddNoteInput,
): Promise<void> {
  if (targetMembershipId === actor.membershipId) {
    throw new AppError(403, "FORBIDDEN", "Use /me to edit your own profile.");
  }

  await assertCanActOnUser(tx, actor, targetMembershipId); // school + strict rank; 404/403

  if (!can(actor, "users:update")) {
    throw new AppError(403, "FORBIDDEN", "Cannot edit this member");
  }

  await tx.insert(memberNotes).values({
    membershipId: targetMembershipId,
    schoolId: actor.schoolId,
    body: input.body,
    createdBy: actor.membershipId,
  });

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "membership.note_added",
    targetType: "membership",
    targetId: targetMembershipId,
    after: { body: input.body },
  });
}
```

Rules that keep the service honest:

- Destructure and 404 for any row looked up by a request ID. Use `one()` only
  for rows your own code guarantees (`.returning()`, an invariant-backed
  lookup).
- Never audit outside the transaction. `recordAudit(tx, ...)` is the only
  correct call.
- Snapshot fields, never spread rows. Use the `redact*` helpers if the entity
  matches one.

### 5. DTO

In `src/modules/users/dto.ts`, map the row to the wire shape. Convert `Date`
to ISO strings; never return a `Date`. Do not expose user IDs on school-scoped
endpoints — the membership ID is the client-facing identity.

### 6. Route

In `src/modules/users/routes.ts`:

```ts
router.post(
  "/users/:id/notes",
  requireAuth(),
  requirePermission("users:update"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const id = pathParam(req, "id");
      const input = addNoteSchema.parse(req.body);

      await db.transaction((tx) => addMemberNote(tx, actor, id, input));

      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
```

Every handler has this shape: auth, permission, parse, transact, respond,
`next(err)`. Do not write `res.json` twice; the error handler owns failures.

### 7. Mount it

If the module's router is already mounted in `src/app.ts`, you are done. If it
is a new module, add the import and `app.use(yourRouter)`. This is not optional
furniture: three routers existed and were reachable in tests but **not mounted
in `app.ts`**, so they 404'd in the real app. A route test that builds its own
Express app will not catch this.

### 8. Tests

Minimum set for a school-scoped mutation:

1. Happy path: correct status, response body, and database side effect.
2. Cross-school target → `404` (not `403`).
3. Missing permission → `403`; check with a role that has it and one that does
   not.
4. Rank: target at or above the actor's rank → `403`; self-target behaviour.
5. Audit row written with the right action, target, and actor.
6. A row in `tests/integration/permission-matrix.test.ts`.

Build the app with `buildApp()` so the mount is exercised.

### 9. Docs

Register the path in the module's `openapi.ts` (the same module as the route),
reusing the request schema from step 2 and adding a response schema:

```ts
import { errorResponse, jsonResponse, registry, sessionSecurity, z } from "../../openapi/registry.js";
import { addNoteSchema } from "./schema.js";

export const noteResponseSchema = z
  .object({ id: z.uuid(), body: z.string(), createdAt: z.iso.datetime() })
  .openapi("Note");

registry.registerPath({
  method: "post",
  path: "/users/{id}/notes",
  tags: ["Users"],
  summary: "Add a note to a member",
  description:
    "Requires `users:update`. Requires a strictly higher rank than the target and rejects self-targeting.",
  security: sessionSecurity,
  request: {
    params: membershipIdParams,
    body: { required: true, content: { "application/json": { schema: addNoteSchema } } },
  },
  responses: {
    201: jsonResponse("Note created.", noteResponseSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing permission, rank too low, or self-target."),
    404: errorResponse("No such member in this school."),
  },
});
```

Then:

1. Add the path to `EXPECTED_PATHS` in `tests/integration/openapi.test.ts`.
   That test fails if the document and the mounted routes disagree.
2. Parse the real response with the response schema in
   `tests/integration/openapi-contract.test.ts`, so a shape change breaks a test
   rather than silently invalidating the docs.
3. Run `npm run docs:openapi` and commit the updated `docs/openapi.json`.
4. Add the route to the list in [README.md](README.md) and to
   [ARCHITECTURE.md](ARCHITECTURE.md) if it introduces a new concept.

The schema you wrote in step 2 is the single source of truth; do not hand-write
a second copy for the docs.

---

## Add a table

1. Create `src/db/schema/<name>.ts`.
2. **Export it from `src/db/schema/index.ts`.** `students.ts` was written but
   never exported, so drizzle-kit never saw it and no table exists. This is the
   one mistake to not repeat.
3. Follow the tenancy pattern if the table belongs to a school: carry
   `school_id`, and reference the parent with a composite FK on
   `(parent_id, school_id)`.
4. `npm run db:generate`, then read the generated SQL before committing it. Add
   CHECK constraints and indexes deliberately; the generator cannot infer
   "status is one of three values" or "email comparison is case-insensitive".
5. `npm run db:migrate` locally; write the service and repository; add tests
   that include a cross-school rejection at the database level (see
   `tests/integration/school.test.ts` for the pattern).

---

## Add a role

Roles are per school, so there is no global list to append to. Insert the role
for each tenant (new schools get it from `DEFAULT_ROLES`; existing schools need
a migration), give it a unique `rank` (a unit test asserts default ranks are
unique), and decide its permission set. If the role must be structurally
special (like `owner`), add the guard in the service and a test for it.
