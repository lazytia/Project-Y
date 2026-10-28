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
import { applyPriceHistory, loadPriceHistory, type StoredPrices } from "@/lib/price-history";

const DEFAULT_SHEET_ID = "1eiZsDQRp-P3BKkQ2MsJi-ZDGHompRbeZZUg3A7bcMHk";

/**
 * How long one read of the sheet is served as it is.
 *
 * Reading it takes a second or two and the page is opened by a handful of
 * people, so a minute of staleness costs nothing, while a read per search
 * would.
 */
const CACHE_TTL_MS = 60 * 1000;

/**
 * How old a read may be and still be handed over at once while a new one is
 * fetched behind it. Past the minute, the next person to open the page gets the
 * last list immediately instead of waiting for the sheet; the list after that is
 * the fresh one. Past this, the read is too old to show and is waited for.
 */
const STALE_OK_MS = 10 * 60 * 1000;

/**
 * How long the tab names are remembered. They change when a supplier is added,
 * which is rare, and asking for them is a round trip made before the one that
 * fetches the prices; a new supplier shows up within this long.
 */
const TITLES_TTL_MS = 5 * 60 * 1000;

/** The sheet itself, and — to date a price change — when the file was last edited. */
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
];

const spreadsheetId = () => process.env.PRICE_SHEET_ID ?? DEFAULT_SHEET_ID;

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

// One client for every read: building one each time throws away its access token.
let auth: ReturnType<typeof authClient> | null = null;
const authed = () => (auth ??= authClient());

let titlesCache: { at: number; titles: string[] } | null = null;

async function readTitles(): Promise<string[]> {
  const meta = await google.sheets({ version: "v4", auth: authed() }).spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: "sheets.properties.title",
  });
  const titles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => typeof t === "string" && t.length > 0);
  titlesCache = { at: Date.now(), titles };
  return titles;
}

async function batchGet(titles: string[]): Promise<SheetTab[]> {
  // One request for every tab, not one per supplier.
  const res = await google.sheets({ version: "v4", auth: authed() }).spreadsheets.values.batchGet({
    spreadsheetId: spreadsheetId(),
    ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return (res.data.valueRanges ?? []).map((range, i) => ({
    title: titles[i],
    rows: (range.values ?? []) as unknown[][],
  }));
}

async function readTabs(): Promise<SheetTab[]> {
  if (titlesCache && Date.now() - titlesCache.at < TITLES_TTL_MS) {
    try {
      return await batchGet(titlesCache.titles);
    } catch {
      // A tab renamed or deleted since the names were remembered: ask again.
    }
  }
  return batchGet(await readTitles());
}

/**
 * When the sheet was last edited: the best date for a price found to have
 * moved, since nobody opens this page the minute an edit is made. Failing to
 * ask only costs that precision.
 */
async function readModifiedAt(): Promise<number> {
  const now = Date.now();
  try {
    const file = await google.drive({ version: "v3", auth: authed() }).files.get({
      fileId: spreadsheetId(),
      fields: "modifiedTime",
    });
    const t = Date.parse(file.data.modifiedTime ?? "");
    return Number.isFinite(t) ? Math.min(t, now) : now;
  } catch (err) {
    console.warn("[price-list] could not read the sheet's modified time:", err);
    return now;
  }
}

/** The price record, or "unreadable" — which must not be mistaken for "empty". */
async function readHistory(): Promise<{ stored: StoredPrices } | null> {
  try {
    return { stored: await loadPriceHistory() };
  } catch (err) {
    console.error("[price-history] could not read the record:", err);
    return null;
  }
}

async function load(): Promise<PriceList> {
  // Three independent reads, made together rather than one after another.
  const [tabs, modifiedAt, history] = await Promise.all([readTabs(), readModifiedAt(), readHistory()]);
  const list = buildPriceList(tabs);
  return history ? applyPriceHistory(list, history.stored, modifiedAt) : list;
}

let cache: { at: number; list: PriceList } | null = null;
let inflight: Promise<PriceList> | null = null;

function refresh(): Promise<PriceList> {
  // Everyone who asks in the same moment waits on one read.
  inflight ??= load()
    .then((list) => {
      cache = { at: Date.now(), list };
      return list;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The merged price list.
 *
 * Fresh from the cache within a minute; within ten, the last list at once and a
 * new read started behind it; beyond that, a read that is waited for.
 */
export async function fetchPriceList(): Promise<PriceList> {
  const age = cache ? Date.now() - cache.at : Infinity;
  if (cache && age < CACHE_TTL_MS) return cache.list;
  if (cache && age < STALE_OK_MS) {
    refresh().catch((err) => console.error("[price-list] background refresh failed:", err));
    return cache.list;
  }
  return refresh();
}
