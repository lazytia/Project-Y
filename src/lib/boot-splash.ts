const BOOT_SPLASH_ID = "boot-splash";
const BOOT_SPLASH_HIDDEN = "bootSplashHidden";

export function isBootSplashVisible(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(BOOT_SPLASH_ID);
  return !!el && !el.classList.contains(BOOT_SPLASH_HIDDEN);
}

/** Hide and remove the HTML boot splash — static node, safe to .remove(). */
export function hideBootSplash() {
  const el = document.getElementById(BOOT_SPLASH_ID);
  if (!el) return;

  el.classList.add(BOOT_SPLASH_HIDDEN);
  el.style.animation = "none";
  for (const child of el.querySelectorAll("*")) {
    (child as HTMLElement).style.animation = "none";
  }

  // iOS PWA keeps compositor layers from animated fixed overlays even when
  // display:none — removing the node clears the ghost image.
  requestAnimationFrame(() => {
    document.getElementById(BOOT_SPLASH_ID)?.remove();
  });
}

/** Hide SSR chrome once the client React shell has painted. */
export function hideServerAppShell() {
  document.getElementById("server-app-shell")?.setAttribute("hidden", "");
}

export function clientShellPainted(): boolean {
  if (typeof document === "undefined") return false;
  const shell = document.querySelector("[data-app-shell='true']");
  const rect = shell?.getBoundingClientRect();
  return !!rect && rect.width > 0 && rect.height > 0;
}

export function ssrShellVisible(): boolean {
  if (typeof document === "undefined") return false;
  const ssr = document.getElementById("server-app-shell");
  return !!ssr && !ssr.hasAttribute("hidden");
}

export function hasPageLoadingMarker(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector("[data-page-loading='true'], [data-splash='true']");
}

export function hideBootSplashWhenSafe(maxAttempts = 30) {
  if (clientShellPainted()) {
    hideBootSplash();
    hideServerAppShell();
    return;
  }

  let attempts = 0;
  const tryHide = () => {
    if (clientShellPainted() || attempts >= maxAttempts) {
      hideBootSplash();
      if (clientShellPainted()) hideServerAppShell();
      return;
    }

    attempts += 1;
    requestAnimationFrame(tryHide);
  };

  tryHide();
}
