/**
 * Dimension taxonomy loader — SERVER ONLY. Do not import this module from a
 * client component; the homepage awaits it in a Server Component.
 *
 * Reads the approved vocabulary from the public reference tables with the
 * publishable key (RLS is the only thing deciding visibility) and never writes.
 * Two small SELECTs, only the columns needed, explicitly ordered and bounded.
 *
 * Every failure mode resolves to the local `DIMENSIONS` fallback plus a fixed
 * reason code. Raw Supabase/PostgREST messages are never returned, logged or
 * rendered: the caller only ever sees `remote` or a reason from a closed union.
 */

import { DIMENSIONS, mapDimensions, type Dimension } from "./dimensions";
import { createServerSupabaseClient } from "./supabase/server";

/** Why the read fell back to the local vocabulary. */
export type DimensionFallbackReason =
  | "unconfigured" // no public Supabase env
  | "unavailable" // the per-request client could not be built
  | "query_failed" // Supabase refused or was unreachable
  | "unusable"; // answered, but with no usable taxonomy in it

export type DimensionLoad =
  | { source: "remote"; dimensions: Dimension[] }
  | { source: "fallback"; reason: DimensionFallbackReason; dimensions: Dimension[] };

/**
 * Hard cap per read. The approved vocabulary is 3 dimensions + 28 values, so
 * this cannot truncate it; it only stops an unexpected schema from streaming an
 * unbounded table into the page.
 */
const ROW_LIMIT = 200;

export async function loadDimensions(): Promise<DimensionLoad> {
  const fallback = (reason: DimensionFallbackReason): DimensionLoad => ({
    source: "fallback",
    reason,
    dimensions: DIMENSIONS,
  });

  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return fallback("unavailable");
  }
  if (!supabase) return fallback("unconfigured");

  try {
    // Separate reads on purpose: no reliance on PostgREST relation embedding,
    // and the two reference tables stay independently typed and ordered.
    const [dimensions, values] = await Promise.all([
      supabase
        .from("dimensions")
        .select("id,slug,label,sort_order")
        .order("sort_order")
        .limit(ROW_LIMIT),
      supabase
        .from("dimension_values")
        .select("dimension_id,value,sort_order")
        .order("sort_order")
        .limit(ROW_LIMIT),
    ]);

    if (dimensions.error || values.error) return fallback("query_failed");

    const mapped = mapDimensions(dimensions.data, values.data);
    return mapped ? { source: "remote", dimensions: mapped } : fallback("unusable");
  } catch {
    return fallback("query_failed");
  }
}
