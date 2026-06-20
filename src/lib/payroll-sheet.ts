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
const DEFAULT_SHEET_RANGE = "A:Z"; // whole tab

export type WeeklyPayrollRow = {
  weekStartISO: string;   // Monday of the pay week (YYYY-MM-DD)
  weekEndISO: string;     // Sunday of the pay week
  totalIncSuper: number;  // dollars
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

/**
 * Fetch every weekly Pay History total visible on the configured tab.
 * Returns a map keyed by the Monday ISO date (e.g. "2026-06-08").
 */
export async function fetchWeeklyPayrollTotals(): Promise<Record<string, WeeklyPayrollRow>> {
  const sheetId = process.env.PAYROLL_SHEET_ID ?? DEFAULT_SHEET_ID;
  const range = process.env.PAYROLL_SHEET_RANGE ?? DEFAULT_SHEET_RANGE;

  const auth = authClient();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = (res.data.values ?? []) as unknown[][];

  const out: Record<string, WeeklyPayrollRow> = {};

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    // Header row can have the title in any cell — scan them all.
    let header: RegExpExecArray | null = null;
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      const m = HEADER_RE.exec(cell);
      if (m) { header = m; break; }
    }
    if (!header) continue;

    const weekStartISO = ddmmToIso(header[1], header[2], header[3]);
    const weekEndISO = ddmmToIso(header[4], header[5], header[6]);

    // The next non-empty row below the header is the column header row.
    // Find which column index "Total Inc Super" lives in.
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

    // Walk down until we find the "Total" row. "Total" may live in the
    // first or second cell depending on whether the sheet uses an empty
    // leading column, so check the first few cells.
    let totalRow: unknown[] | null = null;
    for (let j = colHeaderIdx + 1; j < rows.length; j += 1) {
      const r = rows[j] ?? [];
      let isTotal = false;
      for (let k = 0; k < Math.min(3, r.length); k += 1) {
        const cell = r[k];
        if (typeof cell === "string" && /^\s*total\s*:?\s*$/i.test(cell)) {
          isTotal = true;
          break;
        }
      }
      if (isTotal) { totalRow = r; break; }
      // Bail out if we run into the next "Pay History (" header before
      // finding a Total row.
      for (const cell of r) {
        if (typeof cell === "string" && HEADER_RE.test(cell)) {
          j = rows.length; // stop outer loop
          break;
        }
      }
    }
    if (!totalRow) continue;

    const totalIncSuper = parseMoney(totalRow[totalIncSuperCol]);
    if (totalIncSuper === null) continue;

    out[weekStartISO] = { weekStartISO, weekEndISO, totalIncSuper };
  }

  return out;
}
