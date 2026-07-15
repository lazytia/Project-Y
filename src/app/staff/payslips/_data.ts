/**
 * Shared formatting helpers + shape for the staff payslips flow. The
 * actual rows come from GET /api/staff/payslips (which reads the shared
 * payroll Google Sheet, matches by the signed-in staff member's name).
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
