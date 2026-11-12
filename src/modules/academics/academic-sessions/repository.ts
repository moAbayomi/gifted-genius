import { and, eq } from "drizzle-orm";
import {
  academicSessions,
  type AcademicSession,
} from "../../../db/schema/academic-sessions.js";
import type { DbExecutor } from "../../../db/types.js";

export async function findSession(
  executor: DbExecutor,
  schoolId: string,
  sessionId: string,
): Promise<AcademicSession | null> {
  const [row] = await executor
    .select()
    .from(academicSessions)
    .where(
      and(
        eq(academicSessions.schoolId, schoolId),
        eq(academicSessions.id, sessionId),
      ),
    )
    .limit(1);
  return row ?? null;
}