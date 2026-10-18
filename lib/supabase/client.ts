import { createBrowserClient } from "@supabase/ssr";
import { readSupabaseEnv } from "./env";

/**
 * Supabase client for client components. `createBrowserClient` already
 * memoises a singleton, so calling this per component is fine.
 *
 * Nothing in this slice uses it yet: the auth forms post to Server Functions,
 * which keep the session cookies on the server.
 */
export function createBrowserSupabaseClient() {
  const config = readSupabaseEnv();
  if (!config) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return createBrowserClient(config.url, config.key);
}
