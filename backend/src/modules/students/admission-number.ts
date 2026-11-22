import { and, eq } from "drizzle-orm";
import type { Tx } from "../../db/types.js";
import { admissionCounters } from "../../db/schema/admission-counters.js";
import { studentProfiles } from "../../db/schema/student-profiles.js";
import { AppError } from "../../shared/lib/errors.js";

export function formatAdmissionNumber(year: number, value: number): string {
  return `ADM/${year}/${String(value).padStart(4, "0")}`;
}

/**
 * Allocate a school-scoped admission number for the current calendar year.
 *
 * The row lock serialises concurrent allocators. The loop skips numbers that
 * already exist, which covers schools that issued some numbers manually.
 * The counter is advanced even when a manual number caused a skip, so numbers
 * are never reused.
 */
export async function allocateAdmissionNumber(
  tx: Tx,
  schoolId: string,
): Promise<string> {
  const year = new Date().getUTCFullYear();

  await tx
    .insert(admissionCounters)
    .values({ schoolId, year, lastValue: 0 })
    .onConflictDoNothing();

  const [counter] = await tx
    .select()
    .from(admissionCounters)
    .where(
      and(
        eq(admissionCounters.schoolId, schoolId),
        eq(admissionCounters.year, year),
      ),
    )
    .for("update")
    .limit(1);

  if (!counter) {
    throw new AppError(500, "ADMISSION_COUNTER_MISSING", "Could not allocate an admission number");
  }

  let next = counter.lastValue;
  for (let attempts = 0; attempts < 10_000; attempts += 1) {
    next += 1;
    const candidate = formatAdmissionNumber(year, next);
    const [existing] = await tx
      .select({ id: studentProfiles.id })
      .from(studentProfiles)
      .where(
        and(
          eq(studentProfiles.schoolId, schoolId),
          eq(studentProfiles.admissionNumber, candidate),
        ),
      )
      .limit(1);
    if (!existing) {
      await tx
        .update(admissionCounters)
        .set({ lastValue: next })
        .where(
          and(
            eq(admissionCounters.schoolId, schoolId),
            eq(admissionCounters.year, year),
          ),
        );
      return candidate;
    }
  }

  throw new AppError(500, "ADMISSION_NUMBER_EXHAUSTED", "Could not allocate an admission number");
}
