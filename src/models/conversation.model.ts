import mongoose from "mongoose";
import type { Types } from "mongoose";
import type { ConversationType } from "../../shared/types.d.ts";

export const DIRECT = "direct" satisfies ConversationType;
export const GROUP = "group" satisfies ConversationType;

export const MAX_GROUP_MEMBERS = 50;

// One entry per participant. lastReadAt drives unread counts and "Seen".
export interface IMember {
  user: Types.ObjectId;
  joinedAt: Date;
  lastReadAt: Date;
}

export interface IConversation {
  type: ConversationType;
  name?: string;
  members: IMember[];
  createdBy: Types.ObjectId;
  directKey?: string;
  lastMessage?: { text: string; sender: Types.ObjectId; createdAt: Date };
  lastMessageAt: Date;
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const { ObjectId } = mongoose.Schema.Types;

const memberSchema = new mongoose.Schema<IMember>(
  {
    user: { type: ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: Date.now },
    lastReadAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema<IConversation>(
  {
    type: { type: String, enum: [DIRECT, GROUP], required: true },
    // Only groups have a name; a direct chat is shown as the other person
    name: {
      type: String,
      trim: true,
      maxlength: [60, "Group name must be at most 60 characters"],
    },
    members: {
      type: [memberSchema],
      validate: {
        validator: (members: IMember[]) => members.length >= 1 && members.length <= MAX_GROUP_MEMBERS,
        message: `A conversation has 1-${MAX_GROUP_MEMBERS} members`,
      },
    },
    createdBy: { type: ObjectId, ref: "User", required: true },
    // "<smallerUserId>:<biggerUserId>" for direct chats. The unique index makes
    // "open a chat with X" idempotent, even when both users click at once.
    directKey: { type: String },
    // Denormalised preview so the sidebar needs no extra query per chat
    lastMessage: {
      text: String,
      sender: { type: ObjectId, ref: "User" },
      createdAt: Date,
    },
    lastMessageAt: { type: Date, default: Date.now },
    // Set only by scripts/seedDemo.ts, so re-running it finds its own data
    seedKey: { type: String },
  },
  { versionKey: false, timestamps: true },
);

// "My conversations, most recent first" (the sidebar query)
conversationSchema.index({ "members.user": 1, lastMessageAt: -1 });
conversationSchema.index(
  { directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: "string" } } },
);
conversationSchema.index(
  { seedKey: 1 },
  { unique: true, partialFilterExpression: { seedKey: { $type: "string" } } },
);

export const directKeyFor = (userA: Types.ObjectId | string, userB: Types.ObjectId | string) =>
  [String(userA), String(userB)].sort().join(":");

export const Conversation = mongoose.model<IConversation>("Conversation", conversationSchema, "conversations");
