import * as httpStatusText from "./httpStatusText.ts";

// An error that knows which HTTP response it should become.
// Throw it (or pass it to next()) anywhere; errorHandler turns it into JSON.
export class AppError extends Error {
  statusCode: number;
  statusText: string;
  data: unknown;

  constructor(message: string, statusCode: number, data: unknown = null) {
    super(message);
    this.statusCode = statusCode;
    this.statusText =
      statusCode < 500 ? httpStatusText.FAIL : httpStatusText.ERROR;
    this.data = data;
  }
}

// MongoDB's "duplicate key" error (a unique index said no)
export const isDuplicateKeyError = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;
