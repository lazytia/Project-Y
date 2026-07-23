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

    return () => {
      cancel?.();
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  return null;
}
