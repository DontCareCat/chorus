/** Text on the clipboard. The phone app has the native Clipboard plugin (a WebView often refuses navigator.clipboard); a browser uses its own, which needs a secure page. */
export async function readClipboardText(): Promise<string> {
  const native = (window as unknown as { chorusClipboard?: { read: () => Promise<{ value?: string }> } }).chorusClipboard;
  if (native) return String((await native.read()).value ?? ""); // set by the phone app
  if (!navigator.clipboard?.readText) throw new Error("no clipboard access");
  return navigator.clipboard.readText();
}
