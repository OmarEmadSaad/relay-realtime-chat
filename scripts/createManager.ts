// Creates a manager account (or promotes an existing user to manager).
// Nothing secret is stored in this file; pass the details as arguments:
//
//   npm run create-manager -- --email you@example.com --password "a-strong-password" \
//     --first-name Omar --last-name Emad --phone +201000000000
//
// For an existing user only --email is needed (add --password to reset it).
import mongoose from "mongoose";
import { parseArgs } from "node:util";
import { loadEnv, assertEnv } from "../src/config/env.ts";
import { connectDB } from "../src/config/db.ts";
import { User } from "../src/models/user.model.ts";
import { MANAGER } from "../src/utils/userRoles.ts";

loadEnv();
assertEnv(["MONGODB_URI"]);

const { values: args } = parseArgs({
  options: {
    email: { type: "string" },
    password: { type: "string" },
    "first-name": { type: "string" },
    "last-name": { type: "string" },
    phone: { type: "string" },
  },
});

if (!args.email) {
  console.error("--email is required (see the comment at the top of this file)");
  process.exit(1);
}

try {
  await connectDB();
  let user = await User.findOne({ email: args.email.toLowerCase() });

  if (!user) {
    const required = ["password", "first-name", "last-name", "phone"] as const;
    const missing = required.filter((name) => !args[name]);
    if (missing.length) {
      throw new Error(`New user: also pass ${missing.map((name) => `--${name}`).join(", ")}`);
    }
    user = new User({
      firstName: args["first-name"],
      lastName: args["last-name"],
      email: args.email,
      phoneNumber: args.phone,
    });
  }
  if (args.password) {
    user.password = args.password; // hashed by the pre("save") hook
  }
  user.role = MANAGER;
  await user.save();

  console.log(`${user.firstName} ${user.lastName} <${user.email}> is now a ${user.role}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
