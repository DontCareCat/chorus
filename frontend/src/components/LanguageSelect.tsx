export const LANGUAGES: readonly { code: string; name: string }[] = [
  { code: "ar", name: "Arabic" }, { code: "bg", name: "Bulgarian" }, { code: "ca", name: "Catalan" }, { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" }, { code: "nl", name: "Dutch" }, { code: "en", name: "English" }, { code: "fi", name: "Finnish" },
  { code: "fr", name: "French" }, { code: "de", name: "German" }, { code: "el", name: "Greek" }, { code: "he", name: "Hebrew" },
  { code: "hu", name: "Hungarian" }, { code: "id", name: "Indonesian" }, { code: "it", name: "Italian" }, { code: "nb", name: "Norwegian" },
  { code: "pl", name: "Polish" }, { code: "pt", name: "Portuguese" }, { code: "ro", name: "Romanian" }, { code: "ru", name: "Russian" },
  { code: "es", name: "Spanish" }, { code: "sv", name: "Swedish" }, { code: "tr", name: "Turkish" }, { code: "uk", name: "Ukrainian" },
  { code: "et", name: "Estonian" }, { code: "fa", name: "Persian" }, { code: "hi", name: "Hindi" }, { code: "hr", name: "Croatian" },
  { code: "lt", name: "Lithuanian" }, { code: "lv", name: "Latvian" }, { code: "sk", name: "Slovak" }, { code: "sr", name: "Serbian" },
].sort((a, b) => a.name.localeCompare(b.name));

/** "German" for "de"; the code itself for one that is not in the list. */
export const languageName = (code: string): string => LANGUAGES.find((l) => l.code === code)?.name ?? code;

interface Props {
  value: string;
  onChange: (code: string) => void;
  id?: string;
}

/** Language names for people, two-letter codes for the database. A code that is not in the list stays selectable. */
export function LanguageSelect({ value, onChange, id }: Props) {
  const known = LANGUAGES.some((l) => l.code === value);
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && value && <option value={value}>{value}</option>}
      {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name} ({l.code})</option>)}
    </select>
  );
}
