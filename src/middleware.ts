import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Backfill the client-readable `y_sess` cookie whenever `uid` is present so
 * boot splash can dismiss before Firebase hydrates (legacy sessions predating
 * y_sess never got the hint from /api/auth/session alone).
 */
export function middleware(request: NextRequest) {
  const uid = request.cookies.get("uid")?.value?.trim();
  const ySess = request.cookies.get("y_sess")?.value;
  if (!uid || ySess === "1") {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const secure = request.nextUrl.protocol === "https:";
  response.cookies.set("y_sess", "1", {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    secure,
    httpOnly: false,
  });
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-|apple-|splash/|manifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
