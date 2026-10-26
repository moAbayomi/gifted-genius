// src/openapi/router.ts
//
// Serves the generated spec and Swagger UI. Mounted only when DOCS_ENABLED
// resolves true (see app.ts and src/config/env.ts).
import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiDocument } from "./document.js";

export function createDocsRouter(): Router {
  const router = Router();
  const document = buildOpenApiDocument();

  router.get("/openapi.json", (_req, res) => {
    res.json(document);
  });

  router.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: "Gifted Mind API",
      swaggerOptions: {
        // Same-origin cookies are sent with Try it out calls. Log in once
        // via POST /auth/login in this UI, then authenticated calls work.
        withCredentials: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        tryItOutEnabled: true,
      },
    }),
  );

  return router;
}
