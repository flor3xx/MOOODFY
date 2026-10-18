"use server";

import { redirect } from "next/navigation";
import {
  NOT_CONFIGURED_MESSAGE,
  SIGN_UP_PENDING_MESSAGE,
  authErrorMessage,
  type AuthFormState,
} from "@/lib/auth-messages";
import { checkCredentials, messageFor } from "@/lib/auth-validation";
import { authCallbackUrl, readSiteUrl } from "@/lib/site-url";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Email/password Server Functions.
 *
 * Every input is re-validated here: the browser is not trusted, and the forms
 * only repeat the same rules for convenience. Passwords are never logged, and
 * provider errors are mapped to fixed safe messages.
 */

export async function loginAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const check = checkCredentials({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!check.ok) {
    const first = check.errors[0];
    return { status: "error", message: messageFor(first), field: first.field };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: NOT_CONFIGURED_MESSAGE };

  const { error } = await supabase.auth.signInWithPassword(check.value);
  if (error) return { status: "error", message: authErrorMessage(error.code) };

  redirect("/");
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const check = checkCredentials({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
    requireConfirmation: true,
  });
  if (!check.ok) {
    const first = check.errors[0];
    return { status: "error", message: messageFor(first), field: first.field };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { status: "error", message: NOT_CONFIGURED_MESSAGE };

  // Configuration only, never the request Host: a request-controlled origin
  // could point the confirmation link elsewhere. Without a valid site URL the
  // option is omitted and Supabase uses its own configured default redirect.
  const emailRedirectTo = authCallbackUrl(readSiteUrl());
  const { data, error } = await supabase.auth.signUp({
    email: check.value.email,
    password: check.value.password,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });
  if (error) return { status: "error", message: authErrorMessage(error.code) };

  // No session means the project requires email confirmation before sign-in.
  if (!data.session) return { status: "success", message: SIGN_UP_PENDING_MESSAGE };

  redirect("/");
}
