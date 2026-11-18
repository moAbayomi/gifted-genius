import { eq } from "drizzle-orm";
import type { DbExecutor, Tx } from "../../../db/types.js";
import { schools } from "../../../db/schema/schools.js";
import type { ElectiveGroup } from "../../../db/schema/elective-groups.js";
import { AppError } from "../../../shared/lib/errors.js";
import { recordAudit } from "../../../shared/audit/record.js";
import { can, type Actor } from "../../rbac/can.js";
import { findClass, lockClass } from "../classes/repository.js";
import * as repo from "./repository.js";
import { assertSessionOpen } from "../session-guard.js";
import type { Class } from "../../../db/schema/classes.js";
import * as offeringsRepo from "../offerings/repository.js";

// ── Shared helpers ────────────────────────────────────────────────────

/**
 * Lock the school row — same convention as the calendar services
 * (activateTerm, lockSession). Serializes session-close against
 * elective-group writes so the SESSION_LOCKED check is stable.
 */
async function lockSchool(tx: Tx, schoolId: string): Promise<void> {
  await tx
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .for("update");
}

/**
 * Lock the class, verify school ownership (404 if not found in this
 * school), refuse an archived class, then load its session and refuse if the
 * session is closed. Returns the class so the caller can read `sessionId`.
 */
async function loadOpenClass(
  tx: Tx,
  schoolId: string,
  classId: string,
): Promise<Class> {
  // 1. Read the class without a lock just to obtain its sessionId.
  const initial = await findClass(tx, schoolId, classId);
  if (!initial) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }

  // 2. Session share lock FIRST. Class writes (update/archive/unarchive)
  //    use the same order, so there is no class→session / session→class
  //    deadlock between elective-group writes and class writes.
  await assertSessionOpen(tx, schoolId, initial.sessionId);

  // 3. Now lock the class and re-check its live state.
  const cls = await lockClass(tx, schoolId, classId);
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
      "Cannot modify elective groups under an archived class",
    );
  }

  return cls;
}

function validateRange(min: number, max: number): void {
  if (min < 0) {
    throw new AppError(400, "INVALID_GROUP_RANGE", "minChoices must be >= 0");
  }
  if (max < min) {
    throw new AppError(
      400,
      "INVALID_GROUP_RANGE",
      "maxChoices must be >= minChoices",
    );
  }
}

// ── createElectiveGroup ───────────────────────────────────────────────

export async function createElectiveGroup(
  tx: Tx,
  actor: Actor,
  input: {
    classId: string;
    name: string;
    minChoices: number;
    maxChoices: number;
  },
): Promise<ElectiveGroup> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot create elective groups");
  }

  validateRange(input.minChoices, input.maxChoices);
  const name = input.name.trim();
  if (!name) throw new AppError(400, "VALIDATION_ERROR", "name is required");

  await lockSchool(tx, actor.schoolId);
  const cls = await loadOpenClass(tx, actor.schoolId, input.classId);

  // Duplicate-name pre-check (archived vs live distinction).
  const existing = await repo.findGroupByName(tx, cls.id, name);
  if (existing) {
    if (existing.archivedAt !== null) {
      throw new AppError(
        409,
        "ELECTIVE_GROUP_ARCHIVED_EXISTS",
        `A group named "${name}" already exists for this class and is archived; unarchive it instead`,
      );
    }
    throw new AppError(
      409,
      "ELECTIVE_GROUP_NAME_TAKEN",
      `A group named "${name}" already exists for this class`,
    );
  }

  const created = await repo.createElectiveGroup(tx, {
    schoolId: actor.schoolId,
    classId: cls.id,
    sessionId: cls.sessionId, // derived from the class — never caller-supplied
    name,
    minChoices: input.minChoices,
    maxChoices: input.maxChoices,
  });

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "elective_group.created",
    targetType: "elective_group",
    targetId: created.id,
    after: {
      classId: created.classId,
      sessionId: created.sessionId,
      name: created.name,
      minChoices: created.minChoices,
      maxChoices: created.maxChoices,
    },
  });

  return created;
}

// ── listElectiveGroups ────────────────────────────────────────────────

export async function listElectiveGroups(
  executor: DbExecutor,
  actor: Actor,
  opts: { classId: string; includeArchived?: boolean },
): Promise<ElectiveGroup[]> {
  if (!can(actor, "academics:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list elective groups");
  }
  if (opts.includeArchived && !can(actor, "structure:manage")) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Cannot list archived elective groups",
    );
  }
  return repo.listElectiveGroups(executor, actor.schoolId, opts);
}

