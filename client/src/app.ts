import type { ConversationDTO, MessageDTO, PublicUser, SessionUser } from "../../shared/types.d.ts";
import { $, toast, randomId, debounce } from "./dom.ts";
import { icon, applyIcons } from "./icons.ts";
import type { IconName } from "./icons.ts";
import { MAX_MESSAGE_LENGTH } from "./config.ts";
import { ApiError, api, restoreSession, onSessionEnded, logout } from "./api.ts";
import { connectSocket } from "./socket.ts";
import type { ChatSocket } from "./socket.ts";
import { state, resetState, myId, activeConversation, totalUnread } from "./store.ts";
import type { ChatMessage, MessagesEntry } from "./store.ts";
import { initAuth, showAuth } from "./views/auth.ts";
import { initSidebar, renderSidebar, renderMe, renderConnection, setFilter, setSearchResults } from "./views/sidebar.ts";
import { initChat, renderMessages, renderHeader, renderTyping, showChat, showJumpButton, isAtBottom } from "./views/chat.ts";
import { initDialogs, renderContacts, openNewChat, openMembers, showNewChatError } from "./views/dialogs.ts";

let socket: ChatSocket | null = null;
const drafts = new Map<string, string>(); // conversationId -> unsent text
const seenMessageIds = new Set<string>(); // so a message is never counted as unread twice

const ACK_TIMEOUT = 10_000;
const TYPING_EXPIRES = 6000; // drop someone's "typing" if no update arrives
const TYPING_IDLE = 2500; // stop announcing typing after this much silence
const TYPING_REFRESH = 3000; // re-announce while still typing

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");
const composer = () => $<HTMLTextAreaElement>("#composer-input");

// ---------- Rendering ----------

const updateTitle = () => {
  const unread = totalUnread();
  document.title = unread ? `(${unread}) Relay Chat` : "Relay Chat";
};

const renderAll = () => {
  renderSidebar();
  if (activeConversation()) {
    renderHeader();
    renderTyping();
  }
  updateTitle();
};

// ---------- Conversations ----------

const loadConversations = async ({ silent = false } = {}) => {
  if (!silent) {
    state.conversationsStatus = "loading";
    renderSidebar();
  }
  try {
    const { conversations } = await api<{ conversations: ConversationDTO[] }>("/conversations");
    const previous = state.conversations;
    state.conversations = new Map(conversations.map((c) => [c.id, c]));
    // The open conversation counts as read
    const active = state.activeId ? state.conversations.get(state.activeId) : undefined;
    if (active) {
      active.unreadCount = 0;
    } else if (state.activeId && previous.has(state.activeId)) {
      closeConversation(); // removed from it while away
    }
    state.conversationsStatus = "ready";
  } catch (err) {
    if (!silent) state.conversationsStatus = "error";
    if (silent) toast(errorMessage(err), { type: "error" });
  }
  renderAll();
};

const upsertConversation = (conversation: ConversationDTO) => {
  const existing = state.conversations.get(conversation.id);
  state.conversations.set(conversation.id, {
    ...conversation,
    unreadCount: existing ? existing.unreadCount : conversation.unreadCount,
  });
};

const setHash = (id: string | null) => history.replaceState(null, "", id ? `#${id}` : location.pathname);

const openConversation = (id: string) => {
  if (!state.conversations.has(id)) return;
  const previous = state.activeId;
  if (previous && previous !== id) {
    stopTyping();
    drafts.set(previous, composer().value);
  }
  state.activeId = id;
  setHash(id);
  showChat(true);
  $("#btn-jump").hidden = true;

  const input = composer();
  input.value = drafts.get(id) ?? "";
  onComposerInput({ silent: true });

  renderAll();
  if (state.messages.get(id)?.status === "ready") renderMessages("bottom");
  else void loadMessages(id);

  joinRoom(id);
  markRead(id);
  if (window.matchMedia("(min-width: 761px)").matches) input.focus();
};

const closeConversation = () => {
  if (!state.activeId) return;
  stopTyping();
  drafts.set(state.activeId, composer().value);
  socket?.emit("conversation:leave", {}, () => {});
  state.activeId = null;
  setHash(null);
  showChat(false);
  renderAll();
};

