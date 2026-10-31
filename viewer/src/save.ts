// MIT License © 2026 Binary Dice Games
/**
 * @file Saving the board from the viewer and the presenter page: a picture (PNG), a drawing (SVG), or
 * a board file that a later session opens to carry on (a zip of the items, one JSON file per canvas,
 * and the pictures and files on them: see `board-archive.ts`). Both pages share it; each gives the
 * board, the stage and a way to tell the person what happened.
 */
import { letterbox } from '@inksplat/collab-whiteboard';
import type { Whiteboard } from '@inksplat/collab-whiteboard';
import { CANVASES, canvasBackground, cleanCanvasBackground } from '@inksplat/defaults';
import type { CanvasBackground, Stage } from '@inksplat/defaults';
import { readBoardArchive, writeBoardArchive } from './board-archive';
import type { BoardArchive } from './board-archive';
import { BACKGROUND_STYLES } from './sheet';

/** What a page gives the save dialog. */
export interface SaveHost {
  board(): Whiteboard | null;
  stage(): Stage | null;
  /** The video element whose frame goes behind the drawing, if the session has video. */
  video(): HTMLVideoElement | null;
  toast(text: string): void;
  /**
   * Called with the backgrounds of the canvases named in a board file that is opened (the
   * presenter's page only); `undefined` entries leave that canvas as it is.
   */
  backgrounds?(names: (CanvasBackground | undefined)[]): void;
}

/** The largest board file that is read (the files in it are at most 25 MB). */
export const MAX_BOARD_FILE = 48 * 1024 * 1024;

/**
 * The CSS of the sheet's background of canvas `canvas` for a saved picture, or undefined when
 * that canvas shows the screen.
 */
export function exportBackground(
  stage: Stage | null,
  canvas = 0,
): Record<string, string> | undefined {
  const background = canvasBackground(stage, canvas);
  if (background === 'screen') {
    return undefined;
  }
  const style = BACKGROUND_STYLES[background];
  return {
    background: style.background,
    ...(style.blend ? { 'background-blend-mode': style.blend } : {}),
    border: style.border,
    ...(style.shadow ? { 'box-shadow': style.shadow } : {}),
  };
}

/**
 * The current frame of a video as a JPEG data URL, letterboxed on black into a frame of `aspect`
 * (width / height; default the video's own), or null (no frame yet, or the browser refuses).
 */
export function videoFrame(video: HTMLVideoElement | null, aspect?: number): string | null {
  if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
    return null;
  }
  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const a = aspect && aspect > 0 ? aspect : vw / vh;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(Math.max(vw, vh * a));
    canvas.height = Math.round(canvas.width / a);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const r = letterbox(canvas.width, canvas.height, vw / vh);
    g.drawImage(video, r.x, r.y, r.width, r.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch {
    return null;
  }
}

/** A date and time for a file name: `2026-10-30-1530`. */
export function fileStamp(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

/** Offers `blob` to the browser as a download called `name`. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** The board file (a zip) of `board`: its items and files, with the background of every canvas. */
export async function boardArchive(board: Whiteboard, stage: Stage | null): Promise<BoardArchive> {
  const backgrounds = Array.from({ length: CANVASES }, (_, i) => canvasBackground(stage, i));
  return writeBoardArchive(await board.saveBoard({ backgrounds }));
}

/** Saves the board as `kind`; tells the person when it cannot. */
export async function saveAs(kind: 'png' | 'svg' | 'board', host: SaveHost): Promise<void> {
  const board = host.board();
  if (!board) {
    host.toast('There is no board to save yet.');
    return;
  }
  const stage = host.stage();
  const canvas = board.currentPage();
  const sheet = exportBackground(stage, canvas);
  // The screen: its current frame, or black when nothing is shared.
  const frame = sheet ? null : videoFrame(host.video(), stage?.aspect);
  const options = {
    background: sheet ?? (frame ? undefined : { background: '#000' }),
    backdrop: frame ?? undefined,
  };
  const name = `inksplat-board-${fileStamp()}`;
  try {
    if (kind === 'png') {
      download(await board.toPng(options), `${name}.png`);
    } else if (kind === 'svg') {
      download(
        new Blob([board.toSvg(undefined, options)], { type: 'image/svg+xml' }),
        `${name}.svg`,
      );
    } else {
      download((await boardArchive(board, stage)).blob, `${name}.inksplat.zip`);
    }
  } catch (e) {
    host.toast(e instanceof Error ? e.message : 'The board could not be saved.');
  }
}

/**
 * The canvas backgrounds a board file names (`video` of earlier versions read as `screen`).
 * Undefined when it names none.
 */
export function fileBackgrounds(
  meta: Record<string, unknown>,
): (CanvasBackground | undefined)[] | undefined {
  if (!Array.isArray(meta.backgrounds)) {
    return undefined;
  }
  const list = Array.from({ length: CANVASES }, (_, i) =>
    cleanCanvasBackground((meta.backgrounds as unknown[])[i]),
  );
  return list.some((b) => b !== undefined) ? list : undefined;
}

/** Adds the board in `file` (a board zip) to the current one, and says what came of it. */
export async function openBoardFile(file: Blob, host: SaveHost): Promise<void> {
  const board = host.board();
  if (!board) {
    host.toast('Join a session first.');
    return;
  }
  if (file.size > MAX_BOARD_FILE) {
    host.toast('That file is too large to be a board.');
    return;
  }
  try {
    const r = await board.loadBoard(
      await readBoardArchive(new Uint8Array(await file.arrayBuffer())),
    );
    const backgrounds = fileBackgrounds(r.meta);
    if (backgrounds) {
      host.backgrounds?.(backgrounds);
    }
    const files = r.files > 0 ? `, ${r.files} file${r.files === 1 ? '' : 's'}` : '';
    const skipped = r.skipped > 0 ? ` (${r.skipped} left out)` : '';
    host.toast(`Added ${r.added} item${r.added === 1 ? '' : 's'}${files}${skipped}.`);
  } catch (e) {
    host.toast(e instanceof Error ? e.message : 'That file could not be opened.');
  }
}

/** Connects the page's Save… dialog (`#save`) and its Open… button (`#openBoard`, `#openFile`) to `host`. */
export function wireSave(host: SaveHost): void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const dialog = $<HTMLDialogElement>('save');
  $('saveBoard').addEventListener('click', () => dialog.showModal());
  $('closeSave').addEventListener('click', () => dialog.close());
  for (const [id, kind] of [
    ['savePng', 'png'],
    ['saveSvg', 'svg'],
    ['saveFile', 'board'],
  ] as const) {
    $(id).addEventListener('click', () => {
      dialog.close();
      void saveAs(kind, host);
    });
  }
  const input = $<HTMLInputElement>('openFile');
  $('openBoard').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      void openBoardFile(file, host);
    }
  });
}
