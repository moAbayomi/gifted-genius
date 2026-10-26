// modules/auth/openapi.ts
//
// Path registration for the auth module. Schemas live in ./schema.ts so the
// routes, the docs, and the contract tests all use the same definitions.
import {
  errorResponse,
  jsonResponse,
  okResponseSchema,
  registry,
  sessionSecurity,
} from "../../openapi/registry.js";
import {
  changePasswordSchema,
  loginResponseSchema,
  loginSchema,
  meResponseSchema,
} from "./schema.js";

registry.registerPath({
  method: "post",
  path: "/auth/login",
  tags: ["Auth"],
  summary: "Log in (public)",
  description:
    "Email + password only. On success a `session` cookie is set and the response has `kind: success`. " +
    "If the user has more than one active membership and no `schoolSlug` is supplied, no session is created: " +
    "the response has `kind: select_school` and the client retries with a slug. Every failure returns the same " +
    "`401 INVALID_CREDENTIALS` body, and unknown emails are verified against a dummy hash so response time does " +
    "not reveal whether the account exists.",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: loginSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Session created (`kind: success`) or a school picker (`kind: select_school`, no session).",
      loginResponseSchema,
    ),
    400: errorResponse("Request body failed validation."),
    401: errorResponse("Invalid credentials, inactive user, or no active membership."),
    429: errorResponse("More than 5 failed attempts from this IP in 15 minutes."),
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/logout",
  tags: ["Auth"],
  summary: "Log out (current device)",
  description:
    "Deletes the current session row and clears the cookie. Allowed even when `mustChangePassword` is set. " +
    "Idempotent: no session cookie is not an error from the client's perspective (the route still requires a live session).",
  security: sessionSecurity,
  responses: {
    200: jsonResponse("Session revoked and cookie cleared.", okResponseSchema),
    401: errorResponse("No live session."),
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/change-password",
  tags: ["Auth"],
  summary: "Change your own password",
  description:
    "Requires the **current** password, not just a session — a stolen cookie cannot change the password. " +
    "On success `mustChangePassword` is cleared and every other session of this user is deleted. " +
    "This route is reachable while `mustChangePassword` is set.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: changePasswordSchema } },
    },
  },
  responses: {
    200: jsonResponse("Password changed; other sessions revoked.", okResponseSchema),
    400: errorResponse("Same password, no password set, or validation failure."),
    401: errorResponse("Not authenticated, or the current password is wrong."),
  },
});

registry.registerPath({
  method: "get",
  path: "/me",
  tags: ["Auth"],
  summary: "Current identity, school, roles, and permissions",
  description:
    "Everything the client needs to render the session: the user, the active school, role keys, the effective " +
    "permission set (union of all roles), and whether a password change is required. Allowed while " +
    "`mustChangePassword` is set so the frontend can detect the state.",
  security: sessionSecurity,
  responses: {
    200: jsonResponse("Current actor context.", meResponseSchema),
    401: errorResponse("No live session."),
  },
});
