import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { CHEF_USERNAMES, OWNER_USERNAMES } from "@/lib/permissions";
import { dashboardKindFromEmail } from "@/lib/session-dashboard";
import { emailToUsername } from "@/lib/username";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function setSessionCookies(
  res: NextResponse,
  secure: boolean,
  uid: string,
  role: string,
  dashboard: string,
) {
  const base = { path: "/", maxAge: ONE_YEAR_SECONDS, sameSite: "lax" as const, secure, httpOnly: true };
  res.cookies.set("uid", uid, base);
  res.cookies.set("role", role, base);
  res.cookies.set("dash", dashboard, base);
}

function clearSessionCookies(res: NextResponse, secure: boolean) {
  const base = { path: "/", maxAge: 0, sameSite: "lax" as const, secure, httpOnly: true };
  for (const name of ["uid", "role", "dash"]) {
    res.cookies.set(name, "", base);
  }
}

function roleFromEmail(email: string | null | undefined): string {
  if (!email) return "staff";
  const username = emailToUsername(email).toLowerCase();
  if (OWNER_USERNAMES.has(username)) return "owner";
  if (CHEF_USERNAMES.has(username)) return "chef";
  return "staff";
}

export async function GET(request: NextRequest) {
  const uid = request.cookies.get("uid")?.value?.trim();
  if (!uid) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }
  try {
    const user = await adminAuth().getUser(uid);
    const role = roleFromEmail(user.email);
    const dashboard = dashboardKindFromEmail(user.email);
    const res = NextResponse.json(
      { authenticated: true, uid, role, dashboard },
      { status: 200 },
    );
    const secure = request.nextUrl.protocol === "https:";
    setSessionCookies(res, secure, uid, role, dashboard);
    return res;
  } catch {
    const res = NextResponse.json({ authenticated: false }, { status: 200 });
    const secure = request.nextUrl.protocol === "https:";
    clearSessionCookies(res, secure);
    return res;
  }
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ message: "Missing token." }, { status: 400 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const uid = decoded.uid;
    const role = roleFromEmail(decoded.email);
    const dashboard = dashboardKindFromEmail(decoded.email);

    const res = NextResponse.json({ ok: true, uid, role, dashboard }, { status: 200 });
    const secure = request.nextUrl.protocol === "https:";
    setSessionCookies(res, secure, uid, role, dashboard);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid token.";
    return NextResponse.json({ message }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  const secure = request.nextUrl.protocol === "https:";
  clearSessionCookies(res, secure);
  return res;
}
