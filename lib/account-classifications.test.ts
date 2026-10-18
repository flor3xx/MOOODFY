import assert from "node:assert/strict";
import test from "node:test";
import { mapMyClassifications, type ClassificationRows } from "./account-classifications.ts";

const MBID = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d";

const DIMENSIONS = [
  { id: "dim-mood", slug: "mood" },
  { id: "dim-energia", slug: "energia" },
  { id: "dim-atmosfera", slug: "atmosfera" },
];

const VALUES = [
  { id: "val-chill", value: "Chill" },
  { id: "val-alta", value: "Alta" },
  { id: "val-notturna", value: "Notturna" },
];

function rows(overrides: Partial<ClassificationRows> = {}): ClassificationRows {
  return {
    votes: [
      { song_id: "song-1", dimension_id: "dim-mood", value_id: "val-chill" },
      { song_id: "song-1", dimension_id: "dim-energia", value_id: "val-alta" },
      { song_id: "song-1", dimension_id: "dim-atmosfera", value_id: "val-notturna" },
    ],
    songs: [{ id: "song-1", title: "Creep", status: "community_pending" }],
    sources: [{ song_id: "song-1", provider: "musicbrainz", external_id: MBID }],
    values: VALUES,
    dimensions: DIMENSIONS,
    ...overrides,
  };
}

test("three votes for one song fold into a single classified row", () => {
  assert.deepEqual(mapMyClassifications(rows()), [
    {
      songId: "song-1",
      title: "Creep",
      status: "community_pending",
      musicbrainzMbid: MBID,
      values: { mood: "Chill", energia: "Alta", atmosfera: "Notturna" },
    },
  ]);
});

test("a song with only some dimensions selected renders the missing ones as null", () => {
  const mapped = mapMyClassifications(
    rows({ votes: [{ song_id: "song-1", dimension_id: "dim-mood", value_id: "val-chill" }] }),
  );
  assert.deepEqual(mapped, [
    {
      songId: "song-1",
      title: "Creep",
      status: "community_pending",
      musicbrainzMbid: MBID,
      values: { mood: "Chill", energia: null, atmosfera: null },
    },
  ]);
});

test("the songs link is only produced from a valid MusicBrainz source", () => {
  const missing = mapMyClassifications(rows({ sources: [] }));
  assert.equal(missing?.[0]?.musicbrainzMbid, null);

  const other = mapMyClassifications(
    rows({ sources: [{ song_id: "song-1", provider: "spotify", external_id: MBID }] }),
  );
  assert.equal(other?.[0]?.musicbrainzMbid, null);

  const malformed = mapMyClassifications(
    rows({ sources: [{ song_id: "song-1", provider: "musicbrainz", external_id: "not-a-uuid" }] }),
  );
  assert.equal(malformed?.[0]?.musicbrainzMbid, null);
});

test("votes whose song is not visible are dropped, not rendered half-way", () => {
  assert.deepEqual(mapMyClassifications(rows({ songs: [] })), []);
});

test("a song with an unknown status is dropped", () => {
  assert.deepEqual(
    mapMyClassifications(rows({ songs: [{ id: "song-1", title: "Creep", status: "draft" }] })),
    [],
  );
});

test("an unknown dimension slug or value id is ignored per vote", () => {
  const mapped = mapMyClassifications(
    rows({
      dimensions: [{ id: "dim-mood", slug: "genere" }],
      values: [{ id: "val-chill", value: "Chill" }],
    }),
  );
  assert.deepEqual(mapped, []);
});

test("malformed rows are skipped, valid rows around them survive", () => {
  const mapped = mapMyClassifications(
    rows({
      votes: [
        "nope",
        null,
        { song_id: "song-1", dimension_id: "dim-mood", value_id: "val-chill" },
        { song_id: "", dimension_id: "dim-energia", value_id: "val-alta" },
        { song_id: "song-1", dimension_id: "dim-energia" },
      ],
      songs: ["nope", { id: "song-1", title: "  Creep  ", status: "community_pending" }, { id: "x" }],
    }),
  );
  assert.deepEqual(mapped, [
    {
      songId: "song-1",
      title: "Creep",
      status: "community_pending",
      musicbrainzMbid: MBID,
      values: { mood: "Chill", energia: null, atmosfera: null },
    },
  ]);
});

test("anything but five arrays is unusable", () => {
  for (const key of ["votes", "songs", "sources", "values", "dimensions"] as const) {
    assert.equal(mapMyClassifications(rows({ [key]: null })), null, key);
    assert.equal(mapMyClassifications(rows({ [key]: "nope" })), null, key);
    assert.equal(mapMyClassifications(rows({ [key]: {} })), null, key);
  }
});

test("row order follows the recency order of the votes, one entry per song", () => {
  const mapped = mapMyClassifications(
    rows({
      votes: [
        { song_id: "song-2", dimension_id: "dim-mood", value_id: "val-chill" },
        { song_id: "song-1", dimension_id: "dim-mood", value_id: "val-chill" },
        { song_id: "song-2", dimension_id: "dim-energia", value_id: "val-alta" },
      ],
      songs: [
        { id: "song-1", title: "Creep", status: "community_validated" },
        { id: "song-2", title: "Karma Police", status: "editorial_verified" },
      ],
    }),
  );
  assert.deepEqual(
    mapped?.map((row) => [row.songId, row.status]),
    [
      ["song-2", "editorial_verified"],
      ["song-1", "community_validated"],
    ],
  );
});

test("titles and labels are returned as plain text, never interpreted", () => {
  const mapped = mapMyClassifications(
    rows({
      songs: [
        { id: "song-1", title: "<b>Creep</b>", status: "community_pending" },
      ],
      values: [{ id: "val-chill", value: "Chill & <script>" }],
      votes: [{ song_id: "song-1", dimension_id: "dim-mood", value_id: "val-chill" }],
      dimensions: [{ id: "dim-mood", slug: "mood" }],
    }),
  );
  assert.equal(mapped?.[0]?.title, "<b>Creep</b>");
  assert.equal(mapped?.[0]?.values.mood, "Chill & <script>");
});
