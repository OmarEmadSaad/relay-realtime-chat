import type { RequestHandler } from "express";
import { checkSchema, validationResult } from "express-validator";
import type { Schema } from "express-validator";
import { AppError } from "../utils/appError.ts";

// Usage in a route: router.post("/", validationSchema(createUserSchema), createUser)
// Runs every rule in the schema, then stops the request with a 400 AppError
// if any failed. If all pass, the request continues to the controller.
export const validationSchema = (schema: Schema): RequestHandler[] => [
  ...checkSchema(schema),
  (req, res, next) => {
    // One error per field, so "name" doesn't report both "required" and "too short"
    const errors = validationResult(req).array({ onlyFirstError: true });

    if (errors.length) {
      const message = errors.map((error) => error.msg).join(", ");
      return next(new AppError(message, 400, errors));
    }

    next();
  },
];
