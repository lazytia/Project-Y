"use client";

import { useCallback, useEffect, useState } from "react";
import {
  clearInstallPrompt,
  INSTALL_PROMPT_EVENT,
  INSTALL_PROMPT_READY,
  readInstallPrompt,
  type InstallPromptEvent,
} from "./pwa-display";

/**
 * Chromium's deferred install prompt, and the one tap that spends it.
 *
 * Two places want this — the bar across the top of the page and the Android
 * card on the chooser — and they want exactly the same thing: an event if
 * there is one, a way to fire it, and nothing left over afterwards.
 *
 * It is collected two ways on purpose.
 *
 * The head script (INSTALL_PROMPT_CAPTURE_SCRIPT) is the head start: it is the
 * first script in the document, so it catches the event even when the callers
 * are still being fetched — both of them are behind `dynamic(ssr:false)` or a
 * hydration boundary.
 *
 * Listening here as well is the guarantee. The head start is an inline script
 * assembled at build time, and when the build corrupted that string the whole
 * install feature went quiet with nothing on screen to say so: Chrome kept
 * offering the install in the address bar, and every button we had went
 * missing at once, on every device, for as long as it took somebody to notice
 * and report it. A component that also listens for itself cannot fail that
 * way. It costs one listener and it is, in the ordinary case, the one that
 * hears first anyway — Chrome will not fire until a service worker is
 * registered, and the thing that registers ours is a React component.
 */
export function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    // Never downgrades a prompt we are already holding to null. The stash is
    // emptied on `appinstalled` and announced in the same breath, and that
    // announcement must not be the thing that decides we have nothing — the
    // handler below owns that, and runs whichever order the two arrive in.
    const collect = () => setInstallPrompt((held) => readInstallPrompt() ?? held);
    const capture = (event: Event) => {
      // Suppress Chrome's own mini-infobar; we are showing the offer ourselves
      // and two of them is one too many.
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const forget = () => setInstallPrompt(null);

    collect();
    window.addEventListener(INSTALL_PROMPT_READY, collect);
    window.addEventListener(INSTALL_PROMPT_EVENT, capture);
    window.addEventListener("appinstalled", forget);
    return () => {
      window.removeEventListener(INSTALL_PROMPT_READY, collect);
      window.removeEventListener(INSTALL_PROMPT_EVENT, capture);
      window.removeEventListener("appinstalled", forget);
    };
  }, []);

  /** Fires the prompt and reports what the reader chose, or null if there was
   *  nothing to fire. */
  const install = useCallback(async () => {
    if (!installPrompt) return null;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    // Single-use either way — a second prompt() throws. Cleared in the stash
    // as well, or the next thing to mount collects a spent event.
    clearInstallPrompt();
    setInstallPrompt(null);
    return outcome;
  }, [installPrompt]);

  return { installPrompt, install };
}
