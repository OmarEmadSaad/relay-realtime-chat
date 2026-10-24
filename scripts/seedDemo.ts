// Creates the public demo accounts and some realistic conversations.
//
//   npm run seed            create whatever is missing (safe to re-run)
//   npm run seed -- --reset also re-create the demo conversations' messages
//                           (fresh timestamps, so the demo looks recent)
//
// Safety:
//  - only touches users flagged isDemo; if a demo email belongs to a real
//    (non-demo) account, that account is left alone and its chats are skipped
//  - only touches conversations it created itself (they have a seedKey), and
//    those only contain demo users
//  - never deletes users, collections or databases
// Credentials are documented in docs/DEMO_CREDENTIALS.md.
import mongoose from "mongoose";
import type { Types } from "mongoose";
import type { ConversationType, Role } from "../shared/types.d.ts";
import { loadEnv, assertEnv } from "../src/config/env.ts";
import { connectDB } from "../src/config/db.ts";
import { User } from "../src/models/user.model.ts";
import { Conversation, DIRECT, GROUP, directKeyFor } from "../src/models/conversation.model.ts";
import { Message } from "../src/models/message.model.ts";
import { USER, ADMIN } from "../src/utils/userRoles.ts";

loadEnv();
assertEnv(["MONGODB_URI"]);

const reset = process.argv.includes("--reset");
const DEMO_PASSWORD = "DemoChat2026!";

type DemoKey = "lina" | "marcus" | "aisha" | "diego" | "sofia" | "kenji";

const demoUsers: Record<DemoKey, { firstName: string; lastName: string; role: Role }> = {
  lina: { firstName: "Lina", lastName: "Haddad", role: USER },
  marcus: { firstName: "Marcus", lastName: "Reed", role: USER },
  aisha: { firstName: "Aisha", lastName: "Khan", role: USER },
  diego: { firstName: "Diego", lastName: "Alvarez", role: USER },
  sofia: { firstName: "Sofia", lastName: "Rossi", role: ADMIN },
  kenji: { firstName: "Kenji", lastName: "Tanaka", role: USER },
};

interface SeedConversation {
  key: string;
  type: ConversationType;
  name?: string;
  members: DemoKey[];
  unreadFor?: Partial<Record<DemoKey, number>>; // last N messages left unread
  messages: [who: DemoKey, minutesAgo: number, text: string][];
}

const conversations: SeedConversation[] = [
  {
    key: "group:launch",
    type: GROUP,
    name: "Product Launch",
    members: ["lina", "marcus", "aisha", "diego", "sofia"],
    unreadFor: { lina: 3 },
    messages: [
      ["sofia", 1500, "Morning all! Launch checklist is pinned in the drive. Can everyone confirm their owners by EOD?"],
      ["marcus", 1490, "Backend + infra are mine. Load test is scheduled for tomorrow 10:00."],
      ["aisha", 1482, "Design QA is done for onboarding. Still polishing the empty states."],
      ["lina", 1470, "I'll take release notes and the changelog page."],
      ["diego", 1460, "Marketing site copy is ready for review 👀"],
      ["sofia", 300, "Load test results: p95 latency 180ms at 2k concurrent sockets. Nice work Marcus."],
      ["marcus", 290, "Reconnect storm test also passed, clients back within ~3s after a server restart."],
      ["aisha", 42, "Final screenshots for the press kit are uploaded."],
      ["diego", 18, "Press embargo lifts Thursday 9am PT. Please don't post anything before that!"],
      ["sofia", 6, "Go/no-go meeting in 30 min. Lina, can you bring the release notes draft?"],
    ],
  },
  {
    key: "dm:lina-marcus",
    type: DIRECT,
    members: ["lina", "marcus"],
    messages: [
      ["marcus", 200, "Hey, did you see the error spike after the 2.3 deploy?"],
      ["lina", 196, "Yeah, it was the token refresh race when two tabs refresh at once."],
      ["lina", 195, "I wrapped the refresh in a Web Lock so only one tab does it."],
      ["marcus", 190, "Ahh that explains the random logouts. Good catch 🙌"],
      ["marcus", 188, "Can you add a test for it?"],
      ["lina", 60, "Done, PR is up. Also added a test for multi-tab presence."],
      ["marcus", 55, "Reviewing now."],
    ],
  },
  {
    key: "dm:lina-aisha",
    type: DIRECT,
    members: ["lina", "aisha"],
    messages: [
      ["aisha", 2900, "Quick one: do we show 'last seen' for people who are offline?"],
      ["lina", 2890, "Yes, '5 min ago' style, and 'online' with the green dot."],
      ["aisha", 2885, "Perfect, I'll match that in the mobile header."],
      ["aisha", 120, "New avatar fallback colors are in Figma, want to take a look?"],
      ["lina", 110, "Love them. The contrast in dark mode is much better."],
    ],
  },
  {
    key: "dm:lina-diego",
    type: DIRECT,
    members: ["lina", "diego"],
    unreadFor: { lina: 2 },
    messages: [
      ["lina", 4400, "Could you send me the final launch tweet thread?"],
      ["diego", 4300, "Sure, drafting it today."],
      ["diego", 25, "Draft is ready! Kept it to 4 posts."],
      ["diego", 24, "Let me know if the tone works for you."],
    ],
  },
  {
    key: "group:frontend",
    type: GROUP,
    name: "Frontend Guild",
    members: ["lina", "aisha", "kenji"],
    messages: [
      ["kenji", 5000, "Proposal: we drop the UI framework for the chat widget and ship plain JS modules."],
      ["aisha", 4990, "As long as we keep the components small, +1."],
      ["lina", 4980, "Agreed. No build step makes it easier for new folks to contribute."],
      ["kenji", 900, "Reminder: accessibility review on Friday. Bring your keyboard-only findings."],
    ],
  },
  {
    key: "dm:marcus-sofia",
    type: DIRECT,
    members: ["marcus", "sofia"],
    messages: [
      ["sofia", 700, "Can we get Redis for the Socket.IO adapter before we scale to two instances?"],
      ["marcus", 680, "Yes, it's in the plan for next sprint."],
    ],
  },
  {
    key: "dm:sofia-kenji",
    type: DIRECT,
    members: ["sofia", "kenji"],
    messages: [
      ["kenji", 1200, "Is the Friday review still on?"],
      ["sofia", 1190, "Yes, 2pm."],
    ],
  },
];

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

