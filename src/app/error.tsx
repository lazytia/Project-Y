"use client";

/**
 * Route-segment error boundary. Renders inside AppShell when any page
 * throws, so the chrome (sidebar, mobile header) stays intact and the
 * user can navigate away instead of being stuck on a full-screen crash.
 * global-error.tsx is still there as the outer safety net.
 */

import { useEffect } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div
      style={{
        maxWidth: 480,
        margin: "40px auto",
        padding: 24,
        background: "#fff",
        border: "1px solid #eee",
        borderRadius: 12,
        textAlign: "center",
        fontFamily: "var(--font-sans, Arial, sans-serif)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111" }}>
        Couldn&rsquo;t load this page
      </h2>
      <p
        style={{
          margin: "8px 0 20px",
          fontSize: 13,
          color: "#666",
          lineHeight: 1.5,
        }}
      >
        {error?.message || "Unexpected error."}
        {error?.digest ? ` (id: ${error.digest})` : ""}
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "8px 16px",
            border: "none",
            background: "#111",
            color: "#fff",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.history.back()}
          style={{
            padding: "8px 16px",
            border: "1px solid #ccc",
            background: "#fff",
            color: "#111",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Go back
        </button>
      </div>
    </div>
  );
}
