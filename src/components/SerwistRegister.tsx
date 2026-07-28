"use client";

import { useEffect } from "react";
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

    const cancel = runWhenIdle(() => {
      void navigator.serviceWorker.register(SW_PATH).catch(() => {
        /* offline / private mode */
      });
    }, 4000);

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
