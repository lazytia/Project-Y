/**
 * Append a Pay History block to the payroll Google Sheet from timesheet hours.
 */
import { existsSync } from "node:fs";
import { google, sheets_v4 } from "googleapis";

export const DEFAULT_SHEET_ID = "14HlHX24fN8GcryjIaBRvjZtmAGuQK7dElAcV4JXr1Qk";
export const DEFAULT_TAB_NAME = "Tax Calculator";
export const DEFAULT_TAB_GID = 1573785687;

const HEADER_RE =
  /Pay\s+History\s*\((\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-–—]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i;

export type PayHistoryEmployeeHours = {
  sheetName: string;
  weekHours: number;
  premiumHours: number;
};

export type PushPayHistoryResult = {
  title: string;
  startRow: number;
  employeeCount: number;
  sheetUrl: string;
};

function sheetAuth(write: boolean) {
  const scope = write
    ? "https://www.googleapis.com/auth/spreadsheets"
    : "https://www.googleapis.com/auth/spreadsheets.readonly";
  const inline = (process.env.PAYROLL_SHEET_SA_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT_JSON)?.trim();
  if (inline) {
    const creds = JSON.parse(inline);
    return new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: [scope],
    });
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && !existsSync(credPath)) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return new google.auth.GoogleAuth({
    scopes: [scope],
    projectId:
      process.env.GCLOUD_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      "project-y-d04dc",
  });
}

