// MIT License © 2026 Carlos Lopez
/**
 * @file QR code of the viewer link, so a phone or tablet can join by pointing its camera at the
 * presenter's screen. The encoding is done by `qrcode-generator`; this file draws it.
 */
import qrcode from 'qrcode-generator';

/** Modules of white around the code that scanners need. */
const QUIET = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The modules of the QR code of `text` (true: dark), error correction level M.
 * @throws {Error} when the text is too long for a QR code
 */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** The code as an SVG on white, with its quiet zone: black on white whatever the page's theme. */
export function qrSvg(modules: boolean[][]): SVGSVGElement {
  const size = modules.length + 2 * QUIET;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const back = document.createElementNS(SVG_NS, 'rect');
  back.setAttribute('width', String(size));
  back.setAttribute('height', String(size));
  back.setAttribute('fill', '#ffffff');
  const path = document.createElementNS(SVG_NS, 'path');
  let d = '';
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) {
        d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
      }
    }),
  );
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000000');
  svg.append(back, path);
  return svg;
}

/** The code as a PNG about `pixels` wide (a whole number of pixels per module), for the clipboard. */
export function qrPng(modules: boolean[][], pixels = 512): Promise<Blob> {
  const size = modules.length + 2 * QUIET;
  const scale = Math.max(1, Math.floor(pixels / size));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) {
        ctx.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale);
      }
    }),
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'),
  );
}
