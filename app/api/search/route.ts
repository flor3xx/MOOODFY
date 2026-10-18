import { NextResponse } from "next/server";
import { searchRecordings, type SearchErrorCode } from "@/lib/musicbrainz";

/**
 * Public JSON seam for search: GET /api/search?q=...
 * Prototype limits are documented in the README: results come from the public
 * MusicBrainz web service, rate-limited to about one request per second, so no
 * caching layer is added here and no upstream body is ever forwarded.
 */

export const dynamic = "force-dynamic";

const STATUS: Record<SearchErrorCode, number> = {
  invalid_query: 400,
  not_configured: 503,
  timeout: 504,
  provider_error: 502,
  malformed_response: 502,
};

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q");
  const outcome = await searchRecordings({ q: query });

  if (!outcome.ok) {
    return NextResponse.json({ ok: false, code: outcome.code }, { status: STATUS[outcome.code], headers: NO_STORE });
  }

  return NextResponse.json({ ok: true, results: outcome.results }, { headers: NO_STORE });
}
