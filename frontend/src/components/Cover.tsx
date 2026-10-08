import { useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../services/api";

interface Props {
  songId: number;
  title: string;
  /** null = not checked yet (the request itself finds out); false = known to have none */
  hasCover: boolean | null;
  size?: "small" | "large" | "xl";
}

/** Embedded album art; without it a tile with the title's first letter and a hue that is stable per song. */
export function Cover({ songId, title, hasCover, size = "small" }: Props) {
  const [failed, setFailed] = useState(false);
  const show = hasCover !== false && !failed;
  const style = { "--hue": (songId * 47) % 360 } as CSSProperties;
  return (
    <div className="cover" data-size={size} data-empty={!show} style={style} aria-hidden={!show}>
      {show ? <img src={api.coverUrl(songId)} alt="" loading="lazy" onError={() => setFailed(true)} /> : Array.from(title.trim())[0]?.toUpperCase() ?? "♪"}
    </div>
  );
}