// Opening a conversation joins its room (for typing indicators). The server
// checks membership; a failure here means we're no longer a member.
const joinRoom = (id: string) => {
  if (!socket?.connected) return; // joined again on (re)connect
  socket.timeout(ACK_TIMEOUT).emit("conversation:join", { conversationId: id }, (err, res) => {
    if (err) return; // retried on the next reconnect
    if (!res.ok) toast(res.error.message, { type: "error" });
  });
};

// ---------- Messages ----------

const entryFor = (id: string): MessagesEntry => {
  let entry = state.messages.get(id);
  if (!entry) {
    entry = { items: [], hasMore: false, status: "loading" };
    state.messages.set(id, entry);
  }
  return entry;
};

const byTime = (a: ChatMessage, b: ChatMessage) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

interface MessagePage {
  messages: MessageDTO[];
  hasMore: boolean;
}

const loadMessages = async (id: string) => {
  const entry = entryFor(id);
  entry.status = "loading";
  if (state.activeId === id) renderMessages();
  try {
    const page = await api<MessagePage>(`/conversations/${id}/messages?limit=30`);
    page.messages.forEach((m) => seenMessageIds.add(m.id));
    // Keep messages that are still being sent
    const pending = entry.items.filter((m) => m.status);
    Object.assign(entry, { items: [...page.messages, ...pending], hasMore: page.hasMore, status: "ready" });
  } catch {
    entry.status = "error";
  }
  if (state.activeId === id) renderMessages("bottom");
};

// After a reconnect: fetch the newest page and merge in anything we missed
const refreshMessages = async (id: string) => {
  const entry = state.messages.get(id);
  if (entry?.status !== "ready") return;
  try {
    const page = await api<MessagePage>(`/conversations/${id}/messages?limit=50`);
    const known = new Set(entry.items.map((m) => m.id));
    const missed = page.messages.filter(
      (m) => !known.has(m.id) && !entry.items.some((p) => p.clientId && p.clientId === m.clientId),
    );
    missed.forEach((m) => seenMessageIds.add(m.id));
    if (missed.length) {
      entry.items = [...entry.items, ...missed].sort(byTime);
      if (state.activeId === id) renderMessages("auto");
    }
  } catch {
    // The next reconnect tries again
  }
};

const loadOlder = async () => {
  const id = state.activeId;
  const entry = id ? state.messages.get(id) : undefined;
  const oldest = entry?.items.find((m) => m.id);
  if (!id || !entry || !entry.hasMore || entry.loadingOlder || !oldest) return;
  entry.loadingOlder = true;
  renderMessages("anchor");
  try {
    const page = await api<MessagePage>(`/conversations/${id}/messages?limit=30&before=${oldest.id}`);
    page.messages.forEach((m) => seenMessageIds.add(m.id));
    entry.items = [...page.messages, ...entry.items];
    entry.hasMore = page.hasMore;
  } catch (err) {
    toast(errorMessage(err), { type: "error" });
  }
  entry.loadingOlder = false;
  if (state.activeId === id) renderMessages("anchor");
};

// Puts a server message into the list, replacing its pending copy (same
// clientId) if this tab sent it. Returns false if it was already there.
const applyMessage = (message: MessageDTO) => {
  const conversation = state.conversations.get(message.conversationId);
  if (conversation && new Date(message.createdAt) >= new Date(conversation.lastMessage?.createdAt ?? 0)) {
    conversation.lastMessage = { text: message.text, sender: message.sender?.id ?? "", createdAt: message.createdAt };
    conversation.lastMessageAt = message.createdAt;
  }

  const entry = state.messages.get(message.conversationId);
  if (entry?.status !== "ready") return true;
  if (entry.items.some((m) => m.id === message.id)) return false;
  const pendingIndex = message.clientId ? entry.items.findIndex((m) => m.clientId === message.clientId && m.status) : -1;
  if (pendingIndex >= 0) {
    entry.items[pendingIndex] = message;
  } else {
    entry.items.push(message);
    entry.items.sort(byTime);
  }
  return true;
};

