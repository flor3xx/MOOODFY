import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/app/auth/actions";
import { LoginForm } from "@/components/auth-form";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Accedi — MOOODFY",
  description: "Accedi a MOOODFY con email e password.",
};

// Session-aware pages must never be cached.
export const dynamic = "force-dynamic";

/** Only fixed, known codes are read from the URL: nothing is echoed back. */
const CALLBACK_MESSAGES: Record<string, string> = {
  link: "Il link di conferma non è valido o è scaduto. Prova ad accedere di nuovo.",
  config: "Supabase non è configurato su questo ambiente: la conferma non è disponibile. Vedi il README.",
};

type LoginProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginProps) {
  const code = firstString((await searchParams).errore);
  const notice = code ? CALLBACK_MESSAGES[code] : undefined;

  return (
    <main id="main" className="wrap">
      <h1>Accedi</h1>
      <p className="lede">
        MOOODFY è un prototipo: l&apos;account serve solo per identificarti nelle prossime funzioni
        di voto. Ricerca e consultazione restano pubbliche.
      </p>

      <section className="block" aria-labelledby="accedi-title">
        <h2 id="accedi-title">Email e password</h2>
        {notice ? (
          <p className="alert" role="alert">
            {notice}
          </p>
        ) : null}
        <LoginForm action={loginAction} configured={isSupabaseConfigured()} />
        <p className="auth-alt">
          Non hai un account? <Link href="/auth/sign-up">Registrati</Link>.
        </p>
      </section>
    </main>
  );
}

function firstString(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}
