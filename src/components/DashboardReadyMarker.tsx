"use client";

import { useEffect } from "react";
import { markDashboardReady } from "@/lib/app-ready";

/** Mount when dashboard skeleton or live dashboard paints — boot splash waits for this. */
export default function DashboardReadyMarker() {
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        markDashboardReady();
      });
    });
  }, []);
  return null;
}
