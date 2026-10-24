import type { RequestHandler } from "express";
import type { Role } from "../../shared/types.d.ts";
import { AppError } from "../utils/appError.ts";

// Use after verifyToken: router.delete("/:id", allowedTo(ADMIN, MANAGER), ...)
// Lets the request through only if the logged-in user has one of these roles.
export const allowedTo =
  (...roles: Role[]): RequestHandler =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new AppError("You don't have permission to do this action", 403),
      );
    }
    next();
  };
