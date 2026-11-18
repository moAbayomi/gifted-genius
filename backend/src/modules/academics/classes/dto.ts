// src/modules/academics/classes/dto.ts
import type { ClassWithLevel } from "./repository.js";

export function toClassDto(cls: ClassWithLevel) {
  return {
    id:        cls.id,
    sessionId: cls.sessionId,
    levelId:   cls.levelId,
    armLabel:  cls.armLabel,
    track:     cls.track,
    level: {
      id:       cls.level.id,
      name:     cls.level.name,
      sequence: cls.level.sequence,
      stage:    cls.level.stage,
    },
    archivedAt: cls.archivedAt?.toISOString() ?? null,
  };
}