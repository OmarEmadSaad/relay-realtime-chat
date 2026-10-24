import type { Request, RequestHandler } from "express";
import { AppError } from "../utils/appError.ts";
import { verifyAccessToken } from "../utils/generateToken.ts";
import type { TokenPayload } from "../utils/generateToken.ts";

// Protects a route: expects the header "Authorization: Bearer <token>".
// On success the token's payload ({ id, email, role, isDemo }) is available as req.user.
export const verifyToken: RequestHandler = (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || "").split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new AppError("Token is required", 401));
  }

  try {
    const { id, email, role, isDemo } = verifyAccessToken(token);
    req.user = { id, email, role, isDemo: Boolean(isDemo) };
    next();
  } catch {
    next(new AppError("Invalid or expired token", 401));
  }
};

// The logged-in user in a handler behind verifyToken
export const authUser = (req: Request): TokenPayload => {
  if (!req.user) {
    throw new AppError("Token is required", 401);
  }
  return req.user;
};
