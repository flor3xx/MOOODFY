import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Refreshes Supabase session cookies for the routes that read the session.
 * It does not redirect: every page of this prototype stays public.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Narrow on purpose. Server Functions of a route are POSTs to that same
  // route, so /auth/* coverage also covers the login and sign-up actions.
  matcher: ["/", "/auth/:path*"],
};
