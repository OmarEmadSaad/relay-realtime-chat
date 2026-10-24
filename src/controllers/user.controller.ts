import type { Request } from "express";
import { User, PUBLIC_USER_FIELDS, toPublicUser } from "../models/user.model.ts";
import type { IUser } from "../models/user.model.ts";
import * as httpStatusText from "../utils/httpStatusText.ts";
import { AppError } from "../utils/appError.ts";
import { asyncWrapper } from "../middleware/asyncWrapper.ts";
import { authUser } from "../middleware/verifyToken.ts";
import { MANAGER } from "../utils/userRoles.ts";
import { getUploadedPaths, removeFile } from "../middleware/upload.ts";
import { isOnline } from "../services/presence.service.ts";
import { disconnectUser } from "../sockets/emitter.ts";

// The routes validate req.params.id and req.body (validationSchema) before
// these run, and asyncWrapper sends any thrown error to errorHandler.

const userNotFound = () => new AppError("User not found", 404);

const updateOptions = { returnDocument: "after", runValidators: true } as const;

const userFields = ["firstName", "lastName", "email", "phoneNumber", "password"] as const;

// Copy only the allowed fields that were actually sent.
// Only a manager may set someone's role; for anyone else it's ignored.
const pickUserFields = (req: Request): Partial<IUser> => {
  const fields: Partial<IUser> = {};
  for (const key of userFields) {
    if (req.body[key] !== undefined) {
      fields[key] = req.body[key];
    }
  }
  if (req.body.role !== undefined && authUser(req).role === MANAGER) {
    fields.role = req.body.role;
  }
  return { ...fields, ...getUploadedPaths(req) };
};

// The logged-in user's own profile (from the token's id)
export const getMe = asyncWrapper(async (req, res) => {
  const user = await User.findById(authUser(req).id);
  if (!user) {
    throw userNotFound();
  }
  res.json({ status: httpStatusText.SUCCESS, data: { user } });
});

// Everyone you can start a chat with: public fields only (no email/phone)
export const getContacts = asyncWrapper(async (req, res) => {
  const users = await User.find({ _id: { $ne: authUser(req).id } })
    .select(PUBLIC_USER_FIELDS)
    .sort({ firstName: 1, lastName: 1 })
    .limit(500);
  const contacts = users.map((user) => ({ ...toPublicUser(user), online: isOnline(user._id) }));
  res.json({ status: httpStatusText.SUCCESS, data: { users: contacts } });
});

export const getUsers = asyncWrapper(async (req, res) => {
  const users = await User.find();
  res.json({ status: httpStatusText.SUCCESS, data: { users } });
});

export const getUserById = asyncWrapper(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    throw userNotFound();
  }
  res.json({ status: httpStatusText.SUCCESS, data: { user } });
});

export const createUser = asyncWrapper(async (req, res) => {
  const user = await User.create(pickUserFields(req));
  user.password = undefined; // never send the password back

  res.status(201).json({ status: httpStatusText.SUCCESS, data: { user } });
});

// PUT and PATCH both use this: only the fields that were sent are changed
export const updateUser = asyncWrapper(async (req, res) => {
  const changes = pickUserFields(req);
  const oldUser = await User.findById(req.params.id);
  if (!oldUser) {
    throw userNotFound();
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    changes,
    updateOptions,
  );

  // A new avatar/document replaced the old one, so delete the old file
  if (changes.avatar) removeFile(oldUser.avatar);
  if (changes.document) removeFile(oldUser.document);

  res.json({ status: httpStatusText.SUCCESS, data: { user } });
});

export const deleteUser = asyncWrapper(async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);

  if (!user) {
    throw userNotFound();
  }
  removeFile(user.avatar);
  removeFile(user.document);
  disconnectUser(user._id, "account deleted");

  res.json({ status: httpStatusText.SUCCESS, data: null });
});
