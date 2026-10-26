// tests/integration/audit/list-audit-log.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import { sql, eq, count } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { seed } from "../../../src/db/seed.js";
import {authRouter} from "../../../src/modules/auth/routes.js";
import {auditRouter} from "../../../src/modules/audit/routes.js";
import { errorHandler } from "../../../src/shared/middleware/error-handler.js";
import {
  users,
  memberships,
  schools,
  auditLog,
} from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";
import { loginAsRole, TEST_PASSWORD } from "../../helpers/auth.js";

function buildTestApp() {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use(authRouter);
  app.use(auditRouter);
  app.use(errorHandler);
  return app;
}

/**
 * Insert an audit row directly. Bypasses recordAudit so tests control
 * every field precisely (action, metadata, actorMembershipId, createdAt).
 * This is the correct choice for testing the READ side — we're verifying
 * what the DTO/endpoint does with data, not what the writers do.
 */
async function insertAuditRow(
  schoolId: string,
  overrides: Partial<typeof auditLog.$inferInsert> = {},
) {
  return one(
    await db
      .insert(auditLog)
      .values({
        schoolId,
        action: "test.action",
        targetType: "test",
        targetId: null,
        metadata: {},
        ...overrides,
      })
      .returning(),
  );
}

describe("GET /audit-log", () => {
  let app: express.Express;
  let demoSchoolId: string;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    await seed({ password: TEST_PASSWORD });
    app = buildTestApp();

    const owner = one(
      await db.select().from(users).where(eq(users.email, "owner@demo.test")),
    );
    const ownerMem = one(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, owner.id)),
    );
    demoSchoolId = ownerMem.schoolId;
  });

  // ── 1. Happy path ───────────────────────────────────────────────

  it("returns audit rows for the actor's school", async () => {
    const owner = await loginAsRole(app, "owner");
    const res = await owner.get("/audit-log");

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty("nextCursor");

    // The seed writes one school-scoped row: school.created
    const actions = res.body.data.map((r: any) => r.action);
    expect(actions).toContain("school.created");
  });

  // ── 2. Isolation (the most important test) ─────────────────────

  it("isolates schools — demo owner never sees another school's audit rows", async () => {
    // Set up a second school with its own audit row
    const [otherSchool] = await db
      .insert(schools)
      .values({
        name: "Other School",
        slug: "other-school",
        type: "combined",
        status: "active",
      })
      .returning();

    const otherRow = await insertAuditRow(otherSchool!.id, {
      action: "other.secret_event",
      targetType: "school",
      targetId: otherSchool!.id,
      metadata: { via: "test" },
    });

    // Insert two rows for the demo school to establish the baseline
    const demoRow1 = await insertAuditRow(demoSchoolId, {
      action: "demo.action_1",
    });
    const demoRow2 = await insertAuditRow(demoSchoolId, {
      action: "demo.action_2",
    });

    // Demo owner queries
    const owner = await loginAsRole(app, "owner");
    const res = await owner.get("/audit-log");

    expect(res.status).toBe(200);

    const responseIds = res.body.data.map((r: any) => r.id);
    const responseActions = res.body.data.map((r: any) => r.action);

    // The other school's row is nowhere in the response
    expect(responseIds).not.toContain(otherRow.id);
    expect(responseActions).not.toContain("other.secret_event");

    // The demo school's own rows ARE in the response
    expect(responseIds).toContain(demoRow1.id);
    expect(responseIds).toContain(demoRow2.id);

    // Every returned row belongs to demo school — verified by querying DB
    for (const row of res.body.data) {
      const dbRow = one(
        await db.select().from(auditLog).where(eq(auditLog.id, row.id)),
      );
      expect(dbRow.schoolId).toBe(demoSchoolId);
    }
  });

  // ── 3. Cursor pagination ────────────────────────────────────────

  it("paginates with cursor — no duplicates, no gaps, correct total, descending order", async () => {
    // Insert 30 rows spaced 1 second apart, so cursor boundaries are stable.
    // Explicit timestamps (not defaultNow) so the ordering is deterministic.
    const baseTime = Date.now();
    for (let i = 0; i < 30; i++) {
      await insertAuditRow(demoSchoolId, {
        action: `test.paginated_${i}`,
        createdAt: new Date(baseTime + i * 1000),
      });
    }

    const owner = await loginAsRole(app, "owner");

    // Walk all pages
    const seenIds = new Set<string>();
    const allTimestamps: string[] = [];
    let cursor: string | null = null;
    let pageCount = 0;

    do {
      const url = cursor
        ? `/audit-log?limit=10&cursor=${encodeURIComponent(cursor)}`
        : "/audit-log?limit=10";
      const res = await owner.get(url);

      expect(res.status).toBe(200);

      for (const row of res.body.data) {
        // No duplicates across pages
        expect(seenIds.has(row.id)).toBe(false);
        seenIds.add(row.id);
        allTimestamps.push(row.createdAt);
      }

      cursor = res.body.nextCursor;
      pageCount++;

      // Safety: don't loop forever if there's a bug
      if (pageCount > 10)
        throw new Error("Too many pages — likely infinite loop");
    } while (cursor);

    const totalRow = one(
      await db
        .select({ count: count() })
        .from(auditLog)
        .where(eq(auditLog.schoolId, demoSchoolId)),
    );

    const expectedTotal = totalRow.count;
    // Total: 1 seed row (school.created) + 30 inserted = 31
    expect(seenIds.size).toBe(expectedTotal);

    // Descending order: each timestamp >= the next
    for (let i = 1; i < allTimestamps.length; i++) {
      expect(
        new Date(allTimestamps[i - 1]!).getTime() >=
          new Date(allTimestamps[i]!).getTime(),
      ).toBe(true);
    }

    // Pages should be 10, 10, 10, 1 = 4 pages
    expect(pageCount).toBe(Math.ceil(expectedTotal / 10));
  });

  // ── 4. Filter by action ─────────────────────────────────────────

  it("filters by action", async () => {
    await insertAuditRow(demoSchoolId, { action: "test.a" });
    await insertAuditRow(demoSchoolId, { action: "test.a" });
    await insertAuditRow(demoSchoolId, { action: "test.a" });
    await insertAuditRow(demoSchoolId, { action: "test.b" });
    await insertAuditRow(demoSchoolId, { action: "test.b" });

    const owner = await loginAsRole(app, "owner");

    const resA = await owner.get("/audit-log?action=test.a");
    expect(resA.status).toBe(200);
    expect(resA.body.data).toHaveLength(3);
    for (const row of resA.body.data) {
      expect(row.action).toBe("test.a");
    }

    const resB = await owner.get("/audit-log?action=test.b");
    expect(resB.status).toBe(200);
    expect(resB.body.data).toHaveLength(2);
    for (const row of resB.body.data) {
      expect(row.action).toBe("test.b");
    }
  });

  // ── 5. Malformed cursor ─────────────────────────────────────────

  it("rejects a malformed cursor with 400", async () => {
    const owner = await loginAsRole(app, "owner");

    const res = await owner.get("/audit-log?cursor=this-is-not-a-valid-cursor");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURSOR");
  });

  it("rejects a cursor with the wrong shape with 400", async () => {
    const owner = await loginAsRole(app, "owner");

    // Valid base64url of valid JSON, but wrong shape (missing id)
    const bogus = Buffer.from(
      JSON.stringify({ createdAt: "2024-01-01 00:00:00.000000+00" }),
    ).toString("base64url");

    const res = await owner.get(
      `/audit-log?cursor=${encodeURIComponent(bogus)}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURSOR");
  });

  // ── 6. No password / hash leakage ───────────────────────────────

  it("does not leak passwords, hashes, IPs, or user agents in the response", async () => {
    // Insert a row whose metadata SIMULATES a hypothetical service-level
    // leak — passwordHash, ip, userAgent stored in metadata. The DTO
    // whitelist must strip ALL of this, returning only `via` and `roleKey`.
    await insertAuditRow(demoSchoolId, {
      action: "user.updated",
      targetType: "user",
      targetId: "00000000-0000-0000-0000-000000000000",
      metadata: {
        via: "test",
        roleKey: "teacher",
        // Simulated leaks — MUST NOT appear in the response:
        passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$abc123...",
        password: "user-plaintext-password",
        ip: "197.210.52.14",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        sessionId: "sess-abc123",
        requestId: "req-xyz789",
      },
    });

    const owner = await loginAsRole(app, "owner");
    const res = await owner.get("/audit-log");

    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);

    // No argon2 or bcrypt hashes anywhere
    expect(body).not.toMatch(/\$argon2/);
    expect(body).not.toMatch(/\$2[aby]\$/);

    // No password or passwordHash field names
    expect(body).not.toMatch(/"passwordHash"/);
    expect(body).not.toMatch(/"password":/);

    // No tokens, IPs, or user agents
    expect(body).not.toMatch(/"tokenHash"/);
    expect(body).not.toContain("197.210.52.14");
    expect(body).not.toContain("Mozilla");
    expect(body).not.toContain("sess-abc123");
    expect(body).not.toContain("req-xyz789");

    // Whitelisted metadata passes through: via and roleKey
    const updatedRow = res.body.data.find(
      (r: any) => r.action === "user.updated",
    );
    expect(updatedRow).toBeDefined();
    expect(updatedRow.metadata).toEqual({
      via: "test",
      roleKey: "teacher",
    });
  });

  // ── 7. System actor rendering ───────────────────────────────────

  it("renders system actions with actor name 'System' and null membershipId", async () => {
    // Seed writes school.created with actorMembershipId: null.
    // That's exactly the system-actor case.
    const owner = await loginAsRole(app, "owner");
    const res = await owner.get("/audit-log?action=school.created");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);

    const row = res.body.data[0];
    expect(row.actor.name).toBe("System");
    expect(row.actor.membershipId).toBeNull();

    // And it didn't crash the DTO (no exception = passing)
  });

  it("returns nextCursor: null on the last page (no phantom page)", async () => {
    // Exactly 10 rows in this school (excluding seed rows — filter by action)
    for (let i = 0; i < 10; i++) {
      await insertAuditRow(demoSchoolId, { action: "test.exact" });
    }
  
    const owner = await loginAsRole(app, "owner");
  
    // Page 1: 10 rows, but there's a next page (11 total after seed rows)
    const page1 = await owner.get("/audit-log?limit=10&action=test.exact");
    expect(page1.body.data).toHaveLength(10);
    // nextCursor is null because these 10 exact-action rows are all of them
    expect(page1.body.nextCursor).toBeNull();
  });
});
