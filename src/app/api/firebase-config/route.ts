import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public Firebase web config — these values are baked into every client
 * bundle anyway, so exposing them here is the same surface as the page JS.
 * Used by /firebase-messaging-sw.js so the service worker doesn't have to
 * hardcode credentials.
 *
 * In App Hosting the runtime sets FIREBASE_WEBAPP_CONFIG (JSON) automatically.
 * Locally we fall back to the individual NEXT_PUBLIC_* env vars.
 */
export function GET() {
  const webapp = process.env.FIREBASE_WEBAPP_CONFIG;
  if (webapp) {
    try {
      return NextResponse.json(JSON.parse(webapp));
    } catch {
      // fall through to the env-var fallback
    }
  }
  return NextResponse.json({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
}
