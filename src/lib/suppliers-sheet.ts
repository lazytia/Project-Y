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

export type WeeklySuppliers = {
  weekStart: string;
  weekEnd: string;
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

type TabLayout = {
  headerIdx: number;
  supplierCols: { name: string; col: number }[];
  totalCol: number;
  dayColumn: number;
  dateColumn: number;
};

function readTabLayout(rows: unknown[][]): TabLayout | null {
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

  function labelledColumn(name: string, fallback: number): number {
    const idx = header.findIndex(
      (cell) => cell != null && String(cell).trim().toLowerCase() === name,
    );
    return idx >= 0 ? idx : fallback;
  }

  return {
    headerIdx,
    supplierCols,
    totalCol,
    dayColumn: labelledColumn("day", header.length > 1 ? 1 : 0),
    dateColumn: labelledColumn("date", 0),
  };
}

function parseTabRows(
  rows: unknown[][],
  monthISO: string,
  tabTitle: string,
): MonthlySuppliers | null {
  const layout = readTabLayout(rows);
  if (!layout) return null;
  const { headerIdx, supplierCols, totalCol, dayColumn } = layout;
  const header = rows[headerIdx];

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

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/**
 * Splits a month tab into its Mon–Sun weeks.
 *
 * The Date column only carries a day-of-month number, and tabs run from the
 * Monday of their first week to the Sunday of their last — so a tab routinely
 * opens in the previous month and closes in the next. Dates are therefore
 * resolved by walking the rows in order and rolling the month over whenever
 * the day number drops.
 */
function parseTabWeeks(
  rows: unknown[][],
  monthISO: string,
  tabTitle: string,
): WeeklySuppliers[] {
  const layout = readTabLayout(rows);
  if (!layout) return [];
  const { headerIdx, supplierCols, totalCol, dayColumn, dateColumn } = layout;

  const dataRows: { row: unknown[]; day: number }[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const day = Number(parseMoney(row[dateColumn]));
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    dataRows.push({ row, day });
  }
  if (dataRows.length === 0) return [];

  const [tabYear, tabMonth] = monthISO.split("-").map(Number);
  // A tab that opens late in the month is showing the tail of the previous one.
  let cursor = new Date(Date.UTC(tabYear, tabMonth - 1 + (dataRows[0].day > 15 ? -1 : 0), 1));
  let prevDay = 0;

  const weeks: WeeklySuppliers[] = [];
  for (const { row, day } of dataRows) {
    if (day < prevDay) cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    prevDay = day;
    if (String(row[dayColumn] ?? "").trim().toLowerCase() !== "sun") continue;

    const weekEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), day))
      .toISOString()
      .slice(0, 10);

    const suppliers: SupplierRow[] = [];
    for (const { name, col } of supplierCols) {
      const v = parseMoney(row[col]);
      if (v && v > 0) suppliers.push({ name, cost: Math.round(v * 100) / 100 });
    }
    let total = totalCol !== -1 ? (parseMoney(row[totalCol]) ?? 0) : 0;
    if (total <= 0) total = suppliers.reduce((s, r) => s + r.cost, 0);

    weeks.push({
      weekStart: addDaysISO(weekEnd, -6),
      weekEnd,
      tabTitle,
      suppliers,
      total: Math.round(total * 100) / 100,
    });
  }
  return weeks;
}

/**
 * Loads whole Mon–Sun weeks of supplier spend.
 *
 * A week is written into whichever month tab the owner filed it under, which
 * may be the tab of its Monday or of its Sunday, so both are searched.
 */
export async function fetchSupplierWeeks(
  weekStarts: string[],
): Promise<Map<string, WeeklySuppliers | null>> {
  const reader = await openTabReader();

  const monthKeys = new Set<string>();
  for (const ws of weekStarts) {
    monthKeys.add(ws.slice(0, 7));
    monthKeys.add(addDaysISO(ws, 6).slice(0, 7));
  }

  const byWeekStart = new Map<string, WeeklySuppliers>();
  await Promise.all(
    [...monthKeys].map(async (monthISO) => {
      const match = reader.titles.find((t) => tabMatchesMonth(t, monthISO));
      if (!match) return;
      const rows = await reader.rowsForTab(match);
      for (const week of parseTabWeeks(rows, monthISO, match)) {
        const existing = byWeekStart.get(week.weekStart);
        // Overlapping tabs repeat a week; keep whichever copy was filled in.
        if (!existing || week.total > existing.total) byWeekStart.set(week.weekStart, week);
      }
    }),
  );

  return new Map(weekStarts.map((ws) => [ws, byWeekStart.get(ws) ?? null]));
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
