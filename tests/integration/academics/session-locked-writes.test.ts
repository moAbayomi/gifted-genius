import { describe, it, expect, beforeEach } from "vitest";
import { count, eq } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import {
  schools,
  users,
  memberships,
  academicSessions,
  levels,
  classes,
  electiveGroups,
  subjects,
  classSubjects,
  studentProfiles,
  classEnrollments,
  studentSubjects,
  type School,
  type AcademicSession,
  type Class,
  type Level,
  roles,
  membershipRoles,
} from "../../../src/db/schema/index.js";
import type { ElectiveGroup } from "../../../src/db/schema/elective-groups.js";
import type { Subject } from "../../../src/db/schema/subjects.js";
import type { ClassSubject } from "../../../src/db/schema/class-subjects.js";
import { one } from "../../../src/shared/utils/assert.js";
import {
  archiveClass,
  cloneClasses,
  createClass,
  unarchiveClass,
  updateClass,
} from "../../../src/modules/academics/classes/service.js";
import {
  createElectiveGroup,
  updateElectiveGroup,
  archiveElectiveGroup,
} from "../../../src/modules/academics/elective-groups/service.js";
import {
  addOfferings,
  withdrawOffering,
} from "../../../src/modules/academics/offerings/service.js";
import type { Actor } from "../../../src/modules/rbac/can.js";
import type { Tx } from "../../../src/db/types.js";
import { enrollStudent } from "../../../src/modules/academics/enrollment/service.js";
import { setElectives } from "../../../src/modules/academics/enrollment/electives.js";
import { transferStudent } from "../../../src/modules/academics/enrollment/transfer.js";
import { withdrawEnrollment } from "../../../src/modules/academics/enrollment/withdraw.js";

// ── Operation table ───────────────────────────────────────────────────

interface OpCtx {
  tx: Tx;
  actor: Actor;
  level: Level;
  session: AcademicSession;
  cls: Class;
  archivedClass: Class;
  group: ElectiveGroup;
  sourceSessionId: string;
  newSubject: Subject;
  offering: ClassSubject;
  enrollableStudentId: string;
  enrollmentId: string;
  electiveOfferingId: string;
  targetClassId: string;   // ← new
}

interface Operation {
  name: string;
  run: (ctx: OpCtx) => Promise<unknown>;
}

const lockedSessionWrites: Operation[] = [
  {
    name: "createClass",
    run: ({ tx, actor, session, level }) =>
      createClass(tx, actor, {
        sessionId: session.id,
        levelId: level.id,
        armLabel: `X-${crypto.randomUUID().slice(0, 4)}`,
        track: "general",
      }),
  },
  {
    name: "updateClass",
    run: ({ tx, actor, cls }) =>
      updateClass(tx, actor, cls.id, {
        armLabel: `U-${crypto.randomUUID().slice(0, 4)}`,
      }),
  },
  {
    name: "archiveClass",
    run: ({ tx, actor, cls }) => archiveClass(tx, actor, cls.id),
  },
  {
    name: "unarchiveClass",
    run: ({ tx, actor, archivedClass }) =>
      unarchiveClass(tx, actor, archivedClass.id),
  },
  {
    name: "cloneClasses (target session)",
    run: ({ tx, actor, session, sourceSessionId }) =>
      cloneClasses(tx, actor, {
        fromSessionId: sourceSessionId,
        toSessionId: session.id,
      }),
  },
  {
    name: "createElectiveGroup",
    run: ({ tx, actor, cls }) =>
      createElectiveGroup(tx, actor, {
        classId: cls.id,
        name: `G-${crypto.randomUUID().slice(0, 4)}`,
        minChoices: 1,
        maxChoices: 2,
      }),
  },
  {
    name: "updateElectiveGroup",
    run: ({ tx, actor, group }) =>
      updateElectiveGroup(tx, actor, group.id, {
        name: `Gr-${crypto.randomUUID().slice(0, 4)}`,
      }),
  },
  {
    name: "archiveElectiveGroup",
    run: ({ tx, actor, group }) => archiveElectiveGroup(tx, actor, group.id),
  },
  {
    name: "addOfferings",
    run: ({ tx, actor, cls, newSubject }) =>
      addOfferings(tx, actor, {
        classId: cls.id,
        subjects: [
          {
            subjectId: newSubject.id,
            isCompulsory: true,
            electiveGroupId: null,
          },
        ],
      }),
  },
  {
    name: "withdrawOffering",
    run: ({ tx, actor, offering }) => withdrawOffering(tx, actor, offering.id),
  },
  {
    name: "enrollStudent",
    run: ({ tx, actor, enrollableStudentId, offering }) =>
      enrollStudent(tx, actor, {
        studentId: enrollableStudentId,
        classId: offering.classId,
      }),
  },
  {
    name: "setElectives",
    run: ({ tx, actor, enrollmentId, electiveOfferingId }) =>
      setElectives(tx, actor, {
        enrollmentId,
        offeringIds: [electiveOfferingId],
      }),
  },
  {
    name: "transferStudent",
    run: ({ tx, actor, enrollmentId, targetClassId }) =>
      transferStudent(tx, actor, { enrollmentId, targetClassId }),
  },
  {
    name: "withdrawEnrollment",
    run: ({ tx, actor, enrollmentId }) =>
      withdrawEnrollment(tx, actor, { enrollmentId }),
  },
];

