// MIT License © 2026 Binary Dice Games
/**
 * @file Previews of documents for the board: the first page of a PDF (with pdf.js, loaded only when
 * a PDF is dropped) and the thumbnail or first paragraphs of an Office or OpenDocument file (a zip
 * of XML, read here without a library). The board shows them on the card of the file.
 */
import type { FilePreview } from '@inksplat/collab-whiteboard';
import { zipParts } from './zip';

type Content = NonNullable<Awaited<ReturnType<FilePreview>>>;

/** The most a preview may take: a document that needs longer is shown as a plain card. */
const PREVIEW_MS = 10_000;
function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PREVIEW_MS)),
  ]);
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/** The parts of pdf.js used here. */
interface PdfLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: object): {
    promise: Promise<{
      getPage(n: number): Promise<{
        getViewport(o: { scale: number }): { width: number; height: number };
        render(o: object): { promise: Promise<void> };
      }>;
    }>;
    destroy(): Promise<void>;
  };
}

let pdfLib: Promise<PdfLib | null> | undefined;

/** pdf.js, from the files next to the page (`pdf.min.mjs` and its worker); null if they are missing. */
function loadPdf(): Promise<PdfLib | null> {
  pdfLib ??= import(/* @vite-ignore */ new URL('pdf.min.mjs', document.baseURI).href)
    .then((lib: PdfLib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href;
      return lib;
    })
    .catch(() => {
      pdfLib = undefined; // offline once: try again next time
      return null;
    });
  return pdfLib;
}

/** The first page of a PDF as a canvas, or null (damaged, protected, or pdf.js is missing). */
async function pdfContent(file: File): Promise<Content | null> {
  const lib = await loadPdf();
  if (!lib) {
    return null;
  }
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false, // the pages allow no eval
    useSystemFonts: true,
    verbosity: 0,
  });
  try {
    const page = await withTimeout(
      task.promise.then(async (doc) => {
        const first = await doc.getPage(1);
        const base = first.getViewport({ scale: 1 });
        const viewport = first.getViewport({ scale: Math.min(4, 560 / Math.max(1, base.width)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await first.render({ canvasContext: ctx, canvas, viewport }).promise;
        return canvas;
      }),
    );
    return page ? { image: page } : null;
  } catch {
    return null;
  } finally {
    void task.destroy().catch(() => {});
  }
}

// ── Zip (Office and OpenDocument files) ──────────────────────────────────────

export { zipParts };

const THUMBNAILS: [string, string][] = [
  ['docProps/thumbnail.jpeg', 'image/jpeg'],
  ['docProps/thumbnail.jpg', 'image/jpeg'],
  ['docProps/thumbnail.png', 'image/png'],
  ['Thumbnails/thumbnail.png', 'image/png'],
];

/** Where the text is, by kind of file, and which elements are its paragraphs. */
export function textPart(name: string): { part: string; elements: string[] } {
  if (/\.(docx|dotx)$/i.test(name)) {
    return { part: 'word/document.xml', elements: ['p'] };
  }
  if (/\.(xlsx|xltx)$/i.test(name)) {
    return { part: 'xl/sharedStrings.xml', elements: ['si'] };
  }
  if (/\.(pptx|potx)$/i.test(name)) {
    return { part: 'ppt/slides/slide1.xml', elements: ['p'] };
  }
  return { part: 'content.xml', elements: ['p', 'h'] };
}

/** `paragraphs` broken into lines of at most `width` characters, at most `max` lines. */
export function wrapParagraphs(paragraphs: string[], width = 38, max = 14): string[] {
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      let rest = word;
      while (rest.length > width) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (line && line.length + 1 + rest.length > width) {
        lines.push(line);
        line = rest;
      } else {
        line = line ? `${line} ${rest}` : rest;
      }
    }
    if (line) {
      lines.push(line);
    }
    if (lines.length >= max) {
      break;
    }
  }
  return lines.slice(0, max);
}

/** The paragraphs of an XML part of a document, in order. */
export function xmlParagraphs(xml: string, elements: string[], max = 40): string[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out: string[] = [];
  for (const el of Array.from(doc.getElementsByTagNameNS('*', '*'))) {
    if (elements.includes(el.localName)) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) {
        out.push(text);
      }
    }
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

/** The thumbnail saved in an Office or OpenDocument file, else its first paragraphs. */
export async function officeContent(file: File): Promise<Content | null> {
  const parts = zipParts(new Uint8Array(await file.arrayBuffer()));
  for (const [name, type] of THUMBNAILS) {
    const unpack = parts.get(name);
    if (unpack) {
      try {
        const image = await createImageBitmap(new Blob([(await unpack()) as BlobPart], { type }));
        return { image };
      } catch {
        // not a picture the browser reads: look at the text
      }
    }
  }
  const { part, elements } = textPart(file.name);
  const unpack = parts.get(part);
  if (!unpack) {
    return null;
  }
  const lines = wrapParagraphs(xmlParagraphs(new TextDecoder().decode(await unpack()), elements));
  return lines.length > 0 ? { lines } : null;
}

const OFFICE = /\.(docx|dotx|xlsx|xltx|pptx|potx|odt|ott|ods|odp)$/i;

/** The previews of PDF and Office files; other files have none. */
export const filePreview: FilePreview = async (file) => {
  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      return await pdfContent(file);
    }
    if (OFFICE.test(file.name)) {
      return await withTimeout(officeContent(file));
    }
  } catch {
    // damaged: the card is shown without content
  }
  return null;
};
