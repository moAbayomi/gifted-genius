import * as repo from "./repository.js";
import * as classRepo from "../classes/repository.js";
import { can } from "../../rbac/can.js";
import { AppError } from "../../../shared/lib/errors.js";
import { recordAudit } from "../../../shared/audit/record.js";
import type { Tx, DbExecutor } from "../../../db/types.js";
import type { Actor } from "../../rbac/can.js";
import type { AddOfferingsInput, ListOfferingsQuery } from "./schema.js";
import {
  classSubjects,
  type ClassSubject,
} from "../../../db/schema/class-subjects.js";

import type { OfferingWithSubject } from "./repository.js";
import { assertSessionOpen } from "../session-guard.js";
import { subjects } from "../../../db/schema/subjects.js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  electiveGroups,
  type ElectiveGroup,
} from "../../../db/schema/elective-groups.js";
import { classEnrollments } from "../../../db/schema/class-enrollments.js";
import { studentSubjects } from "../../../db/schema/student-subjects.js";

// ── addOfferings ──────────────────────────────────────────────────────

export async function addOfferings(
  tx: Tx,
  actor: Actor,
  input: AddOfferingsInput,
): Promise<OfferingWithSubject[]> {
  // 1. Permission
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot add offerings");
  }

  // 2. Dedupe check — subject IDs must be distinct.
  //    (Zod's .refine on addOfferingsSchema already rejects duplicates
  //     at the boundary; this is belt-and-braces if the schema ever loosens.)
  const subjectIds = input.subjects.map((s) => s.subjectId);
  if (new Set(subjectIds).size !== subjectIds.length) {
    throw new AppError(
      400,
      "DUPLICATE_SUBJECT",
      "Request contains duplicate subjectId entries",
    );
  }

  const classMeta = await classRepo.findClass(
    tx,
    actor.schoolId,
    input.classId,
  );
  if (!classMeta) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }

  await assertSessionOpen(tx, actor.schoolId, classMeta.sessionId);

  // 3. Lock the class — prevents a concurrent archive from racing this insert.
  const cls = await classRepo.lockClass(tx, actor.schoolId, input.classId);
  if (!cls) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }
  if (cls.archivedAt !== null) {
    throw new AppError(
      409,
      "CLASS_ARCHIVED",
      "Cannot add offerings to an archived class",
    );
  }

  // 5. Load every subject in ONE query. All must exist, none archived.
  const subjectRows = await tx
    .select()
    .from(subjects)
    .where(
      and(
        eq(subjects.schoolId, actor.schoolId),
        inArray(subjects.id, subjectIds),
        isNull(subjects.archivedAt),
      ),
    );

  if (subjectRows.length !== subjectIds.length) {
    const found = new Set(subjectRows.map((s) => s.id));
    const missing = subjectIds.filter((id) => !found.has(id));
    throw new AppError(
      404,
      "SUBJECT_NOT_FOUND",
      `Subject${missing.length === 1 ? "" : "s"} not found or archived: ${missing.join(", ")}`,
    );
  }

  const subjectById = new Map(subjectRows.map((s) => [s.id, s]));

  // 6. Load elective groups in ONE query (if any referenced).
  const groupIds = [
    ...new Set(
      input.subjects
        .map((s) => s.electiveGroupId)
        .filter((g): g is string => g !== null && g !== undefined),
    ),
  ];
  const groupById = new Map<string, ElectiveGroup>();
  if (groupIds.length > 0) {
    const groupRows = await tx
      .select()
      .from(electiveGroups)
      .where(
        and(
          eq(electiveGroups.schoolId, actor.schoolId),
          eq(electiveGroups.classId, input.classId),
          inArray(electiveGroups.id, groupIds),
          isNull(electiveGroups.archivedAt),
        ),
      )
      .for("share");

    if (groupRows.length !== groupIds.length) {
      const found = new Set(groupRows.map((g) => g.id));
      const missing = groupIds.filter((id) => !found.has(id));
      throw new AppError(
        404,
        "ELECTIVE_GROUP_NOT_FOUND",
        `Elective group${missing.length === 1 ? "" : "s"} not found in this class: ${missing.join(", ")}`,
      );
    }

    // NOTE: "group is not archived" — elective_groups has no archivedAt column
    // yet. If/when archiving is added, add an isNull(electiveGroups.archivedAt)
    // filter to the WHERE above and this becomes a live check.
    for (const g of groupRows) groupById.set(g.id, g);
  }

  // 7. Cross-row checks — compulsory vs. group, one per subject.
  for (const s of input.subjects) {
    if (
      s.isCompulsory &&
      s.electiveGroupId !== null &&
      s.electiveGroupId !== undefined
    ) {
      throw new AppError(
        400,
        "COMPULSORY_IN_GROUP",
        `Subject ${subjectById.get(s.subjectId)!.name} is compulsory; a compulsory offering cannot belong to an elective group`,
      );
    }
  }

  // 8. Load existing class_subjects for this class and subject set in ONE query.
  //    The unique key class_subjects_class_subject_uq is not partial, so this
  //    catches archived rows too. We distinguish them for a clearer error.
  const existing = await tx
    .select({
      subjectId: classSubjects.subjectId,
      archivedAt: classSubjects.archivedAt,
    })
    .from(classSubjects)
    .where(
      and(
        eq(classSubjects.classId, input.classId),
        inArray(classSubjects.subjectId, subjectIds),
      ),
    );

  if (existing.length > 0) {
    const live = existing.filter((e) => e.archivedAt === null);
    const withdrawn = existing.filter((e) => e.archivedAt !== null);

    if (live.length > 0) {
      const names = live.map((e) => subjectById.get(e.subjectId)!.name);
      throw new AppError(
        409,
        "OFFERING_ALREADY_EXISTS",
        `Already offered in this class: ${names.join(", ")}`,
      );
    }
    // All existing rows are withdrawn — refuse but with a clear next step.
    const names = withdrawn.map((e) => subjectById.get(e.subjectId)!.name);
    throw new AppError(
      409,
      "OFFERING_WITHDRAWN",
      `Previously withdrawn and must be unarchived explicitly: ${names.join(", ")}`,
    );
  }

  // 9. One bulk INSERT — atomicity and efficiency.
  const inserted = await tx
    .insert(classSubjects)
    .values(
      input.subjects.map((s) => ({
        schoolId: actor.schoolId,
        classId: input.classId,
        subjectId: s.subjectId,
        isCompulsory: s.isCompulsory,
        electiveGroupId: s.electiveGroupId ?? null,
      })),
    )
    .returning();

  const { studentsAffected } = await autoEnrollCompulsoryOfferings(tx, {
    schoolId: actor.schoolId,
    classId: input.classId,
    sessionId: cls.sessionId,
    offerings: inserted,
  });

  // 10. Audit one row per offering — so withdrawal later has a per-row trail.
  for (const row of inserted) {
    await recordAudit(tx, {
      schoolId: actor.schoolId,
      actorMembershipId: actor.membershipId,
      action: "offering.created",
      targetType: "class_subject",
      targetId: row.id,
      after: {
        classId: row.classId,
        subjectId: row.subjectId,
        isCompulsory: row.isCompulsory,
        electiveGroupId: row.electiveGroupId,
      },
      metadata: {
        autoEnrolledStudents: row.isCompulsory ? studentsAffected : 0,
      },
    });
  }

  // 11. Shape the response without a re-fetch — we already have everything.
  return inserted.map((row) => {
    const subject = subjectById.get(row.subjectId)!;
    return {
      ...row,
      subject: { id: subject.id, code: subject.code, name: subject.name },
    };
  });
}
// ── withdrawOffering ──────────────────────────────────────────────────

