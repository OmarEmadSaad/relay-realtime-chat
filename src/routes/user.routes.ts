import { Router } from "express";

import {
  getMe,
  getContacts,
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
} from "../controllers/user.controller.ts";

import {
  userIdSchema,
  createUserSchema,
  updateUserSchema,
} from "../validators/user.schema.ts";

import { validationSchema } from "../middleware/validationSchema.ts";
import { methodNotAllowed } from "../middleware/errorHandler.ts";
import { verifyToken } from "../middleware/verifyToken.ts";
import { allowedTo } from "../middleware/allowedTo.ts";
import { denyDemo } from "../middleware/denyDemo.ts";
import { ADMIN, MANAGER } from "../utils/userRoles.ts";
import { uploadUserFiles } from "../middleware/upload.ts";

const router = Router();

// Every /api/users route needs a valid token (get one from /api/auth/login).
// Any logged-in user can read their own profile and the public contact list.
// The full user records (email, phone, documents) and every change are for
// admins and managers only, and never for the public demo accounts.
// PUT and PATCH both accept any subset of fields, e.g. just { "role": "admin" }.
router.use(verifyToken);

router.route("/me").get(getMe).all(methodNotAllowed(["GET"]));
router.route("/contacts").get(getContacts).all(methodNotAllowed(["GET"]));

const adminOnly = [allowedTo(ADMIN, MANAGER), denyDemo];

router
  .route("/")
  .get(adminOnly, getUsers)
  .post(
    adminOnly,
    uploadUserFiles,
    validationSchema(createUserSchema),
    createUser,
  )
  .all(methodNotAllowed(["GET", "POST"]));

router
  .route("/:id")
  .get(adminOnly, validationSchema(userIdSchema), getUserById)
  .put(
    adminOnly,
    uploadUserFiles,
    validationSchema({ ...userIdSchema, ...updateUserSchema }),
    updateUser,
  )
  .patch(
    adminOnly,
    uploadUserFiles,
    validationSchema({ ...userIdSchema, ...updateUserSchema }),
    updateUser,
  )
  .delete(adminOnly, validationSchema(userIdSchema), deleteUser)
  .all(methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]));

export default router;
