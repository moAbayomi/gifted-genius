import type { DbExecutor } from "../../db/types.js";
import { memberships } from "../../db/schema/index.js";
import { and, eq, ne } from "drizzle-orm";
import { AppError } from "../lib/errors.js";

export async function assertNoOtherSchoolMemberships(
  executor: DbExecutor,
  userId: string,
  currentSchoolId: string,
  fieldDescription: string,   // e.g. "their password", "their email"
): Promise<void> {
  const [elsewhere] = await executor
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        ne(memberships.schoolId, currentSchoolId),
      ),
    )
    .limit(1);

  if (elsewhere) {
    throw new AppError(
      409,
      "SHARED_ACCOUNT",
      `This person belongs to other schools, so only they can change ${fieldDescription}.`,
    );
  }
}