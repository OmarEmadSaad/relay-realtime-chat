import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes.ts";
import userRoutes from "./routes/user.routes.ts";
import conversationRoutes from "./routes/conversation.routes.ts";
import messageRoutes from "./routes/message.routes.ts";
import { corsOptionsDelegate } from "./config/cors.ts";
import { securityHeaders } from "./middleware/securityHeaders.ts";
import { notFound, errorHandler } from "./middleware/errorHandler.ts";

const fromRoot = (relativePath: string) => fileURLToPath(new URL(`../${relativePath}`, import.meta.url));

// Builds the Express app without starting it, so tests can mount it on their
// own HTTP server. src/server.ts adds MongoDB, Socket.IO and listen().
export const createApp = () => {
  const app = express();

  // Behind a reverse proxy (Render, Railway, nginx...), set TRUST_PROXY=1 so
  // req.ip is the client's address and per-IP rate limits work
  if (process.env.TRUST_PROXY) {
    app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  }

  app.use(securityHeaders);
  // Before the routes, so browser preflight (OPTIONS) requests are answered here
  app.use("/api", cors(corsOptionsDelegate));
  app.use(express.json({ limit: "100kb" }));

  // Uploaded files: e.g. http://localhost:3000/uploads/default-avatar.svg
  app.use("/uploads", express.static(fromRoot("uploads")));

  app.get("/api/health", (req, res) => {
    res.json({ status: "success", data: { uptime: process.uptime() } });
  });
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/conversations", conversationRoutes);
  app.use("/api/messages", messageRoutes);

  // The chat UI at http://localhost:3000/ (client/js is compiled from
  // client/src by `npm run build`)
  if (!fs.existsSync(fromRoot("client/js/app.js"))) {
    console.warn("The chat client isn't built yet: run `npm run build`");
  }
  app.use(express.static(fromRoot("client")));

  app.use(notFound);

  app.use(errorHandler);

  return app;
};
