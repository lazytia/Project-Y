"use client";

import { useEffect } from "react";
import { markDashboardReady } from "@/lib/app-ready";

type Props = {
  /** Only signal readiness when the final dashboard layout is visible. */
  when?: boolean;
};

export default function DashboardReadyMarker({ when = true }: Props) {
  useEffect(() => {
    if (!when) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        markDashboardReady();
      });
    });
  }, [when]);

  return null;
}