export async function withdrawOffering(
  tx: Tx,
  actor: Actor,
  offeringId: string,
): Promise<void> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot withdraw offering");
  }

  // ── LOCK ORDER: session (share) → class (update) → offering (update) ──

  // 1. Read offering UNLOCKED — just to learn classId.
  const offeringMeta = await repo.findClassSubjectById(
    tx,
    actor.schoolId,
    offeringId,
  );
  if (!offeringMeta) {
    throw new AppError(
      404,
      "OFFERING_NOT_FOUND",
      "Offering not found in this school",
    );
  }

  // 2. Read class UNLOCKED — just to learn sessionId.
  const classMeta = await classRepo.findClass(
    tx,
    actor.schoolId,
    offeringMeta.classId,
  );
  if (!classMeta) {
    throw new AppError(404, "CLASS_NOT_FOUND", "Class not found");
  }

  // 3. Lock session FOR SHARE.
  await assertSessionOpen(tx, actor.schoolId, classMeta.sessionId);

  // 4. Lock class FOR UPDATE — re-verify not archived.
  const cls = await classRepo.lockClass(
    tx,
    actor.schoolId,
    offeringMeta.classId,
  );
  if (!cls) {
    throw new AppError(404, "CLASS_NOT_FOUND", "Class not found");
  }
  if (cls.archivedAt !== null) {
    throw new AppError(
      409,
      "CLASS_ARCHIVED",
      "Cannot withdraw an offering from an archived class",
    );
  }

  // 5. Lock offering FOR UPDATE — re-verify still exists.
  //    It could have been deleted between step 1 and now.
  const offering = await repo.lockClassSubject(tx, actor.schoolId, offeringId);
  if (!offering) {
    throw new AppError(
      404,
      "OFFERING_NOT_FOUND",
      "Offering not found in this school",
    );
  }

  // 6. Two-step delete, in order (FK is RESTRICT).
  const droppedChoices = await repo.deleteStudentSubjectsForOffering(
    tx,
    actor.schoolId,
    offering.classId,
    offeringId,
  );
  await repo.deleteClassSubject(tx, actor.schoolId, offeringId);

  // 7. Audit
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "class_subject.withdrawn",
    targetType: "class_subject",
    targetId: offering.id,
    before: {
      classId: offering.classId,
      subjectId: offering.subjectId,
      isCompulsory: offering.isCompulsory,
      electiveGroupId: offering.electiveGroupId,
    },
    metadata: { studentSubjectsDeleted: droppedChoices },
  });
}
// ── listOfferings ─────────────────────────────────────────────────────

