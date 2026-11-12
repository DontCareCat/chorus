import { QueuePanel } from "./QueuePanel";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";

/** The queue list with its own data (the songs and the player's games), for the bar and for the in-game player. */
export function QueueDialog({ phone, onClose, onSkip }: { phone: boolean; onClose: () => void; onSkip?: () => void }) {
  const songs = useAsync(() => api.songs(), []);
  const games = useAsync(() => api.myGames(), []);
  return <QueuePanel songs={songs.data ?? []} games={games.data ?? []} phone={phone} onClose={onClose} onSkip={onSkip} />;
}
