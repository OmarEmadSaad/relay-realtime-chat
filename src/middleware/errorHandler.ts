import type { ErrorRequestHandler, RequestHandler } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { AppError } from "../utils/appError.ts";
import { removeUploadedFiles } from "./upload.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// Every error response goes through here, so they all share one shape:
// { status, message, code, data }
const toAppError = (err: unknown): AppError => {
  if (err instanceof AppError) {
    return err;
  }
  // e.g. file too large, or too many files in one field
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "File must be at most 5 MB" : err.message;
    return new AppError(message, 400);
  }
  if (isRecord(err) && err.type === "entity.parse.failed") {
    return new AppError("Invalid JSON", 400);
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const errors = Object.values(err.errors).map((error) => ({
      path: error.path,
      msg: error.message,
    }));
    const message = errors.map((error) => error.msg).join(", ");
    return new AppError(message, 400, errors);
  }
  // MongoDB duplicate key, e.g. an email that's already registered
  if (isRecord(err) && err.code === 11000 && isRecord(err.keyValue)) {
    const field = Object.keys(err.keyValue)[0];
    return new AppError(`${field} already exists`, 409);
  }

  console.error(err);
  return new AppError("Internal server error", 500);
};

// No route matches this URL at all
export const notFound: RequestHandler = (req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

// The URL exists, but not with this HTTP method (e.g. POST /api/users/:id)
export const methodNotAllowed =
  (allowedMethods: string[]): RequestHandler =>
  (req, res, next) => {
    res.set("Allow", allowedMethods.join(", "));
    next(
      new AppError(
        `Method ${req.method} not allowed on ${req.originalUrl}. Allowed: ${allowedMethods.join(", ")}`,
        405,
      ),
    );
  };

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const error = toAppError(err);
  removeUploadedFiles(req); // the request failed, so its files aren't needed

  res.status(error.statusCode).json({
    status: error.statusText,
    message: error.message,
    code: error.statusCode,
    data: error.data,
  });
};
