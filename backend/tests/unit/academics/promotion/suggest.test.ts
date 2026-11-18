import { describe, it, expect } from "vitest";
import {
  suggestPromotions,
  type PromotionClass,
  type PromotionLevel,
} from "../../../../src/modules/academics/promotion/suggest.js";

const levels: PromotionLevel[] = [
  { id: "jss1", name: "JSS 1", sequence: 1, stage: "junior" },
  { id: "jss2", name: "JSS 2", sequence: 2, stage: "junior" },
  { id: "jss3", name: "JSS 3", sequence: 3, stage: "junior" },
  { id: "ss1", name: "SS 1", sequence: 4, stage: "senior" },
  { id: "ss2", name: "SS 2", sequence: 5, stage: "senior" },
  { id: "ss3", name: "SS 3", sequence: 6, stage: "senior" },
];

const cls = (
  id: string,
  levelId: string,
  armLabel: string,
  track: string,
  archivedAt: Date | null = null,
): PromotionClass => ({ id, levelId, armLabel, track, archivedAt });

function suggest(
  sourceClass: PromotionClass,
  targetClasses: PromotionClass[],
  repeat = false,
) {
  return suggestPromotions({
    enrollments: [{
      enrollmentId: "e1",
      studentId: "s1",
      sourceClassId: sourceClass.id,
      ...(repeat ? { repeat: true } : {}),
    }],
    sourceClasses: [sourceClass],
    targetClasses,
    levels,
  })[0]!;
}

describe("suggestPromotions", () => {
  it("promotes an ordinary class to the next level, same arm and track", () => {
    const source = cls("j1a", "jss1", "A", "general");
    const target = cls("j2a", "jss2", "A", "general");
    expect(suggest(source, [target])).toMatchObject({
      action: "promote",
      targetClassId: "j2a",
      targetLevelId: "jss2",
      warning: null,
    });
  });

  it("keeps a repeat at the same level and arm", () => {
    const source = cls("j1a", "jss1", "A", "general");
    const target = cls("j1a-target", "jss1", "A", "general");
    expect(suggest(source, [target], true)).toMatchObject({
      action: "promote",
      targetClassId: "j1a-target",
      targetLevelId: "jss1",
    });
  });

  it("graduates the last level", () => {
    const source = cls("ss3a", "ss3", "A", "science");
    expect(suggest(source, [])).toMatchObject({
      action: "graduate",
      targetClassId: null,
      targetLevelId: null,
      warning: null,
    });
  });

  it("requires a track choice at JSS 3 -> SS 1", () => {
    const source = cls("j3a", "jss3", "A", "general");
    const target = cls("ss1a", "ss1", "A", "science");
    expect(suggest(source, [target])).toMatchObject({
      action: "choose_track",
      targetClassId: null,
      targetLevelId: "ss1",
      warning: "CHOOSE_TRACK",
    });
  });

  it("reports a missing arm in the target session", () => {
    const source = cls("j1b", "jss1", "B", "general");
    const target = cls("j2a", "jss2", "A", "general");
    expect(suggest(source, [target])).toMatchObject({
      action: "no_matching_class",
      warning: "NO_MATCHING_CLASS",
      targetClassId: null,
    });
  });

  it("reports an archived target class as no match", () => {
    const source = cls("j1a", "jss1", "A", "general");
    const target = cls("j2a", "jss2", "A", "general", new Date());
    expect(suggest(source, [target])).toMatchObject({
      action: "no_matching_class",
      warning: "NO_MATCHING_CLASS",
    });
  });

  it("keeps the track: SS 1 Science goes to SS 2 Science, not Arts", () => {
    const source = cls("ss1sci", "ss1", "A", "science");
    const targetScience = cls("ss2sci", "ss2", "A", "science");
    const targetArts = cls("ss2art", "ss2", "A", "arts");
    expect(suggest(source, [targetScience, targetArts])).toMatchObject({
      action: "promote",
      targetClassId: "ss2sci",
      targetLevelId: "ss2",
    });
  });
});
