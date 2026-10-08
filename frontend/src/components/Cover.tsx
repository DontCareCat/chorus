import { useState } from "react";
import { api } from "../services/api";

interface Props {
  songId: number;
  /** null = not checked yet (the request itself finds out); false = known to have none */
  hasCover: boolean | null;
  size?: "small" | "large";
}

/** Embedded album art; an empty square of the same size keeps rows aligned when there is none. */
export function Cover({ songId, hasCover, size = "small" }: Props) {
  const [failed, setFailed] = useState(false);
  const show = hasCover !== false && !failed;
  return (
    <div className="cover" data-size={size} data-empty={!show} aria-hidden={!show}>
      {show && <img src={api.coverUrl(songId)} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </div>
  );
}
