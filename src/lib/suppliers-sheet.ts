/**
 * Reads owner-maintained supplier payment totals from a Google Sheet or
 * Excel workbook stored on Google Drive.
 *
 * Source workbook (1mnFXBjGw8KC1f2r_mTa4xA3pA5GTfO7wND4HVUohHVg) has one tab per month.
 * Native Google Sheets use the Sheets API; Excel uploads use Drive download
 * + xlsx parsing as a fallback.
 */
import { existsSync } from "node:fs";
import { google } from "googleapis";
import * as XLSX from "xlsx";

const DEFAULT_SHEET_ID = "1mnFXBjGw8KC1f2r_mTa4xA3pA5GTfO7wND4HVUohHVg";

const API_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

export type SupplierRow = { name: string; cost: number };

export type MonthlySuppliers = {
  monthISO: string;
  tabTitle: string;
  suppliers: SupplierRow[];
  total: number;
};

type TabReader = {
  titles: string[];
  rowsForTab: (tabTitle: string) => Promise<unknown[][]>;
};

let workbookCache: { at: number; reader: TabReader } | null = null;
const WORKBOOK_TTL_MS = 5 * 60 * 1000;

function authClient() {
  const inline = (process.env.PAYROLL_SHEET_SA_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT_JSON)?.trim();
  if (inline) {
    const creds = JSON.parse(inline);
    return new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: API_SCOPES,
    });
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && !existsSync(credPath)) {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  return new google.auth.GoogleAuth({
    scopes: API_SCOPES,
    projectId:
      process.env.GCLOUD_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      "project-y-d04dc",
  });
}

function isOfficeFileError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /office file|not be an office/i.test(msg);
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

export function tabMatchesMonth(title: string, monthISO: string): boolean {
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
    new RegExp(`^${monthName}(\\s+${y}|\\s+${yy})?$`, "i"),
    new RegExp(`^${monthShort}(\\s+${y}|\\s+${yy})?$`, "i"),
    new RegExp(`^${y}[-/]${String(m).padStart(2, "0")}$`),
    new RegExp(`^${String(m).padStart(2, "0")}[-/]${y}$`),
    new RegExp(`^${String(m).padStart(2, "0")}[-/]${yy}$`),
    new RegExp(`^${m}$`),
    new RegExp(`^${String(m).padStart(2, "0")}$`),
  ];
  return patterns.some((r) => r.test(t));
}

async function openSheetsReader(sheetId: string): Promise<TabReader> {
  const auth = authClient();
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties.title",
  });
  const titles: string[] = [];
  for (const s of meta.data.sheets ?? []) {
    const t = s.properties?.title;
    if (typeof t === "string") titles.push(t);
  }
  return {
    titles,
    rowsForTab: async (tabTitle: string) => {
      const safe = tabTitle.replace(/'/g, "''");
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `'${safe}'!A1:Z200`,
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      return (res.data.values ?? []) as unknown[][];
    },
  };
}

