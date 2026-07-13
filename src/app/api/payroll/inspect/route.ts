import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

/**
 * GET /api/payroll/inspect?weekStart=YYYY-MM-DD
 *
 * Diagnostic endpoint: dumps the raw header row + all rows inside the
 * requested pay-week block so we can see exactly what column names the
 * Google Pay History sheet is using. Used only for debugging the
 * fetchWeekPayrollDetail column matcher.
 */

export const dynamic = "force-dynamic";

const DEFAULT_SHEET_ID = "14HlHX24fN8GcryjIaBRvjZtmAGuQK7dElAcV4JXr1Qk";
const HEADER_RE =
  /Pay\s+(?:History|Period|Week|Run)\s*\((\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-–—]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i;

function ddmmToIso(d: string, m: string, y: string): string {
  const day = parseInt(d, 10);
  const mon = parseInt(m, 10);
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

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
  return new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    projectId:
      process.env.GCLOUD_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      "project-y-d04dc",
  });
}

export async function GET(req: NextRequest) {
  const weekStart = req.nextUrl.searchParams.get("weekStart");
  if (!weekStart) {
    return NextResponse.json({ error: "weekStart=YYYY-MM-DD required" }, { status: 400 });
  }

  const sheetId = process.env.PAYROLL_SHEET_ID ?? DEFAULT_SHEET_ID;
  const range = process.env.PAYROLL_SHEET_RANGE ?? "A:Z";

  try {
    const auth = authClient();
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const rows = (res.data.values ?? []) as unknown[][];

    // Find the block whose header matches weekStart.
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      let match: RegExpExecArray | null = null;
      for (const cell of row) {
        if (typeof cell !== "string") continue;
        const m = HEADER_RE.exec(cell);
        if (m) { match = m; break; }
      }
      if (!match) continue;
      const wsISO = ddmmToIso(match[1], match[2], match[3]);
      if (wsISO !== weekStart) continue;

      // Collect all rows until the next block header.
      const block: unknown[][] = [row];
      for (let j = i + 1; j < rows.length; j += 1) {
        const r = rows[j] ?? [];
        const isNextHeader = r.some(
          (c) => typeof c === "string" && HEADER_RE.test(c),
        );
        if (isNextHeader) break;
        block.push(r);
      }
      return NextResponse.json({
        weekStart,
        blockRowCount: block.length,
        rows: block,
      });
    }

    // No exact match — dump every block header we found so we can see
    // what weeks the sheet actually has.
    const allBlockHeaders: { rowIdx: number; iso: string; raw: string }[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      for (const cell of row) {
        if (typeof cell !== "string") continue;
        const m = HEADER_RE.exec(cell);
        if (m) {
          allBlockHeaders.push({
            rowIdx: i,
            iso: ddmmToIso(m[1], m[2], m[3]),
            raw: cell,
          });
          break;
        }
      }
    }
    return NextResponse.json({
      error: `No block found for weekStart=${weekStart}`,
      totalRows: rows.length,
      allBlockHeaders,
      firstFiveRows: rows.slice(0, 5),
    }, { status: 404 });
  } catch (err) {
    console.error("[payroll/inspect] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 502 },
    );
  }
}
