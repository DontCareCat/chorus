import { Cover } from "./Cover";
import { useSpin } from "../hooks/useSpin";

interface Props {
  songId: number;
  title: string;
  hasCover: boolean | null;
  /** the music is running: the record turns; otherwise it slows to a stop where it is */
  spinning: boolean;
}

/** The album art as the label of a record that turns while the song plays (design guide section 23). */
export function Vinyl({ songId, title, hasCover, spinning }: Props) {
  const turn = useSpin(spinning);
  return (
    <div className="vinyl" data-spinning={spinning} aria-hidden="true">
      <div className="vinyl-disc" ref={turn}>
        <svg viewBox="0 0 200 200" focusable="false">
          <defs>
            <radialGradient id="vinyl-body" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#2c2b25" /><stop offset=".55" stopColor="#181711" /><stop offset="1" stopColor="#0d0c09" /></radialGradient>
            <linearGradient id="vinyl-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".24" /><stop offset=".65" stopColor="#fff" stopOpacity="0" /></linearGradient>
          </defs>
          <circle cx="100" cy="100" r="96" fill="url(#vinyl-body)" />
          <circle cx="100" cy="100" r="93" fill="none" stroke="#fff" strokeOpacity=".1" />
          <g fill="none" stroke="#fff" strokeOpacity=".055" strokeWidth=".7">
            {Array.from({ length: 13 }, (_, i) => <circle key={i} cx="100" cy="100" r={42 + i * 4} />)}
          </g>
          <circle cx="100" cy="100" r="64" fill="none" stroke="#fff" strokeOpacity=".07" strokeWidth="5" />
          <circle cx="100" cy="100" r="84" fill="none" stroke="#fff" strokeOpacity=".05" strokeWidth="3" />
          <path d="M100 100 L100 4 A96 96 0 0 1 168 32 Z" fill="url(#vinyl-sheen)" />
          <path d="M100 100 L100 196 A96 96 0 0 1 32 168 Z" fill="url(#vinyl-sheen)" />
        </svg>
        <div className="vinyl-label"><Cover songId={songId} title={title} hasCover={hasCover} size="label" /></div>
      </div>
    </div>
  );
}
