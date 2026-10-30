import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { Icon } from "./Icon";

/** A text field with a small cross that empties it. */
export const ClearableInput = forwardRef<HTMLInputElement, { value: string; onValue: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">>(function ClearableInput({ value, onValue, ...rest }, ref) {
  return (
    <span className="clearable">
      <input ref={ref} {...noAutofill("clearable-field")} {...rest} value={value} onChange={(e) => onValue(e.target.value)} />
      {value !== "" && <button type="button" className="clear-x" onClick={() => onValue("")} aria-label={en.library.clear} title={en.library.clear}><Icon name="close" /></button>}
    </span>
  );
});
