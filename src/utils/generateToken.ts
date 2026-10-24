import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import type { Types } from "mongoose";
import type { Role } from "../../shared/types.d.ts";

// What an access token carries; verifyToken exposes it as req.user
export interface TokenPayload {
  id: string;
  email: string;
  role: Role;
  isDemo: boolean;
}

interface TokenUser {
  _id: Types.ObjectId;
  email: string;
  role: Role;
  isDemo?: boolean;
}

type ExpiresIn = SignOptions["expiresIn"];

// Access token: sent with every request (Authorization: Bearer ...), short-lived.
// verifyToken (and the Socket.IO handshake) reads its payload back as req.user.
export const generateAccessToken = (user: TokenUser) =>
  jwt.sign(
    { id: String(user._id), email: user.email, role: user.role, isDemo: Boolean(user.isDemo) } satisfies TokenPayload,
    process.env.JWT_SECRET!,
    { expiresIn: (process.env.JWT_EXPIRES_IN || "10m") as ExpiresIn },
  );

// Refresh token: only sent to POST /api/auth/refresh to get a new access token.
// Signed with a different secret, so it can't be used as an access token.
// The random jti makes every token unique: without it, two tokens issued in
// the same second are identical and rotation couldn't tell old from new.
export const generateRefreshToken = (user: TokenUser) =>
  jwt.sign({ id: String(user._id), jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || "7d") as ExpiresIn,
  });

// jwt.verify returns string | JwtPayload; these narrow it to what we signed
export const verifyAccessToken = (token: string): TokenPayload & { exp: number } => {
  const payload = jwt.verify(token, process.env.JWT_SECRET!);
  if (typeof payload === "string" || typeof payload.id !== "string" || typeof payload.exp !== "number") {
    throw new jwt.JsonWebTokenError("Unexpected token payload");
  }
  return payload as TokenPayload & { exp: number };
};

export const verifyRefreshToken = (token: string): { id: string } => {
  const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!);
  if (typeof payload === "string" || typeof payload.id !== "string") {
    throw new jwt.JsonWebTokenError("Unexpected token payload");
  }
  return { id: payload.id };
};
