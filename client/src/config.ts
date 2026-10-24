import type { Role } from "../../shared/types.d.ts";

// Where the API and Socket.IO server live.
// "" = the same origin that served this page (the default: Express serves the
// client). If you host the client somewhere else (e.g. a static host), set the
// server's URL here, e.g. "https://relay-api.onrender.com", and add the
// client's origin to CORS_ORIGINS on the server.
export const SERVER_URL = "";

// Public demo accounts shown on the login screen (created by `npm run seed`,
// documented in docs/DEMO_CREDENTIALS.md). Set to [] to hide the list.
export const DEMO_PASSWORD = "DemoChat2026!";
export const DEMO_ACCOUNTS: { email: string; name: string; role: Role }[] = [
  { email: "lina@demo.example.com", name: "Lina Haddad", role: "user" },
  { email: "marcus@demo.example.com", name: "Marcus Reed", role: "user" },
  { email: "aisha@demo.example.com", name: "Aisha Khan", role: "user" },
  { email: "sofia@demo.example.com", name: "Sofia Rossi", role: "admin" },
];

export const MAX_MESSAGE_LENGTH = 2000;
