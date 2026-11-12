import { and, eq, isNull, sql } from "drizzle-orm";
import { classes, type Class } from "../../../db/schema/classes.js";
import type { DbExecutor } from "../../../db/types.js";
import { isUniqueViolation } from "../../../shared/errors/pg-errors.js";
import { AppError } from "../../../shared/lib/errors.js";
import { levels, type Level } from "../../../db/schema/levels.js";

export interface ClassFilters {
  sessionId?: string | undefined;
  levelId?: string | undefined;
  track?: Class["track"] | undefined;
  includeArchived?: boolean | undefined;
}

export interface CreateClassData {
  schoolId: string;
  sessionId: string;
  levelId: string;
  armLabel: string;
  track: Class["track"];
}

export interface ClassWithLevel extends Class {
  level: Pick<Level, "id" | "name" | "sequence" | "stage" | "archivedAt">;
}


const classWithLevelColumns = {
  id:         classes.id,
  schoolId:   classes.schoolId,
  sessionId:  classes.sessionId,
  levelId:    classes.levelId,
  armLabel:   classes.armLabel,
  track:      classes.track,
  archivedAt: classes.archivedAt,
  createdAt:  classes.createdAt,
  updatedAt:  classes.updatedAt,
  level: {
    id:       levels.id,
    name:     levels.name,
    sequence: levels.sequence,
    stage:    levels.stage,
    archivedAt: levels.archivedAt,
  },
} as const;


export async function findClass(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<Class | null> {
  const [row] = await executor
    .select()
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.id, classId)))
    .limit(1);
  return row ?? null;
}

export async function findClassWithLevel(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<ClassWithLevel | null> {
  const [row] = await executor
    .select(classWithLevelColumns)
    .from(classes)
    .innerJoin(levels, eq(levels.id, classes.levelId))
    .where(and(eq(classes.schoolId, schoolId), eq(classes.id, classId)))
    .limit(1);
  return row ?? null;
}

export async function listClasses(
  executor: DbExecutor,
  schoolId: string,
  filters: ClassFilters = {},
): Promise<ClassWithLevel[]> {
  const where = and(
    eq(classes.schoolId, schoolId),
    filters.sessionId ? eq(classes.sessionId, filters.sessionId) : undefined,
    filters.levelId ? eq(classes.levelId, filters.levelId) : undefined,
    filters.track ? eq(classes.track, filters.track) : undefined,
    filters.includeArchived ? undefined : isNull(classes.archivedAt),
  );

  return executor
    .select(classWithLevelColumns)
    .from(classes)
    .innerJoin(levels, eq(levels.id, classes.levelId))
    .where(where)
    .orderBy(levels.sequence, classes.armLabel, classes.track);
}


export async function createClass(
  executor: DbExecutor,
  data: CreateClassData,
): Promise<Class> {
  const [inserted] = await executor
    .insert(classes)
    .values({
      schoolId: data.schoolId,
      sessionId: data.sessionId,
      levelId: data.levelId,
      armLabel: data.armLabel,
      track: data.track,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return inserted;

  // The tuple already exists. Distinguish a live duplicate from an archived
  // class that still owns the unique slot, so the admin knows to unarchive.
  const [existing] = await executor
    .select()
    .from(classes)
    .where(
      and(
        eq(classes.schoolId, data.schoolId),
        eq(classes.sessionId, data.sessionId),
        eq(classes.levelId, data.levelId),
        eq(classes.armLabel, data.armLabel),
        eq(classes.track, data.track),
      ),
    )
    .limit(1);

  if (existing?.archivedAt != null) {
    throw new AppError(
      409,
      "CLASS_ARCHIVED_EXISTS",
      `A class with this session, level, arm and track is archived. Unarchive it before creating a replacement.`,
    );
  }

  throw new AppError(409, "CLASS_ALREADY_EXISTS", "this class already exists");
}

/** Insert a class only if the unique tuple is free; return null if it exists. */
export async function insertClassIfAbsent(
  executor: DbExecutor,
  data: CreateClassData,
): Promise<Class | null> {
  const [row] = await executor
    .insert(classes)
    .values({
      schoolId: data.schoolId,
      sessionId: data.sessionId,
      levelId: data.levelId,
      armLabel: data.armLabel,
      track: data.track,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function updateClass(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
  data: Partial<Omit<CreateClassData, "schoolId" | "sessionId" | "levelId">>,
): Promise<Class> {
  try {
    const patch: Partial<typeof classes.$inferInsert> = {
      ...(data.armLabel !== undefined && { armLabel: data.armLabel }),
      ...(data.track !== undefined && { track: data.track }),
    };

    if (Object.keys(patch).length === 0) {
      throw new AppError(400, "VALIDATION_ERROR", "no fields to update");
    }

    const [row] = await executor
      .update(classes)
      .set(patch)
      .where(and(eq(classes.schoolId, schoolId), eq(classes.id, classId)))
      .returning();

    if (!row) {
      throw new AppError(
        404,
        "CLASS_NOT_FOUND",
        "Class not found in this school",
      );
    }

    return row;
  } catch (err) {
    if (isUniqueViolation(err, "classes_session_level_arm_track_uq")) {
      throw new AppError(
        409,
        "CLASS_ALREADY_EXISTS",
        `Arm "${data.armLabel ?? "?"}" (${data.track ?? "?"}) already exists for this class's level in this session`,
      );
    }
    throw err;
  }
}

export async function lockClass(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<Class | null> {
  const [row] = await executor
    .select()
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.id, classId)))
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function archiveClass(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<Class> {
  const [row] = await executor
    .update(classes)
    .set({ archivedAt: sql`now()` })
    .where(and(eq(classes.schoolId, schoolId), eq(classes.id, classId)))
    .returning();

  if (!row) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }
  return row;
}

export async function unarchiveClass(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<Class> {
  const [row] = await executor
    .update(classes)
    .set({ archivedAt: null })
    .where(and(eq(classes.schoolId, schoolId), eq(classes.id, classId)))
    .returning();

  if (!row) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }
  return row;
}
