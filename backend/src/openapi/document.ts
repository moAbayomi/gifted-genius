// src/openapi/document.ts
//
// Builds the OpenAPI 3.1 document from the single registry. Importing the
// module `openapi.ts` files registers their paths; this module is the only
// place that needs to know they exist.
import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { registry, tags } from "./registry.js";
import { API_PREFIX } from "../config.js";

// Side-effect imports: each registers its paths/components exactly once.
import "../modules/auth/openapi.js";
import "../modules/users/openapi.js";
import "../modules/roles/openapi.js";
import "../modules/audit/openapi.js";
import "../modules/academics/calendar/openapi.js";
import "../modules/academics/academic-sessions/openapi.js";
import "../modules/academics/classes/openapi.js";
import "../modules/academics/levels/openapi.js";
import "../modules/academics/assignments/openapi.js";
import "../modules/academics/subjects/openapi.js";
import "../modules/academics/elective-groups/openapi.js";
import "../modules/academics/offerings/openapi.js";
import "../modules/students/openapi.js";
import "../modules/academics/enrollment/openapi.js";
import "../modules/academics/promotion/openapi.js";
import "../modules/academics/student-import/openapi.js";
import "./health.js";

const description = [
  "Multi-tenant school portal API.",
  "",
  "**Authentication.** Log in with `POST /auth/login`; the response sets an httpOnly `session` cookie.",
  "Swagger UI cannot set cookies with the Authorize button, but when `/docs` is served from this API origin,",
  "calling `POST /auth/login` with Try it out sets the cookie and later calls carry it.",
  "",
  "**Authorization.** Every school-scoped endpoint takes its school from the session, never from the request.",
  "Route guards check a permission; service guards additionally require a strictly higher role rank than the",
  "target. Granting a role requires the role to be ranked below you **and** to grant only permissions you hold.",
  "Each operation's description states its permission and rank rule.",
  "",
  "**Errors.** Every failure uses `{ error: { code, message, details? } }`. Cross-school IDs return the same",
  "`404` as nonexistent ones. `401` is used both for a missing session and for failed login; the body never",
  "distinguishes an unknown email from a wrong password.",
  "",
  "**Pagination.** List endpoints return `{ data, pagination: { limit, offset, total, hasMore, nextCursor } }`.",
  "The audit log uses `pagination.nextCursor` for opaque cursor paging.",
].join("\n");

let cached: OpenApiDocument | undefined;

type OpenApiDocument = ReturnType<OpenApiGeneratorV31["generateDocument"]>;

/** Build (and memoize) the document. Deterministic for a given code state. */
export function buildOpenApiDocument(): OpenApiDocument {
  if (cached) return cached;

  const generator = new OpenApiGeneratorV31(registry.definitions);
  cached = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Gifted Mind School Portal API",
      version: "1.0.0",
      description,
    },
    tags,
    servers: [
      { url: API_PREFIX, description: "GiftedMind API" },
    ],
  });

  return cached;
}

/** Test helper: allow a fresh build if the registry ever changes at runtime. */
export function resetOpenApiDocumentCache(): void {
  cached = undefined;
}
