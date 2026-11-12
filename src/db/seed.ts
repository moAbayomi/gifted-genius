import { and, eq, sql } from "drizzle-orm";
import { db } from "./client.js";
import {
  users,
  schools,
  roles,
  memberships,
  membershipRoles,
  classes,
  terms,
  type School,
  type User,
  type Role,
  type AcademicSession,
  type Class,
  type Term,
  academicSessions,
  levels,
  subjects,
  electiveGroups,
  classSubjects,
  studentProfiles,
  classEnrollments,
  studentSubjects,
  type Level,
  type Subject,
  type ClassSubject,
  type StudentProfile,
  type ClassEnrollment,
} from "./schema/index.js";
import { createSchoolWithDefaults } from "../modules/schools/service.js";
import { one } from "../shared/utils/assert.js";
import { hashPassword } from "../shared/utils/password.js";
import { recordAudit } from "../shared/audit/record.js";
import type { RoleKey } from "../modules/rbac/default-roles.js";
import type { Tx } from "./types.js";

const DEMO_SLUG = "demo";
const DEMO_OWNER_EMAIL = "owner@demo.test";

type DemoUser = {
  roleKey: RoleKey;
  email?: string;
  username?: string;
  firstName: string;
  lastName: string;
};

const DEMO_USERS: DemoUser[] = [
  {
    roleKey: "principal",
    email: "principal@demo.test",
    firstName: "Demo",
    lastName: "Principal",
  },
  {
    roleKey: "teacher",
    email: "teacher@demo.test",
    firstName: "Demo",
    lastName: "Teacher",
  },
  {
    roleKey: "guardian",
    email: "guardian@demo.test",
    firstName: "Demo",
    lastName: "Guardian",
  },
  {
    roleKey: "student",
    username: "jss1-2026-001",
    firstName: "Demo",
    lastName: "Student",
  },
];

// seed.ts (refactored)

export async function seed(opts: { password: string }): Promise<{
  school: School;
  owner: User;
  demoUsers: User[];
  academicSession: AcademicSession;
  terms: Term[];
  demoClasses: Class[];
  levels: Level[];
  subjects: Subject[];
  demoStudent: { profile: StudentProfile; enrollment: ClassEnrollment } | null;
}> {
  const passwordHash = await hashPassword(opts.password);

  return db.transaction(async (tx) => {
    const owner = await ensureDemoOwner(tx, passwordHash);
    const school = await ensureDemoSchool(tx, owner);
    const levelsList = await tx.select().from(levels).where(eq(levels.schoolId, school.id));


    const academicSession = await ensureAcademicSession(tx, school.id);

    const seededTerms: Term[] = [
      await ensureTerm(
        tx,
        school.id,
        academicSession.id,
        1,
        "First Term",
        "2026-09-15",
        "2026-12-18",
      ),
      await ensureTerm(
        tx,
        school.id,
        academicSession.id,
        2,
        "Second Term",
        "2027-01-05",
        "2027-04-02",
      ),
      await ensureTerm(
        tx,
        school.id,
        academicSession.id,
        3,
        "Third Term",
        "2027-04-26",
        "2027-07-23",
      ),
    ];

    const demoClasses = await ensureDemoClasses(tx, school, academicSession);

    const demoUsers: User[] = [];
    for (const demo of DEMO_USERS) {
      const user = await ensureDemoUser(tx, school, demo, passwordHash);
      demoUsers.push(user);
      console.log(`✓ ${demo.roleKey}: ${demo.email ?? demo.username}`);
    }

    const catalogue = await ensureDemoCatalogue(
      tx,
      school,
      academicSession,
      demoClasses,
      levelsList,
      demoUsers,
    );

    return {
      school,
      owner,
      demoUsers,
      academicSession,
      terms: seededTerms,
      demoClasses,
      levels: levelsList,
      subjects: catalogue.subjects,
      demoStudent: catalogue.demoStudent,
    };
  });
}