async function openExcelReader(sheetId: string): Promise<TabReader> {
  const auth = authClient();
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.get(
    { fileId: sheetId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  const buf = Buffer.from(res.data as ArrayBuffer);
  const workbook = XLSX.read(buf, { type: "buffer" });
  return {
    titles: workbook.SheetNames,
    rowsForTab: async (tabTitle: string) => {
      const sheet = workbook.Sheets[tabTitle];
      if (!sheet) return [];
      return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
    },
  };
}

async function openTabReader(): Promise<TabReader> {
  if (workbookCache && Date.now() - workbookCache.at < WORKBOOK_TTL_MS) {
    return workbookCache.reader;
  }

  const sheetId = process.env.SUPPLIERS_SHEET_ID ?? DEFAULT_SHEET_ID;
  let reader: TabReader;
  try {
    reader = await openSheetsReader(sheetId);
  } catch (err) {
    if (!isOfficeFileError(err)) throw err;
    reader = await openExcelReader(sheetId);
  }

  workbookCache = { at: Date.now(), reader };
  return reader;
}

function parseTabRows(
  rows: unknown[][],
  monthISO: string,
  tabTitle: string,
): MonthlySuppliers | null {
  if (rows.length === 0) return null;

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] ?? [];
    let realLabels = 0;
    for (const cell of row) {
      if (typeof cell !== "string" && typeof cell !== "number") continue;
      const c = String(cell).trim().toLowerCase();
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
  const supplierCols: { name: string; col: number }[] = [];
  let totalCol = -1;
  for (let c = 0; c < header.length; c++) {
    const cell = header[c];
    if (cell === undefined || cell === null || cell === "") continue;
    const label = String(cell).trim();
    if (!label) continue;
    const lower = label.toLowerCase();
    if (lower === "day" || lower === "date") continue;
    if (lower === "total") {
      totalCol = c;
      continue;
    }
    supplierCols.push({ name: label, col: c });
  }

  const dayCol = header.findIndex((cell) => {
    if (cell == null) return false;
    return String(cell).trim().toLowerCase() === "day";
  });
  const dayColumn = dayCol >= 0 ? dayCol : header.length > 1 ? 1 : 0;

  function isSundayRow(row: unknown[]): boolean {
    return String(row[dayColumn] ?? "").trim().toLowerCase() === "sun";
  }

  const sunRows: unknown[][] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (isSundayRow(row)) sunRows.push(row);
  }

  let totalRowIdx = -1;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < Math.min(row.length, 3); c++) {
      const cell = row[c];
      if (typeof cell === "string" && /^\s*total\s*$/i.test(cell)) {
        totalRowIdx = r;
        break;
      }
      if (typeof cell === "number" && c === 0) continue;
      if (cell != null && String(cell).trim().toLowerCase() === "total") {
        totalRowIdx = r;
        break;
      }
    }
    if (totalRowIdx !== -1) break;
  }

  const suppliers: SupplierRow[] = [];

  // Each Sunday row holds that week's supplier totals — sum them for the month.
  if (sunRows.length > 0) {
    for (const { name, col } of supplierCols) {
      let sum = 0;
      for (const row of sunRows) {
        const v = parseMoney(row[col]);
        if (v && v > 0) sum += v;
      }
      if (sum > 0) suppliers.push({ name, cost: Math.round(sum * 100) / 100 });
    }
  } else if (totalRowIdx !== -1) {
    const totalRow = rows[totalRowIdx];
    for (const { name, col } of supplierCols) {
      const v = parseMoney(totalRow[col]);
      if (v && v > 0) suppliers.push({ name, cost: Math.round(v * 100) / 100 });
    }
  } else {
    for (const { name, col } of supplierCols) {
      let sum = 0;
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r] ?? [];
        if (isSundayRow(row)) continue;
        const v = parseMoney(row[col]);
        if (v && v > 0) sum += v;
      }
      if (sum > 0) suppliers.push({ name, cost: Math.round(sum * 100) / 100 });
    }
  }

  let total = 0;
  if (sunRows.length > 0) {
    if (totalCol !== -1) {
      for (const row of sunRows) {
        const v = parseMoney(row[totalCol]);
        if (v && v > 0) total += v;
      }
    }
    if (total <= 0) {
      const headerWidth = header.length;
      for (const row of sunRows) {
        if (row.length > headerWidth) {
          const v = parseMoney(row[row.length - 1]);
          if (v && v > 0) total += v;
        }
      }
    }
  } else if (totalRowIdx !== -1 && totalCol !== -1) {
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

export async function fetchSupplierTabTitles(): Promise<string[]> {
  const reader = await openTabReader();
  return reader.titles;
}

export async function fetchSupplierMonth(monthISO: string): Promise<MonthlySuppliers | null> {
  const reader = await openTabReader();
  const match = reader.titles.find((t) => tabMatchesMonth(t, monthISO));
  if (!match) return null;
  const rows = await reader.rowsForTab(match);
  return parseTabRows(rows, monthISO, match);
}

/** Load several months from one workbook download. */
export async function fetchSupplierMonths(
  monthISOs: string[],
): Promise<Map<string, MonthlySuppliers | null>> {
  const reader = await openTabReader();
  const out = new Map<string, MonthlySuppliers | null>();
  for (const monthISO of monthISOs) {
    const match = reader.titles.find((t) => tabMatchesMonth(t, monthISO));
    if (!match) {
      out.set(monthISO, null);
      continue;
    }
    const rows = await reader.rowsForTab(match);
    out.set(monthISO, parseTabRows(rows, monthISO, match));
  }
  return out;
}
