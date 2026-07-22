"use client";

import { useEffect } from "react";
import { runWhenIdle } from "@/lib/run-when-idle";

const SW_PATH = "/sw.js";

/** Register Serwist after idle so first paint is never delayed. */
export default function SerwistRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    return runWhenIdle(() => {
      void navigator.serviceWorker.register(SW_PATH).catch(() => {
        /* offline / private mode */
      });
    }, 4000);
  }, []);

  return null;
}
