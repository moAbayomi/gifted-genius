import { defineConfig } from "drizzle-kit";
import env from "./src/config/env.js";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DB_URL!,
  },
  verbose: true,
  strict: true,
});
