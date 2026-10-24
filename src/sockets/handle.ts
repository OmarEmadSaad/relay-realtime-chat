import mongoose from "mongoose";
import type { Ack, ClientToServerEvents, ErrorCode, SocketError } from "../../shared/types.d.ts";
import { AppError } from "../utils/appError.ts";
import type { AppSocket } from "./types.ts";

// Error codes sent to the client, from the HTTP status the services use
const CODES: Record<number, ErrorCode> = {
  400: "VALIDATION_ERROR",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
};

export const toSocketError = (err: unknown): SocketError => {
  if (err instanceof AppError) {
    return { code: CODES[err.statusCode] ?? "ERROR", message: err.message };
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return { code: "VALIDATION_ERROR", message: Object.values(err.errors).map((e) => e.message).join(", ") };
  }
  console.error("Socket handler error:", err);
  return { code: "INTERNAL_ERROR", message: "Something went wrong, please try again" };
};

// The success result an event's acknowledgement carries (without `ok`),
// read from the shared ClientToServerEvents contract
type AckCallback<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[1];
type AckResult<E extends keyof ClientToServerEvents> =
  AckCallback<E> extends (res: infer R) => void ? Omit<Extract<R, { ok: true }>, "ok"> : never;

// Payloads come from the client, so handlers get unknown values to validate
export type Payload = Record<string, unknown>;

// Wraps an event handler so that every event:
//  - gets a plain-object payload (anything else is rejected),
//  - answers through the acknowledgement callback when the client sent one:
//      { ok: true, ...result }  or  { ok: false, error: { code, message } }
//  - without a callback, reports failures as `errorEvent` (e.g. "message:error").
// The type parameter ties the handler's result to the event's ack type.
//
//   socket.on("message:send", handle<"message:send">(socket, sendHandler, { errorEvent: "message:error" }))
export const handle =
  <E extends keyof ClientToServerEvents>(
    socket: AppSocket,
    handler: (payload: Payload) => Promise<AckResult<E>>,
    { errorEvent }: { errorEvent?: "message:error" } = {},
  ) =>
  async (payload: unknown, ack?: unknown) => {
    const reply = typeof ack === "function" ? (ack as (res: Ack) => void) : null;
    try {
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        throw new AppError("Payload must be an object", 400);
      }
      const result = await handler(payload as Payload);
      reply?.({ ok: true, ...result });
    } catch (err) {
      const error = toSocketError(err);
      if (reply) {
        reply({ ok: false, error });
      } else if (errorEvent) {
        const clientId = (payload as Payload | null)?.clientId;
        socket.emit(errorEvent, { ...error, clientId: typeof clientId === "string" ? clientId : null });
      }
    }
  };
