/**
 * Analytics consent state.
 *
 * Default is unknown, and unknown is denied: only the exact stored value
 * "granted" lets analytics load. A read failure (storage blocked, private
 * browsing, corrupted value) therefore fails closed.
 */

export type ConsentChoice = "granted" | "denied";

export const ANALYTICS_CONSENT_KEY = "mooodfy.analytics-consent";

/** Dispatched after a write so listeners re-read the stored choice. */
export const ANALYTICS_CONSENT_CHANGE_EVENT = "mooodfy:analytics-consent-change";

/** Dispatched by the footer control to reopen the consent panel. */
export const ANALYTICS_CONSENT_OPEN_EVENT = "mooodfy:analytics-consent-open";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function parseConsent(raw: string | null): ConsentChoice | null {
  return raw === "granted" || raw === "denied" ? raw : null;
}

export function readConsent(storage: StorageLike): ConsentChoice | null {
  try {
    return parseConsent(storage.getItem(ANALYTICS_CONSENT_KEY));
  } catch {
    return null;
  }
}

export function writeConsent(storage: StorageLike, choice: ConsentChoice): void {
  try {
    storage.setItem(ANALYTICS_CONSENT_KEY, choice);
  } catch {
    // Storage unavailable: stay denied for this session, never throw.
  }
}
