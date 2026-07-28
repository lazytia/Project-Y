"use client";

import dynamic from "next/dynamic";

/** Non-critical — register after first paint so they don't bloat the critical path. */
const AuthSessionKeeper = dynamic(() => import("./AuthSessionKeeper"), { ssr: false });
const SerwistRegister = dynamic(() => import("./SerwistRegister"), { ssr: false });

export default function ClientRootExtras() {
  return (
    <>
      <AuthSessionKeeper />
      <SerwistRegister />
    </>
  );
}