export function isoToSheetDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(-2)}`;
}

export function payHistoryTitle(startISO: string, endISO: string): string {
  return `Pay History (${isoToSheetDate(startISO)} - ${isoToSheetDate(endISO)})`;
}

function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function isTotalRow(row: unknown[]): boolean {
  const first = row[0];
  return typeof first === "string" && /^\s*total\s*:?\s*$/i.test(first);
}

type ParsedBlock = {
  titleRow: number;
  headerRow: number;
  totalRow: number;
  title: string;
  premiumIsSaturday: boolean;
  headerValues: string[];
  employees: Array<{ name: string; row: number }>;
};

function parseLastPayHistoryBlock(rows: unknown[][]): ParsedBlock | null {
  let last: ParsedBlock | null = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    let title: string | null = null;
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      const m = HEADER_RE.exec(cell);
      if (m) {
        title = cell.trim();
        break;
      }
    }
    if (!title) continue;

    const headerRow = i + 1;
    const headerValues = (rows[headerRow] ?? []).map((c) => String(c ?? ""));
    const premiumIsSaturday = headerValues.some((c) => /sat\s*rate/i.test(c));

    const employees: Array<{ name: string; row: number }> = [];
    let totalRow = -1;
    for (let j = headerRow + 1; j < rows.length; j += 1) {
      const r = rows[j] ?? [];
      let nextTitle = false;
      for (const cell of r) {
        if (typeof cell === "string" && HEADER_RE.test(cell)) {
          nextTitle = true;
          break;
        }
      }
      if (nextTitle) break;
      if (isTotalRow(r)) {
        totalRow = j;
        break;
      }
      const name = r[0];
      if (typeof name === "string" && name.trim()) {
        employees.push({ name: name.trim(), row: j });
      }
    }
    if (totalRow === -1 || employees.length === 0) continue;

    last = {
      titleRow: i,
      headerRow,
      totalRow,
      title,
      premiumIsSaturday,
      headerValues,
      employees,
    };
  }

  return last;
}

export function matchSheetEmployee(displayName: string, sheetEmployees: string[]): string | null {
  const norm = displayName.trim().toLowerCase();
  if (!norm) return null;

  for (const emp of sheetEmployees) {
    const el = emp.toLowerCase();
    if (el === norm) return emp;
    const paren = /\(([^)]+)\)/.exec(emp);
    if (paren && norm.includes(paren[1].trim().toLowerCase())) return emp;
    const nick = emp.split(/[\s(]/)[0]?.trim().toLowerCase();
    const first = norm.split(/\s+/)[0];
    if (nick && (nick === first || norm.startsWith(nick))) return emp;
  }
  return null;
}

function a1(tab: string, row1: number, col0: number): string {
  return `'${tab}'!${colLetter(col0)}${row1}`;
}

export async function pushPayHistoryToSheet(
  startISO: string,
  endISO: string,
  hoursBySheetEmployee: Map<string, PayHistoryEmployeeHours>,
): Promise<PushPayHistoryResult> {
  const spreadsheetId = process.env.PAYROLL_SHEET_ID ?? DEFAULT_SHEET_ID;
  const tab = process.env.PAYROLL_SHEET_NAME ?? DEFAULT_TAB_NAME;
  const title = payHistoryTitle(startISO, endISO);

  const auth = sheetAuth(true);
  const sheets = google.sheets({ version: "v4", auth });

  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A:O`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const rows = (readRes.data.values ?? []) as unknown[][];
  for (const row of rows) {
    for (const cell of row ?? []) {
      if (typeof cell === "string" && cell.trim() === title) {
        throw new Error(`Pay History for this date range already exists: ${title}`);
      }
    }
  }

  const lastBlock = parseLastPayHistoryBlock(rows);
  if (!lastBlock) throw new Error("No existing Pay History block found to use as a template.");

  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabMeta = sheetMeta.data.sheets?.find((s) => s.properties?.title === tab);
  const sheetId = tabMeta?.properties?.sheetId ?? DEFAULT_TAB_GID;

  const newTitleRow = rows.length + 2;
  const newHeaderRow = newTitleRow + 1;
  const firstEmpRow = newHeaderRow + 1;

  const employeesToWrite = lastBlock.employees.map((emp) => {
    const h = hoursBySheetEmployee.get(emp.name);
    return {
      templateRow: emp.row + 1,
      name: emp.name,
      weekHours: h?.weekHours ?? 0,
      premiumHours: h?.premiumHours ?? 0,
    };
  });

  const newTotalRow = firstEmpRow + employeesToWrite.length;
  const requests: sheets_v4.Schema$Request[] = [];

  requests.push({
    copyPaste: {
      source: {
        sheetId,
        startRowIndex: lastBlock.headerRow,
        endRowIndex: lastBlock.headerRow + 1,
        startColumnIndex: 0,
        endColumnIndex: 15,
      },
      destination: {
        sheetId,
        startRowIndex: newHeaderRow - 1,
        endRowIndex: newHeaderRow,
        startColumnIndex: 0,
        endColumnIndex: 15,
      },
      pasteType: "PASTE_NORMAL",
    },
  });

  for (let i = 0; i < employeesToWrite.length; i += 1) {
    const emp = employeesToWrite[i];
    const destRow = firstEmpRow + i;
    requests.push({
      copyPaste: {
        source: {
          sheetId,
          startRowIndex: emp.templateRow - 1,
          endRowIndex: emp.templateRow,
          startColumnIndex: 0,
          endColumnIndex: 15,
        },
        destination: {
          sheetId,
          startRowIndex: destRow - 1,
          endRowIndex: destRow,
          startColumnIndex: 0,
          endColumnIndex: 15,
        },
        pasteType: "PASTE_NORMAL",
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  const hourUpdates: sheets_v4.Schema$ValueRange[] = [
    {
      range: a1(tab, newTitleRow, 3),
      values: [[title]],
    },
  ];

  for (let i = 0; i < employeesToWrite.length; i += 1) {
    const emp = employeesToWrite[i];
    const row = firstEmpRow + i;
    hourUpdates.push({
      range: `'${tab}'!E${row}:F${row}`,
      values: [[emp.weekHours || 0, emp.premiumHours || 0]],
    });
  }

  const first = firstEmpRow;
  const last = newTotalRow - 1;
  const totalFormulas = [
    "Total",
    "",
    `=SUM(C${first}:C${last})`,
    `=SUM(D${first}:D${last})`,
    `=SUM(E${first}:E${last})`,
    `=SUM(F${first}:F${last})`,
    `=SUM(G${first}:G${last})`,
    `=SUM(H${first}:H${last})`,
    `=SUM(I${first}:I${last})`,
    `=SUM(J${first}:J${last})`,
    `=SUM(K${first}:K${last})`,
    `=SUM(L${first}:L${last})`,
    `=SUM(M${first}:M${last})`,
    `=H${newTotalRow}+M${newTotalRow}`,
    "",
  ];
  hourUpdates.push({
    range: `'${tab}'!A${newTotalRow}:O${newTotalRow}`,
    values: [totalFormulas],
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: hourUpdates,
    },
  });

  return {
    title,
    startRow: newTitleRow,
    employeeCount: employeesToWrite.length,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
  };
}

export function lastBlockSheetEmployees(rows: unknown[][]): string[] {
  const block = parseLastPayHistoryBlock(rows);
  return block?.employees.map((e) => e.name) ?? [];
}

export function lastBlockPremiumDay(rows: unknown[][]): 0 | 6 {
  const block = parseLastPayHistoryBlock(rows);
  return block?.premiumIsSaturday ? 6 : 0;
}
