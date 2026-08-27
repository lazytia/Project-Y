import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheableResponsePlugin,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
} from "serwist";

const HTML_SHELL_CACHE = "html-shell";

// When a new SW takes over, nuke the html-shell cache so we don't hand users
// an old HTML that references chunks the new deploy has replaced. The cache is
// only an offline fallback now (see the navigation route below), but a rollout
// is precisely when a fallback older than the running code would be reached
// for, so it still has to go.
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete(HTML_SHELL_CACHE));
});

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

importScripts("/fcm-push-handlers.js");

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // App-shell HTML.
    //
    // Must be first in the list — Serwist matches in order, so putting the
    // navigation matcher ahead of defaultCache stops defaultCache's own
    // handler from grabbing it.
    {
      // Network first, cache only as the offline/slow fallback.
      //
      // This was stale-while-revalidate, for the instant first frame: the SW
      // answered from cache so the boot splash painted without waiting on the
      // network. But our HTML is not session-neutral. The server bakes the
      // whole signed-in/signed-out decision into it — the `y-has-session`
      // class, the inline boot-splash dismiss, #server-app-shell with the
      // role's sidebar, and the `initialHasSession` props under it. Serving
      // that a generation stale means serving the *previous* session's answer:
      // after a sign-out the next launch re-painted signed-in chrome and then
      // had to unwind it, which is exactly the "signed out but still there,
      // press again, now it hangs" the owner reported.
      //
      // The network timeout keeps the original complaint answered — a launch
      // on a dead connection still falls back to the cached shell rather than
      // sitting on white — and the boot splash ships inside that HTML, so the
      // only cost on a healthy network is one round trip that
      // navigationPreload has already started in parallel.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: HTML_SHELL_CACHE,
        networkTimeoutSeconds: 3,
        plugins: [
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({ maxEntries: 32 }),
        ],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
