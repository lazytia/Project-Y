import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/boot-recovery
 *
 * The page's boot watchdog (lib/boot-watchdog) calls this, with sendBeacon, at
 * the moment it reloads a page that had stopped on its way up. It exists only
 * so that happening shows up in the server log: a stuck launch leaves no trace
 * anywhere else, and without one there is no way to tell whether the fix is
 * catching anything or what shape the sticking takes.
 *
 * Open to anyone, because the page that is stuck may well be one nobody has
 * signed in on. It therefore keeps nothing and trusts nothing: the body is read
 * up to a small cap, only the known fields are logged, each cut to a safe
 * shape, and the answer is always an empty 204.
 */

const MAX_BODY_CHARS = 1_000;
const KINDS = new Set(["boot", "splash", "blank"]);

export async function POST(req: NextRequest) {
  try {
    const raw = (await req.text()).slice(0, MAX_BODY_CHARS);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : "unknown";
    const entry = {
      kind,
      attempt: typeof body.attempt === "number" ? Math.trunc(body.attempt) : null,
      stuckMs: typeof body.stuckMs === "number" ? Math.trunc(body.stuckMs) : null,
      path: typeof body.path === "string" ? body.path.slice(0, 80) : null,
      standalone: body.standalone === true,
    };
    console.warn("[boot-recovery]", JSON.stringify(entry));
  } catch {
    // Not JSON, or too long to have been ours — nothing worth logging.
  }
  return new NextResponse(null, { status: 204 });
}
