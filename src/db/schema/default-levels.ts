// db/schema/default-levels.ts
//
// The 6 levels every new school starts with. Used by createSchoolWithDefaults
// at creation time. The backfill migration for existing schools has the same
// data as a SQL literal — the migration's copy is frozen at that point in
// time; this constant drives future schools.
export const DEFAULT_LEVELS = [
  { name: "JSS 1", sequence: 1, stage: "junior" },
  { name: "JSS 2", sequence: 2, stage: "junior" },
  { name: "JSS 3", sequence: 3, stage: "junior" },
  { name: "SS 1", sequence: 4, stage: "senior" },
  { name: "SS 2", sequence: 5, stage: "senior" },
  { name: "SS 3", sequence: 6, stage: "senior" },
] as const;

export type DefaultLevel = (typeof DEFAULT_LEVELS)[number];
