import { NextRequest, NextResponse } from "next/server";
import { pushToUid } from "@/lib/push-notify";
import { APP_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * Generic push notification to a single staff member. Used by manager-side
 * actions (approve/decline a request, etc.) to wake the staff's phone.
 *
 * Body: { uid: string; title?: string; body?: string; url?: string }
 *
 * The sending itself lives in lib/push-notify, shared with the session route.
 */
export async function POST(req: NextRequest) {
  let body: { uid?: string; title?: string; body?: string; url?: string };
  try {
    body = (await req.json()) as {
      uid?: string;
      title?: string;
      body?: string;
      url?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const uid = typeof body.uid === "string" ? body.uid.trim() : "";
  if (!uid) {
    return NextResponse.json({ error: "uid is required" }, { status: 400 });
  }

  const result = await pushToUid(uid, {
    title: (body.title ?? "").trim() || APP_NAME,
    body: (body.body ?? "").trim(),
    url: (body.url ?? "").trim() || "/staff",
  });

  return NextResponse.json(result);
}
