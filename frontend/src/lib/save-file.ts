/** Hands a file the app made to the person: the browser downloads it; the phone app puts it in a folder the person chooses (it sets `chorusSaveFile`). */
export async function saveFile(filename: string, mime: string, bytes: Uint8Array): Promise<void> {
  const native = (window as unknown as { chorusSaveFile?: (name: string, mime: string, bytes: Uint8Array) => Promise<void> }).chorusSaveFile;
  if (native) return native(filename, mime, bytes);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
