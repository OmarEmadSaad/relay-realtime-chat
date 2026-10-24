import type { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
import type { AuthErrorCode, ClientToServerEvents, ServerToClientEvents } from "../../shared/types.d.ts";
import { SERVER_URL } from "./config.ts";
import { ApiError, getAccessToken, refreshTokens } from "./api.ts";
import type { ConnectionStatus } from "./store.ts";

// The Socket.IO connection. The client library is served by the Socket.IO
// server itself (/socket.io/socket.io.min.js), so its version always matches.
// Only its types are imported here; the code comes from that script tag.

export type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type IoFactory = (url?: string, options?: Partial<ManagerOptions & SocketOptions>) => ChatSocket;

declare global {
  interface Window {
    io?: IoFactory;
  }
}

const loadClientLibrary = () =>
  new Promise<IoFactory>((resolve, reject) => {
    if (window.io) return resolve(window.io);
    const script = document.createElement("script");
    script.src = `${SERVER_URL}/socket.io/socket.io.min.js`;
    script.onload = () => (window.io ? resolve(window.io) : reject(new Error("Socket.IO client missing")));
    script.onerror = () => reject(new Error("Could not load the Socket.IO client"));
    document.head.append(script);
  });

interface ConnectOptions {
  onStatus: (status: ConnectionStatus) => void;
  // The token can't be used and refreshing failed
  onAuthFailed: (reason: string) => void;
}

export const connectSocket = async ({ onStatus, onAuthFailed }: ConnectOptions): Promise<ChatSocket> => {
  const io = await loadClientLibrary();

  const socket = io(SERVER_URL || undefined, {
    // A function, so every (re)connection sends the newest token
    auth: (cb) => cb({ token: getAccessToken() }),
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });

  onStatus("connecting");

  // Gets a new access token and reconnects with it
  const renew = async () => {
    try {
      await refreshTokens();
      socket.connect();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onAuthFailed("Your session expired. Please sign in again.");
      else setTimeout(renew, 3000); // server unreachable: keep trying
    }
  };

  socket.on("connect", () => onStatus("connected"));

  socket.on("disconnect", (reason) => {
    // "io server disconnect" means the server closed it on purpose (token
    // expired, logout): Socket.IO won't retry by itself in that case
    onStatus(reason === "io client disconnect" ? "offline" : "reconnecting");
  });

  socket.on("connect_error", (err) => {
    const code = (err as Error & { data?: { code?: AuthErrorCode } }).data?.code;
    if (code === "TOKEN_EXPIRED") return void renew();
    if (code === "TOKEN_INVALID" || code === "TOKEN_REQUIRED") {
      return onAuthFailed("Please sign in again.");
    }
    // Network problem: Socket.IO keeps retrying with backoff
    onStatus(socket.active ? "reconnecting" : "offline");
  });

  socket.on("auth:expired", () => void renew());
  socket.on("session:ended", () => onAuthFailed("You were signed out."));

  // Phones pause background tabs; reconnect as soon as the user is back
  window.addEventListener("online", () => {
    if (!socket.connected) socket.connect();
  });

  return socket;
};
