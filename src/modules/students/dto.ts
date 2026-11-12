// src/modules/academics/students/dto.ts

import type { MemberRow } from "../users/repository.js";
import type { StudentProfile } from "../../db/schema/student-profiles.js";

export function toStudentDto(data: {
  student: StudentProfile;
  member: MemberRow;
}) {
  return {
    id: data.student.id,
    membershipId: data.student.membershipId,
    admissionNumber: data.student.admissionNumber,
    firstName: data.member.firstName,
    lastName: data.member.lastName,
    email: data.member.email, // string | null
    username: data.member.username, // string | null — for username-only students
    house: data.student.house,
    admissionDate: data.student.admissionDate,
    createdAt: data.student.createdAt.toISOString(),
  };
}

export type StudentDto = ReturnType<typeof toStudentDto>;
