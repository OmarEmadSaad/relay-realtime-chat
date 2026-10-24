import type { ConversationDTO, MessageDTO } from "../../../shared/types.d.ts";
import { $, h, avatarEl, groupAvatarEl, formatShort, fullName } from "../dom.ts";
import { icon } from "../icons.ts";
import {
  state,
  myId,
  isOnline,
  otherMember,
  conversationTitle,
  sortedConversations,
  typingNames,
  memberById,
} from "../store.ts";

export interface SidebarActions {
  openConversation(id: string): void;
  reloadConversations(): void;
  newConversation(): void;
  reconnect(): void;
}

export interface SearchResults {
  status: "loading" | "ready" | "error";
  items: MessageDTO[];
  query: string;
}

let actions: SidebarActions;
let filter = "";
let searchResults: SearchResults | null = null; // null = no message search

export const initSidebar = (handlers: SidebarActions) => {
  actions = handlers;
};

export const setFilter = (value: string) => {
  filter = value.trim().toLowerCase();
};

export const setSearchResults = (results: SearchResults | null) => {
  searchResults = results;
};

const conversationAvatar = (conversation: ConversationDTO) => {
  if (conversation.type === "group") return groupAvatarEl();
  const other = otherMember(conversation);
  return avatarEl(other, { online: other ? isOnline(other.id) : false });
};

const firstName = (name: string) => name.split(" ")[0];

const previewText = (conversation: ConversationDTO) => {
  const typing = typingNames(conversation.id);
  if (typing.length) {
    const who = conversation.type === "group" ? `${firstName(typing[0])} is typing…` : "typing…";
    return { text: typing.length > 1 ? "Several people are typing…" : who, typing: true };
  }
  const last = conversation.lastMessage;
  if (!last) return { text: conversation.type === "group" ? "Group created" : "No messages yet", typing: false };
  let prefix = "";
  if (last.sender === myId()) prefix = "You: ";
  else if (conversation.type === "group") {
    const sender = memberById(conversation, last.sender);
    prefix = sender ? `${sender.firstName}: ` : "";
  }
  return { text: prefix + last.text.replace(/\s+/g, " "), typing: false };
};

const conversationRow = (conversation: ConversationDTO) => {
  const unread = conversation.id === state.activeId ? 0 : conversation.unreadCount;
  const preview = previewText(conversation);
  const title = conversationTitle(conversation);
  return h(
    "button",
    {
      type: "button",
      role: "listitem",
      class: `conv ${conversation.id === state.activeId ? "is-active" : ""} ${unread ? "has-unread" : ""}`,
      "aria-current": conversation.id === state.activeId ? "true" : null,
      "aria-label": `${title}${unread ? `, ${unread} unread` : ""}`,
      onclick: () => actions.openConversation(conversation.id),
    },
    conversationAvatar(conversation),
    h(
      "div",
      { class: "conv__body" },
      h(
        "div",
        { class: "conv__top" },
        h("span", { class: "conv__name" }, title),
        conversation.lastMessage && h("span", { class: "conv__time" }, formatShort(conversation.lastMessage.createdAt)),
      ),
      h(
        "div",
        { class: "conv__bottom" },
        h("span", { class: `conv__preview ${preview.typing ? "conv__preview--typing" : ""}` }, preview.text),
        unread > 0 && h("span", { class: "badge" }, unread > 99 ? "99+" : String(unread)),
      ),
    ),
  );
};

const skeletons = () =>
  Array.from({ length: 6 }, () =>
    h(
      "div",
      { class: "skeleton", "aria-hidden": "true" },
      h("div", { class: "skeleton__circle" }),
      h("div", { class: "skeleton__lines" }, h("div", { class: "skeleton__line" }), h("div", { class: "skeleton__line" })),
    ),
  );

