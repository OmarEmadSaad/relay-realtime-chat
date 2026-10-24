import { User } from "../../models/user.model.ts";
import { addSocket, removeSocket, onlineUserIds } from "../../services/presence.service.ts";
import { userRoom } from "../emitter.ts";
import type { AppServer, AppSocket } from "../types.ts";

// setTimeout can't wait longer than ~24.8 days
const MAX_TIMEOUT = 2 ** 31 - 1;

// Presence (online/offline) and the session lifetime of one socket
export const registerConnectionHandlers = (io: AppServer, socket: AppSocket) => {
  const { id: userId } = socket.data.user;

  // Personal room: reaches every tab/device of this user (new messages,
  // read receipts, new conversations)
  socket.join(userRoom(userId));

  if (addSocket(userId, socket.id)) {
    socket.broadcast.emit("presence:update", { userId, online: true, lastSeenAt: null });
  }
  // The full list for this socket, so a (re)connecting client starts correct
  socket.emit("presence:snapshot", { onlineUserIds: onlineUserIds() });

  // The connection was authenticated with an access token that expires (10 min
  // by default). When it does, tell the client and disconnect; the client
  // refreshes its token and reconnects with the new one.
  const expiresIn = socket.data.tokenExpiresAt - Date.now();
  const expiryTimer = setTimeout(() => {
    socket.emit("auth:expired");
    socket.disconnect(true);
  }, Math.min(Math.max(expiresIn, 0), MAX_TIMEOUT));

  socket.on("disconnect", async () => {
    clearTimeout(expiryTimer);

    // Offline only when the user's last tab/device disconnects
    if (removeSocket(userId, socket.id)) {
      const lastSeenAt = new Date();
      io.emit("presence:update", { userId, online: false, lastSeenAt });
      try {
        await User.updateOne({ _id: userId }, { lastSeenAt });
      } catch (err) {
        console.error("Could not save lastSeenAt:", err instanceof Error ? err.message : err);
      }
    }
  });
};
