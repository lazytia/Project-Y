import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheableResponsePlugin,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
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
      // NetworkFirst for navigations: with `minInstances: 1` the server
      // is always warm, so we can afford to try the network on every
      // navigation and only fall back to cache when offline / slow.
      // StaleWhileRevalidate previously handed users an old HTML that
      // referenced JS chunks deleted by later deploys — the chunk 404s
      // then trapped the app on the boot splash. NetworkFirst avoids
      // that by always serving the freshest chunk manifest.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "html-shell",
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
