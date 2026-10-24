import type { ConversationDTO, ConversationMember, MessageDTO, PublicUser, SessionUser } from "../../shared/types.d.ts";
import { fullName } from "./dom.ts";

// A message on screen: from the server, or still being sent from this tab
// (id null until the server acknowledges it).
export interface ChatMessage extends Omit<MessageDTO, "id"> {
  id: string | null;
  status?: "sending" | "failed";
  error?: string | null;
}

export interface MessagesEntry {
  items: ChatMessage[];
  hasMore: boolean;
  status: "loading" | "ready" | "error";
  loadingOlder?: boolean;
}

export type Contact = PublicUser & { online?: boolean };
export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";
type LoadStatus = "loading" | "ready" | "error";

interface State {
  me: SessionUser | null;
  conversations: Map<string, ConversationDTO>;
  conversationsStatus: LoadStatus;
  contacts: Map<string, Contact>;
  contactsStatus: "idle" | LoadStatus;
  online: Set<string>;
  activeId: string | null;
  messages: Map<string, MessagesEntry>;
  typing: Map<string, Map<string, { name: string; timer: ReturnType<typeof setTimeout> }>>;
  connection: ConnectionStatus;
}

// All client state in one place. Views read it and re-render; app.ts changes it.
export const state: State = {
  me: null, // the logged-in user (from the session)
  conversations: new Map(), // id -> conversation (server shape)
  conversationsStatus: "loading",
  contacts: new Map(), // id -> public user
  contactsStatus: "idle",
  online: new Set(), // user ids
  activeId: null, // the open conversation
  messages: new Map(), // conversationId -> loaded messages
  typing: new Map(), // conversationId -> userId -> who is typing
  connection: "connecting",
};

export const resetState = () => {
  state.me = null;
  state.conversations.clear();
  state.conversationsStatus = "loading";
  state.contacts.clear();
  state.contactsStatus = "idle";
  state.online.clear();
  state.activeId = null;
  state.messages.clear();
  for (const users of state.typing.values()) users.forEach(({ timer }) => clearTimeout(timer));
  state.typing.clear();
  state.connection = "connecting";
};

export const myId = () => state.me?._id;

export const isOnline = (userId: string) => state.online.has(userId);

export const activeConversation = () => (state.activeId ? state.conversations.get(state.activeId) : undefined) ?? null;

// The other person in a direct chat
export const otherMember = (conversation: ConversationDTO): ConversationMember | null =>
  conversation.members.find((member) => member.id !== myId()) ?? null;

export const conversationTitle = (conversation: ConversationDTO) =>
  conversation.type === "group" ? (conversation.name ?? "Group") : fullName(otherMember(conversation));

export const sortedConversations = () =>
  [...state.conversations.values()].sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );

export const memberById = (conversation: ConversationDTO | null, userId: string): PublicUser | null =>
  conversation?.members.find((member) => member.id === userId) ?? state.contacts.get(userId) ?? null;

export const typingNames = (conversationId: string) =>
  [...(state.typing.get(conversationId)?.values() ?? [])].map((entry) => entry.name);

export const totalUnread = () =>
  [...state.conversations.values()].reduce((sum, c) => sum + (c.unreadCount || 0), 0);
