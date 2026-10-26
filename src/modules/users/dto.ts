// modules/users/dto.ts
import type { MemberRow } from "./repository.js";

/**
 * A member = a user's relationship with ONE school.
 * `id` is the membership ID, not the user ID. The same person at two schools
 * has two memberships, two IDs in the API. Clients never see raw user IDs
 * in school-scoped endpoints — they operate on memberships.
 *
 * Fields exposed: only what the client needs for list display and
 * identifying the member. Never passwordHash, emailVerifiedAt,
 * lastLoginAt, mustChangePassword, or any internal timestamp.
 */
export interface MemberDto {
  /** Membership ID (NOT the user ID). */
  id: string;
  username: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  /** Membership status in THIS school. `active | inactive | suspended`. */
  status: "active" | "inactive" | "suspended";
  /** Role keys: ["teacher"], ["teacher", "guardian"], etc. */
  roles: string[];
  /** ISO-8601 string. Never a Date object — JSON has no Date. */
  joinedAt: string;
}

/**
 * Map a joined row (memberships + users + aggregated role keys) to the DTO.
 * The repository produces MemberRow; this function turns it into the wire shape.
 */
export function toMemberDto(row: MemberRow): MemberDto {
  return {
    id: row.membershipId,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    status: row.status,
    roles: row.roleKeys,
    joinedAt: row.joinedAt.toISOString(),
  };
}

/**
 * Response body for POST /users.
 *   - If a NEW user was created: temporaryPassword is present.
 *   - If an EXISTING user was linked to this school: temporaryPassword is ABSENT
 *     (they use their existing password).
 *
 * The temp password is returned once, never again. If they lose it, an admin
 * issues a password reset.
 */
export interface CreateUserResponseDto {
  user: MemberDto;
  temporaryPassword?: string;
}

/**
 * Build the creation response. Only includes temporaryPassword when a new
 * user was created — avoids sending `temporaryPassword: undefined` (which
 * would be a `key present, value undefined` under exactOptionalPropertyTypes).
 */
export function toCreateUserResponseDto(
  row: MemberRow,
  temporaryPassword?: string,
): CreateUserResponseDto {
  const dto: CreateUserResponseDto = { user: toMemberDto(row) };
  if (temporaryPassword) {
    dto.temporaryPassword = temporaryPassword;
  }
  return dto;
}