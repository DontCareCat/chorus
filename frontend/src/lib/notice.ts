import type { ToastData } from "../components/Toast";

const EVENT = "chorus-notice";
/** Shows one floating message from anywhere (the app shell listens): for results of actions that have no page of their own, like an export. */
export function notify(toast: ToastData): void { window.dispatchEvent(new CustomEvent<ToastData>(EVENT, { detail: toast })); }
export function onNotice(cb: (t: ToastData) => void): () => void {
  const on = (e: Event) => cb((e as CustomEvent<ToastData>).detail);
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
