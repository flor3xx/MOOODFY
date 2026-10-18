import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Exchanges the confirmation code from the email link for a session, then
 * redirects to fixed internal paths only: no user-supplied destination, so the
 * route cannot be used as an open redirect.
 */

export const dynamic = "force-dynamic";

const LOGIN_PATH = "/auth/login";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const failure = new URL(LOGIN_PATH, request.nextUrl.origin);

  if (!code) {
    failure.searchParams.set("errore", "link");
    return NextResponse.redirect(failure);
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    failure.searchParams.set("errore", "config");
    return NextResponse.redirect(failure);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    failure.searchParams.set("errore", "link");
    return NextResponse.redirect(failure);
  }

  return NextResponse.redirect(new URL("/", request.nextUrl.origin));
}
