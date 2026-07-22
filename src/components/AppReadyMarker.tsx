"use client";

import { useEffect } from "react";
import { markAppReady } from "@/lib/app-ready";

/** Mount alongside any visible shell / splash so boot splash waits for React paint. */
export default function AppReadyMarker() {
  useEffect(() => {
    markAppReady();
  }, []);
  return null;
}