// ── Setup ─────────────────────────────────────────────────────────────

type SessionState = "open" | "closed";

let actor: Actor;
let openCtx: Omit<OpCtx, "tx" | "actor">;
let closedCtx: Omit<OpCtx, "tx" | "actor">;

async function seedSession(
  school: School,
  level: Level,
  state: SessionState,
  label: string,
): Promise<Omit<OpCtx, "tx" | "actor" | "sourceSessionId">> {
  const session = one(
    await db
      .insert(academicSessions)
      .values({
        schoolId: school.id,
        label,
        closedAt: state === "closed" ? new Date() : null,
      })
      .returning(),
  );

  const cls = one(
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

  const archivedClass = one(
    await db
      .insert(classes)
      .values({
        schoolId: school.id,
        sessionId: session.id,
        levelId: level.id,
        armLabel: "B",
        track: "general",
        archivedAt: new Date(),
      })
      .returning(),
  );

  const group = one(
    await db
      .insert(electiveGroups)
      .values({
        schoolId: school.id,
        classId: cls.id,
        sessionId: session.id,
        name: "G",
        minChoices: 1,
        maxChoices: 2,
      })
      .returning(),
  );

  const offeringCls = one(
    await db
      .insert(classes)
      .values({
        schoolId: school.id,
        sessionId: session.id,
        levelId: level.id,
        armLabel: "O",
        track: "general",
      })
      .returning(),
  );

  const newSubject = one(
    await db
      .insert(subjects)
      .values({
        schoolId: school.id,
        code: `NEW-${crypto.randomUUID().slice(0, 6)}`,
        name: `New Subject ${crypto.randomUUID().slice(0, 4)}`,
      })
      .returning(),
  );

  const existingSubject = one(
    await db
      .insert(subjects)
      .values({
        schoolId: school.id,
        code: `EXIST-${crypto.randomUUID().slice(0, 6)}`,
        name: `Existing Subject ${crypto.randomUUID().slice(0, 4)}`,
      })
      .returning(),
  );

  const offering = one(
    await db
      .insert(classSubjects)
      .values({
        schoolId: school.id,
        classId: offeringCls.id,
        subjectId: existingSubject.id,
        isCompulsory: false,
        electiveGroupId: null,
      })
      .returning(),
  );

  const compulsorySubject = one(
    await db
      .insert(subjects)
      .values({
        schoolId: school.id,
        code: `COMP-${crypto.randomUUID().slice(0, 6)}`,
        name: `Compulsory ${crypto.randomUUID().slice(0, 4)}`,
      })
      .returning(),
  );
  await db.insert(classSubjects).values({
    schoolId: school.id,
    classId: offeringCls.id,
    subjectId: compulsorySubject.id,
    isCompulsory: true,
    electiveGroupId: null,
  });

  // Student #1: enrolled in `cls` — for addOfferings auto-enroll
  const studentUser = one(
    await db
      .insert(users)
      .values({
        email: `student-${crypto.randomUUID().slice(0, 8)}@test`,
        firstName: "Stu",
        lastName: "Dent",
      })
      .returning(),
  );
  const studentMembership = one(
    await db
      .insert(memberships)
      .values({ userId: studentUser.id, schoolId: school.id })
      .returning(),
  );
  const student = one(
    await db
      .insert(studentProfiles)
      .values({
        schoolId: school.id,
        membershipId: studentMembership.id,
        admissionNumber: `STU-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning(),
  );
  await db.insert(classEnrollments).values({
    schoolId: school.id,
    studentId: student.id,
    classId: cls.id,
    sessionId: session.id,
    startedAt: new Date(),
    endedAt: null,
    endedReason: null,
    transferredFromEnrollmentId: null,
  });

  // Student #2: NOT enrolled — for enrollStudent's open control
  const enrollableUser = one(
    await db
      .insert(users)
      .values({
        email: `enrollable-${crypto.randomUUID().slice(0, 8)}@test`,
        firstName: "Enr",
        lastName: "Ollable",
      })
      .returning(),
  );
  const enrollableMembership = one(
    await db
      .insert(memberships)
      .values({
        userId: enrollableUser.id,
        schoolId: school.id,
        status: "active",
      })
      .returning(),
  );
  const enrollableRole = one(
    await db
      .insert(roles)
      .values({
        schoolId: school.id,
        key: `enroll-student-${crypto.randomUUID().slice(0, 6)}`,
        name: "Student",
        kind: "student",
        rank: 10,
        isSystem: false,
      })
      .returning(),
  );
  await db.insert(membershipRoles).values({
    membershipId: enrollableMembership.id,
    roleId: enrollableRole.id,
    schoolId: school.id,
  });
  const enrollableStudent = one(
    await db
      .insert(studentProfiles)
      .values({
        schoolId: school.id,
        membershipId: enrollableMembership.id,
        admissionNumber: `ENR-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning(),
  );

  // Student #3: enrolled in `offeringCls` — for setElectives / transfer / withdraw
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
        schoolId: school.id,
        status: "active",
      })
      .returning(),
  );
  await db.insert(membershipRoles).values({
    membershipId: enrolledMembership.id,
    roleId: enrollableRole.id,
    schoolId: school.id,
  });
  const enrolledStudent = one(
    await db
      .insert(studentProfiles)
      .values({
        schoolId: school.id,
        membershipId: enrolledMembership.id,
        admissionNumber: `ENRD-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning(),
  );
  const enrollment = one(
    await db
      .insert(classEnrollments)
      .values({
        schoolId: school.id,
        studentId: enrolledStudent.id,
        classId: offeringCls.id,
        sessionId: session.id,
        startedAt: new Date(),
        endedAt: null,
        endedReason: null,
        transferredFromEnrollmentId: null,
      })
      .returning(),
  );

  return {
    level,
    session,
    cls,
    archivedClass,
    group,
    newSubject,
    offering,
    enrollableStudentId: enrollableStudent.id,
    enrollmentId: enrollment.id,
    electiveOfferingId: offering.id,
    targetClassId: cls.id,     // ← transfer target: a different class in the same session
  };
}

describe("session-locked writes", () => {
  beforeEach(async () => {
    const school = one(
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
      permissions: new Set([
        "academics:read",
        "structure:manage",
        "enrollments:manage",
      ]),
    };

    const level = one(
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

    const openSeed = await seedSession(school, level, "open", "2025/2026");
    const closedSeed = await seedSession(school, level, "closed", "2024/2025");
    openCtx = { ...openSeed, sourceSessionId: closedSeed.session.id };
    closedCtx = { ...closedSeed, sourceSessionId: openSeed.session.id };
  });

  /**
   * Snapshot the enrollment's state + row counts around an operation.
   * For closed-session tests, this proves no partial write leaked through
   * — both the row status/endedAt and the table counts must be identical
   * before and after.
   */
  async function snapshotState(enrollmentId: string) {
    const [enr] = await db
      .select({
        status: classEnrollments.status,
        endedAt: classEnrollments.endedAt,
      })
      .from(classEnrollments)
      .where(eq(classEnrollments.id, enrollmentId));

    const cs = one(await db.select({ n: count() }).from(classSubjects));
    const ss = one(await db.select({ n: count() }).from(studentSubjects));
    const ce = one(await db.select({ n: count() }).from(classEnrollments));

    return {
      enrollment: enr ?? null,
      counts: {
        classSubjects: cs.n,
        studentSubjects: ss.n,
        classEnrollments: ce.n,
      },
    };
  }

  for (const op of lockedSessionWrites) {
    describe(op.name, () => {
      it("409 SESSION_LOCKED on a locked session, leaving no rows or state behind", async () => {
        const before = await snapshotState(closedCtx.enrollmentId);

        await expect(
          db.transaction((tx) => op.run({ tx, actor, ...closedCtx })),
        ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });

        // No table counts changed, AND the target enrollment's status/endedAt
        // are unchanged — the guard fired before any write (including any
        // status transition that a transfer/withdraw would have made).
        const after = await snapshotState(closedCtx.enrollmentId);
        expect(after).toEqual(before);
      });

      it("succeeds on an open session (control)", async () => {
        // Not all operations return a value — withdrawEnrollment /
        // setElectives return void or a result; awaiting without a matcher
        // asserts "no throw", which is the actual success criterion here.
        await db.transaction((tx) => op.run({ tx, actor, ...openCtx }));
      });
    });
  }
});
