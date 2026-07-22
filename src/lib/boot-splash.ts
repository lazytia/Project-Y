const BOOT_SPLASH_ID = "boot-splash";

export function hideBootSplash() {
  const el = document.getElementById(BOOT_SPLASH_ID);
  if (el) el.classList.add("bootSplashHidden");
}

/**
 * Hide boot splash only after the app shell has layout (CSS applied).
 * Avoids a white flash when CSS modules arrive after the first React commit.
 */
export function hideBootSplashWhenSafe(maxAttempts = 90) {
  let attempts = 0;

  const tryHide = () => {
    const shell = document.querySelector("[data-app-shell='true']");
    const rect = shell?.getBoundingClientRect();
    const shellPainted = !!rect && rect.width > 0 && rect.height > 0;

    if (shellPainted || attempts >= maxAttempts) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          hideBootSplash();
        });
      });
      return;
    }

    attempts += 1;
    requestAnimationFrame(tryHide);
  };

  void document.fonts?.ready.then(tryHide).catch(tryHide);
  if (!document.fonts?.ready) tryHide();
}
