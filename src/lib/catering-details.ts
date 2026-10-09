/**
 * Validation for the owner's catering order details.
 *
 * Kept apart from the route so the rules can be read, and tested, without a
 * request: the route parses and authorises, this decides what is acceptable.
 */
import {
  CATERING_DETAILS_KEYS,
  toTimeLabel,
  type CateringDetailsOverride,
} from "@/lib/catering-orders";

const TEXT_LIMITS = {
  clientName: 120,
  companyName: 120,
  contactEmail: 120,
  deliveryAddress: 300,
} as const;

// Digits and the punctuation people type into a phone number — no letters, so
// a stray name can't end up in a field that becomes a tel: link.
const PHONE_RE = /^[0-9+()\-.\s]{3,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParsedDetails =
  | { ok: true; patch: CateringDetailsOverride }
  | { ok: false; error: string };

/**
 * Validate a details body field by field. A field that is null or blank means
 * "use Square's value" and is returned as null; a key that is absent is left
 * out so the stored value is not touched.
 */
export function parseDetailsPatch(body: Record<string, unknown>): ParsedDetails {
  const patch: CateringDetailsOverride = {};

  for (const key of CATERING_DETAILS_KEYS) {
    if (!(key in body)) continue;
    const raw = body[key];
    const blank = raw === null || (typeof raw === "string" && raw.trim() === "");

    if (key === "utensilsCount") {
      if (blank) {
        patch.utensilsCount = null;
        continue;
      }
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 9999) {
        return { ok: false, error: "utensilsCount must be a whole number from 0 to 9999." };
      }
      patch.utensilsCount = n;
      continue;
    }

    if (blank) {
      patch[key] = null;
      continue;
    }
    if (typeof raw !== "string") return { ok: false, error: `${key} must be text.` };
    const value = raw.trim();

    switch (key) {
      case "fulfillmentType":
        if (value !== "PICKUP" && value !== "DELIVERY") {
          return { ok: false, error: "fulfillmentType must be PICKUP or DELIVERY." };
        }
        patch.fulfillmentType = value;
        break;
      case "readyByTime": {
        // The client sends the raw <input type="time"> value; we own the
        // display format so it reads the same as a Square-sourced time.
        const label = toTimeLabel(value);
        if (!label) return { ok: false, error: "readyByTime must be HH:MM (24h)." };
        patch.readyByTime = label;
        break;
      }
      case "contactPhone":
        if (!PHONE_RE.test(value)) return { ok: false, error: "That phone number doesn't look right." };
        patch.contactPhone = value;
        break;
      case "contactEmail":
        if (value.length > TEXT_LIMITS.contactEmail || !EMAIL_RE.test(value)) {
          return { ok: false, error: "That email address doesn't look right." };
        }
        patch.contactEmail = value;
        break;
      default: {
        // clientName, companyName, deliveryAddress
        if (value.length > TEXT_LIMITS[key]) {
          return { ok: false, error: `${key} is too long (max ${TEXT_LIMITS[key]}).` };
        }
        patch[key] = value;
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nothing to save." };
  }
  return { ok: true, patch };
}
