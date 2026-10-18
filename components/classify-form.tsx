"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { INITIAL_CLASSIFY_STATE, type ClassifyFormState } from "@/lib/classification";
import type { Dimension } from "@/lib/dimensions";

export type ClassifyAction = (
  state: ClassifyFormState,
  formData: FormData,
) => Promise<ClassifyFormState>;

/**
 * One group per dimension, native labels, native select. The action re-validates
 * every value server-side, so `required` and the option list are convenience
 * only. The form works without JavaScript: React posts the Server Function
 * directly.
 */
export function ClassifyForm({
  action,
  mbid,
  dimensions,
}: {
  action: ClassifyAction;
  mbid: string;
  dimensions: Dimension[];
}) {
  const [state, formAction] = useActionState(action, INITIAL_CLASSIFY_STATE);

  return (
    <form className="classify" action={formAction}>
      {state.status === "error" && state.message ? (
        <p className="alert" role="alert">
          {state.message}
        </p>
      ) : null}

      <input type="hidden" name="mbid" value={mbid} />

      {dimensions.map((dimension) => (
        <div className="field" key={dimension.id}>
          <label className="label" htmlFor={`dimension-${dimension.id}`}>
            {dimension.label}
          </label>
          <select
            className="input"
            id={`dimension-${dimension.id}`}
            name={dimension.id}
            defaultValue=""
            required
            aria-describedby="classify-help"
          >
            <option value="" disabled>
              Scegli un valore
            </option>
            {dimension.values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      ))}

      <p className="help" id="classify-help">
        Un valore per dimensione. Puoi cambiare la scelta quando vuoi: la classificazione precedente
        viene sostituita.
      </p>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn--primary" type="submit" disabled={pending}>
      {pending ? "Salvataggio…" : "Salva la classificazione"}
    </button>
  );
}
