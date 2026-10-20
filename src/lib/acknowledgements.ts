import type { User } from "firebase/auth";

/**
 * "I have read and understood" — a ticked acknowledgement of a set of
 * guidelines, as opposed to the drawn signature the Staff Handbook and Beer
 * Guide take (see document-signatures).
 *
 * Kept in its own collection rather than beside the signatures: those are PNG
 * images with a compliance route that insists on one, and this is a tick, a
 * time and the version of the wording that was ticked.
 *
 * Like the signatures it goes through our server, against the caller's verified
 * uid, rather than the browser's Firestore client — a record somebody can be
 * held to has to land on the server or not at all.
 */

export const ACKNOWLEDGEMENTS_COLLECTION = "guideline_acknowledgements";

const ENDPOINT = "/api/staff/acknowledgements";

/** One key per set of guidelines a person can acknowledge. */
export const GUIDELINE_KEYS = ["serviceEssentialsHall"] as const;
export type GuidelineKey = (typeof GUIDELINE_KEYS)[number];

export type Acknowledgement = {
  acknowledgedAt: Date | null;
  /** The wording that was acknowledged. */
  version: string;
};

export type Acknowledgements = Partial<Record<GuidelineKey, Acknowledgement>>;

/** What crosses the wire — dates do not survive JSON, so the route sends ISO. */
export type AcknowledgementWire = {
  acknowledgedAtISO: string | null;
  version: string;
};

function fromWire(w: AcknowledgementWire): Acknowledgement {
  const parsed = w.acknowledgedAtISO ? new Date(w.acknowledgedAtISO) : null;
  return {
    acknowledgedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    version: w.version,
  };
}

async function call(user: User, init?: RequestInit): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
    ...init,
    cache: "no-store",
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string })?.error ?? `Request failed (${res.status}).`);
  }
  return payload;
}

export async function fetchAcknowledgements(user: User): Promise<Acknowledgements> {
  const payload = (await call(user)) as Partial<Record<GuidelineKey, AcknowledgementWire>>;
  const out: Acknowledgements = {};
  for (const key of GUIDELINE_KEYS) {
    const entry = payload?.[key];
    if (entry) out[key] = fromWire(entry);
  }
  return out;
}

/** Resolves with the stored record, so the caller shows what the server kept
 *  rather than what it hoped it had sent. */
export async function saveAcknowledgement(
  user: User,
  key: GuidelineKey,
  version: string,
): Promise<Acknowledgement> {
  const payload = (await call(user, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, version }),
  })) as AcknowledgementWire;
  return fromWire(payload);
}
