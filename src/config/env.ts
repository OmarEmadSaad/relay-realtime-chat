import { fileURLToPath } from "node:url";

// Loads <project root>/.env into process.env (variables that are already set
// win). Call it once, before anything reads process.env.
export const loadEnv = () => {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
  } catch {
    // No .env file: rely on environment variables already set
  }
};

const REQUIRED = ["MONGODB_URI", "JWT_SECRET", "JWT_REFRESH_SECRET"];

// Stops the process with a clear message instead of failing later
export const assertEnv = (names: string[] = REQUIRED) => {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")} (see .env.example)`);
    process.exit(1);
  }
};
