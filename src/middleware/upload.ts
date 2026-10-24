import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Request } from "express";
import multer from "multer";
import { AppError } from "../utils/appError.ts";

export const DEFAULT_AVATAR = "uploads/default-avatar.svg";

// Paths are stored relative to the project root (e.g. "uploads/avatars/x.png"),
// so this works no matter which folder the app is started from
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const fromRoot = (relativePath: string) => path.join(ROOT, relativePath);

type UploadField = "avatar" | "document";

interface FileRule {
  folder: string;
  mimeTypes: Record<string, string>; // accepted type -> extension it is saved with
  error: string;
}

// Which form field takes which files, and where they are saved
const fileRules: Record<UploadField, FileRule> = {
  avatar: {
    folder: "uploads/avatars",
    mimeTypes: { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" },
    error: "Avatar must be a JPG, PNG or WEBP image",
  },
  document: {
    folder: "uploads/documents",
    mimeTypes: { "application/pdf": ".pdf" },
    error: "Document must be a PDF file",
  },
};

const isUploadField = (name: string): name is UploadField => Object.hasOwn(fileRules, name);

const storage = multer.diskStorage({
  // fileFilter (below) runs first and rejects unknown fields, so the rule exists
  destination: (req, file, cb) => cb(null, fromRoot(fileRules[file.fieldname as UploadField].folder)),
  // Random name so two uploads called "photo.jpg" don't overwrite each other.
  // The extension comes from the accepted type, never from the uploaded name:
  // "evil.html" sent as image/png must not be served back as a web page.
  filename: (req, file, cb) => {
    const ext = fileRules[file.fieldname as UploadField].mimeTypes[file.mimetype];
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const fileFilter: multer.Options["fileFilter"] = (req, file, cb) => {
  if (!isUploadField(file.fieldname)) {
    return cb(new AppError(`Unexpected file field: ${file.fieldname}`, 400));
  }
  const rule = fileRules[file.fieldname];
  if (!Object.hasOwn(rule.mimeTypes, file.mimetype)) {
    return cb(new AppError(rule.error, 400));
  }
  cb(null, true);
};

// Usage in a route: router.post("/", uploadUserFiles, ...)
// Reads a multipart/form-data body: text fields go to req.body,
// files to req.files.avatar[0] and req.files.document[0].
export const uploadUserFiles = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per file
}).fields([
  { name: "avatar", maxCount: 1 },
  { name: "document", maxCount: 1 },
]);

// The saved paths of the uploaded files, ready to store on the user
export const getUploadedPaths = (req: Request): Partial<Record<UploadField, string>> => {
  const paths: Partial<Record<UploadField, string>> = {};
  const files = req.files;
  if (!files || Array.isArray(files)) return paths;
  for (const field of Object.keys(fileRules) as UploadField[]) {
    const file = files[field]?.[0];
    if (file) {
      paths[field] = `${fileRules[field].folder}/${file.filename}`;
    }
  }
  return paths;
};

// Deletes a file we saved earlier; never the default avatar
export const removeFile = (filePath: string | null | undefined) => {
  if (filePath && filePath !== DEFAULT_AVATAR) {
    fs.rm(fromRoot(filePath), { force: true }, () => {});
  }
};

// If the request fails (bad input, duplicate email...), the files multer
// already saved are useless, so errorHandler calls this to delete them
export const removeUploadedFiles = (req: Request) => {
  Object.values(getUploadedPaths(req)).forEach(removeFile);
};
