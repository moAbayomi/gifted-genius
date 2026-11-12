import type { Subject } from "../../../db/schema/subjects.js";

export function toSubjectDto(subject: Subject) {
  return {
    id: subject.id,
    code: subject.code,
    name: subject.name,
    archivedAt: subject.archivedAt?.toISOString() ?? null,
  };
}

export type SubjectDto = ReturnType<typeof toSubjectDto>;