import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { guidePlatformFromUserAgent } from "./lib/pwa-display";
import { GUIDE_CHOOSE_PARAM, ROUTES, setupGuideRoute } from "./lib/routes";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Send the setup-guide link straight to the guide for the phone holding it.
 *
 * `/guide_link` is the URL texted to a new hire, so it has to keep answering;
 * what it no longer does is ask a question the request already contains. Done
 * here rather than in the page because the edge can answer before any HTML
 * exists: the chooser is not rendered and then replaced, it is never built.
 * That also makes it work with JavaScript off, which the page cannot.
 *
 * The page still exists behind this for the two cases the header cannot
 * settle — an iPad, which is indistinguishable from a laptop here, and an
 * actual laptop. The iPad is then caught in the browser by detectGuidePlatform.
 */
function guideRedirect(request: NextRequest): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl;
  // The guides themselves are under this path and must be left alone.
  if (pathname !== ROUTES.setupGuide) return null;
  if (searchParams.has(GUIDE_CHOOSE_PARAM)) return null;

  const ua = request.headers.get("user-agent") ?? "";
  const platform = guidePlatformFromUserAgent(ua);
  if (!platform) {
    // TEMPORARY, like SPLASH_TRACE — remove once this has been read once.
    //
    // This redirect returns a 307 for an iPhone user-agent on a local
    // production build and a 200 on App Hosting, for the same commit, while
    // middleware is demonstrably running there (the y_sess backfill below
    // fires on the deployed site). That leaves the inputs, and the only input
    // this branch has is the header. Echoing what the edge actually received
    // settles it in one request instead of another round of guessing.
    //
    // Safe to ship: it is the caller's own header, on one public path, and
    // the guide has no session to backfill so nothing below is skipped.
    const seen = NextResponse.next();
    seen.headers.set("x-y-guide-ua", ua === "" ? "(empty)" : ua);
    seen.headers.set("Vary", "user-agent");
    return seen;
  }

  const url = request.nextUrl.clone();
  url.pathname = setupGuideRoute(platform);
  // 307, and never 308: the destination is a property of the device asking,
  // not of the address. A permanent redirect would be remembered by the one
  // browser that followed it and handed to whatever opens the link next.
  const response = NextResponse.redirect(url, 307);
  // The response differs by request header, so anything caching it has to key
  // on that header. Without this a CDN can hand an Android hit to an iPhone.
  response.headers.set("Vary", "user-agent");
  return response;
}

/**
 * Backfill the client-readable `y_sess` cookie whenever `uid` is present so
 * boot splash can dismiss before Firebase hydrates (legacy sessions predating
 * y_sess never got the hint from /api/auth/session alone).
 */
export function middleware(request: NextRequest) {
  // Before the cookie backfill: this leaves the app rather than entering it,
  // and the reader has no session to backfill for in the first place.
  const guide = guideRedirect(request);
  if (guide) return guide;

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
