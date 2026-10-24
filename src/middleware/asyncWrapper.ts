import type { NextFunction, Request, RequestHandler, Response } from "express";

// Wraps an async route handler so a rejected promise (a thrown error or a
// failed await) is passed to next(), which sends it to errorHandler.
// Express 5 already does this by itself; the wrapper keeps it explicit and
// makes the handlers work the same way on Express 4.
export const asyncWrapper =
  (asyncFn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(asyncFn(req, res, next)).catch(next);
  };
