"use client";

/**
 * Sends the chooser straight to this phone's own guide.
 *
 * The chooser asks a question the device can usually answer for itself, and
 * the person being asked is a new hire who has just been texted a link and
 * does not yet know what any of this is. One fewer thing to get wrong.
 *
 * Rendered only when the reader has not explicitly asked for the chooser, and
 * it never redirects when it cannot tell which phone this is — see
 * detectGuidePlatform. So the chooser remains what a desktop reader, an
 * unrecognised device, and anyone without JavaScript gets, which is why the
 * page still renders it in full behind this.
 *
 * And this is the only thing doing it. There was a middleware redirect in
 * front of this that would have covered the JavaScript-off reader as well; it
 * never ran in production, because App Hosting does not pass the browser's
 * user-agent through to the edge. Anything wanting to redirect earlier than
 * React needs an input other than that header — see src/middleware.ts.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { detectGuidePlatform } from "@/lib/pwa-display";
import { setupGuideRoute } from "@/lib/routes";

export default function PlatformRedirect() {
  const router = useRouter();

  useEffect(() => {
    const platform = detectGuidePlatform();
    if (!platform) return;
    // replace, not push: the chooser was a step nobody chose to take, and
    // leaving it in the history means the phone's own Back button lands on a
    // page that immediately sends them forward again.
    router.replace(setupGuideRoute(platform));
  }, [router]);

  return null;
}
