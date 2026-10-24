import type { RequestHandler } from "express";
import { AppError } from "../utils/appError.ts";
import { createRateLimiter } from "../utils/rateLimiter.ts";
import type { RateLimiterOptions } from "../utils/rateLimiter.ts";

// Usage in a route: router.post("/login", rateLimit({ windowMs: 60_000, max: 10 }), ...)
// Keyed by the logged-in user when there is one (req.user), otherwise by IP.
// Behind a proxy, set TRUST_PROXY so req.ip is the real client address.
export const rateLimit = ({ windowMs, max, name = "requests" }: RateLimiterOptions & { name?: string }): RequestHandler => {
  const limiter = createRateLimiter({ windowMs, max });

  return (req, res, next) => {
    const key = req.user?.id ?? req.ip ?? "unknown";
    if (!limiter.hit(key)) {
      res.set("Retry-After", String(limiter.retryAfter(key)));
      return next(new AppError(`Too many ${name}, please try again later`, 429));
    }
    next();
  };
};
