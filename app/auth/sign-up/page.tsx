import type { Metadata } from "next";
import Link from "next/link";
import { signUpAction } from "@/app/auth/actions";
import { SignUpForm } from "@/components/auth-form";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Registrati — MOOODFY",
  description: "Crea un account MOOODFY con email e password.",
};

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <main id="main" className="wrap">
      <h1>Registrati</h1>
        <p className="lede">
          Prototipo non commerciale: crea un account solo con email e password. Nessun dato viene
          usato per profilazione e le statistiche di visita restano opt-in. La password viene gestita
          da Supabase Auth: MOOODFY non la salva in chiaro e non la invia agli analytics.
        </p>

      <section className="block" aria-labelledby="registrati-title">
        <h2 id="registrati-title">Nuovo account</h2>
        <SignUpForm action={signUpAction} configured={isSupabaseConfigured()} />
        <p className="auth-alt">
          Hai già un account? <Link href="/auth/login">Accedi</Link>.
        </p>
      </section>
    </main>
  );
}
