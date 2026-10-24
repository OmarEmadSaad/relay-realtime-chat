import * as httpStatusText from "../utils/httpStatusText.ts";
import { asyncWrapper } from "../middleware/asyncWrapper.ts";
import { authUser } from "../middleware/verifyToken.ts";
import { GROUP } from "../models/conversation.model.ts";
import * as conversationService from "../services/conversation.service.ts";
import * as messageService from "../services/message.service.ts";
import { conversationRoom, emitToUsers, removeUserFromRoom } from "../sockets/emitter.ts";

// History is loaded over REST (cacheable, paginated, easy to test); new
// messages, typing, presence and read receipts arrive over Socket.IO.
// Every service call receives the user id from the verified token.

export const listConversations = asyncWrapper(async (req, res) => {
  const conversations = await conversationService.listConversations(authUser(req).id);
  res.json({ status: httpStatusText.SUCCESS, data: { conversations } });
});

export const getConversation = asyncWrapper(async (req, res) => {
  const conversation = await conversationService.getConversation(req.params.id, authUser(req).id);
  res.json({ status: httpStatusText.SUCCESS, data: { conversation } });
});

// { type: "direct", userId } or { type: "group", name, memberIds }
export const createConversation = asyncWrapper(async (req, res) => {
  const { id: userId } = authUser(req);
  if (req.body.type === GROUP) {
    const conversation = await conversationService.createGroup(userId, req.body);
    emitToUsers(conversation.members.map((m) => m.id), "conversation:new", conversation);
    return res.status(201).json({ status: httpStatusText.SUCCESS, data: { conversation } });
  }

  const { conversation, created } = await conversationService.openDirect(userId, req.body.userId);
  // The other person sees the chat once the first message arrives;
  // the creator's other tabs see it right away.
  if (created) emitToUsers([userId], "conversation:new", conversation);
  res.status(created ? 201 : 200).json({ status: httpStatusText.SUCCESS, data: { conversation } });
});

export const leaveConversation = asyncWrapper(async (req, res) => {
  const { id: userId } = authUser(req);
  const conversation = await conversationService.leaveGroup(req.params.id, userId);
  removeUserFromRoom(userId, conversationRoom(conversation.id));
  emitToUsers([userId], "conversation:removed", { conversationId: conversation.id });
  emitToUsers(conversation.members.map((m) => m.id), "conversation:updated", conversation);
  res.json({ status: httpStatusText.SUCCESS, data: null });
});

export const listMessages = asyncWrapper(async (req, res) => {
  const page = await messageService.listMessages(req.params.id, authUser(req).id, req.query);
  res.json({ status: httpStatusText.SUCCESS, data: page });
});

// Same as the socket "message:send" event; also broadcasts "message:new"
export const sendMessage = asyncWrapper(async (req, res) => {
  const { message, duplicate } = await messageService.sendMessage({
    conversationId: req.params.id,
    senderId: authUser(req).id,
    text: req.body.text,
    clientId: req.body.clientId,
  });
  res.status(duplicate ? 200 : 201).json({ status: httpStatusText.SUCCESS, data: { message } });
});

export const markRead = asyncWrapper(async (req, res) => {
  const { id: userId } = authUser(req);
  const { conversation, readAt } = await conversationService.markRead(req.params.id, userId);
  emitToUsers(conversationService.memberIds(conversation), "message:read", {
    conversationId: String(conversation._id),
    userId,
    readAt,
  });
  res.json({ status: httpStatusText.SUCCESS, data: { readAt } });
});

export const searchMessages = asyncWrapper(async (req, res) => {
  const messages = await messageService.searchMessages(authUser(req).id, req.query.q ?? "");
  res.json({ status: httpStatusText.SUCCESS, data: { messages } });
});
