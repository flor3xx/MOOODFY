/**
 * Site origin used to build the email confirmation link.
 *
 * It is configuration, never a request header: a request-controlled Host would
 * let an attacker point the confirmation link at another origin. When the value
 * is missing or invalid, callers must omit the redirect and let Supabase fall
 * back to the project's configured default.
 *
 * Nothing here is logged, and no URL value is ever returned to the client.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Accepts an absolute http/https URL without credentials, query or hash, and
 * returns it without a trailing slash. Anything else returns null.
 */
export function normalizeSiteUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (candidate.length === 0) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (url.search.length > 0 || url.hash.length > 0) return null;
  if (url.hostname.length === 0) return null;

  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** Normalized site origin plus the fixed callback path, or null. */
export function authCallbackUrl(value: unknown): string | null {
  const site = normalizeSiteUrl(value);
  return site === null ? null : `${site}/auth/callback`;
}

/** Reads NEXT_PUBLIC_SITE_URL without ever surfacing its value. */
export function readSiteUrl(): string | null {
  return normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
}
