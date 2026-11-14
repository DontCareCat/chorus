// Material Symbols Outlined (weight 400, optical size 24), Apache-2.0, from the @material-symbols/svg-400 package.
import pauseCircle from "@material-symbols/svg-400/outlined/pause_circle-fill.svg?raw";
import playCircle from "@material-symbols/svg-400/outlined/play_circle-fill.svg?raw";
import replay5 from "@material-symbols/svg-400/outlined/replay_5.svg?raw";
import downloadIcon from "@material-symbols/svg-400/outlined/download.svg?raw";
import redoIcon from "@material-symbols/svg-400/outlined/redo.svg?raw";
import replayIcon from "@material-symbols/svg-400/outlined/replay.svg?raw";
import infoIcon from "@material-symbols/svg-400/outlined/info.svg?raw";
import swapHoriz from "@material-symbols/svg-400/outlined/swap_horiz.svg?raw";
import historyIcon from "@material-symbols/svg-400/outlined/history.svg?raw";
import lowPriority from "@material-symbols/svg-400/outlined/low_priority.svg?raw";
import playArrow from "@material-symbols/svg-400/outlined/play_arrow-fill.svg?raw";
import pauseBars from "@material-symbols/svg-400/outlined/pause-fill.svg?raw";
import stop from "@material-symbols/svg-400/outlined/stop.svg?raw";
import volumeDown from "@material-symbols/svg-400/outlined/volume_down.svg?raw";
import volumeMute from "@material-symbols/svg-400/outlined/volume_mute.svg?raw";
import volumeOff from "@material-symbols/svg-400/outlined/volume_off.svg?raw";
import volumeUp from "@material-symbols/svg-400/outlined/volume_up.svg?raw";
import check from "@material-symbols/svg-400/outlined/check.svg?raw";
import close from "@material-symbols/svg-400/outlined/close.svg?raw";
import deleteIcon from "@material-symbols/svg-400/outlined/delete.svg?raw";
import edit from "@material-symbols/svg-400/outlined/edit.svg?raw";
import image from "@material-symbols/svg-400/outlined/image.svg?raw";
import language from "@material-symbols/svg-400/outlined/language.svg?raw";
import moreVert from "@material-symbols/svg-400/outlined/more_vert.svg?raw";
import progress from "@material-symbols/svg-400/outlined/progress_activity.svg?raw";
import schedule from "@material-symbols/svg-400/outlined/schedule.svg?raw";
import search from "@material-symbols/svg-400/outlined/search.svg?raw";
import warning from "@material-symbols/svg-400/outlined/warning-fill.svg?raw";
import arrowUp from "@material-symbols/svg-400/outlined/arrow_upward.svg?raw";
import shuffle from "@material-symbols/svg-400/outlined/shuffle.svg?raw";
import playlistAdd from "@material-symbols/svg-400/outlined/playlist_add.svg?raw";
import queue from "@material-symbols/svg-400/outlined/queue_music.svg?raw";
import arrowBack from "@material-symbols/svg-400/outlined/arrow_back.svg?raw";
import skipNext from "@material-symbols/svg-400/outlined/skip_next.svg?raw";
import grip from "@material-symbols/svg-400/outlined/drag_indicator.svg?raw";
import add from "@material-symbols/svg-400/outlined/add.svg?raw";
import sortIcon from "@material-symbols/svg-400/outlined/sort.svg?raw";
import tune from "@material-symbols/svg-400/outlined/tune.svg?raw";
import home from "@material-symbols/svg-400/outlined/home.svg?raw";
import menuBook from "@material-symbols/svg-400/outlined/menu_book.svg?raw";
import leaderboard from "@material-symbols/svg-400/outlined/leaderboard.svg?raw";
import undo from "@material-symbols/svg-400/outlined/undo.svg?raw";
import chevronRight from "@material-symbols/svg-400/outlined/chevron_right.svg?raw";
import uploadFile from "@material-symbols/svg-400/outlined/upload_file.svg?raw";
import folderOpen from "@material-symbols/svg-400/outlined/folder_open.svg?raw";
import linkIcon from "@material-symbols/svg-400/outlined/link.svg?raw";
import radar from "@material-symbols/svg-400/outlined/radar.svg?raw";
import lyricsIcon from "@material-symbols/svg-400/outlined/lyrics.svg?raw";
import libraryMusic from "@material-symbols/svg-400/outlined/library_music.svg?raw";
import contentPaste from "@material-symbols/svg-400/outlined/content_paste.svg?raw";

const pathOf = (svg: string): string => /<path d="([^"]+)"/.exec(svg)?.[1] ?? "";

const PATHS = {
  play: pathOf(playCircle),
  pause: pathOf(pauseCircle),
  playArrow: pathOf(playArrow), // the bare glyphs inside PlayButton's disc
  pauseBars: pathOf(pauseBars),
  stop: pathOf(stop),
  rewind5: pathOf(replay5),
  volumeUp: pathOf(volumeUp),
  volumeDown: pathOf(volumeDown),
  volumeMute: pathOf(volumeMute),
  volumeOff: pathOf(volumeOff),
  check: pathOf(check),
  close: pathOf(close),
  trash: pathOf(deleteIcon),
  edit: pathOf(edit),
  image: pathOf(image),
  language: pathOf(language),
  more: pathOf(moreVert),
  spinner: pathOf(progress),
  home: pathOf(home),
  menuBook: pathOf(menuBook),
  leaderboard: pathOf(leaderboard),
  clock: pathOf(schedule),
  search: pathOf(search),
  warning: pathOf(warning),
  arrowUp: pathOf(arrowUp),
  arrowBack: pathOf(arrowBack),
  shuffle: pathOf(shuffle),
  playlistAdd: pathOf(playlistAdd),
  queue: pathOf(queue),
  skipNext: pathOf(skipNext),
  grip: pathOf(grip),
  add: pathOf(add),
  sortIcon: pathOf(sortIcon),
  tune: pathOf(tune),
  undo: pathOf(undo),
  paste: pathOf(contentPaste),
  chevronRight: pathOf(chevronRight),
  uploadFile: pathOf(uploadFile),
  folder: pathOf(folderOpen),
  link: pathOf(linkIcon),
  radar: pathOf(radar),
  lyrics: pathOf(lyricsIcon),
  libraryMusic: pathOf(libraryMusic),
  download: pathOf(downloadIcon),
  redo: pathOf(redoIcon),
  replay: pathOf(replayIcon),
  info: pathOf(infoIcon),
  moveAll: pathOf(swapHoriz),
  restore: pathOf(historyIcon),
  ripple: pathOf(lowPriority),
} as const;

export type IconName = keyof typeof PATHS;

/** Inline SVG icon that takes the text colour and scales with the font size. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 -960 960 960" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
