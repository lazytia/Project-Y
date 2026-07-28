"use client";

import { useLayoutEffect } from "react";
import { markAppReady } from "@/lib/app-ready";

/** Mount alongside any visible shell / splash so boot splash waits for React paint. */
export default function AppReadyMarker() {
  useLayoutEffect(() => {
    markAppReady();
  }, []);
  return null;
}
