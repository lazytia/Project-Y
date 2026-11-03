/**
 * Where reservations come from — the owner-only Booking Sources page.
 *
 * The customer booking site (book.yurica.com.au) records an
 * `attribution.source` on every booking it takes since 2026-11-03; the
 * booking platform's /reservations/source-summary endpoint counts them.
 * Shared by the API route and the page so both agree on the source ids.
 */

/** Values of `attribution.source` written by the booking site's adTracking.ts. */
export type BookingSourceId =
  | "google_ads"
  | "ars"
  | "website"
  | "direct"
  | "google_organic"
  | "social"
  | "referral"
  | "campaign";

export type BookingSourceSummary = {
  days: number;
  /** ISO time the window starts from. */
  since: string;
  /** Bookings with a known source — the sum of `sources`. */
  total: number;
  sources: Partial<Record<BookingSourceId, number>>;
  /** Bookings with no source: entered by staff, or made before tracking began. */
  untracked: number;
  cancelled: number;
};

export const BOOKING_SOURCE_PERIODS = [7, 30, 90] as const;
export type BookingSourcePeriod = (typeof BOOKING_SOURCE_PERIODS)[number];
export const DEFAULT_BOOKING_SOURCE_PERIOD: BookingSourcePeriod = 30;

export type BookingSourceRow = {
  key: string;
  label: string;
  sources: BookingSourceId[];
  /** Always listed, even at zero. The rest only appear once they have bookings. */
  pinned: boolean;
};

export const BOOKING_SOURCE_ROWS: BookingSourceRow[] = [
  { key: "google_ads", label: "Google Ads", sources: ["google_ads"], pinned: true },
  { key: "ars", label: "ARS", sources: ["ars"], pinned: true },
  { key: "website", label: "Website", sources: ["website"], pinned: true },
  { key: "direct", label: "Direct", sources: ["direct"], pinned: true },
  { key: "google_organic", label: "Google Search", sources: ["google_organic"], pinned: false },
  { key: "social", label: "Social", sources: ["social"], pinned: false },
  { key: "other", label: "Other Links", sources: ["referral", "campaign"], pinned: false },
];
