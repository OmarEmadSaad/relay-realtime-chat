# Socket.IO event reference

Server: [src/sockets/](../src/sockets/) · Client: [client/src/socket.ts](../client/src/socket.ts) and [client/src/app.ts](../client/src/app.ts)

Every event below is also a TypeScript type in [shared/types.d.ts](../shared/types.d.ts) (`ClientToServerEvents`, `ServerToClientEvents`). Both the server (`Server<…>`) and the client (`Socket<…>`) are typed with it, so the two sides can't drift apart without a compile error.

## Connecting

```js
const socket = io("http://localhost:3000", {
  auth: (cb) => cb({ token: accessToken }), // a function, so reconnects send the newest token
});
```

The handshake is checked by [`authenticate`](../src/sockets/middleware.ts) before the `connection` event:

1. The access token is read from `handshake.auth.token` (or an `Authorization: Bearer` header, for tools like Postman). A token in the query string is ignored, because URLs end up in logs.
2. It is verified with `JWT_SECRET`. A refresh token is rejected, because it is signed with a different secret.
3. The user is loaded from MongoDB, so a deleted account can't connect with an old token.
4. The identity is stored in `socket.data.user`. **Every handler takes the user id from there, never from a payload.**

A rejected connection fires `connect_error` on the client with `err.data.code`:

| Code | Meaning | What the client does |
| --- | --- | --- |
| `TOKEN_REQUIRED` | No token sent | Show the login screen |
| `TOKEN_INVALID` | Bad signature, wrong token type, or deleted user | Show the login screen |
| `TOKEN_EXPIRED` | Access token expired | `POST /api/auth/refresh`, then `socket.connect()` |

The access token expires (10 minutes by default) while the socket is open. The server sets a timer for the token's `exp`; when it fires the server emits `auth:expired` and disconnects. The client refreshes and reconnects.

## Rooms

| Room | Who is in it | Used for |
| --- | --- | --- |
| `user:<userId>` | Every socket of that user (all tabs and devices), joined on connect | `message:new`, `message:read`, `conversation:*`, `session:ended` |
| `conversation:<id>` | Sockets that currently have that conversation **open**, joined via `conversation:join` after a membership check | `typing:start`, `typing:stop` |

Messages are sent to the members' **user** rooms, using the member list read from MongoDB at send time. So:

- the sidebar of every member updates, even for conversations that aren't open;
- someone removed from a group stops receiving it at once, with no stale room membership to clean up;
- a client can't receive a conversation by "joining" its room. `conversation:join` checks membership first, and that room only carries typing events.

## Acknowledgements

Events marked **ack** take a callback as the last argument. Every acknowledgement has the same shape:

```js
{ ok: true, ...result }
{ ok: false, error: { code, message } } // VALIDATION_ERROR | NOT_FOUND | FORBIDDEN | CONFLICT | RATE_LIMITED | INTERNAL_ERROR
```

`NOT_FOUND` is returned both for a conversation that doesn't exist and for one you aren't a member of, so outsiders can't probe for ids. Payloads must be plain objects; anything else gets `VALIDATION_ERROR`.

## Client → server

| Event | Payload | Ack result | Notes |
| --- | --- | --- | --- |
| `conversation:join` | `{ conversationId }` | `{ conversationId }` | Checks membership, leaves the previously open conversation's room, joins this one |
| `conversation:leave` | `{}` | `{}` | Leaves the open conversation's room (and stops typing there) |
| `message:send` | `{ conversationId, text, clientId }` | `{ message, duplicate }` | Text: 1-2000 characters after trimming; control characters removed. `clientId`: 8-64 characters `[A-Za-z0-9_-]`, unique per message. Rate limit: 15 per 10 s per user. Without an ack callback, errors arrive as `message:error` |
| `message:read` | `{ conversationId }` | `{ readAt }` | Marks everything up to now as read |
| `typing:start` | `{ conversationId }` | none | Only works for the conversation this socket joined. Excess events are dropped (30 per 10 s) |
| `typing:stop` | `{ conversationId }` | none | Also sent automatically when you send a message, leave the conversation or disconnect |

Fields such as `sender`, `senderId`, `userId` or `role` in a payload are ignored.

## Server → client

| Event | Payload | Sent to |
| --- | --- | --- |
| `message:new` | `Message` (below) | All members' user rooms, including the sender's other tabs |
| `message:error` | `{ code, message, clientId }` | The sending socket, when `message:send` had no ack callback |
| `message:read` | `{ conversationId, userId, readAt }` | All members. The reader's other tabs clear their badge; the others can show "Seen" |
| `typing:start` | `{ conversationId, user: { id, firstName, lastName } }` | The conversation room, except the sender |
| `typing:stop` | `{ conversationId, userId }` | The conversation room, except the sender |
| `presence:snapshot` | `{ onlineUserIds: string[] }` | The socket that just connected |
| `presence:update` | `{ userId, online, lastSeenAt }` | Everyone, when a user's **first** socket connects or **last** socket disconnects |
| `conversation:new` | `Conversation` | Group members on creation; the creator's own tabs for a new direct chat |
| `conversation:updated` | `Conversation` | Remaining members, when someone leaves a group |
| `conversation:removed` | `{ conversationId }` | The user who left |
| `auth:expired` | none | A socket whose access token just expired (it is then disconnected) |
| `session:ended` | `{ reason }` | Every socket of a user who logged out or was deleted (then disconnected) |

Built-in events used: `connection`, `disconnecting` (sends a final `typing:stop` while rooms are still known), `disconnect` (presence and `lastSeenAt`), and client-side `connect` / `connect_error` / `disconnect`.

### Shapes

```ts
type Message = {
  id: string;
  conversationId: string;
  sender: { id, firstName, lastName, avatar, role, lastSeenAt } | null; // null = deleted account
  text: string;
  clientId: string | null;
  createdAt: string; // ISO date
};

type Conversation = {
  id: string;
  type: "direct" | "group";
  name: string | null; // groups only
  createdBy: string;
  members: { id, firstName, lastName, avatar, role, lastSeenAt, online, lastReadAt }[];
  lastMessage: { text, sender, createdAt } | null;
  lastMessageAt: string;
  unreadCount: number; // for the user receiving it
};
```

## Presence

[`presence.service.ts`](../src/services/presence.service.ts) keeps `userId → Set<socketId>`. A user is online while that set has at least one socket, so a second tab doesn't announce anything new, and closing one of two tabs doesn't mark you offline. When the last socket disconnects, `lastSeenAt` is saved to the user and broadcast.

## Reliability

- **No duplicates on retry:** the client creates a `clientId` per message. A unique index on `(sender, clientId)` means a retry after a lost ack returns the original message (`duplicate: true`) and isn't broadcast twice. The client also merges by `id` and `clientId`.
- **Reconnects:** Socket.IO retries with backoff. On every `connect` the client rejoins the open conversation and fetches what it missed: the conversation list (with unread counts) and the newest page of the open conversation, merged by id.
- **Sending while offline:** the message shows as "sending". Socket.IO buffers the emit until the connection is back; if there is no ack within 10 s it is marked "Not sent" with **Retry** (same `clientId`) and **Delete**.
- **No duplicate listeners:** listeners are registered once per socket, when it is created. Switching conversations only emits `conversation:join` / `conversation:leave`.
