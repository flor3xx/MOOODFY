/**
 * MusicBrainz provider — SERVER ONLY (search + single-recording lookup). Do not
 * import this module from a client component: only `import type` for the result
 * shape (erased at build).
 *
 * Prototype: public MusicBrainz web service, no API key, but a meaningful
 * User-Agent is mandatory (MUSICBRAINZ_USER_AGENT) and MusicBrainz asks clients
 * to stay at roughly one request per second. Commercial use must not scale on
 * this endpoint: swap this module for a local CC0 core dataset or an approved
 * MetaBrainz agreement. Keep the surface below narrow so that swap stays cheap.
 */

export const MAX_QUERY_LENGTH = 100;
export const RESULT_LIMIT = 10;
/** One bounded first page of recordings for the artist detail route. */
export const ARTIST_RECORDINGS_LIMIT = 50;

const ENDPOINT = "https://musicbrainz.org/ws/2/recording";
const RECORDING_URL = "https://musicbrainz.org/recording/";
const ARTIST_ENDPOINT = "https://musicbrainz.org/ws/2/artist";
const ARTIST_URL = "https://musicbrainz.org/artist/";
const TIMEOUT_MS = 5000;

/**
 * A direct provider link normalized from a MusicBrainz URL relation. Only the
 * two providers the UI renders are recognized; the URL is re-serialized from
 * the parsed value, so nothing but a canonical https link can reach an href.
 */
export type ProviderName = "spotify" | "apple_music";

export type ProviderLink = {
  provider: ProviderName;
  url: string;
  /** true when read from a MusicBrainz url-relation, false for a generated search link. */
  direct: boolean;
};

/** Only the stable fields this UI needs; nothing else is stored or forwarded. */
export type Recording = {
  mbid: string;
  title: string;
  artists: string[];
  releaseTitle: string | null;
  firstReleaseDate: string | null;
  url: string;
  /** Safe direct Spotify/Apple Music links carried by the provider, when present. */
  links: ProviderLink[];
};

/** Stable artist fields; `disambiguation`/`country`/`type` only when present. */
export type Artist = {
  mbid: string;
  name: string;
  disambiguation: string | null;
  country: string | null;
  type: string | null;
  url: string;
};

export type SearchErrorCode =
  | "invalid_query"
  | "not_configured"
  | "timeout"
  | "provider_error"
  | "malformed_response";

export type SearchOutcome = { ok: true; results: Recording[] } | { ok: false; code: SearchErrorCode };

export type ArtistSearchOutcome = { ok: true; results: Artist[] } | { ok: false; code: SearchErrorCode };

export type QueryCheck = { ok: true; query: string } | { ok: false; reason: "empty" | "too_long" };

export function normalizeQuery(input: unknown): QueryCheck {
  if (typeof input !== "string") return { ok: false, reason: "empty" };
  const query = input.trim().replace(/\s+/g, " ");
  if (query.length === 0) return { ok: false, reason: "empty" };
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, query };
}

/** What the homepage search form looks for. Anything unknown means recordings. */
export type SearchKind = "recording" | "artist";

export function normalizeSearchKind(input: unknown): SearchKind {
  return typeof input === "string" && input.trim().toLowerCase() === "artist"
    ? "artist"
    : "recording";
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

/** Artist search: `/ws/2/artist`, same bounded/identified request as recordings. */
export async function searchArtists(options: SearchOptions): Promise<ArtistSearchOutcome> {
  const check = normalizeQuery(options.q);
  if (!check.ok) return { ok: false, code: "invalid_query" };

  const userAgent = (options.userAgent ?? process.env.MUSICBRAINZ_USER_AGENT ?? "").trim();
  if (userAgent.length === 0) return { ok: false, code: "not_configured" };

  const request = new URL(ARTIST_ENDPOINT);
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
    return { ok: false, code: isAbort(error) ? "timeout" : "provider_error" };
  }

  if (!response.ok) return { ok: false, code: "provider_error" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "malformed_response" };
  }

  const artists = isRecord(body) ? body.artists : undefined;
  if (!Array.isArray(artists)) return { ok: false, code: "malformed_response" };

  const seen = new Set<string>();
  const results: Artist[] = [];
  for (const entry of artists) {
    const artist = toArtist(entry);
    if (artist && !seen.has(artist.mbid)) {
      seen.add(artist.mbid);
      results.push(artist);
    }
  }

  return { ok: true, results };
}

