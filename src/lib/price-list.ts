/**
 * Reads the supplier price list from its Google Sheet (see price-list-parse).
 *
 * Server only. The credentials are the ones the payroll sheet reader uses, so
 * the same service account has to be able to see this sheet too:
 *
 *   PRICE_SHEET_ID     — spreadsheet ID (default: the kitchen's price file)
 *   PAYROLL_SHEET_SA_JSON / FIREBASE_SERVICE_ACCOUNT_JSON — service account JSON
 */
import { existsSync } from "node:fs";
import { google } from "googleapis";
import { buildPriceList, type PriceList, type SheetTab } from "@/lib/price-list-parse";
import { withPriceHistory } from "@/lib/price-history";

const DEFAULT_SHEET_ID = "1eiZsDQRp-P3BKkQ2MsJi-ZDGHompRbeZZUg3A7bcMHk";

/**
 * How long one read of the sheet serves everyone.
 *
 * Reading it takes a second or two and the page is opened by a handful of
 * people, so a minute of staleness costs nothing, while a read per search
 * would. The ERP's edits land in the sheet and show here within the minute.
 */
const CACHE_TTL_MS = 60 * 1000;

/** The sheet itself, and — to date a price change — when the file was last edited. */
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

function authClient() {
  // Same order as lib/payroll-sheet: an inline key first, then the machine's
  // own credentials. A path left over from another project is dropped so the
  // SDK can fall back instead of failing on a file that is not there.
  const inline = (process.env.PAYROLL_SHEET_SA_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT_JSON)?.trim();
  if (inline) {
    const creds = JSON.parse(inline);
    return new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: SCOPES,
    });
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && !existsSync(credPath)) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return new google.auth.GoogleAuth({
    scopes: SCOPES,
    projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "project-y-d04dc",
  });
}

async function readTabs(): Promise<{ tabs: SheetTab[]; modifiedAt: number }> {
  const spreadsheetId = process.env.PRICE_SHEET_ID ?? DEFAULT_SHEET_ID;
  const auth = authClient();
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const titles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  // One request for every tab, not one per supplier.
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const tabs = (res.data.valueRanges ?? []).map((range, i) => ({
    title: titles[i],
    rows: (range.values ?? []) as unknown[][],
  }));

  // When the sheet was last edited: the best date for a price found to have
  // moved, since nobody opens this page the minute an edit is made. Failing
  // to ask only costs that precision.
  let modifiedAt = Date.now();
  try {
    const file = await google.drive({ version: "v3", auth }).files.get({
      fileId: spreadsheetId,
      fields: "modifiedTime",
    });
    const t = Date.parse(file.data.modifiedTime ?? "");
    if (Number.isFinite(t)) modifiedAt = Math.min(t, modifiedAt);
  } catch (err) {
    console.warn("[price-list] could not read the sheet's modified time:", err);
  }
  return { tabs, modifiedAt };
}

let cache: { at: number; list: PriceList } | null = null;
let inflight: Promise<PriceList> | null = null;

/** The merged price list, from the cache while it is fresh. */
export async function fetchPriceList(): Promise<PriceList> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.list;
  // Everyone who opens the page in the same moment waits on one read.
  inflight ??= readTabs()
    .then(async ({ tabs, modifiedAt }) => {
      const list = await withPriceHistory(buildPriceList(tabs), modifiedAt);
      cache = { at: Date.now(), list };
      return list;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
