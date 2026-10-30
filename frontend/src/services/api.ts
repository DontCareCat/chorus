import type { GameDto, GameMode, Match } from "../types/game";

/** Fired when the server says nobody may use it without signing in (guests switched off). */
export const AUTH_REQUIRED = "chorus:auth-required";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("network", "Cannot reach the server.", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body as { error?: { code: string; message: string } } | null)?.error;
    if (res.status === 401 && e?.code === "auth_required") window.dispatchEvent(new Event(AUTH_REQUIRED));
    // A server crash or a proxy error may not carry our structured body: still say something a person can act on.
    const fallback = res.status >= 500 ? `The server had a problem (HTTP ${res.status}). Check the server log and try again.` : res.statusText || "Request failed";
    throw new ApiError(e?.code ?? "http_error", e?.message ?? fallback, res.status);
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const form = (file: File): RequestInit => {
  const fd = new FormData();
  fd.append("file", file);
  return { method: "POST", body: fd };
};

export interface SongDto {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  duration: number;
  language: string;
  language_source: "default" | "detected" | "manual";
  lyrics_offset: number;
  source: "library" | "import" | "upload" | "youtube";
  file_name: string | null;
  youtube_id?: string | null;
  youtube_channel?: string | null;
  available: boolean;
  has_cover: boolean | null;
  cover_source: "embedded" | "online" | "custom" | "choose" | "none" | "youtube" | null;
  lyrics_status: "pending" | "found" | "needs_choice" | "not_found";
  lyrics_stalled?: boolean;
  created_at: string;
  best_score: number | null;
  plays: number;
  last_played_at: string | null;
}

export interface SongPatch {
  title?: string;
  artist?: string;
  album?: string | null;
  language?: string;
  lyrics_offset?: number;
}

export interface LineDto {
  sequence: number;
  start_time: number | null;
  end_time: number | null;
  text: string;
}

export interface LyricsDto {
  id: number;
  source: string;
  external_id: string | null;
  is_synced: boolean;
  lines: LineDto[];
  warnings: string[];
}

export interface CandidateDto {
  id: number;
  artist: string;
  title: string;
  album: string | null;
  duration: number;
  synced: boolean;
  has_plain: boolean;
  instrumental: boolean;
  usable: boolean;
  in_use: boolean;
}

export interface DiscoveryDto {
  status: SongDto["lyrics_status"];
  lyrics: LyricsDto | null;
  candidates: CandidateDto[];
  unsynced_hidden: number;
  warnings: string[];
  error: string | null;
}

export interface SettingsDto {
  allow_unsynchronized_lyrics: boolean;
  lyrics_cache_ttl_days: number;
  lyrics_timeout_minutes: number;
  default_queue_difficulty: "progressive" | "easy" | "medium" | "hard" | "expert";
  queue_autoplay: boolean;
  queue_fade: boolean;
  queue_fade_seconds: number;
  auto_fetch_lyrics: boolean;
  auto_fetch_covers: boolean;
  auto_detect_language: boolean;
  default_language: string;
  library_dirs: string[];
  translation_enabled: boolean;
  allow_guest: boolean;
  allow_registration: boolean;
}

export interface CoverCandidateDto {
  id: string;
  title: string;
  artist: string;
  date: string | null;
  score: number;
}

export interface FsEntryDto {
  name: string;
  kind: "dir" | "audio";
  size: number | null;
  link: boolean;
}

export interface FsListingDto {
  path: string;
  parent: string | null;
  entries: FsEntryDto[];
  roots: { name: string; path: string }[];
}

export interface ScanDto {
  added: number;
  skipped: number;
  unavailable: number;
  filtered?: number;
  errors: string[];
}

export interface GameSummaryDto {
  public_id: string;
  song_id: number;
  difficulty: string;
  mode: GameMode;
  started_at: string;
  finished_at: string | null;
  score: number; // points
  correct_count: number;
  best_multiplier: number;
  answered: number;
  total: number;
}

export interface AnswerResultDto {
  correct: boolean;
  correct_option_id: number | null;
  match?: Match | null;
  word?: string | null;
  text: string;
  score: number; // the game's points so far
  points: number; // points this answer earned
  ahead: boolean;
  multiplier: number; // the multiplier this answer was scored with
  streak: number;
  next_multiplier: number;
  already_answered: boolean;
  finished: boolean;
}

