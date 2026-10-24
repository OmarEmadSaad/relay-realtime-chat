import type { Types } from "mongoose";
import type { MessageDTO } from "../../shared/types.d.ts";
import { Conversation } from "../models/conversation.model.ts";
import { Message, MAX_MESSAGE_LENGTH } from "../models/message.model.ts";
import type { IMessage } from "../models/message.model.ts";
import { PUBLIC_USER_FIELDS, toPublicUser } from "../models/user.model.ts";
import type { PublicUserSource } from "../models/user.model.ts";
import { AppError, isDuplicateKeyError } from "../utils/appError.ts";
import { cleanText, escapeRegex, toObjectId } from "../utils/sanitize.ts";
import { findForMember, memberIds } from "./conversation.service.ts";
import { emitToUsers } from "../sockets/emitter.ts";
import { createRateLimiter } from "../utils/rateLimiter.ts";

export const PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

// Per user, across all their tabs and both REST and Socket.IO
const sendLimiter = createRateLimiter({ windowMs: 10_000, max: 15 });

type PopulatedMessage = Omit<IMessage, "sender"> & { _id: Types.ObjectId; sender: PublicUserSource | null };
const populateSender = { path: "sender", select: PUBLIC_USER_FIELDS };

// The JSON shape of a message in every REST response and socket event
export const serializeMessage = (message: PopulatedMessage): MessageDTO => ({
  id: String(message._id),
  conversationId: String(message.conversation),
  // null when the sender's account was deleted
  sender: message.sender ? toPublicUser(message.sender) : null,
  text: message.text,
  clientId: message.clientId ?? null,
  createdAt: message.createdAt,
});

interface SendInput {
  conversationId: unknown;
  senderId: string;
  text: unknown;
  clientId?: unknown;
}

// Saves a message and pushes it to every member (all their tabs/devices).
// Used by the socket "message:send" handler and POST /conversations/:id/messages.
// The sender always comes from the verified token (senderId), never the payload.
export const sendMessage = async ({ conversationId, senderId, text, clientId }: SendInput) => {
  if (!sendLimiter.hit(String(senderId))) {
    throw new AppError("You're sending messages too fast, slow down a little", 429);
  }
  const cleanedText = cleanText(text, { field: "Message", maxLength: MAX_MESSAGE_LENGTH });
  if (clientId !== undefined && clientId !== null && !(typeof clientId === "string" && CLIENT_ID.test(clientId))) {
    throw new AppError("clientId must be 8-64 letters, digits, - or _", 400);
  }
  const validClientId = typeof clientId === "string" ? clientId : undefined;

  const conversation = await findForMember(conversationId, senderId);

  let message;
  try {
    message = await Message.create({
      conversation: conversation._id,
      sender: senderId,
      text: cleanedText,
      clientId: validClientId,
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // A retry of a message that was already saved: answer with the original,
    // and don't broadcast it again (the first attempt already did).
    const existing = await Message.findOne({ sender: senderId, clientId: validClientId }).populate<{
      sender: PublicUserSource | null;
    }>(populateSender);
    if (!existing || !existing.conversation.equals(conversation._id)) {
      throw new AppError("clientId was already used for another message", 409);
    }
    return { message: serializeMessage(existing), duplicate: true };
  }

  // Sidebar preview + ordering; the sender has obviously read their own message
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessage: { text: cleanedText.slice(0, 200), sender: senderId, createdAt: message.createdAt },
        lastMessageAt: message.createdAt,
      },
    },
  );
  await Conversation.updateOne(
    { _id: conversation._id, "members.user": senderId },
    { $max: { "members.$.lastReadAt": message.createdAt } },
  );

  const payload = serializeMessage(await message.populate<{ sender: PublicUserSource | null }>(populateSender));
  emitToUsers(memberIds(conversation), "message:new", payload);
  return { message: payload, duplicate: false };
};

// One page of history, newest first in the query but returned oldest first.
// Pass the oldest loaded message's id as `before` to get the page above it.
export const listMessages = async (
  conversationId: unknown,
  userId: string,
  { before, limit }: { before?: unknown; limit?: unknown } = {},
) => {
  const conversation = await findForMember(conversationId, userId);
  const requested = typeof limit === "string" ? Number.parseInt(limit, 10) : Number.NaN;
  const pageSize = Math.min(Math.max(requested || PAGE_SIZE, 1), MAX_PAGE_SIZE);

  let olderThan = {};
  if (before) {
    const cursor = await Message.findOne({ _id: toObjectId(before, "before"), conversation: conversation._id });
    if (!cursor) throw new AppError("Invalid before cursor", 400);
    olderThan = {
      $or: [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
      ],
    };
  }

  const page = await Message.find({ conversation: conversation._id, ...olderThan })
    .sort({ createdAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .populate<{ sender: PublicUserSource | null }>(populateSender);

  const hasMore = page.length > pageSize;
  return {
    messages: page.slice(0, pageSize).reverse().map(serializeMessage),
    hasMore,
  };
};

// Case-insensitive text search, only inside the user's own conversations
export const searchMessages = async (userId: string, query: unknown) => {
  const q = cleanText(query, { field: "Search query", maxLength: 100 });
  if (q.length < 2) throw new AppError("Search query must be at least 2 characters", 400);

  const conversationIds = await Conversation.find({ "members.user": userId }).distinct("_id");
  const messages = await Message.find({
    conversation: { $in: conversationIds },
    text: { $regex: escapeRegex(q), $options: "i" },
  })
    .sort({ createdAt: -1 })
    .limit(25)
    .populate<{ sender: PublicUserSource | null }>(populateSender);

  return messages.map(serializeMessage);
};
