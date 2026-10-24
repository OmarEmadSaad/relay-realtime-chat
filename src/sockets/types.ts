import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, Role, ServerToClientEvents } from "../../shared/types.d.ts";

// Set by the handshake middleware from the verified token + database
export interface SocketUser {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
  isDemo: boolean;
}

export interface SocketData {
  user: SocketUser;
  tokenExpiresAt: number; // ms timestamp
  openConversation?: string | null; // joined via conversation:join
  typingIn?: { room: string; conversationId: string } | null;
}

type InterServerEvents = Record<string, never>;

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
