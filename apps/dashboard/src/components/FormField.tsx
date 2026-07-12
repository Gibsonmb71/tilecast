import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};

export function FormField({ label, error, hint, id, ...input }: Props) {
  const messageId = `${id}-message`;
  return (
    <label className="field" htmlFor={id}>
      <span className="field__label">{label}</span>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? messageId : undefined}
        {...input}
      />
      {(error || hint) && (
        <span id={messageId} className={error ? "field__error" : "field__hint"}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
