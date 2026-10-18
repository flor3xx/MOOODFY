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

/**
 * `null` means "no usable storage" — either the platform refused access
 * (accessing `window.localStorage` itself throws in some privacy modes, before
 * any `getItem`/`setItem` call) or the caller could not obtain it. Both reads
 * and writes then fail closed instead of throwing.
 */
export function readConsent(storage: StorageLike | null): ConsentChoice | null {
  if (!storage) return null;
  try {
    return parseConsent(storage.getItem(ANALYTICS_CONSENT_KEY));
  } catch {
    return null;
  }
}

export function writeConsent(storage: StorageLike | null, choice: ConsentChoice): void {
  if (!storage) return;
  try {
    storage.setItem(ANALYTICS_CONSENT_KEY, choice);
  } catch {
    // Storage unavailable: stay denied for this session, never throw.
  }
}

/**
 * The choice the UI must act on.
 *
 * A decision taken in this page session wins over the stored value: that is what
 * closes the banner immediately on click, and it keeps a session-only decision
 * working when storage refused the write (private browsing, blocked storage).
 * The component hands authority back to the store as soon as the store agrees,
 * so cross-tab changes keep driving the UI afterwards.
 */
export function effectiveConsent(
  stored: ConsentChoice | null,
  decided: ConsentChoice | null,
): ConsentChoice | null {
  return decided ?? stored;
}

/** Unknown consent shows the banner, and so does an explicitly reopened panel. */
export function isConsentBannerVisible(choice: ConsentChoice | null, reopened: boolean): boolean {
  return choice === null || reopened;
}

/** Analytics may load only after an explicit grant. */
export function shouldLoadAnalytics(choice: ConsentChoice | null): boolean {
  return choice === "granted";
}
