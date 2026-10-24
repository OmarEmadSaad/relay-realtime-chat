import { Router } from "express";

import { searchMessages } from "../controllers/conversation.controller.ts";
import { searchSchema } from "../validators/conversation.schema.ts";
import { validationSchema } from "../middleware/validationSchema.ts";
import { methodNotAllowed } from "../middleware/errorHandler.ts";
import { verifyToken } from "../middleware/verifyToken.ts";
import { rateLimit } from "../middleware/rateLimit.ts";

const router = Router();

router.use(verifyToken);

// GET /api/messages/search?q=hello - only searches the user's own conversations
router
  .route("/search")
  .get(rateLimit({ windowMs: 60_000, max: 60, name: "searches" }), validationSchema(searchSchema), searchMessages)
  .all(methodNotAllowed(["GET"]));

export default router;
