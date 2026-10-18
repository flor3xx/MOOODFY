/**
 * Approved dimension vocabulary.
 *
 * The database seed (supabase/migrations/0001_dimensions.sql) is the source of
 * truth and is read per request by lib/dimensions-server.ts. `DIMENSIONS` here is
 * the local fallback used when Supabase is not configured, is unreachable, or
 * returns something unexpected. `mapDimensions` validates the untyped rows of
 * that read into this shape; it is pure, so it stays unit-testable.
 *
 * This module must stay importable from a client component: no server imports.
 */

export type DimensionId = "mood" | "energia" | "atmosfera";

export const DIMENSION_IDS: readonly DimensionId[] = ["mood", "energia", "atmosfera"];

export type Dimension = {
  id: DimensionId;
  label: string;
  values: string[];
};

export const DIMENSIONS: Dimension[] = [
  {
    id: "mood",
    label: "Mood",
    values: [
      "Felice",
      "Malinconico",
      "Arrabbiato",
      "Romantico",
      "Nostalgico",
      "Rilassato",
      "Chill",
      "Oscuro",
      "Ansioso",
      "Euforico",
      "Riflessivo",
      "Ribelle",
    ],
  },
  {
    id: "energia",
    label: "Energia",
    values: ["Molto bassa", "Bassa", "Media", "Alta", "Esplosiva"],
  },
  {
    id: "atmosfera",
    label: "Atmosfera",
    values: [
      "Notturna",
      "Calda",
      "Fredda",
      "Intima",
      "Spaziosa",
      "Eterea",
      "Ipnotica",
      "Gritty",
      "Luminosa",
      "Misteriosa",
      "Fantasy",
    ],
  },
];

/**
 * Build the `Dimension[]` shape from the two untyped result sets of the public
 * read: `dimensions` rows (id, slug, label, sort_order) and `dimension_values`
 * rows (dimension_id, value, sort_order).
 *
 * Rows that do not fit are dropped rather than trusted; anything unusable
 * (non-arrays, no recognised dimension, a dimension with no usable value)
 * returns null so the caller can fall back to `DIMENSIONS`. Order comes from
 * sort_order, never from the order PostgREST happened to return.
 */
export function mapDimensions(dimensionRows: unknown, valueRows: unknown): Dimension[] | null {
  if (!Array.isArray(dimensionRows) || !Array.isArray(valueRows)) return null;

  // UUID -> slug, used to attach each value row to its dimension.
  const slugByUuid = new Map<string, DimensionId>();
  const dimensions: { id: DimensionId; label: string; sortOrder: number }[] = [];

  for (const row of dimensionRows) {
    if (!isRecord(row)) continue;
    const id = toDimensionId(row.slug);
    const uuid = text(row.id);
    const label = text(row.label);
    const sortOrder = order(row.sort_order);
    if (!id || !uuid || !label || sortOrder === null) continue;
    if (slugByUuid.has(uuid)) continue;
    slugByUuid.set(uuid, id);
    if (dimensions.some((dimension) => dimension.id === id)) continue; // first row wins
    dimensions.push({ id, label, sortOrder });
  }

  if (dimensions.length === 0) return null;

  const valuesBySlug = new Map<DimensionId, { value: string; sortOrder: number }[]>();
  for (const row of valueRows) {
    if (!isRecord(row)) continue;
    const uuid = text(row.dimension_id);
    const id = uuid ? slugByUuid.get(uuid) : undefined;
    const value = text(row.value);
    const sortOrder = order(row.sort_order);
    if (!id || !value || sortOrder === null) continue;
    const values = valuesBySlug.get(id) ?? [];
    if (values.some((entry) => entry.value === value)) continue;
    values.push({ value, sortOrder });
    valuesBySlug.set(id, values);
  }

  const mapped: Dimension[] = [];
  for (const dimension of dimensions.sort((a, b) => a.sortOrder - b.sortOrder)) {
    const values = (valuesBySlug.get(dimension.id) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((entry) => entry.value);
    if (values.length === 0) continue; // an empty dimension is not usable
    mapped.push({ id: dimension.id, label: dimension.label, values });
  }

  return mapped.length > 0 ? mapped : null;
}

function toDimensionId(value: unknown): DimensionId | null {
  return DIMENSION_IDS.find((id) => id === value) ?? null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function order(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
