import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import {
  schools,
  users,
  memberships,
  membershipRoles,
  roles,
  academicSessions,
  levels,
  classes,
  subjects,
  classSubjects,
  electiveGroups,
  studentProfiles,
  classEnrollments,
  studentSubjects,
  auditLog,
  type School,
  type AcademicSession,
  type Class,
  type Level,
  type Subject,
  type ClassSubject,
  type ElectiveGroup,
  type StudentProfile,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import { setElectives } from "../../../../src/modules/academics/enrollment/electives.js";
import { enrollStudent } from "../../../../src/modules/academics/enrollment/service.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

// ── Shared fixtures ───────────────────────────────────────────────────
let school: School;
let actor: Actor;
let level: Level;
let session: AcademicSession;
let cls: Class;
let group: ElectiveGroup; // IRS/CRS (min=1, max=1)
let irs: ClassSubject;
let crs: ClassSubject;
let tunde: StudentProfile;
let enrollmentId: string;

// ── Helpers ───────────────────────────────────────────────────────────

async function makeSubject(
  schoolId: string,
  code = `SUB-${crypto.randomUUID().slice(0, 8)}`,
): Promise<Subject> {
  return one(
    await db
      .insert(subjects)
      .values({
        schoolId,
        code,
        name: `Subject ${crypto.randomUUID().slice(0, 4)}`,
      })
      .returning(),
  );
}

async function addElectiveOffering(
  schoolId: string,
  classId: string,
  groupId: string | null,
  code?: string,
): Promise<ClassSubject> {
  const subj = await makeSubject(schoolId, code);
  return one(
    await db
      .insert(classSubjects)
      .values({
        schoolId,
        classId,
        subjectId: subj.id,
        isCompulsory: false,
        electiveGroupId: groupId,
      })
      .returning(),
  );
}

async function getRowByOffering(enrollmentIdArg: string, offeringId: string) {
  const [row] = await db
    .select()
    .from(studentSubjects)
    .where(
      and(
        eq(studentSubjects.enrollmentId, enrollmentIdArg),
        eq(studentSubjects.classSubjectId, offeringId),
      ),
    );
  return row ?? null;
}

async function countRowsForOffering(
  enrollmentIdArg: string,
  offeringId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(studentSubjects)
    .where(
      and(
        eq(studentSubjects.enrollmentId, enrollmentIdArg),
        eq(studentSubjects.classSubjectId, offeringId),
      ),
    );
  return rows.length;
}

async function countActiveElectives(
  enrollmentIdArg: string,
  electiveOfferingIds: string[],
): Promise<number> {
  const rows = await db
    .select()
    .from(studentSubjects)
    .where(
      and(
        eq(studentSubjects.enrollmentId, enrollmentIdArg),
        inArray(studentSubjects.classSubjectId, electiveOfferingIds),
        isNull(studentSubjects.droppedAt),
      ),
    );
  return rows.length;
}

function se(tx: any, offeringIds: string[]) {
  return setElectives(tx, actor, { enrollmentId, offeringIds });
}

// ── Suite ─────────────────────────────────────────────────────────────

describe("setElectives — integration", () => {
  beforeEach(async () => {
    school = one(
      await db
        .insert(schools)
        .values({ name: "S", slug: `s-${crypto.randomUUID()}` })
        .returning(),
    );
    const user = one(
      await db
        .insert(users)
        .values({
          email: `t-${crypto.randomUUID()}@test`,
          firstName: "T",
          lastName: "T",
        })
        .returning(),
    );
    const membership = one(
      await db
        .insert(memberships)
        .values({ userId: user.id, schoolId: school.id })
        .returning(),
    );
    actor = {
      userId: user.id,
      membershipId: membership.id,
      schoolId: school.id,
      rank: 100,
      permissions: new Set(["enrollments:manage"]),
    };

    level = one(
      await db
        .insert(levels)
        .values({
          schoolId: school.id,
          name: "JSS1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );
    session = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2025/2026" })
        .returning(),
    );
    cls = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: session.id,
          levelId: level.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );

    // Elective group (min=1, max=1) with IRS and CRS.
    group = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: school.id,
          classId: cls.id,
          sessionId: session.id,
          name: "Religion",
          minChoices: 1,
          maxChoices: 1,
        })
        .returning(),
    );
    irs = await addElectiveOffering(school.id, cls.id, group.id, "IRS");
    crs = await addElectiveOffering(school.id, cls.id, group.id, "CRS");

    // Enroll Tunde — no compulsory subjects, clean slate.
    const tundeUser = one(
      await db
        .insert(users)
        .values({
          email: `tunde-${crypto.randomUUID().slice(0, 8)}@test`,
          firstName: "Tunde",
          lastName: "Bello",
        })
        .returning(),
    );
    const tundeMembership = one(
      await db
        .insert(memberships)
        .values({
          userId: tundeUser.id,
          schoolId: school.id,
          status: "active",
        })
        .returning(),
    );
    const studentRole = one(
      await db
        .insert(roles)
        .values({
          schoolId: school.id,
          key: `student-${crypto.randomUUID().slice(0, 6)}`,
          name: "Student",
          kind: "student",
          rank: 10,
          isSystem: false,
        })
        .returning(),
    );
    await db.insert(membershipRoles).values({
      membershipId: tundeMembership.id,
      roleId: studentRole.id,
      schoolId: school.id,
    });
    tunde = one(
      await db
        .insert(studentProfiles)
        .values({
          schoolId: school.id,
          membershipId: tundeMembership.id,
          admissionNumber: `ADM-${crypto.randomUUID().slice(0, 8)}`,
        })
        .returning(),
    );

    const enrolled = await db.transaction((tx) =>
      enrollStudent(tx, actor, { studentId: tunde.id, classId: cls.id }),
    );
    enrollmentId = enrolled.enrollmentId;
  });

  // ══════════════════════════════════════════════════════════════════════
  // Main scenario: Tunde selects IRS → CRS → IRS
  // ══════════════════════════════════════════════════════════════════════
  describe("main scenario — Tunde's religion elective", () => {
    it("select IRS → IRS active, no CRS row; select CRS → IRS dropped, CRS active; select IRS again → IRS reactivated (same row)", async () => {
      // ── Step 1: select IRS ────────────────────────────────────────
      const r1 = await db.transaction((tx) => se(tx, [irs.id]));
      expect(r1.complete).toBe(true);
      expect(r1.active).toBe(1);
      expect(r1.dropped).toBe(0);

      const irsRowAfterStep1 = await getRowByOffering(enrollmentId, irs.id);
      expect(irsRowAfterStep1).not.toBeNull();
      expect(irsRowAfterStep1!.droppedAt).toBeNull();
      expect(await countRowsForOffering(enrollmentId, crs.id)).toBe(0);

      // ── Step 2: switch to CRS ─────────────────────────────────────
      const r2 = await db.transaction((tx) => se(tx, [crs.id]));
      expect(r2.complete).toBe(true);
      expect(r2.active).toBe(1);
      expect(r2.dropped).toBe(1);

      const irsRowAfterStep2 = await getRowByOffering(enrollmentId, irs.id);
      expect(irsRowAfterStep2).not.toBeNull();
      expect(irsRowAfterStep2!.droppedAt).not.toBeNull(); // dropped
      expect(irsRowAfterStep2!.id).toBe(irsRowAfterStep1!.id); // same row

      const crsRowAfterStep2 = await getRowByOffering(enrollmentId, crs.id);
      expect(crsRowAfterStep2).not.toBeNull();
      expect(crsRowAfterStep2!.droppedAt).toBeNull(); // active

      // Exactly one active row for the group, zero duplicates.
      expect(await countActiveElectives(enrollmentId, [irs.id, crs.id])).toBe(
        1,
      );
      expect(await countRowsForOffering(enrollmentId, irs.id)).toBe(1);
      expect(await countRowsForOffering(enrollmentId, crs.id)).toBe(1);

      // ── Step 3: switch back to IRS ────────────────────────────────
      const r3 = await db.transaction((tx) => se(tx, [irs.id]));
      expect(r3.complete).toBe(true);
      expect(r3.dropped).toBe(1); // CRS dropped

      const irsRowAfterStep3 = await getRowByOffering(enrollmentId, irs.id);
      expect(irsRowAfterStep3).not.toBeNull();
      expect(irsRowAfterStep3!.droppedAt).toBeNull(); // reactivated
      expect(irsRowAfterStep3!.id).toBe(irsRowAfterStep1!.id); // SAME row id
      expect(irsRowAfterStep3!.createdAt).toEqual(irsRowAfterStep1!.createdAt); // created_at preserved

      const crsRowAfterStep3 = await getRowByOffering(enrollmentId, crs.id);
      expect(crsRowAfterStep3!.droppedAt).not.toBeNull(); // dropped

      // Never more than one row per offering.
      expect(await countRowsForOffering(enrollmentId, irs.id)).toBe(1);
      expect(await countRowsForOffering(enrollmentId, crs.id)).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Group rules
  // ══════════════════════════════════════════════════════════════════════
  describe("group rules", () => {
    it("409 INVALID_ELECTIVE_SELECTION when group max is exceeded; nothing changed", async () => {
      // Set IRS first so there's state to preserve.
      await db.transaction((tx) => se(tx, [irs.id]));
      const before = await getRowByOffering(enrollmentId, irs.id);

      // Try to pick both → TOO_MANY (max=1)
      await expect(
        db.transaction((tx) => se(tx, [irs.id, crs.id])),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "INVALID_ELECTIVE_SELECTION",
      });

      // State unchanged.
      const after = await getRowByOffering(enrollmentId, irs.id);
      expect(after!.id).toBe(before!.id);
      expect(after!.droppedAt).toBeNull();
      expect(await countRowsForOffering(enrollmentId, crs.id)).toBe(0);
    });

    it("saves with complete:false when group min is not met (TOO_FEW is non-blocking)", async () => {
      const result = await db.transaction((tx) => se(tx, []));
      expect(result.complete).toBe(false);
      expect(result.problems.some((p) => p.severity === "incomplete")).toBe(
        true,
      );
      expect(result.problems.every((p) => p.severity !== "blocking")).toBe(
        true,
      );
    });

    it("empty selection with min-1 group drops all previously active electives, stays incomplete", async () => {
      await db.transaction((tx) => se(tx, [irs.id]));
      expect(await countActiveElectives(enrollmentId, [irs.id, crs.id])).toBe(
        1,
      );

      const result = await db.transaction((tx) => se(tx, []));
      expect(result.complete).toBe(false);
      expect(result.dropped).toBe(1);

      expect(await countActiveElectives(enrollmentId, [irs.id, crs.id])).toBe(
        0,
      );
      const irsRow = await getRowByOffering(enrollmentId, irs.id);
      expect(irsRow!.droppedAt).not.toBeNull();
    });

    it("ungrouped elective is allowed and does not affect group completeness", async () => {
      const ungrouped = await addElectiveOffering(
        school.id,
        cls.id,
        null, // no group
        "MUSIC",
      );

      // Pick IRS (satisfies the group) + ungrouped Music → complete.
      const r1 = await db.transaction((tx) => se(tx, [irs.id, ungrouped.id]));
      expect(r1.complete).toBe(true);
      expect(r1.active).toBe(2);

      // Pick only ungrouped Music → incomplete (group not satisfied).
      const r2 = await db.transaction((tx) => se(tx, [ungrouped.id]));
      expect(r2.complete).toBe(false);
      expect(r2.active).toBe(1);

      // Group is reported as too_few, ungrouped is not in any group.
      const religionStatus = r2.groups.find((g) => g.groupId === group.id);
      expect(religionStatus!.status).toBe("too_few");
      expect(r2.groups.every((g) => g.groupId !== ungrouped.id)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Rejections — bad input
  // ══════════════════════════════════════════════════════════════════════
  describe("bad input", () => {
    it("409 for a compulsory offering ID (not in the elective list)", async () => {
      const subj = await makeSubject(school.id, "MATH");
      const compulsory = one(
        await db
          .insert(classSubjects)
          .values({
            schoolId: school.id,
            classId: cls.id,
            subjectId: subj.id,
            isCompulsory: true,
            electiveGroupId: null,
          })
          .returning(),
      );

      await expect(
        db.transaction((tx) => se(tx, [compulsory.id])),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "INVALID_ELECTIVE_SELECTION",
      });
    });

    it("409 for an offering from another class", async () => {
      const otherCls = one(
        await db
          .insert(classes)
          .values({
            schoolId: school.id,
            sessionId: session.id,
            levelId: level.id,
            armLabel: "B",
            track: "general",
          })
          .returning(),
      );
      const otherOffering = await addElectiveOffering(
        school.id,
        otherCls.id,
        null,
        "OTHER",
      );

      await expect(
        db.transaction((tx) => se(tx, [otherOffering.id])),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "INVALID_ELECTIVE_SELECTION",
      });
    });

    it("409 for an offering from another school", async () => {
      const otherSchool = one(
        await db
          .insert(schools)
          .values({ name: "O", slug: `o-${crypto.randomUUID()}` })
          .returning(),
      );
      const otherLevel = one(
        await db
          .insert(levels)
          .values({
            schoolId: otherSchool.id,
            name: "JSS1",
            sequence: 1,
            stage: "junior",
          })
          .returning(),
      );
      const otherSession = one(
        await db
          .insert(academicSessions)
          .values({ schoolId: otherSchool.id, label: "2025/2026" })
          .returning(),
      );
      const otherCls = one(
        await db
          .insert(classes)
          .values({
            schoolId: otherSchool.id,
            sessionId: otherSession.id,
            levelId: otherLevel.id,
            armLabel: "A",
            track: "general",
          })
          .returning(),
      );
      const foreignOffering = await addElectiveOffering(
        otherSchool.id,
        otherCls.id,
        null,
        "FOREIGN",
      );

      await expect(
        db.transaction((tx) => se(tx, [foreignOffering.id])),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "INVALID_ELECTIVE_SELECTION",
      });
    });

    it("400 DUPLICATE_OFFERING when offeringIds contains duplicates", async () => {
      await expect(
        db.transaction((tx) => se(tx, [irs.id, irs.id])),
      ).rejects.toMatchObject({
        httpStatus: 400,
        code: "DUPLICATE_OFFERING",
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Rejections — state-based guards
  // ══════════════════════════════════════════════════════════════════════
  describe("state guards", () => {
    it("404 when the enrollment is ended", async () => {
      await db
        .update(classEnrollments)
        .set({ status: "withdrawn", endedAt: new Date(), endedReason: "withdrawn" })
        .where(eq(classEnrollments.id, enrollmentId));

      await expect(
        db.transaction((tx) => se(tx, [irs.id])),
      ).rejects.toMatchObject({
        httpStatus: 404,
        code: "ENROLLMENT_NOT_FOUND",
      });
    });

    it("409 SESSION_LOCKED when the session is closed", async () => {
      await db
        .update(academicSessions)
        .set({ closedAt: new Date() })
        .where(eq(academicSessions.id, session.id));

      await expect(
        db.transaction((tx) => se(tx, [irs.id])),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "SESSION_LOCKED",
      });
    });

    it("409 CLASS_ARCHIVED when the class is archived", async () => {
      await db
        .update(classes)
        .set({ archivedAt: new Date() })
        .where(eq(classes.id, cls.id));

      await expect(
        db.transaction((tx) => se(tx, [irs.id])),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "CLASS_ARCHIVED",
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Non-touching guarantees
  // ══════════════════════════════════════════════════════════════════════
  describe("does not touch unrelated rows", () => {
    it("compulsory subject rows are untouched", async () => {
      // Add a compulsory offering and manually create its student_subject row
      // (simulating what enrollStudent's auto-enroll would do).
      const subj = await makeSubject(school.id, "MATH");
      const compulsory = one(
        await db
          .insert(classSubjects)
          .values({
            schoolId: school.id,
            classId: cls.id,
            subjectId: subj.id,
            isCompulsory: true,
            electiveGroupId: null,
          })
          .returning(),
      );
      const compulsoryRow = one(
        await db
          .insert(studentSubjects)
          .values({
            schoolId: school.id,
            enrollmentId,
            classId: cls.id,
            sessionId: session.id,
            classSubjectId: compulsory.id,
            droppedAt: null,
          })
          .returning(),
      );

      // Set electives to IRS — compulsory row must stay untouched, and the
      // `active` result must count electives only, not the compulsory row.
      const result = await db.transaction((tx) => se(tx, [irs.id]));
      expect(result.active).toBe(1);

      const after = await db
        .select()
        .from(studentSubjects)
        .where(eq(studentSubjects.id, compulsoryRow.id));
      expect(after).toHaveLength(1);
      expect(after[0]!.droppedAt).toBeNull();
      expect(after[0]!.updatedAt).toEqual(compulsoryRow.updatedAt);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Idempotency
  // ══════════════════════════════════════════════════════════════════════
  describe("idempotency", () => {
    it("re-running the same selection is a no-op (no updated_at bump)", async () => {
      // Initial set.
      await db.transaction((tx) => se(tx, [irs.id]));
      const before = await getRowByOffering(enrollmentId, irs.id);
      expect(before!.droppedAt).toBeNull();

      // Retry with identical input.
      await db.transaction((tx) => se(tx, [irs.id]));

      const after = await getRowByOffering(enrollmentId, irs.id);
      expect(after!.id).toBe(before!.id);
      expect(after!.droppedAt).toBeNull();
      expect(after!.updatedAt).toEqual(before!.updatedAt);
    });

    it("re-running after a full switch (IRS → CRS → IRS) is idempotent", async () => {
      await db.transaction((tx) => se(tx, [irs.id]));
      await db.transaction((tx) => se(tx, [crs.id]));
      await db.transaction((tx) => se(tx, [irs.id]));
      const stable = await getRowByOffering(enrollmentId, irs.id);

      // Same input a second time — row unchanged.
      await db.transaction((tx) => se(tx, [irs.id]));
      const after = await getRowByOffering(enrollmentId, irs.id);
      expect(after!.id).toBe(stable!.id);
      expect(after!.updatedAt).toEqual(stable!.updatedAt);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Audit
  // ══════════════════════════════════════════════════════════════════════
  describe("audit", () => {
    it("writes exactly one audit row per setElectives call", async () => {
      await db.transaction((tx) => se(tx, [irs.id]));

      const audits = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.targetId, enrollmentId),
            eq(auditLog.action, "student_subjects.electives_set"),
          ),
        );
      expect(audits).toHaveLength(1);
    });
  });
});
