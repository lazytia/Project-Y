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

const DEFAULT_SHEET_ID = "1eiZsDQRp-P3BKkQ2MsJi-ZDGHompRbeZZUg3A7bcMHk";

/**
 * How long one read of the sheet serves everyone.
 *
 * Reading it takes a second or two and the page is opened by a handful of
 * people, so a minute of staleness costs nothing, while a read per search
 * would. The ERP's edits land in the sheet and show here within the minute.
 */
const CACHE_TTL_MS = 60 * 1000;

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
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && !existsSync(credPath)) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  return new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "project-y-d04dc",
  });
}

async function readTabs(): Promise<SheetTab[]> {
  const spreadsheetId = process.env.PRICE_SHEET_ID ?? DEFAULT_SHEET_ID;
  const sheets = google.sheets({ version: "v4", auth: authClient() });

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
  return (res.data.valueRanges ?? []).map((range, i) => ({
    title: titles[i],
    rows: (range.values ?? []) as unknown[][],
  }));
}

let cache: { at: number; list: PriceList } | null = null;
let inflight: Promise<PriceList> | null = null;

/** The merged price list, from the cache while it is fresh. */
export async function fetchPriceList(): Promise<PriceList> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.list;
  // Everyone who opens the page in the same moment waits on one read.
  inflight ??= readTabs()
    .then((tabs) => {
      const list = buildPriceList(tabs);
      cache = { at: Date.now(), list };
      return list;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
