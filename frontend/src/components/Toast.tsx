import { useEffect, useRef, useState } from "react";
import { useExitTransition } from "../hooks/useExitTransition";
import { en } from "../i18n/en";
import { Icon } from "./Icon";

export type ToastData = { kind: "ok" | "error" | "progress"; text: string };

/** Holds one floating message. A success leaves by itself after `okMs`; progress stays while the work runs; an error stays until dismissed. */
export function useToast(okMs = 4000) {
  const [toast, setToast] = useState<ToastData | null>(null);
  useEffect(() => {
    if (toast?.kind !== "ok") return;
    const id = setTimeout(() => setToast(null), okMs);
    return () => clearTimeout(id);
  }, [toast, okMs]);
  return [toast, setToast] as const;
}

const ICON = { ok: "check", error: "warning", progress: "spinner" } as const;

/** The one floating message: surface, line, shadow, a coloured icon and the words. Fades in with an 8 px slide, fades out the same way. */
export function Toast({ toast, onDismiss, pill = false }: { toast: ToastData | null; onDismiss?: () => void; pill?: boolean }) {
  const last = useRef(toast);
  if (toast) last.current = toast;
  const { mounted, state } = useExitTransition(toast !== null, 250);
  const [, tick] = useState(0);
  useEffect(() => { if (!mounted) { last.current = null; tick((n) => n + 1); } }, [mounted]);
  const t = toast ?? last.current;
  if (!mounted || !t) return null;
  return (
    <div className="float-toast" data-kind={t.kind} data-state={state} data-pill={pill || undefined} role={t.kind === "error" ? "alert" : "status"}>
      <span className={t.kind === "progress" ? "toast-icon spin" : "toast-icon"}><Icon name={ICON[t.kind]} /></span>
      <span className="toast-text">{t.text}</span>
      {t.kind === "error" && onDismiss && <button type="button" className="toast-x" aria-label={en.toast.dismiss} onClick={onDismiss}><Icon name="close" /></button>}
    </div>
  );
}
