import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "chorus-theme";

const stored = (): Theme | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null; // blocked storage: follow the system
  }
};
const system = (): Theme => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** Light / dark switch. Until the player chooses, the system setting decides; the choice is remembered. */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [theme, set] = useState<Theme>(() => stored() ?? system());
  useEffect(() => {
    if (stored()) document.documentElement.dataset.theme = theme;
  }, [theme]);
  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* the choice just lasts for this visit */
    }
    document.documentElement.dataset.theme = t;
    set(t);
  }, []);
  return { theme, setTheme };
}
