/**
 * Reads the weekly Pay History totals from a Google Sheet.
 *
 * The source sheet (per request, 14HlHX24fN8GcryjIaBRvjZtmAGuQK7dElAcV4JXr1Qk
 * tab gid=1573785687) stores one table per pay week. Each table starts
 * with a header row like "Pay History (08/06/26 - 14/06/26)" and ends
 * with a "Total" row that has the week's grand total in the
 * "Total Inc Super" column. We pull that grand total per week and key
 * the result by the Monday ISO date so the Insights dashboard can match.
 *
 * Env vars:
 *   PAYROLL_SHEET_ID   — spreadsheet ID (default: the project sheet)
 *   PAYROLL_SHEET_NAME — sheet tab name (used as the read range)
 *   GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_JSON —
 *     service account that has Viewer access to the sheet. (Share the
 *     sheet with that service account's email.)
 */
import { existsSync } from "node:fs";
import { google } from "googleapis";

const DEFAULT_SHEET_ID = "14HlHX24fN8GcryjIaBRvjZtmAGuQK7dElAcV4JXr1Qk";
const DEFAULT_TAB_NAME = "Tax Calculator";

function payrollSheetRange(): string {
  if (process.env.PAYROLL_SHEET_RANGE) return process.env.PAYROLL_SHEET_RANGE;
  const tab = process.env.PAYROLL_SHEET_NAME ?? DEFAULT_TAB_NAME;
  return `'${tab}'!A:Z`;
}

export type WeeklyPayrollRow = {
  weekStartISO: string;   // Monday of the pay week (YYYY-MM-DD)
  weekEndISO: string;     // Sunday of the pay week
  totalIncSuper: number;  // dollars
};

export type EmployeePayRow = {
  name: string;
  netPay: number;
  tax: number;
  superAnn: number;
  cashPay: number;
  totalIncSuper: number;
};

export type WeekPayrollDetail = {
  weekStartISO: string;
  weekEndISO: string;
  employees: EmployeePayRow[];
  totals: {
    netPay: number;
    tax: number;
    superAnn: number;
    cashPay: number;
    totalIncSuper: number;
  };
};

const HEADER_RE = /Pay\s+History\s*\((\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-–—]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i;

function ddmmToIso(d: string, m: string, y: string): string {
  const day = parseInt(d, 10);
  const mon = parseInt(m, 10);
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  const iso = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso;
}

function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[,$\s]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function authClient() {
  // Prefer a sheet-specific service account JSON (set as
  // PAYROLL_SHEET_SA_JSON in Secret Manager) so we don't have to grant
  // the Firebase Admin SA extra scopes for Google Sheets. Fall back to
  // FIREBASE_SERVICE_ACCOUNT_JSON for backwards compat, then to ADC.
  const inline = (process.env.PAYROLL_SHEET_SA_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT_JSON)?.trim();
  if (inline) {
    const creds = JSON.parse(inline);
    return new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }
  // If GOOGLE_APPLICATION_CREDENTIALS points at a stale path that no
  // longer exists (very common on dev machines), drop it so the SDK
  // can fall back to gcloud user ADC.
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && !existsSync(credPath)) {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  return new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    // Without an explicit quota project, gcloud user ADC tokens are
    // rejected with 401 because Sheets API requires a billable project.
    projectId:
      process.env.GCLOUD_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      "project-y-d04dc",
  });
}

async function readPayrollSheetRows(): Promise<unknown[][]> {
  const sheetId = process.env.PAYROLL_SHEET_ID ?? DEFAULT_SHEET_ID;
  const range = payrollSheetRange();
  const auth = authClient();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (res.data.values ?? []) as unknown[][];
}

/** One sheet read — reuse across multiple week parses in a single request. */
export async function fetchPayrollSheetRows(): Promise<unknown[][]> {
  return readPayrollSheetRows();
}

