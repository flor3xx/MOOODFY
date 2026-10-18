import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_CONSENT_KEY,
  effectiveConsent,
  isConsentBannerVisible,
  parseConsent,
  readConsent,
  shouldLoadAnalytics,
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

/* --------------------------------------------------------------------------
 * Regression: the banner used to close only if the localStorage round-trip
 * came back through useSyncExternalStore, so "Accetta" did nothing visible
 * whenever storage refused the write. These assertions pin the seam the
 * component now uses: the in-page decision is applied immediately.
 * ------------------------------------------------------------------------ */

test("an explicit decision is applied even when storage refuses it", () => {
  const hostile = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };

  // What the component does on click: decide, then try to persist.
  const decided = "granted" as const;
  assert.doesNotThrow(() => writeConsent(hostile, decided));

  const stored = readConsent(hostile); // null: the write did not stick
  const choice = effectiveConsent(stored, decided);

  assert.equal(stored, null, "the failed write stays fail-closed in storage");
  assert.equal(choice, "granted", "the in-page decision still applies");
  assert.equal(isConsentBannerVisible(choice, false), false, "banner closes");
  assert.equal(shouldLoadAnalytics(choice), true, "grant loads analytics");
});

test("storage that cannot even be accessed fails closed", () => {
  // `window.localStorage` can throw on access (blocked/partitioned storage),
  // which is the case the component maps to a null store.
  assert.equal(readConsent(null), null);
  assert.doesNotThrow(() => writeConsent(null, "granted"));

  const choice = effectiveConsent(readConsent(null), "granted");
  assert.equal(isConsentBannerVisible(choice, false), false, "banner still closes");
  assert.equal(shouldLoadAnalytics(choice), true);
});

test("rejecting closes the banner and never loads analytics", () => {
  const choice = effectiveConsent(null, "denied");
  assert.equal(isConsentBannerVisible(choice, false), false);
  assert.equal(shouldLoadAnalytics(choice), false);
});

test("unknown consent shows the banner and does not load analytics", () => {
  const choice = effectiveConsent(null, null);
  assert.equal(isConsentBannerVisible(choice, false), true);
  assert.equal(shouldLoadAnalytics(choice), false);
});

test("the stored value is used when there is no in-page decision", () => {
  assert.equal(effectiveConsent("granted", null), "granted");
  assert.equal(effectiveConsent("denied", null), "denied");
  assert.equal(shouldLoadAnalytics(effectiveConsent("granted", null)), true);
});

test("an explicitly reopened panel is visible whatever the choice", () => {
  for (const choice of [null, "granted", "denied"] as const) {
    assert.equal(isConsentBannerVisible(choice, true), true, String(choice));
  }
});

test("a stored choice that matches the decision hands control back to the store", () => {
  // The component clears its local override once `stored === decided`, so a
  // later change from another tab is honoured again.
  const storedAfterCrossTabChange = "denied" as const;
  assert.equal(effectiveConsent(storedAfterCrossTabChange, null), "denied");
  assert.equal(shouldLoadAnalytics(effectiveConsent(storedAfterCrossTabChange, null)), false);
});
