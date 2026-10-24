import mongoose from "mongoose";
import type { HydratedDocument, Model, Types, UpdateQuery } from "mongoose";
import validator from "validator";
import bcrypt from "bcryptjs";
import type { PublicUser, Role } from "../../shared/types.d.ts";
import * as userRoles from "../utils/userRoles.ts";
import { DEFAULT_AVATAR } from "../middleware/upload.ts";

export interface IUser {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password?: string; // select: false, so usually absent
  role: Role;
  avatar: string;
  document: string | null;
  refreshToken?: string; // select: false
  isDemo: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface IUserMethods {
  comparePassword(password: string): Promise<boolean>;
}

type UserModel = Model<IUser, object, IUserMethods>;
export type UserDocument = HydratedDocument<IUser, IUserMethods>;

const userSchema = new mongoose.Schema<IUser, UserModel, IUserMethods>(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      minlength: [2, "First name must be at least 2 characters"],
      maxlength: [50, "First name must be at most 50 characters"],
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      minlength: [2, "Last name must be at least 2 characters"],
      maxlength: [50, "Last name must be at most 50 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (value: string) => validator.isEmail(value),
        message: "Please enter a valid email",
      },
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      trim: true,
      validate: {
        validator: (value: string) => validator.isMobilePhone(value, "any"),
        message: "Please enter a valid phone number",
      },
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: userRoles.ALL_ROLES,
        message: "Role must be one of: " + userRoles.ALL_ROLES.join(", "),
      },
      default: userRoles.USER,
    },
    // Paths of uploaded files, served at http://localhost:3000/<path>
    avatar: { type: String, default: DEFAULT_AVATAR },
    document: { type: String, default: null }, // PDF
    // The latest refresh token (see auth.controller.ts); hidden like password
    refreshToken: { type: String, select: false },
    // Public demo account (created by scripts/seedDemo.ts). Demo accounts can
    // chat, but are refused by the user-administration routes (denyDemo).
    // Never set from a request body: controllers only copy whitelisted fields.
    isDemo: { type: Boolean, default: false },
    // When the user's last socket disconnected ("last seen 5 min ago")
    lastSeenAt: { type: Date, default: null },
  },
  { versionKey: false, timestamps: true },
);

const SALT_ROUNDS = 10;

// Hash the password whenever it's created or changed (register, POST /users)
userSchema.pre("save", async function () {
  if (this.isModified("password") && this.password) {
    this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
  }
});

// Same for PUT/PATCH, which use findByIdAndUpdate and skip the save hook
userSchema.pre("findOneAndUpdate", async function () {
  const update = this.getUpdate() as UpdateQuery<IUser> | null;
  if (typeof update?.password === "string") {
    update.password = await bcrypt.hash(update.password, SALT_ROUNDS);
  }
});

userSchema.methods.comparePassword = function (password: string) {
  return bcrypt.compare(password, this.password ?? "");
};

// The fields other chat users may see (no email, phone, document or tokens)
export const PUBLIC_USER_FIELDS = "firstName lastName avatar role lastSeenAt";

export interface PublicUserSource {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  avatar: string;
  role: Role;
  lastSeenAt?: Date | null;
}

export const toPublicUser = (user: PublicUserSource): PublicUser => ({
  id: String(user._id),
  firstName: user.firstName,
  lastName: user.lastName,
  avatar: user.avatar,
  role: user.role,
  lastSeenAt: user.lastSeenAt ?? null,
});

export const User = mongoose.model<IUser, UserModel>("User", userSchema, "users");
