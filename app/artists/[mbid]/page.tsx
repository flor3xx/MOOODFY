import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ARTIST_RECORDINGS_LIMIT,
  browseArtistRecordings,
  lookupArtist,
  type LookupErrorCode,
} from "@/lib/musicbrainz";

type ArtistPageProps = {
  params: Promise<{ mbid: string }>;
};

/**
 * Artist detail for one MusicBrainz artist: the artist metadata plus one
 * bounded first page of their recordings (no pagination in this slice). Every
 * recording links to the existing internal song detail. All provider calls are
 * server-side; nothing from the provider body is stored or forwarded.
 */
export default async function ArtistPage({ params }: ArtistPageProps) {
  const { mbid } = await params;
  const outcome = await lookupArtist({ mbid });

  if (!outcome.ok) {
    // An unusable or unknown identifier is a missing page, not an error page.
    if (outcome.code === "invalid_id" || outcome.code === "not_found") notFound();

    return (
      <main id="main" className="wrap">
        <p className="crumb">
          <Link href="/">← Torna alla ricerca</Link>
        </p>
        <h1>Artista non disponibile</h1>
        <p className="alert" role="alert">
          {providerMessage(outcome.code)}
        </p>
      </main>
    );
  }

  const artist = outcome.artist;
  const recordings = await browseArtistRecordings({
    mbid: artist.mbid,
    limit: ARTIST_RECORDINGS_LIMIT,
  });

  return (
    <main id="main" className="wrap">
      <p className="crumb">
        <Link href="/">← Torna alla ricerca</Link>
      </p>

      <section>
        <h1>{artist.name}</h1>

        <dl className="detail__meta">
          <div className="detail__pair">
            <dt>Tipo</dt>
            <dd>{artist.type ?? "Non indicato"}</dd>
          </div>
          <div className="detail__pair">
            <dt>Paese</dt>
            <dd>{artist.country ?? "Non indicato"}</dd>
          </div>
          <div className="detail__pair">
            <dt>Disambiguazione</dt>
            <dd>{artist.disambiguation ?? "Non indicata"}</dd>
          </div>
          <div className="detail__pair">
            <dt>MBID</dt>
            <dd className="mono">{artist.mbid}</dd>
          </div>
        </dl>

        <p className="crumb">
          <a href={artist.url} target="_blank" rel="noopener noreferrer">
            Scheda su MusicBrainz (nuova scheda)
          </a>
        </p>
      </section>

      <section className="block" aria-labelledby="registrazioni-title">
        <h2 id="registrazioni-title">Registrazioni</h2>
        <p className="block__intro">
          Prima pagina di brani di questo artista su MusicBrainz (massimo{" "}
          {ARTIST_RECORDINGS_LIMIT}). Il titolo apre la scheda del brano su MOOODFY.
        </p>

        {!recordings.ok ? (
          <p className="alert" role="alert">
            {providerMessage(recordings.code)}
          </p>
        ) : recordings.recordings.length === 0 ? (
          <p className="results__status mono" role="status">
            Nessuna registrazione trovata per questo artista.
          </p>
        ) : (
          <>
            <p className="results__status mono" role="status">
              {recordings.recordings.length} registrazioni in questa pagina.
            </p>
            <ul className="results__list">
              {recordings.recordings.map((recording) => (
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
                    {[recording.releaseTitle, recording.firstReleaseDate]
                      .filter((part): part is string => part !== null)
                      .join(" — ") || "Album e data non indicati"}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

/** Fixed, leak-free explanation for each provider failure. */
function providerMessage(code: LookupErrorCode): string {
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
      return "Questo artista non è disponibile.";
  }
}
