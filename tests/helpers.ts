// Shared test setup: an in-memory MongoDB, the real Express app and the real
// Socket.IO server on a random port. Nothing touches the database in .env.
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { io as connectClient } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type { MessageDTO, Role, ServerToClientEvents, SocketError } from "../shared/types.d.ts";

process.env.JWT_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.JWT_EXPIRES_IN = "10m";
process.env.AUTH_RATE_LIMIT_MAX = "1000";

const { createApp } = await import("../src/app.ts");
const { initSocket } = await import("../src/sockets/index.ts");
const { User } = await import("../src/models/user.model.ts");
const { resetPresence } = await import("../src/services/presence.service.ts");

export const PASSWORD = "Password123!";

// Listens with the real event types, but emits untyped on purpose: the tests
// play a client that may send anything (wrong types, spoofed fields...)
type AnyEvents = { [event: string]: (...args: any[]) => void };
export type TestSocket = Socket<ServerToClientEvents, AnyEvents>;

// Acknowledgements, read loosely so tests can assert on either outcome
export interface TestAck {
  ok: boolean;
  error?: SocketError;
  message?: MessageDTO;
  duplicate?: boolean;
  readAt?: string;
  conversationId?: string;
}

// The JSend body of a REST response. `data` differs per endpoint, and the
// tests read it like a client would, so it stays untyped here.
export interface ApiBody {
  status: string;
  message?: string;
  data?: any;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  refreshToken: string;
}

// presence:snapshot arrives right on connect, before a test could listen
const snapshots = new WeakMap<TestSocket, { onlineUserIds: string[] }>();
export const presenceSnapshot = (socket: TestSocket) => snapshots.get(socket);

export const startServer = async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: "chat-test" });
  await mongoose.connection.syncIndexes();

  const server = http.createServer(createApp());
  const io = initSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const sockets = new Set<TestSocket>();

  const ctx = {
    url,
    io,

    // JSON request to the API; returns { status, body }
    async api(method: string, path: string, { token, body }: { token?: string; body?: unknown } = {}) {
      const res = await fetch(`${url}/api${path}`, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: (await res.json()) as ApiBody };
    },

    // A new user, logged in through the real /api/auth/login
    async createUser({
      role = "user",
      isDemo = false,
      firstName = "Test",
    }: { role?: Role; isDemo?: boolean; firstName?: string } = {}): Promise<TestUser> {
      const n = crypto.randomInt(1e9);
      const email = `user${n}@test.example.com`;
      await User.create({
        firstName,
        lastName: "User",
        email,
        phoneNumber: `+2010${String(n).padStart(8, "0").slice(0, 8)}`,
        password: PASSWORD,
        role,
        isDemo,
      });
      const { body } = await ctx.api("POST", "/auth/login", { body: { email, password: PASSWORD } });
      return { id: body.data.user._id, email, token: body.data.accessToken, refreshToken: body.data.refreshToken };
    },

    // Resolves with a connected socket, or rejects with the connect_error
    connect(
      token: string | null,
      { auth, extraHeaders }: { auth?: Record<string, unknown>; extraHeaders?: Record<string, string> } = {},
    ): Promise<TestSocket> {
      const socket: TestSocket = connectClient(url, {
        auth: auth ?? { token },
        extraHeaders,
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
      });
      sockets.add(socket);
      socket.once("presence:snapshot", (snapshot) => snapshots.set(socket, snapshot));
      return new Promise((resolve, reject) => {
        socket.once("connect", () => resolve(socket));
        socket.once("connect_error", (err) => reject(err));
      });
    },

    async stop() {
      for (const socket of sockets) socket.disconnect();
      io.close();
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      await mongo.stop();
      resetPresence();
    },
  };
  return ctx;
};

export type TestContext = Awaited<ReturnType<typeof startServer>>;

// Emits with an acknowledgement and resolves with the server's answer
export const emitAck = (socket: TestSocket, event: string, payload: unknown): Promise<TestAck> =>
  socket.timeout(5000).emitWithAck(event, payload);

// Server events plus the built-in disconnect
type Events = ServerToClientEvents & { disconnect: (reason: string) => void };
type EventPayload<E extends keyof Events> = Parameters<Events[E]>[0];

// The typed on/off overloads don't accept a generic event name
type Listener = (payload: unknown) => void;
const untyped = (socket: TestSocket) =>
  socket as unknown as { on(event: string, fn: Listener): void; off(event: string, fn: Listener): void };

// Resolves with the next `event` payload (optionally matching `filter`)
export const waitFor = <E extends keyof Events>(
  socket: TestSocket,
  event: E,
  { timeout = 3000, filter = () => true }: { timeout?: number; filter?: (payload: EventPayload<E>) => boolean } = {},
): Promise<EventPayload<E>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      untyped(socket).off(event, listener);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeout);
    const listener: Listener = (payload) => {
      if (!filter(payload as EventPayload<E>)) return;
      clearTimeout(timer);
      untyped(socket).off(event, listener);
      resolve(payload as EventPayload<E>);
    };
    untyped(socket).on(event, listener);
  });

// Resolves true if `event` does NOT arrive within `ms`
export const expectSilence = (socket: TestSocket, event: keyof Events, ms = 400) =>
  new Promise<true>((resolve, reject) => {
    const listener: Listener = (payload) => {
      clearTimeout(timer);
      untyped(socket).off(event, listener);
      reject(new Error(`Unexpected "${event}": ${JSON.stringify(payload)}`));
    };
    const timer = setTimeout(() => {
      untyped(socket).off(event, listener);
      resolve(true);
    }, ms);
    untyped(socket).on(event, listener);
  });

export const clientId = () => crypto.randomUUID();
