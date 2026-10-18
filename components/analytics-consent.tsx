"use client";

import { Analytics } from "@vercel/analytics/next";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ANALYTICS_CONSENT_CHANGE_EVENT,
  ANALYTICS_CONSENT_OPEN_EVENT,
  effectiveConsent,
  isConsentBannerVisible,
  readConsent,
  shouldLoadAnalytics,
  writeConsent,
  type ConsentChoice,
} from "@/lib/consent";

/**
 * Consent panel plus the analytics loader.
 *
 * The stored choice is external state (localStorage), read through
 * useSyncExternalStore: the server snapshot is "no choice yet", so the
 * server-rendered HTML matches the first client render and analytics is never
 * part of the initial document. Unknown consent means denied.
 *
 * A click also records the decision in local state, so the panel closes on the
 * spot instead of waiting for the store round-trip — that round-trip never
 * happens when localStorage is unavailable, which used to leave the banner on
 * screen after "Accetta".
 */
function subscribeToConsent(onStoreChange: () => void) {
  window.addEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/**
 * Reading `window.localStorage` itself throws in some privacy modes (blocked or
 * partitioned storage), before any `getItem`/`setItem` runs. Returning null is
 * the fail-closed path: unknown consent, no analytics.
 */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const clientConsent = () => readConsent(safeStorage());
const serverConsent = () => null;

export function AnalyticsConsent({ enabled }: { enabled: boolean }) {
  const stored = useSyncExternalStore(subscribeToConsent, clientConsent, serverConsent);
  const [decided, setDecided] = useState<ConsentChoice | null>(null);
  const [reopened, setReopened] = useState(false);
  const panel = useRef<HTMLElement>(null);

  const choice = effectiveConsent(stored, decided);

  useEffect(() => {
    // Only another tab fires `storage`: it means the choice changed elsewhere, so
    // the local override is dropped and the store takes over again. (Our own
    // change dispatches a different event and keeps its override.)
    const onExternalChange = () => setDecided(null);
    window.addEventListener("storage", onExternalChange);
    return () => window.removeEventListener("storage", onExternalChange);
  }, []);

  useEffect(() => {
    const reopen = () => setReopened(true);
    window.addEventListener(ANALYTICS_CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(ANALYTICS_CONSENT_OPEN_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (reopened) panel.current?.focus();
  }, [reopened]);

  function decide(next: ConsentChoice) {
    // Immediate UI transition, independent of the store round-trip…
    setDecided(next);
    setReopened(false);
    // …then persist, best effort and fail-closed: a storage failure never throws
    // and simply means the next page load starts from "unknown" (denied) again.
    writeConsent(safeStorage(), next);
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_CHANGE_EVENT));
  }

  const visible = isConsentBannerVisible(choice, reopened);

  return (
    <>
      {enabled && shouldLoadAnalytics(choice) ? <Analytics mode="production" /> : null}

      {visible ? (
        <section
          ref={panel}
          tabIndex={-1}
          className="consent"
          aria-labelledby="analytics-consent-title"
        >
          <div className="wrap">
            <h2 id="analytics-consent-title" className="consent__title">
              Statistiche di visita
            </h2>
            <p className="consent__text">
              Facoltativo e spento finché non scegli. Se accetti, Vercel Analytics conta le
              visualizzazioni di pagina in forma aggregata. Nessun dato personale, nessuna query di
              ricerca, nessuna email o nickname. La scelta resta salvata solo in questo browser e
              puoi cambiarla dal link “Preferenze analytics” nel footer.
            </p>

            {choice !== null ? (
              <p className="consent__state">
                <span className={choice === "granted" ? "chip chip--success" : "chip"}>
                  {choice === "granted" ? "Statistiche attive" : "Statistiche disattivate"}
                </span>
              </p>
            ) : null}

            <div className="consent__actions">
              <button type="button" className="btn btn--primary" onClick={() => decide("granted")}>
                Accetta
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => decide("denied")}>
                Rifiuta
              </button>
              {choice !== null ? (
                <button type="button" className="link-button" onClick={() => setReopened(false)}>
                  Chiudi
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

/** Footer affordance to reopen the panel and change or withdraw consent. */
export function ConsentPreferencesButton() {
  return (
    <button
      type="button"
      className="link-button"
      onClick={() => window.dispatchEvent(new Event(ANALYTICS_CONSENT_OPEN_EVENT))}
    >
      Preferenze analytics
    </button>
  );
}
