import type { Schema } from "express-validator";

// Validation schemas for the auth routes (express-validator's checkSchema)

export { createUserSchema as registerSchema } from "./user.schema.ts";

export const loginSchema: Schema = {
  email: {
    in: ["body"],
    trim: true,
    isEmail: { errorMessage: "Valid email is required" },
    normalizeEmail: true,
  },
  password: {
    in: ["body"],
    notEmpty: { errorMessage: "Password is required" },
  },
};

export const refreshSchema: Schema = {
  refreshToken: {
    in: ["body"],
    isString: { errorMessage: "refreshToken is required" },
    notEmpty: { errorMessage: "refreshToken is required" },
  },
};
