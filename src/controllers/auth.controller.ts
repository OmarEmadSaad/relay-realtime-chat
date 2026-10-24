import { User } from "../models/user.model.ts";
import type { UserDocument } from "../models/user.model.ts";
import * as httpStatusText from "../utils/httpStatusText.ts";
import { AppError } from "../utils/appError.ts";
import { asyncWrapper } from "../middleware/asyncWrapper.ts";
import { getUploadedPaths } from "../middleware/upload.ts";
import { authUser } from "../middleware/verifyToken.ts";
import { disconnectUser } from "../sockets/emitter.ts";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../utils/generateToken.ts";

// Creates a new token pair and saves the refresh token on the user,
// so only the latest one works (an old or stolen one is rejected).
const issueTokens = async (user: UserDocument) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await User.updateOne({ _id: user._id }, { refreshToken });
  return { accessToken, refreshToken };
};

export const register = asyncWrapper(async (req, res) => {
  const { firstName, lastName, email, phoneNumber, password } = req.body;

  // role isn't taken from the body: everyone signs up as "user".
  // The password is hashed by the model's pre("save") hook
  const user = await User.create({
    firstName,
    lastName,
    email,
    phoneNumber,
    password,
    ...getUploadedPaths(req), // avatar / document, if they were uploaded
  });
  user.password = undefined; // never send the password back

  const tokens = await issueTokens(user);
  res
    .status(201)
    .json({ status: httpStatusText.SUCCESS, data: { user, ...tokens } });
});

export const login = asyncWrapper(async (req, res) => {
  const { email, password } = req.body;

  // password has select: false, so ask for it explicitly
  const user = await User.findOne({ email }).select("+password");

  // Same message for both cases, so attackers can't tell which emails exist
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError("Invalid email or password", 401);
  }
  user.password = undefined;

  const tokens = await issueTokens(user);
  res.json({ status: httpStatusText.SUCCESS, data: { user, ...tokens } });
});

// Call this when the access token expires: send { refreshToken },
// get back a new accessToken and a new refreshToken.
export const refresh = asyncWrapper(async (req, res) => {
  const { refreshToken } = req.body;
  const invalid = () => new AppError("Invalid or expired refresh token", 401);

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw invalid();
  }

  const user = await User.findById(payload.id).select("+refreshToken");
  if (!user || user.refreshToken !== refreshToken) {
    throw invalid();
  }

  const tokens = await issueTokens(user);
  res.json({ status: httpStatusText.SUCCESS, data: tokens });
});

// Deletes the saved refresh token, so it can't be used again, and closes the
// user's live sockets (a session can't be refreshed after this anyway)
export const logout = asyncWrapper(async (req, res) => {
  const { id } = authUser(req);
  await User.updateOne({ _id: id }, { $unset: { refreshToken: 1 } });
  disconnectUser(id, "logout");
  res.json({ status: httpStatusText.SUCCESS, data: null });
});
