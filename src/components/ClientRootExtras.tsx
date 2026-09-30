"use client";

import dynamic from "next/dynamic";

/** Non-critical — register after first paint so they don't bloat the critical path. */
const AuthSessionKeeper = dynamic(() => import("./AuthSessionKeeper"), { ssr: false });
const SerwistRegister = dynamic(() => import("./SerwistRegister"), { ssr: false });
/** ssr:false is load-bearing here, not just a budget call: whether this
 *  renders at all depends on display-mode, which the server cannot know. */
const InstallBanner = dynamic(() => import("./InstallBanner"), { ssr: false });

export default function ClientRootExtras() {
  return (
    <>
      <AuthSessionKeeper />
      <SerwistRegister />
      <InstallBanner />
    </>
  );
}
