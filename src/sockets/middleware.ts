import jwt from "jsonwebtoken";
import type { AuthErrorCode } from "../../shared/types.d.ts";
import { User } from "../models/user.model.ts";
import { verifyAccessToken } from "../utils/generateToken.ts";
import type { AppSocket } from "./types.ts";

const authError = (message: string, code: AuthErrorCode) => Object.assign(new Error(message), { data: { code } });

// The browser client sends io(url, { auth: { token } }). Tools that can't
// (e.g. Postman's Socket.IO client) may send an "Authorization: Bearer <token>"
// header instead. The query string is never accepted: it ends up in logs.
const tokenFrom = (handshake: AppSocket["handshake"]): unknown => {
  if (handshake.auth?.token !== undefined) return handshake.auth.token;
  const [scheme, token] = (handshake.headers.authorization ?? "").split(" ");
  return scheme === "Bearer" ? token : undefined;
};

// io.use(authenticate): runs once per connection, before "connection".
export const authenticate = async (socket: AppSocket, next: (err?: Error) => void) => {
  const token = tokenFrom(socket.handshake);
  if (typeof token !== "string" || !token) {
    return next(authError("Token is required", "TOKEN_REQUIRED"));
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    return err instanceof jwt.TokenExpiredError
      ? next(authError("Token expired", "TOKEN_EXPIRED"))
      : next(authError("Invalid token", "TOKEN_INVALID"));
  }

  try {
    // The account may have been deleted since the token was issued
    const user = await User.findById(payload.id).select("firstName lastName role isDemo");
    if (!user) {
      return next(authError("Invalid token", "TOKEN_INVALID"));
    }
    // From here on, handlers use socket.data.user and never trust ids in payloads
    socket.data.user = {
      id: String(user._id),
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isDemo: user.isDemo,
    };
    socket.data.tokenExpiresAt = payload.exp * 1000;
    next();
  } catch (err) {
    console.error("Socket authentication failed:", err instanceof Error ? err.message : err);
    next(new Error("Server error"));
  }
};
