import Link from "next/link";

export default function ArtistNotFound() {
  return (
    <main id="main" className="wrap">
      <p className="crumb">
        <Link href="/">← Torna alla ricerca</Link>
      </p>
      <h1>Artista non trovato</h1>
      <p className="block__intro">
        L&apos;identificativo nella URL non è un MBID valido oppure MusicBrainz non conosce questo
        artista. Cerca di nuovo per nome.
      </p>
      <p className="detail__actions">
        <Link className="btn btn--secondary" href="/">
          Torna alla ricerca
        </Link>
      </p>
    </main>
  );
}
