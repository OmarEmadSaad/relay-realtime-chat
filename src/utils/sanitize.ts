import mongoose from "mongoose";
import { AppError } from "./appError.ts";

// Control characters except tab (\t) and newline (\n)
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

// Message text: must be a string; normalised, control characters removed,
// \r\n turned into \n, at most two blank lines in a row, trimmed.
// The client renders text with textContent, so HTML in it is shown as text.
export const cleanText = (value: unknown, { field = "text", maxLength }: { field?: string; maxLength: number }) => {
  if (typeof value !== "string") {
    throw new AppError(`${field} must be a string`, 400);
  }
  const text = value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (!text) {
    throw new AppError(`${field} cannot be empty`, 400);
  }
  if (text.length > maxLength) {
    throw new AppError(`${field} must be at most ${maxLength} characters`, 400);
  }
  return text;
};

// A MongoDB id from untrusted input (socket payloads, query strings)
export const toObjectId = (value: unknown, field = "id") => {
  if (typeof value !== "string" || value.length !== 24 || !mongoose.isValidObjectId(value)) {
    throw new AppError(`Invalid ${field}`, 400);
  }
  return new mongoose.Types.ObjectId(value);
};

// For user input placed inside a RegExp (message search)
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
