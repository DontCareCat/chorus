/**
 * Props for every free-text field that is NOT a sign-in field: no browser or keyboard autofill (the address / card /
 * password menu), no spell-check squiggles, no auto-capitalisation or auto-correction, and a hint for password managers to
 * keep out. `autocomplete="off"` alone is ignored by some Android browsers, so the field also gets a `name` that does not
 * look like a personal-data field and the data attributes the common password managers honour.
 */
export function noAutofill(name: string) {
  return {
    name: `chorus-${name}`,
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "none",
    spellCheck: false,
    "data-lpignore": "true", // LastPass
    "data-1p-ignore": "true", // 1Password
    "data-bwignore": "true", // Bitwarden
    "data-form-type": "other", // Dashlane
  } as const;
}
