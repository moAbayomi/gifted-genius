import type { OfferingWithSubject } from "./repository.js";

export function toOfferingDto(o: OfferingWithSubject) {
  return {
    id: o.id,
    classId: o.classId,
    subjectId: o.subjectId,
    subject: {
      id: o.subject.id,
      code: o.subject.code,
      name: o.subject.name,
    },
    isCompulsory: o.isCompulsory,
    electiveGroupId: o.electiveGroupId,
    archivedAt: o.archivedAt?.toISOString() ?? null,
  };
}

export type OfferingDto = ReturnType<typeof toOfferingDto>;