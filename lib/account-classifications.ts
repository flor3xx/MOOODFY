/**
 * "My classifications" row normalization — PURE on purpose, so it is unit-tested
 * without a database or a session.
 *
 * The server loader (lib/account-classifications-server.ts) performs five
 * bounded, owner-scoped reads and hands the raw rows here. Rows that do not fit
 * are dropped rather than trusted; nothing here logs or forwards a raw value.
 */

// Explicit .ts extension: `node --test` resolves ESM imports literally.
import { DIMENSION_IDS, type DimensionId } from "./dimensions.ts";
import { normalizeMbid } from "./musicbrainz.ts";

const SONG_STATUSES = [
  "external",
  "community_pending",
  "community_validated",
  "editorial_verified",
  "rejected",
] as const;
export type SongStatus = (typeof SONG_STATUSES)[number];

/** One selected value label per dimension; null when the row is missing. */
export type DimensionValues = Record<DimensionId, string | null>;

export type SongClassification = {
  songId: string;
  title: string;
  status: SongStatus;
  /** Only when a valid MusicBrainz source row exists: used for the /songs link. */
  musicbrainzMbid: string | null;
  values: DimensionValues;
};

export type ClassificationRows = {
  votes: unknown;
  songs: unknown;
  sources: unknown;
  values: unknown;
  dimensions: unknown;
};

/**
 * Folds the owner's votes into one entry per song, resolving the dimension slug
 * and value label from the public reference tables. Anything unusable (a
 * non-array input, an unknown status, a vote whose song/relation is missing)
 * returns `null` or drops the row: the caller shows a fixed state instead.
 */
export function mapMyClassifications(input: ClassificationRows): SongClassification[] | null {
  if (
    !Array.isArray(input.votes) ||
    !Array.isArray(input.songs) ||
    !Array.isArray(input.sources) ||
    !Array.isArray(input.values) ||
    !Array.isArray(input.dimensions)
  ) {
    return null;
  }

  const slugById = new Map<string, DimensionId>();
  for (const row of input.dimensions) {
    if (!isRecord(row)) continue;
    const id = text(row.id);
    const slug = toDimensionId(row.slug);
    if (id && slug) slugById.set(id, slug);
  }

  const labelById = new Map<string, string>();
  for (const row of input.values) {
    if (!isRecord(row)) continue;
    const id = text(row.id);
    const label = text(row.value);
    if (id && label) labelById.set(id, label);
  }

  const songs = new Map<string, { title: string; status: SongStatus }>();
  for (const row of input.songs) {
    if (!isRecord(row)) continue;
    const id = text(row.id);
    const title = text(row.title);
    const status = toStatus(row.status);
    if (id && title && status) songs.set(id, { title, status });
  }

  const mbidBySong = new Map<string, string>();
  for (const row of input.sources) {
    if (!isRecord(row)) continue;
    if (row.provider !== "musicbrainz") continue;
    const songId = text(row.song_id);
    const mbid = normalizeMbid(row.external_id);
    if (songId && mbid && !mbidBySong.has(songId)) mbidBySong.set(songId, mbid);
  }

  // Votes arrive most-recent-first, so the map order is a stable recency order.
  const bySong = new Map<string, SongClassification>();
  for (const row of input.votes) {
    if (!isRecord(row)) continue;
    const songId = text(row.song_id);
    const slug = text(row.dimension_id) ? slugById.get(text(row.dimension_id) as string) : undefined;
    const label = text(row.value_id) ? labelById.get(text(row.value_id) as string) : undefined;
    const song = songId ? songs.get(songId) : undefined;
    if (!songId || !song || !slug || !label) continue;

    const entry =
      bySong.get(songId) ??
      ({
        songId,
        title: song.title,
        status: song.status,
        musicbrainzMbid: mbidBySong.get(songId) ?? null,
        values: { mood: null, energia: null, atmosfera: null },
      } satisfies SongClassification);
    entry.values[slug] = label;
    bySong.set(songId, entry);
  }

  return [...bySong.values()];
}

function toDimensionId(value: unknown): DimensionId | null {
  return DIMENSION_IDS.find((id) => id === value) ?? null;
}

function toStatus(value: unknown): SongStatus | null {
  return SONG_STATUSES.find((status) => status === value) ?? null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