const matchesFilter = (conversation: ConversationDTO) => {
  if (!filter) return true;
  const haystack = [
    conversationTitle(conversation),
    ...conversation.members.map(fullName),
    conversation.lastMessage?.text ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(filter);
};

// Highlights the search term inside text (still text nodes, no innerHTML)
const highlighted = (text: string, query: string): (string | HTMLElement)[] => {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return [text];
  return [text.slice(0, index), h("mark", {}, text.slice(index, index + query.length)), text.slice(index + query.length)];
};

const searchSection = () => {
  if (!searchResults) return null;
  const { status, items, query } = searchResults;
  const section = h("div", {}, h("div", { class: "section-label" }, "Messages"));
  if (status === "loading") {
    section.append(h("div", { class: "list-state" }, h("div", { class: "spinner" })));
  } else if (status === "error") {
    section.append(h("div", { class: "list-state" }, "Search failed. Try again."));
  } else if (!items.length) {
    section.append(h("div", { class: "list-state" }, `No messages match “${query}”.`));
  } else {
    for (const message of items) {
      const conversation = state.conversations.get(message.conversationId);
      section.append(
        h(
          "button",
          {
            type: "button",
            class: "search-hit",
            onclick: () => actions.openConversation(message.conversationId),
          },
          h(
            "div",
            { class: "search-hit__meta" },
            h("span", {}, `${conversation ? conversationTitle(conversation) : "Conversation"} · ${message.sender?.id === myId() ? "You" : fullName(message.sender)}`),
            h("span", {}, formatShort(message.createdAt)),
          ),
          h("div", { class: "search-hit__text" }, ...highlighted(message.text, query)),
        ),
      );
    }
  }
  return section;
};

export const renderSidebar = () => {
  const list = $("#conversation-list");
  list.replaceChildren();

  if (state.conversationsStatus === "loading") {
    list.append(...skeletons());
  } else if (state.conversationsStatus === "error") {
    list.append(
      h(
        "div",
        { class: "list-state" },
        "Couldn't load your conversations.",
        h("button", { class: "btn", type: "button", onclick: () => actions.reloadConversations() }, "Try again"),
      ),
    );
  } else {
    const rows = sortedConversations().filter(matchesFilter);
    if (filter && searchResults) list.append(h("div", { class: "section-label" }, "Conversations"));
    if (rows.length) {
      list.append(...rows.map(conversationRow));
    } else if (filter) {
      list.append(h("div", { class: "list-state" }, "No conversations match."));
    } else {
      list.append(
        h(
          "div",
          { class: "list-state" },
          "No conversations yet.",
          h("button", { class: "btn btn--primary", type: "button", onclick: () => actions.newConversation() }, "Start one"),
        ),
      );
    }
  }

  const results = $("#search-results");
  const section = searchSection();
  results.hidden = !section;
  results.replaceChildren(...(section ? [section] : []));
};

export const renderMe = () => {
  const me = state.me;
  if (!me) return;
  $("#me").replaceChildren(
    avatarEl({ ...me, id: me._id }, { size: "sm" }),
    h(
      "div",
      { class: "me__text" },
      h("span", { class: "me__name" }, fullName(me)),
      h("span", { class: `role-chip role-chip--${me.role}` }, me.isDemo ? `${me.role} · demo` : me.role),
    ),
  );
};

export const renderConnection = () => {
  const el = $("#connection");
  const { connection } = state;
  el.hidden = connection === "connected";
  el.className = `connection ${connection === "offline" ? "connection--offline" : ""}`;
  if (connection === "connecting") {
    el.replaceChildren(h("div", { class: "spinner" }), "Connecting…");
  } else if (connection === "reconnecting") {
    el.replaceChildren(h("div", { class: "spinner" }), "Connection lost. Reconnecting…");
  } else if (connection === "offline") {
    el.replaceChildren(
      h("span", { html: icon("wifiOff") }),
      "Disconnected.",
      h("button", { class: "link-btn", type: "button", onclick: () => actions.reconnect() }, "Reconnect"),
    );
  }
};