const failPending = (pending: ChatMessage, error: string) => {
  pending.status = "failed";
  pending.error = error;
  if (state.activeId === pending.conversationId) renderMessages("auto");
};

const deliver = (pending: ChatMessage) => {
  pending.status = "sending";
  pending.error = null;
  if (!socket) return failPending(pending, "Not connected.");
  // Sent while disconnected? Socket.IO buffers it until the reconnect; the
  // timeout marks it failed if that takes too long. Retrying reuses the
  // clientId, so the server never stores it twice.
  socket.timeout(ACK_TIMEOUT).emit(
    "message:send",
    { conversationId: pending.conversationId, text: pending.text, clientId: pending.clientId ?? undefined },
    (err, res) => {
      if (err) return failPending(pending, "No response from the server.");
      if (!res.ok) {
        if (res.error.code === "RATE_LIMITED") toast(res.error.message, { type: "error" });
        return failPending(pending, res.error.message);
      }
      seenMessageIds.add(res.message.id);
      applyMessage(res.message);
      if (state.activeId === pending.conversationId) renderMessages("auto");
      renderSidebar();
    },
  );
};

const sendMessage = (text: string) => {
  const conversation = activeConversation();
  const me = state.me;
  if (!conversation || !me) return;
  const pending: ChatMessage = {
    id: null,
    clientId: randomId(),
    conversationId: conversation.id,
    sender: { id: me._id, firstName: me.firstName, lastName: me.lastName, avatar: me.avatar, role: me.role, lastSeenAt: null },
    text,
    createdAt: new Date().toISOString(),
    status: "sending",
  };
  entryFor(conversation.id).items.push(pending);
  conversation.lastMessage = { text, sender: me._id, createdAt: pending.createdAt };
  conversation.lastMessageAt = pending.createdAt;
  renderMessages("bottom");
  renderSidebar();
  deliver(pending);
};

const findPending = (clientId: string) =>
  (state.activeId ? state.messages.get(state.activeId) : undefined)?.items.find((m) => m.clientId === clientId && m.status);

const retry = (clientId: string) => {
  const pending = findPending(clientId);
  if (!pending) return;
  deliver(pending);
  renderMessages("auto");
};

const discard = (clientId: string) => {
  const entry = state.activeId ? state.messages.get(state.activeId) : undefined;
  if (!entry) return;
  entry.items = entry.items.filter((m) => !(m.clientId === clientId && m.status));
  renderMessages("auto");
};

// Debounced per conversation; the socket is preferred, REST is the fallback
const readTimers = new Map<string, ReturnType<typeof setTimeout>>();
const markRead = (id: string) => {
  const conversation = state.conversations.get(id);
  if (!conversation) return;
  conversation.unreadCount = 0;
  updateTitle();
  clearTimeout(readTimers.get(id));
  readTimers.set(
    id,
    setTimeout(() => {
      if (socket?.connected) socket.emit("message:read", { conversationId: id }, () => {});
      else api(`/conversations/${id}/read`, { method: "POST" }).catch(() => {});
    }, 300),
  );
};

// ---------- Typing ----------

let typingIn: string | null = null; // conversationId we announced typing in
let lastTypingSent = 0;
let typingIdleTimer: ReturnType<typeof setTimeout> | undefined;

const stopTyping = () => {
  clearTimeout(typingIdleTimer);
  if (typingIn && socket?.connected) socket.emit("typing:stop", { conversationId: typingIn });
  typingIn = null;
};

const announceTyping = () => {
  const id = state.activeId;
  if (!id || !socket?.connected) return;
  if (typingIn !== id || Date.now() - lastTypingSent > TYPING_REFRESH) {
    socket.emit("typing:start", { conversationId: id });
    typingIn = id;
    lastTypingSent = Date.now();
  }
  clearTimeout(typingIdleTimer);
  typingIdleTimer = setTimeout(stopTyping, TYPING_IDLE);
};

const clearTypingUser = (conversationId: string, userId: string | undefined) => {
  const users = state.typing.get(conversationId);
  const entry = userId ? users?.get(userId) : undefined;
  if (!users || !entry || !userId) return false;
  clearTimeout(entry.timer);
  users.delete(userId);
  return true;
};

