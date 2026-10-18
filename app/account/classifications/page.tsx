import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadMyClassifications, type MyClassificationsReason } from "@/lib/account-classifications-server";
import { getServerClaims } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Le mie classificazioni — MOOODFY",
  description: "I brani che hai classificato su MOOODFY.",
};

// Session-aware page: never cached, and the read is owner-scoped by RLS.
export const dynamic = "force-dynamic";

/**
 * The signed-in user's own classifications. Access requires verified claims (a
 * user id); otherwise the visitor is sent to the login page. The query runs on
 * the request client, so RLS returns only this user's rows — no user id, email
 * or other user's vote can appear here.
 */
export default async function AccountClassificationsPage() {
  const claims = await getServerClaims();
  const userId = typeof claims?.sub === "string" ? claims.sub : "";
  if (userId.length === 0) redirect("/auth/login");

  const load = await loadMyClassifications();

  return (
    <main id="main" className="wrap">
      <h1>Le mie classificazioni</h1>
      <p className="lede">
        I brani che hai classificato, con i valori scelti per Mood, Energia e Atmosfera. Solo tu
        puoi vedere queste righe.
      </p>

      <section className="block" aria-labelledby="elenco-title">
        <h2 id="elenco-title">Elenco</h2>

        {load.ok ? (
          load.rows.length === 0 ? (
            <p className="results__status mono" role="status">
              Non hai ancora classificato brani. Apri la ricerca e scegli un brano da classificare.
            </p>
          ) : (
            <>
              <p className="results__status mono" role="status">
                {load.rows.length === 1
                  ? "1 brano classificato."
                  : `${load.rows.length} brani classificati.`}
              </p>
              <ul className="results__list">
                {load.rows.map((row) => (
                  <li key={row.songId} className="result">
                    <h3 className="result__title">
                      {row.musicbrainzMbid ? (
                        <Link href={`/songs/${encodeURIComponent(row.musicbrainzMbid)}`}>
                          {row.title}
                        </Link>
                      ) : (
                        row.title
                      )}
                    </h3>
                    <p className="result__meta">
                      <span className="chip chip--status chip--token mono">{row.status}</span>
                    </p>
                    <dl className="detail__meta">
                      <div className="detail__pair">
                        <dt>Mood</dt>
                        <dd>{row.values.mood ?? "Non indicata"}</dd>
                      </div>
                      <div className="detail__pair">
                        <dt>Energia</dt>
                        <dd>{row.values.energia ?? "Non indicata"}</dd>
                      </div>
                      <div className="detail__pair">
                        <dt>Atmosfera</dt>
                        <dd>{row.values.atmosfera ?? "Non indicata"}</dd>
                      </div>
                    </dl>
                    {row.musicbrainzMbid ? null : (
                      <p className="help">
                        Nessuna fonte MusicBrainz associata: la scheda del brano non è
                        collegabile.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )
        ) : (
          <p className="alert" role="alert">
            {reasonMessage(load.reason)}
          </p>
        )}

        <p className="crumb">
          <Link href="/">← Torna alla ricerca</Link>
        </p>
      </section>
    </main>
  );
}

/** Fixed, leak-free explanation for each load failure. */
function reasonMessage(reason: MyClassificationsReason): string {
  switch (reason) {
    case "unconfigured":
      return "Archivio non configurato su questo ambiente: mancano le variabili pubbliche Supabase. Vedi il README.";
    case "unavailable":
      return "L'archivio non è disponibile su questa richiesta. Riprova tra qualche istante.";
    case "error":
      return "Non è stato possibile leggere le tue classificazioni. Riprova tra qualche istante.";
  }
}
