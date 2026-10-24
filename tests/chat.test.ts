import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, emitAck, waitFor, expectSilence, clientId, presenceSnapshot } from "./helpers.ts";
import type { TestContext } from "./helpers.ts";
import type { ConversationDTO, MessageDTO } from "../shared/types.d.ts";

import { Message } from "../src/models/message.model.ts";

describe("Real-time chat", () => {
  let ctx: TestContext;
  before(async () => {
    ctx = await startServer();
  });
  after(() => ctx.stop());

  // Two users with a direct conversation between them
  const pair = async () => {
    const alice = await ctx.createUser({ firstName: "Alice" });
    const bob = await ctx.createUser({ firstName: "Bob" });
    const res = await ctx.api("POST", "/conversations", {
      token: alice.token,
      body: { type: "direct", userId: bob.id },
    });
    assert.equal(res.status, 201);
    return { alice, bob, conversationId: res.body.data.conversation.id };
  };

  it("delivers a message to the other user in real time and persists it", async () => {
    const { alice, bob, conversationId } = await pair();
    const aliceSocket = await ctx.connect(alice.token);
    const bobSocket = await ctx.connect(bob.token);

    const received = waitFor(bobSocket, "message:new");
    const ack = await emitAck(aliceSocket, "message:send", { conversationId, text: "Hi Bob!", clientId: clientId() });
    assert.equal(ack.ok, true);
    assert.equal(ack.duplicate, false);

    const message = await received;
    assert.equal(message.text, "Hi Bob!");
    assert.equal(message.sender?.id, alice.id);
    assert.equal(message.sender?.firstName, "Alice");
    assert.equal(message.conversationId, conversationId);

    // Reply the other way
    const reply = waitFor(aliceSocket, "message:new", { filter: (m) => m.sender?.id === bob.id });
    await emitAck(bobSocket, "message:send", { conversationId, text: "Hey Alice", clientId: clientId() });
    assert.equal((await reply).text, "Hey Alice");

    // Still there after disconnecting and coming back
    aliceSocket.disconnect();
    bobSocket.disconnect();
    const again = await ctx.connect(bob.token);
    const history = await ctx.api("GET", `/conversations/${conversationId}/messages`, { token: bob.token });
    assert.deepEqual(
      history.body.data.messages.map((m: MessageDTO) => m.text),
      ["Hi Bob!", "Hey Alice"],
    );
    again.disconnect();
  });

  it("ignores a spoofed sender in the payload", async () => {
    const { alice, bob, conversationId } = await pair();
    const aliceSocket = await ctx.connect(alice.token);
    const ack = await emitAck(aliceSocket, "message:send", {
      conversationId,
      text: "I am definitely Bob",
      sender: bob.id,
      senderId: bob.id,
      clientId: clientId(),
    });
    assert.equal(ack.ok, true);
    assert.equal(ack.message?.sender?.id, alice.id);
    const stored = await Message.findById(ack.message?.id);
    assert.equal(String(stored?.sender), alice.id);
  });

  it("stops outsiders from joining, sending to, reading or receiving a private conversation", async () => {
    const { alice, conversationId } = await pair();
    const mallory = await ctx.createUser({ firstName: "Mallory" });
    const mallorySocket = await ctx.connect(mallory.token);
    const aliceSocket = await ctx.connect(alice.token);

    const join = await emitAck(mallorySocket, "conversation:join", { conversationId });
    assert.equal(join.ok, false);
    assert.equal(join.error?.code, "NOT_FOUND");

    const send = await emitAck(mallorySocket, "message:send", { conversationId, text: "let me in", clientId: clientId() });
    assert.equal(send.ok, false);
    assert.equal(send.error?.code, "NOT_FOUND");

    const read = await emitAck(mallorySocket, "message:read", { conversationId });
    assert.equal(read.ok, false);

    const history = await ctx.api("GET", `/conversations/${conversationId}/messages`, { token: mallory.token });
    assert.equal(history.status, 404);
    const restSend = await ctx.api("POST", `/conversations/${conversationId}/messages`, {
      token: mallory.token,
      body: { text: "hi" },
    });
    assert.equal(restSend.status, 404);

    // A real message between the members never reaches the outsider
    const silence = expectSilence(mallorySocket, "message:new");
    await emitAck(aliceSocket, "message:send", { conversationId, text: "private", clientId: clientId() });
    assert.equal(await silence, true);

    // Typing without having joined is ignored
    await emitAck(aliceSocket, "conversation:join", { conversationId });
    const noTyping = expectSilence(aliceSocket, "typing:start");
    mallorySocket.emit("typing:start", { conversationId });
    await noTyping;
  });

  it("reports send errors through message:error when there is no acknowledgement", async () => {
    const { alice, conversationId } = await pair();
    const socket = await ctx.connect(alice.token);
    const id = clientId();
    const error = waitFor(socket, "message:error");
    socket.emit("message:send", { conversationId, text: "   ", clientId: id });
    const payload = await error;
    assert.equal(payload.code, "VALIDATION_ERROR");
    assert.equal(payload.clientId, id);
  });

  it("validates payloads and message length", async () => {
    const { alice, conversationId } = await pair();
    const socket = await ctx.connect(alice.token);

    const notObject = await emitAck(socket, "message:send", "hello");
    assert.equal(notObject.error?.code, "VALIDATION_ERROR");

    const tooLong = await emitAck(socket, "message:send", { conversationId, text: "x".repeat(2001), clientId: clientId() });
    assert.equal(tooLong.error?.code, "VALIDATION_ERROR");

    const badId = await emitAck(socket, "message:send", { conversationId: { $ne: null }, text: "hi", clientId: clientId() });
    assert.equal(badId.error?.code, "VALIDATION_ERROR");

    // Control characters are removed; HTML is stored as plain text
    const ok = await emitAck(socket, "message:send", { conversationId, text: " <b>hi</b>\u0007 ", clientId: clientId() });
    assert.equal(ok.message?.text, "<b>hi</b>");
  });

  it("does not store a retried message twice", async () => {
    const { alice, bob, conversationId } = await pair();
    const aliceSocket = await ctx.connect(alice.token);
    const bobSocket = await ctx.connect(bob.token);
    const id = clientId();

    const first = await emitAck(aliceSocket, "message:send", { conversationId, text: "once", clientId: id });
    const second = await emitAck(aliceSocket, "message:send", { conversationId, text: "once", clientId: id });
    assert.equal(second.duplicate, true);
    assert.equal(second.message?.id, first.message?.id);
    assert.equal(await Message.countDocuments({ conversation: conversationId }), 1);
    // The retry is not broadcast again
    await expectSilence(bobSocket, "message:new");
  });

  it("rate limits fast senders", async () => {
    const { alice, conversationId } = await pair();
    const socket = await ctx.connect(alice.token);
    const results = [];
    for (let i = 0; i < 16; i += 1) {
      results.push(await emitAck(socket, "message:send", { conversationId, text: `spam ${i}`, clientId: clientId() }));
    }
    assert.equal(results.slice(0, 15).every((r) => r.ok), true);
    assert.equal(results[15].error?.code, "RATE_LIMITED");
  });

  it("sends typing indicators only to members viewing the conversation", async () => {
    const { alice, bob, conversationId } = await pair();
    const aliceSocket = await ctx.connect(alice.token);
    const bobSocket = await ctx.connect(bob.token);

    // Bob hasn't opened the conversation yet: nothing arrives
    const notYet = expectSilence(bobSocket, "typing:start");
    await emitAck(aliceSocket, "conversation:join", { conversationId });
    aliceSocket.emit("typing:start", { conversationId });
    await notYet;

    assert.equal((await emitAck(bobSocket, "conversation:join", { conversationId })).ok, true);
    const typing = waitFor(bobSocket, "typing:start");
    aliceSocket.emit("typing:start", { conversationId, user: { id: bob.id } });
    const event = await typing;
    assert.equal(event.user.id, alice.id); // from the token, not the payload
    assert.equal(event.conversationId, conversationId);

    const stopped = waitFor(bobSocket, "typing:stop");
    aliceSocket.emit("typing:stop", { conversationId });
    assert.equal((await stopped).userId, alice.id);

    // Closing the tab while typing also clears it
    aliceSocket.emit("typing:start", { conversationId });
    await waitFor(bobSocket, "typing:start");
    const cleared = waitFor(bobSocket, "typing:stop");
    aliceSocket.disconnect();
    assert.equal((await cleared).userId, alice.id);
  });

  it("keeps a user online until their last tab disconnects", async () => {
    const watcher = await ctx.createUser();
    const multi = await ctx.createUser();
    const watcherSocket = await ctx.connect(watcher.token);

    const online = waitFor(watcherSocket, "presence:update", { filter: (p) => p.userId === multi.id });
    const tab1 = await ctx.connect(multi.token);
    assert.equal((await online).online, true);

    // A second tab doesn't announce anything new
    const noDuplicate = expectSilence(watcherSocket, "presence:update");
    const tab2 = await ctx.connect(multi.token);
    await noDuplicate;

    // Closing one of two tabs: still online
    const stillOnline = expectSilence(watcherSocket, "presence:update");
    tab1.disconnect();
    await stillOnline;

    const offline = waitFor(watcherSocket, "presence:update", { filter: (p) => p.userId === multi.id });
    tab2.disconnect();
    const update = await offline;
    assert.equal(update.online, false);
    assert.ok(update.lastSeenAt);

    // A fresh connection gets the current list
    const another = await ctx.createUser();
    const socket = await ctx.connect(another.token);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const snapshot = presenceSnapshot(socket)!;
    assert.ok(snapshot.onlineUserIds.includes(another.id));
    assert.ok(snapshot.onlineUserIds.includes(watcher.id));
    assert.ok(!snapshot.onlineUserIds.includes(multi.id));
    socket.disconnect();
  });

  it("tracks unread counts and read receipts", async () => {
    const { alice, bob, conversationId } = await pair();
    const aliceSocket = await ctx.connect(alice.token);
    const bobSocket = await ctx.connect(bob.token);
    const bobTab2 = await ctx.connect(bob.token);

    for (const text of ["one", "two", "three"]) {
      await emitAck(aliceSocket, "message:send", { conversationId, text, clientId: clientId() });
    }
    let list = await ctx.api("GET", "/conversations", { token: bob.token });
    assert.equal(list.body.data.conversations.find((c: ConversationDTO) => c.id === conversationId).unreadCount, 3);
    // The sender has no unread messages in their own conversation
    list = await ctx.api("GET", "/conversations", { token: alice.token });
    assert.equal(list.body.data.conversations.find((c: ConversationDTO) => c.id === conversationId).unreadCount, 0);

    const receipt = waitFor(aliceSocket, "message:read");
    const otherTab = waitFor(bobTab2, "message:read");
    assert.equal((await emitAck(bobSocket, "message:read", { conversationId })).ok, true);
    assert.equal((await receipt).userId, bob.id);
    assert.equal((await otherTab).conversationId, conversationId);

    list = await ctx.api("GET", "/conversations", { token: bob.token });
    assert.equal(list.body.data.conversations.find((c: ConversationDTO) => c.id === conversationId).unreadCount, 0);
  });

  it("notifies members about new groups and lets members leave", async () => {
    const owner = await ctx.createUser();
    const m1 = await ctx.createUser();
    const m2 = await ctx.createUser();
    const m1Socket = await ctx.connect(m1.token);
    const created = waitFor(m1Socket, "conversation:new");
    const res = await ctx.api("POST", "/conversations", {
      token: owner.token,
      body: { type: "group", name: "Team", memberIds: [m1.id, m2.id] },
    });
    assert.equal(res.status, 201);
    const group = await created;
    assert.equal(group.name, "Team");
    assert.equal(group.members.length, 3);

    await emitAck(m1Socket, "conversation:join", { conversationId: group.id });
    const removed = waitFor(m1Socket, "conversation:removed");
    assert.equal((await ctx.api("POST", `/conversations/${group.id}/leave`, { token: m1.token })).status, 200);
    await removed;
    // No longer a member: can't send or rejoin
    const send = await emitAck(m1Socket, "message:send", { conversationId: group.id, text: "hi", clientId: clientId() });
    assert.equal(send.error?.code, "NOT_FOUND");
  });

  it("returns the same direct conversation when opened twice", async () => {
    const { alice, bob, conversationId } = await pair();
    const again = await ctx.api("POST", "/conversations", { token: bob.token, body: { type: "direct", userId: alice.id } });
    assert.equal(again.status, 200);
    assert.equal(again.body.data.conversation.id, conversationId);
  });

  it("pages through history with the before cursor", async () => {
    const { alice, conversationId } = await pair();
    const base = Date.now() - 100_000;
    await Message.insertMany(
      Array.from({ length: 45 }, (_, i) => ({
        conversation: conversationId,
        sender: alice.id,
        text: `m${i}`,
        createdAt: new Date(base + i * 1000),
      })),
      { timestamps: false },
    );
    const page1 = await ctx.api("GET", `/conversations/${conversationId}/messages?limit=30`, { token: alice.token });
    assert.equal(page1.body.data.messages.length, 30);
    assert.equal(page1.body.data.hasMore, true);
    assert.equal(page1.body.data.messages.at(-1).text, "m44");

    const before = page1.body.data.messages[0].id;
    const page2 = await ctx.api("GET", `/conversations/${conversationId}/messages?limit=30&before=${before}`, {
      token: alice.token,
    });
    assert.equal(page2.body.data.messages.length, 15);
    assert.equal(page2.body.data.hasMore, false);
    assert.equal(page2.body.data.messages[0].text, "m0");
  });

  it("searches only the user's own conversations", async () => {
    const { alice, bob, conversationId } = await pair();
    const socket = await ctx.connect(alice.token);
    await emitAck(socket, "message:send", { conversationId, text: "the secret pineapple plan", clientId: clientId() });
    const outsider = await ctx.createUser();

    const found = await ctx.api("GET", "/messages/search?q=pineapple", { token: bob.token });
    assert.equal(found.body.data.messages.length, 1);
    const notFound = await ctx.api("GET", "/messages/search?q=pineapple", { token: outsider.token });
    assert.equal(notFound.body.data.messages.length, 0);
    // Regex characters are treated as text
    const regex = await ctx.api("GET", "/messages/search?q=.*", { token: bob.token });
    assert.equal(regex.body.data.messages.length, 0);
  });
});
