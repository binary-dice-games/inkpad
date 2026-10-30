// MIT License © 2026 Carlos Lopez
/**
 * @file The board of a session without video: a sheet in the shape of the shared frame, with one
 * of a few backgrounds (whiteboard, blackboard, wall, cork), for the viewer and the presenter
 * page. The backgrounds are drawn with CSS and inline SVG, so there are no image files.
 */
import { letterbox } from '@inkpad/collab-whiteboard';
import { DEFAULT_BACKGROUND } from '@inkpad/defaults';
import type { Background, Stage } from '@inkpad/defaults';

/** Noise as a tiling SVG image: `rgb` is the colour of the grain, `alpha` how strong it is. */
function grain(
  rgb: [number, number, number],
  alpha: number,
  frequency: number,
  size = 240,
): string {
  const [r, g, b] = rgb.map((c) => c / 255);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<filter id='n' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 ${alpha * 2.2} ${-alpha * 0.6}'/>` +
    `</filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The CSS of each background (`background` and the frame around the sheet). */
export const BACKGROUND_STYLES: Readonly<
  Record<Background, { background: string; border: string; label: string }>
> = {
  whiteboard: {
    label: 'Whiteboard',
    background: `linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 40%, rgba(200,210,220,0.25) 100%), ${grain([120, 130, 140], 0.05, 0.9)}, #f6f7f8`,
    border: '10px solid #b9bec6',
  },
  blackboard: {
    label: 'Blackboard',
    background: `radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.1), rgba(255,255,255,0) 55%), radial-gradient(ellipse at 75% 80%, rgba(255,255,255,0.06), rgba(255,255,255,0) 50%), ${grain([255, 255, 255], 0.07, 0.6)}, #2f3d36`,
    border: '14px solid #7a5230',
  },
  wall: {
    label: 'Wall',
    background: `${grain([90, 70, 50], 0.25, 0.04, 400)}, ${grain([110, 90, 70], 0.3, 0.7)}, #d8cdbb`,
    border: '0 none',
  },
  cork: {
    label: 'Cork board',
    background: `${grain([70, 40, 15], 0.55, 0.45)}, ${grain([230, 190, 130], 0.35, 0.08, 300)}, #c49a64`,
    border: '14px solid #8a6038',
  },
};

/**
 * Shows the stage as a video or as a sheet: with `stage.video === false` the `video` is hidden
 * and `page` is laid out as the largest sheet of the stage's aspect that fits in `box`, with the
 * stage's background; otherwise the sheet is hidden.
 *
 * @param aspect the width / height of the frame, as the board uses it
 */
export function showSheet(
  elements: { video: HTMLElement; page: HTMLElement; box: HTMLElement },
  stage: Stage | null,
  aspect: number,
): void {
  const { video, page, box } = elements;
  const sheet = stage?.video === false;
  video.hidden = sheet;
  page.hidden = !sheet;
  if (!sheet) {
    return;
  }
  const style = BACKGROUND_STYLES[stage?.background ?? DEFAULT_BACKGROUND];
  const r = letterbox(box.clientWidth, box.clientHeight, aspect);
  Object.assign(page.style, {
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    background: style.background,
    border: style.border,
    boxSizing: 'border-box',
  });
}
