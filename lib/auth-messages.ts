import { MIN_PASSWORD_LENGTH, type AuthField } from "./auth-validation";

/**
 * Client-facing auth state. Lives outside the "use server" module because a
 * Server Functions module may only export async functions.
 */
export type AuthFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  field?: AuthField;
};

export const INITIAL_AUTH_STATE: AuthFormState = { status: "idle" };

export const NOT_CONFIGURED_MESSAGE =
  "Supabase non è configurato su questo ambiente: l'accesso non è disponibile. Vedi il README.";

export const SIGN_UP_PENDING_MESSAGE =
  "Ti abbiamo inviato un'email di conferma. Con il flusso email predefinito, apri il link entro pochi minuti nello stesso browser e dispositivo usati per registrarti. Se l'indirizzo è già registrato, prova invece ad accedere.";

/**
 * Maps provider error codes to safe, fixed messages. The raw provider message
 * is never forwarded to the client.
 */
const MESSAGES: Record<string, string> = {
  invalid_credentials: "Email o password non corretti.",
  email_not_confirmed: "Devi prima confermare l'indirizzo email: controlla la posta.",
  weak_password: `Password troppo debole: usa almeno ${MIN_PASSWORD_LENGTH} caratteri.`,
  same_password: "La nuova password deve essere diversa dalla precedente.",
  email_exists: "Esiste già un account con questa email: prova ad accedere.",
  user_already_exists: "Esiste già un account con questa email: prova ad accedere.",
  email_address_invalid: "Inserisci un indirizzo email valido.",
  signup_disabled: "La registrazione è disattivata su questo progetto.",
  email_provider_disabled: "L'accesso con email e password è disattivato su questo progetto.",
  over_request_rate_limit: "Troppi tentativi in poco tempo: riprova tra qualche minuto.",
  over_email_send_rate_limit: "Abbiamo inviato troppe email: riprova tra qualche minuto.",
  validation_failed: "Controlla i dati inseriti e riprova.",
};

const FALLBACK = "Operazione non riuscita. Riprova tra qualche istante.";

export function authErrorMessage(code?: string): string {
  return (code && MESSAGES[code]) || FALLBACK;
}
