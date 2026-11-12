import type { DbExecutor, Tx } from "../../../db/types.js";
import { AppError } from "../../../shared/lib/errors.js";
import { recordAudit } from "../../../shared/audit/record.js";
import { can, type Actor } from "../../rbac/can.js";
import type { Subject } from "../../../db/schema/subjects.js";
import * as repo from "./repository.js";
import * as offeringsRepo from "../offerings/repository.js";

// ── createSubject ─────────────────────────────────────────────────────

export async function createSubject(
  tx: Tx,
  actor: Actor,
  input: { code: string; name: string },
): Promise<Subject> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot create subjects");
  }

  // Normalize (belt-and-braces: Zod trimmed already; service normalizes
  // authoritative for direct callers — tests, other services).
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code) throw new AppError(400, "VALIDATION_ERROR", "code is required");
  if (!name) throw new AppError(400, "VALIDATION_ERROR", "name is required");

  // Pre-check: distinguish archived from live before attempting insert.
  const existing = await repo.findSubjectByCode(tx, actor.schoolId, code);
  if (existing) {
    if (existing.archivedAt !== null) {
      throw new AppError(
        409,
        "SUBJECT_ARCHIVED_EXISTS",
        `A subject with code "${code}" already exists and is archived; unarchive it instead of creating a new one`,
      );
    }
    throw new AppError(
      409,
      "SUBJECT_CODE_TAKEN",
      `A subject with code "${code}" already exists`,
    );
  }

  const created = await repo.createSubject(tx, {
    schoolId: actor.schoolId,
    code,
    name,
  });

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "subject.created",
    targetType: "subject",
    targetId: created.id,
    after: { code: created.code, name: created.name },
  });

  return created;
}

// ── listSubjects ──────────────────────────────────────────────────────

export async function listSubjects(
  executor: DbExecutor,
  actor: Actor,
  opts: { includeArchived?: boolean } = {},
): Promise<Subject[]> {
  if (!can(actor, "academics:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list subjects");
  }
  if (opts.includeArchived && !can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list archived subjects");
  }
  return repo.listSubjects(executor, actor.schoolId, opts);
}

// ── updateSubject ─────────────────────────────────────────────────────

export async function updateSubject(
  tx: Tx,
  actor: Actor,
  subjectId: string,
  input: { code?: string | undefined; name?: string | undefined },
): Promise<Subject> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot update subjects");
  }

  // Lock first — serializes with concurrent archive/update of the same row.
  const existing = await repo.lockSubject(tx, actor.schoolId, subjectId);
  if (!existing) {
    throw new AppError(404, "SUBJECT_NOT_FOUND", "Subject not found");
  }
  if (existing.archivedAt !== null) {
    throw new AppError(
      409,
      "SUBJECT_ARCHIVED",
      "Cannot update an archived subject",
    );
  }

  // Normalize the patch.
  const patch: { code?: string; name?: string } = {};
  if (input.code !== undefined) {
    const code = input.code.trim().toUpperCase();
    if (!code)
      throw new AppError(400, "VALIDATION_ERROR", "code cannot be empty");
    patch.code = code;
  }
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name)
      throw new AppError(400, "VALIDATION_ERROR", "name cannot be empty");
    patch.name = name;
  }
  if (Object.keys(patch).length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "no fields to update");
  }

  // Code collision pre-check (excluding self).
  if (patch.code !== undefined && patch.code !== existing.code) {
    const collision = await repo.findSubjectByCode(
      tx,
      actor.schoolId,
      patch.code,
    );
    if (collision) {
      if (collision.archivedAt !== null) {
        throw new AppError(
          409,
          "SUBJECT_ARCHIVED_EXISTS",
          `A subject with code "${patch.code}" already exists and is archived; unarchive it instead`,
        );
      }
      throw new AppError(
        409,
        "SUBJECT_CODE_TAKEN",
        `A subject with code "${patch.code}" already exists`,
      );
    }
  }

  const updated = await repo.updateSubject(
    tx,
    actor.schoolId,
    subjectId,
    patch,
  );

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "subject.updated",
    targetType: "subject",
    targetId: updated.id,
    before: { code: existing.code, name: existing.name },
    after: { code: updated.code, name: updated.name },
  });

  return updated;
}

// ── archiveSubject ────────────────────────────────────────────────────

export async function archiveSubject(
  tx: Tx,
  actor: Actor,
  subjectId: string,
): Promise<Subject> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot archive subjects");
  }

  const existing = await repo.lockSubject(tx, actor.schoolId, subjectId);
  if (!existing) {
    throw new AppError(404, "SUBJECT_NOT_FOUND", "Subject not found");
  }

  // Idempotent: already archived → return the row, no write, no audit.
  if (existing.archivedAt !== null) {
    return existing;
  }

  await assertSubjectCanBeArchived(tx, actor.schoolId, subjectId);

  const archived = await repo.archiveSubject(tx, actor.schoolId, subjectId);

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "subject.archived",
    targetType: "subject",
    targetId: archived.id,
    before: { archivedAt: null },
    after: { archivedAt: archived.archivedAt },
  });

  return archived;
}

async function assertSubjectCanBeArchived(
  tx: Tx,
  schoolId: string,
  subjectId: string,
): Promise<void> {
  const has = await offeringsRepo.subjectHasOfferings(tx, schoolId, subjectId);
  if (has) {
    throw new AppError(
      409,
      "SUBJECT_HAS_OFFERINGS",
      "Cannot archive a subject that is offered in any class. Withdraw the offerings first.",
    );
  }
}
