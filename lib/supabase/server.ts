import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readSupabaseEnv } from "./env";

/**
 * Request-specific server client for Server Components, Server Actions and
 * Route Handlers. Never hoist this into a module-level singleton: it reads the
 * cookies of the current request, and reusing one across requests would leak
 * sessions and drop the cache headers that keep responses uncacheable.
 *
 * Returns null when Supabase is not configured, so callers can show an honest
 * state instead of throwing.
 */
export async function createServerSupabaseClient() {
  const config = readSupabaseEnv();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot write cookies. Proxy.ts refreshes the
          // session cookies (and the no-store headers) on every matched
          // request, so ignoring this here is safe.
        }
      },
    },
  });
}

/**
 * Verified JWT claims for the current request, or null when signed out or
 * unconfigured. Use this (never getSession()) before trusting an identity.
 */
export async function getServerClaims() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
}
