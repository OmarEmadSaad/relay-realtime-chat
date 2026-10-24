// Runs before the stylesheet paints: applies the saved light/dark choice.
// (A classic script, not a module, so it runs before first paint; an
// external file because the Content-Security-Policy blocks inline scripts.)
try {
  const theme = localStorage.getItem("relay.theme");
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  }
} catch {
  // Storage blocked: follow the system setting
}
