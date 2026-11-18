import { env, getAllowedOrigins, isDocsEnabled } from "./config/env.js";
import express, { urlencoded } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { type Logger, pino } from "pino";
import { errorHandler, notFound } from "./shared/middleware/error-handler.js";
import { authRouter } from "./modules/auth/routes.js";
import { usersRouter } from "./modules/users/routes.js";
import { rolesRouter } from "./modules/roles/routes.js";
import { auditRouter } from "./modules/audit/routes.js";
import { calendarRouter } from "./modules/academics/calendar/routes.js";
import { academicSessionsRouter } from "./modules/academics/academic-sessions/routes.js";
import { assignmentsRouter } from "./modules/academics/assignments/routes.js";
import { createDocsRouter } from "./openapi/router.js";
import { levelsRouter } from "./modules/academics/levels/routes.js";
import { classesRouter } from "./modules/academics/classes/routes.js";
import { subjectsRouter } from "./modules/academics/subjects/routes.js";
import { electiveGroupsRouter } from "./modules/academics/elective-groups/routes.js";
import { studentsRouter } from "./modules/students/routes.js";
import { enrollmentsRouter } from "./modules/academics/enrollment/routes.js";
import { requireAuth } from "./modules/auth/middleware/require-auth.js";
import { requirePermission } from "./modules/rbac/middleware/require-permission.js";
import { offeringsRouter } from "./modules/academics/offerings/routes.js";

export function buildApp(opts?: { logger?: Logger }): express.Express {
  const app = express();

  const logger =
    opts?.logger ??
    pino({
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'res.headers["set-cookie"]',
        ],
        remove: true,
      },
    });

  app.use(
    cors({
      origin: getAllowedOrigins(),
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(urlencoded({ extended: true }));

  if (env.APP_STAGE === "production") {
    app.set("trust proxy", 2); // one proxy in front of Node
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/v1", authRouter);
  app.use("/api/v1", usersRouter);
  app.use("/api/v1", rolesRouter);
  app.use("/api/v1", auditRouter);
  app.use("/api/v1", levelsRouter);
  app.use("/api/v1", classesRouter);
  app.use("/api/v1", calendarRouter);
  app.use("/api/v1", academicSessionsRouter);
  app.use("/api/v1", assignmentsRouter);
  app.use("/api/v1", subjectsRouter);
  app.use("/api/v1", electiveGroupsRouter);
  app.use("/api/v1", studentsRouter);
  app.use("/api/v1", enrollmentsRouter);
  app.use("/api/v1", offeringsRouter);

  // Test-only middleware probes. Never mounted outside test.
  if (process.env.NODE_ENV === "test") {
    app.get("/__test/protected", requireAuth(), (_req, res) => {
      res.json({ ok: true, membershipId: _req.actor!.membershipId });
    });
    app.get(
      "/__test/pending-ok",
      requireAuth({ allowMustChangePassword: true }),
      (_req, res) => res.json({ ok: true }),
    );
    app.get("/__test/scope", requireAuth(), (req, res) => {
      res.json({ scope: req.actor!.scope ?? null });
    });
    app.get(
      "/__test/permission",
      requireAuth(),
      requirePermission("users:create"),
      (_req, res) => res.json({ ok: true }),
    );
  }

  if (isDocsEnabled()) {
    // Swagger UI ships inline bootstrapping scripts. Relax CSP for /docs only;
    // every other route keeps helmet's defaults.
    app.use(
      "/docs",
      helmet({
        contentSecurityPolicy: {
          directives: {
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            fontSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            // Local docs are served over http; do not force an upgrade.
            upgradeInsecureRequests: null,
          },
        },
      }),
    );
    app.use(createDocsRouter());
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default buildApp;