function weekStartMatches(header: RegExpExecArray, weekStartISO: string): boolean {
  const wsISO = ddmmToIso(header[1], header[2], header[3]);
  if (wsISO === weekStartISO) return true;
  const wantYear = weekStartISO.slice(0, 4);
  const wantMonth = weekStartISO.slice(5, 7);
  const wantDay = weekStartISO.slice(8, 10);
  return (
    header[1].padStart(2, "0") === wantDay &&
    header[2].padStart(2, "0") === wantMonth &&
    (header[3].length === 4 ? header[3] : `20${header[3]}`) === wantYear
  );
}

type MoneyCols = {
  employeeCol: number;
  netPayCol: number;
  taxCol: number;
  superCol: number;
  cashPayCol: number;
  totalIncCol: number;
};

function resolveMoneyCols(cols: unknown[]): MoneyCols {
  function findCol(...patterns: RegExp[]): number {
    for (let k = 0; k < cols.length; k += 1) {
      const c = cols[k];
      if (typeof c !== "string") continue;
      for (const p of patterns) if (p.test(c)) return k;
    }
    return -1;
  }
  return {
    employeeCol: findCol(/^\s*employee\s*$/i, /^\s*staff\s*$/i, /^\s*name\s*$/i, /employee|staff|name/i),
    netPayCol: findCol(
      /^\s*net\s*pay\s*$/i,
      /net\s*(pay|wage|amount)/i,
      /take[\s-]?home/i,
    ),
    taxCol: findCol(/^\s*tax\s*$/i, /payg/i, /withhold/i),
    superCol: findCol(/superannuation/i, /super\s*ann/i, /super\s*guarantee/i, /^\s*super\s*$/i, /^\s*sga\s*$/i),
    cashPayCol: findCol(
      /^\s*cash\s*pay\s*$/i,
      /^\s*cash\s*$/i,
      /cash\s*(pay|wage|amount)/i,
      /paid\s*in\s*cash/i,
    ),
    totalIncCol: findCol(/total\s*inc\s*super/i, /total\s*payroll/i),
  };
}

