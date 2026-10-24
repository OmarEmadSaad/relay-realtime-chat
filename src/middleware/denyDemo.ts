import type { RequestHandler } from "express";
import { AppError } from "../utils/appError.ts";

// Use after verifyToken. The demo accounts' passwords are public, so they may
// chat but never administer users (even the demo "admin").
export const denyDemo: RequestHandler = (req, res, next) => {
  if (!req.user || req.user.isDemo) {
    return next(new AppError("Demo accounts can't use administration endpoints", 403));
  }
  next();
};
