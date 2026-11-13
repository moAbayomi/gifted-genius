import { z } from "zod";

export const classIdParamSchema = z
  .object({ classId: z.uuid() })
  .strict();

export const offeringIdParamSchema = z
  .object({ classSubjectId: z.uuid() })
  .strict();

export const assignTeacherBodySchema = z
  .object({ teacherMembershipId: z.uuid() })
  .strict();

export type ClassIdParam = z.infer<typeof classIdParamSchema>;
export type OfferingIdParam = z.infer<typeof offeringIdParamSchema>;
export type AssignTeacherBody = z.infer<typeof assignTeacherBodySchema>;

export interface AssignFormTeacherInput {
  classId: string;
  teacherMembershipId: string;
}

export interface AssignSubjectTeacherInput {
  classSubjectId: string;
  teacherMembershipId: string;
}
