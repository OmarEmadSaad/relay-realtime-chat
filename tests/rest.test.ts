import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, PASSWORD } from "./helpers.ts";
import type { TestContext } from "./helpers.ts";
import type { ConversationMember, MessageDTO } from "../shared/types.d.ts";

// A contact as the API returns it; email/phone must NOT be there
type Contact = ConversationMember & { email?: unknown; phoneNumber?: unknown };

describe("REST API (existing auth + users, new chat endpoints)", () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await startServer();
  });
  after(() => ctx.stop());

  it("registers, logs in, refreshes and logs out", async () => {
    const email = `new${Date.now()}@test.example.com`;
    const reg = await ctx.api("POST", "/auth/register", {
      body: { firstName: "New", lastName: "Person", email, phoneNumber: "+201011112222", password: PASSWORD, role: "admin" },
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.data.user.role, "user"); // role from the body is ignored
    assert.equal(reg.body.data.user.password, undefined);

    const bad = await ctx.api("POST", "/auth/login", { body: { email, password: "wrong-password" } });
    assert.equal(bad.status, 401);

    const login = await ctx.api("POST", "/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(login.status, 200);

    const refreshed = await ctx.api("POST", "/auth/refresh", { body: { refreshToken: login.body.data.refreshToken } });
    assert.equal(refreshed.status, 200);
    // Rotation: the old refresh token no longer works
    const reused = await ctx.api("POST", "/auth/refresh", { body: { refreshToken: login.body.data.refreshToken } });
    assert.equal(reused.status, 401);

    const out = await ctx.api("POST", "/auth/logout", { token: refreshed.body.data.accessToken });
    assert.equal(out.status, 200);
  });

  it("requires a token on protected routes", async () => {
    assert.equal((await ctx.api("GET", "/conversations")).status, 401);
    assert.equal((await ctx.api("GET", "/users/me", { token: "garbage" })).status, 401);
  });

  it("returns the current user and public contacts without private fields", async () => {
    const me = await ctx.createUser();
    await ctx.createUser();
    const profile = await ctx.api("GET", "/users/me", { token: me.token });
    assert.equal(profile.body.data.user.email, me.email);

    const contacts = await ctx.api("GET", "/users/contacts", { token: me.token });
    assert.equal(contacts.status, 200);
    const users = contacts.body.data.users;
    assert.ok(users.length >= 1);
    assert.ok(users.every((u: Contact) => u.email === undefined && u.phoneNumber === undefined && u.id !== me.id));
    assert.ok(users.every((u: Contact) => typeof u.online === "boolean"));
  });

  it("keeps user administration for real admins and managers only", async () => {
    const user = await ctx.createUser();
    const admin = await ctx.createUser({ role: "admin" });
    const demoAdmin = await ctx.createUser({ role: "admin", isDemo: true });

    assert.equal((await ctx.api("GET", "/users", { token: user.token })).status, 403);
    assert.equal((await ctx.api("GET", "/users", { token: admin.token })).status, 200);

    // The public demo admin can chat but not administer users
    assert.equal((await ctx.api("GET", "/users", { token: demoAdmin.token })).status, 403);
    const del = await ctx.api("DELETE", `/users/${user.id}`, { token: demoAdmin.token });
    assert.equal(del.status, 403);
    const promote = await ctx.api("PATCH", `/users/${demoAdmin.id}`, { token: demoAdmin.token, body: { role: "manager" } });
    assert.equal(promote.status, 403);
  });

  it("validates conversation input", async () => {
    const me = await ctx.createUser();
    const other = await ctx.createUser();
    const self = await ctx.api("POST", "/conversations", { token: me.token, body: { type: "direct", userId: me.id } });
    assert.equal(self.status, 400);
    const badType = await ctx.api("POST", "/conversations", { token: me.token, body: { type: "channel" } });
    assert.equal(badType.status, 400);
    const tinyGroup = await ctx.api("POST", "/conversations", {
      token: me.token,
      body: { type: "group", name: "Two", memberIds: [other.id] },
    });
    assert.equal(tinyGroup.status, 400);
    const badId = await ctx.api("GET", "/conversations/not-an-id", { token: me.token });
    assert.equal(badId.status, 400);
  });

  it("sends a message over REST and broadcasts it", async () => {
    const me = await ctx.createUser();
    const other = await ctx.createUser();
    const conv = await ctx.api("POST", "/conversations", { token: me.token, body: { type: "direct", userId: other.id } });
    const id = conv.body.data.conversation.id;
    const otherSocket = await ctx.connect(other.token);
    const received = new Promise<MessageDTO>((resolve) => otherSocket.once("message:new", resolve));
    const sent = await ctx.api("POST", `/conversations/${id}/messages`, { token: me.token, body: { text: "from REST" } });
    assert.equal(sent.status, 201);
    assert.equal((await received).text, "from REST");
  });

  it("serves the chat client with security headers", async () => {
    const res = await fetch(`${ctx.url}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    assert.match(await res.text(), /<title>/);
  });
});
