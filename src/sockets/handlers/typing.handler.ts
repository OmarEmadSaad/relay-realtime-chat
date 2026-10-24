import { conversationRoom } from "../emitter.ts";
import { createRateLimiter } from "../../utils/rateLimiter.ts";
import type { AppServer, AppSocket } from "../types.ts";

// Typing events are frequent and unimportant: over the limit they are dropped
const typingLimiter = createRateLimiter({ windowMs: 10_000, max: 30 });

// Sends typing:stop for wherever this socket was typing (message sent,
// conversation closed, or disconnected)
export const stopTyping = (socket: AppSocket) => {
  const typingIn = socket.data.typingIn;
  if (!typingIn) return;
  socket.data.typingIn = null;
  socket.to(typingIn.room).emit("typing:stop", {
    conversationId: typingIn.conversationId,
    userId: socket.data.user.id,
  });
};

// typing:start / typing:stop { conversationId }, no acknowledgement.
// Only allowed in the conversation this socket joined (conversation:join
// already checked membership), and only sent to the others viewing it.
// Clients also expire a "typing" state after a few seconds without updates.
export const registerTypingHandlers = (io: AppServer, socket: AppSocket) => {
  const { user } = socket.data;

  // The conversation id, if the payload names the conversation this socket has open
  const openConversationIn = (payload: unknown) => {
    const conversationId = (payload as { conversationId?: unknown } | null)?.conversationId;
    if (typeof conversationId !== "string" || socket.data.openConversation !== conversationId) {
      return null;
    }
    // Not in the room any more if the user left the group meanwhile
    return socket.rooms.has(conversationRoom(conversationId)) ? conversationId : null;
  };

  socket.on("typing:start", (payload: unknown) => {
    const conversationId = openConversationIn(payload);
    if (!conversationId || !typingLimiter.hit(user.id)) return;
    const room = conversationRoom(conversationId);
    socket.data.typingIn = { room, conversationId };
    socket.to(room).emit("typing:start", {
      conversationId,
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName },
    });
  });

  socket.on("typing:stop", (payload: unknown) => {
    if (openConversationIn(payload)) stopTyping(socket);
  });

  // Rooms are still known here (unlike in "disconnect"), so the others don't
  // keep seeing "typing..." from a closed tab
  socket.on("disconnecting", () => stopTyping(socket));
};
