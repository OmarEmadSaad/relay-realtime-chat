import type { ConversationDTO } from "../../../shared/types.d.ts";
import { $, h, avatarEl, groupAvatarEl, formatTime, formatDay, dayKey, formatLastSeen, fullName, hueFor } from "../dom.ts";
import { icon } from "../icons.ts";
import { state, myId, isOnline, otherMember, conversationTitle, activeConversation, typingNames } from "../store.ts";
import type { ChatMessage, MessagesEntry } from "../store.ts";

export interface ChatActions {
  retry(clientId: string): void;
  discard(clientId: string): void;
  loadOlder(): void;
  reloadMessages(conversationId: string): void;
}

let actions: ChatActions;

export const initChat = (handlers: ChatActions) => {
  actions = handlers;
};

// Messages from the same sender within 5 minutes are grouped into one run
const GROUP_GAP = 5 * 60_000;

// The list is re-rendered on every change; only messages that weren't on
// screen before get the entrance animation (not the whole list each time)
const renderedKeys = new Map<string, Set<string>>(); // conversationId -> message keys
const messageKey = (message: ChatMessage) => message.clientId ?? message.id ?? "";

const sameRun = (a: ChatMessage | undefined, b: ChatMessage | undefined) =>
  Boolean(
    a &&
      b &&
      a.sender?.id === b.sender?.id &&
      dayKey(a.createdAt) === dayKey(b.createdAt) &&
      Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < GROUP_GAP,
  );

const statusIcon = (message: ChatMessage) => {
  if (message.status === "sending") return h("span", { html: icon("clock"), title: "Sending" });
  if (message.status === "failed") return h("span", { html: icon("alert"), title: "Not sent" });
  return h("span", { html: icon("check"), title: "Sent" });
};

const messageEl = (
  message: ChatMessage,
  { first, last, isGroup, isNew }: { first: boolean; last: boolean; isGroup: boolean; isNew: boolean },
) => {
  const mine = message.sender?.id === myId();
  const classes = [
    "msg",
    mine ? "msg--out" : "msg--in",
    isNew && "is-new",
    first && "is-first",
    last && "is-last",
    message.status === "sending" && "is-pending",
    message.status === "failed" && "is-failed",
  ].filter(Boolean);

  const el = h("div", { class: classes.join(" "), dataset: { id: message.id ?? message.clientId ?? "" } });
  el.style.setProperty("--avatar-hue", String(hueFor(message.sender?.id)));

  if (!mine && isGroup) {
    el.append(h("div", { class: "msg__avatar-slot" }, last ? avatarEl(message.sender, { size: "xs" }) : null));
  }

  const createdAt = new Date(message.createdAt);
  const body = h("div", { class: "msg__body" });
  if (!mine && isGroup && first) body.append(h("div", { class: "msg__sender" }, fullName(message.sender)));
  body.append(
    h(
      "div",
      { class: "bubble" },
      message.text,
      h(
        "span",
        { class: "bubble__meta" },
        h("time", { datetime: createdAt.toISOString(), title: createdAt.toLocaleString() }, formatTime(createdAt)),
        mine ? statusIcon(message) : null,
      ),
    ),
  );
  const clientId = message.clientId;
  if (message.status === "failed" && clientId) {
    body.append(
      h(
        "div",
        { class: "msg__fail" },
        message.error ?? "Not sent.",
        h("button", { class: "link-btn", type: "button", onclick: () => actions.retry(clientId) }, "Retry"),
        h("button", { class: "link-btn", type: "button", onclick: () => actions.discard(clientId) }, "Delete"),
      ),
    );
  }
  el.append(body);
  return el;
};

const historyHeader = (entry: MessagesEntry) => {
  if (entry.loadingOlder) return h("div", { class: "history-state" }, h("div", { class: "spinner" }));
  if (entry.hasMore) {
    return h(
      "div",
      { class: "history-state" },
      h("button", { class: "btn", type: "button", onclick: () => actions.loadOlder() }, "Load older messages"),
    );
  }
  return h("div", { class: "history-state" }, "This is the beginning of your conversation.");
};

// Whether the reader is (close to) the bottom of the message list
const nearBottom = (scroller: HTMLElement) => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;

