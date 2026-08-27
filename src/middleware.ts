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

  // Document loads only.
  //
  // The backfill exists for a cold boot: a legacy session that has `uid` but
  // never got `y_sess` needs the hint before Firebase hydrates, or the splash
  // hangs. A cold boot is always a document request, so restricting it there
  // costs nothing.
  //
  // What it buys is sign-out. That path clears `y_sess` in the browser and
  // then makes two more calls — an RSC navigation to /login and the DELETE
  // that finally drops `uid` — both of which still carry the live `uid`
  // cookie. Backfilling on either one hands the browser a brand new
  // `y_sess=1` after the sign-out has already cleared it, and since the app
  // shell trusts `y_sess` over Firebase, the user ends up signed out but
  // still looking at signed-in chrome, or at a splash waiting on a session
  // that no longer exists. The session API is excluded outright: it sets both
  // cookies deliberately, so nothing else should be writing them underneath.
  if (request.headers.get("RSC") === "1") {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
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
