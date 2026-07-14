/**
 * Reads owner-maintained supplier payment totals from a Google Sheet.
 *
 * Source workbook (per request, 1rY4Qi5_JSDOSTO9Re2xDNmGVXo2jIFGU) stores
 * one tab per calendar month. Each tab looks like:
 *
 *   | Day  | Date       | JFC  | Alpha Fresh | Pyrmont | ... | Total |
 *   | Mon  | 01/06/26   |  ... |    ...      |   ...   | ... |  ...  |
 *   | Tue  | 02/06/26   |  ... |    ...      |   ...   | ... |  ...  |
 *   | ...
 *   | Sun  | 07/06/26   |  ← weekly subtotal row (skipped)
 *   | ...
 *   | Total|            |  X   |     Y       |   Z     | ... |   T   |
 *
 * We resolve the header row's supplier column indices and read the
 * "Total" row per column, which matches what the owner sees on-sheet.
 *
 * The service account (either PAYROLL_SHEET_SA_JSON or the default
 * FIREBASE_SERVICE_ACCOUNT_JSON) needs Viewer access on the workbook —
 * share it with the SA's client_email address.
 *
 * Env vars:
 *   SUPPLIERS_SHEET_ID — spreadsheet ID (default: the project workbook).
 */
import { existsSync } from "node:fs";
import { google } from "googleapis";

const DEFAULT_SHEET_ID = "1rY4Qi5_JSDOSTO9Re2xDNmGVXo2jIFGU";

export type SupplierRow = { name: string; cost: number };

export type MonthlySuppliers = {
  monthISO: string;   // "2026-06"
  tabTitle: string;   // Google Sheets tab name that matched
  suppliers: SupplierRow[];
  total: number;      // from the "Total" row's total column when present
};

function authClient() {
  const inline = (process.env.PAYROLL_SHEET_SA_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT_JSON)?.trim();
  if (inline) {
    const creds = JSON.parse(inline);
    return new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && !existsSync(credPath)) {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  return new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    projectId:
      process.env.GCLOUD_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      "project-y-d04dc",
  });
}

function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[,$\s]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "—") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_SHORT = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** Does `title` refer to `monthISO`? Handles common tab-name shapes:
 *  "June 2026", "Jun 2026", "2026-06", "06/2026", "June". */
function tabMatchesMonth(title: string, monthISO: string): boolean {
  const t = title.trim().toLowerCase();
  const [yStr, mStr] = monthISO.split("-");
  const y = yStr;
  const m = Number(mStr);
  const mIdx = m - 1;
  if (mIdx < 0 || mIdx > 11) return false;
  const monthName = MONTH_NAMES[mIdx];
  const monthShort = MONTH_SHORT[mIdx];
  const yy = y.slice(2);
  const patterns: RegExp[] = [
    new RegExp(`^${monthName}(\\s+${y}|\\s+${yy})?$`),
    new RegExp(`^${monthShort}(\\s+${y}|\\s+${yy})?$`),
    new RegExp(`^${y}[-/]${String(m).padStart(2, "0")}$`),
    new RegExp(`^${String(m).padStart(2, "0")}[-/]${y}$`),
    new RegExp(`^${String(m).padStart(2, "0")}[-/]${yy}$`),
  ];
  return patterns.some((r) => r.test(t));
}

/** Fetch every tab title from the workbook. */
async function listTabTitles(): Promise<string[]> {
  const sheetId = process.env.SUPPLIERS_SHEET_ID ?? DEFAULT_SHEET_ID;
  const auth = authClient();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties.title",
  });
  const titles: string[] = [];
  for (const s of res.data.sheets ?? []) {
    const t = s.properties?.title;
    if (typeof t === "string") titles.push(t);
  }
  return titles;
}

/** Fetch and parse a specific tab. */
async function readTab(tabTitle: string, monthISO: string): Promise<MonthlySuppliers | null> {
  const sheetId = process.env.SUPPLIERS_SHEET_ID ?? DEFAULT_SHEET_ID;
  const auth = authClient();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabTitle}!A1:Z200`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = (res.data.values ?? []) as unknown[][];
  if (rows.length === 0) return null;

  // Find the header row — the first row that contains at least one
  // non-empty label besides "day" / "date" / "total".
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] ?? [];
    let realLabels = 0;
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      const c = cell.trim().toLowerCase();
      if (!c) continue;
      if (c === "day" || c === "date" || c === "total") continue;
      realLabels += 1;
    }
    if (realLabels >= 2) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return null;

  const header = rows[headerIdx];
  // Column indices for suppliers = everything that isn't a system column.
  const supplierCols: { name: string; col: number }[] = [];
  let totalCol = -1;
  for (let c = 0; c < header.length; c++) {
    const cell = header[c];
    if (typeof cell !== "string") continue;
    const label = cell.trim();
    if (!label) continue;
    const lower = label.toLowerCase();
    if (lower === "day" || lower === "date") continue;
    if (lower === "total") {
      totalCol = c;
      continue;
    }
    supplierCols.push({ name: label, col: c });
  }

  // Find the "Total" row — first non-header row whose leftmost non-empty
  // cell is exactly "Total".
  let totalRowIdx = -1;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < Math.min(row.length, 3); c++) {
      const cell = row[c];
      if (typeof cell === "string" && /^\s*total\s*$/i.test(cell)) {
        totalRowIdx = r;
        break;
      }
    }
    if (totalRowIdx !== -1) break;
  }

  const suppliers: SupplierRow[] = [];
  if (totalRowIdx !== -1) {
    const totalRow = rows[totalRowIdx];
    for (const { name, col } of supplierCols) {
      const v = parseMoney(totalRow[col]);
      if (v && v > 0) suppliers.push({ name, cost: Math.round(v * 100) / 100 });
    }
  } else {
    // No total row — fall back to summing every non-Sunday-subtotal row.
    for (const { name, col } of supplierCols) {
      let sum = 0;
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r] ?? [];
        // Skip rows that look like weekly subtotals — first cell empty
        // but the Total column populated, or the "Day" column reads
        // "Sun" while the row has a total-column value already.
        const dayCell = typeof row[0] === "string" ? row[0].trim().toLowerCase() : "";
        if (dayCell === "sun") continue;
        const v = parseMoney(row[col]);
        if (v && v > 0) sum += v;
      }
      if (sum > 0) suppliers.push({ name, cost: Math.round(sum * 100) / 100 });
    }
  }

  let total = 0;
  if (totalRowIdx !== -1 && totalCol !== -1) {
    total = parseMoney(rows[totalRowIdx][totalCol]) ?? 0;
  }
  if (total <= 0) {
    total = Math.round(suppliers.reduce((s, r) => s + r.cost, 0) * 100) / 100;
  }

  return {
    monthISO,
    tabTitle,
    suppliers,
    total: Math.round(total * 100) / 100,
  };
}

export async function fetchSupplierMonth(monthISO: string): Promise<MonthlySuppliers | null> {
  const titles = await listTabTitles();
  const match = titles.find((t) => tabMatchesMonth(t, monthISO));
  if (!match) return null;
  return readTab(match, monthISO);
}

/** Expose the raw tab list for the diagnostic endpoint. */
export async function fetchSupplierTabTitles(): Promise<string[]> {
  return listTabTitles();
}
