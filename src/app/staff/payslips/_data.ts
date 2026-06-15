/**
 * Placeholder payslip data — the real source will be a Firestore collection
 * once payroll is wired up. Keeping this in one place so the list page and
 * the detail page render the same numbers.
 */
export type Payslip = {
  id: string;
  payDate: string;          // ISO YYYY-MM-DD
  periodStart: string;
  periodEnd: string;
  grossPay: number;
  tax: number;
  super: number;
  netPay: number;
};

export const NEXT_PAY_DATE_ISO = "2026-06-18";
export const PAY_FREQUENCY = "Paid weekly";

export const PAYSLIPS: Payslip[] = [
  {
    id: "p-2026-06-11",
    payDate: "2026-06-11",
    periodStart: "2026-06-02",
    periodEnd: "2026-06-08",
    grossPay: 712.50,
    tax: 70.00,
    super: 67.69,
    netPay: 642.50,
  },
  {
    id: "p-2026-06-04",
    payDate: "2026-06-04",
    periodStart: "2026-05-26",
    periodEnd: "2026-06-01",
    grossPay: 645.00,
    tax: 63.80,
    super: 61.28,
    netPay: 581.20,
  },
  {
    id: "p-2026-05-28",
    payDate: "2026-05-28",
    periodStart: "2026-05-19",
    periodEnd: "2026-05-25",
    grossPay: 780.40,
    tax: 77.30,
    super: 74.14,
    netPay: 703.10,
  },
  {
    id: "p-2026-05-21",
    payDate: "2026-05-21",
    periodStart: "2026-05-12",
    periodEnd: "2026-05-18",
    grossPay: 680.00,
    tax: 67.25,
    super: 64.60,
    netPay: 612.75,
  },
  {
    id: "p-2026-05-14",
    payDate: "2026-05-14",
    periodStart: "2026-05-05",
    periodEnd: "2026-05-11",
    grossPay: 663.60,
    tax: 65.30,
    super: 63.04,
    netPay: 598.30,
  },
];

export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtPeriod(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const sameYear = sy === ey;
  const sameMonth = sameYear && sm === em;
  const startStr = new Date(sy, sm - 1, sd).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
  const endStr = new Date(ey, em - 1, ed).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  if (sameMonth) {
    return `${sd.toString().padStart(2, "0")} – ${endStr}`;
  }
  return `${startStr} – ${endStr}`;
}