// ---------- Socket events ----------

const bindSocket = (socket: ChatSocket) => {
  socket.on("connect", () => {
    // First connect or a reconnect: rejoin the open room and catch up on
    // anything that happened while we were away
    if (state.activeId) {
      joinRoom(state.activeId);
      void refreshMessages(state.activeId);
    }
    if (state.conversationsStatus !== "loading") void loadConversations({ silent: true });
  });

  socket.on("message:new", async (message) => {
    const firstTime = !seenMessageIds.has(message.id);
    seenMessageIds.add(message.id);
    const fromMe = message.sender?.id === myId();
    if (clearTypingUser(message.conversationId, message.sender?.id)) renderTyping();

    if (!state.conversations.has(message.conversationId)) {
      // A conversation we haven't seen yet (someone messaged us first)
      try {
        const { conversation } = await api<{ conversation: ConversationDTO }>(`/conversations/${message.conversationId}`);
        upsertConversation(conversation);
        if (!fromMe) toast(`New message from ${message.sender?.firstName ?? "someone"}`);
      } catch {
        return;
      }
      renderAll();
      return; // its unreadCount already includes this message
    }

    applyMessage(message);
    const conversation = state.conversations.get(message.conversationId);
    const isOpen = state.activeId === message.conversationId;

    if (conversation && !fromMe && firstTime) {
      if (isOpen && document.visibilityState === "visible") markRead(conversation.id);
      else conversation.unreadCount += 1;
    }
    if (isOpen) {
      const atBottom = isAtBottom();
      renderMessages(fromMe ? "bottom" : "auto");
      if (!fromMe && !atBottom) showJumpButton();
    }
    renderAll();
  });

  socket.on("message:read", ({ conversationId, userId, readAt }) => {
    const conversation = state.conversations.get(conversationId);
    if (!conversation) return;
    if (userId === myId()) {
      conversation.unreadCount = 0; // read in another tab
    } else {
      const member = conversation.members.find((m) => m.id === userId);
      if (member) member.lastReadAt = readAt;
      if (state.activeId === conversationId) renderMessages("auto");
    }
    renderAll();
  });

  socket.on("typing:start", ({ conversationId, user }) => {
    if (user.id === myId()) return; // my other tab
    let users = state.typing.get(conversationId);
    if (!users) {
      users = new Map();
      state.typing.set(conversationId, users);
    }
    clearTypingUser(conversationId, user.id);
    users.set(user.id, {
      name: `${user.firstName} ${user.lastName}`,
      timer: setTimeout(() => {
        clearTypingUser(conversationId, user.id);
        renderAll();
      }, TYPING_EXPIRES),
    });
    renderAll();
  });

  socket.on("typing:stop", ({ conversationId, userId }) => {
    if (clearTypingUser(conversationId, userId)) renderAll();
  });

  socket.on("presence:snapshot", ({ onlineUserIds }) => {
    state.online = new Set(onlineUserIds);
    renderAll();
  });

  socket.on("presence:update", ({ userId, online, lastSeenAt }) => {
    if (online) state.online.add(userId);
    else state.online.delete(userId);
    if (lastSeenAt) {
      const contact = state.contacts.get(userId);
      if (contact) contact.lastSeenAt = lastSeenAt;
      for (const conversation of state.conversations.values()) {
        const member = conversation.members.find((m) => m.id === userId);
        if (member) member.lastSeenAt = lastSeenAt;
      }
    }
    renderAll();
    if ($<HTMLDialogElement>("#new-chat-dialog").open) renderContacts();
  });

  socket.on("conversation:new", (conversation) => {
    upsertConversation(conversation);
    renderAll();
  });

  socket.on("conversation:updated", (conversation) => {
    if (!state.conversations.has(conversation.id)) return;
    upsertConversation(conversation);
    renderAll();
  });

  socket.on("conversation:removed", ({ conversationId }) => {
    if (state.activeId === conversationId) closeConversation();
    state.conversations.delete(conversationId);
    state.messages.delete(conversationId);
    renderAll();
  });

  socket.on("message:error", (error) => toast(error.message, { type: "error" }));
};

