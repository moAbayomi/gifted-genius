import type { AcademicSession } from "../../../db/schema/index.js";

export function toAcademicSessionDto(session: AcademicSession) {
  return {
    id: session.id,
    label: session.label,
    closedAt: session.closedAt?.toISOString() ?? null,
  };
}
