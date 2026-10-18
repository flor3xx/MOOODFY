/**
 * "My classifications" loader — SERVER ONLY.
 *
 * Reads the signed-in user's own classification_votes (RLS owner SELECT), then
 * resolves the visible song title/status/source and the dimension/value labels
 * from the public reference tables. Five bounded, explicitly ordered reads on
 * the request-specific server client; no service_role, no relation embedding.
 *
 * Every failure is a fixed reason code. Raw Supabase/PostgREST messages are
 * never returned, logged or rendered.
 */

import { mapMyClassifications, type SongClassification } from "./account-classifications";
import { createServerSupabaseClient } from "./supabase/server";

export type MyClassificationsReason = "unconfigured" | "unavailable" | "error";

export type MyClassificationsLoad =
  | { ok: true; rows: SongClassification[] }
  | { ok: false; reason: MyClassificationsReason };

/** Bounded first page: 100 votes is roughly 33 fully classified songs. */
const VOTE_LIMIT = 100;
const ROW_LIMIT = 200;

export async function loadMyClassifications(): Promise<MyClassificationsLoad> {
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!supabase) return { ok: false, reason: "unconfigured" };

  try {
    const votes = await supabase
      .from("classification_votes")
      .select("song_id,dimension_id,value_id")
      .order("created_at", { ascending: false })
      .limit(VOTE_LIMIT);
    if (votes.error) return { ok: false, reason: "error" };

    const songIds = distinct(votes.data, "song_id");
    if (songIds.length === 0) return { ok: true, rows: [] };

    const [songs, sources, values, dimensions] = await Promise.all([
      supabase.from("songs").select("id,title,status").in("id", songIds).limit(ROW_LIMIT),
      supabase
        .from("song_sources")
        .select("song_id,provider,external_id")
        .eq("provider", "musicbrainz")
        .in("song_id", songIds)
        .limit(ROW_LIMIT),
      supabase.from("dimension_values").select("id,value").limit(ROW_LIMIT),
      supabase.from("dimensions").select("id,slug").limit(ROW_LIMIT),
    ]);

    if (songs.error || sources.error || values.error || dimensions.error) {
      return { ok: false, reason: "error" };
    }

    const rows = mapMyClassifications({
      votes: votes.data ?? [],
      songs: songs.data,
      sources: sources.data,
      values: values.data,
      dimensions: dimensions.data,
    });
    return rows ? { ok: true, rows } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function distinct(rows: unknown, column: string): string[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const value = (row as Record<string, unknown>)[column];
    if (typeof value === "string" && value.length > 0) seen.add(value);
  }
  return [...seen];
}
