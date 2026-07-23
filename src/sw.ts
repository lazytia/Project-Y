import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheableResponsePlugin,
  ExpirationPlugin,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

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
      matcher: ({ request }) => request.mode === "navigate",
      handler: new StaleWhileRevalidate({
        cacheName: "html-shell",
        plugins: [
          // Cache 0-status opaque responses too so cross-origin OK.
          new CacheableResponsePlugin({ statuses: [0, 200] }),
          new ExpirationPlugin({
            maxEntries: 32,
            // 7 days — long enough that repeat users get instant
            // shell, short enough that a stale cache still refreshes
            // eventually if nothing prompts a reload.
            maxAgeSeconds: 60 * 60 * 24 * 7,
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
