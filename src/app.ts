import { env, getAllowedOrigins, isDocsEnabled } from "./config/env.js";
import express, { urlencoded } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { type Logger, pino } from "pino";
import { errorHandler, notFound } from "./shared/middleware/error-handler.js";
import {authRouter} from "./modules/auth/routes.js";
import { usersRouter } from "./modules/users/routes.js";
import  {rolesRouter}  from "./modules/roles/routes.js";
import {auditRouter} from "./modules/audit/routes.js";
import { createDocsRouter } from "./openapi/router.js";

export function buildApp(opts?: { logger?: Logger }): express.Express {
  const app = express();

  const logger = pino({
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
    app.set("trust proxy", 1); // one proxy in front of Node
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  }); 

  app.use(authRouter);
  app.use(usersRouter);
  app.use(rolesRouter);
  app.use(auditRouter);

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
