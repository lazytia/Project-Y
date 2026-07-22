"use client";

import { useEffect } from "react";
import { APP_READY_EVENT } from "@/lib/app-ready";

function hideBootSplash() {
  const el = document.getElementById("boot-splash");
  if (el) el.classList.add("bootSplashHidden");
}

/** Wait two animation frames so the browser has actually painted before we hide. */
function hideAfterPaint() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      hideBootSplash();
    });
  });
}

const FALLBACK_MS = 12_000;

/**
 * Keeps the inline HTML boot splash visible until the client app mounts real UI.
 * Previously we hid it as soon as a session cookie existed — that left a long
 * blank white gap while JS bundles downloaded on cold start.
 */
export default function BootSplashDismiss() {
  useEffect(() => {
    let hidden = false;
    const hideOnce = () => {
      if (hidden) return;
      hidden = true;
      hideAfterPaint();
    };

    const onReady = () => hideOnce();
    window.addEventListener(APP_READY_EVENT, onReady);

    const fallback = window.setTimeout(hideOnce, FALLBACK_MS);

    return () => {
      window.removeEventListener(APP_READY_EVENT, onReady);
      window.clearTimeout(fallback);
    };
  }, []);

  return null;
}
