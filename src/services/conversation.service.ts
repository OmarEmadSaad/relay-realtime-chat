import type { Types } from "mongoose";
import type { ConversationDTO } from "../../shared/types.d.ts";
import {
  Conversation,
  DIRECT,
  GROUP,
  MAX_GROUP_MEMBERS,
  directKeyFor,
} from "../models/conversation.model.ts";
import type { IConversation, IMember } from "../models/conversation.model.ts";
import { Message } from "../models/message.model.ts";
import { User, PUBLIC_USER_FIELDS, toPublicUser } from "../models/user.model.ts";
import type { PublicUserSource } from "../models/user.model.ts";
import { AppError, isDuplicateKeyError } from "../utils/appError.ts";
import { cleanText, toObjectId } from "../utils/sanitize.ts";
import { isOnline } from "./presence.service.ts";

// A member after populate("members.user"); null if the account was deleted
export type PopulatedMember = Omit<IMember, "user"> & { user: PublicUserSource | null };
export type PopulatedConversation = Omit<IConversation, "members"> & {
  _id: Types.ObjectId;
  members: PopulatedMember[];
};
type AnyMemberUser = Types.ObjectId | PublicUserSource | null;

// The same 404 whether the conversation doesn't exist or the user isn't in
// it, so ids of other people's conversations can't be probed.
const notFound = () => new AppError("Conversation not found", 404);

const populateMembers = { path: "members.user", select: PUBLIC_USER_FIELDS };

const memberUserId = (user: AnyMemberUser) => {
  if (!user) return null;
  return String("firstName" in user ? user._id : user);
};

export const memberIds = (conversation: { members: { user: AnyMemberUser }[] }) =>
  conversation.members.map((m) => memberUserId(m.user)).filter((id): id is string => id !== null);

const unreadCount = async (
  conversation: { _id: Types.ObjectId; members: { user: AnyMemberUser; lastReadAt: Date }[] },
  userId: string,
) => {
  const me = conversation.members.find((m) => memberUserId(m.user) === String(userId));
  if (!me) return 0;
  return Message.countDocuments({
    conversation: conversation._id,
    createdAt: { $gt: me.lastReadAt },
    sender: { $ne: userId },
  });
};

// The JSON shape of a conversation in every REST response and socket event
export const serializeConversation = (conversation: PopulatedConversation, unread = 0): ConversationDTO => ({
  id: String(conversation._id),
  type: conversation.type,
  name: conversation.name ?? null,
  createdBy: String(conversation.createdBy),
  members: conversation.members.flatMap((m) =>
    m.user // a deleted account leaves a null after populate
      ? [{ ...toPublicUser(m.user), online: isOnline(m.user._id), lastReadAt: m.lastReadAt }]
      : [],
  ),
  lastMessage: conversation.lastMessage?.createdAt
    ? {
        text: conversation.lastMessage.text,
        sender: String(conversation.lastMessage.sender),
        createdAt: conversation.lastMessage.createdAt,
      }
    : null,
  lastMessageAt: conversation.lastMessageAt,
  unreadCount: unread,
  createdAt: conversation.createdAt,
});

// The membership check every private operation goes through. The user id
// always comes from the verified token, never from the request payload.
export const findForMember = async (conversationId: unknown, userId: string) => {
  const conversation = await Conversation.findOne({
    _id: toObjectId(conversationId, "conversation id"),
    "members.user": userId,
  });
  if (!conversation) throw notFound();
  return conversation;
};

const populated = (conversation: Awaited<ReturnType<typeof findForMember>>) =>
  conversation.populate<{ members: PopulatedMember[] }>(populateMembers);

export const listConversations = async (userId: string) => {
  // A direct chat someone opened but never wrote in only shows up for them
  const conversations = await Conversation.find({
    "members.user": userId,
    $or: [{ type: GROUP }, { "lastMessage.createdAt": { $exists: true } }, { createdBy: userId }],
  })
    .sort({ lastMessageAt: -1 })
    .limit(200)
    .populate<{ members: PopulatedMember[] }>(populateMembers);

  const counts = await Promise.all(conversations.map((c) => unreadCount(c, userId)));
  return conversations.map((c, i) => serializeConversation(c, counts[i]));
};

export const getConversation = async (conversationId: unknown, userId: string) => {
  const conversation = await populated(await findForMember(conversationId, userId));
  return serializeConversation(conversation, await unreadCount(conversation, userId));
};

// "Message X": returns the existing direct chat with X or creates it
export const openDirect = async (userId: string, otherUserId: unknown) => {
  const otherId = toObjectId(otherUserId, "user id");
  if (otherId.equals(userId)) {
    throw new AppError("You can't start a conversation with yourself", 400);
  }
  if (!(await User.exists({ _id: otherId }))) {
    throw new AppError("User not found", 404);
  }

  const directKey = directKeyFor(userId, otherId);
  let created = false;
  let conversation = await Conversation.findOne({ directKey });
  if (!conversation) {
    try {
      conversation = await Conversation.create({
        type: DIRECT,
        directKey,
        createdBy: userId,
        members: [{ user: userId }, { user: otherId }],
      });
      created = true;
    } catch (err) {
      // The other user opened the same chat at the same moment
      if (!isDuplicateKeyError(err)) throw err;
      conversation = await Conversation.findOne({ directKey });
      if (!conversation) throw err;
    }
  }
  const result = await populated(conversation);
  return { conversation: serializeConversation(result, await unreadCount(result, userId)), created };
};

export const createGroup = async (userId: string, { name, memberIds: rawIds }: { name?: unknown; memberIds?: unknown }) => {
  const groupName = cleanText(name, { field: "Group name", maxLength: 60 });
  if (!Array.isArray(rawIds)) throw new AppError("memberIds must be an array", 400);

  const ids = [...new Set(rawIds.map((id: unknown) => String(toObjectId(id, "member id"))))].filter(
    (id) => id !== String(userId),
  );
  if (ids.length < 2) {
    throw new AppError("A group needs at least 2 other members", 400);
  }
  if (ids.length + 1 > MAX_GROUP_MEMBERS) {
    throw new AppError(`A group can have at most ${MAX_GROUP_MEMBERS} members`, 400);
  }
  if ((await User.countDocuments({ _id: { $in: ids } })) !== ids.length) {
    throw new AppError("Some members don't exist", 400);
  }

  const conversation = await Conversation.create({
    type: GROUP,
    name: groupName,
    createdBy: userId,
    members: [userId, ...ids].map((id) => ({ user: id })),
  });
  return serializeConversation(await populated(conversation));
};

// Removes the user from a group. Their old messages stay for the others.
export const leaveGroup = async (conversationId: unknown, userId: string) => {
  const conversation = await findForMember(conversationId, userId);
  if (conversation.type !== GROUP) {
    throw new AppError("You can only leave group conversations", 400);
  }
  conversation.members = conversation.members.filter((m) => !m.user.equals(userId));
  if (conversation.members.length) {
    await conversation.save();
  } else {
    // Last member left: keep the messages, but nobody can open it any more
    await Conversation.updateOne({ _id: conversation._id }, { $set: { members: [] } });
  }
  return serializeConversation(await populated(conversation));
};

// Everything up to now is read for this user
export const markRead = async (conversationId: unknown, userId: string) => {
  const readAt = new Date();
  const conversation = await findForMember(conversationId, userId);
  await Conversation.updateOne(
    { _id: conversation._id, "members.user": userId },
    { $max: { "members.$.lastReadAt": readAt } },
  );
  return { conversation, readAt };
};
