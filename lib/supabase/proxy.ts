import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseEnv } from "./env";

/** The refreshed response plus the verified user id, when there is one. */
export type SessionUpdate = { response: NextResponse; userId: string | null };

/**
 * Session refresh for the requests matched by `proxy.ts`.
 *
 * The response carries the rotated cookies; `userId` is the *verified* claim
 * (`getClaims()`, never `getSession()`), so a route that needs an identity can
 * decide before React renders. It never redirects on its own: public pages
 * stay public, and any Server Function or Route Handler that returns private
 * data must still check the claims itself.
 */
export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  const config = readSupabaseEnv();
  // Unconfigured: nothing to refresh, and no request should fail because of it.
  if (!config) return { response: NextResponse.next({ request }), userId: null };

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

  let userId: string | null = null;
  try {
    // getClaims() verifies the token signature and refreshes a token that is
    // about to expire. getSession() would trust the cookie without verifying it.
    const { data } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    userId = typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    // Fail closed: an unreadable session is a signed-out visitor.
    userId = null;
  }

  return { response, userId };
}
