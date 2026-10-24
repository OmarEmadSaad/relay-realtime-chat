import type { DateLike } from "../../shared/types.d.ts";
import { SERVER_URL } from "./config.ts";
import { icon } from "./icons.ts";

// Small DOM helpers. User data is only ever set with textContent (never
// innerHTML), so messages and names can't inject markup.

export const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
};

type Child = Node | string | number | null | undefined | false;

// Attributes, plus: class, dataset, html (static icon markup only) and
// on<event> listeners. null/undefined/false attributes are skipped.
type Props = Record<string, unknown> & {
  class?: string;
  dataset?: Record<string, string>;
  html?: string;
};

// h("div", { class: "x", onclick: fn }, child, "text", ...)
export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value as EventListener);
    else if (key === "class") el.className = String(value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key === "html") el.innerHTML = String(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
};

// ---------- Names & avatars ----------

interface Named {
  firstName: string;
  lastName: string;
}

export interface AvatarUser extends Named {
  id?: string;
  avatar?: string;
}

export const fullName = (user: Named | null | undefined) => (user ? `${user.firstName} ${user.lastName}` : "Deleted user");

const initials = (user: Named | null | undefined) =>
  user ? `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase() : "?";

// The same person always gets the same color: one of 12 evenly spaced hues.
// FNV-1a, because MongoDB ids created together differ only in their last
// characters and a simple hash would give them nearly the same color.
export const hueFor = (id = "") => {
  let hash = 0x811c9dc5;
  for (const char of String(id)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 12) * 30;
};

const hasCustomAvatar = (user: AvatarUser | null | undefined): user is AvatarUser & { avatar: string } =>
  Boolean(user?.avatar && !user.avatar.endsWith("default-avatar.svg"));

export const avatarEl = (
  user: AvatarUser | null | undefined,
  { size = "", online = null }: { size?: string; online?: boolean | null } = {},
) => {
  const el = h("div", { class: `avatar ${size ? `avatar--${size}` : ""}`, "aria-hidden": "true" });
  el.style.setProperty("--avatar-hue", String(hueFor(user?.id)));
  if (hasCustomAvatar(user)) {
    el.append(h("img", { src: `${SERVER_URL}/${user.avatar}`, alt: "", loading: "lazy" }));
  } else {
    el.textContent = initials(user);
  }
  if (online !== null) {
    el.append(h("span", { class: `presence-dot ${online ? "is-online" : ""}` }));
  }
  return el;
};

export const groupAvatarEl = (size = "") =>
  h("div", { class: `avatar avatar--group ${size ? `avatar--${size}` : ""}`, "aria-hidden": "true", html: icon("users") });

// ---------- Time ----------

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const fullDateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const daysAgo = (date: Date) => Math.round((startOfDay(new Date()).getTime() - startOfDay(date).getTime()) / 86_400_000);

export const formatTime = (value: DateLike) => timeFmt.format(new Date(value));

// Sidebar: "14:05", "Yesterday", "Tue", "12 Oct"
export const formatShort = (value: DateLike) => {
  const date = new Date(value);
  const days = daysAgo(date);
  if (days === 0) return timeFmt.format(date);
  if (days === 1) return "Yesterday";
  if (days < 7) return weekdayFmt.format(date);
  return dateFmt.format(date);
};

// Day separators: "Today", "Yesterday", "Monday, 12 October 2026"
export const formatDay = (value: DateLike) => {
  const days = daysAgo(new Date(value));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return fullDateFmt.format(new Date(value));
};

export const dayKey = (value: DateLike) => startOfDay(new Date(value)).getTime();

export const formatLastSeen = (value: DateLike | null | undefined) => {
  if (!value) return "offline";
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  if (seconds > -60) return "last seen just now";
  if (seconds > -3600) return `last seen ${relFmt.format(Math.round(seconds / 60), "minute")}`;
  if (seconds > -86_400) return `last seen ${relFmt.format(Math.round(seconds / 3600), "hour")}`;
  return `last seen ${formatShort(value)}`;
};

// ---------- Toasts ----------

export const toast = (message: string, { type = "info", duration = 4000 }: { type?: "info" | "error"; duration?: number } = {}) => {
  const el = h("div", { class: `toast ${type === "error" ? "toast--error" : ""}`, role: type === "error" ? "alert" : "status" }, message);
  $("#toasts").append(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 200);
  }, duration);
};

// ---------- Misc ----------

// crypto.randomUUID needs a secure context (https or localhost)
export const randomId = (): string => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
};

export const debounce = <A extends unknown[]>(fn: (...args: A) => void, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

export const setLoading = (button: HTMLButtonElement, loading: boolean) => {
  button.disabled = loading;
  button.classList.toggle("is-loading", loading);
};
