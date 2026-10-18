/**
 * MusicBrainz search provider — SERVER ONLY. Do not import this module from a
 * client component: only `import type` for the result shape (erased at build).
 *
 * Prototype: public MusicBrainz web service, no API key, but a meaningful
 * User-Agent is mandatory (MUSICBRAINZ_USER_AGENT) and MusicBrainz asks clients
 * to stay at roughly one request per second. Commercial use must not scale on
 * this endpoint: swap this module for a local CC0 core dataset or an approved
 * MetaBrainz agreement. Keep the surface below narrow so that swap stays cheap.
 */

export const MAX_QUERY_LENGTH = 100;
export const RESULT_LIMIT = 10;

const ENDPOINT = "https://musicbrainz.org/ws/2/recording";
const RECORDING_URL = "https://musicbrainz.org/recording/";
const TIMEOUT_MS = 5000;

/** Only the stable fields this UI needs; nothing else is stored or forwarded. */
export type Recording = {
  mbid: string;
  title: string;
  artists: string[];
  releaseTitle: string | null;
  firstReleaseDate: string | null;
  url: string;
};

export type SearchErrorCode =
  | "invalid_query"
  | "not_configured"
  | "timeout"
  | "provider_error"
  | "malformed_response";

export type SearchOutcome = { ok: true; results: Recording[] } | { ok: false; code: SearchErrorCode };

export type QueryCheck = { ok: true; query: string } | { ok: false; reason: "empty" | "too_long" };

export function normalizeQuery(input: unknown): QueryCheck {
  if (typeof input !== "string") return { ok: false, reason: "empty" };
  const query = input.trim().replace(/\s+/g, " ");
  if (query.length === 0) return { ok: false, reason: "empty" };
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, query };
}

type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export type SearchOptions = {
  q: unknown;
  /** Defaults to MUSICBRAINZ_USER_AGENT; injected in tests. */
  userAgent?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export async function searchRecordings(options: SearchOptions): Promise<SearchOutcome> {
  const check = normalizeQuery(options.q);
  if (!check.ok) return { ok: false, code: "invalid_query" };

  const userAgent = (options.userAgent ?? process.env.MUSICBRAINZ_USER_AGENT ?? "").trim();
  if (userAgent.length === 0) return { ok: false, code: "not_configured" };

  const request = new URL(ENDPOINT);
  request.searchParams.set("query", check.query);
  request.searchParams.set("fmt", "json");
  request.searchParams.set("limit", String(RESULT_LIMIT));

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(request, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    // Never surface the provider failure text to callers.
    return { ok: false, code: isAbort(error) ? "timeout" : "provider_error" };
  }

  if (!response.ok) return { ok: false, code: "provider_error" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "malformed_response" };
  }

  const recordings = isRecord(body) ? body.recordings : undefined;
  if (!Array.isArray(recordings)) return { ok: false, code: "malformed_response" };

  const seen = new Set<string>();
  const results: Recording[] = [];
  for (const entry of recordings) {
    const recording = toRecording(entry);
    if (recording && !seen.has(recording.mbid)) {
      seen.add(recording.mbid);
      results.push(recording);
    }
  }

  return { ok: true, results };
}

function toRecording(entry: unknown): Recording | null {
  if (!isRecord(entry)) return null;
  const mbid = text(entry.id);
  const title = text(entry.title);
  if (!mbid || !title) return null;

  const releases = Array.isArray(entry.releases) ? entry.releases : [];
  const firstRelease = isRecord(releases[0]) ? releases[0] : null;
  const releaseGroup = firstRelease && isRecord(firstRelease["release-group"])
    ? firstRelease["release-group"]
    : null;

  return {
    mbid,
    title,
    artists: artistNames(entry["artist-credit"]),
    releaseTitle: text(releaseGroup?.title) ?? text(firstRelease?.title),
    firstReleaseDate: isoDate(entry["first-release-date"]) ?? isoDate(firstRelease?.date),
    url: `${RECORDING_URL}${encodeURIComponent(mbid)}`,
  };
}

function artistNames(credit: unknown): string[] {
  if (!Array.isArray(credit)) return [];
  const names: string[] = [];
  for (const item of credit) {
    if (!isRecord(item)) continue;
    const name = text(item.name) ?? (isRecord(item.artist) ? text(item.artist.name) : null);
    if (name) names.push(name);
  }
  return names;
}

/** MusicBrainz dates arrive as YYYY, YYYY-MM or YYYY-MM-DD. */
function isoDate(value: unknown): string | null {
  const candidate = text(value);
  return candidate && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(candidate) && !candidate.startsWith("0000")
    ? candidate
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown): boolean {
  const name = isRecord(error) ? error.name : undefined;
  return name === "TimeoutError" || name === "AbortError";
}
