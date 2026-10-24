import type { TokenPayload } from "../utils/generateToken.ts";

// verifyToken sets req.user from the access token's payload
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export {};
