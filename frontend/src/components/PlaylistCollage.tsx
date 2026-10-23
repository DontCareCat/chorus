import { Cover } from "./Cover";
import type { PlaylistDto } from "../services/api";

/** The first four covers of a playlist as one tile (one cover for a single song, a plain tile when empty). */
export function PlaylistCollage({ covers, size = "row" }: { covers: PlaylistDto["covers"]; size?: "row" | "large" }) {
  const n = covers.length === 0 ? 0 : covers.length === 1 ? 1 : 4;
  return (
    <div className="collage" data-size={size} data-n={n} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => covers[i] ? <Cover key={covers[i]!.id} songId={covers[i]!.id} title={covers[i]!.title} hasCover={covers[i]!.has_cover} size="row" /> : <span key={`e${i}`} className="cover" data-empty="true" />)}
    </div>
  );
}
