// src/openapi/health.ts
//
// The health endpoint lives directly in app.ts, so it has no module folder.
// Register it here next to the other path registrations.
import { jsonResponse, registry, z } from "./registry.js";

const healthResponseSchema = z
  .object({ status: z.literal("ok") })
  .openapi("HealthResponse");

registry.registerPath({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Liveness check (public)",
  description:
    "Returns 200 while the process is accepting requests. It does not query the database; a deploy check that needs readiness should verify a data-backed endpoint after login.",
  responses: {
    200: jsonResponse("Process is up.", healthResponseSchema),
  },
});