export type LookupErrorCode =
  | "invalid_id"
  | "not_configured"
  | "not_found"
  | "timeout"
  | "provider_error"
  | "malformed_response";

export type LookupOutcome =
  | { ok: true; recording: Recording }
  | { ok: false; code: LookupErrorCode };

/**
 * Strict MBID validation. MusicBrainz identifiers are RFC 4122 UUIDs; only the
 * canonical 8-4-4-4-12 hex form (hyphenated or not, any case) is accepted, and
 * the returned value is re-rendered from hex, so nothing from the caller can
 * add a path segment or a query parameter to the upstream URL.
 */
export function normalizeMbid(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const hex = input.trim().replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export type LookupOptions = {
  mbid: unknown;
  /** Defaults to MUSICBRAINZ_USER_AGENT; injected in tests. */
  userAgent?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

/**
 * Single-recording lookup by MBID, normalized into the same stable `Recording`
 * shape as search. Provider bodies never leave this function: every failure is
 * a code from `LookupErrorCode`.
 */
export async function lookupRecording(options: LookupOptions): Promise<LookupOutcome> {
  const mbid = normalizeMbid(options.mbid);
  if (!mbid) return { ok: false, code: "invalid_id" };

  const userAgent = (options.userAgent ?? process.env.MUSICBRAINZ_USER_AGENT ?? "").trim();
  if (userAgent.length === 0) return { ok: false, code: "not_configured" };

  const request = new URL(`${ENDPOINT}/${mbid}`);
  request.searchParams.set("fmt", "json");
  // url-rels carries the external provider relations (Spotify, Apple Music).
  request.searchParams.set("inc", "artist-credits releases url-rels");

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(request, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, code: isAbort(error) ? "timeout" : "provider_error" };
  }

  // A well-formed id that MusicBrainz does not know is a 404, not a failure.
  if (response.status === 404) return { ok: false, code: "not_found" };
  if (!response.ok) return { ok: false, code: "provider_error" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "malformed_response" };
  }

  const recording = toRecording(body);
  return recording ? { ok: true, recording } : { ok: false, code: "malformed_response" };
}

export type ArtistLookupOutcome =
  | { ok: true; artist: Artist }
  | { ok: false; code: LookupErrorCode };

/** Single-artist lookup by MBID, normalized into the stable `Artist` shape. */
export async function lookupArtist(options: LookupOptions): Promise<ArtistLookupOutcome> {
  const mbid = normalizeMbid(options.mbid);
  if (!mbid) return { ok: false, code: "invalid_id" };

  const userAgent = (options.userAgent ?? process.env.MUSICBRAINZ_USER_AGENT ?? "").trim();
  if (userAgent.length === 0) return { ok: false, code: "not_configured" };

  const request = new URL(`${ARTIST_ENDPOINT}/${mbid}`);
  request.searchParams.set("fmt", "json");

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(request, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, code: isAbort(error) ? "timeout" : "provider_error" };
  }

  if (response.status === 404) return { ok: false, code: "not_found" };
  if (!response.ok) return { ok: false, code: "provider_error" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "malformed_response" };
  }

  const artist = toArtist(body);
  return artist ? { ok: true, artist } : { ok: false, code: "malformed_response" };
}

export type ArtistRecordingsOutcome =
  | { ok: true; recordings: Recording[] }
  | { ok: false; code: LookupErrorCode };

export type ArtistRecordingsOptions = LookupOptions & { limit?: number };

/**
 * Recordings by artist, via the documented browse endpoint (`/ws/2/recording
 * ?artist=<mbid>`). Bounded to `ARTIST_RECORDINGS_LIMIT`; no pagination here.
 */