// ── Demo catalogue: subjects, group, offerings, demo student ─────────
async function ensureSubject(
  tx: Tx,
  schoolId: string,
  code: string,
  name: string,
): Promise<Subject> {
  const [inserted] = await tx
    .insert(subjects)
    .values({ schoolId, code, name })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    await recordAudit(tx, {
      schoolId,
      actorMembershipId: null,
      action: "subject.created",
      targetType: "subject",
      targetId: inserted.id,
      after: { code: inserted.code, name: inserted.name },
      metadata: { via: "seed" },
    });
    return inserted;
  }
  return one(
    await tx
      .select()
      .from(subjects)
      .where(and(eq(subjects.schoolId, schoolId), eq(subjects.code, code))),
  );
}

async function ensureOffering(
  tx: Tx,
  schoolId: string,
  classId: string,
  subjectId: string,
  isCompulsory: boolean,
  electiveGroupId: string | null,
): Promise<ClassSubject> {
  const [inserted] = await tx
    .insert(classSubjects)
    .values({
      schoolId,
      classId,
      subjectId,
      isCompulsory,
      electiveGroupId,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    await recordAudit(tx, {
      schoolId,
      actorMembershipId: null,
      action: "offering.created",
      targetType: "class_subject",
      targetId: inserted.id,
      after: {
        classId: inserted.classId,
        subjectId: inserted.subjectId,
        isCompulsory: inserted.isCompulsory,
      },
      metadata: { via: "seed" },
    });
    return inserted;
  }
  return one(
    await tx
      .select()
      .from(classSubjects)
      .where(
        and(
          eq(classSubjects.schoolId, schoolId),
          eq(classSubjects.classId, classId),
          eq(classSubjects.subjectId, subjectId),
        ),
      ),
  );
}

async function ensureDemoCatalogue(
  tx: Tx,
  school: School,
  session: AcademicSession,
  demoClasses: Class[],
  allLevels: Level[],
  demoUsers: User[],
): Promise<{
  subjects: Subject[];
  demoStudent: { profile: StudentProfile; enrollment: ClassEnrollment } | null;
}> {
  const english = await ensureSubject(tx, school.id, "ENG", "English");
  const math = await ensureSubject(tx, school.id, "MTH", "Mathematics");
  const basicScience = await ensureSubject(tx, school.id, "BSC", "Basic Science");
  const crs = await ensureSubject(tx, school.id, "CRS", "Christian Religious Studies");
  const irs = await ensureSubject(tx, school.id, "IRS", "Islamic Religious Studies");

  const jss2 = allLevels.find((l) => l.name === "JSS 2");
  const jss2a = demoClasses.find(
    (c) => c.levelId === jss2?.id && c.armLabel === "A",
  );
  if (!jss2a) return { subjects: [english, math, basicScience, crs, irs], demoStudent: null };

  for (const subject of [english, math, basicScience]) {
    await ensureOffering(tx, school.id, jss2a.id, subject.id, true, null);
  }

  const [groupInserted] = await tx
    .insert(electiveGroups)
    .values({
      schoolId: school.id,
      classId: jss2a.id,
      sessionId: session.id,
      name: "Religion",
      minChoices: 1,
      maxChoices: 1,
    })
    .onConflictDoNothing()
    .returning();
  const group = groupInserted ??
    one(
      await tx
        .select()
        .from(electiveGroups)
        .where(
          and(
            eq(electiveGroups.classId, jss2a.id),
            eq(electiveGroups.name, "Religion"),
          ),
        ),
    );
  if (groupInserted) {
    await recordAudit(tx, {
      schoolId: school.id,
      actorMembershipId: null,
      action: "elective_group.created",
      targetType: "elective_group",
      targetId: group.id,
      after: {
        classId: group.classId,
        name: group.name,
        minChoices: group.minChoices,
        maxChoices: group.maxChoices,
      },
      metadata: { via: "seed" },
    });
  }

  const crsOffering = await ensureOffering(
    tx, school.id, jss2a.id, crs.id, false, group.id,
  );
  const irsOffering = await ensureOffering(
    tx, school.id, jss2a.id, irs.id, false, group.id,
  );

  const studentUser = demoUsers.find((u) => u.email === null);
  if (!studentUser) {
    return { subjects: [english, math, basicScience, crs, irs], demoStudent: null };
  }
  const membership = one(
    await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, studentUser.id),
          eq(memberships.schoolId, school.id),
        ),
      ),
  );

  const [profileInserted] = await tx
    .insert(studentProfiles)
    .values({
      schoolId: school.id,
      membershipId: membership.id,
      admissionNumber: "DEMO/2026/001",
    })
    .onConflictDoNothing()
    .returning();
  const profile = profileInserted ??
    one(
      await tx
        .select()
        .from(studentProfiles)
        .where(
          and(
            eq(studentProfiles.schoolId, school.id),
            eq(studentProfiles.membershipId, membership.id),
          ),
        ),
    );

  let enrollment = await tx
    .select()
    .from(classEnrollments)
    .where(
      and(
        eq(classEnrollments.studentId, profile.id),
        eq(classEnrollments.sessionId, session.id),
        eq(classEnrollments.status, "active"),
      ),
    )
    .limit(1);
  if (enrollment.length === 0) {
    const [created] = await tx
      .insert(classEnrollments)
      .values({
        schoolId: school.id,
        studentId: profile.id,
        classId: jss2a.id,
        sessionId: session.id,
        startedAt: new Date(),
        status: "active",
      })
      .returning();
    enrollment = [created!];
  }

  await tx
    .insert(studentSubjects)
    .values({
      schoolId: school.id,
      enrollmentId: enrollment[0]!.id,
      classId: jss2a.id,
      sessionId: session.id,
      classSubjectId: irsOffering.id,
    })
    .onConflictDoNothing();

  // CRS is intentionally not chosen; the group remains incomplete until the
  // student chooses one. IRS is visible in the roster as the active choice.
  void crsOffering;

  return {
    subjects: [english, math, basicScience, crs, irs],
    demoStudent: { profile, enrollment: enrollment[0]! },
  };
}

