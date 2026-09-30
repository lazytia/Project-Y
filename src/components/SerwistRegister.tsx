"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isSetupGuidePath } from "@/lib/routes";
import { runWhenIdle } from "@/lib/run-when-idle";

const SW_PATH = "/sw.js";

/**
 * Register Serwist after idle so first paint is never delayed.
 *
 * Also listens for the SW controller-change event and force-reloads the
 * page once when a new SW takes over. Without this the old page keeps
 * running while the new SW serves *new* HTML that references chunks
 * which no longer exist in the old bundle → clicking a Link throws a
 * chunk-load error and trips the global error boundary. A one-shot
 * reload picks up the fresh code and eliminates that class of
 * "Application error" crash.
 */
export default function SerwistRegister() {
  const pathname = usePathname();
  /**
   * Skip the idle wait on the setup guide.
   *
   * Chrome will not fire `beforeinstallprompt` until a service worker is
   * registered, and that event is the only thing that can put a working
   * Install button in the bar above the page. Waiting for idle everywhere
   * else keeps registration off the critical path; waiting for it *here* is
   * waiting for the button on the one page whose entire purpose is installing.
   *
   * Read once, at mount, and deliberately not a dependency below: this
   * component lives for the whole document, and re-running the effect on
   * every navigation would re-arm its listeners and reset the one-shot
   * reload guard.
   */
  const eagerRef = useRef(isSetupGuidePath(pathname));

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let reloadedOnce = false;
    const onControllerChange = () => {
      if (reloadedOnce) return;
      reloadedOnce = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    const register = () => {
      void navigator.serviceWorker.register(SW_PATH).catch(() => {
        /* offline / private mode */
      });
    };
    let cancel: (() => void) | undefined;
    if (eagerRef.current) {
      register();
    } else {
      cancel = runWhenIdle(register, 4000);
    }

    // Belt-and-suspenders: if a JS chunk fails to load (typical when the
    // browser cached HTML from an older deploy whose chunks are gone),
    // reload once with a cache-busting flag so we're guaranteed to pull
    // fresh HTML and fresh chunk hashes.
    const CHUNK_RELOAD_KEY = "y.chunkReload";
    const onChunkError = (evt: PromiseRejectionEvent | ErrorEvent) => {
      const msg = String(
        (evt as PromiseRejectionEvent).reason?.message ??
          (evt as ErrorEvent).message ??
          "",
      );
      if (!/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(msg)) return;
      try {
        if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return;
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
      } catch {
        /* private mode — still allow reload */
      }
      window.location.reload();
    };
    window.addEventListener("error", onChunkError);
    window.addEventListener("unhandledrejection", onChunkError);

    return () => {
      cancel?.();
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      window.removeEventListener("error", onChunkError);
      window.removeEventListener("unhandledrejection", onChunkError);
    };
  }, []);

  return null;
}
