import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import buildApp from "../../src/app.js";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { seed } from "../../src/db/seed.js";
import { loginAsRole, loginAsStudent, TEST_PASSWORD } from "../helpers/auth.js";
import TestAgent from "supertest/lib/agent.js";
import { one } from "../../src/shared/utils/assert.js";
import {
  academicSessions,
  classEnrollments,
  classes,
  classSubjects,
  electiveGroups,
  levels,
  membershipRoles,
  memberships,
  roles,
  studentProfiles,
  subjectTeacherAssignments,
  subjects,
  terms,
  users,
} from "../../src/db/schema/index.js";
import { apiPath } from "../helpers/api.js";

function buildTestApp() {
  return buildApp();
}

type RoleKey = "owner" | "principal" | "teacher" | "guardian" | "student";

type BuiltRequest = {
  path: string;
  body?: string | object;
};

type Fixtures = {
  studentMembershipId: string;
  studentRoleId: string;
  academicSessionId: string; // for GET /classes?sessionId=...
  demoClassId: string; // for /classes/:id routes
  archiveClassId: string; // class with no offerings, for archive
  someLevelId: string;
  archiveTargetLevelId: string; // ← the empty probe level
  activeTermId: string; // seeded Term 1 (active), for close
  plannedTermId: string; // term in an otherwise empty session, for activate
  lockableSessionId: string; // session with all terms closed
  lockedSessionId: string; // session with closed_at set
  termId: string; // seeded Term 2, for PATCH /terms/:id
  cloneTargetSessionId: string; // open session for class cloning
  someSubjectId: string;
  archiveTargetSubjectId: string;
  someElectiveGroupId: string; // live group, target for PATCH
  archiveTargetGroupId: string; // live group with NO offerings, target for archive
  withdrawTargetOfferingId: string;
  enrollableStudentId: string;
  enrolledEnrollmentId: string;
  enrolledOfferingId: string;
  transferTargetClassId: string;
  scopedClassId: string;
  scopedEnrollmentId: string;
};

type MatrixRow = {
  name: string;
  method: "get" | "post" | "put" | "delete" | "patch";
  buildRequest: (fixtures: Fixtures) => BuiltRequest;
  expected: Record<RoleKey, number>;
  /** Optional per-row state setup, run after seed and before the request. */
  setup?: (fixtures: Fixtures) => Promise<void>;
};

