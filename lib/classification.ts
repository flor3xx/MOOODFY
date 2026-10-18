/**
 * Classification input validation and error mapping.
 *
 * Pure on purpose: it is imported by the Server Action (server) and by the form
 * component (client), and it is unit-tested without a database or a session.
 * Nothing here trusts the browser — the Server Action re-validates everything,
 * and the database function re-validates it again.
 */

// Explicit .ts extension: `node --test` resolves ESM imports literally, so a
// tested module must name its sibling files in full (see lib/*.test.ts).
import { DIMENSIONS, type DimensionId } from "./dimensions.ts";

/** One approved value label per dimension, keyed by the dimension slug. */
export type ClassificationValues = Record<DimensionId, string>;

export type SelectionCheck =
  | { ok: true; values: ClassificationValues }
  | { ok: false; reason: "missing" | "unknown_value" };

/**
 * Reads the three selections out of raw form data and checks each one against
 * the approved local vocabulary (`DIMENSIONS`): exactly one known value per
 * dimension, and nothing else. Unknown dimensions in the input are ignored, and
 * a value that belongs to another dimension is rejected because the vocabulary
 * is looked up per dimension.
 */
export function parseClassificationSelection(input: Record<string, unknown>): SelectionCheck {
  const values = {} as ClassificationValues;
  for (const dimension of DIMENSIONS) {
    const raw = input[dimension.id];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value.length === 0) return { ok: false, reason: "missing" };
    if (!dimension.values.includes(value)) return { ok: false, reason: "unknown_value" };
    values[dimension.id] = value;
  }
  return { ok: true, values };
}

/** Fixed, user-facing failure categories. Nothing else is ever rendered. */
export type ClassifyErrorCode =
  | "not_authenticated"
  | "invalid_input"
  | "song_not_found"
  | "provider_unavailable"
  | "song_rejected"
  | "storage_unavailable";

export type ClassifyFormState = { status: "idle" | "error"; message: string };

export const INITIAL_CLASSIFY_STATE: ClassifyFormState = { status: "idle", message: "" };

/** Query parameters of the detail page's success indicator. */
export const CLASSIFY_SAVED_PARAM = "classificazione";
export const CLASSIFY_SAVED_VALUE = "salvata";

/** Stable tokens raised by `public.classify_song` (SQLSTATE P0001). */
const RPC_TOKENS: Record<string, ClassifyErrorCode> = {
  not_authenticated: "not_authenticated",
  invalid_mbid: "invalid_input",
  invalid_title: "invalid_input",
  invalid_value: "invalid_input",
  song_rejected: "song_rejected",
};

/**
 * Maps a database/RPC failure to a fixed category. Raw messages are never
 * returned or logged: anything unrecognised becomes `storage_unavailable`, so a
 * PostgREST/Postgres detail (or a client-supplied string) can never reach the UI.
 */
export function mapRpcError(message: unknown): ClassifyErrorCode {
  if (typeof message !== "string") return "storage_unavailable";
  const text = message.trim();
  const firstLine = text.split("\n")[0].trim().toLowerCase();
  if (RPC_TOKENS[firstLine]) return RPC_TOKENS[firstLine];
  for (const [token, code] of Object.entries(RPC_TOKENS)) {
    if (text.includes(token)) return code;
  }
  return "storage_unavailable";
}

export function classificationMessage(code: ClassifyErrorCode): string {
  switch (code) {
    case "not_authenticated":
      return "La sessione non è più valida. Accedi di nuovo e riprova.";
    case "invalid_input":
      return "I dati inviati non sono validi. Ricarica la scheda e riprova.";
    case "song_not_found":
      return "Non è stato possibile recuperare il brano da MusicBrainz. Riprova tra qualche istante.";
    case "song_rejected":
      return "Questo brano è stato escluso dalla catalogazione e non può essere classificato.";
    case "provider_unavailable":
      return "MusicBrainz non è raggiungibile in questo momento. Riprova tra qualche istante.";
    case "storage_unavailable":
      return "Non è stato possibile salvare la classificazione. Riprova tra qualche istante.";
  }
}
