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

/** A tiling SVG image from `body` (SVG elements, with their filters in `defs`). */
function tile(defs: string, body: string, size: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<defs>${defs}</defs>${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Relief of a rough surface: fractal noise lit from the upper left, as light and shade to
 * multiply over a colour (`frequency` is the size of the grain, `depth` how rough it is).
 */
function relief(frequency: number, depth: number, seed: number, size = 300): string {
  const defs =
    `<filter id='r' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='4' seed='${seed}' stitchTiles='stitch' result='t'/>` +
    `<feDiffuseLighting in='t' lighting-color='#ffffff' surfaceScale='${depth}' diffuseConstant='1.15'>` +
    `<feDistantLight azimuth='225' elevation='58'/></feDiffuseLighting></filter>`;
  return tile(defs, `<rect width='100%' height='100%' filter='url(#r)'/>`, size);
}

/**
 * Specks scattered over a surface: noise cut at a threshold, so only its peaks remain, in the
 * colour `rgb`. A lower `cut` (0 to 1) leaves more of them.
 */
function specks(
  rgb: [number, number, number],
  frequency: number,
  cut: number,
  opacity: number,
  seed: number,
  size = 300,
): string {
  const [r, g, b] = rgb.map((c) => c / 255);
  const steps = Array.from({ length: 12 }, (_, i) => (i / 11 >= cut ? opacity : 0)).join(' ');
  const defs =
    `<filter id='s' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='2' seed='${seed}' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 1 0 0 0 0'/>` +
    `<feComponentTransfer><feFuncA type='discrete' tableValues='${steps}'/></feComponentTransfer>` +
    `</filter>`;
  return tile(defs, `<rect width='100%' height='100%' filter='url(#s)'/>`, size);
}

/** The CSS of each background (`background` and the frame around the sheet). */
export const BACKGROUND_STYLES: Readonly<
  Record<
    Background,
    { background: string; border: string; label: string; blend?: string; shadow?: string }
  >
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
    // Painted plaster: a rough surface lit from one side, soft patches of paint, light falling off
    // towards the corners.
    label: 'Wall',
    background: `radial-gradient(ellipse at 50% 35%, rgba(255,255,255,0) 45%, rgba(90,70,50,0.28) 130%), ${grain([150, 130, 100], 0.22, 0.006, 500)}, ${relief(0.55, 1.8, 7)}, #f1e7d3`,
    blend: 'normal, normal, multiply, normal',
    border: '0 none',
    shadow: 'inset 0 0 60px rgba(60,40,20,0.35)',
  },
  cork: {
    // Cork: a granular surface in light and dark brown, a few lighter and darker flecks, and a wooden frame.
    label: 'Cork board',
    background: `${specks([70, 42, 20], 0.22, 0.72, 0.75, 11)}, ${specks([214, 176, 126], 0.16, 0.8, 0.5, 5)}, ${grain([100, 70, 40], 0.55, 0.01, 500)}, ${relief(0.3, 2.2, 3)}, #bd9467`,
    blend: 'normal, normal, normal, multiply, normal',
    border: '16px solid #8b5e34',
    shadow: 'inset 0 0 22px rgba(40,20,0,0.55)',
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
    backgroundBlendMode: style.blend ?? '',
    boxShadow: style.shadow ?? '',
    border: style.border,
    boxSizing: 'border-box',
  });
}
