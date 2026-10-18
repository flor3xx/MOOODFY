import { NextResponse, type NextRequest } from "next/server";
import { normalizeMbid } from "@/lib/musicbrainz";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Two jobs, one proxy:
 *
 * 1. Reject a malformed song MBID before React renders. `notFound()` inside a
 *    streamed response cannot change the status code any more (the shell and the
 *    loading UI have already been sent as 200), so an invalid identifier can only
 *    become a real HTTP 404 here, before the page renders. See
 *    node_modules/next/dist/docs/01-app/02-guides/streaming.md ("Status codes").
 * 2. Refresh Supabase session cookies for the routes that read the session.
 *
 * It never redirects: every page of this prototype stays public.
 */

/** Exactly one segment below /songs (the detail route), with an optional slash. */
const SONG_DETAIL_PATH = /^\/songs\/([^/]+)\/?$/;

export async function proxy(request: NextRequest) {
  const match = SONG_DETAIL_PATH.exec(request.nextUrl.pathname);

  if (match) {
    let mbid: string;
    try {
      mbid = decodeURIComponent(match[1]);
    } catch {
      mbid = "";
    }
    if (!normalizeMbid(mbid)) return invalidMbidResponse();
    // Valid shape: nothing to refresh here, the detail page reads no session.
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  // Narrow on purpose. Server Functions of a route are POSTs to that same
  // route, so /auth/* coverage also covers the login and sign-up actions.
  matcher: ["/", "/auth/:path*", "/songs/:path*"],
};

/**
 * Pre-React fallback, so the RawBlock tokens/fonts of app/globals.css are not
 * available: plain black-on-white, square, blue link only. The styled
 * not-found page (app/songs/[mbid]/not-found.tsx) covers everything that does
 * get to render.
 */
function invalidMbidResponse() {
  return new NextResponse(
    `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Brano non trovato — MOOODFY</title>
    <style>
      body { margin: 0; background: #ffffff; color: #000000; font-family: Arial, sans-serif; line-height: 1.6; }
      main { max-width: 1100px; margin: 0 auto; padding: 24px; }
      h1 { font-size: 2.5rem; line-height: 1; margin: 0 0 8px; }
      a { color: #0000ff; }
    </style>
  </head>
  <body>
    <main>
      <h1>Brano non trovato</h1>
      <p>L'identificativo nella URL non &egrave; un MBID valido.</p>
      <p><a href="/">&larr; Torna alla ricerca</a></p>
    </main>
  </body>
</html>`,
    {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}
