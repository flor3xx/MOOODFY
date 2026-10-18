import assert from "node:assert/strict";
import test from "node:test";
import { DIMENSION_IDS, DIMENSIONS, mapDimensions, type Dimension } from "./dimensions.ts";

/** Rows exactly as PostgREST returns them for the approved seed. */
const DIMENSION_ROWS = [
  { id: "d-mood", slug: "mood", label: "Mood", sort_order: 1 },
  { id: "d-energia", slug: "energia", label: "Energia", sort_order: 2 },
  { id: "d-atmosfera", slug: "atmosfera", label: "Atmosfera", sort_order: 3 },
];

const VALUE_ROWS = [
  { dimension_id: "d-mood", value: "Felice", sort_order: 1 },
  { dimension_id: "d-mood", value: "Chill", sort_order: 7 },
  { dimension_id: "d-energia", value: "Alta", sort_order: 4 },
  { dimension_id: "d-atmosfera", value: "Notturna", sort_order: 1 },
];

test("the local fallback is itself a well-formed approved vocabulary", () => {
  assert.equal(DIMENSIONS.length, 3);
  assert.deepEqual(
    DIMENSIONS.map((dimension) => dimension.id),
    DIMENSION_IDS,
  );
  assert.equal(
    DIMENSIONS.reduce((total, dimension) => total + dimension.values.length, 0),
    28,
  );
  for (const dimension of DIMENSIONS) {
    assert.ok(dimension.label.length > 0);
    assert.equal(new Set(dimension.values).size, dimension.values.length, dimension.id);
  }
});

test("valid rows map to the Dimension shape", () => {
  assert.deepEqual(mapDimensions(DIMENSION_ROWS, VALUE_ROWS), [
    { id: "mood", label: "Mood", values: ["Felice", "Chill"] },
    { id: "energia", label: "Energia", values: ["Alta"] },
    { id: "atmosfera", label: "Atmosfera", values: ["Notturna"] },
  ]);
});

test("dimensions and values are ordered by sort_order, not by row order", () => {
  const mapped = mapDimensions(
    [...DIMENSION_ROWS].reverse(),
    [...VALUE_ROWS].reverse(),
  ) as Dimension[];
  assert.deepEqual(
    mapped.map((dimension) => dimension.id),
    ["mood", "energia", "atmosfera"],
  );
  assert.deepEqual(mapped[0].values, ["Felice", "Chill"]);
});

test("only the three approved slugs are accepted, whatever else is returned", () => {
  const mapped = mapDimensions(
    [
      { id: "d-x", slug: "genere", label: "Genere", sort_order: 0 },
      { id: "d-mood", slug: "mood", label: "Mood", sort_order: 1 },
    ],
    [
      { dimension_id: "d-x", value: "Rock", sort_order: 1 },
      { dimension_id: "d-mood", value: "Felice", sort_order: 1 },
    ],
  );
  assert.deepEqual(mapped, [{ id: "mood", label: "Mood", values: ["Felice"] }]);

  // A slug that is not one of the three cannot become a dimension id.
  assert.equal(mapDimensions([{ id: "d", slug: "genere", label: "Genere", sort_order: 1 }], []), null);
});

test("malformed rows are dropped, not trusted", () => {
  const mapped = mapDimensions(
    [
      null,
      "mood",
      42,
      [],
      {},
      { id: "d-mood" },
      { id: "d-mood", slug: "mood", label: "", sort_order: 1 },
      { id: "d-mood", slug: "mood", label: "   ", sort_order: 1 },
      { id: "d-mood", slug: "mood", label: "Mood", sort_order: "1" },
      { id: "d-mood", slug: "mood", label: "Mood", sort_order: Number.NaN },
      { slug: "mood", label: "No id", sort_order: 1 },
      { id: "d-ok", slug: "mood", label: "Mood", sort_order: 1 },
    ],
    [
      null,
      "Felice",
      {},
      { value: "Felice", sort_order: 1 },
      { dimension_id: "d-ok", sort_order: 1 },
      { dimension_id: "d-ok", value: "", sort_order: 1 },
      { dimension_id: "d-ok", value: "Felice", sort_order: "1" },
      { dimension_id: "d-ok", value: "Felice", sort_order: 1 },
    ],
  );
  assert.deepEqual(mapped, [{ id: "mood", label: "Mood", values: ["Felice"] }]);
});

test("values pointing at an unknown dimension are dropped", () => {
  assert.deepEqual(
    mapDimensions(
      [{ id: "d-mood", slug: "mood", label: "Mood", sort_order: 1 }],
      [
        { dimension_id: "d-missing", value: "Orfano", sort_order: 1 },
        { dimension_id: "d-mood", value: "Felice", sort_order: 1 },
      ],
    ),
    [{ id: "mood", label: "Mood", values: ["Felice"] }],
  );
});

test("duplicate values and duplicate dimension rows collapse", () => {
  assert.deepEqual(
    mapDimensions(
      [
        { id: "d-mood", slug: "mood", label: "Mood", sort_order: 1 },
        { id: "d-mood", slug: "mood", label: "Mood (dup)", sort_order: 9 },
      ],
      [
        { dimension_id: "d-mood", value: "Felice", sort_order: 1 },
        { dimension_id: "d-mood", value: "Felice", sort_order: 5 },
      ],
    ),
    [{ id: "mood", label: "Mood", values: ["Felice"] }],
  );
});

test("a dimension with no usable value is dropped", () => {
  assert.deepEqual(
    mapDimensions(
      [
        { id: "d-mood", slug: "mood", label: "Mood", sort_order: 1 },
        { id: "d-energia", slug: "energia", label: "Energia", sort_order: 2 },
      ],
      [{ dimension_id: "d-mood", value: "Felice", sort_order: 1 }],
    ),
    [{ id: "mood", label: "Mood", values: ["Felice"] }],
  );
});

test("nothing usable returns null so the caller falls back", () => {
  for (const [dimensionRows, valueRows] of [
    [[], []],
    [DIMENSION_ROWS, []],
    [[], VALUE_ROWS],
    [null, VALUE_ROWS],
    [DIMENSION_ROWS, undefined],
    ["not an array", VALUE_ROWS],
    [{ nope: true }, VALUE_ROWS],
  ] as [unknown, unknown][]) {
    assert.equal(mapDimensions(dimensionRows, valueRows), null, JSON.stringify(dimensionRows));
  }
});

test("mapping never throws on hostile input", () => {
  const hostile = [undefined, null, 0, "", "x", [[]], [{ a: { b: 1 } }], { length: 3 }];
  for (const input of hostile) {
    assert.equal(mapDimensions(input, input), null);
  }
});
