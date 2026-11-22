import type { RequestHandler, ErrorRequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { ZodError } from "zod";

export const notFound: RequestHandler = (_req, res) => {
  return res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Route Not Found",
    },
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // express.json() throws a SyntaxError with type "entity.parse.failed" for
  // malformed JSON (for example a trailing comma). That is a client error,
  // not an internal server error.
  if (
    err instanceof SyntaxError &&
    (err as SyntaxError & { type?: string }).type === "entity.parse.failed"
  ) {
    return res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body is not valid JSON",
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.httpStatus).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_root";
      if (fields[key] === undefined) fields[key] = issue.message;
    }
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid Request Data",
        fields,
      },
    });
  }

  console.error(err);
  req.log?.error({ err }, "unhandled_error");

  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
    },
  });
};
