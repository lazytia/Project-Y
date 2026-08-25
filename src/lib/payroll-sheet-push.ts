/**
 * Append a Pay History block to the payroll Google Sheet from timesheet hours.
 */
import { existsSync } from "node:fs";
import { google, sheets_v4 } from "googleapis";
import {
  calculateWeeklyPaygTax,
  grossPayFromHours,
  parseSheetMoney,
} from "@/lib/au-payg-tax";

export const DEFAULT_SHEET_ID = "14HlHX24fN8GcryjIaBRvjZtmAGuQK7dElAcV4JXr1Qk";
export const DEFAULT_TAB_NAME = "Tax Calculator";
export const DEFAULT_TAB_GID = 1573785687;

/**
 * Where the app's own figures belong in a Pay History block.
 *
 * Named, because they used to be spelled inline and the tax one was wrong:
 * it wrote to J on the assumption the block ended at O. A block runs to S,
 * J is the Saturday banking split, and N is Tax — so every push dropped a
 * dollar amount into an hours column and left the real tax cell showing the
 * previous week's figure.
 */
const COLUMN = {
  weekHours: "E",
  premiumHours: "F",
  totalHours: "K",
  tax: "N",
} as const;

/**
 * The cash/banking split, G..J, which the owner fills in by hand.
 *
 * How a week's hours divide between cash and bank is an arrangement per
 * person — one of them is on a fixed twenty banked hours with the rest in
 * cash — and nothing in the app models it. Carried across by the block copy
 * it would be last week's split sitting under this week's hours, looking
 * every bit as authoritative. Cleared instead, so the blanks ask to be
 * filled rather than quietly answering wrong.
 */
const MANUAL_SPLIT_COLUMNS = { first: "G", last: "J" } as const;

/**
 * Width of a Pay History block: A (Employee) through S (Notes).
 *
 * The copy has to span the whole block or the tail simply does not exist in
 * the new one — Cash Pay, Superannuation, Total Inc Super and Notes go
 * missing, the Total row stops short of them, and the title's A:S merge
 * cannot be reproduced so it renders clipped in column A.
 *
 * Deliberately a constant rather than read off the template: once a short
 * block has been written, the next push would take it as the template and
 * copy the mistake forward for good.
 */
const BLOCK_COLUMN_COUNT = 19;

/** Column P — the first of the four that a truncated block is missing. */
const FIRST_COLUMN_PAST_NET_PAY = 15;

/** Sheet range wide enough to read a whole block back. */
export const BLOCK_READ_RANGE = "A:S";

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

/** Owner rows — always the same each pay week (not driven by Square timesheets). */
const FIXED_EMPLOYEE_ROWS: Record<string, { weekHours: number; premiumHours: number; tax: number }> = {
  "Yurica (Yuri Oh)": { weekHours: 34.5, premiumHours: 0, tax: 94 },
  Eddie: { weekHours: 16, premiumHours: 0, tax: 6 },
};

function fixedPayrollRow(sheetName: string): (typeof FIXED_EMPLOYEE_ROWS)[string] | null {
  if (FIXED_EMPLOYEE_ROWS[sheetName]) return FIXED_EMPLOYEE_ROWS[sheetName];
  const lower = sheetName.trim().toLowerCase();
  if (lower.startsWith("yurica")) return FIXED_EMPLOYEE_ROWS["Yurica (Yuri Oh)"];
  if (lower === "eddie") return FIXED_EMPLOYEE_ROWS.Eddie;
  return null;
}

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

function parsePayHistoryBlocks(rows: unknown[][]): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

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

    blocks.push({
      titleRow: i,
      headerRow,
      totalRow,
      title,
      premiumIsSaturday,
      headerValues,
      employees,
    });
  }

  return blocks;
}

/**
 * Does this block still carry the columns past Net Pay?
 *
 * Tested by position rather than by counting labels: G..J are legitimately
 * blank in older blocks, so a label count cannot tell a complete old block
 * from one truncated at Net Pay.
 */
function isCompleteBlock(block: ParsedBlock): boolean {
  return block.headerValues.slice(FIRST_COLUMN_PAST_NET_PAY).some((c) => c.trim() !== "");
}

/**
 * Which block to copy, and which one to append after.
 *
 * Usually the same block — the newest one. They come apart when the newest is
 * malformed: a block written before the copy width was fixed stops at Net Pay,
 * and templating off that would carry the missing Cash Pay, Superannuation and
 * Total Inc Super columns forward into every week after it. So the copy comes
 * from the newest block that still has its full set of columns, while the new
 * block still goes at the bottom where it belongs.
 */
