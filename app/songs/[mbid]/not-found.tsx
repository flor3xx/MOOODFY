import Link from "next/link";

export default function SongNotFound() {
  return (
    <main id="main" className="wrap">
      <p className="crumb">
        <Link href="/">← Torna alla ricerca</Link>
      </p>
      <h1>Brano non trovato</h1>
      <p className="block__intro">
        L&apos;identificativo nella URL non è un MBID valido oppure MusicBrainz non conosce questo
        brano. Cerca di nuovo per titolo, artista o album.
      </p>
      <p className="detail__actions">
        <Link className="btn btn--secondary" href="/">
          Torna alla ricerca
        </Link>
      </p>
    </main>
  );
}
