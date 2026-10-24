import { Router } from "express";

import {
  register,
  login,
  refresh,
  logout,
} from "../controllers/auth.controller.ts";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
} from "../validators/auth.schema.ts";
import { validationSchema } from "../middleware/validationSchema.ts";
import { methodNotAllowed } from "../middleware/errorHandler.ts";
import { verifyToken } from "../middleware/verifyToken.ts";
import { uploadUserFiles } from "../middleware/upload.ts";
import { rateLimit } from "../middleware/rateLimit.ts";

const router = Router();

// Per IP: slows down password guessing and mass sign-ups
const authLimit = rateLimit({
  windowMs: 15 * 60_000,
  max: () => Number(process.env.AUTH_RATE_LIMIT_MAX) || 30,
  name: "login attempts",
});

router
  .route("/register")
  .post(authLimit, uploadUserFiles, validationSchema(registerSchema), register)
  .all(methodNotAllowed(["POST"]));

router
  .route("/login")
  .post(authLimit, validationSchema(loginSchema), login)
  .all(methodNotAllowed(["POST"]));

router
  .route("/refresh")
  .post(validationSchema(refreshSchema), refresh)
  .all(methodNotAllowed(["POST"]));

router
  .route("/logout")
  .post(verifyToken, logout)
  .all(methodNotAllowed(["POST"]));

export default router;
