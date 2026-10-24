import type { PublicUser } from "../../../shared/types.d.ts";
import { $, h, avatarEl, fullName, formatLastSeen, setLoading } from "../dom.ts";
import { icon } from "../icons.ts";
import { state, myId, isOnline, activeConversation } from "../store.ts";

// "New conversation" (direct or group) and "Members"

export interface DialogActions {
  loadContacts(): void;
  openDirect(userId: string): Promise<boolean>;
  createGroup(name: string, memberIds: string[]): Promise<boolean>;
}

let actions: DialogActions;
let mode: "direct" | "group" = "direct";
let selected = new Set<string>();

const input = (selector: string) => $<HTMLInputElement>(selector);

export const initDialogs = (handlers: DialogActions) => {
  actions = handlers;
  const dialog = $<HTMLDialogElement>("#new-chat-dialog");

  dialog.querySelectorAll<HTMLButtonElement>(".segmented__btn").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode === "group" ? "group" : "direct"));
  });
  input("#contact-search").addEventListener("input", renderContacts);
  input("#group-name").addEventListener("input", updateGroupFooter);
  $("#btn-create-group").addEventListener("click", async () => {
    const button = $<HTMLButtonElement>("#btn-create-group");
    setLoading(button, true);
    const ok = await actions.createGroup(input("#group-name").value, [...selected]);
    setLoading(button, false);
    if (ok) dialog.close();
    else updateGroupFooter();
  });
};

const setMode = (next: "direct" | "group") => {
  mode = next;
  $("#new-chat-dialog")
    .querySelectorAll<HTMLButtonElement>(".segmented__btn")
    .forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
  $("#group-name-field").hidden = mode !== "group";
  $("#group-footer").hidden = mode !== "group";
  $("#new-chat-error").hidden = true;
  renderContacts();
  updateGroupFooter();
};

const updateGroupFooter = () => {
  const count = selected.size;
  $("#group-count").textContent = count < 2 ? `Select at least 2 people (${count} selected)` : `${count} people selected`;
  $<HTMLButtonElement>("#btn-create-group").disabled = count < 2 || !input("#group-name").value.trim();
};

const contactSub = (user: PublicUser) =>
  isOnline(user.id)
    ? h("span", { class: "contact__sub contact__sub--online" }, "online")
    : h("span", { class: "contact__sub" }, formatLastSeen(user.lastSeenAt));

export const renderContacts = () => {
  const list = $("#contact-list");
  const query = input("#contact-search").value.trim().toLowerCase();

  if (state.contactsStatus === "loading") {
    list.replaceChildren(h("div", { class: "list-state" }, h("div", { class: "spinner" })));
    return;
  }
  if (state.contactsStatus === "error") {
    list.replaceChildren(
      h(
        "div",
        { class: "list-state" },
        "Couldn't load people.",
        h("button", { class: "btn", type: "button", onclick: () => actions.loadContacts() }, "Try again"),
      ),
    );
    return;
  }

  const contacts = [...state.contacts.values()]
    .filter((user) => fullName(user).toLowerCase().includes(query))
    .sort((a, b) => Number(isOnline(b.id)) - Number(isOnline(a.id)) || fullName(a).localeCompare(fullName(b)));

  if (!contacts.length) {
    list.replaceChildren(h("div", { class: "list-state" }, query ? "Nobody matches that name." : "Nobody else has signed up yet."));
    return;
  }

  list.replaceChildren(
    ...contacts.map((user) => {
      const checked = selected.has(user.id);
      return h(
        "button",
        {
          type: "button",
          class: "contact",
          role: mode === "group" ? "checkbox" : "listitem",
          "aria-checked": mode === "group" ? String(checked) : null,
          onclick: async (event: MouseEvent) => {
            if (mode === "group") {
              if (checked) selected.delete(user.id);
              else selected.add(user.id);
              renderContacts();
              updateGroupFooter();
              return;
            }
            const button = event.currentTarget as HTMLButtonElement;
            button.disabled = true;
            const ok = await actions.openDirect(user.id);
            button.disabled = false;
            if (ok) $<HTMLDialogElement>("#new-chat-dialog").close();
          },
        },
        avatarEl(user, { size: "sm", online: isOnline(user.id) }),
        h("span", { class: "contact__text" }, h("span", { class: "contact__name" }, fullName(user)), contactSub(user)),
        mode === "group" ? h("span", { class: "check", html: icon("check") }) : null,
      );
    }),
  );
};

export const showNewChatError = (message: string) => {
  const el = $("#new-chat-error");
  el.textContent = message;
  el.hidden = false;
};

export const openNewChat = () => {
  selected = new Set();
  input("#contact-search").value = "";
  input("#group-name").value = "";
  setMode("direct");
  $<HTMLDialogElement>("#new-chat-dialog").showModal();
  input("#contact-search").focus();
  actions.loadContacts();
};

export const openMembers = () => {
  const conversation = activeConversation();
  if (!conversation) return;
  $("#members-title").textContent = `${conversation.name} · ${conversation.members.length} members`;
  $("#members-list").replaceChildren(
    ...conversation.members.map((member) =>
      h(
        "div",
        { class: "contact", role: "listitem" },
        avatarEl(member, { size: "sm", online: isOnline(member.id) }),
        h(
          "span",
          { class: "contact__text" },
          h("span", { class: "contact__name" }, member.id === myId() ? `${fullName(member)} (you)` : fullName(member)),
          member.id === myId() ? h("span", { class: "contact__sub contact__sub--online" }, "online") : contactSub(member),
        ),
      ),
    ),
  );
  $<HTMLDialogElement>("#members-dialog").showModal();
};
