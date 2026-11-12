import type { Class } from "../../../db/schema/classes.js";
import type { Level } from "../../../db/schema/levels.js";
import type { DbExecutor, Tx } from "../../../db/types.js";
import { recordAudit } from "../../../shared/audit/record.js";
import { AppError } from "../../../shared/lib/errors.js";
import { can, type Actor } from "../../rbac/can.js";
import { findSession } from "../academic-sessions/repository.js";
import { lockLevel } from "../levels/repository.js";
import type { ClassWithLevel } from "./repository.js";
import * as repo from "./repository.js";
import { assertSessionOpen } from "../session-guard.js";
import type {
  CloneClassesInput,
  CreateClassInput,
  UpdateClassInput,
} from "./schema.js";
import * as offeringsRepo from "../offerings/repository.js";




export async function createClass(
  tx: Tx,
  actor: Actor,
  input: CreateClassInput,
): Promise<ClassWithLevel> {
  // 1. Permission
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot create class");
  }

  // 2. Session exists in this school and is still open. The share lock
  //    prevents lockSession() from closing it halfway through this write.
  await assertSessionOpen(tx, actor.schoolId, input.sessionId);

  // 4. Level exists in this school AND is not archived
  //    (repo.lockLevel from archiveLevel — same lock, prevents the race)
  const level = await lockLevel(tx, actor.schoolId, input.levelId);
  if (!level) {
    throw new AppError(
      404,
      "LEVEL_NOT_FOUND",
      "Level not found in this school",
    );
  }
  if (level.archivedAt !== null) {
    throw new AppError(
      409,
      "LEVEL_ARCHIVED",
      "Cannot add classes to an archived level",
    );
  }

  // after levelRepo.lockLevel → 404 and archivedAt !== null check:
  const allowedTracks: Record<Level["stage"], Class["track"][]> = {
    junior: ["general"],
    senior: ["science", "arts", "commercial"],
  };

  if (!allowedTracks[level.stage].includes(input.track)) {
    throw new AppError(
      400,
      "INVALID_TRACK",
      level.stage === "junior"
        ? "Junior levels can only use the 'general' track"
        : "Senior levels must use science, arts, or commercial",
    );
  }

  // 5. Delegate — schoolId from actor, sessionId/levelId from input
  const created = await repo.createClass(tx, {
    schoolId: actor.schoolId, // ← from actor
    sessionId: input.sessionId, // ← from input (validated above)
    levelId: input.levelId, // ← from input (validated above)
    armLabel: input.armLabel.trim(), // trim at the service boundary too
    track: input.track ?? "general",
  });

  // 6. Audit
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "class.created",
    targetType: "class",
    targetId: created.id,
    after: {
      sessionId: created.sessionId,
      levelId: created.levelId,
      armLabel: created.armLabel,
      track: created.track,
    },
  });

  const withLevel = await repo.findClassWithLevel(
    tx,
    actor.schoolId,
    created.id,
  );
  if (!withLevel) {
    throw new AppError(500, "INTERNAL_ERROR", "Class vanished after insert");
  }
  return withLevel;
}

export async function listClasses(
  tx: DbExecutor,
  actor: Actor,
  filters: repo.ClassFilters = {},
): Promise<ClassWithLevel[]> {
  if (!can(actor, "academics:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list classes");
  }

  if (filters.includeArchived && !can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list archived classes");
  }
  return repo.listClasses(tx, actor.schoolId, filters);
}

export async function findClassWithLevel(
  executor: DbExecutor,
  actor: Actor,
  classId: string,
): Promise<repo.ClassWithLevel> {
  if (!can(actor, "academics:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot read this class");
  }

  const cls = await repo.findClassWithLevel(executor, actor.schoolId, classId);
  if (!cls) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }
  return cls;
}

