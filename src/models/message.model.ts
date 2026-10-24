import mongoose from "mongoose";
import type { Types } from "mongoose";

export const MAX_MESSAGE_LENGTH = 2000;

export interface IMessage {
  conversation: Types.ObjectId;
  sender: Types.ObjectId;
  text: string;
  clientId?: string;
  createdAt: Date;
}

const { ObjectId } = mongoose.Schema.Types;

const messageSchema = new mongoose.Schema<IMessage>(
  {
    conversation: { type: ObjectId, ref: "Conversation", required: true },
    sender: { type: ObjectId, ref: "User", required: true },
    text: {
      type: String,
      required: [true, "Message text is required"],
      maxlength: [MAX_MESSAGE_LENGTH, `Message must be at most ${MAX_MESSAGE_LENGTH} characters`],
    },
    // Random id the client generates per message. Sending the same one twice
    // (a retry after a lost acknowledgement) returns the first message
    // instead of storing a duplicate.
    clientId: { type: String, maxlength: 64 },
  },
  { versionKey: false, timestamps: { createdAt: true, updatedAt: false } },
);

// History pages: newest first within one conversation, _id breaks ties
messageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });
messageSchema.index(
  { sender: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } },
);

export const Message = mongoose.model<IMessage>("Message", messageSchema, "messages");
