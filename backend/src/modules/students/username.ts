import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Tx } from "../../db/types.js";
import { memberships } from "../../db/schema/memberships.js";

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/[._-]{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "");
}

async function isTaken(tx: Tx, schoolId: string, username: string) {
  const [row] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.schoolId, schoolId),
        eq(memberships.username, username),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Generate a school-unique login handle for a student.
 *
 * Name-based handles are readable, but are not guaranteed unique (siblings
 * share a surname). When the readable base is taken, fall back to the
 * admission number, which is already unique in the school.
 */
export async function generateStudentUsername(
  tx: Tx,
  schoolId: string,
  args: {
    firstName: string;
    lastName: string;
    admissionNumber: string;
  },
): Promise<string> {
  const fromName = normalize(`${args.firstName}.${args.lastName}`);
  const fromAdmission = normalize(args.admissionNumber);
  const candidates = [fromName, fromAdmission];

  for (const candidate of candidates) {
    const value = candidate.slice(0, 40);
    if (USERNAME_RE.test(value) && !(await isTaken(tx, schoolId, value))) {
      return value;
    }
  }

  const fallback = `student.${randomBytes(4).toString("hex")}`;
  if (!(await isTaken(tx, schoolId, fallback))) return fallback;

  throw new Error("Could not generate a unique username");
}