function totalsFromMoneyRow(
  r: unknown[],
  cols: MoneyCols,
): WeekPayrollDetail["totals"] | null {
  const netPay = cols.netPayCol >= 0 ? parseMoney(r[cols.netPayCol]) ?? 0 : 0;
  const tax = cols.taxCol >= 0 ? parseMoney(r[cols.taxCol]) ?? 0 : 0;
  const superAnn = cols.superCol >= 0 ? parseMoney(r[cols.superCol]) ?? 0 : 0;
  const cashPay = cols.cashPayCol >= 0 ? parseMoney(r[cols.cashPayCol]) ?? 0 : 0;
  const rawTotalInc = cols.totalIncCol >= 0 ? parseMoney(r[cols.totalIncCol]) ?? 0 : 0;
  const totalIncSuper =
    rawTotalInc > 0 ? rawTotalInc : netPay + tax + superAnn + cashPay;
  if (totalIncSuper <= 0) return null;
  return {
    netPay: Math.round(netPay * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    superAnn: Math.round(superAnn * 100) / 100,
    cashPay: Math.round(cashPay * 100) / 100,
    totalIncSuper: Math.round(totalIncSuper * 100) / 100,
  };
}

export function isEmptyPayrollDetail(d: WeekPayrollDetail | null | undefined): boolean {
  if (!d) return true;
  return d.employees.length === 0 && (d.totals.totalIncSuper ?? 0) <= 0;
}

export function parseWeeklyPayrollTotalsFromRows(
  rows: unknown[][],
): Record<string, WeeklyPayrollRow> {
  const out: Record<string, WeeklyPayrollRow> = {};

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    let header: RegExpExecArray | null = null;
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      const m = HEADER_RE.exec(cell);
      if (m) { header = m; break; }
    }
    if (!header) continue;

    const weekStartISO = ddmmToIso(header[1], header[2], header[3]);
    const weekEndISO = ddmmToIso(header[4], header[5], header[6]);

    let colHeaderIdx = -1;
    let totalIncSuperCol = -1;
    for (let j = i + 1; j < Math.min(i + 4, rows.length); j += 1) {
      const r = rows[j] ?? [];
      const idx = r.findIndex(
        (c) => typeof c === "string" && /total\s*inc\s*super/i.test(c),
      );
      if (idx !== -1) {
        colHeaderIdx = j;
        totalIncSuperCol = idx;
        break;
      }
    }
    if (totalIncSuperCol === -1) continue;

    const TOTAL_RE = /^\s*(grand\s+)?total\s*:?\s*$/i;
    let employeeSum = 0;
    let employeeSumCount = 0;
    const totalRows: { row: unknown[]; isGrand: boolean }[] = [];
    for (let j = colHeaderIdx + 1; j < rows.length; j += 1) {
      const r = rows[j] ?? [];
      let hitNext = false;
      for (const cell of r) {
        if (typeof cell === "string" && HEADER_RE.test(cell)) { hitNext = true; break; }
      }
      if (hitNext) break;

      let isSummary = false;
      let isGrand = false;
      for (let k = 0; k < Math.min(3, r.length); k += 1) {
        const cell = r[k];
        if (typeof cell !== "string") continue;
        if (/^\s*grand\s+total\s*:?\s*$/i.test(cell)) { isSummary = true; isGrand = true; break; }
        if (TOTAL_RE.test(cell)) { isSummary = true; break; }
      }
      if (isSummary) {
        totalRows.push({ row: r, isGrand });
        continue;
      }

      const val = parseMoney(r[totalIncSuperCol]);
      if (val === null) continue;
      employeeSum += val;
      employeeSumCount += 1;
    }

    let totalIncSuper: number | null = null;
    if (employeeSumCount > 0) {
      totalIncSuper = Math.round(employeeSum * 100) / 100;
    } else if (totalRows.length > 0) {
      const grand = totalRows.find((t) => t.isGrand);
      const totalRow = grand?.row ?? totalRows[totalRows.length - 1].row;
      totalIncSuper = parseMoney(totalRow[totalIncSuperCol]);
    }
    if (totalIncSuper === null) continue;

    out[weekStartISO] = { weekStartISO, weekEndISO, totalIncSuper };
  }

  return out;
}

/**
 * Fetch every weekly Pay History total visible on the configured tab.
 * Returns a map keyed by the Monday ISO date (e.g. "2026-06-08").
 */
export async function fetchWeeklyPayrollTotals(): Promise<Record<string, WeeklyPayrollRow>> {
  const rows = await readPayrollSheetRows();
  return parseWeeklyPayrollTotalsFromRows(rows);
}

