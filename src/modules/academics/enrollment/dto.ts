import type { EnrollResult } from "./service.js";
import type { ClassEnrollment } from "../../../db/schema/class-enrollments.js";
import type { TransferResult } from "./transfer.js";
import type { SetElectivesResult } from "./electives.js";
import type { RosterRow } from "./repository.js";

export function toEnrollResultDto(r: EnrollResult) {
  return {
    studentId: r.studentId,
    classId: r.classId,
    enrollmentId: r.enrollmentId,
    compulsorySubjects: r.compulsorySubjects,
  };
}

export type EnrollResultDto = ReturnType<typeof toEnrollResultDto>;

// Full — what `transferStudent` returns.
export function toEnrollmentDto(e: ClassEnrollment) {
  return {
    id: e.id,
    studentId: e.studentId,
    classId: e.classId,
    sessionId: e.sessionId,
    status: e.status,
    startedAt: e.startedAt.toISOString(),
    endedAt: e.endedAt?.toISOString() ?? null,
    endedReason: e.endedReason,
    transferredFromEnrollmentId: e.transferredFromEnrollmentId,
  };
}

export function toTransferDto(r: TransferResult) {
  return {
    oldEnrollment: toEnrollmentDto(r.oldEnrollment),
    newEnrollment: toEnrollmentDto(r.newEnrollment),
    compulsorySubjects: r.compulsorySubjects,
  };
}

export function toElectivesResultDto(r: SetElectivesResult) {
  return {
    complete: r.complete,
    problems: r.problems,
    groups: r.groups,
    active: r.active,
    dropped: r.dropped,
  };
}

// Convenience for bulk responses.
export function toBulkEnrollDto(results: EnrollResult[]) {
  return { results: results.map(toEnrollResultDto) };
}

export function toRosterEntryDto(r: RosterRow) {
  return {
    enrollmentId: r.enrollmentId,
    studentId: r.studentId,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    admissionNumber: r.admissionNumber,
    house: r.house,
    startedAt: r.startedAt.toISOString(),
  };
}

export type RosterEntryDto = ReturnType<typeof toRosterEntryDto>;
