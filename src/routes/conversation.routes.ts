import { Router } from "express";

import {
  listConversations,
  getConversation,
  createConversation,
  leaveConversation,
  listMessages,
  sendMessage,
  markRead,
} from "../controllers/conversation.controller.ts";
import {
  conversationIdSchema,
  createConversationSchema,
  listMessagesSchema,
  sendMessageSchema,
} from "../validators/conversation.schema.ts";
import { validationSchema } from "../middleware/validationSchema.ts";
import { methodNotAllowed } from "../middleware/errorHandler.ts";
import { verifyToken } from "../middleware/verifyToken.ts";
import { rateLimit } from "../middleware/rateLimit.ts";

const router = Router();

// Every route needs a valid token, and every /:id route checks (in the
// service) that the logged-in user is a member of that conversation.
router.use(verifyToken);

router
  .route("/")
  .get(listConversations)
  .post(
    rateLimit({ windowMs: 60_000, max: 20, name: "new conversations" }),
    validationSchema(createConversationSchema),
    createConversation,
  )
  .all(methodNotAllowed(["GET", "POST"]));

router
  .route("/:id")
  .get(validationSchema(conversationIdSchema), getConversation)
  .all(methodNotAllowed(["GET"]));

router
  .route("/:id/messages")
  .get(validationSchema(listMessagesSchema), listMessages)
  .post(validationSchema(sendMessageSchema), sendMessage)
  .all(methodNotAllowed(["GET", "POST"]));

router
  .route("/:id/read")
  .post(validationSchema(conversationIdSchema), markRead)
  .all(methodNotAllowed(["POST"]));

router
  .route("/:id/leave")
  .post(validationSchema(conversationIdSchema), leaveConversation)
  .all(methodNotAllowed(["POST"]));

export default router;
