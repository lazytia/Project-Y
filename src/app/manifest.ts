import type { MetadataRoute } from "next";
import { headers } from "next/headers";

function requestOrigin(headerStore: Awaited<ReturnType<typeof headers>>): string {
  const host =
    headerStore.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    headerStore.get("host")?.trim() ||
    "project.yurica.com.au";
  const proto =
    headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  return `${proto}://${host}`;
}

/** Dynamic manifest — iOS needs absolute start_url/scope/id on custom domains. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const origin = requestOrigin(await headers());

  return {
    id: `${origin}/`,
    name: "Project Y",
    short_name: "Project Y",
    description: "Project Y operations app",
    start_url: `${origin}/`,
    scope: `${origin}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#111111",
    theme_color: "#111111",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
