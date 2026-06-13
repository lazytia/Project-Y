import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public Firebase web config — these values are baked into every client
 * bundle anyway, so exposing them here is the same surface as the page JS.
 * Used by /firebase-messaging-sw.js so the service worker doesn't have to
 * hardcode credentials.
 */
export function GET() {
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  return NextResponse.json(cfg);
}
