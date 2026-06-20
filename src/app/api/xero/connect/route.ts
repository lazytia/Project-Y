import { NextResponse } from "next/server";
import { xeroClient } from "@/lib/xero";

/**
 * GET /api/xero/connect — starts the Xero OAuth flow. The owner clicks
 * a link to this route once; Xero asks them to consent and redirects
 * back to /api/xero/callback with an authorisation code.
 */
export async function GET() {
  try {
    const client = xeroClient();
    const consentUrl = await client.buildConsentUrl();
    return NextResponse.redirect(consentUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start Xero OAuth.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
