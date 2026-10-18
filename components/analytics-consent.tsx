"use client";

import { Analytics } from "@vercel/analytics/next";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ANALYTICS_CONSENT_CHANGE_EVENT,
  ANALYTICS_CONSENT_OPEN_EVENT,
  readConsent,
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
 */
function subscribeToConsent(onStoreChange: () => void) {
  window.addEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(ANALYTICS_CONSENT_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

const clientConsent = () => readConsent(window.localStorage);
const serverConsent = () => null;

export function AnalyticsConsent() {
  const choice = useSyncExternalStore(subscribeToConsent, clientConsent, serverConsent);
  const [reopened, setReopened] = useState(false);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const reopen = () => setReopened(true);
    window.addEventListener(ANALYTICS_CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(ANALYTICS_CONSENT_OPEN_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (reopened) panel.current?.focus();
  }, [reopened]);

  function decide(next: ConsentChoice) {
    writeConsent(window.localStorage, next);
    setReopened(false);
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_CHANGE_EVENT));
  }

  const visible = choice === null || reopened;

  return (
    <>
      {choice === "granted" ? <Analytics mode="production" /> : null}

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
