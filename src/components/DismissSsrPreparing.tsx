"use client";

import { useEffect } from "react";

/** Removes the SSR preparing card once the client dashboard mounts. */
export default function DismissSsrPreparing() {
  useEffect(() => {
    document.getElementById("ssr-dash-preparing")?.remove();
  }, []);
  return null;
}
