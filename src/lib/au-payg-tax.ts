/**
 * Australian PAYG withholding for weekly pay — aligned with ATO Schedule 1
 * (NAT 1004 / LI 2025-15) and the project's existing Google Sheet practice.
 *
 * Residents: Scale 2 (tax-free threshold claimed) — y = ax − b, x = floor(gross) + 0.99
 * WHV: Working Holiday Maker 15% on whole dollars (Scale 4 style — ignore cents)
 */

/** Scale 2 weekly coefficients where x is less than `max` (exclusive). */
const RESIDENT_SCALE2: Array<{ max: number; a: number; b: number }> = [
  { max: 361, a: 0, b: 0 },
  { max: 500, a: 0.16, b: 57.8462 },
  { max: 625, a: 0.26, b: 107.8462 },
  { max: 721, a: 0.18, b: 57.8462 },
  { max: 865, a: 0.189, b: 64.3365 },
  { max: 1282, a: 0.3227, b: 180.0385 },
  { max: 2596, a: 0.32, b: 176.5769 },
  { max: 3653, a: 0.39, b: 358.3077 },
  { max: Infinity, a: 0.47, b: 650.6154 },
];

const WHV_RATE = 0.15;

function roundToNearestDollar(amount: number): number {
  const whole = Math.floor(amount);
  const cents = amount - whole;
  return cents < 0.5 ? whole : whole + 1;
}

export function isWhvVisa(visaType: string): boolean {
  return /whv|working\s*holiday/i.test(visaType.trim());
}

/** Gross pay matching the sheet's column I formula. */
export function grossPayFromHours(
  weekRate: number,
  premiumRate: number,
  weekHours: number,
  premiumHours: number,
): number {
  const premium = premiumRate > 0 ? premiumRate : weekRate;
  return Math.round((weekRate * weekHours + premium * premiumHours) * 100) / 100;
}

export function calculateWeeklyPaygTax(visaType: string, grossPay: number): number {
  if (!Number.isFinite(grossPay) || grossPay <= 0) return 0;

  if (isWhvVisa(visaType)) {
    return roundToNearestDollar(Math.floor(grossPay) * WHV_RATE);
  }

  const x = Math.floor(grossPay) + 0.99;
  const bracket = RESIDENT_SCALE2.find((b) => x < b.max) ?? RESIDENT_SCALE2.at(-1)!;
  if (!bracket.a) return 0;
  return roundToNearestDollar(bracket.a * x - bracket.b);
}

export function parseSheetMoney(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  const cleaned = v.replace(/[,$\s]/g, "");
  if (!cleaned || cleaned === "-") return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
