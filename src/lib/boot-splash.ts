const BOOT_SPLASH_ID = "boot-splash";
const BOOT_SPLASH_HIDDEN = "bootSplashHidden";

/** Injected via dangerouslySetInnerHTML so React never reconciles inner nodes. */
export const BOOT_SPLASH_MARKUP = `<div id="boot-splash" class="bootSplash" aria-hidden="true"><div class="bootSplashLogo"><span class="bootSplashMark">Y</span></div><div class="bootSplashWordmark">Project Y</div><div class="bootSplashStatus">Loading…</div><div class="bootSplashDots" aria-hidden="true"><span></span><span></span><span></span></div></div>`;

export function isBootSplashVisible(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(BOOT_SPLASH_ID);
  return !!el && !el.classList.contains(BOOT_SPLASH_HIDDEN);
}

/** Hide the HTML boot splash without removing it — .remove() breaks React on iOS nav. */
export function hideBootSplash() {
  const el = document.getElementById(BOOT_SPLASH_ID);
  if (!el) return;

  el.classList.add(BOOT_SPLASH_HIDDEN);
  el.setAttribute("aria-hidden", "true");
  el.style.animation = "none";
  for (const child of el.querySelectorAll("*")) {
    (child as HTMLElement).style.animation = "none";
  }
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
