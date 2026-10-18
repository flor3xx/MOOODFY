"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  INITIAL_AUTH_STATE,
  NOT_CONFIGURED_MESSAGE,
  type AuthFormState,
} from "@/lib/auth-messages";
import {
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth-validation";

export type AuthAction = (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;

/**
 * The forms work without JavaScript (React posts the Server Function directly)
 * and re-validate server-side; the native constraints below only avoid
 * obviously invalid round trips.
 */

export function LoginForm({ action, configured }: { action: AuthAction; configured: boolean }) {
  const [state, formAction] = useActionState(action, INITIAL_AUTH_STATE);

  return (
    <form className="auth-form" action={formAction}>
      <Messages state={state} configured={configured} />
      <EmailField invalid={state.field === "email"} />
      <PasswordField
        id="password"
        label="Password"
        autoComplete="current-password"
        hint="Almeno 8 caratteri."
        invalid={state.field === "password"}
      />
      <SubmitButton label="Accedi" />
    </form>
  );
}

export function SignUpForm({ action, configured }: { action: AuthAction; configured: boolean }) {
  const [state, formAction] = useActionState(action, INITIAL_AUTH_STATE);

  return (
    <form className="auth-form" action={formAction}>
      <Messages state={state} configured={configured} />
      <EmailField invalid={state.field === "email"} />
      <PasswordField
        id="password"
        label="Password"
        autoComplete="new-password"
        hint={`Almeno ${MIN_PASSWORD_LENGTH} caratteri.`}
        invalid={state.field === "password"}
      />
      <PasswordField
        id="confirmation"
        label="Ripeti la password"
        autoComplete="new-password"
        hint="Le due password devono coincidere."
        invalid={state.field === "confirmation"}
      />
      <SubmitButton label="Crea account" />
    </form>
  );
}

function Messages({ state, configured }: { state: AuthFormState; configured: boolean }) {
  if (!configured) {
    return (
      <p className="alert" role="alert">
        {NOT_CONFIGURED_MESSAGE}
      </p>
    );
  }
  if (state.status === "error" && state.message) {
    return (
      <p className="alert" role="alert">
        {state.message}
      </p>
    );
  }
  if (state.status === "success" && state.message) {
    return (
      <p className="notice" role="status">
        {state.message}
      </p>
    );
  }
  return null;
}

function EmailField({ invalid }: { invalid: boolean }) {
  return (
    <div className="field">
      <label className="label" htmlFor="email">
        Email
      </label>
      <input
        className="input"
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={MAX_EMAIL_LENGTH}
        aria-invalid={invalid || undefined}
        aria-describedby="email-help"
      />
      <p className="help" id="email-help">
        Per esempio nome@dominio.it.
      </p>
    </div>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  hint,
  invalid,
}: {
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  hint: string;
  invalid: boolean;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        className="input"
        id={id}
        name={id}
        type="password"
        autoComplete={autoComplete}
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-help`}
      />
      <p className="help" id={`${id}-help`}>
        {hint}
      </p>
    </div>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn--primary" type="submit" disabled={pending}>
      {pending ? "Attendi…" : label}
    </button>
  );
}
