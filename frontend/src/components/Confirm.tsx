import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Dialog } from "./Dialog";
import { en } from "../i18n/en";

export interface ConfirmOptions {
  /** The question, naming what is affected ("Remove “Song” from the library?"). */
  title: string;
  /** What else happens, in a sentence or two. */
  body?: string;
  /** The destructive button's label ("Remove", "Delete"). */
  action: string;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask | null>(null);

/** Asks the person before something that cannot be undone, in the app's own dialog (a sheet on phones), never in the browser's. */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm needs a ConfirmProvider");
  return ask;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<ConfirmOptions | null>(null);
  const answer = useRef<((ok: boolean) => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null); // what had the focus when the question was asked: it gets it back
  const ask = useCallback<Ask>((options) => new Promise<boolean>((resolve) => {
    answer.current?.(false); // a question that is still open is answered "no"
    answer.current = resolve;
    if (!opener.current) opener.current = document.activeElement as HTMLElement | null;
    setOpen(options);
  }), []);
  const done = (ok: boolean) => {
    const resolve = answer.current;
    answer.current = null;
    setOpen(null);
    resolve?.(ok);
    const back = opener.current;
    opener.current = null;
    setTimeout(() => { if (back?.isConnected) back.focus?.(); }, 0);
  };
  useEffect(() => { // the question belongs to the page it was asked on
    if (!open) return;
    const leave = () => done(false);
    window.addEventListener("hashchange", leave);
    return () => window.removeEventListener("hashchange", leave);
  }, [open]);
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {open && (
        <Dialog title={open.title} describedBy={open.body ? "confirm-text" : undefined} onClose={() => done(false)}>
          <div className="confirm">
            {open.body && <p className="confirm-text" id="confirm-text">{open.body}</p>}
            <div className="confirm-actions">
              <button type="button" className="btn secondary" autoFocus onClick={() => done(false)}>{en.confirm.cancel}</button>
              <button type="button" className="btn danger" onClick={() => done(true)}>{open.action}</button>
            </div>
          </div>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}
