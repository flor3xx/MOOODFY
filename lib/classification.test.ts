import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_CLASSIFY_STATE,
  classificationMessage,
  mapRpcError,
  parseClassificationSelection,
  type ClassifyErrorCode,
} from "./classification.ts";
import { DIMENSIONS } from "./dimensions.ts";

const VALID = { mood: "Chill", energia: "Alta", atmosfera: "Notturna" };

test("a complete, approved selection is accepted", () => {
  const check = parseClassificationSelection(VALID);
  assert.deepEqual(check, {
    ok: true,
    values: { mood: "Chill", energia: "Alta", atmosfera: "Notturna" },
  });
});

test("surrounding whitespace is trimmed, inner values are not invented", () => {
  const check = parseClassificationSelection({ ...VALID, mood: "  Chill  " });
  assert.ok(check.ok);
  assert.equal(check.values.mood, "Chill");
});

test("one form field per approved dimension is required", () => {
  assert.deepEqual(DIMENSIONS.map((d) => d.id), ["mood", "energia", "atmosfera"]);
  for (const missing of ["mood", "energia", "atmosfera"]) {
    const input: Record<string, unknown> = { ...VALID };
    delete input[missing];
    assert.deepEqual(parseClassificationSelection(input), { ok: false, reason: "missing" }, missing);
  }
});

test("empty, blank and non-string selections are missing, not accepted", () => {
  for (const bad of ["", "   ", null, undefined, 42, ["Chill"], { value: "Chill" }]) {
    assert.deepEqual(
      parseClassificationSelection({ ...VALID, mood: bad }),
      { ok: false, reason: "missing" },
      `mood: ${String(bad)}`,
    );
  }
});

test("a value that is not in the approved vocabulary is rejected", () => {
  assert.deepEqual(parseClassificationSelection({ ...VALID, mood: "Triste" }), {
    ok: false,
    reason: "unknown_value",
  });
  assert.deepEqual(parseClassificationSelection({ ...VALID, mood: "chill" }), {
    ok: false,
    reason: "unknown_value",
  });
});

test("a value from another dimension is rejected for this dimension", () => {
  // "Alta" is an Energia value; posting it as Mood must not pass.
  assert.deepEqual(parseClassificationSelection({ ...VALID, mood: "Alta" }), {
    ok: false,
    reason: "unknown_value",
  });
  assert.deepEqual(parseClassificationSelection({ ...VALID, atmosfera: "Esplosiva" }), {
    ok: false,
    reason: "unknown_value",
  });
});

test("extra form fields are ignored, every value stays approved", () => {
  const check = parseClassificationSelection({ ...VALID, genere: "Rock", user_id: "attacker" });
  assert.ok(check.ok);
  assert.deepEqual(Object.keys(check.values).sort(), ["atmosfera", "energia", "mood"]);
});

test("the initial form state is idle and silent", () => {
  assert.deepEqual(INITIAL_CLASSIFY_STATE, { status: "idle", message: "" });
});

test("database tokens map to fixed categories", () => {
  assert.equal(mapRpcError("not_authenticated"), "not_authenticated");
  assert.equal(mapRpcError("invalid_mbid"), "invalid_input");
  assert.equal(mapRpcError("invalid_title"), "invalid_input");
  assert.equal(mapRpcError("invalid_value"), "invalid_input");
  assert.equal(mapRpcError("song_rejected"), "song_rejected");
  assert.equal(mapRpcError("already_classified"), "already_classified");
  assert.equal(mapRpcError("  invalid_value  "), "invalid_input");
  assert.equal(mapRpcError("invalid_value\nCONTEXT: ..."), "invalid_input");
});

test("the immutability token maps to its own category and message", () => {
  // A second submission of the same song is refused by the database; the
  // message must point the user at their personal list instead of retrying.
  assert.equal(mapRpcError("already_classified"), "already_classified");
  assert.equal(mapRpcError("already_classified\nCONTEXT: ..."), "already_classified");
  assert.equal(
    classificationMessage("already_classified"),
    "Hai già classificato questo brano. Puoi consultare la tua classificazione nella tua lista personale.",
  );
});

test("unknown or hostile error text never passes through", () => {
  for (const unknown of [
    undefined,
    null,
    42,
    {},
    "",
    "PGRST301",
    'duplicate key value violates unique constraint "classification_votes_user_song_dimension_key"',
    "permission denied for table classification_votes",
    "new row violates row-level security policy",
    "invalid input syntax for type uuid: 'attacker@example.com'",
  ]) {
    assert.equal(mapRpcError(unknown), "storage_unavailable", String(unknown));
  }
});

test("every error code has a fixed, non-empty Italian message", () => {
  const codes: ClassifyErrorCode[] = [
    "not_authenticated",
    "invalid_input",
    "song_not_found",
    "provider_unavailable",
    "song_rejected",
    "already_classified",
    "storage_unavailable",
  ];
  const messages = codes.map(classificationMessage);
  for (const message of messages) {
    assert.ok(message.length > 0);
    assert.match(message, /^[A-ZÀ-Ü]/);
    assert.ok(!/[<>{}]/.test(message), message);
  }
  assert.equal(new Set(messages).size, codes.length);
  // No database or provider detail may appear in a user-facing message.
  for (const message of messages) {
    assert.doesNotMatch(message, /PGRST|pg_|SQL|relation|constraint|MusicBrainz ha risposto in un formato/i, message);
  }
});
