import type { Metadata } from "next";
import Link from "next/link";
import { Archivo_Black, Space_Mono, Work_Sans } from "next/font/google";
import { AnalyticsConsent, ConsentPreferencesButton } from "@/components/analytics-consent";
import { getServerClaims } from "@/lib/supabase/server";
import "./globals.css";

const archivoBlack = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-archivo-black",
});

const workSans = Work_Sans({
  subsets: ["latin"],
  variable: "--font-work-sans",
});

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "MOOODFY — musica per mood, energia e atmosfera",
  description:
    "Prototipo di scoperta musicale per Mood, Energia e Atmosfera. Ricerca e voto non sono ancora attivi.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Verified claims, never getSession(): the cookies alone are forgeable.
  const claims = await getServerClaims();
  const email = typeof claims?.email === "string" ? claims.email : null;

  return (
    <html
      lang="it"
      className={`${archivoBlack.variable} ${workSans.variable} ${spaceMono.variable}`}
    >
      <body>
        <a className="skip-link" href="#main">
          Salta al contenuto
        </a>

        <header className="site-header">
          <div className="wrap">
            <Link className="brand" href="/">
              MOOODFY
            </Link>
            <nav className="site-nav" aria-label="Navigazione principale">
              <ul>
                <li>
                  <a href="#ricerca">Ricerca</a>
                </li>
                <li>
                  <a href="#dimensioni">Dimensioni</a>
                </li>
                <li>
                  <a href="#stato">Stato</a>
                </li>
                {email ? (
                  <>
                    <li className="site-nav__user">
                      <span className="mono">{email}</span>
                    </li>
                    <li>
                      <Link href="/account/classifications">Le mie classificazioni</Link>
                    </li>
                    <li>
                      <form action="/auth/sign-out" method="post">
                        <button className="link-button" type="submit">
                          Esci
                        </button>
                      </form>
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      <Link href="/auth/login">Accedi</Link>
                    </li>
                    <li>
                      <Link href="/auth/sign-up">Registrati</Link>
                    </li>
                  </>
                )}
              </ul>
            </nav>
          </div>
        </header>

        {children}

        <footer className="site-footer">
          <div className="wrap">
            <p className="mono">
              MOOODFY — prototipo non commerciale. Nessuna raccolta di dati senza consenso.
            </p>
            <nav aria-label="Informazioni sul prototipo">
              <ul>
                <li>
                  <a href="#stato">Stato del prototipo</a>
                </li>
                <li>
                  <ConsentPreferencesButton />
                </li>
              </ul>
            </nav>
          </div>
        </footer>

        <AnalyticsConsent enabled={process.env.VERCEL === "1"} />
      </body>
    </html>
  );
}
