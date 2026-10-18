import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Sign out. POST only, so a link, prefetch or crawler cannot end a session,
 * and the redirect target is a fixed internal path.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

export function GET() {
  return new Response("Metodo non consentito: usa il pulsante Esci.", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
