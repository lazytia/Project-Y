/**
 * Server-side Xero client helper.
 *
 * Persists the OAuth2 refresh token in Firestore (`secrets/xero`) so
 * the Friday sync job can run unattended. Tokens are refreshed
 * lazily before each API call.
 *
 * Required env vars (set in App Hosting / .env.local):
 *
 *   XERO_CLIENT_ID            — from developer.xero.com app dashboard
 *   XERO_CLIENT_SECRET        — same
 *   XERO_REDIRECT_URI         — e.g. https://your.app/api/xero/callback
 *   XERO_SYNC_SHARED_TOKEN    — random secret protecting /api/xero/sync
 */
import { XeroClient, type TokenSet } from "xero-node";
import { adminDb } from "./firebase-admin";

// Xero scope names (no .read suffix for payroll AU — those scopes are
// granted read+write together). Minimum needed: payroll.payruns to read
// the gross + super totals every Friday. accounting.reports.read is
// optional but useful if we later want sales reports from Xero too.
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "payroll.payruns",
];

const SECRETS_DOC = "secrets/xero";

export type XeroSecret = {
  refreshToken: string;
  tokenSet?: TokenSet;
  tenantId?: string;
  tenantName?: string;
  updatedAt?: FirebaseFirestore.Timestamp;
};

function readEnv(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.XERO_CLIENT_ID ?? "";
  const clientSecret = process.env.XERO_CLIENT_SECRET ?? "";
  const redirectUri = process.env.XERO_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Xero env vars missing. Set XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** Build a fresh, unauthenticated XeroClient (used for the OAuth flow). */
export function xeroClient(): XeroClient {
  const { clientId, clientSecret, redirectUri } = readEnv();
  return new XeroClient({
    clientId,
    clientSecret,
    redirectUris: [redirectUri],
    scopes: SCOPES,
    state: undefined,
  });
}

/** Read the saved secret from Firestore. Returns null if not yet connected. */
export async function readXeroSecret(): Promise<XeroSecret | null> {
  const [coll, id] = SECRETS_DOC.split("/");
  const snap = await adminDb().collection(coll).doc(id).get();
  if (!snap.exists) return null;
  return snap.data() as XeroSecret;
}

/** Persist the secret back to Firestore. */
export async function writeXeroSecret(s: Partial<XeroSecret>): Promise<void> {
  const [coll, id] = SECRETS_DOC.split("/");
  await adminDb()
    .collection(coll)
    .doc(id)
    .set({ ...s, updatedAt: new Date() }, { merge: true });
}

/**
 * Get an authenticated XeroClient ready for API calls — refreshes the
 * token if needed and updates Firestore with the new refresh token.
 * Throws if the integration hasn't been connected yet.
 */
export async function authedXeroClient(): Promise<{ client: XeroClient; tenantId: string }> {
  const secret = await readXeroSecret();
  if (!secret?.refreshToken) {
    throw new Error("Xero is not connected. Visit /api/xero/connect as an owner first.");
  }
  const client = xeroClient();
  const newTokenSet = await client.refreshWithRefreshToken(
    process.env.XERO_CLIENT_ID ?? "",
    process.env.XERO_CLIENT_SECRET ?? "",
    secret.refreshToken,
  );
  client.setTokenSet(newTokenSet);
  // Pick the tenant — prefer the saved one, fall back to the first.
  await client.updateTenants(false);
  const tenant =
    client.tenants.find((t) => t.tenantId === secret.tenantId) ?? client.tenants[0];
  if (!tenant) throw new Error("No Xero tenants visible to this connection.");
  // Persist the refreshed refresh token so the next run starts clean.
  await writeXeroSecret({
    refreshToken: newTokenSet.refresh_token ?? secret.refreshToken,
    tokenSet: newTokenSet,
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
  });
  return { client, tenantId: tenant.tenantId };
}
