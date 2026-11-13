import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { Icon } from "./Icon";

/** One section of Settings: an uppercase label over a card of rows (design guide section 22). */
export function SettingsCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="scard" id={`settings-${id}`} data-section={id} aria-labelledby={`settings-${id}-h`}>
      <h2 className="scard-label" id={`settings-${id}-h`}>{title}</h2>
      <div className="scard-body">{children}</div>
    </section>
  );
}

function Text({ title, help, helpClass }: { title: string; help?: string; helpClass?: string }) {
  return (
    <div className="srow-text">
      <strong>{title}</strong>
      {help && <small className={helpClass}>{help}</small>}
    </div>
  );
}

/** Title and help on the left, a switch on the right; it applies at once. */
export function SwitchRow({ title, help, checked, onChange, disabled }: { title: string; help?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="srow" data-kind="switch" data-disabled={disabled || undefined}>
      <Text title={title} help={help} />
      <button type="button" role="switch" className="sw" aria-checked={checked} aria-label={title} disabled={disabled} onClick={() => onChange(!checked)}><i /></button>
    </div>
  );
}

/** Title (and help) over a segmented control or other wide control. */
export function ChoiceRow({ title, help, dim, children }: { title: string; help?: string; dim?: boolean; children: ReactNode }) {
  return (
    <div className="srow" data-kind="choice" data-dim={dim || undefined}>
      <Text title={title} help={help} />
      <div className="srow-control">{children}</div>
    </div>
  );
}

/** Title on the left; the picker (a Select in its row form: value and chevron) on the right. */
export function PickerRow({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <div className="srow" data-kind="picker">
      <Text title={title} help={help} />
      <div className="srow-picker">{children}</div>
    </div>
  );
}

/** Title and help, a − value + stepper on the right (and an extra line below, e.g. "Keep forever"). */
export function StepperRow({ title, help, value, label, onStep, canDown, canUp, disabled, children }: {
  title: string; help?: string; value: number; label: string; onStep: (dir: 1 | -1) => void; canDown: boolean; canUp: boolean; disabled?: boolean; children?: ReactNode;
}) {
  return (
    <div className="srow" data-kind="stepper" data-value={value}>
      <Text title={title} help={help} />
      <div className="stepper" role="group" aria-label={title} data-disabled={disabled || undefined}>
        <button type="button" className="icon-btn" aria-label={`${title}: ${en.settings.less}`} disabled={disabled || !canDown} onClick={() => onStep(-1)}>−</button>
        <output aria-live="polite">{label}</output>
        <button type="button" className="icon-btn" aria-label={`${title}: ${en.settings.more}`} disabled={disabled || !canUp} onClick={() => onStep(1)}>+</button>
      </div>
      {children && <div className="srow-extra">{children}</div>}
    </div>
  );
}

/** A text field with its own Save button, enabled only after an edit. `onSave` may refuse by throwing; `status` is shown under the field. */
export function TextField({ title, help, value, saved, onSave, placeholder, readOnly, note, status, inputProps, extraButtons, saveLabel = en.settings.saveField, disabledSave, onChange }: {
  title: string; help?: string; value: string; saved: string; onSave: () => void; onChange: (v: string) => void; placeholder?: string; readOnly?: boolean; note?: string;
  status?: { ok: boolean; text: string } | null; inputProps?: Record<string, unknown>; extraButtons?: ReactNode; saveLabel?: string; disabledSave?: boolean;
}) {
  const dirty = value.trim() !== saved.trim();
  return (
    <form className="srow" data-kind="text" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (dirty && !readOnly && !disabledSave) onSave(); }}>
      <Text title={title} help={help} />
      <div className="srow-field">
        <input type="text" {...noAutofill("settings-field")} aria-label={title} value={value} placeholder={placeholder} readOnly={readOnly} disabled={readOnly} onChange={(e) => onChange(e.target.value)} {...inputProps} />
        {!readOnly && <button type="submit" className="btn secondary" disabled={!dirty || disabledSave}>{saveLabel}</button>}
        {extraButtons}
      </div>
      {note && <small className="srow-help">{note}</small>}
      {status && <small className={`srow-status ${status.ok ? "ok" : "bad"}`} role="status">{status.text}</small>}
    </form>
  );
}

/** A plain row with a title, help and buttons or links on the right. */
export function ActionRow({ title, help, helpClass, children }: { title: string; help?: string; helpClass?: string; children: ReactNode }) {
  return (
    <div className="srow" data-kind="action">
      <Text title={title} help={help} helpClass={helpClass} />
      <div className="srow-actions">{children}</div>
    </div>
  );
}

/** Which section is under the top of the page (scroll-spy), and a way to jump to one. */
export function useSectionSpy(ids: string[]): [string, (id: string) => void] {
  const [current, setCurrent] = useState(ids[0] ?? "");
  const key = ids.join(",");
  const forced = useRef<number>(0);
  useEffect(() => {
    const on = () => {
      if (Date.now() < forced.current) return; // a jump is on its way: keep the chosen one lit
      let found = ids[0] ?? "";
      for (const id of ids) {
        const el = document.getElementById(`settings-${id}`);
        if (el && el.getBoundingClientRect().top <= 140) found = id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) found = ids[ids.length - 1] ?? found;
      setCurrent(found);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const jump = (id: string) => {
    setCurrent(id);
    forced.current = Date.now() + 700;
    const el = document.getElementById(`settings-${id}`);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };
  return [current, jump];
}

/** The section index: chips under the title on a phone, a column on the left on a PC (the current one inverse). */
export function SectionNav({ sections, current, onJump, phone }: { sections: { id: string; title: string }[]; current: string; onJump: (id: string) => void; phone: boolean }) {
  return (
    <nav className="snav" data-phone={phone || undefined} aria-label={en.settings.jumpTo}>
      {sections.map((s) => (
        <button key={s.id} type="button" className={phone ? "chip" : "snav-item"} data-section={s.id} aria-current={current === s.id ? "true" : undefined} aria-pressed={phone ? current === s.id : undefined} onClick={() => onJump(s.id)}>{s.title}</button>
      ))}
    </nav>
  );
}

export const Chevron = () => <Icon name="chevronRight" />;
