import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db/client.js";
import type { DbExecutor } from "../../../db/types.js";
import {
  memberships,
  studentProfiles,
  users,
} from "../../../db/schema/index.js";
import { AppError } from "../../../shared/lib/errors.js";
import { hashPassword } from "../../../shared/utils/password.js";
import { can, type Actor } from "../../rbac/can.js";
import * as classRepo from "../classes/repository.js";
import { createStudent } from "../../students/service.js";
import { enrollStudent } from "../enrollment/service.js";

const importRowSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().optional(),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,40}$/)
      .optional(),
    admissionNumber: z.string().trim().min(1).max(50).optional(),
    className: z.string().trim().min(1).max(100).optional(),
    house: z.string().trim().max(100).optional(),
  })
  .strict();

export type ImportRow = z.infer<typeof importRowSchema>;

export interface ImportProblem {
  row: number;
  field: string;
  code: string;
  message: string;
}

export interface ImportValidation {
  valid: boolean;
  problems: ImportProblem[];
  /** Resolved class per valid row, by 1-based row number. */
  classByRow: Map<number, string>;
}

export interface ImportCredentials {
  row: number;
  studentId: string;
  membershipId: string;
  admissionNumber: string;
  username: string | null;
  temporaryPassword: string;
}

export interface ImportSaveResult {
  valid: boolean;
  problems: ImportProblem[];
  created: number;
  credentials: ImportCredentials[];
}

const normalizeClass = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

/** Pure validation against the DB: returns every problem, not the first. */
export async function validateImport(
  executor: DbExecutor,
  actor: Actor,
  input: unknown,
  options: { fixedClassId?: string } = {},
): Promise<ImportValidation> {
  const classScoped = options.fixedClassId !== undefined;
  if (classScoped) {
    if (!can(actor, "students:import")) {
      throw new AppError(403, "FORBIDDEN", "Cannot import students");
    }
  } else if (!can(actor, "users:create")) {
    throw new AppError(403, "FORBIDDEN", "Cannot import students");
  }
  if (!Array.isArray(input)) {
    throw new AppError(400, "VALIDATION_ERROR", "Import body must be an array of rows");
  }
  if (input.length > 200) {
    throw new AppError(400, "IMPORT_TOO_LARGE", "A request may import at most 200 rows");
  }

  const problems: ImportProblem[] = [];
  const rows: Array<{ row: number; data: ImportRow }> = [];
  input.forEach((raw, index) => {
    const parsed = importRowSchema.safeParse(raw);
    const row = index + 1;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push({
          row,
          field: issue.path.join(".") || "row",
          code: "INVALID_ROW",
          message: issue.message,
        });
      }
      return;
    }
    rows.push({ row, data: parsed.data });
  });

  const classes = await classRepo.listClasses(executor, actor.schoolId);
  const classByName = new Map(
    classes.map((cls) => [
      normalizeClass(`${cls.level.name} ${cls.armLabel}`),
      cls.id,
    ]),
  );
  const classByRow = new Map<number, string>();
  let fixedClass: (typeof classes)[number] | undefined;

  if (options.fixedClassId) {
    fixedClass = classes.find((cls) => cls.id === options.fixedClassId);
    const canAnyClass = can(actor, "users:create");
    if (
      !fixedClass ||
      (!canAnyClass &&
        fixedClass.formTeacherMembershipId !== actor.membershipId)
    ) {
      throw new AppError(404, "CLASS_NOT_FOUND", "Class not found");
    }
    for (const { row } of rows) classByRow.set(row, fixedClass.id);
  } else {
    for (const { row, data } of rows) {
      if (!data.className) {
        problems.push({
          row,
          field: "className",
          code: "UNKNOWN_CLASS",
          message: "className is required for a school-wide import",
        });
        continue;
      }
      const classId = classByName.get(normalizeClass(data.className));
      if (!classId) {
        problems.push({
          row,
          field: "className",
          code: "UNKNOWN_CLASS",
          message: `Unknown class: ${data.className}`,
        });
      } else {
        classByRow.set(row, classId);
      }
    }
  }

  const addDuplicate = (
    seen: Map<string, number>,
    value: string | undefined,
    row: number,
    field: string,
  ) => {
    if (!value) return;
    const first = seen.get(value);
    if (first !== undefined) {
      problems.push({
        row,
        field,
        code: "DUPLICATE_IN_FILE",
        message: `Duplicate ${field} in the file (first at row ${first})`,
      });
    } else {
      seen.set(value, row);
    }
  };
  const admissions = new Map<string, number>();
  const emails = new Map<string, number>();
  const usernames = new Map<string, number>();
  for (const { row, data } of rows) {
    addDuplicate(admissions, data.admissionNumber, row, "admissionNumber");
    addDuplicate(emails, data.email, row, "email");
    addDuplicate(usernames, data.username, row, "username");
  }

  // One query per database field.
  const admissionValues = [...admissions.keys()];
  if (admissionValues.length > 0) {
    const existingAdmissions = await executor
      .select({ value: studentProfiles.admissionNumber })
      .from(studentProfiles)
      .where(
        and(
          eq(studentProfiles.schoolId, actor.schoolId),
          inArray(studentProfiles.admissionNumber, admissionValues),
        ),
      );
    const existing = new Set(existingAdmissions.map((r) => r.value));
    for (const { row, data } of rows) {
      if (data.admissionNumber && existing.has(data.admissionNumber)) {
        problems.push({
          row,
          field: "admissionNumber",
          code: "DUPLICATE_IN_DATABASE",
          message: "Admission number already exists in this school",
        });
      }
    }
  }

  const emailValues = [...emails.keys()];
  if (emailValues.length > 0) {
    const existingEmails = await executor
      .select({ value: users.email })
      .from(users)
      .where(inArray(users.email, emailValues));
    const existing = new Set(existingEmails.map((r) => r.value));
    for (const { row, data } of rows) {
      if (data.email && existing.has(data.email)) {
        problems.push({
          row,
          field: "email",
          code: "DUPLICATE_IN_DATABASE",
          message: "Email already belongs to a user",
        });
      }
    }
  }

  const usernameValues = [...usernames.keys()];
  if (usernameValues.length > 0) {
    const existingUsernames = await executor
      .select({ value: memberships.username })
      .from(memberships)
      .where(
        and(
          eq(memberships.schoolId, actor.schoolId),
          inArray(memberships.username, usernameValues),
        ),
      );
    const existing = new Set(existingUsernames.map((r) => r.value));
    for (const { row, data } of rows) {
      if (data.username && existing.has(data.username)) {
        problems.push({
          row,
          field: "username",
          code: "DUPLICATE_IN_DATABASE",
          message: "Username already exists in this school",
        });
      }
    }
  }

  problems.sort((a, b) => a.row - b.row || a.field.localeCompare(b.field));
  return { valid: problems.length === 0, problems, classByRow };
}