// ── updateElectiveGroup ───────────────────────────────────────────────

export async function updateElectiveGroup(
  tx: Tx,
  actor: Actor,
  groupId: string,
  input: {
    name?: string | undefined;
    minChoices?: number | undefined;
    maxChoices?: number | undefined;
  },
): Promise<ElectiveGroup> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot update elective groups");
  }

  await lockSchool(tx, actor.schoolId);
  const existing = await repo.lockElectiveGroup(tx, actor.schoolId, groupId);
  if (!existing) {
    throw new AppError(404, "ELECTIVE_GROUP_NOT_FOUND", "Group not found");
  }
  if (existing.archivedAt !== null) {
    throw new AppError(
      409,
      "ELECTIVE_GROUP_ARCHIVED",
      "Cannot update an archived elective group",
    );
  }

  // Load class + session (session must still be open).
  await loadOpenClass(tx, actor.schoolId, existing.classId);

  // Resulting min/max must remain valid.
  const newMin = input.minChoices ?? existing.minChoices;
  const newMax = input.maxChoices ?? existing.maxChoices;
  validateRange(newMin, newMax);

  // Normalize name if changed.
  const patch: { name?: string; minChoices?: number; maxChoices?: number } = {};
  if (input.minChoices !== undefined) patch.minChoices = input.minChoices;
  if (input.maxChoices !== undefined) patch.maxChoices = input.maxChoices;
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name)
      throw new AppError(400, "VALIDATION_ERROR", "name cannot be empty");
    patch.name = name;
  }
  if (Object.keys(patch).length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "no fields to update");
  }

  // Duplicate-name pre-check (excluding self, distinguishing archived).
  if (patch.name !== undefined && patch.name !== existing.name) {
    const collision = await repo.findGroupByName(
      tx,
      existing.classId,
      patch.name,
    );
    if (collision && collision.id !== existing.id) {
      if (collision.archivedAt !== null) {
        throw new AppError(
          409,
          "ELECTIVE_GROUP_ARCHIVED_EXISTS",
          `A group named "${patch.name}" already exists for this class and is archived; unarchive it instead`,
        );
      }
      throw new AppError(
        409,
        "ELECTIVE_GROUP_NAME_TAKEN",
        `A group named "${patch.name}" already exists for this class`,
      );
    }
  }

  const updated = await repo.updateElectiveGroup(
    tx,
    actor.schoolId,
    groupId,
    patch,
  );

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "elective_group.updated",
    targetType: "elective_group",
    targetId: updated.id,
    before: {
      name: existing.name,
      minChoices: existing.minChoices,
      maxChoices: existing.maxChoices,
    },
    after: {
      name: updated.name,
      minChoices: updated.minChoices,
      maxChoices: updated.maxChoices,
    },
  });

  return updated;
}

// ── archiveElectiveGroup ──────────────────────────────────────────────

export async function archiveElectiveGroup(
  tx: Tx,
  actor: Actor,
  groupId: string,
): Promise<ElectiveGroup> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot archive elective groups");
  }

  await lockSchool(tx, actor.schoolId);
  const existing = await repo.lockElectiveGroup(tx, actor.schoolId, groupId);
  if (!existing) {
    throw new AppError(404, "ELECTIVE_GROUP_NOT_FOUND", "Group not found");
  }

  // Idempotent: already archived → return, no write, no audit.
  if (existing.archivedAt !== null) {
    return existing;
  }

  // Session must still be open.
  await loadOpenClass(tx, actor.schoolId, existing.classId);

  await assertElectiveGroupCanBeArchived(
    tx,
    actor.schoolId,
    existing.classId,
    groupId,
  );

  const archived = await repo.archiveElectiveGroup(tx, actor.schoolId, groupId);

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "elective_group.archived",
    targetType: "elective_group",
    targetId: archived.id,
    before: { archivedAt: null },
    after: { archivedAt: archived.archivedAt },
  });

  return archived;
}

async function assertElectiveGroupCanBeArchived(
  tx: Tx,
  schoolId: string,
  classId: string,
  groupId: string,
): Promise<void> {
  const has = await offeringsRepo.electiveGroupHasOfferings(
    tx,
    schoolId,
    classId,
    groupId,
  );
  if (has) {
    throw new AppError(
      409,
      "ELECTIVE_GROUP_HAS_OFFERINGS",
      "Cannot archive an elective group while offerings are assigned to it.",
    );
  }
}
