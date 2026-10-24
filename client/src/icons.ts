// Inline SVG icons (static strings, never user data)
const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
  send: '<path d="M5 12 3.5 4.6a.8.8 0 0 1 1.1-.9l15.6 7.6a.8.8 0 0 1 0 1.4L4.6 20.3a.8.8 0 0 1-1.1-.9L5 12Zm0 0h7"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .8 3.5 2.8 3.5 5.5"/>',
  leave: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l-4 4 4 4M5 12h10"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checks: '<path d="m2.5 12.5 4.5 4.5L16.5 7.5M12 16l1 1 9.5-9.5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V13M12 16.5h.01"/>',
  wifiOff: '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M10 5.2A15 15 0 0 1 22 8.8M5 12.5a10 10 0 0 1 4-2.2M15 10.4a10 10 0 0 1 4 2.1M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>',
};

export type IconName = keyof typeof paths;

const isIconName = (name: string): name is IconName => Object.hasOwn(paths, name);

export const icon = (name: IconName, className = "icon") =>
  `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;

// Fills every element that has data-icon="name"
export const applyIcons = (root: ParentNode = document) => {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
    const name = el.dataset.icon ?? "";
    if (isIconName(name)) el.innerHTML = icon(name);
  });
};
