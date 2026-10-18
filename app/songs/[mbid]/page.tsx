import Link from "next/link";
import { notFound } from "next/navigation";
import { ClassifyForm } from "@/components/classify-form";
import {
  CLASSIFY_SAVED_PARAM,
  CLASSIFY_SAVED_VALUE,
} from "@/lib/classification";
import { loadDimensions } from "@/lib/dimensions-server";
import {
  lookupRecording,
  streamingLinks,
  type LookupErrorCode,
  type ProviderName,
} from "@/lib/musicbrainz";
import { getServerClaims } from "@/lib/supabase/server";
import { classifySongAction } from "./actions";

/** UI labels for the two providers; the URL never comes from these strings. */
const PROVIDER_LABELS: Record<ProviderName, string> = {
  spotify: "Spotify",
  apple_music: "Apple Music",
};

type SongPageProps = {
  params: Promise<{ mbid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Internal song detail for one MusicBrainz recording. The metadata is read-only
 * from the provider; the classification form is the one write path, and it is
 * only shown to signed-in users. Community percentages and streaming links are
 * still explicitly marked as not implemented.
 */
export default async function SongPage({ params, searchParams }: SongPageProps) {
  const { mbid } = await params;
  const outcome = await lookupRecording({ mbid });

  if (!outcome.ok) {
    // An unusable or unknown identifier is a missing page, not an error page.
    if (outcome.code === "invalid_id" || outcome.code === "not_found") notFound();

    return (
      <main id="main" className="wrap">
        <p className="crumb">
          <Link href="/">← Torna alla ricerca</Link>
        </p>
        <h1>Scheda non disponibile</h1>
        <p className="alert" role="alert">
          {lookupMessage(outcome.code)}
        </p>
      </main>
    );
  }

  const recording = outcome.recording;
  const links = streamingLinks(recording);

  // Verified claims, never the cookie alone; only the signed-in view gets a form.
  const claims = await getServerClaims();
  const signedIn = typeof claims?.sub === "string" && claims.sub.length > 0;
  const taxonomy = signedIn ? await loadDimensions() : null;
  const saved =
    firstString((await searchParams)[CLASSIFY_SAVED_PARAM]) === CLASSIFY_SAVED_VALUE;

  return (
    <main id="main" className="wrap">
      <p className="crumb">
        <Link href="/">← Torna alla ricerca</Link>
      </p>

      <section>
        <h1>{recording.title}</h1>

        <dl className="detail__meta">
          <div className="detail__pair">
            <dt>Artista</dt>
            <dd>{recording.artists.length > 0 ? recording.artists.join(", ") : "Non indicato"}</dd>
          </div>
          <div className="detail__pair">
            <dt>Album</dt>
            <dd>{recording.releaseTitle ?? "Non indicato"}</dd>
          </div>
          <div className="detail__pair">
            <dt>Prima pubblicazione</dt>
            <dd>{recording.firstReleaseDate ?? "Non indicata"}</dd>
          </div>
          <div className="detail__pair">
            <dt>MBID</dt>
            <dd className="mono">{recording.mbid}</dd>
          </div>
        </dl>

        <p className="crumb">
          <a href={recording.url} target="_blank" rel="noopener noreferrer">
            Scheda su MusicBrainz (nuova scheda)
          </a>
        </p>
        <p className="help">
          Titolo, artista e data arrivano dal servizio pubblico MusicBrainz. Il brano entra nel
          catalogo interno quando lo classifichi.
        </p>
      </section>

      <section className="block" aria-labelledby="ascolta-title">
        <h2 id="ascolta-title">Ascolta</h2>
        <p className="block__intro">
          Link diretti quando MusicBrainz li espone; altrimenti si apre la ricerca del servizio, con
          titolo e artista del brano.
        </p>
        <ul className="results__list">
          {links.map((link) => (
            <li key={link.provider} className="result">
              <p>
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.direct
                    ? `Ascolta su ${PROVIDER_LABELS[link.provider]}`
                    : `Cerca su ${PROVIDER_LABELS[link.provider]}`}{" "}
                  (nuova scheda)
                </a>
              </p>
              {link.direct ? null : (
                <p className="help">
                  Nessun link diretto su MusicBrainz: si apre la ricerca di{" "}
                  {PROVIDER_LABELS[link.provider]}.
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="block" aria-labelledby="classificazione-title">
        <h2 id="classificazione-title">Classificazione</h2>

        {saved ? (
          <p className="notice" role="status">
            Classificazione salvata. Il brano è nel catalogo come “community_pending”: lo vedi tu e
            chi lo ha classificato.
          </p>
        ) : null}

        <p className="block__intro">
          Un valore per dimensione: come ti fa sentire il brano (Mood), quanto spinge (Energia) e in
          che ambiente vive (Atmosfera). L’invio è unico e definitivo: non si può modificare, ma
          puoi consultare la tua classificazione nella tua lista personale.
        </p>

        {signedIn && taxonomy ? (
          <ClassifyForm
            action={classifySongAction}
            mbid={recording.mbid}
            dimensions={taxonomy.dimensions}
          />
        ) : (
          <>
            <p>
              Per classificare questo brano serve un account: il voto è legato alla tua utenza e
              non può essere modificato dopo l’invio.
            </p>
            <p className="detail__actions">
              <Link className="btn btn--primary" href="/auth/login">
                Accedi per classificare
              </Link>
            </p>
          </>
        )}

        <ul className="checklist">
          <li>
            <span className="chip chip--status">Prossimo slice</span> Percentuali della community:
            il brano non è ancora validato.
          </li>
        </ul>
      </section>
    </main>
  );
}

function firstString(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

/** Fixed, leak-free explanation for each lookup failure. */
function lookupMessage(code: LookupErrorCode): string {
  switch (code) {
    case "not_configured":
      return "Dettaglio non configurato su questo ambiente: sul server manca MUSICBRAINZ_USER_AGENT. Vedi il README.";
    case "timeout":
      return "MusicBrainz non ha risposto in tempo. Riprova tra qualche istante.";
    case "malformed_response":
      return "MusicBrainz ha risposto in un formato inatteso. Riprova più tardi.";
    case "provider_error":
      return "MusicBrainz non è raggiungibile in questo momento. Riprova tra qualche istante.";
    default:
      return "Questo brano non è disponibile.";
  }
}
