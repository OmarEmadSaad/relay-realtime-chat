import type http from "node:http";
import { Server } from "socket.io";
import { socketCorsOrigin } from "../config/cors.ts";
import { authenticate } from "./middleware.ts";
import { setIO } from "./emitter.ts";
import type { AppServer } from "./types.ts";
import { registerConnectionHandlers } from "./handlers/connection.handler.ts";
import { registerConversationHandlers } from "./handlers/conversation.handler.ts";
import { registerMessageHandlers } from "./handlers/message.handler.ts";
import { registerTypingHandlers } from "./handlers/typing.handler.ts";

// Attaches Socket.IO to the HTTP server that Express already uses.
// Event reference: docs/SOCKET_EVENTS.md, types: shared/types.d.ts
export const initSocket = (httpServer: http.Server): AppServer => {
  const io: AppServer = new Server(httpServer, {
    cors: { origin: socketCorsOrigin },
    // Largest event payload accepted; a 2000-character message is ~8 KB
    maxHttpBufferSize: 32 * 1024,
  });

  io.use(authenticate);

  io.on("connection", (socket) => {
    registerConnectionHandlers(io, socket);
    registerConversationHandlers(io, socket);
    registerMessageHandlers(io, socket);
    registerTypingHandlers(io, socket);
  });

  setIO(io);
  return io;
};
