import type { ParamSchema, Schema } from "express-validator";
import { ALL_ROLES } from "../utils/userRoles.ts";

// Validation schemas for express-validator's checkSchema.
// Each key is a field; "in" says where to read it from; rules run in order.

export const userIdSchema: Schema = {
  id: {
    in: ["params"],
    isMongoId: {
      errorMessage: (value: unknown) => `Invalid user id: ${value}`,
    },
  },
};

const nameRules = (label: string): ParamSchema => ({
  in: ["body"],
  trim: true,
  isLength: {
    options: { min: 2, max: 50 },
    errorMessage: `${label} must be 2-50 characters`,
  },
});

const emailRules: ParamSchema = {
  in: ["body"],
  trim: true,
  isEmail: { errorMessage: "Valid email is required" },
  normalizeEmail: true,
};

const phoneRules: ParamSchema = {
  in: ["body"],
  trim: true,
  isMobilePhone: {
    options: ["any"],
    errorMessage: "Please enter a valid phone number",
  },
};

const roleRules: ParamSchema = {
  in: ["body"],
  optional: true,
  isIn: {
    options: [ALL_ROLES],
    errorMessage: `Role must be one of: ${ALL_ROLES.join(", ")}`,
  },
};

const passwordRules: ParamSchema = {
  in: ["body"],
  isLength: {
    options: { min: 8 },
    errorMessage: "Password must be at least 8 characters",
  },
};

export const createUserSchema: Schema = {
  firstName: {
    notEmpty: { errorMessage: "First name is required" },
    ...nameRules("First name"),
  },
  lastName: {
    notEmpty: { errorMessage: "Last name is required" },
    ...nameRules("Last name"),
  },
  email: emailRules,
  phoneNumber: {
    notEmpty: { errorMessage: "Phone number is required" },
    ...phoneRules,
  },
  password: {
    notEmpty: { errorMessage: "Password is required" },
    ...passwordRules,
  },
  role: roleRules,
};

// PUT/PATCH: every field is optional, but if it's sent it must be valid
export const updateUserSchema: Schema = {
  firstName: { optional: true, ...nameRules("First name") },
  lastName: { optional: true, ...nameRules("Last name") },
  email: { optional: true, ...emailRules },
  phoneNumber: { optional: true, ...phoneRules },
  password: { optional: true, ...passwordRules },
  role: roleRules,
};
