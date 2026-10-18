import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_CONSENT_KEY,
  parseConsent,
  readConsent,
  writeConsent,
} from "./consent.ts";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(ANALYTICS_CONSENT_KEY, initial);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

test("no stored choice means unknown, which is not consent", () => {
  assert.equal(readConsent(memoryStorage()), null);
  assert.equal(parseConsent(null), null);
});

test("only the literal granted value counts as consent", () => {
  assert.equal(parseConsent("granted"), "granted");
  assert.equal(parseConsent("denied"), "denied");
  assert.equal(parseConsent("GRANTED"), null);
  assert.equal(parseConsent("true"), null);
  assert.equal(
    readConsent(memoryStorage("granted")),
    "granted",
    "storage value granted must be read back",
  );
});

test("a corrupt stored value fails closed", () => {
  assert.equal(readConsent(memoryStorage("{oops")), null);
});

test("storage that throws fails closed instead of crashing the page", () => {
  const hostile = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readConsent(hostile), null);
  assert.doesNotThrow(() => writeConsent(hostile, "granted"));
});

test("a choice survives a write/read round trip", () => {
  const storage = memoryStorage();
  writeConsent(storage, "denied");
  assert.equal(readConsent(storage), "denied");
  writeConsent(storage, "granted");
  assert.equal(readConsent(storage), "granted");
});
