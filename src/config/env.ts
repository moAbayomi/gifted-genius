import { z } from "zod";
import { env as loadenv } from "custom-env"


process.env.APP_STAGE = process.env.APP_STAGE || "development";

const isDevelopment = process.env.APP_STAGE === "development";
const isTesting = process.env.APP_STAGE === "test";

if (isDevelopment) {
  loadenv();
} else if (isTesting) {
  loadenv("test");
}
/* console.log("[env.ts] cwd:", process.cwd());
console.log("[env.ts] NODE_ENV:", process.env.NODE_ENV);
console.log("[env.ts] APP_STAGE:", process.env.APP_STAGE);

console.log(
  "[env.ts] DATABASE_URL after loadenv:",
  process.env.DB_URL ? "(set)" : "(missing)",
); */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_STAGE: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().positive().default(3000),
  DB_URL: z.string().startsWith("postgres"),
  DATABASE_URL_DIRECT: z.string().startsWith("postgresql://").optional(),

  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_DOMAIN: z.string().optional(),

  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:3001"),
  SEED_PASSWORD: z.string().min(10).optional(),
  ALLOW_DEMO_SEED: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  /**
   * Serve /docs and /openapi.json. Defaults to on outside production.
   * In production, set DOCS_ENABLED=true only if the docs are behind auth
   * or intentionally public.
   */
  DOCS_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});


export type Env = z.infer<typeof envSchema>;

let env: Env;

try {
  env = envSchema.parse(process.env);
} catch (e) {
  if (e instanceof z.ZodError) {
   /*  console.log("invalid env variables");
    console.error(JSON.stringify(e.flatten().fieldErrors, null, 2));
 */
    e.issues.forEach((err) => {
      const path = err.path.join(".");
      console.log(`${path}: ${err.message}`);
    });

    process.exit(1);
  }

  throw e;
}

export const isProd = () => env.APP_STAGE === "production";
export const isTest = () => env.APP_STAGE === "test";
export const isDev = () => env.APP_STAGE === "development";

/** Docs are available by default outside production. */
export const isDocsEnabled = (): boolean =>
  env.DOCS_ENABLED ?? env.APP_STAGE !== "production";

export const getAllowedOrigins = (): string[] =>
  env.ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);

export { env };
export default env;