export async function cloneClasses(
  tx: Tx,
  actor: Actor,
  input: CloneClassesInput,
): Promise<CloneClassesResult> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot clone classes");
  }
  if (input.fromSessionId === input.toSessionId) {
    throw new AppError(
      400,
      "SAME_SESSION",
      "Source and target sessions must differ",
    );
  }

  const source = await findSession(tx, actor.schoolId, input.fromSessionId);
  if (!source) {
    throw new AppError(
      404,
      "SESSION_NOT_FOUND",
      "Source session not found in this school",
    );
  }
  // The source may be closed (cloning from history is allowed); only the
  // target must be open. assertSessionOpen also takes the share lock.
  const target = await assertSessionOpen(
    tx,
    actor.schoolId,
    input.toSessionId,
  );

  // listClasses excludes archived rows by default, so archived classes are
  // not cloned. The class identity (level, arm, track) is preserved; students
  // are not copied.
  const sourceClasses = await repo.listClasses(tx, actor.schoolId, {
    sessionId: source.id,
  });

  const cloned: ClassWithLevel[] = [];
  const skipped: CloneClassesResult["skipped"] = [];
  for (const sourceClass of sourceClasses) {
    if (sourceClass.level.archivedAt !== null) {
      skipped.push({
        classId: sourceClass.id,
        levelId: sourceClass.levelId,
        reason: "LEVEL_ARCHIVED",
      });
      continue;
    }

    const inserted = await repo.insertClassIfAbsent(tx, {
      schoolId: actor.schoolId,
      sessionId: target.id,
      levelId: sourceClass.levelId,
      armLabel: sourceClass.armLabel,
      track: sourceClass.track,
    });
    if (!inserted) continue; // idempotent: already cloned

    const withLevel = await repo.findClassWithLevel(
      tx,
      actor.schoolId,
      inserted.id,
    );
    if (!withLevel) {
      throw new AppError(500, "INTERNAL_ERROR", "Cloned class vanished");
    }
    cloned.push(withLevel);
    await recordAudit(tx, {
      schoolId: actor.schoolId,
      actorMembershipId: actor.membershipId,
      action: "class.cloned",
      targetType: "class",
      targetId: inserted.id,
      after: {
        sessionId: inserted.sessionId,
        levelId: inserted.levelId,
        armLabel: inserted.armLabel,
        track: inserted.track,
      },
      metadata: {
        fromSessionId: source.id,
        toSessionId: target.id,
      },
    });
  }

  return { cloned, skipped };
}

export interface CloneClassesResult {
  cloned: ClassWithLevel[];
  skipped: Array<{
    classId: string;
    levelId: string;
    reason: "LEVEL_ARCHIVED";
  }>;
}

export async function updateClass(
  tx: Tx,
  actor: Actor,
  classId: string,
  input: UpdateClassInput,
): Promise<ClassWithLevel> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot update class");
  }

  // 1. Read class (no lock) — need sessionId for the session guard
  const existing = await repo.findClass(tx, actor.schoolId, classId);
  if (!existing) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }

  // 2. Session share lock — BEFORE any class/level lock
  await assertSessionOpen(tx, actor.schoolId, existing.sessionId);

  // 3. Lock the class row for the archived check
  const locked = await repo.lockClass(tx, actor.schoolId, classId);
  if (!locked) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }
  if (locked.archivedAt !== null) {
    throw new AppError(
      409,
      "CLASS_ARCHIVED",
      "Cannot update an archived class",
    );
  }

  // 4. Load level — check archived UNCONDITIONALLY, not just on track change
  const level = await lockLevel(tx, actor.schoolId, locked.levelId);
  if (!level) {
    throw new AppError(404, "LEVEL_NOT_FOUND", "Level not found");
  }
  if (level.archivedAt !== null) {
    throw new AppError(
      409,
      "LEVEL_ARCHIVED",
      "Cannot modify a class under an archived level",
    );
  }

  // 5. If track is changing, enforce stage/track consistency
  if (input.track !== undefined && input.track !== locked.track) {
    if (level.stage === "junior" && input.track !== "general") {
      throw new AppError(
        400,
        "INVALID_TRACK",
        `Junior level "${level.name}" only supports the 'general' track`,
      );
    }
    if (level.stage === "senior" && input.track === "general") {
      throw new AppError(
        400,
        "INVALID_TRACK",
        `Senior level "${level.name}" must specify science, arts, or commercial`,
      );
    }
  }

  // 6. Build patch — trim armLabel
  const patch: { armLabel?: string; track?: Class["track"] } = {};
  if (input.armLabel !== undefined) patch.armLabel = input.armLabel.trim();
  if (input.track !== undefined) patch.track = input.track;
  if (Object.keys(patch).length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "no fields to update");
  }

  // 7. Update (implicit FOR UPDATE on the row)
  const updated = await repo.updateClass(tx, actor.schoolId, classId, patch);

  // 8. Audit — `before` from the locked read, not the possibly-stale findClass read
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "class.updated",
    targetType: "class",
    targetId: updated.id,
    before: { armLabel: locked.armLabel, track: locked.track },
    after: { armLabel: updated.armLabel, track: updated.track },
  });

  const withLevel = await repo.findClassWithLevel(
    tx,
    actor.schoolId,
    updated.id,
  );
  if (!withLevel) {
    throw new AppError(500, "INTERNAL_ERROR", "Class vanished after update");
  }
  return withLevel;
}