const matrix: MatrixRow[] = [
  // ── Read-only ────────────────────────────────────────────────────
  {
    name: "GET /users (list)",
    method: "get",
    buildRequest: () => ({ path: "/users" }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /users/:id",
    method: "get",
    buildRequest: (f) => ({ path: `/users/${f.studentMembershipId}` }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /roles (list)",
    method: "get",
    buildRequest: () => ({ path: "/roles" }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  // ── Create ────────────────────────────────────────────────────────
  {
    name: "POST /users (invite)",
    method: "post",
    buildRequest: () => ({
      path: "/users",
      body: {
        firstName: "Probe",
        lastName: "User",
        email: `probe-${crypto.randomUUID()}@x.test`,
        roleKeys: ["teacher"],
      },
    }),
    expected: {
      owner: 201,
      principal: 201,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  // ── Role assignment (non-destructive add) ────────────────────────
  {
    name: "POST /users/:id/roles",
    method: "post",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}/roles`,
      body: { roleKey: "guardian" },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  // ── Destructive: suspend / reactivate / reset ────────────────────
  {
    name: "POST /users/:id/suspend",
    method: "post",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}/suspend`,
      body: {},
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /users/:id/reactivate",
    method: "post",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}/reactivate`,
      body: {},
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /users/:id/reset-password",
    method: "post",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}/reset-password`,
      body: { newPassword: "probe-password-9999" },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  // ── Destructive: remove role ─────────────────────────────────────
  {
    name: "DELETE /users/:id/roles/:roleId",
    method: "delete",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}/roles/${f.studentRoleId}`,
    }),
    expected: {
      owner: 204,
      principal: 204,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  // ── Edit user ────────────────────────────────────────────────────
  {
    name: "PATCH /users/:id",
    method: "patch",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}`,
      body: { firstName: "Patched" },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  // ── Edit role permissions ────────────────────────────────────────
  {
    name: "PUT /roles/:id/permissions",
    method: "put",
    buildRequest: (f) => ({
      path: `/roles/${f.studentRoleId}/permissions`,
      body: { permissions: ["school:read"] },
    }),
    expected: {
      owner: 200,
      principal: 403,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /audit-log",
    method: "get",
    buildRequest: () => ({ path: "/audit-log" }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  // calendar:manage endpoints
  {
    name: "POST /terms/:id/activate",
    method: "post",
    setup: async (f) => {
      // Free the school's one active-term slot, then activate a planned term.
      await db
        .update(terms)
        .set({ status: "closed" })
        .where(eq(terms.id, f.activeTermId));
    },
    buildRequest: (f) => ({
      path: `/terms/${f.plannedTermId}/activate`,
      body: { confirm: true },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /terms/:id/close",
    method: "post",
    buildRequest: (f) => ({
      path: `/terms/${f.activeTermId}/close`,
      body: { confirm: true },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /sessions/:id/lock",
    method: "post",
    buildRequest: (f) => ({
      path: `/sessions/${f.lockableSessionId}/lock`,
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /sessions/:id/unlock",
    method: "post",
    buildRequest: (f) => ({
      path: `/sessions/${f.lockedSessionId}/unlock`,
      body: { reason: "Permission matrix probe" },
    }),
    expected: {
      owner: 200,
      principal: 403,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  // academic:read endpoints
  {
    name: "GET /levels (list)",
    method: "get",
    buildRequest: () => ({ path: "/levels" }),
    // owner + principal: manage everything → 200
    // teacher + guardian: academics:read? → likely 200 (teachers/guardians need to see classes)
    // student: only school:read per brief → 403
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /classes (list)",
    method: "get",
    buildRequest: (f) => ({
      path: `/classes?sessionId=${f.academicSessionId}`,
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },

  // structure:manage endpoints
  {
    name: "POST /levels",
    method: "post",
    buildRequest: () => ({
      path: "/levels",
      body: {
        name: `Probe ${crypto.randomUUID()}`,
        sequence: 1000 + Math.floor(Math.random() * 10000),
        stage: "junior",
      },
    }),
    expected: {
      owner: 201,
      principal: 201,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "PATCH /levels/:id",
    method: "patch",
    buildRequest: (f) => ({
      path: `/levels/${f.someLevelId}`,
      body: { name: "Patched" },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /levels/:id/archive",
    method: "post",
    buildRequest: (f) => ({
      path: `/levels/${f.archiveTargetLevelId}/archive`,
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /levels/:id/unarchive",
    method: "post",
    buildRequest: (f) => ({
      path: `/levels/${f.archiveTargetLevelId}/unarchive`,
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /classes",
    method: "post",
    buildRequest: (f) => ({
      path: "/classes",
      body: {
        sessionId: f.academicSessionId,
        levelId: f.someLevelId,
        armLabel: `Probe${crypto.randomUUID().slice(0, 4)}`,
        track: "general",
      },
    }),
    expected: {
      owner: 201,
      principal: 201,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "PATCH /classes/:id",
    method: "patch",
    buildRequest: (f) => ({
      path: `/classes/${f.demoClassId}`,
      body: { armLabel: "Z" },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /classes/:id/archive",
    method: "post",
    buildRequest: (f) => ({ path: `/classes/${f.archiveClassId}/archive` }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /classes/:id/unarchive",
    method: "post",
    buildRequest: (f) => ({ path: `/classes/${f.demoClassId}/unarchive` }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  // sessions
  {
    name: "GET /sessions",
    method: "get",
    buildRequest: () => ({ path: "/sessions" }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /sessions",
    method: "post",
    buildRequest: () => ({ path: "/sessions", body: { label: "2031/2032" } }),
    expected: {
      owner: 201,
      principal: 201,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /sessions/current",
    method: "get",
    buildRequest: () => ({ path: "/sessions/current" }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "PATCH /sessions/:id",
    method: "patch",
    buildRequest: (f) => ({
      path: `/sessions/${f.academicSessionId}`,
      body: { label: "2032/2033" },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  // terms
  {
    name: "GET /terms",
    method: "get",
    buildRequest: (f) => ({ path: `/terms?sessionId=${f.academicSessionId}` }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /terms",
    method: "post",
    buildRequest: (f) => ({
      path: "/terms",
      body: {
        sessionId: f.academicSessionId,
        number: 4,
        name: "Probe Term",
        startDate: "2027-09-15",
        endDate: "2027-12-18",
      },
    }),
    expected: {
      owner: 201,
      principal: 201,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "PATCH /terms/:id",
    method: "patch",
    buildRequest: (f) => ({
      path: `/terms/${f.termId}`,
      body: { name: "Probe Rename" },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  // classes: clone and get
  {
    name: "POST /classes/clone",
    method: "post",
    buildRequest: (f) => ({
      path: "/classes/clone",
      body: {
        fromSessionId: f.academicSessionId,
        toSessionId: f.cloneTargetSessionId,
      },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /classes/:id",
    method: "get",
    buildRequest: (f) => ({ path: `/classes/${f.demoClassId}` }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /levels/:id",
    method: "get",
    buildRequest: (f) => ({ path: `/levels/${f.someLevelId}` }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /subjects",
    method: "post",
    buildRequest: () => ({
      path: "/subjects",
      body: {
        code: `SUB-${crypto.randomUUID().slice(0, 6)}`,
        name: `Subject ${crypto.randomUUID().slice(0, 4)}`,
      },
    }),
    expected: {
      owner: 201,
      principal: 201,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /subjects (list)",
    method: "get",
    buildRequest: () => ({ path: "/subjects" }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "PATCH /subjects/:id",
    method: "patch",
    buildRequest: (f) => ({
      path: `/subjects/${f.someSubjectId}`,
      body: { name: `Patched ${crypto.randomUUID().slice(0, 4)}` },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /subjects/:id/archive",
    method: "post",
    buildRequest: (f) => ({
      path: `/subjects/${f.archiveTargetSubjectId}/archive`,
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /elective-groups",
    method: "post",
    buildRequest: (f) => ({
      path: "/elective-groups",
      body: {
        classId: f.demoClassId,
        name: `EG-${crypto.randomUUID().slice(0, 6)}`,
        minChoices: 1,
        maxChoices: 2,
      },
    }),
    expected: {
      owner: 201,
      principal: 201,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /elective-groups (list)",
    method: "get",
    buildRequest: (f) => ({
      path: `/elective-groups?classId=${f.demoClassId}`,
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "PATCH /elective-groups/:id",
    method: "patch",
    buildRequest: (f) => ({
      path: `/elective-groups/${f.someElectiveGroupId}`,
      body: { name: `Patched ${crypto.randomUUID().slice(0, 4)}` },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /elective-groups/:id/archive",
    method: "post",
    buildRequest: (f) => ({
      path: `/elective-groups/${f.archiveTargetGroupId}/archive`,
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /classes/:classId/offerings",
    method: "post",
    buildRequest: (f) => ({
      path: `/classes/${f.demoClassId}/offerings`,
      body: {
        subjects: [
          {
            subjectId: f.someSubjectId, // any live subject — reuse from subjects matrix
            isCompulsory: false,
            electiveGroupId: null,
          },
        ],
      },
    }),
    expected: {
      owner: 201,
      principal: 201,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /classes/:classId/offerings (list)",
    method: "get",
    buildRequest: (f) => ({
      path: `/classes/${f.demoClassId}/offerings`,
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "DELETE /offerings/:id",
    method: "delete",
    buildRequest: (f) => ({
      path: `/offerings/${f.withdrawTargetOfferingId}`,
    }),
    expected: {
      owner: 204,
      principal: 204,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },

  {
    name: "POST /students",
    method: "post",
    buildRequest: () => ({
      path: "/students",
      body: {
        firstName: "Probe",
        lastName: "Student",
        email: `student-${crypto.randomUUID().slice(0, 8)}@x.test`,
        admissionNumber: `ADM-${crypto.randomUUID().slice(0, 8)}`,
      },
    }),
    expected: {
      owner: 201,
      principal: 201,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /enrollments",
    method: "post",
    buildRequest: (f) => ({
      path: "/enrollments",
      body: { studentId: f.enrollableStudentId, classId: f.demoClassId },
    }),
    expected: {
      owner: 201,
      principal: 201,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /enrollments/bulk",
    method: "post",
    buildRequest: (f) => ({
      path: "/enrollments/bulk",
      body: { classId: f.demoClassId, studentIds: [f.enrollableStudentId] },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /enrollments/:id/electives",
    method: "post",
    buildRequest: (f) => ({
      path: `/enrollments/${f.enrolledEnrollmentId}/electives`,
      body: { offeringIds: [f.enrolledOfferingId] },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /enrollments/:id/transfer",
    method: "post",
    buildRequest: (f) => ({
      path: `/enrollments/${f.enrolledEnrollmentId}/transfer`,
      body: { targetClassId: f.transferTargetClassId },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /enrollments/:id/withdraw",
    method: "post",
    buildRequest: (f) => ({
      path: `/enrollments/${f.enrolledEnrollmentId}/withdraw`,
      body: { reason: "matrix probe" },
    }),
    expected: {
      owner: 204,
      principal: 204,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "POST /sessions/:id/rollover",
    method: "post",
    buildRequest: (f) => ({
      path: `/sessions/${f.academicSessionId}/rollover`,
      body: { toSessionId: f.cloneTargetSessionId },
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 403,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /classes/:classId/roster (in scope)",
    method: "get",
    buildRequest: (f) => ({ path: `/classes/${f.scopedClassId}/roster` }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /classes/:classId/roster (out of scope)",
    method: "get",
    buildRequest: (f) => ({ path: `/classes/${f.demoClassId}/roster` }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 404,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /enrollments (scoped list)",
    method: "get",
    buildRequest: () => ({ path: "/enrollments" }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /enrollments/:id (in scope)",
    method: "get",
    buildRequest: (f) => ({ path: `/enrollments/${f.scopedEnrollmentId}` }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /enrollments/:id (out of scope)",
    method: "get",
    buildRequest: (f) => ({ path: `/enrollments/${f.enrolledEnrollmentId}` }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 404,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /classes/:classId/roster",
    method: "get",
    buildRequest: (f) => ({
      path: `/classes/${f.demoClassId}/roster`,
    }),
    expected: {
      owner: 200,
      principal: 200,
      teacher: 404,
      guardian: 403,
      student: 403,
    },
  },
  {
    name: "GET /users?roleKind=staff (staff list)",
    method: "get",
    buildRequest: () => ({ path: "/users?roleKind=staff" }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403, student: 403 },
  },
  {
    name: "GET /sessions/:id/promotion/preview",
    method: "get",
    buildRequest: (f) => ({
      path: `/sessions/${f.academicSessionId}/promotion/preview?targetSessionId=${f.cloneTargetSessionId}`,
    }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403, student: 403 },
  },
  {
    name: "POST /sessions/:id/promotion/commit",
    method: "post",
    buildRequest: (f) => ({
      path: `/sessions/${f.academicSessionId}/promotion/commit`,
      body: { targetSessionId: f.cloneTargetSessionId, rows: [] },
    }),
    expected: { owner: 400, principal: 400, teacher: 403, guardian: 403, student: 403 },
  },
  {
    name: "POST /students/import/validate",
    method: "post",
    buildRequest: () => ({ path: "/students/import/validate", body: { rows: [] } }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403, student: 403 },
  },
  {
    name: "POST /students/import",
    method: "post",
    buildRequest: () => ({ path: "/students/import", body: { rows: [] } }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403, student: 403 },
  },
];

describe("permission matrix", () => {
  let app: express.Express;
  let fixtures: Fixtures;
  let cookies: Record<RoleKey, TestAgent>;
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    const seeded = await seed({ password: TEST_PASSWORD });
    app = buildTestApp();

    // In the matrix's beforeEach — the login calls become:
    cookies = {
      owner: await loginAsRole(app, "owner"),
      principal: await loginAsRole(app, "principal"),
      teacher: await loginAsRole(app, "teacher"),
      guardian: await loginAsRole(app, "guardian"),
      student: await loginAsStudent(app, seeded.school.slug),
    };
    // Keep the existing username lookup for studentMembership/studentRole
    const studentMembership = one(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.username, "jss1-2026-001")),
    );
    const studentRole = one(
      await db
        .select()
        .from(roles)
        .where(
          and(
            eq(roles.key, "student"),
            eq(roles.schoolId, studentMembership.schoolId),
          ),
        ),
    );

    // Need these for the new levels/classes :id fixtures
    const sessionId = seeded.academicSession.id;
    const demoClassId = seeded.demoClasses[0]!.id;
    const demoClass = seeded.demoClasses[0]!;
    const archiveClass = one(
      await db
        .insert(classes)
        .values({
          schoolId: studentMembership.schoolId,
          sessionId: demoClass.sessionId,
          levelId: demoClass.levelId,
          armLabel: `ARC-${crypto.randomUUID().slice(0, 4)}`,
          track: "general",
        })
        .returning(),
    );
    const jss1 = seeded.levels.find((level) => level.name === "JSS 1");
    if (!jss1) throw new Error("seed did not produce JSS 1");
    const someLevelId = jss1.id;

    // Scope fixture: demo teacher is form teacher of JSS 2 A and teaches one
    // offering there. JSS 1 A (demoClassId) is deliberately out of scope.
    const jss2 = seeded.levels.find((level) => level.name === "JSS 2");
    if (!jss2) throw new Error("seed did not produce JSS 2");
    const scopedClass = one(
      await db
        .select()
        .from(classes)
        .where(and(eq(classes.levelId, jss2.id), eq(classes.armLabel, "A"))),
    );
    const teacherUser = one(
      await db.select().from(users).where(eq(users.email, "teacher@demo.test")),
    );
    const teacherMembership = one(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, teacherUser.id)),
    );
    const scopedOffering = one(
      await db
        .select()
        .from(classSubjects)
        .where(eq(classSubjects.classId, scopedClass.id)),
    );
    await db
      .update(classes)
      .set({ formTeacherMembershipId: teacherMembership.id })
      .where(eq(classes.id, scopedClass.id));
    await db.insert(subjectTeacherAssignments).values({
      schoolId: scopedClass.schoolId,
      classId: scopedClass.id,
      classSubjectId: scopedOffering.id,
      teacherMembershipId: teacherMembership.id,
    });
    const scopedEnrollment = seeded.demoStudent?.enrollment;
    if (!scopedEnrollment)
      throw new Error("seed did not produce demo enrollment");

    const activeTerm = seeded.terms.find(
      (term) => term.number === 1 && term.status === "active",
    );
    if (!activeTerm) throw new Error("seed did not produce an active Term 1");

    const plannedSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: studentMembership.schoolId, label: "2027/2028" })
        .returning(),
    );
    const plannedTerm = one(
      await db
        .insert(terms)
        .values({
          schoolId: studentMembership.schoolId,
          sessionId: plannedSession.id,
          number: 1,
          name: "First Term",
          startDate: "2027-09-15",
          endDate: "2027-12-18",
        })
        .returning(),
    );

    const lockableSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: studentMembership.schoolId, label: "2028/2029" })
        .returning(),
    );
    await db.insert(terms).values([
      {
        schoolId: studentMembership.schoolId,
        sessionId: lockableSession.id,
        number: 1,
        name: "First Term",
        startDate: "2028-09-15",
        endDate: "2028-12-18",
        status: "closed",
      },
      {
        schoolId: studentMembership.schoolId,
        sessionId: lockableSession.id,
        number: 2,
        name: "Second Term",
        startDate: "2029-01-05",
        endDate: "2029-04-02",
        status: "closed",
      },
      {
        schoolId: studentMembership.schoolId,
        sessionId: lockableSession.id,
        number: 3,
        name: "Third Term",
        startDate: "2029-04-26",
        endDate: "2029-07-23",
        status: "closed",
      },
    ]);

    const lockedSession = one(
      await db
        .insert(academicSessions)
        .values({
          schoolId: studentMembership.schoolId,
          label: "2029/2030",
          closedAt: new Date(),
        })
        .returning(),
    );

    const someSubject = one(
      await db
        .insert(subjects)
        .values({
          schoolId: studentMembership.schoolId,
          code: `PM-${crypto.randomUUID().slice(0, 6)}`,
          name: "Patch Target",
        })
        .returning(),
    );
    const archiveTargetSubject = one(
      await db
        .insert(subjects)
        .values({
          schoolId: studentMembership.schoolId,
          code: `ARC-${crypto.randomUUID().slice(0, 6)}`,
          name: "Archive Target",
        })
        .returning(),
    );

    const someElectiveGroup = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: studentMembership.schoolId,
          classId: demoClassId,
          sessionId: sessionId,
          name: `PM-${crypto.randomUUID().slice(0, 6)}`,
          minChoices: 1,
          maxChoices: 2,
        })
        .returning(),
    );
    const archiveTargetGroup = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: studentMembership.schoolId,
          classId: demoClassId,
          sessionId: sessionId,
          name: `ARC-${crypto.randomUUID().slice(0, 6)}`,
          minChoices: 0,
          maxChoices: 1,
        })
        .returning(),
    );

    const withdrawSubject = one(
      await db
        .insert(subjects)
        .values({
          schoolId: studentMembership.schoolId,
          code: `WDR-${crypto.randomUUID().slice(0, 6)}`,
          name: "Withdraw Target",
        })
        .returning(),
    );
    const withdrawOffering = one(
      await db
        .insert(classSubjects)
        .values({
          schoolId: studentMembership.schoolId,
          classId: demoClassId,
          subjectId: withdrawSubject.id,
          isCompulsory: false,
          electiveGroupId: null,
        })
        .returning(),
    );

    const enrollableStudentUser = one(
      await db
        .insert(users)
        .values({
          email: `enr-${crypto.randomUUID().slice(0, 8)}@test`,
          firstName: "Enr",
          lastName: "Ollable",
        })
        .returning(),
    );
    const enrollableStudentMembership = one(
      await db
        .insert(memberships)
        .values({
          userId: enrollableStudentUser.id,
          schoolId: studentMembership.schoolId,
          status: "active",
        })
        .returning(),
    );
    const studentKindRole = one(
      await db
        .select()
        .from(roles)
        .where(
          and(
            eq(roles.schoolId, studentMembership.schoolId),
            eq(roles.kind, "student"),
          ),
        ),
    );
    await db.insert(membershipRoles).values({
      membershipId: enrollableStudentMembership.id,
      roleId: studentKindRole.id,
      schoolId: studentMembership.schoolId,
    });
    const enrollableStudent = one(
      await db
        .insert(studentProfiles)
        .values({
          schoolId: studentMembership.schoolId,
          membershipId: enrollableStudentMembership.id,
          admissionNumber: `ENR-${crypto.randomUUID().slice(0, 8)}`,
        })
        .returning(),
    );

    // ── Enrolled student (for electives/transfer/withdraw) ──────────────
    const enrolledUser = one(
      await db
        .insert(users)
        .values({
          email: `enrolled-${crypto.randomUUID().slice(0, 8)}@test`,
          firstName: "Enr",
          lastName: "Olled",
        })
        .returning(),
    );
    const enrolledMembership = one(
      await db
        .insert(memberships)
        .values({
          userId: enrolledUser.id,
          schoolId: studentMembership.schoolId,
          status: "active",
        })
        .returning(),
    );
    await db.insert(membershipRoles).values({
      membershipId: enrolledMembership.id,
      roleId: studentKindRole.id,
      schoolId: studentMembership.schoolId,
    });
    const enrolledProfile = one(
      await db
        .insert(studentProfiles)
        .values({
          schoolId: studentMembership.schoolId,
          membershipId: enrolledMembership.id,
          admissionNumber: `ENRD-${crypto.randomUUID().slice(0, 8)}`,
        })
        .returning(),
    );
    const enrollmentRow = one(
      await db
        .insert(classEnrollments)
        .values({
          schoolId: studentMembership.schoolId,
          studentId: enrolledProfile.id,
          classId: demoClassId,
          sessionId: sessionId,
          startedAt: new Date(),
          status: "active",
          endedAt: null,
          endedReason: null,
          transferredFromEnrollmentId: null,
        })
        .returning(),
    );

    // ── Elective offering in demoClassId ────────────────────────────────
    const electiveSubj = one(
      await db
        .insert(subjects)
        .values({
          schoolId: studentMembership.schoolId,
          code: `EL-${crypto.randomUUID().slice(0, 6)}`,
          name: "Elective Target",
        })
        .returning(),
    );
    const electiveOffering = one(
      await db
        .insert(classSubjects)
        .values({
          schoolId: studentMembership.schoolId,
          classId: demoClassId,
          subjectId: electiveSubj.id,
          isCompulsory: false,
          electiveGroupId: null, // no group → no min/max rule → any selection works
        })
        .returning(),
    );

    const transferLevel = one(
      await db
        .insert(levels)
        .values({
          schoolId: studentMembership.schoolId,
          name: `TRF-${crypto.randomUUID().slice(0, 6)}`,
          sequence: 500 + Math.floor(Math.random() * 400), // away from typical seed values
          stage: "junior",
        })
        .returning(),
    );

    // ── Transfer target — another class in the same session ─────────────
    const transferTarget = one(
      await db
        .insert(classes)
        .values({
          schoolId: studentMembership.schoolId,
          sessionId: sessionId,
          levelId: transferLevel.id,
          armLabel: `T-${crypto.randomUUID().slice(0, 4)}`,
          track: "general",
        })
        .returning(),
    );

    await db.insert(terms).values([
      {
        schoolId: studentMembership.schoolId,
        sessionId: lockedSession.id,
        number: 1,
        name: "First Term",
        startDate: "2029-09-15",
        endDate: "2029-12-18",
        status: "closed",
      },
      {
        schoolId: studentMembership.schoolId,
        sessionId: lockedSession.id,
        number: 2,
        name: "Second Term",
        startDate: "2030-01-05",
        endDate: "2030-04-02",
        status: "closed",
      },
      {
        schoolId: studentMembership.schoolId,
        sessionId: lockedSession.id,
        number: 3,
        name: "Third Term",
        startDate: "2030-04-26",
        endDate: "2030-07-23",
        status: "closed",
      },
    ]);

    const probeLevel = one(
      await db
        .insert(levels)
        .values({
          schoolId: studentMembership.schoolId,
          name: "Probe Level",
          sequence: 999,
          stage: "junior",
        })
        .returning(),
    );

    const secondTerm = seeded.terms.find((term) => term.number === 2);
    if (!secondTerm) throw new Error("seed did not produce Term 2");

    fixtures = {
      studentMembershipId: studentMembership.id,
      studentRoleId: studentRole.id,
      academicSessionId: sessionId,
      demoClassId,
      archiveClassId: archiveClass.id,
      someLevelId,
      archiveTargetLevelId: probeLevel.id,
      activeTermId: activeTerm.id,
      plannedTermId: plannedTerm.id,
      lockableSessionId: lockableSession.id,
      lockedSessionId: lockedSession.id,
      termId: secondTerm.id,
      cloneTargetSessionId: plannedSession.id,
      someSubjectId: someSubject.id,
      archiveTargetSubjectId: archiveTargetSubject.id,
      someElectiveGroupId: someElectiveGroup.id,
      archiveTargetGroupId: archiveTargetGroup.id,
      withdrawTargetOfferingId: withdrawOffering.id,
      enrollableStudentId: enrollableStudent.id,
      enrolledEnrollmentId: enrollmentRow.id,
      enrolledOfferingId: electiveOffering.id,
      transferTargetClassId: transferTarget.id,
      scopedClassId: scopedClass.id,
      scopedEnrollmentId: scopedEnrollment.id,
    };
  });

  for (const row of matrix) {
    describe(row.name, () => {
      for (const [role, expectedStatus] of Object.entries(row.expected)) {
        it(`as ${role} → ${expectedStatus}`, async () => {
          const agent = await cookies[role as RoleKey];
          await row.setup?.(fixtures);
          const req = row.buildRequest(fixtures);
          const res = await agent[row.method](apiPath(req.path)).send(req.body);
          if (res.status !== expectedStatus) {
            console.log(
              `[${role}] ${row.name} → ${res.status}`,
              JSON.stringify(res.body),
            );
          }

          expect(res.status).toBe(expectedStatus);

          // A 403 must be the permission gate — not MUST_CHANGE_PASSWORD,
          // not rate-limited, not any other 403-producing condition.
          // (The target choice above ensures it isn't the self-check or
          // the rank check either. Only the permission gate can produce
          // a 403 for teacher/guardian here.)
          if (expectedStatus === 403) {
            expect(res.body.error.code).toBe("FORBIDDEN");
          }
        }, 15000);
      }
    });
  }
});