// ---------- Session lifecycle ----------

const startApp = async (user: SessionUser) => {
  resetState();
  state.me = user;
  $("#auth-screen").hidden = true;
  $("#app-screen").hidden = false;
  showChat(false);
  renderMe();
  renderConnection();

  const restoredId = location.hash.slice(1);
  await loadConversations();
  if (restoredId && state.conversations.has(restoredId)) openConversation(restoredId);

  try {
    socket = await connectSocket({
      onStatus: (status) => {
        state.connection = status;
        renderConnection();
      },
      onAuthFailed: (reason) => stopApp(reason),
    });
    bindSocket(socket);
  } catch (err) {
    state.connection = "offline";
    renderConnection();
    toast(errorMessage(err), { type: "error" });
  }
};

const stopApp = (reason?: string) => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  stopTyping();
  drafts.clear();
  seenMessageIds.clear();
  document.querySelectorAll("dialog[open]").forEach((dialog) => (dialog as HTMLDialogElement).close());
  resetState();
  setHash(null);
  updateTitle();
  showAuth(reason);
};

// ---------- Actions used by the views ----------

const actions = {
  openConversation,
  reloadConversations: () => void loadConversations(),
  reloadMessages: (id: string) => void loadMessages(id),
  loadOlder: () => void loadOlder(),
  retry,
  discard,
  newConversation: openNewChat,
  reconnect: () => socket?.connect(),

  loadContacts: async () => {
    state.contactsStatus = "loading";
    renderContacts();
    try {
      const { users } = await api<{ users: (PublicUser & { online: boolean })[] }>("/users/contacts");
      state.contacts = new Map(users.map((u) => [u.id, u]));
      for (const u of users) if (u.online) state.online.add(u.id);
      state.contactsStatus = "ready";
    } catch {
      state.contactsStatus = "error";
    }
    renderContacts();
  },

  openDirect: async (userId: string) => {
    try {
      const { conversation } = await api<{ conversation: ConversationDTO }>("/conversations", {
        method: "POST",
        body: { type: "direct", userId },
      });
      upsertConversation(conversation);
      openConversation(conversation.id);
      return true;
    } catch (err) {
      showNewChatError(errorMessage(err));
      return false;
    }
  },

  createGroup: async (name: string, memberIds: string[]) => {
    try {
      const { conversation } = await api<{ conversation: ConversationDTO }>("/conversations", {
        method: "POST",
        body: { type: "group", name, memberIds },
      });
      upsertConversation(conversation);
      openConversation(conversation.id);
      return true;
    } catch (err) {
      showNewChatError(errorMessage(err));
      return false;
    }
  },
};

// ---------- Composer ----------

const onComposerInput = ({ silent = false } = {}) => {
  const input = composer();
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  const length = input.value.trim().length;
  $<HTMLButtonElement>("#btn-send").disabled = length === 0 || length > MAX_MESSAGE_LENGTH;
  const counter = $("#composer-count");
  counter.hidden = input.value.length < MAX_MESSAGE_LENGTH - 200;
  counter.textContent = `${input.value.length}/${MAX_MESSAGE_LENGTH}`;
  counter.classList.toggle("is-over", input.value.length > MAX_MESSAGE_LENGTH);
  if (silent) return;
  if (length) announceTyping();
  else stopTyping();
};

const bindComposer = () => {
  const input = composer();
  const form = $<HTMLFormElement>("#composer");
  input.addEventListener("input", () => onComposerInput());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) return;
    stopTyping();
    sendMessage(text);
    input.value = "";
    if (state.activeId) drafts.delete(state.activeId);
    onComposerInput({ silent: true });
    input.focus();
  });
};

// ---------- Static UI ----------

const currentTheme = () =>
  document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

const renderThemeButton = () => {
  const dark = currentTheme() === "dark";
  const button = $("#btn-theme");
  button.innerHTML = icon(dark ? "sun" : "moon");
  button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  button.title = button.getAttribute("aria-label") ?? "";
};

