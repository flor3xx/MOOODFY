import Form from "next/form";
import Link from "next/link";
import {
  loadDimensions,
  type DimensionFallbackReason,
} from "@/lib/dimensions-server";
import {
  MAX_QUERY_LENGTH,
  normalizeQuery,
  searchRecordings,
  type SearchErrorCode,
} from "@/lib/musicbrainz";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const rawQuery = firstString((await searchParams).q);
  const check = normalizeQuery(rawQuery);
  // Validation happens here, server-side, before any provider call.
  const outcome = check.ok ? await searchRecordings({ q: check.query }) : null;
  // Public read of the approved vocabulary; falls back to the local list.
  const taxonomy = await loadDimensions();
  const dimensionCount = taxonomy.dimensions.length;
  const valueCount = taxonomy.dimensions.reduce((total, d) => total + d.values.length, 0);

  return (
    <main id="main" className="wrap">
      <h1>Scopri musica per mood, energia e atmosfera.</h1>
      <p className="lede">
        MOOODFY organizza un catalogo musicale lungo tre dimensioni: come ti fa sentire un brano
        (Mood), quanto spinge (Energia) e in che ambiente vive (Atmosfera).
      </p>

      <section id="ricerca" className="block" aria-labelledby="ricerca-title">
        <h2 id="ricerca-title">Ricerca</h2>
        <p className="block__intro">
          Cerca per titolo, artista o album. I risultati arrivano da MusicBrainz; il titolo di ogni
          risultato apre la scheda originale.
        </p>

        <Form className="search" role="search" action="/" aria-labelledby="ricerca-title">
          <label className="label" htmlFor="q">
            Titolo, artista o album
          </label>
          <p className="help" id="q-help">
            Massimo {MAX_QUERY_LENGTH} caratteri. Prototipo: circa una richiesta al secondo al
            provider, nessun caching.
          </p>
          <div className="search__row">
            <div className="search__field">
              <input
                className="input"
                id="q"
                name="q"
                type="search"
                autoComplete="off"
                maxLength={MAX_QUERY_LENGTH}
                defaultValue={rawQuery.slice(0, MAX_QUERY_LENGTH)}
                aria-describedby="q-help"
                placeholder="Titolo, artista o album"
              />
            </div>
            <button className="btn btn--primary" type="submit">
              Cerca
            </button>
          </div>
        </Form>

        {rawQuery.length === 0 ? null : (
          <div className="results">
            {check.ok ? null : (
              <p className="alert" role="alert">
                {check.reason === "too_long"
                  ? `La ricerca può avere al massimo ${MAX_QUERY_LENGTH} caratteri.`
                  : "Inserisci un testo da cercare (almeno un carattere)."}
              </p>
            )}

            {outcome === null ? null : !outcome.ok ? (
              <p className="alert" role="alert">
                {errorMessage(outcome.code)}
              </p>
            ) : outcome.results.length === 0 ? (
              <p className="results__status mono" role="status">
                Nessun risultato per “{check.ok ? check.query : rawQuery}”. Prova con un altro
                titolo, artista o album.
              </p>
            ) : (
              <>
                <p className="results__status mono" role="status">
                  {outcome.results.length} risultati per “{check.ok ? check.query : rawQuery}”.
                </p>
                <ul className="results__list">
                  {outcome.results.map((recording) => (
                    <li key={recording.mbid} className="result">
                      <h3 className="result__title">
                        <Link href={`/songs/${encodeURIComponent(recording.mbid)}`}>
                          {recording.title}
                        </Link>
                      </h3>
                      <p className="result__meta">
                        {recording.artists.length > 0
                          ? recording.artists.join(", ")
                          : "Artista non indicato"}
                      </p>
                      <p className="result__extra help">
                        {releaseLine(recording.releaseTitle, recording.firstReleaseDate)}
                      </p>
                      <p className="result__extra help">
                        <a href={recording.url} target="_blank" rel="noopener noreferrer">
                          Scheda su MusicBrainz (nuova scheda)
                        </a>
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      <section id="dimensioni" className="block" aria-labelledby="dimensioni-title">
        <h2 id="dimensioni-title">Dimensioni</h2>
        <p className="block__intro">
          Vocabolario approvato per la catalogazione (
          {taxonomy.source === "remote"
            ? "letto da Supabase in sola lettura"
            : "letto dal vocabolario locale, fallback"}{" "}
          — {dimensionCount} dimensioni, {valueCount} valori). I controlli di filtro e voto non sono
          ancora attivi: qui sotto vedi solo i valori previsti.
        </p>

        <div className="dimensions">
          {taxonomy.dimensions.map((dimension) => (
            <section
              key={dimension.id}
              className="dimension"
              aria-labelledby={`${dimension.id}-title`}
            >
              <div className="dimension__head">
                <h3 id={`${dimension.id}-title`}>{dimension.label}</h3>
                <span className="chip chip--status">Filtri non attivi</span>
              </div>
              <p className="help">
                {dimension.values.length} valori approvati, attualmente solo elencati.
              </p>
              <ul>
                {dimension.values.map((value) => (
                  <li key={value} className="chip">
                    {value}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <section id="stato" className="block" aria-labelledby="stato-title">
        <h2 id="stato-title">Stato del prototipo</h2>
        <ul className="checklist">
          <li>
            <span className="chip chip--success">Disponibile</span> Ricerca testuale su
            MusicBrainz (prototipo, endpoint pubblico).
          </li>
          <li>
            <span className="chip chip--status">Non disponibile</span> Filtri e voto su Mood,
            Energia e Atmosfera.
          </li>
          <li>
            <span className="chip chip--success">Disponibile</span> Account con email e password
            (Supabase Auth). Nessuna autorizzazione: nessun dato è protetto in questo slice.
          </li>
          <li>
            <span className="chip chip--status">Non disponibile</span> Ruoli e area amministrativa.
          </li>
          <li>
            <span
              className={taxonomy.source === "remote" ? "chip chip--success" : "chip chip--status"}
            >
              {taxonomy.source === "remote" ? "Da Supabase" : "Fallback locale"}
            </span>{" "}
            Tassonomia Mood/Energia/Atmosfera:{" "}
            {taxonomy.source === "remote"
              ? `letta dalle tabelle public.dimensions e public.dimension_values in sola lettura (chiave pubblica, RLS).`
              : `${fallbackReason(taxonomy.reason)}; la homepage mostra il vocabolario locale.`}{" "}
            Catalogo e voti non sono ancora letti né scritti.
          </li>
          <li>
            <span className="chip chip--success">Attivo</span> Statistiche di visita solo dopo
            consenso esplicito.
          </li>
        </ul>
      </section>
    </main>
  );
}

function releaseLine(releaseTitle: string | null, firstReleaseDate: string | null): string {
  const parts = [releaseTitle, firstReleaseDate].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" — ") : "Album e data non indicati";
}

function errorMessage(code: SearchErrorCode): string {
  if (code === "not_configured") {
    return "Ricerca non configurata su questo ambiente: sul server manca MUSICBRAINZ_USER_AGENT. Vedi il README.";
  }
  if (code === "timeout") {
    return "MusicBrainz non ha risposto in tempo. Riprova tra qualche istante.";
  }
  if (code === "invalid_query") {
    return `La ricerca può avere al massimo ${MAX_QUERY_LENGTH} caratteri.`;
  }
  return "MusicBrainz non è raggiungibile in questo momento. Riprova tra qualche istante.";
}

function firstString(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

/** Fixed, leak-free explanation for each fallback reason. */
function fallbackReason(reason: DimensionFallbackReason): string {
  switch (reason) {
    case "unconfigured":
      return "variabili pubbliche Supabase assenti";
    case "unavailable":
      return "client Supabase non disponibile su questa richiesta";
    case "query_failed":
      return "Supabase non ha risposto o ha rifiutato la lettura";
    case "unusable":
      return "i dati ricevuti non contengono una tassonomia utilizzabile";
  }
}
