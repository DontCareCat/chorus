import type { GameDto } from "../types/game";

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
  lyrics_offset: number;
  source: "library" | "import" | "upload";
  file_name: string;
  available: boolean;
  has_cover: boolean | null;
  lyrics_status: "pending" | "found" | "needs_choice" | "not_found";
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
  auto_fetch_lyrics: boolean;
  default_language: string;
  library_dirs: string[];
}

export interface ScanDto {
  added: number;
  skipped: number;
  unavailable: number;
  errors: string[];
}

export interface GameSummaryDto {
  public_id: string;
  song_id: number;
  difficulty: string;
  started_at: string;
  finished_at: string | null;
  score: number;
}

export interface AnswerResultDto {
  correct: boolean;
  correct_option_id: number;
  text: string;
  score: number;
  already_answered: boolean;
  finished: boolean;
}

export const api = {
  songs: () => request<SongDto[]>("/api/songs"),
  audioUrl: (songId: number) => `/api/songs/${songId}/audio`,
  uploadSong: (file: File) => request<SongDto>("/api/songs", form(file)),
  importSong: (path: string) => request<SongDto>("/api/songs/import", json("POST", { path })),
  scan: () => request<ScanDto>("/api/library/scan", { method: "POST" }),
  importPath: (path: string, recursive: boolean, copyFiles: boolean) =>
    request<ScanDto>("/api/library/import", json("POST", { path, recursive, copy_files: copyFiles })),
  deleteSong: (id: number) => request<{ result: "hidden" | "deleted" }>(`/api/songs/${id}`, { method: "DELETE" }),
  coverUrl: (songId: number) => `/api/songs/${songId}/cover`,
  patchSong: (id: number, patch: SongPatch) => request<SongDto>(`/api/songs/${id}`, json("PATCH", patch)),

  lyrics: (songId: number) => request<LyricsDto>(`/api/songs/${songId}/lyrics`),
  discover: (songId: number) => request<DiscoveryDto>(`/api/songs/${songId}/lyrics/discover`, { method: "POST" }),
  searchLyrics: (songId: number, q: string) => request<CandidateDto[]>(`/api/songs/${songId}/lyrics/search?q=${encodeURIComponent(q)}`),
  attachLyrics: (songId: number, lrclibId: number) => request<LyricsDto>(`/api/songs/${songId}/lyrics`, json("POST", { lrclib_id: lrclibId })),
  uploadLyrics: (songId: number, file: File) => request<LyricsDto>(`/api/songs/${songId}/lyrics/upload`, form(file)),
  clearCache: () => request<{ deleted: number }>("/api/lyrics/cache", { method: "DELETE" }),

  settings: () => request<SettingsDto>("/api/settings"),
  saveSettings: (s: SettingsDto) => request<SettingsDto>("/api/settings", json("PUT", s)),

  songGames: (songId: number) => request<GameSummaryDto[]>(`/api/songs/${songId}/games`),
  createGame: (songId: number, difficulty: string) => request<GameDto>("/api/games", json("POST", { song_id: songId, difficulty })),
  getGame: (publicId: string) => request<GameDto>(`/api/games/${publicId}`),
  answer: (publicId: string, questionId: number, optionId: number) =>
    request<AnswerResultDto>(`/api/games/${publicId}/answers`, json("POST", { question_id: questionId, option_id: optionId })),
};
