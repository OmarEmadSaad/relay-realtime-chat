import { sendMessage } from "../../services/message.service.ts";
import { markRead, memberIds } from "../../services/conversation.service.ts";
import { emitToUsers } from "../emitter.ts";
import { handle } from "../handle.ts";
import type { AppServer, AppSocket } from "../types.ts";
import { stopTyping } from "./typing.handler.ts";

export const registerMessageHandlers = (io: AppServer, socket: AppSocket) => {
  const { id: userId } = socket.data.user;

  // { conversationId, text, clientId } -> ack { ok: true, message, duplicate }
  // The message is saved, then "message:new" goes to every member's personal
  // room (including the sender's other tabs). The sender is always the
  // authenticated user; a "sender" field in the payload is ignored.
  socket.on(
    "message:send",
    handle<"message:send">(
      socket,
      async ({ conversationId, text, clientId }) => {
        const result = await sendMessage({ conversationId, senderId: userId, text, clientId });
        stopTyping(socket);
        return result;
      },
      { errorEvent: "message:error" },
    ),
  );

  // { conversationId } -> ack { ok: true, readAt }
  // Marks everything in the conversation as read; members get "message:read"
  // (the reader's other tabs clear the unread badge, senders see "Seen").
  socket.on(
    "message:read",
    handle<"message:read">(socket, async ({ conversationId }) => {
      const { conversation, readAt } = await markRead(conversationId, userId);
      emitToUsers(memberIds(conversation), "message:read", {
        conversationId: String(conversation._id),
        userId,
        readAt,
      });
      return { readAt };
    }),
  );
};
