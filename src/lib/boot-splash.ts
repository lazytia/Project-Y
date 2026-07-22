const BOOT_SPLASH_ID = "boot-splash";

export function hideBootSplash() {
  const el = document.getElementById(BOOT_SPLASH_ID);
  if (el) el.classList.add("bootSplashHidden");
}

function hasSsrChrome() {
  return (
    !!document.getElementById("ssr-dash-preparing") ||
    !!document.getElementById("server-app-shell")
  );
}

/**
 * Hide boot splash once SSR chrome or the client shell is painted.
 */
export function hideBootSplashWhenSafe(maxAttempts = 30) {
  if (hasSsrChrome()) {
    hideBootSplash();
    return;
  }

  let attempts = 0;
  const tryHide = () => {
    const shell = document.querySelector("[data-app-shell='true']");
    const rect = shell?.getBoundingClientRect();
    const shellPainted = !!rect && rect.width > 0 && rect.height > 0;

    if (shellPainted || hasSsrChrome() || attempts >= maxAttempts) {
      hideBootSplash();
      return;
    }

    attempts += 1;
    requestAnimationFrame(tryHide);
  };

  tryHide();
}
