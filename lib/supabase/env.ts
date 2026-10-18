/**
 * Public Supabase configuration read from `NEXT_PUBLIC_*` variables.
 *
 * The publishable key is public (it ships to the browser) and is protected by
 * RLS. Never put a service_role / secret key in these variables.
 */

export type SupabaseEnv = { url: string; key: string };

export function readSupabaseEnv(): SupabaseEnv | null {
  // Literal property access so Next.js can inline these in client bundles.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseEnv() !== null;
}
