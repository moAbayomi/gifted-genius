import { components, paths } from "./schema";

type Schemas = components["schemas"];

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export type MeResponse = Schemas["MeResponse"];
export type Member = Schemas["Member"];
export type CreateUserResponse = Schemas["CreateUserResponse"];
export type MeAssignmentsResponse = Schemas["MeAssignmentsResponse"];
export type RosterResponse = Schemas["RosterResponse"];
export type RosterEntry = Schemas["RosterEntryDto"];
export type AcademicSession = Schemas["AcademicSession"];
export type Term = Schemas["Term"];
export type Level = Schemas["Level"];
export type ClassRecord = Schemas["Class"];
export type Subject = Schemas["SubjectDto"];
export type Offering = Schemas["OfferingDto"];
export type Enrollment = Schemas["EnrollmentDto"];
export type PromotionPreview = Schemas["PromotionPreview"];
export type PromotionCommitResult = Schemas["PromotionCommitResult"];
export type ImportProblem = Schemas["ImportProblem"];
export type ImportValidation = Schemas["ImportValidation"];
export type ImportSaveResult = Schemas["ImportSaveResult"];
export type MemberListResponse = Schemas["MemberListResponse"];

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as {
      error?: {
        code?: string;
        message?: string;
        fields?: Record<string, string>;
      };
    } | null;
    const error = errBody?.error;

    throw new ApiError(
      res.status,
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? `Request failed with status ${res.status}`,
      error?.fields,
    );
  }
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export type LoginPayload =
  paths["/auth/login"]["post"]["requestBody"]["content"]["application/json"];

export type LoginResponse = Schemas["LoginResponse"];

export function loginRequest(payload: LoginPayload) {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logoutRequest() {
  return apiFetch<{ ok: true }>("/auth/logout", {
    method: "POST",
  });
}

export function fetchMe() {
  return apiFetch<MeResponse>("/me");
}

export type ChangePasswordPayload =
  paths["/auth/change-password"]["post"]["requestBody"]["content"]["application/json"];

export function changePasswordRequest(payload: ChangePasswordPayload) {
  return apiFetch<{ ok: true }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listMembers(
  params: {
    limit?: number;
    offset?: number;
    roleKind?: "staff" | "student" | "guardian";
  } = {},
) {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 25));
  query.set("offset", String(params.offset ?? 0));
  if (params.roleKind) query.set("roleKind", params.roleKind);
  return apiFetch<MemberListResponse>(`/users?${query.toString()}`);
}

export type CreateUserPayload =
  paths["/users"]["post"]["requestBody"]["content"]["application/json"];

export function createMember(payload: CreateUserPayload) {
  return apiFetch<CreateUserResponse>("/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMyAssignments() {
  return apiFetch<MeAssignmentsResponse>("/me/assignments");
}

export function fetchClassRoster(
  classId: string,
  params: { limit?: number; offset?: number } = {},
) {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 50));
  query.set("offset", String(params.offset ?? 0));
  return apiFetch<RosterResponse>(
    `/classes/${encodeURIComponent(classId)}/roster?${query.toString()}`,
  );
}

export function listSessions() {
  return apiFetch<Schemas["AcademicSessionListResponse"]>("/sessions?limit=100");
}

export function createSession(label: string) {
  return apiFetch<Schemas["AcademicSessionResponse"]>("/sessions", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export function listTerms(sessionId: string) {
  return apiFetch<Schemas["TermListResponse"]>(
    `/terms?sessionId=${encodeURIComponent(sessionId)}&limit=100`,
  );
}

export function createTerm(input: {
  sessionId: string;
  number: number;
  name: string;
  startDate: string;
  endDate: string;
}) {
  return apiFetch<Schemas["TermResponse"]>("/terms", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function activateTerm(termId: string) {
  return apiFetch<Schemas["TermResponse"]>(`/terms/${encodeURIComponent(termId)}/activate`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
}

export function listLevels() {
  return apiFetch<Schemas["LevelListResponse"]>("/levels");
}

export function listClasses(sessionId: string) {
  return apiFetch<Schemas["ClassListResponse"]>(
    `/classes?sessionId=${encodeURIComponent(sessionId)}&limit=100`,
  );
}

export function createClass(input: {
  sessionId: string;
  levelId: string;
  armLabel: string;
  track: ClassRecord["track"];
}) {
  return apiFetch<Schemas["ClassResponse"]>("/classes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listSubjects() {
  return apiFetch<Schemas["SubjectListResponse"]>("/subjects?limit=100");
}

export function createSubject(input: { code: string; name: string }) {
  return apiFetch<{ subject: Schemas["SubjectDto"] }>("/subjects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listOfferings(classId: string) {
  return apiFetch<Schemas["OfferingListResponse"]>(
    `/classes/${encodeURIComponent(classId)}/offerings?limit=100`,
  );
}

export function addOfferings(
  classId: string,
  subjects: Array<{ subjectId: string; isCompulsory: boolean }>,
) {
  return apiFetch<{ offerings: Schemas["OfferingDto"][] }>(
    `/classes/${encodeURIComponent(classId)}/offerings`,
    {
      method: "POST",
      body: JSON.stringify({ subjects }),
    },
  );
}

export function listEnrollments(params: { classId?: string; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit ?? 100));
  query.set("offset", String(params.offset ?? 0));
  if (params.classId) query.set("classId", params.classId);
  return apiFetch<{ data: Enrollment[]; pagination: Schemas["Pagination"] }>(
    `/enrollments?${query.toString()}`,
  );
}

export function enrollStudent(input: { studentId: string; classId: string }) {
  return apiFetch<Schemas["EnrollmentSummaryDto"]>("/enrollments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function setElectives(enrollmentId: string, offeringIds: string[]) {
  return apiFetch<Schemas["ElectivesResultDto"]>(
    `/enrollments/${encodeURIComponent(enrollmentId)}/electives`,
    { method: "POST", body: JSON.stringify({ offeringIds }) },
  );
}

export function transferEnrollment(enrollmentId: string, targetClassId: string) {
  return apiFetch<Schemas["TransferResponse"]>(
    `/enrollments/${encodeURIComponent(enrollmentId)}/transfer`,
    { method: "POST", body: JSON.stringify({ targetClassId }) },
  );
}

export function withdrawEnrollment(enrollmentId: string, reason?: string) {
  return apiFetch<Schemas["OkResponse"]>(
    `/enrollments/${encodeURIComponent(enrollmentId)}/withdraw`,
    {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
}

export function updateClass(
  classId: string,
  input: { armLabel?: string; track?: ClassRecord["track"] },
) {
  return apiFetch<Schemas["ClassResponse"]>(`/classes/${encodeURIComponent(classId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function previewPromotion(sourceSessionId: string, targetSessionId: string) {
  return apiFetch<PromotionPreview>(
    `/sessions/${encodeURIComponent(sourceSessionId)}/promotion/preview?targetSessionId=${encodeURIComponent(targetSessionId)}`,
  );
}

export function commitPromotionPlan(
  sourceSessionId: string,
  targetSessionId: string,
  rows: Array<{ enrollmentId: string; targetClassId: string | null; repeat?: boolean }>,
) {
  return apiFetch<PromotionCommitResult>(
    `/sessions/${encodeURIComponent(sourceSessionId)}/promotion/commit`,
    {
      method: "POST",
      body: JSON.stringify({ targetSessionId, rows }),
    },
  );
}

export function validateStudentImport(rows: unknown[]) {
  return apiFetch<ImportValidation>("/students/import/validate", {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}

export function saveStudentImport(rows: unknown[]) {
  return apiFetch<ImportSaveResult>("/students/import", {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}