export async function browseArtistRecordings(
  options: ArtistRecordingsOptions,
): Promise<ArtistRecordingsOutcome> {
  const mbid = normalizeMbid(options.mbid);
  if (!mbid) return { ok: false, code: "invalid_id" };

  const userAgent = (options.userAgent ?? process.env.MUSICBRAINZ_USER_AGENT ?? "").trim();
  if (userAgent.length === 0) return { ok: false, code: "not_configured" };

  const requested = Number.isFinite(options.limit) ? Math.trunc(options.limit as number) : ARTIST_RECORDINGS_LIMIT;
  const limit = Math.min(Math.max(1, requested), ARTIST_RECORDINGS_LIMIT);

  const request = new URL(ENDPOINT);
  request.searchParams.set("artist", mbid);
  request.searchParams.set("fmt", "json");
  request.searchParams.set("limit", String(limit));
  request.searchParams.set("inc", "artist-credits");

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(request, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
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

  return { ok: true, recordings: results };
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
    links: recordingLinks(entry.relations),
  };
}

function toArtist(entry: unknown): Artist | null {
  if (!isRecord(entry)) return null;
  const mbid = text(entry.id);
  const name = text(entry.name);
  if (!mbid || !name) return null;
  return {
    mbid,
    name,
    disambiguation: text(entry.disambiguation),
    country: text(entry.country),
    type: text(entry.type),
    url: `${ARTIST_URL}${encodeURIComponent(mbid)}`,
  };
}

/**
 * Hostnames MusicBrainz url-relations may point at. Only these two providers
 * are rendered, so only these are normalized; every other relation is dropped.
 */
const PROVIDER_HOSTS: Record<string, ProviderName> = {
  "open.spotify.com": "spotify",
  "spotify.com": "spotify",
  "music.apple.com": "apple_music",
  "itunes.apple.com": "apple_music",
};

const PROVIDER_ORDER: readonly ProviderName[] = ["spotify", "apple_music"];

/** Accepts only a canonical https URL on a known provider host. */
export function providerFromUrl(value: unknown): { provider: ProviderName; url: string } | null {
  if (typeof value !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const provider = PROVIDER_HOSTS[parsed.hostname.toLowerCase().replace(/^www\./, "")];
  if (!provider) return null;
  // Re-serialized from the parsed URL: the raw provider string never reaches an href.
  return { provider, url: parsed.toString() };
}

function recordingLinks(relations: unknown): ProviderLink[] {
  if (!Array.isArray(relations)) return [];
  const seen = new Set<ProviderName>();
  const links: ProviderLink[] = [];
  for (const relation of relations) {
    if (!isRecord(relation)) continue;
    const resource = isRecord(relation.url) ? relation.url.resource : null;
    const parsed = providerFromUrl(resource);
    if (!parsed || seen.has(parsed.provider)) continue;
    seen.add(parsed.provider);
    links.push({ provider: parsed.provider, url: parsed.url, direct: true });
  }
  return links;
}

/**
 * Spotify and Apple Music links, in a fixed order: the direct url-relation when
 * MusicBrainz has one, otherwise a deterministic search URL built from the
 * validated title and artist credits. `direct` lets the UI label them honestly.
 */
export function streamingLinks(
  recording: Pick<Recording, "title" | "artists" | "links">,
): ProviderLink[] {
  const direct = new Map(recording.links.map((link) => [link.provider, link.url]));
  const term = [recording.title, ...recording.artists].join(" ").trim();
  return PROVIDER_ORDER.map((provider) => {
    const url = direct.get(provider) ?? providerSearchUrl(provider, term);
    return { provider, url, direct: direct.has(provider) };
  });
}

/** URL/URLSearchParams only: no string-built HTML, no unencoded query. */
function providerSearchUrl(provider: ProviderName, term: string): string {
  if (provider === "spotify") {
    const url = new URL("https://open.spotify.com/search/");
    url.pathname = `${url.pathname}${term}`;
    return url.toString();
  }
  const url = new URL("https://music.apple.com/search");
  url.searchParams.set("term", term);
  return url.toString();
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
