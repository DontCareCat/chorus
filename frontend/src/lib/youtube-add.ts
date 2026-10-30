export type AddTab = "youtube" | "files" | "folder";
export const ADD_TABS: readonly AddTab[] = ["youtube", "files", "folder"];
const KEY = "chorus-add-tab";

/** The tab of the Add music panel used last (browser storage may be blocked or hold anything). */
export function readAddTab(): AddTab | null {
  try {
    const v = localStorage.getItem(KEY);
    return ADD_TABS.find((t) => t === v) ?? null;
  } catch {
    return null;
  }
}

export function writeAddTab(tab: AddTab): void {
  try {
    localStorage.setItem(KEY, tab);
  } catch {
    /* blocked: the tab is just not remembered */
  }
}

/** The tab to open: the remembered one, or YouTube first; YouTube is skipped while it is switched off. */
export function startTab(youtubeOn: boolean): AddTab {
  const t = readAddTab();
  if (t && (t !== "youtube" || youtubeOn)) return t;
  return youtubeOn ? "youtube" : "files";
}

export const youtubeThumb = (id: string): string => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
export const youtubeWatchUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;
export const isTopicChannel = (channel: string | null | undefined): boolean => /- topic$/i.test(channel ?? "");
