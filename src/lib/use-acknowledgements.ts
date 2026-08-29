"use client";

/**
 * The acknowledgements payload, for the pages that render it.
 *
 * Three screens read the same owner-only endpoint — the HR Records hub for
 * its two counts, the Acknowledgements list, and the per-document page — and
 * each would otherwise carry its own copy of the token, fetch and error
 * dance. The counting itself lives in `hr-acknowledgements`, which the server
 * route shares; this is only how a page gets hold of the numbers.
 */

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { fetchAcknowledgements, type AcknowledgementsPayload } from "./hr-acknowledgements";

export type AcknowledgementsState = {
  payload: AcknowledgementsPayload | null;
  /** True until the first answer lands. Pages show "—" rather than 0 while
   *  it is set: a zero here reads as "nobody owes a signature", which is the
   *  opposite of "we haven't asked yet". */
  loading: boolean;
  error: string | null;
};

export function useAcknowledgements(user: User | null | undefined): AcknowledgementsState {
  const [payload, setPayload] = useState<AcknowledgementsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No user yet means auth is still hydrating, not that there is nothing to
    // fetch — stay in the loading state rather than reporting an empty roster.
    if (!user) return;
    let alive = true;
    setLoading(true);
    fetchAcknowledgements(user)
      .then((next) => {
        if (!alive) return;
        setPayload(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Could not load acknowledgements.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  return { payload, loading, error };
}