export interface SongScoreDto {
  rank: number;
  display_name: string;
  points: number;
  correct: number;
  total: number;
  best_multiplier: number;
  difficulty: string;
  mode: GameMode;
  finished_at: string;
  me: boolean;
}

export interface GlobalScoreDto {
  rank: number;
  display_name: string;
  points: number;
  songs: number;
  me: boolean;
}

export interface DictExampleDto {
  id: number;
  song_id: number;
  song_title: string;
  sentence: string;
  translation: string | null;
  audio_start: number | null;
  audio_end: number | null;
  playable: boolean;
}

export interface DictEntryDto {
  id: number;
  language: string;
  surface: string;
  lemma: string | null;
  article: string | null;
  translation: string | null;
  translation_language: string | null;
  enrich_status: "pending" | "done" | "failed";
  suspended: boolean;
  added_at: string;
  due_at: string | null;
  interval_seconds: number;
  reps: number;
  lapses: number;
  examples: DictExampleDto[];
}

export interface DictListDto {
  total: number;
  items: DictEntryDto[];
  languages: { code: string; count: number }[];
  status_counts: Record<string, number>;
}

/** A card's review schedule; "Back" sends the one from before the rating. */
export interface ScheduleDto {
  due_at: string | null;
  interval_seconds: number;
  reps: number;
  lapses: number;
  introduced_at: string | null;
  last_reviewed_at: string | null;
}

export interface RatedDto extends DictEntryDto {
  previous: ScheduleDto;
}

export type DictStatus = "all" | "due" | "new" | "suspended";
export type Rating = "again" | "hard" | "good" | "easy";

/** The Dictionary page's filters: a review is limited to the words they show. */
export interface ReviewScope {
  status?: DictStatus;
  language?: string;
  q?: string;
}

const scopeQuery = (scope: ReviewScope = {}): string =>
  new URLSearchParams({ status: scope.status ?? "all", ...(scope.language && scope.language !== "all" ? { language: scope.language } : {}), ...(scope.q ? { q: scope.q } : {}) }).toString();

export interface ReviewSummaryDto {
  due: number;
  new: number;
  total: number;
  available: number;
  reviewed_today: number;
  left_today: number | null; // null = no daily limit
}

export interface ReviewNextDto {
  card: { id: number; word: string; language: string; intervals: Record<Rating, number> } | null;
  summary: ReviewSummaryDto;
}

export interface UserDto {
  id: number;
  username: string;
  display_name: string;
  is_guest: boolean;
  is_admin: boolean;
  translation_language: string;
  daily_card_limit: number; // 0 = unlimited
}

export interface AuthStateDto {
  user: UserDto | null;
  allow_registration: boolean;
  allow_guest: boolean;
  first_account: boolean;
}

export interface PlaylistDto {
  id: number;
  name: string;
  song_count: number;
  duration: number;
  covers: { id: number; title: string; has_cover: boolean | null }[];
  song_ids: number[];
  updated_at: string;
}

export interface PlaylistSongDto extends SongDto { removed: boolean }

export interface PlaylistDetailDto {
  id: number;
  name: string;
  song_count: number;
  duration: number;
  songs: PlaylistSongDto[];
}

/** What the player gave: a chosen option (multiple choice) or the typed word (typing mode). */
export type Answer = { optionId: number } | { text: string };