// ── Owner ─────────────────────────────────────────────────────────────
async function ensureDemoOwner(tx: Tx, passwordHash: string): Promise<User> {
  const inserted = await tx
    .insert(users)
    .values({
      email: DEMO_OWNER_EMAIL,
      passwordHash,
      firstName: "Demo",
      lastName: "Owner",
      mustChangePassword: false,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    const user = inserted[0]!;
    await recordAudit(tx, {
      schoolId: null,
      actorMembershipId: null,
      action: "user.created",
      targetType: "user",
      targetId: user.id,
      after: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
      },
      metadata: { via: "seed", roleKey: "owner" },
    });
    return user;
  }

  // Existed — backfill password if it was created earlier without one
  let user = one(
    await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${DEMO_OWNER_EMAIL.toLowerCase()}`),
  );
  if (!user.passwordHash) {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(users.id, user.id));
    user = one(await tx.select().from(users).where(eq(users.id, user.id)));
  }
  return user;
}

// ── School ────────────────────────────────────────────────────────────
async function ensureDemoSchool(tx: Tx, owner: User): Promise<School> {
  const existing = await tx
    .select()
    .from(schools)
    .where(eq(schools.slug, DEMO_SLUG));

  if (existing.length > 0) {
    console.log("✓ Demo school exists — skipping");
    return existing[0]!;
  }

  const result = await createSchoolWithDefaults(
    {
      name: "Demo Grammar School, Osogbo",
      slug: DEMO_SLUG,
      ownerUserId: owner.id,
    },
    { tx, via: "seed" },
  );
  console.log("✓ Created demo school");
  return result.school;
}

// ── One demo user (one transaction) ──────────────────────────────────
async function ensureDemoUser(
  tx: Tx,
  school: School,
  demo: DemoUser,
  passwordHash: string,
): Promise<User> {
  const role = one(
    await tx
      .select()
      .from(roles)
      .where(and(eq(roles.schoolId, school.id), eq(roles.key, demo.roleKey))),
  );

  // ── Email-keyed user (principal / teacher / guardian) ──
  if (demo.email) {
    const inserted = await tx
      .insert(users)
      .values({
        email: demo.email,
        passwordHash,
        firstName: demo.firstName,
        lastName: demo.lastName,
        mustChangePassword: false,
      })
      .onConflictDoNothing()
      .returning();

    let user: User;
    let wasCreated = false;

    if (inserted.length > 0) {
      user = inserted[0]!;
      wasCreated = true;
    } else {
      user = one(
        await tx
          .select()
          .from(users)
          .where(sql`lower(${users.email}) = ${demo.email.toLowerCase()}`),
      );
      if (!user.passwordHash) {
        await tx
          .update(users)
          .set({ passwordHash, mustChangePassword: false })
          .where(eq(users.id, user.id));
        user = one(await tx.select().from(users).where(eq(users.id, user.id)));
      }
    }

    await ensureMembershipAndRole(tx, user, school, role);

    if (wasCreated) {
      await recordAudit(tx, {
        schoolId: null,
        actorMembershipId: null,
        action: "user.created",
        targetType: "user",
        targetId: user.id,
        after: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          status: user.status,
        },
        metadata: { via: "seed", roleKey: demo.roleKey },
      });
    }
    return user;
  }

  // ── Username-keyed user (student, no email) ──
  const existingMembership = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.schoolId, school.id),
        eq(memberships.username, demo.username!),
      ),
    );

  if (existingMembership.length > 0) {
    return one(
      await tx
        .select()
        .from(users)
        .where(eq(users.id, existingMembership[0]!.userId)),
    );
  }

  const user = one(
    await tx
      .insert(users)
      .values({
        email: null,
        passwordHash,
        firstName: demo.firstName,
        lastName: demo.lastName,
        mustChangePassword: false,
      })
      .returning(),
  );

  await tx.insert(memberships).values({
    userId: user.id,
    schoolId: school.id,
    username: demo.username!,
    status: "active",
  });

  await ensureMembershipAndRole(tx, user, school, role);

  await recordAudit(tx, {
    schoolId: null,
    actorMembershipId: null,
    action: "user.created",
    targetType: "user",
    targetId: user.id,
    after: {
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
    },
    metadata: { via: "seed", roleKey: demo.roleKey, username: demo.username },
  });

  return user;
}

// Shared: ensure membership + role assignment exist
async function ensureMembershipAndRole(
  tx: Tx,
  user: User,
  school: School,
  role: Role,
) {
  await tx
    .insert(memberships)
    .values({ userId: user.id, schoolId: school.id, status: "active" })
    .onConflictDoNothing();

  const membership = one(
    await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.schoolId, school.id),
        ),
      ),
  );

  await tx
    .insert(membershipRoles)
    .values({
      membershipId: membership.id,
      roleId: role.id,
      schoolId: school.id,
    })
    .onConflictDoNothing();
}

async function ensureAcademicSession(
  tx: Tx,
  schoolId: string,
): Promise<AcademicSession> {
  const [inserted] = await tx
    .insert(academicSessions)
    .values({ schoolId, label: "2026/2027" })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    await recordAudit(tx, {
      schoolId,
      actorMembershipId: null,
      action: "academic_session.created",
      targetType: "academic_session",
      targetId: inserted.id,
      after: { label: inserted.label, closedAt: inserted.closedAt },
      metadata: { via: "seed" },
    });
    return inserted;
  }
  // Row existed → fetch it. (Also handles a race: another process
  // inserted between our intent and our insert.)
  return one(
    await tx
      .select()
      .from(academicSessions)
      .where(
        and(
          eq(academicSessions.schoolId, schoolId),
          eq(academicSessions.label, "2026/2027"),
        ),
      ),
  );
}

async function ensureTerm(
  tx: Tx,
  schoolId: string,
  sessionId: string,
  number: number,
  name: string,
  startDate: string,
  endDate: string,
): Promise<Term> {
  let status: "planned" | "active" = "planned";

  if (number === 1) {
    const [active] = await tx
      .select({ id: terms.id })
      .from(terms)
      .where(and(eq(terms.schoolId, schoolId), eq(terms.status, "active")))
      .limit(1);
    status = active ? "planned" : "active";
  }

  const [inserted] = await tx
    .insert(terms)
    .values({ schoolId, sessionId, number, name, startDate, endDate, status })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    await recordAudit(tx, {
      schoolId,
      actorMembershipId: null,
      action: "term.created",
      targetType: "term",
      targetId: inserted.id,
      after: {
        number: inserted.number,
        name: inserted.name,
        startDate: inserted.startDate,
        endDate: inserted.endDate,
        status: inserted.status,
      },
      metadata: { via: "seed" },
    });
    return inserted;
  }

  // Row existed — do NOT re-audit. Return as-is.
  return one(
    await tx
      .select()
      .from(terms)
      .where(and(eq(terms.sessionId, sessionId), eq(terms.number, number))),
  );
}

async function ensureDemoClasses(
  tx: Tx,
  school: School,
  session: AcademicSession,
): Promise<Class[]> {
  const allLevels = await tx
    .select()
    .from(levels)
    .where(eq(levels.schoolId, school.id));

  const levelByName = Object.fromEntries(
    allLevels.map((level) => [level.name, level]),
  );

  const classDefs = [
    // Junior: only "general"
    { levelName: "JSS 1", armLabel: "A", track: "general" as const },
    { levelName: "JSS 1", armLabel: "B", track: "general" as const },
    { levelName: "JSS 2", armLabel: "A", track: "general" as const },
    { levelName: "JSS 3", armLabel: "A", track: "general" as const },
    // Senior: science / arts / commercial
    { levelName: "SS 1", armLabel: "A", track: "science" as const },
    { levelName: "SS 1", armLabel: "B", track: "arts" as const },
    { levelName: "SS 1", armLabel: "C", track: "commercial" as const },
    { levelName: "SS 2", armLabel: "A", track: "science" as const },
    { levelName: "SS 3", armLabel: "A", track: "science" as const },
  ];

  const result: Class[] = [];
  for (const def of classDefs) {
    const level = levelByName[def.levelName];
    if (!level) continue; // skip if the level is missing
    if (level.archivedAt !== null) continue; // never seed a live class under a retired level

    const cls = await ensureClass(
      tx,
      school.id,
      session.id,
      level.id,
      def.armLabel,
      def.track,
    );
    result.push(cls);
  }
  return result;
}

async function ensureClass(
  tx: Tx,
  schoolId: string,
  sessionId: string,
  levelId: string,
  armLabel: string,
  track: Class["track"],
): Promise<Class> {
  const [inserted] = await tx
    .insert(classes)
    .values({ schoolId, sessionId, levelId, armLabel, track })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    await recordAudit(tx, {
      schoolId,
      actorMembershipId: null,
      action: "class.created",
      targetType: "class",
      targetId: inserted.id,
      after: {
        sessionId: inserted.sessionId,
        levelId: inserted.levelId,
        armLabel: inserted.armLabel,
        track: inserted.track,
      },
      metadata: { via: "seed" },
    });
    return inserted;
  }

  // Row existed → re-select by the unique tuple.
  // Includes schoolId for tenant scoping (defense-in-depth; the session
  // already implies the school, but consistent with the rest of the repo).
  return one(
    await tx
      .select()
      .from(classes)
      .where(
        and(
          eq(classes.schoolId, schoolId),
          eq(classes.sessionId, sessionId),
          eq(classes.levelId, levelId),
          eq(classes.armLabel, armLabel),
          eq(classes.track, track),
        ),
      ),
  );
}
