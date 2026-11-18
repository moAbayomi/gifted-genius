import { beforeEach } from "vitest";
import db from "../src/db/client.js";
import { sql } from "drizzle-orm";

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE users, schools RESTART IDENTITY CASCADE`);
});
