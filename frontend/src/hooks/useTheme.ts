import { useCallback, useEffect, useState } from "react";

/** What the player picked; "system" follows the device (and lets it change while the page is open). */
export type Theme = "system" | "light" | "dark";
const KEY = "chorus-theme";

const stored = (): Theme => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system"; // blocked storage: follow the system
  }
};

const apply = (t: Theme) => {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
};

/** Light / dark / system switch. Until the player chooses, the system setting decides; the choice is remembered. */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [theme, set] = useState<Theme>(stored);
  useEffect(() => apply(theme), [theme]);
  const setTheme = useCallback((t: Theme) => {
    try {
      if (t === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      /* the choice just lasts for this visit */
    }
    apply(t);
    set(t);
  }, []);
  return { theme, setTheme };
}
