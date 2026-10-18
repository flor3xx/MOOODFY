/**
 * Validation for the email/password forms.
 *
 * Public seam for the auth UI: the Server Functions and this module are the
 * single source of truth, so client-side attributes are a convenience only.
 * Nothing here talks to Supabase or logs anything.
 */

export const MIN_PASSWORD_LENGTH = 8;
/** Supabase hashes with bcrypt, which ignores anything past 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72;
/** RFC 5321 practical cap for an address. */
export const MAX_EMAIL_LENGTH = 254;

export type AuthField = "email" | "password" | "confirmation";

export type AuthFieldError = {
  field: AuthField;
  code: "required" | "invalid" | "too_long" | "too_short" | "mismatch";
};

export type Credentials = { email: string; password: string };

export type CredentialsCheck =
  | { ok: true; value: Credentials }
  | { ok: false; errors: AuthFieldError[] };

export type CredentialsInput = {
  email: unknown;
  password: unknown;
  confirmation?: unknown;
  /** Sign-up asks for the password twice; sign-in does not. */
  requireConfirmation?: boolean;
};

export function checkCredentials(input: CredentialsInput): CredentialsCheck {
  const errors: AuthFieldError[] = [];

  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (email.length === 0) {
    errors.push({ field: "email", code: "required" });
  } else if (email.length > MAX_EMAIL_LENGTH) {
    errors.push({ field: "email", code: "too_long" });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: "email", code: "invalid" });
  }

  // Passwords are never trimmed: leading and trailing spaces are part of them.
  const password = typeof input.password === "string" ? input.password : "";
  if (password.length === 0) {
    errors.push({ field: "password", code: "required" });
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push({ field: "password", code: "too_short" });
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push({ field: "password", code: "too_long" });
  }

  if (input.requireConfirmation) {
    const confirmation = typeof input.confirmation === "string" ? input.confirmation : "";
    if (confirmation.length === 0) {
      errors.push({ field: "confirmation", code: "required" });
    } else if (confirmation !== password) {
      errors.push({ field: "confirmation", code: "mismatch" });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { email, password } };
}

export function messageFor(error: AuthFieldError): string {
  switch (error.code) {
    case "required":
      return error.field === "confirmation"
        ? "Conferma la password."
        : "Compila questo campo.";
    case "too_long":
      return error.field === "email"
        ? `L'email può avere al massimo ${MAX_EMAIL_LENGTH} caratteri.`
        : `La password può avere al massimo ${MAX_PASSWORD_LENGTH} caratteri.`;
    case "too_short":
      return `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`;
    case "mismatch":
      return "Le due password non coincidono.";
    case "invalid":
      return "Inserisci un indirizzo email valido.";
  }
}
