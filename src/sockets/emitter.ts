import type { Types } from "mongoose";
import type { ServerToClientEvents } from "../../shared/types.d.ts";
import type { AppServer } from "./types.ts";

// Lets REST controllers and services push real-time events without importing
// the Socket.IO server directly. Until initSocket() runs (e.g. a script, or a
// test of the REST API alone) every function here is a no-op.
let io: AppServer | null = null;

export const setIO = (server: AppServer) => {
  io = server;
};

type UserId = string | Types.ObjectId;

// Every connected socket joins its user's room, so emitting to user rooms
// reaches all of a user's tabs and devices. Socket.IO sends each socket the
// event once, even if it is in several of the rooms.
export const userRoom = (userId: UserId) => `user:${userId}`;

// Sockets join a conversation room while that conversation is open on screen
// (conversation:join); typing indicators are sent there.
export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;

export const emitToUsers = <E extends keyof ServerToClientEvents>(
  userIds: UserId[],
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) => {
  if (!io || !userIds.length) return;
  io.to(userIds.map(userRoom)).emit(event, ...args);
};

// e.g. after leaving a group: stop that user's sockets receiving its typing events
export const removeUserFromRoom = (userId: UserId, room: string) => {
  io?.in(userRoom(userId)).socketsLeave(room);
};

// Logout or account deletion: end every live connection of that user
export const disconnectUser = (userId: UserId, reason: string) => {
  if (!io) return;
  const room = userRoom(userId);
  io.to(room).emit("session:ended", { reason });
  io.in(room).disconnectSockets(true);
};
