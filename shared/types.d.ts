// The contract between server and client: JSON shapes and Socket.IO events.
// Imported with `import type` by both src/ and client/src/, so a change here
// is checked on both sides. It's a .d.ts file: types only, nothing to emit.
// Full description of each event: docs/SOCKET_EVENTS.md

export type Role = "user" | "admin" | "manager";
export type ConversationType = "direct" | "group";

// The server sends Date objects; over the wire they arrive as ISO strings
export type DateLike = Date | string;

export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string;
  role: Role;
  lastSeenAt: DateLike | null;
}

// The logged-in user as returned by /api/auth/login and /api/users/me
export interface SessionUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  role: Role;
  avatar: string;
  isDemo: boolean;
  lastSeenAt: DateLike | null;
}

export interface ConversationMember extends PublicUser {
  online: boolean;
  lastReadAt: DateLike;
}

export interface LastMessage {
  text: string;
  sender: string;
  createdAt: DateLike;
}

export interface ConversationDTO {
  id: string;
  type: ConversationType;
  name: string | null;
  createdBy: string;
  members: ConversationMember[];
  lastMessage: LastMessage | null;
  lastMessageAt: DateLike;
  unreadCount: number;
  createdAt: DateLike;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  sender: PublicUser | null; // null when the account was deleted
  text: string;
  clientId: string | null;
  createdAt: DateLike;
}

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "ERROR"
  | "INTERNAL_ERROR";

export interface SocketError {
  code: ErrorCode;
  message: string;
}

// Every acknowledgement: { ok: true, ...result } or { ok: false, error }
export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: SocketError };

// Handshake errors, in connect_error's err.data.code
export type AuthErrorCode = "TOKEN_REQUIRED" | "TOKEN_EXPIRED" | "TOKEN_INVALID";

export interface ClientToServerEvents {
  "conversation:join": (payload: { conversationId: string }, ack: (res: Ack<{ conversationId: string }>) => void) => void;
  "conversation:leave": (payload: Record<string, never>, ack: (res: Ack) => void) => void;
  "message:send": (
    payload: { conversationId: string; text: string; clientId?: string },
    ack: (res: Ack<{ message: MessageDTO; duplicate: boolean }>) => void,
  ) => void;
  "message:read": (payload: { conversationId: string }, ack: (res: Ack<{ readAt: DateLike }>) => void) => void;
  "typing:start": (payload: { conversationId: string }) => void;
  "typing:stop": (payload: { conversationId: string }) => void;
}

export interface TypingUser {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ServerToClientEvents {
  "message:new": (message: MessageDTO) => void;
  "message:error": (error: SocketError & { clientId: string | null }) => void;
  "message:read": (receipt: { conversationId: string; userId: string; readAt: DateLike }) => void;
  "typing:start": (event: { conversationId: string; user: TypingUser }) => void;
  "typing:stop": (event: { conversationId: string; userId: string }) => void;
  "presence:snapshot": (snapshot: { onlineUserIds: string[] }) => void;
  "presence:update": (update: { userId: string; online: boolean; lastSeenAt: DateLike | null }) => void;
  "conversation:new": (conversation: ConversationDTO) => void;
  "conversation:updated": (conversation: ConversationDTO) => void;
  "conversation:removed": (event: { conversationId: string }) => void;
  "auth:expired": () => void;
  "session:ended": (event: { reason: string }) => void;
}

// JSend envelope used by every REST response
export type ApiResponse<T> =
  | { status: "success"; data: T }
  | { status: "fail" | "error"; message: string; code: number; data: unknown };
