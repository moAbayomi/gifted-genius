import { and, eq, isNull, sql } from "drizzle-orm";
import { levels, type Level } from "../../../db/schema/levels.js";
import type { DbExecutor } from "../../../db/types.js";
import { one } from "../../../shared/utils/assert.js";
import { isUniqueViolation } from "../../../shared/errors/pg-errors.js";
import { AppError } from "../../../shared/lib/errors.js";
import { classes } from "../../../db/schema/classes.js";

export interface ListLevelOptions {
  includeArchived?: boolean;
}

export type CreateLevelData = {
  schoolId: string;
  name: string;
  sequence: number;
  stage: Level["stage"];
};

export async function findLevel(
  executor: DbExecutor,
  schoolId: string,
  levelId: string,
): Promise<Level | null> {
  const [row] = await executor
    .select()
    .from(levels)
    .where(and(eq(levels.schoolId, schoolId), eq(levels.id, levelId)))
    .limit(1);
  return row ?? null;
}

export async function listLevels(
  executor: DbExecutor,
  schoolId: string,
  opts: ListLevelOptions = {},
): Promise<Level[]> {
  const where = opts.includeArchived
    ? eq(levels.schoolId, schoolId)
    : and(eq(levels.schoolId, schoolId), isNull(levels.archivedAt));
  return await executor
    .select()
    .from(levels)
    .where(where)
    .orderBy(levels.sequence);
}

export async function createLevel(
  executor: DbExecutor,
  data: CreateLevelData,
): Promise<Level> {
  try {
    return one(
      await executor
        .insert(levels)
        .values({
          schoolId: data.schoolId,
          name: data.name,
          sequence: data.sequence,
          stage: data.stage,
        })
        .returning(),
    );
  } catch (err) {
    if (isUniqueViolation(err, "levels_school_name_uq")) {
      throw new AppError(
        409,
        "LEVEL_NAME_TAKEN",
        `A level named "${data.name}" already exists`,
      );
    }

    if (isUniqueViolation(err, "levels_school_sequence_uq")) {
      throw new AppError(
        409,
        "LEVEL_SEQUENCE_TAKEN",
        `Sequence ${data.sequence} is already taken`,
      );
    }
    throw err;
  }
}

export async function updateLevel(
  executor: DbExecutor,
  schoolId: string,
  levelId: string,
  data: Partial<Omit<CreateLevelData, "schoolId">>,
): Promise<Level> {
  const patch: Partial<typeof levels.$inferInsert> = {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.sequence !== undefined && { sequence: data.sequence }),
    ...(data.stage !== undefined && { stage: data.stage }),
  };

  try {
    const [row] = await executor
      .update(levels)
      .set(patch)
      .where(and(eq(levels.schoolId, schoolId), eq(levels.id, levelId)))
      .returning();

    if (!row) {
      throw new AppError(
        404,
        "LEVEL_NOT_FOUND",
        "Level not found in this school",
      );
    }
    return row;
  } catch (err) {
    if (isUniqueViolation(err, "levels_school_name_uq")) {
      throw new AppError(
        409,
        "LEVEL_NAME_TAKEN",
        `A level named "${data.name}" already exists`,
      );
    }
    if (isUniqueViolation(err, "levels_school_sequence_uq")) {
      throw new AppError(
        409,
        "LEVEL_SEQUENCE_TAKEN",
        `Sequence ${data.sequence} is already taken`,
      );
    }
    throw err;
  }
}

export async function lockLevel(
  executor: DbExecutor,
  schoolId: string,
  levelId: string,
): Promise<Level | null> {
  const [row] = await executor
    .select()
    .from(levels)
    .where(and(eq(levels.schoolId, schoolId), eq(levels.id, levelId)))
    .for("update") // ← SELECT … FOR UPDATE
    .limit(1);
  return row ?? null;
}

export async function countActiveClassesForLevel(
  executor: DbExecutor,
  schoolId: string,
  levelId: string,
): Promise<number> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(classes)
    .where(
      and(
        eq(classes.schoolId, schoolId), // defense in depth
        eq(classes.levelId, levelId),
        isNull(classes.archivedAt), // only *live* classes block
      ),
    );
  return row?.count ?? 0;
}

export async function archiveLevel(
  executor: DbExecutor,
  schoolId: string,
  levelId: string,
): Promise<Level> {
  const [row] = await executor
    .update(levels)
    .set({ archivedAt: sql`now()` })
    .where(and(eq(levels.schoolId, schoolId), eq(levels.id, levelId)))
    .returning();

  if (!row) {
    throw new AppError(
      404,
      "LEVEL_NOT_FOUND",
      "Level not found in this school",
    );
  }
  return row;
}

export async function unarchiveLevel(
  executor: DbExecutor,
  schoolId: string,
  levelId: string,
): Promise<Level> {
  const [row] = await executor
    .update(levels)
    .set({ archivedAt: null })
    .where(and(eq(levels.schoolId, schoolId), eq(levels.id, levelId)))
    .returning();

  if (!row) {
    throw new AppError(
      404,
      "LEVEL_NOT_FOUND",
      "Level not found in this school",
    );
  }
  return row;
}
