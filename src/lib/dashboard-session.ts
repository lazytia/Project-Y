import { cache } from "react";
import { cookies } from "next/headers";

export type ServerSession = {
  authenticated: boolean;
  uid: string | null;
  role: string | null;
};

/** Fast cookie read for SSR shell paint — no Firebase round-trip. */
export const readServerSession = cache(async (): Promise<ServerSession> => {
  const cookieStore = await cookies();
  const uid = cookieStore.get("uid")?.value?.trim() || null;
  const role = cookieStore.get("role")?.value?.trim() || null;
  return {
    authenticated: !!uid,
    uid,
    role,
  };
});
