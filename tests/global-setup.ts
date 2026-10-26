import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import env from "../src/config/env.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
console.log("[drizzle.config] APP_STAGE =", env.APP_STAGE);
console.log("[drizzle.config] DB URL host =", new URL(env.DB_URL!).host);
console.log("project root =", projectRoot);

export default async function () {
  // 1. Start the test Postgres (tmpfs → empty every run)
  execSync("docker compose up -d --wait db-test", {
    stdio: "inherit",
    cwd: projectRoot,
  });

  try {
    // 2. Apply migrations to the fresh DB.
    //    - npx finds the local drizzle-kit in node_modules/.bin
    //    - APP_STAGE=test is inherited from the parent process (cross-env)
    //      → drizzle.config.ts reads .env.test → test DB URL
    execSync("npx drizzle-kit migrate", {
      stdio: "inherit",
      cwd: projectRoot,
    });
  } catch (err) {
    // If migrate fails, tear down the container so the next run starts fresh.
    // Without this, the container is left running with a half-migrated DB,
    // and the next `up -d --wait` reuses it (tmpfs persists while running),
    // so migrate runs again against broken state.
    execSync("docker compose down db-test", { stdio: "inherit", cwd: projectRoot });
    throw err;
  }

  // 3. Cleanup — runs after tests pass OR fail.
  //    Scope to db-test: the dev database (`db`) must survive a test run.
  return async () => {
    execSync("docker compose down db-test", { stdio: "inherit", cwd: projectRoot });
  };
}
