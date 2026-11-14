import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../../db/client.js";
import type { DbExecutor } from "../../../db/types.js";
import {
  academicSessions,
  classEnrollments,
  classSubjects,
  levels,
  studentSubjects,
} from "../../../db/schema/index.js";
import { AppError } from "../../../shared/lib/errors.js";
import { recordAudit } from "../../../shared/audit/record.js";
import { can, type Actor } from "../../rbac/can.js";
import { lockSchoolRow } from "../../roles/repository.js";
import * as classRepo from "../classes/repository.js";
import { assertSessionOpen } from "../session-guard.js";
import {
  suggestPromotions,
  type PromotionAction,
  type PromotionClass,
  type PromotionSuggestion,
} from "./suggest.js";

export interface PromotionPreviewRow extends PromotionSuggestion {
  warnings: string[];
}

export interface PromotionPreviewGroup {
  targetClassId: string | null;
  targetClassName: string | null;
  count: number;
  rows: PromotionPreviewRow[];
}

export interface PromotionPreview {
  sourceSessionId: string;
  targetSessionId: string;
  groups: PromotionPreviewGroup[];
  rows: PromotionPreviewRow[];
  counts: Record<PromotionAction | "noOfferings", number>;
}

export interface PromotionCommitRow {
  enrollmentId: string;
  targetClassId: string;
  repeat?: boolean;
}

export interface PromotionCommitResult {
  created: number;
  sourceEnded: number;
  subjectsCreated: number;
  skipped: Array<{ enrollmentId: string; reason: string }>;
}

function parseSessionStart(label: string): number | null {
  const match = /^(\d{4})\/(\d{4})$/.exec(label);
  if (!match) return null;
  return Number(match[1]);
}

function classToPromotionClass(cls: Awaited<ReturnType<typeof classRepo.listClasses>>[number]): PromotionClass {
  return {
    id: cls.id,
    levelId: cls.levelId,
    armLabel: cls.armLabel,
    track: cls.track,
    archivedAt: cls.archivedAt,
  };
}

async function loadPreviewData(
  executor: DbExecutor,
  actor: Actor,
  sourceSessionId: string,
  targetSessionId: string,
): Promise<{
  sourceClasses: Awaited<ReturnType<typeof classRepo.listClasses>>;
  targetClasses: Awaited<ReturnType<typeof classRepo.listClasses>>;
  suggestions: PromotionSuggestion[];
  targetOfferingCounts: Map<string, number>;
  targetClassNames: Map<string, string>;
}> {
  const [sourceSession, targetSession] = await Promise.all([
    executor
      .select()
      .from(academicSessions)
      .where(
        and(
          eq(academicSessions.id, sourceSessionId),
          eq(academicSessions.schoolId, actor.schoolId),
        ),
      )
      .limit(1),
    executor
      .select()
      .from(academicSessions)
      .where(
        and(
          eq(academicSessions.id, targetSessionId),
          eq(academicSessions.schoolId, actor.schoolId),
        ),
      )
      .limit(1),
  ]);
  if (!sourceSession[0]) {
    throw new AppError(404, "SESSION_NOT_FOUND", "Source session not found");
  }
  if (!targetSession[0]) {
    throw new AppError(404, "SESSION_NOT_FOUND", "Target session not found");
  }

  const [sourceClasses, targetClasses, levelRows, enrollments] = await Promise.all([
    classRepo.listClasses(executor, actor.schoolId, { sessionId: sourceSessionId }),
    classRepo.listClasses(executor, actor.schoolId, { sessionId: targetSessionId }),
    executor.select().from(levels).where(eq(levels.schoolId, actor.schoolId)),
    executor
      .select()
      .from(classEnrollments)
      .where(
        and(
          eq(classEnrollments.schoolId, actor.schoolId),
          eq(classEnrollments.sessionId, sourceSessionId),
          eq(classEnrollments.status, "active"),
          isNull(classEnrollments.endedAt),
        ),
      ),
  ]);

  const targetClassIds = targetClasses.map((c) => c.id);
  const offeringRows =
    targetClassIds.length === 0
      ? []
      : await executor
          .select({ classId: classSubjects.classId })
          .from(classSubjects)
          .where(
            and(
              eq(classSubjects.schoolId, actor.schoolId),
              inArray(classSubjects.classId, targetClassIds),
              isNull(classSubjects.archivedAt),
            ),
          );
  const targetOfferingCounts = new Map<string, number>();
  for (const row of offeringRows) {
    targetOfferingCounts.set(
      row.classId,
      (targetOfferingCounts.get(row.classId) ?? 0) + 1,
    );
  }

  const suggestions = suggestPromotions({
    enrollments: enrollments.map((e) => ({
      enrollmentId: e.id,
      studentId: e.studentId,
      sourceClassId: e.classId,
    })),
    sourceClasses: sourceClasses.map(classToPromotionClass),
    targetClasses: targetClasses.map(classToPromotionClass),
    levels: levelRows.map((l) => ({
      id: l.id,
      name: l.name,
      sequence: l.sequence,
      stage: l.stage,
    })),
  });

  const targetClassNames = new Map(
    targetClasses.map((c) => [c.id, `${c.level.name} ${c.armLabel}`]),
  );
  return {
    sourceClasses,
    targetClasses,
    suggestions,
    targetOfferingCounts,
    targetClassNames,
  };
}

