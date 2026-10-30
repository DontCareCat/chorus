let open = 0;

/** Marks the page as having a dialog or sheet open (it does not scroll behind it) for as long as at least one is. Returns the release. */
export function holdDialogOpen(): () => void {
  const root = document.documentElement;
  open++;
  root.classList.add("dialog-open");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--open <= 0) { open = 0; root.classList.remove("dialog-open"); }
  };
}
