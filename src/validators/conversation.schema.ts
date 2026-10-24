import type { Schema } from "express-validator";

// Validation schemas for the conversation routes (express-validator's checkSchema).
// Services validate again (they are also called from socket handlers).

export const conversationIdSchema: Schema = {
  id: {
    in: ["params"],
    isMongoId: { errorMessage: "Invalid conversation id" },
  },
};

// userId (direct) and name/memberIds (group) depend on type, so the service
// checks them (conversation.service.ts: openDirect / createGroup)
export const createConversationSchema: Schema = {
  type: {
    in: ["body"],
    isIn: {
      options: [["direct", "group"]],
      errorMessage: 'type must be "direct" or "group"',
    },
  },
};

export const listMessagesSchema: Schema = {
  ...conversationIdSchema,
  before: {
    in: ["query"],
    optional: true,
    isMongoId: { errorMessage: "before must be a message id" },
  },
  limit: {
    in: ["query"],
    optional: true,
    isInt: { options: { min: 1, max: 100 }, errorMessage: "limit must be 1-100" },
  },
};

export const sendMessageSchema: Schema = {
  ...conversationIdSchema,
  text: {
    in: ["body"],
    isString: { errorMessage: "text is required" },
  },
};

export const searchSchema: Schema = {
  q: {
    in: ["query"],
    isString: { errorMessage: "q is required" },
    trim: true,
    isLength: { options: { min: 2, max: 100 }, errorMessage: "q must be 2-100 characters" },
  },
};
