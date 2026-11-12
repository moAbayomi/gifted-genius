import { and, eq, isNull, sql } from "drizzle-orm";
import {
  electiveGroups,
  type ElectiveGroup,
} from "../../../db/schema/elective-groups.js";
import type { DbExecutor } from "../../../db/types.js";
import { AppError } from "../../../shared/lib/errors.js";
import { isUniqueViolation } from "../../../shared/errors/pg-errors.js";
import { one } from "../../../shared/utils/assert.js";

/** Duplicate check — (classId, name) is unique; including archived rows. */
export async function findGroupByName(
  executor: DbExecutor,
  classId: string,
  name: string,
): Promise<ElectiveGroup | null> {
  const [row] = await executor
    .select()
    .from(electiveGroups)
    .where(and(eq(electiveGroups.classId, classId), eq(electiveGroups.name, name)))
    .limit(1);
  return row ?? null;
}

/** School-scoped row lock. Must run inside a transaction (FOR UPDATE). */
export async function lockElectiveGroup(
  executor: DbExecutor,
  schoolId: string,
  id: string,
): Promise<ElectiveGroup | null> {
  const [row] = await executor
    .select()
    .from(electiveGroups)
    .where(
      and(eq(electiveGroups.schoolId, schoolId), eq(electiveGroups.id, id)),
    )
    .for("update")
    .limit(1);
  return row ?? null;
}

export interface ListElectiveGroupsOptions {
  classId: string;
  includeArchived?: boolean;
}

export async function listElectiveGroups(
  executor: DbExecutor,
  schoolId: string,
  opts: ListElectiveGroupsOptions,
): Promise<ElectiveGroup[]> {
  const where = opts.includeArchived
    ? and(
        eq(electiveGroups.schoolId, schoolId),
        eq(electiveGroups.classId, opts.classId),
      )
    : and(
        eq(electiveGroups.schoolId, schoolId),
        eq(electiveGroups.classId, opts.classId),
        isNull(electiveGroups.archivedAt),
      );

  return executor
    .select()
    .from(electiveGroups)
    .where(where)
    .orderBy(electiveGroups.name);
}

export async function createElectiveGroup(
  executor: DbExecutor,
  data: {
    schoolId: string;
    classId: string;
    sessionId: string;
    name: string;
    minChoices: number;
    maxChoices: number;
  },
): Promise<ElectiveGroup> {
  try {
    return one(
      await executor.insert(electiveGroups).values(data).returning(),
    );
  } catch (err) {
    if (isUniqueViolation(err, "elective_groups_class_name_uq")) {
      throw new AppError(
        409,
        "ELECTIVE_GROUP_NAME_TAKEN",
        `A group named "${data.name}" already exists for this class`,
      );
    }
    throw err;
  }
}

export async function updateElectiveGroup(
  executor: DbExecutor,
  schoolId: string,
  id: string,
  patch: { name?: string; minChoices?: number; maxChoices?: number },
): Promise<ElectiveGroup> {
  try {
    const [row] = await executor
      .update(electiveGroups)
      .set(patch)
      .where(
        and(eq(electiveGroups.schoolId, schoolId), eq(electiveGroups.id, id)),
      )
      .returning();

    if (!row) {
      throw new AppError(404, "ELECTIVE_GROUP_NOT_FOUND", "Group not found");
    }
    return row;
  } catch (err) {
    if (isUniqueViolation(err, "elective_groups_class_name_uq")) {
      throw new AppError(
        409,
        "ELECTIVE_GROUP_NAME_TAKEN",
        patch.name !== undefined
          ? `A group named "${patch.name}" already exists for this class`
          : "A group with that name already exists for this class",
      );
    }
    throw err;
  }
}

export async function archiveElectiveGroup(
  executor: DbExecutor,
  schoolId: string,
  id: string,
): Promise<ElectiveGroup> {
  const [row] = await executor
    .update(electiveGroups)
    .set({ archivedAt: sql`now()` })
    .where(
      and(eq(electiveGroups.schoolId, schoolId), eq(electiveGroups.id, id)),
    )
    .returning();

  if (!row) {
    throw new AppError(404, "ELECTIVE_GROUP_NOT_FOUND", "Group not found");
  }
  return row;
}