"use server";

import { redirect } from "next/navigation";
import {
  CLASSIFY_SAVED_PARAM,
  CLASSIFY_SAVED_VALUE,
  classificationMessage,
  mapRpcError,
  parseClassificationSelection,
  type ClassifyErrorCode,
  type ClassifyFormState,
} from "@/lib/classification";
import { loadDimensionValueIds } from "@/lib/dimensions-server";
import { lookupRecording, normalizeMbid } from "@/lib/musicbrainz";
import { createServerSupabaseClient, getServerClaims } from "@/lib/supabase/server";

/**
 * Classification Server Function.
 *
 * The browser is never trusted: the MBID is re-validated, the three selections
 * are re-checked against the approved vocabulary, and the recording is re-read
 * from MusicBrainz server-side. Any title/artist the form might carry is ignored
 * — the database stores what the provider says, not what the client claims.
 *
 * The write itself is one RPC (`public.classify_song`), which is the only place
 * allowed to write catalog rows; `authenticated` has no direct write grants.
 * Failures become fixed messages, never raw provider or database text.
 */
export async function classifySongAction(
  _previous: ClassifyFormState,
  formData: FormData,
): Promise<ClassifyFormState> {
  const fail = (code: ClassifyErrorCode): ClassifyFormState => ({
    status: "error",
    message: classificationMessage(code),
  });

  // Authorization point: verified claims, never a client-supplied user id.
  const claims = await getServerClaims();
  if (!claims || typeof claims.sub !== "string" || claims.sub.length === 0) {
    return fail("not_authenticated");
  }

  const mbid = normalizeMbid(formData.get("mbid"));
  if (!mbid) return fail("invalid_input");

  const selection = parseClassificationSelection({
    mood: formData.get("mood"),
    energia: formData.get("energia"),
    atmosfera: formData.get("atmosfera"),
  });
  if (!selection.ok) return fail("invalid_input");

  // Server-side source of truth for the song metadata.
  const lookup = await lookupRecording({ mbid });
  if (!lookup.ok) {
    const missing = lookup.code === "not_found" || lookup.code === "invalid_id";
    return fail(missing ? "song_not_found" : "provider_unavailable");
  }

  // Labels -> database ids, read from the public reference tables.
  const ids = await loadDimensionValueIds();
  if (!ids) return fail("storage_unavailable");
  const mood = ids.get("mood")?.get(selection.values.mood);
  const energia = ids.get("energia")?.get(selection.values.energia);
  const atmosfera = ids.get("atmosfera")?.get(selection.values.atmosfera);
  if (!mood || !energia || !atmosfera) return fail("invalid_input");

  const supabase = await createServerSupabaseClient();
  if (!supabase) return fail("storage_unavailable");

  const { data, error } = await supabase.rpc("classify_song", {
    p_mbid: mbid,
    p_title: lookup.recording.title,
    p_mood_value_id: mood,
    p_energia_value_id: energia,
    p_atmosfera_value_id: atmosfera,
  });

  if (error) return fail(mapRpcError(error.message));
  if (typeof data !== "string" || data.length === 0) return fail("storage_unavailable");

  redirect(`/songs/${encodeURIComponent(mbid)}?${CLASSIFY_SAVED_PARAM}=${CLASSIFY_SAVED_VALUE}`);
}
