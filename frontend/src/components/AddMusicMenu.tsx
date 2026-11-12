import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { Sheet } from "./Sheet";
import type { SheetApi } from "./Sheet";
import { useExitTransition } from "../hooks/useExitTransition";
import { en } from "../i18n/en";
import { swallowNextClick } from "../lib/swallow-click";

/** A row of the menu: it either does something (and the menu closes) or opens a second step (`step`: the id of an entry of `steps`). */
export type AddMusicItem =
  | { kind: "divider" }
  | { kind?: "item"; id: string; icon: IconName; label: string; step?: string; right?: string; disabled?: boolean; onPick?: () => void };

export const POPOVER_MS = 120;

interface Props {
  phone: boolean;
  open: boolean;
  onClose: () => void;
  /** the "+ Add music" button: a click on it is the page's own toggle, not an outside tap */
  anchor: RefObject<HTMLElement | null>;
  items: AddMusicItem[];
  /** the content of each second step */
  steps: Record<string, { title: string; body: ReactNode }>;
  /** the line at the foot of the popover on a PC ("Or drop files anywhere on this page.") */
  footer?: string;
}

/**
 * The Add music menu (design guide section 16b): the look of the song's ⋮ menu. A bottom sheet on a phone, a popover under the
 * "+ Add music" button on a PC (right-aligned, 300 px wide, 400 px for a second step); the popover fades and slides in and out and stays
 * mounted until the exit has finished. Rows with a chevron open a second step in the same layer, with a back arrow.
 */
export function AddMusicMenu({ phone, open, onClose, anchor, items, steps, footer }: Props) {
  const [step, setStep] = useState<string | null>(null);
  useEffect(() => { if (!open) setStep(null); }, [open]);
  if (phone) return open ? <PhoneSheet onClose={onClose} items={items} steps={steps} step={step} setStep={setStep} /> : null;
  return <Popover open={open} onClose={onClose} anchor={anchor} items={items} steps={steps} step={step} setStep={setStep} footer={footer} />;
}

interface LayerProps extends Pick<Props, "items" | "steps" | "onClose"> { step: string | null; setStep: (s: string | null) => void; sheet?: RefObject<SheetApi | null>; popover?: boolean }

function PhoneSheet({ onClose, items, steps, step, setStep }: LayerProps) {
  const sheet = useRef<SheetApi>(null);
  return (
    <Sheet ref={sheet} label={en.library.addMusic} className="song-sheet add-sheet" onClose={onClose}>
      <Content onClose={() => sheet.current?.close()} items={items} steps={steps} step={step} setStep={setStep} />
    </Sheet>
  );
}

function Popover({ open, onClose, anchor, items, steps, step, setStep, footer }: LayerProps & { open: boolean; anchor: RefObject<HTMLElement | null>; footer?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const exit = useExitTransition(open, POPOVER_MS);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) { swallowNextClick(); onClose(); }
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  }, [open, onClose, anchor]);
  if (!exit.mounted) return null;
  return (
    <div className="add-popover song-menu" ref={box} data-state={exit.state} data-wide={step !== null || undefined} role="dialog" aria-label={en.library.addMusic}>
      <Content onClose={onClose} items={items} steps={steps} step={step} setStep={setStep} popover />
      {footer && step === null && <p className="add-foot">{footer}</p>}
    </div>
  );
}

function Content({ onClose, items, steps, step, setStep, popover }: Pick<LayerProps, "items" | "steps" | "step" | "setStep" | "onClose" | "popover">) {
  const current = step ? steps[step] : undefined;
  if (current) {
    return (
      <div className="am-step" key={step}>
        <header className="am-step-head">
          <button type="button" className="icon-btn" aria-label={en.library.back} onClick={() => setStep(null)}><Icon name="arrowBack" /></button>
          <strong>{current.title}</strong>
        </header>
        <div className="am-step-body">{current.body}</div>
      </div>
    );
  }
  return (
    <div role="menu" aria-label={en.library.addMusic} key="menu" className={popover ? undefined : "am-menu"}>
      {!popover && (
        <header className="sheet-head">
          <strong>{en.library.addMusic}</strong>
          <span className="muted">{en.library.addHelp}</span>
        </header>
      )}
      {items.map((it, i) => it.kind === "divider" ? <hr key={`d${i}`} /> : (
        <button
          key={it.id} type="button" role="menuitem" className="mi" disabled={it.disabled}
          onClick={() => { if (it.step) setStep(it.step); else { it.onPick?.(); onClose(); } }}
        >
          <Icon name={it.icon} /><span>{it.label}</span>
          {it.right !== undefined && <span className="mi-right">{it.right}</span>}
          {it.step && <span className="mi-more" aria-hidden="true"><Icon name="chevronRight" /></span>}
        </button>
      ))}
    </div>
  );
}
