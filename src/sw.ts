import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheableResponsePlugin,
  ExpirationPlugin,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

const HTML_SHELL_CACHE = "html-shell";

// When a new SW takes over, nuke the html-shell cache so we don't hand
// users an old HTML that references chunks the new deploy has replaced.
// Combined with SWR + controllerchange reload in SerwistRegister, this
// keeps cold navigations instant (cache hit) while guaranteeing that
// no stale HTML survives across a rollout.
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
    // App-shell HTML: return the cached HTML instantly (so the boot
    // splash paints on the first frame after tap-to-launch) and
    // revalidate in the background. Owner reported a blank white
    // frame before our splash appeared on repeat launches — this
    // eliminates it because the SW answers the navigation request
    // from cache without waiting for the network.
    //
    // Must be first in the list — Serwist matches in order, so
    // putting the navigation matcher ahead of defaultCache stops
    // defaultCache's NetworkFirst handler from grabbing it.
    {
      // SWR for navigations gives instant paint from cache (boot splash
      // appears on the first frame) while the SW revalidates in the
      // background. Stale-chunk risk is mitigated by the `activate`
      // handler above (nukes html-shell on new SW takeover) plus the
      // ChunkLoadError auto-reload in SerwistRegister.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new StaleWhileRevalidate({
        cacheName: HTML_SHELL_CACHE,
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
