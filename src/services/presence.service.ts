import type { Types } from "mongoose";

// Who is online right now: userId -> Set of their connected socket ids.
// A user with two tabs (or a phone and a laptop) has two sockets, and only
// goes offline when the last one disconnects.
// In-memory, so it is per server process (see README "Known limitations").
const socketsByUser = new Map<string, Set<string>>();

// Returns true if this was the user's first socket (they just came online)
export const addSocket = (userId: string, socketId: string) => {
  let sockets = socketsByUser.get(userId);
  if (!sockets) {
    sockets = new Set();
    socketsByUser.set(userId, sockets);
  }
  sockets.add(socketId);
  return sockets.size === 1;
};

// Returns true if this was the user's last socket (they just went offline)
export const removeSocket = (userId: string, socketId: string) => {
  const sockets = socketsByUser.get(userId);
  if (!sockets?.delete(socketId)) return false;
  if (sockets.size) return false;
  socketsByUser.delete(userId);
  return true;
};

export const isOnline = (userId: string | Types.ObjectId) => socketsByUser.has(String(userId));

export const onlineUserIds = () => [...socketsByUser.keys()];

// For tests
export const resetPresence = () => socketsByUser.clear();
