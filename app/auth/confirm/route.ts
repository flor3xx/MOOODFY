import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Email confirmation for the SSR token-hash flow.
 *
 * Supabase's current SSR guidance is to make the confirmation email point here
 * with a one-time token hash:
 *
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 *
 * The verification is then `verifyOtp({ type, token_hash })`, which needs
 * nothing stored in the browser. The older `/auth/callback` code exchange needs
 * the PKCE code verifier kept in the *same* browser that started the sign-up, so
 * it fails when the email is opened in another browser, on another device or in
 * a webmail in-app browser — which is exactly the reported failure.
 *
 * The token is never rendered, logged or echoed, and no destination comes from
 * the request: every outcome redirects to a fixed internal path, so this route
 * cannot be used as an open redirect. `redirect()` (not a hand-built response)
 * is used so the session cookies written by the server client are flushed with
 * the response.
 */

export const dynamic = "force-dynamic";

const LOGIN_PATH = "/auth/login";

/**
 * Only the email-confirmation types are accepted. `email` is what the current
 * confirmation template sends; `signup` keeps templates that still use it
 * working. Anything missing or unknown is refused *before* it reaches Supabase.
 */
const CONFIRM_TYPES = ["email", "signup"] as const;

type ConfirmType = (typeof CONFIRM_TYPES)[number];

function isConfirmType(value: string | null): value is ConfirmType {
  return value !== null && (CONFIRM_TYPES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const failure = (code: "link" | "config") => `${LOGIN_PATH}?errore=${code}`;

  if (!tokenHash || !isConfirmType(type)) redirect(failure("link"));

  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect(failure("config"));

  // The raw Auth error is never forwarded or logged: only its presence matters.
  let verified = false;
  try {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    verified = !error;
  } catch {
    verified = false;
  }

  if (!verified) redirect(failure("link"));

  // Session cookies were written by the server client above; the redirect
  // carries no token.
  redirect("/");
}
