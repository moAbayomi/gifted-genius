// src/shared/audit/redact.ts
//
// Snapshot helpers for audit_log before/after fields.
//
// RULE: audit snapshots are field-picked, never spread whole rows.
// These helpers are the picked fields per entity. Use them everywhere.
// Never write `before: user` — always `before: redactUser(user)`.

import type { School } from "../../db/schema/index.js";

/** Safe-to-audit fields of a user. Never includes passwordHash or verification tokens. */
/* export function redactUser(user: User) {
  return {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    middleName: user.middleName,
    phone: user.phone,
    status: user.status,
    // passwordHash: OMITTED — never audit
    // emailVerifiedAt: keep boolean signal, not the timestamp
    emailVerified: user.emailVerifiedAt !== null,
    mustChangePassword: user.mustChangePassword,
    // timestamps omitted — the audit row has its own createdAt
  };
}

 */export function redactSchool(school: School) {
  return {
    name: school.name,
    slug: school.slug,
    shortName: school.shortName,
    type: school.type,
    status: school.status,
    contactEmail: school.contactEmail,
  };
}

/* export function redactMembership(m: Membership) {
  return {
    userId: m.userId,
    schoolId: m.schoolId,
    username: m.username,
    status: m.status,
    joinedAt: m.joinedAt,
  };
}

/*

/*export function redactRole(r: Role) {
  return {
    key: r.key,
    name: r.name,
    description: r.description,
    rank: r.rank,
    isSystem: r.isSystem,
  };
} 
*/