// mode: "bottom" (jump to newest), "anchor" (older messages were added above:
// keep the view still), "auto" (stick to the bottom only if already there)
export const renderMessages = (mode: "auto" | "bottom" | "anchor" = "auto") => {
  const conversation = activeConversation();
  if (!conversation) return;
  const scroller = $("#messages");
  const inner = $("#messages-inner");
  const entry = state.messages.get(conversation.id);

  const wasNearBottom = nearBottom(scroller);
  const fromBottom = scroller.scrollHeight - scroller.scrollTop;

  inner.replaceChildren();
  if (!entry || entry.status === "loading") {
    inner.append(h("div", { class: "list-state" }, h("div", { class: "spinner" }), "Loading messages…"));
    return;
  }
  if (entry.status === "error") {
    inner.append(
      h(
        "div",
        { class: "list-state" },
        "Couldn't load messages.",
        h("button", { class: "btn", type: "button", onclick: () => actions.reloadMessages(conversation.id) }, "Try again"),
      ),
    );
    return;
  }
  if (!entry.items.length) {
    inner.append(
      h(
        "div",
        { class: "list-state" },
        conversation.type === "group" ? "No messages yet. Get the conversation going 👋" : `Say hi to ${otherMember(conversation)?.firstName ?? "them"} 👋`,
      ),
    );
    return;
  }

  inner.append(historyHeader(entry));
  const isGroup = conversation.type === "group";
  const items = entry.items;
  // Nothing animates the first time a conversation is shown
  const seen = renderedKeys.get(conversation.id);
  const shown = new Set<string>();
  items.forEach((message, i) => {
    const prev = items[i - 1];
    const next = items[i + 1];
    if (!prev || dayKey(prev.createdAt) !== dayKey(message.createdAt)) {
      inner.append(h("div", { class: "day" }, formatDay(message.createdAt)));
    }
    const key = messageKey(message);
    shown.add(key);
    const isNew = Boolean(seen) && !seen?.has(key) && mode !== "anchor";
    inner.append(messageEl(message, { first: !sameRun(prev, message), last: !sameRun(message, next), isGroup, isNew }));
  });
  renderedKeys.set(conversation.id, shown);

  // "Seen" under my latest message once the other person has read it
  if (!isGroup) {
    const other = otherMember(conversation);
    const lastMine = [...items].reverse().find((m) => m.sender?.id === myId() && !m.status);
    if (other && lastMine && items.at(-1) === lastMine && new Date(other.lastReadAt) >= new Date(lastMine.createdAt)) {
      inner.append(h("div", { class: "seen" }, "Seen"));
    }
  }

  if (mode === "bottom" || (mode === "auto" && wasNearBottom)) {
    scroller.scrollTop = scroller.scrollHeight;
    $("#btn-jump").hidden = true;
  } else if (mode === "anchor") {
    scroller.scrollTop = scroller.scrollHeight - fromBottom;
  }
};

export const showJumpButton = () => {
  if (!nearBottom($("#messages"))) $("#btn-jump").hidden = false;
};

export const isAtBottom = () => nearBottom($("#messages"));

const statusLine = (conversation: ConversationDTO) => {
  const typing = typingNames(conversation.id);
  if (typing.length) {
    const text =
      conversation.type === "group"
        ? typing.length > 1
          ? `${typing.length} people are typing…`
          : `${typing[0].split(" ")[0]} is typing…`
        : "typing…";
    return h("span", { class: "chat__status chat__status--typing" }, text);
  }
  if (conversation.type === "group") {
    const online = conversation.members.filter((m) => m.id !== myId() && isOnline(m.id)).length;
    return h("span", { class: "chat__status" }, `${conversation.members.length} members${online ? `, ${online} online` : ""}`);
  }
  const other = otherMember(conversation);
  if (other && isOnline(other.id)) return h("span", { class: "chat__status chat__status--online" }, "online");
  return h("span", { class: "chat__status" }, other ? formatLastSeen(other.lastSeenAt) : "account deleted");
};

export const renderHeader = () => {
  const conversation = activeConversation();
  if (!conversation) return;
  const other = conversation.type === "direct" ? otherMember(conversation) : null;
  $("#chat-who").replaceChildren(
    conversation.type === "group" ? groupAvatarEl() : avatarEl(other, { online: other ? isOnline(other.id) : false }),
    h("div", { class: "chat__title" }, h("span", { class: "chat__name" }, conversationTitle(conversation)), statusLine(conversation)),
  );
  $("#btn-members").hidden = conversation.type !== "group";
  $("#btn-leave").hidden = conversation.type !== "group";
};

// The line above the composer
export const renderTyping = () => {
  const conversation = activeConversation();
  const el = $("#typing");
  const names = conversation ? typingNames(conversation.id) : [];
  if (!names.length) {
    el.replaceChildren();
    return;
  }
  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : "Several people are typing";
  el.replaceChildren(h("span", { class: "dots", "aria-hidden": "true" }, h("span"), h("span"), h("span")), label);
};

export const showChat = (visible: boolean) => {
  $("#chat-empty").hidden = visible;
  $("#chat-main").hidden = !visible;
  $("#app-screen").classList.toggle("show-chat", visible);
};
