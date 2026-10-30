/** Text on the clipboard. The phone app has the native Clipboard plugin (a WebView often refuses navigator.clipboard); a browser uses its own, which needs a secure page. */
export async function readClipboardText(): Promise<string> {
  const native = (window as unknown as { Capacitor?: { Plugins?: { Clipboard?: { read?: () => Promise<{ value?: string }> } } } }).Capacitor?.Plugins?.Clipboard;
  if (native?.read) return String((await native.read()).value ?? "");
  if (!navigator.clipboard?.readText) throw new Error("no clipboard access");
  return navigator.clipboard.readText();
}