export async function unarchiveClass(
  tx: Tx,
  actor: Actor,
  classId: string,
): Promise<Class> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot unarchive this class");
  }

  // 1. Read class
  const existing = await repo.findClass(tx, actor.schoolId, classId);
  if (!existing) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }

  // 2. Session share lock
  await assertSessionOpen(tx, actor.schoolId, existing.sessionId);

  // 3. Lock class
  const locked = await repo.lockClass(tx, actor.schoolId, classId);
  if (!locked) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }

  // 4. Idempotent: already live → return early
  if (locked.archivedAt === null) {
    return locked;
  }

  // 5. Level must not be archived (checked only when we're about to write)
  const level = await lockLevel(tx, actor.schoolId, locked.levelId);
  if (!level) {
    throw new AppError(404, "LEVEL_NOT_FOUND", "Level not found");
  }
  if (level.archivedAt !== null) {
    throw new AppError(
      409,
      "LEVEL_ARCHIVED",
      "Cannot unarchive a class under an archived level",
    );
  }

  // 6. Unarchive
  const unarchived = await repo.unarchiveClass(tx, actor.schoolId, classId);

  // 7. Audit
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "class.unarchived",
    targetType: "class",
    targetId: unarchived.id,
    before: { archivedAt: locked.archivedAt },
    after: { archivedAt: null },
  });

  return unarchived;
}

export async function archiveClass(
  tx: Tx,
  actor: Actor,
  classId: string,
): Promise<Class> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot archive this class");
  }

  // 1. Read to get sessionId (no lock)
  const initial = await repo.findClass(tx, actor.schoolId, classId);
  if (!initial) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }

  // 2. Session share lock — must come BEFORE any class lock
  await assertSessionOpen(tx, actor.schoolId, initial.sessionId);

  // 3. Now lock the class row for the idempotent check
  const locked = await repo.lockClass(tx, actor.schoolId, classId);
  if (!locked) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }

  // 4. Idempotent: already archived → no write, no audit
  if (locked.archivedAt !== null) {
    return locked;
  }

  // 5. Dependents guard (no-op until offerings/enrolments land in Step 19).
  await assertClassCanBeArchived(tx, actor.schoolId, classId);

  // 6. Archive
  const archived = await repo.archiveClass(tx, actor.schoolId, classId);

  // 7. Audit
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "class.archived",
    targetType: "class",
    targetId: archived.id,
    before: { archivedAt: null },
    after: { archivedAt: archived.archivedAt },
  });

  return archived;
}

// src/modules/academics/classes/service.ts  (bottom of file)

/**
 * Guard: refuse to archive a class that still has dependents.
 *
 * TODAY: no-op. Nothing references `classes` yet.
 *
 * 2b: implement real checks against the tables that will reference `class_id`:
 *   - offerings    (class_id, archived_at is null)          → 409 CLASS_HAS_OFFERINGS
 *   - enrolments   (class_id, status = 'active')            → 409 CLASS_HAS_ENROLMENTS
 *   - attendance   (class_id, date within session)          → 409 CLASS_HAS_ATTENDANCE
 *   - results      (class_id, status not in ('draft','void'))→ 409 CLASS_HAS_RESULTS
 *   - fees         (class_id, status not in ('paid','waived'))→ 409 CLASS_HAS_OUTSTANDING_FEES
 *
 * Each check is a SELECT 1 … LIMIT 1 against the referencing table,
 * scoped by school_id AND class_id. Throw 409 with a code specific to
 * the blocking resource so the UI can say *why* the archive is refused.
 *
 * The counterpart is `it.todo("refuses to archive a class referenced by an offering")`
 * and `it.todo("refuses to archive a class with active enrolments")` in classes.test.ts —
 * flip them to real tests as each referencer lands.
 */


async function assertClassCanBeArchived(
  tx: Tx,
  schoolId: string,
  classId: string,
): Promise<void> {
  const has = await offeringsRepo.classHasOfferings(tx, schoolId, classId);
  if (has) {
    throw new AppError(
      409,
      "CLASS_HAS_OFFERINGS",
      "Cannot archive a class with subject offerings. Withdraw the offerings first.",
    );
  }
}
