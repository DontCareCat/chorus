import { en } from "../i18n/en";
import { Icon } from "./Icon";

interface Props {
  /** songs whose lyrics are being looked up or waiting for their turn */
  waiting: number;
  busy: boolean;
  onRetry: () => void;
}

/** Shown under the filters only while lyrics requests are running or waiting. */
export function LookupBar({ waiting, busy, onRetry }: Props) {
  if (waiting === 0) return null;
  return (
    <div className="lookup-bar" role="status" aria-live="polite">
      <span className="spin" data-still={waiting > 3 || undefined}><Icon name="spinner" /></span>
      <span className="lookup-text"><strong>{en.library.lookup(waiting)}</strong><small>{en.library.lookupHelp}</small></span>
      <button type="button" className="btn secondary small" onClick={onRetry} disabled={busy}>{en.library.lookupRetry}</button>
    </div>
  );
}
