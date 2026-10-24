import http from "node:http";
import mongoose from "mongoose";
import { loadEnv, assertEnv } from "./config/env.ts";
import { connectDB } from "./config/db.ts";
import { createApp } from "./app.ts";
import { initSocket } from "./sockets/index.ts";

loadEnv();
assertEnv();

try {
  await connectDB();
} catch (err) {
  console.error("Failed to connect to MongoDB:", err instanceof Error ? err.message : err);
  process.exit(1);
}

// Express and Socket.IO share one HTTP server (and so one port)
const server = http.createServer(createApp());
const io = initSocket(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Ctrl+C / platform shutdown: close sockets and the DB connection cleanly
const shutdown = async (signal: NodeJS.Signals) => {
  console.log(`${signal} received, shutting down`);
  io.close();
  await mongoose.disconnect();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