export async function listOfferings(
  executor: DbExecutor,
  actor: Actor,
  query: ListOfferingsQuery,
): Promise<OfferingWithSubject[]> {
  if (!can(actor, "academics:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list offerings");
  }

  // Confirm the class belongs to actor's school before listing — otherwise a
  // valid-looking classId from another school returns [] (fine for list
  // semantics, but the 404 gives a clearer signal for a bad link).
  const cls = await classRepo.findClass(
    executor,
    actor.schoolId,
    query.classId,
  );
  if (!cls) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }

  return repo.listClassSubjects(
    executor,
    actor.schoolId,
    query.classId,
    query.includeArchived ?? false,
  );
}

async function autoEnrollCompulsoryOfferings(
  tx: Tx,
  opts: {
    schoolId: string;
    classId: string;
    sessionId: string;
    offerings: ClassSubject[]; // the rows just inserted
  },
): Promise<{ studentsAffected: number }> {
  const compulsory = opts.offerings.filter((o) => o.isCompulsory);
  if (compulsory.length === 0) {
    return { studentsAffected: 0 };
  }

  // Active enrollments only: ended_at IS NULL.
  const enrollments = await tx
    .select({ id: classEnrollments.id })
    .from(classEnrollments)
    .where(
      and(
        eq(classEnrollments.schoolId, opts.schoolId),
        eq(classEnrollments.classId, opts.classId),
        isNull(classEnrollments.endedAt),
      ),
    );

  if (enrollments.length === 0) {
    return { studentsAffected: 0 };
  }

  // Cross-product, built in memory, one bulk insert.
  const rows = compulsory.flatMap((offering) =>
    enrollments.map((enrollment) => ({
      schoolId: opts.schoolId,
      enrollmentId: enrollment.id,
      classId: opts.classId,
      sessionId: opts.sessionId,
      classSubjectId: offering.id,
      subjectId: null,
    })),
  );

  await tx.insert(studentSubjects).values(rows);

  return { studentsAffected: enrollments.length };
}
