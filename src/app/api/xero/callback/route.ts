import { NextResponse, type NextRequest } from "next/server";
import { writeXeroSecret, xeroClient } from "@/lib/xero";

/**
 * GET /api/xero/callback?code=...
 * Xero redirects here after consent. We exchange the code for a token
 * set, store the refresh token in Firestore (`secrets/xero`) and
 * redirect the owner back to the Insights page.
 */
export async function GET(req: NextRequest) {
  try {
    const client = xeroClient();
    const tokenSet = await client.apiCallback(req.nextUrl.toString());
    await client.updateTenants(false);
    const tenant = client.tenants[0];
    if (!tokenSet.refresh_token) {
      return NextResponse.json(
        { error: "Xero did not return a refresh token. Did you tick the offline_access scope?" },
        { status: 500 },
      );
    }
    await writeXeroSecret({
      refreshToken: tokenSet.refresh_token,
      tenantId: tenant?.tenantId,
      tenantName: tenant?.tenantName,
    });
    return NextResponse.redirect(new URL("/scheduling/insights?xero=connected", req.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to complete Xero OAuth.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
