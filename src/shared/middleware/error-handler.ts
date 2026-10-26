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
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid Request Data",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
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
