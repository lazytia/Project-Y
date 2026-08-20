import { type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

/**
 * Shared plumbing for the routes under /api/reservations that proxy the
 * yurica-system booking platform. Every one of them needs the same base URL,
 * the same Origin workaround and the same token check, so they live here
 * rather than being copy-pasted into each route.
 */
export const BOOKING_API =
  "https://australia-southeast1-yurica-system.cloudfunctions.net/bookingApi";

/**
 * The booking platform's CORS middleware crashes (TypeError: Invalid URL)
 * when no Origin header is present — it falls back to "*" and tries
 * `new URL("*")`. Server-side fetch doesn't send Origin by default, so
 * spoof a value that's already on its allowlist.
 */
export const SPOOF_ORIGIN = "https://book.admin.yurica.com.au";

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Reject anything without a valid Firebase ID token. */
export async function verifyAuth(req: NextRequest): Promise<AuthResult> {
  const idToken = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return { ok: false, status: 401, error: "Missing bearer token." };
  try {
    await adminAuth().verifyIdToken(idToken);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      status: 401,
      error: `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export type BookingResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/**
 * Call the booking API and hand back a plain result, so each route stays free
 * to reshape the payload before returning it (the reservations list, for
 * instance, normalises statuses on the way out).
 */
export async function callBooking<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<BookingResult<T>> {
  const hasBody = init.body !== undefined;
  try {
    const upstream = await fetch(`${BOOKING_API}${path}`, {
      method: init.method ?? "GET",
      cache: "no-store",
      headers: {
        Origin: SPOOF_ORIGIN,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const error = (data as { error?: string })?.error ?? `Booking API failed (${upstream.status})`;
      return { ok: false, status: upstream.status, error };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "Booking API unreachable.",
    };
  }
}
