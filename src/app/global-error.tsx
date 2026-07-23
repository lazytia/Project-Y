"use client";

/**
 * Global error boundary. Catches errors thrown outside any route segment
 * (e.g. RootLayout, providers, ServerDashboardPreparing). Without this
 * Next.js renders the generic white "Application error: a client-side
 * exception has occurred" screen with no recovery affordance and no
 * message — users are stuck.
 *
 * Must include <html> + <body> because it replaces RootLayout when it
 * catches.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error to the browser console so we can see the real
    // stack in DevTools / Sentry when this fires in production.
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
          background: "#fafafa",
          color: "#111",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: 12,
            padding: 24,
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              margin: "0 auto 16px",
              borderRadius: "50%",
              background: "#fff5f0",
              color: "#e05a08",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 700,
            }}
            aria-hidden="true"
          >
            !
          </div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            Something went wrong
          </h1>
          <p
            style={{
              margin: "8px 0 20px",
              fontSize: 14,
              color: "#666",
              lineHeight: 1.5,
            }}
          >
            The app hit an unexpected error. Try again or reload the page.
            {error?.digest ? ` (id: ${error.digest})` : ""}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "10px 18px",
                border: "none",
                background: "#111",
                color: "#fff",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                // Force a hard reload so a stale SW cache can be replaced
                // by a fresh HTML shell.
                window.location.reload();
              }}
              style={{
                padding: "10px 18px",
                border: "1px solid #ccc",
                background: "#fff",
                color: "#111",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