/** Hash four passwords at a time; keep the temporary passwords in memory only. */
async function precomputeCredentials(
  rows: Array<{ row: number; data: ImportRow }>,
): Promise<Array<{ row: number; data: ImportRow; temporaryPassword: string; passwordHash: string }>> {
  const out: Array<{ row: number; data: ImportRow; temporaryPassword: string; passwordHash: string }> = [];
  for (let i = 0; i < rows.length; i += 4) {
    const chunk = rows.slice(i, i + 4);
    const prepared = await Promise.all(
      chunk.map(async ({ row, data }) => {
        const temporaryPassword = randomBytes(9).toString("base64url");
        return {
          row,
          data,
          temporaryPassword,
          passwordHash: await hashPassword(temporaryPassword),
        };
      }),
    );
    out.push(...prepared);
  }
  return out;
}

export async function saveImport(
  actor: Actor,
  input: unknown,
  options: { dryRun?: boolean; fixedClassId?: string } = {},
): Promise<ImportSaveResult> {
  const validation = await validateImport(db, actor, input, {
    ...(options.fixedClassId !== undefined
      ? { fixedClassId: options.fixedClassId }
      : {}),
  });
  if (!validation.valid || options.dryRun) {
    return {
      valid: validation.valid,
      problems: validation.problems,
      created: 0,
      credentials: [],
    };
  }
  if (!can(actor, "enrollments:manage") && !can(actor, "students:import")) {
    throw new AppError(403, "FORBIDDEN", "Cannot enroll imported students");
  }

  const rows = (input as ImportRow[]).map((data, index) => ({
    row: index + 1,
    data,
  }));
  const prepared = await precomputeCredentials(rows);

  return db.transaction(async (tx) => {
    const credentials: ImportCredentials[] = [];
    for (const { row, data, temporaryPassword, passwordHash } of prepared) {
      const classId = validation.classByRow.get(row);
      if (!classId) {
        throw new AppError(400, "IMPORT_INVALID", "Class was not resolved");
      }
      const student = await createStudent(
        tx,
        actor,
        {
          firstName: data.firstName,
          lastName: data.lastName,
          ...(data.email !== undefined ? { email: data.email } : {}),
          ...(data.username !== undefined ? { username: data.username } : {}),
          ...(data.admissionNumber !== undefined
            ? { admissionNumber: data.admissionNumber }
            : {}),
          ...(data.house !== undefined ? { house: data.house } : {}),
        },
        { temporaryPassword, passwordHash },
      );
      await enrollStudent(tx, actor, {
        studentId: student.student.id,
        classId,
      });
      credentials.push({
        row,
        studentId: student.student.id,
        membershipId: student.membershipId,
        admissionNumber: student.student.admissionNumber,
        username: student.member.username,
        temporaryPassword,
      });
    }
    return {
      valid: true,
      problems: [],
      created: credentials.length,
      credentials,
    };
  });
}
