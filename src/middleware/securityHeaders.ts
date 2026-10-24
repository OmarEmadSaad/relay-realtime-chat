import type { RequestHandler } from "express";

// Basic hardening headers for every response.
// The Content-Security-Policy only allows scripts, styles and connections
// from this server, so even if some text slipped into the page as HTML it
// could not load or run outside code (the access token lives in localStorage).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.set({
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
  });
  next();
};