function pickPayHistoryBlocks(
  rows: unknown[][],
): { appendAfter: ParsedBlock; template: ParsedBlock } | null {
  const blocks = parsePayHistoryBlocks(rows);
  if (blocks.length === 0) return null;
  const appendAfter = blocks[blocks.length - 1];
  const template = [...blocks].reverse().find(isCompleteBlock) ?? appendAfter;
  return { appendAfter, template };
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
    range: `'${tab}'!${BLOCK_READ_RANGE}`,
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

  const picked = pickPayHistoryBlocks(rows);
  if (!picked) throw new Error("No existing Pay History block found to use as a template.");
  const { appendAfter, template } = picked;

  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabMeta = sheetMeta.data.sheets?.find((s) => s.properties?.title === tab);
  const sheetId = tabMeta?.properties?.sheetId ?? DEFAULT_TAB_GID;

  // Blank row, then title — immediately after the last block's Total row. The
  // height comes from the template, which is what actually gets copied.
  const newTitleRow = appendAfter.totalRow + 3;
  const firstEmpRow = newTitleRow + 2;
  const blockHeight = template.totalRow - template.titleRow + 1;
  const destStartIndex = newTitleRow - 1;

  const employeesToWrite = template.employees.map((emp) => {
    const fixed = fixedPayrollRow(emp.name);
    const h = hoursBySheetEmployee.get(emp.name);
    const templateRow = rows[emp.row] ?? [];
    const visaType = String(templateRow[1] ?? "Resident");
    const weekRate = parseSheetMoney(templateRow[2]);
    const premiumRate = parseSheetMoney(templateRow[3]);
    const weekHours = fixed?.weekHours ?? h?.weekHours ?? 0;
    const premiumHours = fixed?.premiumHours ?? h?.premiumHours ?? 0;
    const gross = grossPayFromHours(weekRate, premiumRate, weekHours, premiumHours);
    const tax = fixed?.tax ?? calculateWeeklyPaygTax(visaType, gross);
    return {
      name: emp.name,
      weekHours,
      premiumHours,
      tax,
    };
  });

  // Copy the entire previous Pay History block (title merge, header colours,
  // alternating employee row fills, total-row peach background, formulas).
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          copyPaste: {
            source: {
              sheetId,
              startRowIndex: template.titleRow,
              endRowIndex: template.totalRow + 1,
              startColumnIndex: 0,
              endColumnIndex: BLOCK_COLUMN_COUNT,
            },
            destination: {
              sheetId,
              startRowIndex: destStartIndex,
              endRowIndex: destStartIndex + blockHeight,
              startColumnIndex: 0,
              endColumnIndex: BLOCK_COLUMN_COUNT,
            },
            pasteType: "PASTE_NORMAL",
          },
        },
      ],
    },
  });

  // Leave the split blank for the owner. The Total row keeps its SUMs, so
  // the column adds itself up again as soon as they start filling it in.
  const lastEmpRow = firstEmpRow + employeesToWrite.length - 1;
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${tab}'!${MANUAL_SPLIT_COLUMNS.first}${firstEmpRow}:${MANUAL_SPLIT_COLUMNS.last}${lastEmpRow}`,
  });

  const hourUpdates: sheets_v4.Schema$ValueRange[] = [
    {
      range: `'${tab}'!A${newTitleRow}`,
      values: [[title]],
    },
  ];

  for (let i = 0; i < employeesToWrite.length; i += 1) {
    const emp = employeesToWrite[i];
    const row = firstEmpRow + i;
    hourUpdates.push({
      range: `'${tab}'!${COLUMN.weekHours}${row}:${COLUMN.premiumHours}${row}`,
      values: [[emp.weekHours || 0, emp.premiumHours || 0]],
    });
    // Total Hour is =E+F on every ordinary row, but the owner rows carry a
    // typed 0 that the copy brings across unchanged — so a pushed week showed
    // Yurica at 34.5 week hours and 0 total. Restating the formula puts every
    // row back on the same footing.
    hourUpdates.push({
      range: `'${tab}'!${COLUMN.totalHours}${row}`,
      values: [[`=${COLUMN.weekHours}${row}+${COLUMN.premiumHours}${row}`]],
    });
    hourUpdates.push({
      range: `'${tab}'!${COLUMN.tax}${row}`,
      values: [[emp.tax]],
    });
  }

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
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}&range=A${newTitleRow}`,
  };
}

/* Both read the template rather than simply the last block, so the roster and
   the premium day match the block the push will actually copy. */

export function lastBlockSheetEmployees(rows: unknown[][]): string[] {
  const block = pickPayHistoryBlocks(rows)?.template;
  return block?.employees.map((e) => e.name) ?? [];
}

export function lastBlockPremiumDay(rows: unknown[][]): 0 | 6 {
  const block = pickPayHistoryBlocks(rows)?.template;
  return block?.premiumIsSaturday ? 6 : 0;
}
