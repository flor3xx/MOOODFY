import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Backward-compatible fallback for the PKCE code flow.
 *
 * The recommended SSR confirmation path is now `/auth/confirm` with a token
 * hash, because this code exchange needs the PKCE verifier stored in the same
 * browser that started the sign-up. This route is kept so existing links (and
 * projects whose email template still uses `{{ .ConfirmationURL }}`) keep
 * working.
 *
 * Exchanges the confirmation code from the email link for a session, then
 * redirects to fixed internal paths only: no user-supplied destination, so the
 * route cannot be used as an open redirect.
 */

export const dynamic = "force-dynamic";

const LOGIN_PATH = "/auth/login";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) {
    redirect(`${LOGIN_PATH}?errore=link`);
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) redirect(`${LOGIN_PATH}?errore=config`);

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) redirect(`${LOGIN_PATH}?errore=link`);

  redirect("/");
}
