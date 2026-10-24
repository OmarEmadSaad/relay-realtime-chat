import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startServer, waitFor } from "./helpers.ts";
import type { TestContext } from "./helpers.ts";

// The handshake error code from a connect_error
const codeOf = (err: unknown) => (err as { data?: { code?: string } }).data?.code;

describe("Socket.IO authentication", () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await startServer();
  });
  after(() => ctx.stop());

  it("accepts a valid access token", async () => {
    const user = await ctx.createUser();
    const socket = await ctx.connect(user.token);
    assert.equal(socket.connected, true);
    socket.disconnect();
  });

  it("accepts the token in an Authorization header (for tools like Postman)", async () => {
    const user = await ctx.createUser();
    const socket = await ctx.connect(null, { auth: {}, extraHeaders: { Authorization: `Bearer ${user.token}` } });
    assert.equal(socket.connected, true);
    socket.disconnect();
  });

  it("ignores a token in the query string", async () => {
    const user = await ctx.createUser();
    const { io } = await import("socket.io-client");
    const socket = io(ctx.url, { query: { token: user.token }, transports: ["websocket"], reconnection: false, forceNew: true });
    const err = await new Promise((resolve) => socket.once("connect_error", resolve));
    assert.equal(codeOf(err), "TOKEN_REQUIRED");
    socket.close();
  });

  it("rejects a connection without a token", async () => {
    await assert.rejects(ctx.connect(null, { auth: {} }), (err) => codeOf(err) === "TOKEN_REQUIRED");
  });

  it("rejects a token signed with another secret", async () => {
    const forged = jwt.sign({ id: "6aca564d6ff73ef600f6bae9", role: "manager" }, "not-the-secret");
    await assert.rejects(ctx.connect(forged), (err) => codeOf(err) === "TOKEN_INVALID");
  });

  it("rejects a refresh token used as an access token", async () => {
    const user = await ctx.createUser();
    await assert.rejects(ctx.connect(user.refreshToken), (err) => codeOf(err) === "TOKEN_INVALID");
  });

  it("rejects an expired token with TOKEN_EXPIRED", async () => {
    const user = await ctx.createUser();
    const expired = jwt.sign(
      { id: user.id, exp: Math.floor(Date.now() / 1000) - 10 },
      process.env.JWT_SECRET!,
    );
    await assert.rejects(ctx.connect(expired), (err) => codeOf(err) === "TOKEN_EXPIRED");
  });

  it("rejects a valid token whose user was deleted", async () => {
    const admin = await ctx.createUser({ role: "admin" });
    const victim = await ctx.createUser();
    const res = await ctx.api("DELETE", `/users/${victim.id}`, { token: admin.token });
    assert.equal(res.status, 200);
    await assert.rejects(ctx.connect(victim.token), (err) => codeOf(err) === "TOKEN_INVALID");
  });

  it("disconnects the socket with auth:expired when the token expires", async () => {
    const user = await ctx.createUser();
    const shortLived = jwt.sign({ id: user.id }, process.env.JWT_SECRET!, { expiresIn: "2s" });
    const socket = await ctx.connect(shortLived);
    const expired = waitFor(socket, "auth:expired", { timeout: 4000 });
    const disconnected = waitFor(socket, "disconnect", { timeout: 4000 });
    await expired;
    assert.equal(await disconnected, "io server disconnect");
  });

  it("disconnects all of a user's sockets on logout", async () => {
    const user = await ctx.createUser();
    const tab1 = await ctx.connect(user.token);
    const tab2 = await ctx.connect(user.token);
    const ended = waitFor(tab2, "session:ended");
    const gone = Promise.all([waitFor(tab1, "disconnect"), waitFor(tab2, "disconnect")]);
    const res = await ctx.api("POST", "/auth/logout", { token: user.token });
    assert.equal(res.status, 200);
    assert.deepEqual(await ended, { reason: "logout" });
    await gone;
  });
});
