import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminMessaging } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

const NOTIFICATION_TITLE = "Onboarding Reminder";
const NOTIFICATION_BODY =
  "Please submit your onboarding documents as soon as possible.";
const LANDING_URL = "/onboarding";

export async function POST(req: NextRequest) {
  let body: { uid?: string; message?: string };
  try {
    body = (await req.json()) as { uid?: string; message?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const uid = body.uid?.trim();
  if (!uid) {
    return NextResponse.json({ error: "uid is required" }, { status: 400 });
  }

  const snap = await adminDb().collection("staff_onboarding").doc(uid).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Staff not found" }, { status: 404 });
  }
  const data = snap.data() ?? {};
  const tokens: string[] = Array.isArray(data.fcmTokens)
    ? data.fcmTokens.filter((t: unknown): t is string => typeof t === "string" && t.length > 0)
    : [];

  if (tokens.length === 0) {
    return NextResponse.json(
      {
        delivered: 0,
        reason: "No FCM tokens — staff hasn't opened the app with notifications allowed yet.",
      },
      { status: 200 },
    );
  }

  const messageBody = body.message?.trim() || NOTIFICATION_BODY;

  // For iOS PWA web push the notification fields must live under webpush.notification.
  // Sending them only there (no top-level `notification`) avoids a duplicate
  // shown by some FCM SDK paths.
  const res = await adminMessaging().sendEachForMulticast({
    tokens,
    data: {
      url: LANDING_URL,
      tag: "onboarding-reminder",
    },
    webpush: {
      fcmOptions: { link: LANDING_URL },
      notification: {
        title: NOTIFICATION_TITLE,
        body: messageBody,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "onboarding-reminder",
        renotify: true,
        requireInteraction: false,
      },
    },
  });

  // Drop tokens that the FCM server reports as invalid so we don't keep retrying them.
  const invalidTokens: string[] = [];
  res.responses.forEach((r, i) => {
    if (
      !r.success &&
      r.error &&
      [
        "messaging/invalid-registration-token",
        "messaging/registration-token-not-registered",
      ].includes(r.error.code)
    ) {
      invalidTokens.push(tokens[i]);
    }
  });
  if (invalidTokens.length > 0) {
    const remaining = tokens.filter((t) => !invalidTokens.includes(t));
    await adminDb()
      .collection("staff_onboarding")
      .doc(uid)
      .update({ fcmTokens: remaining });
  }

  return NextResponse.json({
    delivered: res.successCount,
    failed: res.failureCount,
  });
}
