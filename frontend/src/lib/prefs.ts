import { useCallback, useState } from "react";

const PREFIX = "chorus_";
const MAX_AGE = 60 * 60 * 24 * 365; // one year

/** A remembered choice, kept in a browser cookie (a year, this site only). Anything unreadable gives the fallback. */
export function readPref<T>(name: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const part = document.cookie.split("; ").find((c) => c.startsWith(`${PREFIX}${name}=`));
    if (!part) return fallback;
    const value: unknown = JSON.parse(decodeURIComponent(part.slice(PREFIX.length + name.length + 1)));
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(name: string, value: unknown): void {
  try {
    document.cookie = `${PREFIX}${name}=${encodeURIComponent(JSON.stringify(value))}; max-age=${MAX_AGE}; path=/; SameSite=Lax`;
  } catch {
    /* cookies are blocked: the choice just is not remembered */
  }
}

export const isOneOf = <T extends string | number>(...allowed: readonly T[]) => (v: unknown): v is T => allowed.includes(v as T);
export const isString = (v: unknown): v is string => typeof v === "string" && v.length <= 200;
export const isBool = (v: unknown): v is boolean => typeof v === "boolean";
export const isId = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isInteger(v) && v > 0);

/** useState whose value is remembered in a cookie `chorus_<name>` and restored on the next visit. */
export function usePref<T>(name: string, fallback: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(name, fallback, valid));
  const set = useCallback((v: T) => { setValue(v); writePref(name, v); }, [name]);
  return [value, set];
}
