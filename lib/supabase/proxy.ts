import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseEnv } from "./env";

/**
 * Session refresh for the requests matched by `proxy.ts`.
 *
 * This is a refresh seam, not an authorization layer: it never redirects and
 * never decides access. Public pages stay public, and any Server Function or
 * Route Handler that returns private data must check the claims itself.
 */
export async function updateSession(request: NextRequest) {
  const config = readSupabaseEnv();
  // Unconfigured: nothing to refresh, and no request should fail because of it.
  if (!config) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, cacheHeaders) => {
        // Pass the refreshed cookies upstream to Server Components...
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        // ...and to the browser.
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        // Required so a shared cache cannot store this response with its
        // Set-Cookie header and hand one user's session to another.
        Object.entries(cacheHeaders).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  // getClaims() verifies the token signature and refreshes a token that is
  // about to expire. getSession() would trust the cookie without verifying it.
  await supabase.auth.getClaims();

  return response;
}
