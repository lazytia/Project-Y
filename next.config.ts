import type { NextConfig } from "next";
import path from "path";
import withSerwistInit from "@serwist/next";

const projectRoot = path.join(__dirname);

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
  async redirects() {
    return [
      {
        source: "/manifest.json",
        destination: "/manifest.webmanifest",
        permanent: true,
      },
      // The Documents & Training page is gone: its Handbook & Training half is
      // a page of its own now and My Documents is the upload page. An old
      // bookmark or notification opens the one people were most likely after.
      // Not permanent — the destination may well change again.
      {
        source: "/staff/documents",
        destination: "/staff/documents/uploads",
        permanent: false,
      },
    ];
  },
};

export default withSerwist(nextConfig);