export async function previewPromotions(
  executor: DbExecutor,
  actor: Actor,
  input: { sourceSessionId: string; targetSessionId: string },
): Promise<PromotionPreview> {
  if (!can(actor, "enrollments:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot preview promotions");
  }
  const data = await loadPreviewData(
    executor,
    actor,
    input.sourceSessionId,
    input.targetSessionId,
  );

  const rows: PromotionPreviewRow[] = data.suggestions.map((s) => {
    const warnings: string[] = [...(s.warning ? [s.warning] : [])];
    if (s.targetClassId && (data.targetOfferingCounts.get(s.targetClassId) ?? 0) === 0) {
      warnings.push("NO_OFFERINGS");
    }
    return { ...s, warnings };
  });

  const groups = new Map<string, PromotionPreviewGroup>();
  for (const row of rows) {
    const key = row.targetClassId ?? "unassigned";
    let group = groups.get(key);
    if (!group) {
      group = {
        targetClassId: row.targetClassId,
        targetClassName: row.targetClassId
          ? data.targetClassNames.get(row.targetClassId) ?? null
          : null,
        count: 0,
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.count += 1;
  }

  const counts: Record<PromotionAction | "noOfferings", number> = {
    promote: 0,
    graduate: 0,
    choose_track: 0,
    no_matching_class: 0,
    noOfferings: rows.filter((r) => r.warnings.includes("NO_OFFERINGS")).length,
  };
  for (const row of rows) counts[row.action] += 1;

  return {
    sourceSessionId: input.sourceSessionId,
    targetSessionId: input.targetSessionId,
    groups: [...groups.values()],
    rows,
    counts,
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Apply a confirmed promotion plan. All validation happens before the first
 * write. The school row is locked first, then target session, then classes.
 */
export async function commitPromotion(
  actor: Actor,
  input: {
    sourceSessionId: string;
    targetSessionId: string;
    rows: PromotionCommitRow[];
  },
): Promise<PromotionCommitResult> {
  if (!can(actor, "enrollments:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot commit promotions");
  }
  if (input.sourceSessionId === input.targetSessionId) {
    throw new AppError(400, "SAME_SESSION", "Source and target sessions must differ");
  }
  if (input.rows.length === 0) {
    return { created: 0, sourceEnded: 0, subjectsCreated: 0, skipped: [] };
  }

  return db.transaction(async (tx) => {
    await lockSchoolRow(tx, actor.schoolId);

    const [sourceSession] = await tx
      .select()
      .from(academicSessions)
      .where(
        and(
          eq(academicSessions.id, input.sourceSessionId),
          eq(academicSessions.schoolId, actor.schoolId),
        ),
      )
      .limit(1);
    if (!sourceSession) {
      throw new AppError(404, "SESSION_NOT_FOUND", "Source session not found");
    }
    const targetSession = await assertSessionOpen(
      tx,
      actor.schoolId,
      input.targetSessionId,
    );
    const sourceYear = parseSessionStart(sourceSession.label);
    const targetYear = parseSessionStart(targetSession.label);
    if (
      sourceYear === null ||
      targetYear === null ||
      targetYear <= sourceYear
    ) {
      throw new AppError(
        400,
        "TARGET_SESSION_NOT_LATER",
        "Target session must be later than the source session",
      );
    }

    const [targetClasses, rows] = await Promise.all([
      classRepo.listClasses(tx, actor.schoolId, {
        sessionId: input.targetSessionId,
        includeArchived: true,
      }),
      tx
        .select()
        .from(classEnrollments)
        .where(
          and(
            eq(classEnrollments.schoolId, actor.schoolId),
            inArray(
              classEnrollments.id,
              input.rows.map((r) => r.enrollmentId),
            ),
          ),
        ),
    ]);
    const targetClassById = new Map(targetClasses.map((c) => [c.id, c]));
    const enrollmentById = new Map(rows.map((e) => [e.id, e]));

    const seenEnrollments = new Set<string>();
    const seenStudents = new Set<string>();
    const skipped: Array<{ enrollmentId: string; reason: string }> = [];
    const toCreate: Array<{
      row: PromotionCommitRow;
      enrollment: (typeof rows)[number];
      targetClass: (typeof targetClasses)[number];
    }> = [];

    const sourceStudentIds = input.rows.map((r) => {
      const e = enrollmentById.get(r.enrollmentId);
      if (!e) return null;
      return e.studentId;
    }).filter((id): id is string => id !== null);

    const existingTarget =
      sourceStudentIds.length === 0
        ? []
        : await tx
            .select()
            .from(classEnrollments)
            .where(
              and(
                eq(classEnrollments.schoolId, actor.schoolId),
                eq(classEnrollments.sessionId, targetSession.id),
                eq(classEnrollments.status, "active"),
                isNull(classEnrollments.endedAt),
                inArray(classEnrollments.studentId, sourceStudentIds),
              ),
            );
    const alreadyTarget = new Set(existingTarget.map((e) => e.studentId));

    for (const row of input.rows) {
      if (seenEnrollments.has(row.enrollmentId)) {
        throw new AppError(400, "DUPLICATE_ENROLLMENT", "The plan contains a duplicate enrollment");
      }
      seenEnrollments.add(row.enrollmentId);
      const enrollment = enrollmentById.get(row.enrollmentId);
      if (!enrollment) {
        throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
      }
      if (seenStudents.has(enrollment.studentId)) {
        throw new AppError(400, "DUPLICATE_STUDENT", "The plan promotes a student twice");
      }
      seenStudents.add(enrollment.studentId);

      const targetClass = targetClassById.get(row.targetClassId);
      if (!targetClass) {
        throw new AppError(404, "CLASS_NOT_FOUND", "Target class not found");
      }
      if (targetClass.sessionId !== targetSession.id) {
        throw new AppError(400, "TARGET_CLASS_WRONG_SESSION", "Target class is not in the target session");
      }
      if (targetClass.archivedAt !== null) {
        throw new AppError(409, "CLASS_ARCHIVED", "Target class is archived");
      }

      if (alreadyTarget.has(enrollment.studentId)) {
        skipped.push({ enrollmentId: enrollment.id, reason: "ALREADY_PROMOTED" });
        continue;
      }
      if (
        enrollment.sessionId !== sourceSession.id ||
        enrollment.status !== "active" ||
        enrollment.endedAt !== null
      ) {
        throw new AppError(400, "ENROLLMENT_NOT_ACTIVE", "Enrollment is not active in the source session");
      }
      if (enrollment.id === undefined) {
        throw new AppError(400, "PROMOTION_INVALID", "Invalid enrollment");
      }
      toCreate.push({ row, enrollment, targetClass });
    }

    const targetClassIdsToCheck = [...new Set(toCreate.map((r) => r.targetClass.id))];
    const offeringRows =
      targetClassIdsToCheck.length === 0
        ? []
        : await tx
            .select({ classId: classSubjects.classId, id: classSubjects.id, isCompulsory: classSubjects.isCompulsory })
            .from(classSubjects)
            .where(
              and(
                eq(classSubjects.schoolId, actor.schoolId),
                inArray(classSubjects.classId, targetClassIdsToCheck),
                isNull(classSubjects.archivedAt),
              ),
            );
    const offeringCount = new Map<string, number>();
    const compulsoryByClass = new Map<string, string[]>();
    for (const o of offeringRows) {
      offeringCount.set(o.classId, (offeringCount.get(o.classId) ?? 0) + 1);
      if (o.isCompulsory) {
        const list = compulsoryByClass.get(o.classId) ?? [];
        list.push(o.id);
        compulsoryByClass.set(o.classId, list);
      }
    }
    for (const { targetClass } of toCreate) {
      if ((offeringCount.get(targetClass.id) ?? 0) === 0) {
        throw new AppError(
          409,
          "TARGET_CLASS_HAS_NO_OFFERINGS",
          `${targetClass.level.name} ${targetClass.armLabel} has no offerings`,
        );
      }
    }

    if (toCreate.length === 0) {
      return { created: 0, sourceEnded: 0, subjectsCreated: 0, skipped };
    }

    const now = new Date();
    const sourceEnded = await tx
      .update(classEnrollments)
      .set({
        status: "transferred",
        endedAt: now,
        endedReason: "promoted",
      })
      .where(
        and(
          eq(classEnrollments.schoolId, actor.schoolId),
          inArray(
            classEnrollments.id,
            toCreate.map((r) => r.enrollment.id),
          ),
          eq(classEnrollments.status, "active"),
          isNull(classEnrollments.endedAt),
        ),
      )
      .returning({ id: classEnrollments.id });

    const newEnrollments: Array<{ id: string; studentId: string; classId: string }> = [];
    for (const chunk of chunks(toCreate, 500)) {
      const inserted = await tx
        .insert(classEnrollments)
        .values(
          chunk.map(({ enrollment, targetClass }) => ({
            schoolId: actor.schoolId,
            studentId: enrollment.studentId,
            classId: targetClass.id,
            sessionId: targetSession.id,
            startedAt: now,
            status: "active" as const,
            endedAt: null,
            endedReason: null,
            transferredFromEnrollmentId: null,
          })),
        )
        .returning({
          id: classEnrollments.id,
          studentId: classEnrollments.studentId,
          classId: classEnrollments.classId,
        });
      newEnrollments.push(...inserted);
    }

    const subjectRows = newEnrollments.flatMap((e) =>
      (compulsoryByClass.get(e.classId) ?? []).map((classSubjectId) => ({
        schoolId: actor.schoolId,
        enrollmentId: e.id,
        classId: e.classId,
        sessionId: targetSession.id,
        classSubjectId,
      })),
    );
    let subjectsCreated = 0;
    for (const chunk of chunks(subjectRows, 1000)) {
      const inserted = await tx
        .insert(studentSubjects)
        .values(chunk)
        .returning({ id: studentSubjects.id });
      subjectsCreated += inserted.length;
    }

    await recordAudit(tx, {
      schoolId: actor.schoolId,
      actorMembershipId: actor.membershipId,
      action: "promotion.committed",
      targetType: "academic_session",
      targetId: targetSession.id,
      after: {
        sourceSessionId: sourceSession.id,
        created: newEnrollments.length,
        sourceEnded: sourceEnded.length,
        subjectsCreated,
        skipped: skipped.length,
      },
    });

    return {
      created: newEnrollments.length,
      sourceEnded: sourceEnded.length,
      subjectsCreated,
      skipped,
    };
  });
}
