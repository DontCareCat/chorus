import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { swallowNextClick } from "../lib/swallow-click";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import type { SheetApi } from "./Sheet";

export interface SelectOption<V extends string | number> {
  value: V;
  label: string;
  /** what the button and the list show instead of the plain label (an icon with the name) */
  node?: ReactNode;
}

interface Props<V extends string | number> {
  value: V | "";
  onChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  id?: string;
  ariaLabel?: string;
  /** shown while `value` matches no option (e.g. a "Places" menu that always stays unselected) */
  placeholder?: string;
  disabled?: boolean;
  /** phones: open as a bottom sheet (the default) instead of a popover */
  sheetOnPhone?: boolean;
  /** a chip-shaped button of a fixed width (design guide section 19) instead of a text field */
  chip?: boolean;
}

/**
 * The app's dropdown (design guide section 15): a button that looks like a text field, and a list that follows the guide
 * (44 px items, 14 px inner padding, the chosen item ticked, hover/keyboard highlight) instead of the browser's own menu.
 * Popover under the button on PCs; a bottom sheet on phones. Arrow keys, Home/End, type-ahead, Enter/Space, Esc.
 */
export function Select<V extends string | number>({ value, onChange, options, id, ariaLabel, placeholder, disabled, sheetOnPhone = true, chip = false }: Props<V>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; max: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const sheet = useRef<SheetApi>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const current = options.findIndex((o) => o.value === value);
  const phone = typeof document !== "undefined" && document.documentElement.dataset.layout === "phone" && sheetOnPhone;

  const close = useCallback((focus = true) => { if (phone && sheet.current) sheet.current.close(); else setOpen(false); if (focus) button.current?.focus(); }, [phone]);
  const choose = useCallback((i: number) => { const o = options[i]; if (o) { onChange(o.value); close(); } }, [options, onChange, close]);
  const show = () => { setActive(Math.max(current, 0)); setOpen(true); };

  useLayoutEffect(() => {
    if (!open || phone || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const flip = below < 220 && above > below;
    setPos({ left: r.left, width: Math.max(r.width, 200), max: Math.min(340, flip ? above : below), ...(flip ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  }, [open, phone]);

  useEffect(() => {
    if (!open || phone) return; // the sheet closes itself (backdrop, handle, Esc)
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !button.current?.contains(t)) { swallowNextClick(); close(false); }
    };
    const scroll = (e: Event) => { if (!list.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", scroll);
    };
  }, [open, phone, close]);

  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView?.({ block: "nearest" }); }, [open, active, pos]);

  const labels = useMemo(() => options.map((o) => o.label.toLowerCase()), [options]);
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    const last = options.length - 1;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(last, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(last); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
    else if (e.key === "Tab") close(false);
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? "" : typed.current.text) + e.key.toLowerCase(), at: now };
      const hit = labels.findIndex((l) => l.startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  const items = (
    <ul ref={list} id={listId} role="listbox" className="select-list" aria-label={ariaLabel} style={phone ? undefined : { left: pos?.left ?? -9999, width: pos?.width, top: pos?.top, bottom: pos?.bottom, maxHeight: pos?.max }}>
      {options.map((o, i) => (
        <li
          key={String(o.value)} role="option" data-i={i} aria-selected={i === current} data-active={i === active}
          onPointerEnter={() => setActive(i)} onClick={() => choose(i)}
        >
          <span>{o.node ?? o.label}</span>
          {i === current && <Icon name="check" />}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <button
        type="button" id={id} ref={button} className={`select-btn${chip ? " chip-select" : ""}`} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-label={ariaLabel} disabled={disabled} onClick={() => (open ? close() : show())} onKeyDown={onKey} data-placeholder={current < 0}
      >
        <span>{current >= 0 ? options[current]!.node ?? options[current]!.label : placeholder ?? ""}</span>
      </button>
      {/* in the body, not beside the button: a click inside a <label> would otherwise be forwarded to the button and reopen the list */}
      {open && createPortal(phone ? <Sheet ref={sheet} label={ariaLabel ?? placeholder ?? ""} className="select-sheet" onClose={() => setOpen(false)}>{items}</Sheet> : items, document.body)}
    </>
  );
}
