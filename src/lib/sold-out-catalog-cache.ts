import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  fetchSoldOutCategoriesFromSquare,
  type SoldOutCategoryPayload,
} from "@/lib/sold-out-catalog";

const CACHE_DOC = "catalog";
export const SOLD_OUT_CATALOG_COMPUTE_VERSION = 3;

/** After this age we return cached data instantly but refresh Square in the background. */
export const FRESH_TTL_MS = 60 * 60 * 1000;

/** In-process cache — same TTL as before for hot instances. */
export const MEMORY_TTL_MS = 5 * 60 * 1000;

type CachedBody = { dailySoldOutCategories: SoldOutCategoryPayload[] };

type MemoryEntry = { savedAt: number; body: CachedBody };

let memoryCache: MemoryEntry | null = null;

type FirestoreEntry = {
  dailySoldOutCategories?: SoldOutCategoryPayload[];
  computedAt?: Timestamp;
  computeVersion?: number;
};

function isValidCategories(list: unknown): list is SoldOutCategoryPayload[] {
  return (
    Array.isArray(list) &&
    list.length > 0 &&
    list.every(
      (c) =>
        c &&
        typeof c === "object" &&
        typeof (c as SoldOutCategoryPayload).categoryId === "string" &&
        Array.isArray((c as SoldOutCategoryPayload).affectedItems),
    )
  );
}

export function readMemorySoldOutCatalog(): CachedBody | null {
  if (!memoryCache) return null;
  if (Date.now() - memoryCache.savedAt > MEMORY_TTL_MS) return null;
  return memoryCache.body;
}

export function writeMemorySoldOutCatalog(body: CachedBody) {
  memoryCache = { savedAt: Date.now(), body };
}

export async function readFirestoreSoldOutCatalog(): Promise<{
  body: CachedBody;
  ageMs: number;
} | null> {
  try {
    const snap = await adminDb().collection("sold_out_menu_cache").doc(CACHE_DOC).get();
    if (!snap.exists) return null;
    const data = snap.data() as FirestoreEntry | undefined;
    if (
      data?.computeVersion !== SOLD_OUT_CATALOG_COMPUTE_VERSION ||
      !isValidCategories(data.dailySoldOutCategories)
    ) {
      return null;
    }
    const computedAt = data.computedAt?.toDate?.() ?? null;
    const ageMs = computedAt ? Date.now() - computedAt.getTime() : Number.MAX_SAFE_INTEGER;
    return {
      body: { dailySoldOutCategories: data.dailySoldOutCategories! },
      ageMs,
    };
  } catch (err) {
    console.warn("[sold-out-catalog-cache] Firestore read failed:", err);
    return null;
  }
}

export async function writeFirestoreSoldOutCatalog(body: CachedBody): Promise<void> {
  try {
    await adminDb()
      .collection("sold_out_menu_cache")
      .doc(CACHE_DOC)
      .set(
        {
          dailySoldOutCategories: body.dailySoldOutCategories,
          computedAt: Timestamp.now(),
          computeVersion: SOLD_OUT_CATALOG_COMPUTE_VERSION,
        },
        { merge: true },
      );
  } catch (err) {
    console.warn("[sold-out-catalog-cache] Firestore write failed:", err);
  }
}

export async function refreshSoldOutCatalogFromSquare(): Promise<CachedBody> {
  const dailySoldOutCategories = await fetchSoldOutCategoriesFromSquare();
  const body = { dailySoldOutCategories };
  writeMemorySoldOutCatalog(body);
  await writeFirestoreSoldOutCatalog(body);
  return body;
}
