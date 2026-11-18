import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import db from "../db/client.js";
import { users } from "../db/schema/index.js";
import { env } from "../config/env.js";
import { hashPassword } from "../shared/utils/password.js";
import { one } from "../shared/utils/assert.js";
import { createSchoolWithDefaults } from "../modules/schools/service.js";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    "owner-email": { type: "string" },
    "owner-name": { type: "string" },
    confirm: { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: false,
});

function fail(message: string): never {
  console.error(`school:create: ${message}`);
  process.exit(1);
}

const name = values.name?.trim();
const slug = values.slug?.trim().toLowerCase();
const email = values["owner-email"]?.trim().toLowerCase();
const ownerName = values["owner-name"]?.trim();

if (!name || !slug || !email || !ownerName) {
  fail("--name, --slug, --owner-email and --owner-name are required");
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  fail("--slug must use lowercase letters, digits, and hyphens");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail("--owner-email is not a valid email address");
}
if (env.APP_STAGE === "production" && !values.confirm) {
  fail("refusing to create a school in production without --confirm");
}

const parts = ownerName!.split(/\s+/);
const firstName = parts[0]!;
const lastName = parts.slice(1).join(" ") || "Owner";
const temporaryPassword = randomBytes(9).toString("base64url");

try {
  const passwordHash = await hashPassword(temporaryPassword);
  const result = await db.transaction(async (tx) => {
    const owner = one(
      await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          firstName,
          lastName,
          mustChangePassword: true,
        })
        .returning(),
    );
    const created = await createSchoolWithDefaults(
      { name: name!, slug, ownerUserId: owner.id },
      { tx, via: "cli" },
    );
    return { owner, ...created };
  });

  console.log(`School created: ${result.school.name} (${result.school.slug})`);
  console.log(`Owner: ${result.owner.email} (${result.ownerMembership.id})`);
  console.log(`Temporary password: ${temporaryPassword}`);
  console.log("This password is shown once. The owner must change it at first login.");
} catch (err) {
  console.error("school:create failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