const upsertDemoUsers = async () => {
  const ids: Partial<Record<DemoKey, Types.ObjectId>> = {};
  let n = 0;
  for (const [key, profile] of Object.entries(demoUsers) as [DemoKey, (typeof demoUsers)[DemoKey]][]) {
    n += 1;
    const email = `${key}@demo.example.com`;
    let user = await User.findOne({ email });
    if (user && !user.isDemo) {
      console.warn(`! ${email} belongs to a real account, leaving it alone`);
      continue;
    }
    if (!user) {
      user = new User({ email, phoneNumber: `+20100000010${n}`, isDemo: true });
    }
    Object.assign(user, profile);
    user.password = DEMO_PASSWORD; // hashed by the pre("save") hook
    await user.save();
    ids[key] = user._id;
    console.log(`✓ ${user.firstName} ${user.lastName} <${email}> (${user.role})`);
  }
  return ids;
};

const seedConversation = async (spec: SeedConversation, ids: Partial<Record<DemoKey, Types.ObjectId>>) => {
  const memberIds = spec.members.map((member) => ids[member]).filter((id): id is Types.ObjectId => id !== undefined);
  if (memberIds.length !== spec.members.length) {
    console.warn(`! skipping ${spec.key}: a member is not a demo account`);
    return;
  }

  let conversation = await Conversation.findOne({ seedKey: spec.key });
  if (conversation && !reset) {
    console.log(`- ${spec.key} already exists`);
    return;
  }
  if (!conversation) {
    conversation = await Conversation.create({
      type: spec.type,
      name: spec.name,
      seedKey: spec.key,
      directKey: spec.type === DIRECT ? directKeyFor(memberIds[0], memberIds[1]) : undefined,
      createdBy: memberIds[0],
      members: memberIds.map((user) => ({ user, joinedAt: minutesAgo(10_000) })),
    });
  }

  // Only this seeded conversation's messages are replaced
  await Message.deleteMany({ conversation: conversation._id });
  const messages = spec.messages.map(([who, ago, text]) => ({
    _id: new mongoose.Types.ObjectId(),
    conversation: conversation._id,
    sender: ids[who]!, // every member was checked above
    text,
    createdAt: minutesAgo(ago),
  }));
  // The raw driver keeps the createdAt values above (Mongoose would set "now")
  await Message.collection.insertMany(messages);

  // Everyone has read everything, except the last N messages for unreadFor
  const last = messages[messages.length - 1];
  conversation.lastMessage = { text: last.text, sender: last.sender, createdAt: last.createdAt };
  conversation.lastMessageAt = last.createdAt;
  for (const member of conversation.members) {
    const key = spec.members[memberIds.findIndex((id) => id.equals(member.user))];
    const unread = spec.unreadFor?.[key] ?? 0;
    const lastRead = messages[messages.length - 1 - unread];
    member.lastReadAt = new Date(lastRead.createdAt.getTime() + 1);
  }
  await conversation.save();
  console.log(`✓ ${spec.key} (${messages.length} messages)`);
};

try {
  await connectDB();
  // Builds missing indexes only (never drops existing ones)
  await Promise.all([User.createIndexes(), Conversation.createIndexes(), Message.createIndexes()]);
  const ids = await upsertDemoUsers();
  for (const spec of conversations) {
    await seedConversation(spec, ids);
  }
  console.log(`\nDone. Demo password for every account: ${DEMO_PASSWORD}`);
} catch (err) {
  console.error("Seeding failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