const bindStaticUi = () => {
  applyIcons();
  const icons: Record<string, IconName> = {
    "#btn-new-chat": "plus",
    "#btn-about": "info",
    "#btn-logout": "logout",
    "#btn-back": "back",
    "#btn-members": "users",
    "#btn-leave": "leave",
    "#btn-send": "send",
  };
  for (const [selector, name] of Object.entries(icons)) $(selector).innerHTML = icon(name);
  document.querySelectorAll(".search__icon").forEach((el) => {
    el.innerHTML = icon("search");
  });
  renderThemeButton();

  $("#btn-theme").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("relay.theme", next);
    } catch {
      // Not saved; still applies to this page
    }
    renderThemeButton();
  });
  $("#btn-about").addEventListener("click", () => $<HTMLDialogElement>("#about-dialog").showModal());
  $("#btn-new-chat").addEventListener("click", openNewChat);
  $("#btn-empty-new").addEventListener("click", openNewChat);
  $("#btn-back").addEventListener("click", closeConversation);
  $("#btn-members").addEventListener("click", openMembers);
  $("#btn-logout").addEventListener("click", async () => {
    const button = $<HTMLButtonElement>("#btn-logout");
    button.disabled = true;
    await logout();
    button.disabled = false;
    stopApp();
  });
  $("#btn-leave").addEventListener("click", async () => {
    const conversation = activeConversation();
    if (!conversation || !confirm(`Leave "${conversation.name}"? You won't get its messages any more.`)) return;
    try {
      await api(`/conversations/${conversation.id}/leave`, { method: "POST" });
      if (state.activeId === conversation.id) closeConversation();
      state.conversations.delete(conversation.id);
      renderAll();
      toast(`You left ${conversation.name}`);
    } catch (err) {
      toast(errorMessage(err), { type: "error" });
    }
  });

  const scroller = $("#messages");
  scroller.addEventListener("scroll", () => {
    if (scroller.scrollTop < 120) void loadOlder();
    if (isAtBottom()) $("#btn-jump").hidden = true;
  });
  $("#btn-jump").addEventListener("click", () => {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    $("#btn-jump").hidden = true;
  });

  // Search: conversations filter instantly, messages are searched on the server
  let latestQuery = "";
  const searchMessages = debounce(async (query: string) => {
    try {
      const { messages } = await api<{ messages: MessageDTO[] }>(`/messages/search?q=${encodeURIComponent(query)}`);
      if (query === latestQuery) setSearchResults({ status: "ready", items: messages, query });
    } catch {
      if (query === latestQuery) setSearchResults({ status: "error", items: [], query });
    }
    renderSidebar();
  }, 300);
  $<HTMLInputElement>("#search").addEventListener("input", (event) => {
    const query = (event.target as HTMLInputElement).value.trim();
    latestQuery = query;
    setFilter(query);
    if (query.length >= 2) {
      setSearchResults({ status: "loading", items: [], query });
      searchMessages(query);
    } else {
      setSearchResults(null);
    }
    renderSidebar();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.activeId) {
      markRead(state.activeId);
      renderSidebar();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.activeId && !document.querySelector("dialog[open]")) closeConversation();
  });

  // Keep "last seen 5 minutes ago" and sidebar times current
  setInterval(() => {
    if (state.me) renderAll();
  }, 60_000);
};

// ---------- Boot ----------

const boot = async () => {
  bindStaticUi();
  bindComposer();
  initSidebar(actions);
  initChat(actions);
  initDialogs(actions);
  initAuth({ onSignedIn: (user) => void startApp(user) });
  onSessionEnded((reason) => stopApp(reason));

  const session = restoreSession();
  let message: string | null = null;
  if (session) {
    try {
      // Confirms the saved session still works (refreshing it if needed)
      const { user } = await api<{ user: SessionUser }>("/users/me");
      $("#boot").hidden = true;
      return startApp(user);
    } catch (err) {
      message = err instanceof ApiError && err.status === 0 ? err.message : "Please sign in again.";
    }
  }
  $("#boot").hidden = true;
  showAuth(message);
};

void boot();
