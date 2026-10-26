// scripts/seed.ts
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { seed } from "../db/seed.js";

function guard() {
  if (process.env.APP_STAGE === "production" && !env.ALLOW_DEMO_SEED) {
    throw new Error(
      "Refusing to seed in production. Set ALLOW_DEMO_SEED=true to override.",
    );
  }
  if (!env.SEED_PASSWORD) {
    throw new Error("SEED_PASSWORD is not set (minimum 10 characters).");
  }
  return env.SEED_PASSWORD
}

try {
  const password = guard();
  if (!password) {
    throw new Error("error: seed password not set");
  }
  const result = await seed({ password });
  console.log(`\n✓ School: ${result.school.name} (${result.school.slug})`);
  console.log(`✓ Owner:  ${result.owner.email}`);
  console.log(`✓ Demo users: ${result.demoUsers.length}`);
  console.log("\nAll demo users share the SEED_PASSWORD.");
  console.log("Done.");
} catch (err) {
  console.error("Seed failed:", err);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
