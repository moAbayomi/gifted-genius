export type LevelStage = "junior" | "senior";

export interface PromotionLevel {
  id: string;
  name: string;
  sequence: number;
  stage: LevelStage;
}

export interface PromotionClass {
  id: string;
  levelId: string;
  armLabel: string;
  track: string;
  archivedAt: Date | null;
}

export interface PromotionEnrollment {
  enrollmentId: string;
  studentId: string;
  sourceClassId: string;
  /** Administrator explicitly marked this student as repeating the level. */
  repeat?: boolean;
}

export interface SuggestPromotionsInput {
  enrollments: PromotionEnrollment[];
  sourceClasses: PromotionClass[];
  targetClasses: PromotionClass[];
  levels: PromotionLevel[];
}

export type PromotionAction =
  | "promote"
  | "graduate"
  | "choose_track"
  | "no_matching_class";

export interface PromotionSuggestion {
  enrollmentId: string;
  studentId: string;
  sourceClassId: string;
  targetClassId: string | null;
  targetLevelId: string | null;
  action: PromotionAction;
  warning: "CHOOSE_TRACK" | "NO_MATCHING_CLASS" | null;
}

const classKey = (levelId: string, armLabel: string, track: string) =>
  `${levelId}\u0000${armLabel}\u0000${track}`;

/**
 * Pure suggestion logic. It never reads the database and never writes anything.
 * The caller supplies both sessions' classes and the school's levels.
 */
export function suggestPromotions(
  input: SuggestPromotionsInput,
): PromotionSuggestion[] {
  const levelsById = new Map(input.levels.map((l) => [l.id, l]));
  const levelsBySequence = new Map(input.levels.map((l) => [l.sequence, l]));
  const sourceById = new Map(input.sourceClasses.map((c) => [c.id, c]));
  const targetByKey = new Map(
    input.targetClasses
      .filter((c) => c.archivedAt === null)
      .map((c) => [classKey(c.levelId, c.armLabel, c.track), c]),
  );

  return input.enrollments.map((enrollment) => {
    const sourceClass = sourceById.get(enrollment.sourceClassId);
    if (!sourceClass) {
      return {
        enrollmentId: enrollment.enrollmentId,
        studentId: enrollment.studentId,
        sourceClassId: enrollment.sourceClassId,
        targetClassId: null,
        targetLevelId: null,
        action: "no_matching_class",
        warning: "NO_MATCHING_CLASS",
      };
    }

    const sourceLevel = levelsById.get(sourceClass.levelId);
    if (!sourceLevel) {
      return {
        enrollmentId: enrollment.enrollmentId,
        studentId: enrollment.studentId,
        sourceClassId: sourceClass.id,
        targetClassId: null,
        targetLevelId: null,
        action: "no_matching_class",
        warning: "NO_MATCHING_CLASS",
      };
    }

    // A repeat stays at the same level, arm, and track. It is explicit; it is
    // never inferred from a missing target class.
    const targetLevel = enrollment.repeat
      ? sourceLevel
      : levelsBySequence.get(sourceLevel.sequence + 1);

    if (!targetLevel) {
      return {
        enrollmentId: enrollment.enrollmentId,
        studentId: enrollment.studentId,
        sourceClassId: sourceClass.id,
        targetClassId: null,
        targetLevelId: null,
        action: "graduate",
        warning: null,
      };
    }

    // JSS 3 -> SS 1 is a track choice, not a copy. Even if matching SS 1
    // classes exist, the administrator must choose one.
    if (
      !enrollment.repeat &&
      sourceLevel.stage === "junior" &&
      targetLevel.stage === "senior"
    ) {
      return {
        enrollmentId: enrollment.enrollmentId,
        studentId: enrollment.studentId,
        sourceClassId: sourceClass.id,
        targetClassId: null,
        targetLevelId: targetLevel.id,
        action: "choose_track",
        warning: "CHOOSE_TRACK",
      };
    }

    const targetClass = targetByKey.get(
      classKey(targetLevel.id, sourceClass.armLabel, sourceClass.track),
    );

    if (!targetClass) {
      return {
        enrollmentId: enrollment.enrollmentId,
        studentId: enrollment.studentId,
        sourceClassId: sourceClass.id,
        targetClassId: null,
        targetLevelId: targetLevel.id,
        action: "no_matching_class",
        warning: "NO_MATCHING_CLASS",
      };
    }

    return {
      enrollmentId: enrollment.enrollmentId,
      studentId: enrollment.studentId,
      sourceClassId: sourceClass.id,
      targetClassId: targetClass.id,
      targetLevelId: targetLevel.id,
      action: "promote",
      warning: null,
    };
  });
}