export const api = {
  songs: () => request<SongDto[]>("/api/songs"),
  audioUrl: (songId: number) => `/api/songs/${songId}/audio`,
  uploadSong: (file: File) => request<SongDto>("/api/songs", form(file)),
  addYouTubeSong: (url: string, title?: string, artist?: string) => request<SongDto>("/api/songs/youtube", json("POST", { url, title, artist })),
  importSong: (path: string) => request<SongDto>("/api/songs/import", json("POST", { path })),
  scan: () => request<ScanDto>("/api/library/scan", { method: "POST" }),
  listFolder: (path?: string, hidden = false) =>
    request<FsListingDto>(`/api/fs/list?${new URLSearchParams({ ...(path ? { path } : {}), hidden: String(hidden) })}`),
  importMany: (opts: { paths: string[]; recursive: boolean; copyFiles: boolean; include?: string; exclude?: string }) =>
    request<ScanDto>("/api/library/import-many", json("POST", { paths: opts.paths, recursive: opts.recursive, copy_files: opts.copyFiles, include: opts.include || null, exclude: opts.exclude || null })),
  importPath: (path: string, recursive: boolean, copyFiles: boolean) =>
    request<ScanDto>("/api/library/import", json("POST", { path, recursive, copy_files: copyFiles })),
  health: () => request<{ status: string; app: string; version: string }>("/api/health"),
  /** Looks for lyrics again, in the background: for these songs, or (no ids) for every song that has none yet. */
  retryLyrics: (ids?: number[]) => request<{ queued: number }>("/api/songs/lyrics/retry", json("POST", ids ? { ids } : {})),
  deleteSongs: (ids: number[]) =>
    request<{ hidden: number; deleted: number; missing: number }>("/api/songs/bulk-delete", json("POST", { ids })),
  playlists: () => request<PlaylistDto[]>("/api/playlists"),
  playlist: (id: number) => request<PlaylistDetailDto>(`/api/playlists/${id}`),
  createPlaylist: (name: string) => request<PlaylistDto>("/api/playlists", json("POST", { name })),
  renamePlaylist: (id: number, name: string) => request<PlaylistDto>(`/api/playlists/${id}`, json("PATCH", { name })),
  deletePlaylist: (id: number) => request<null>(`/api/playlists/${id}`, { method: "DELETE" }),
  addToPlaylist: (id: number, songIds: number[]) => request<PlaylistDto>(`/api/playlists/${id}/songs`, json("POST", { song_ids: songIds })),
  removeFromPlaylist: (id: number, songId: number) => request<PlaylistDto>(`/api/playlists/${id}/songs/${songId}`, { method: "DELETE" }),
  reorderPlaylist: (id: number, songIds: number[]) => request<PlaylistDto>(`/api/playlists/${id}/order`, json("PUT", { song_ids: songIds })),
  deleteSong: (id: number) => request<{ result: "hidden" | "deleted" }>(`/api/songs/${id}`, { method: "DELETE" }),
  coverUrl: (songId: number, version?: string | number) => `/api/songs/${songId}/cover${version === undefined ? "" : `?v=${version}`}`,
  coverAuto: (songId: number) => request<{ status: string }>(`/api/songs/${songId}/cover/auto`, { method: "POST" }),
  coverCandidates: (songId: number, q?: string) => request<CoverCandidateDto[]>(`/api/songs/${songId}/cover/candidates${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  coverCandidateImage: (songId: number, mbid: string) => `/api/songs/${songId}/cover/candidates/${mbid}/image`,
  coverChoose: (songId: number, id: string) => request<SongDto>(`/api/songs/${songId}/cover/choose`, json("POST", { id })),
  coverUpload: (songId: number, file: File) => request<SongDto>(`/api/songs/${songId}/cover/upload`, form(file)),
  coverRemove: (songId: number) => request<SongDto>(`/api/songs/${songId}/cover`, { method: "DELETE" }),
  detectLanguage: (id: number) => request<SongDto>(`/api/songs/${id}/language/detect`, { method: "POST" }),
  patchSong: (id: number, patch: SongPatch) => request<SongDto>(`/api/songs/${id}`, json("PATCH", patch)),

  lyrics: (songId: number) => request<LyricsDto>(`/api/songs/${songId}/lyrics`),
  /** `replace` (the song already has lyrics): only list candidates, never attach one by itself. */
  discover: (songId: number, mode: "auto" | "replace" = "auto") =>
    request<DiscoveryDto>(`/api/songs/${songId}/lyrics/discover?mode=${mode}`, { method: "POST" }),
  searchLyrics: (songId: number, q: string) => request<CandidateDto[]>(`/api/songs/${songId}/lyrics/search?q=${encodeURIComponent(q)}`),
  attachLyrics: (songId: number, lrclibId: number) => request<LyricsDto>(`/api/songs/${songId}/lyrics`, json("POST", { lrclib_id: lrclibId })),
  uploadLyrics: (songId: number, file: File) => request<LyricsDto>(`/api/songs/${songId}/lyrics/upload`, form(file)),
  clearCache: () => request<{ deleted: number }>("/api/lyrics/cache", { method: "DELETE" }),

  settings: () => request<SettingsDto>("/api/settings"),
  saveSettings: (s: SettingsDto) => request<SettingsDto>("/api/settings", json("PUT", s)),

  songGames: (songId: number) => request<GameSummaryDto[]>(`/api/songs/${songId}/games`),
  createGame: (songId: number, difficulty: string, mode: GameMode = "choice") =>
    request<GameDto>("/api/games", json("POST", { song_id: songId, difficulty, mode })),
  getGame: (publicId: string) => request<GameDto>(`/api/games/${publicId}`),
  scores: (mode: GameMode = "choice") => request<GlobalScoreDto[]>(`/api/scores?mode=${mode}`),
  songScores: (songId: number, mode: GameMode = "choice") => request<SongScoreDto[]>(`/api/songs/${songId}/scores?mode=${mode}`),
  myGames: () => request<GameSummaryDto[]>("/api/games"),
  answer: (publicId: string, questionId: number, answer: Answer, position: number | null, waited: number) =>
    request<AnswerResultDto>(`/api/games/${publicId}/answers`, json("POST", { question_id: questionId, ...("optionId" in answer ? { option_id: answer.optionId } : { text: answer.text }), position, waited })),

  me: () => request<AuthStateDto>("/api/auth/me"),
  register: (username: string, password: string, displayName: string) =>
    request<AuthStateDto>("/api/auth/register", json("POST", { username, password, display_name: displayName || null })),
  login: (username: string, password: string) => request<AuthStateDto>("/api/auth/login", json("POST", { username, password })),
  logout: () => request<AuthStateDto>("/api/auth/logout", { method: "POST" }),
  changePassword: (current: string, next: string) =>
    request<{ ok: boolean }>("/api/auth/password", json("POST", { current_password: current, new_password: next })),
  updateAccount: (changes: { translation_language?: string; daily_card_limit?: number }) => request<AuthStateDto>("/api/auth/me", json("PATCH", changes)),
  dictionary: (opts: { status?: DictStatus; language?: string; q?: string; limit?: number; offset?: number } = {}) =>
    request<DictListDto>(`/api/dictionary?${new URLSearchParams({ status: opts.status ?? "all", ...(opts.language ? { language: opts.language } : {}), ...(opts.q ? { q: opts.q } : {}), limit: String(opts.limit ?? 100), offset: String(opts.offset ?? 0) })}`),
  setSuspended: (id: number, suspended: boolean) => request<DictEntryDto>(`/api/dictionary/${id}`, json("PATCH", { suspended })),
  deleteWord: (id: number) => request<{ deleted: number }>(`/api/dictionary/${id}`, { method: "DELETE" }),
  refreshWord: (id: number) => request<DictEntryDto>(`/api/dictionary/${id}/refresh`, { method: "POST" }),
  getWord: (id: number) => request<DictEntryDto>(`/api/dictionary/${id}`),
  importWords: () => request<{ added: number; words: number }>("/api/dictionary/import-from-games", { method: "POST" }),
  reviewSummary: (scope?: ReviewScope) => request<ReviewSummaryDto>(`/api/dictionary/review/summary?${scopeQuery(scope)}`),
  reviewNext: (exclude: number[] = [], scope?: ReviewScope) => request<ReviewNextDto>(`/api/dictionary/review/next?exclude=${exclude.join(",")}&${scopeQuery(scope)}`),
  rate: (id: number, rating: Rating) => request<RatedDto>(`/api/dictionary/review/${id}/answer`, json("POST", { rating })),
  undoRating: (id: number, previous: ScheduleDto) => request<DictEntryDto>(`/api/dictionary/review/${id}/undo`, json("POST", previous)),
  users: () => request<UserDto[]>("/api/users"),
  deleteUser: (id: number) => request<{ deleted: number }>(`/api/users/${id}`, { method: "DELETE" }),
};
