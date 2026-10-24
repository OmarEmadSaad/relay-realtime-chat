import { findForMember } from "../../services/conversation.service.ts";
import { conversationRoom } from "../emitter.ts";
import { handle } from "../handle.ts";
import type { AppServer, AppSocket } from "../types.ts";
import { stopTyping } from "./typing.handler.ts";

// conversation:join / conversation:leave - which conversation this socket has
// open on screen. Joining its room is what lets the socket send and receive
// typing indicators there. Messages don't depend on it: they are delivered to
// every member's personal room, so the sidebar updates for closed chats too.
export const registerConversationHandlers = (io: AppServer, socket: AppSocket) => {
  const { id: userId } = socket.data.user;

  const leaveCurrent = () => {
    const current = socket.data.openConversation;
    if (!current) return;
    stopTyping(socket);
    socket.leave(conversationRoom(current));
    socket.data.openConversation = null;
  };

  // { conversationId } -> ack { ok: true, conversationId }
  socket.on(
    "conversation:join",
    handle<"conversation:join">(socket, async ({ conversationId }) => {
      // The client only sends an id; membership is checked against the DB,
      // so knowing (or guessing) a room id is not enough to join it
      const conversation = await findForMember(conversationId, userId);
      const id = String(conversation._id);
      if (socket.data.openConversation !== id) {
        leaveCurrent();
        socket.join(conversationRoom(id));
        socket.data.openConversation = id;
      }
      return { conversationId: id };
    }),
  );

  // {} -> ack { ok: true }
  socket.on(
    "conversation:leave",
    handle<"conversation:leave">(socket, async () => {
      leaveCurrent();
      return {};
    }),
  );
};
