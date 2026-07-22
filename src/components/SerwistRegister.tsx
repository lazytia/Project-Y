"use client";

import { useEffect } from "react";

const SW_PATH = "/sw.js";

/**
 * Registers the Serwist service worker so repeat PWA cold starts serve
 * JS/CSS from cache instead of waiting on the network.
 */
export default function SerwistRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register(SW_PATH).catch(() => {
      /* offline / private mode — ignore */
    });
  }, []);

  return null;
}