export function parseWeekPayrollDetailFromRows(
  rows: unknown[][],
  weekStartISO: string,
): WeekPayrollDetail | null {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    let header: RegExpExecArray | null = null;
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      const m = HEADER_RE.exec(cell);
      if (m) {
        header = m;
        break;
      }
    }
    if (!header || !weekStartMatches(header, weekStartISO)) continue;

    const weekEndISO = ddmmToIso(header[4], header[5], header[6]);

    let colHeaderIdx = -1;
    let cols: unknown[] = [];
    for (let j = i + 1; j < Math.min(i + 5, rows.length); j += 1) {
      const r = rows[j] ?? [];
      const hasIncSuper = r.some(
        (c) => typeof c === "string" && /total\s*inc\s*super/i.test(c),
      );
      if (hasIncSuper) {
        colHeaderIdx = j;
        cols = r;
        break;
      }
    }
    if (colHeaderIdx === -1) return null;

    const moneyCols = resolveMoneyCols(cols);
    const {
      employeeCol,
      netPayCol,
      taxCol,
      superCol,
      cashPayCol,
      totalIncCol,
    } = moneyCols;

    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      console.log("[payroll-sheet] cols for", weekStartISO, {
        employeeCol,
        netPayCol,
        taxCol,
        superCol,
        cashPayCol,
        totalIncCol,
        headerRow: cols,
      });
    }

    const employees: EmployeePayRow[] = [];
    let totalNet = 0;
    let totalTax = 0;
    let totalSuper = 0;
    let totalCash = 0;
    let totalInc = 0;
    const summaryRows: { row: unknown[]; isGrand: boolean }[] = [];

    for (let j = colHeaderIdx + 1; j < rows.length; j += 1) {
      const r = rows[j] ?? [];
      const hitNext = r.some((c) => typeof c === "string" && HEADER_RE.test(c));
      if (hitNext) break;

      const firstCells = r.slice(0, 3).filter((c) => typeof c === "string") as string[];
      const isGrand = firstCells.some((c) => /^\s*grand\s+total\s*:?\s*$/i.test(c));
      const isSummary = isGrand || firstCells.some((c) => /^\s*total\s*:?\s*$/i.test(c));
      if (isSummary) {
        summaryRows.push({ row: r, isGrand });
        continue;
      }

      const rawName = employeeCol >= 0 ? r[employeeCol] : "";
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (!name) continue;
      if (/^\s*(pay\s*rate|hours|hrs)\s*$/i.test(name)) continue;

      const netPay = netPayCol >= 0 ? parseMoney(r[netPayCol]) ?? 0 : 0;
      const tax = taxCol >= 0 ? parseMoney(r[taxCol]) ?? 0 : 0;
      const superAnn = superCol >= 0 ? parseMoney(r[superCol]) ?? 0 : 0;
      const cashPay = cashPayCol >= 0 ? parseMoney(r[cashPayCol]) ?? 0 : 0;
      const rawTotalInc = totalIncCol >= 0 ? parseMoney(r[totalIncCol]) ?? 0 : 0;
      const totalIncSuper =
        rawTotalInc > 0 ? rawTotalInc : netPay + tax + superAnn;

      if (netPay === 0 && tax === 0 && superAnn === 0 && cashPay === 0 && totalIncSuper === 0) {
        continue;
      }

      employees.push({
        name,
        netPay,
        tax,
        superAnn,
        cashPay,
        totalIncSuper: Math.round(totalIncSuper * 100) / 100,
      });
      totalNet += netPay;
      totalTax += tax;
      totalSuper += superAnn;
      totalCash += cashPay;
      totalInc += totalIncSuper;
    }

    if (totalInc === 0 && summaryRows.length > 0) {
      const pick =
        summaryRows.find((s) => s.isGrand)?.row ??
        summaryRows[summaryRows.length - 1].row;
      const fromTotal = totalsFromMoneyRow(pick, moneyCols);
      if (fromTotal) {
        totalNet = fromTotal.netPay;
        totalTax = fromTotal.tax;
        totalSuper = fromTotal.superAnn;
        totalCash = fromTotal.cashPay;
        totalInc = fromTotal.totalIncSuper;
      }
    }

    return {
      weekStartISO,
      weekEndISO,
      employees,
      totals: {
        netPay: Math.round(totalNet * 100) / 100,
        tax: Math.round(totalTax * 100) / 100,
        superAnn: Math.round(totalSuper * 100) / 100,
        cashPay: Math.round(totalCash * 100) / 100,
        totalIncSuper: Math.round(totalInc * 100) / 100,
      },
    };
  }
  return null;
}

/**
 * Extract the full per-employee breakdown for a specific pay week from the
 * same Google Sheet. Best-effort column matching — falls back to 0 for any
 * money column that isn't present in the header row.
 */
export async function fetchWeekPayrollDetail(
  weekStartISO: string,
): Promise<WeekPayrollDetail | null> {
  const rows = await readPayrollSheetRows();
  return parseWeekPayrollDetailFromRows(rows, weekStartISO);
}
