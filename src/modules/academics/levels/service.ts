import { type DbExecutor, type Tx } from "../../../db/types.js";
import { AppError } from "../../../shared/lib/errors.js";
import { can, type Actor } from "../../rbac/can.js";
import type { CreateLevelInput, UpdateLevelInput } from "./schema.js";
import * as repo from "./repository.js";
import type { Level } from "../../../db/schema/levels.js";
import { recordAudit } from "../../../shared/audit/record.js";

export async function createLevel(
  tx: Tx,
  actor: Actor,
  input: CreateLevelInput,
): Promise<Level> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot create this level");
  }

  const level = await repo.createLevel(tx, {
    ...input,
    name: input.name.trim(),
    schoolId: actor.schoolId,
  });

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "level.created",
    targetType: "level",
    targetId: level.id,
    after: { name: level.name, sequence: level.sequence, stage: level.stage },
  });

  return level;
}

export async function listLevels(
  tx: DbExecutor,
  actor: Actor,
  opts: repo.ListLevelOptions,
): Promise<Level[]> {
  if (!can(actor, "academics:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list levels");
  }

  if (opts.includeArchived && !can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list archived levels");
  }

  const schoolId = actor.schoolId;

  const list = await repo.listLevels(tx, schoolId, opts);
  return list;
}

export async function updateLevel(
  tx: Tx,
  actor: Actor,
  levelId: string,
  input: UpdateLevelInput,
): Promise<Level> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot update this level");
  }

  // Lock the row so an archive cannot slip in between the check and the update.
  const existing = await repo.lockLevel(tx, actor.schoolId, levelId);
  if (!existing) {
    throw new AppError(
      404,
      "LEVEL_NOT_FOUND",
      "Level not found in this school",
    );
  }
  if (existing.archivedAt !== null) {
    throw new AppError(
      409,
      "LEVEL_ARCHIVED",
      "Cannot edit an archived level. Unarchive it first.",
    );
  }

  const patch: Partial<Omit<repo.CreateLevelData, "schoolId">> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.sequence !== undefined) patch.sequence = input.sequence;
  if (input.stage !== undefined) patch.stage = input.stage;
  if (Object.keys(patch).length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "no fields to update");
  }

  const updated = await repo.updateLevel(tx, actor.schoolId, levelId, patch);

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "level.updated",
    targetType: "level",
    targetId: updated.id,
    before: {
      name: existing.name,
      sequence: existing.sequence,
      stage: existing.stage,
    },
    after: {
      name: updated.name,
      sequence: updated.sequence,
      stage: updated.stage,
    },
  });

  return updated;
}

export async function archiveLevel(
  tx: Tx,
  actor: Actor,
  levelId: string,
): Promise<Level> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot archive this level");
  }

  // 1. Lock the row — blocks concurrent createClass / updateClass
  const level = await repo.lockLevel(tx, actor.schoolId, levelId);
  if (!level) {
    throw new AppError(
      404,
      "LEVEL_NOT_FOUND",
      "Level not found in this school",
    );
  }

  // Idempotent: already archived → no-op, no extra audit.
  if (level.archivedAt !== null) {
    return level;
  }

  // 2. Guard — refuse if any class still points at this level
  const activeClasses = await repo.countActiveClassesForLevel(
    tx,
    actor.schoolId,
    levelId,
  );
  if (activeClasses > 0) {
    throw new AppError(
      409,
      "LEVEL_HAS_ACTIVE_CLASSES",
      `Cannot archive: ${activeClasses} active class${activeClasses === 1 ? "" : "es"} still reference this level`,
    );
  }

  // 3. Archive
  const archived = await repo.archiveLevel(tx, actor.schoolId, levelId);

  // 4. Audit
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "level.archived",
    targetType: "level",
    targetId: archived.id,
    before: { archivedAt: null },
    after: { archivedAt: archived.archivedAt },
  });

  return archived;
}

// src/modules/academics/levels/service.ts
export async function unarchiveLevel(
  tx: Tx,
  actor: Actor,
  levelId: string,
): Promise<Level> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot unarchive this level");
  }

  // 1. Lock + 404
  const level = await repo.lockLevel(tx, actor.schoolId, levelId);
  if (!level) {
    throw new AppError(
      404,
      "LEVEL_NOT_FOUND",
      "Level not found in this school",
    );
  }

  // 2. Idempotent: already unarchived → no-op, no audit, no write
  if (level.archivedAt === null) {
    return level;
  }

  // 3. Unarchive
  const unarchived = await repo.unarchiveLevel(tx, actor.schoolId, levelId);

  // 4. Audit
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "level.unarchived",
    targetType: "level",
    targetId: unarchived.id,
    before: { archivedAt: level.archivedAt },
    after: { archivedAt: null },
  });

  return unarchived;
}

export async function getLevel(
  executor: DbExecutor,
  actor: Actor,
  levelId: string,
): Promise<Level> {
  if (!can(actor, "academics:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot read this level");
  }
  const level = await repo.findLevel(executor, actor.schoolId, levelId);
  if (!level) {
    throw new AppError(404, "LEVEL_NOT_FOUND", "Level not found in this school");
  }
  return level;
}
