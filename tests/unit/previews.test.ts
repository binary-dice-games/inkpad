// @vitest-environment jsdom
// MIT License © 2026 Binary Dice Games
import { describe, expect, it } from 'vitest';
import {
  officeContent,
  textPart,
  wrapParagraphs,
  xmlParagraphs,
  zipParts,
} from '../../viewer/src/previews';
import { makeZip } from '../support/zip';

const docx = (paragraphs: string[]) =>
  `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join('')}</w:body></w:document>`;

/** A File whose content can be read in jsdom (it has no Blob.arrayBuffer). */
function fileOf(name: string, bytes: Uint8Array): File {
  const file = new File([bytes as BlobPart], name);
  return Object.assign(file, { arrayBuffer: async () => bytes.slice().buffer });
}

describe('zip parts', () => {
  it('reads deflated and stored parts', async () => {
    for (const method of [8, 0] as const) {
      const parts = zipParts(
        makeZip({ 'a.txt': 'hello', 'dir/b.xml': '<b/>'.repeat(500) }, method),
      );
      expect([...parts.keys()]).toEqual(['a.txt', 'dir/b.xml']);
      expect(new TextDecoder().decode(await parts.get('a.txt')!())).toBe('hello');
      expect((await parts.get('dir/b.xml')!()).length).toBe(2000);
    }
  });

  it('refuses what is not a zip', () => {
    expect(() => zipParts(new Uint8Array([1, 2, 3, 4]))).toThrow(/zip/);
    expect(() =>
      zipParts(new TextEncoder().encode('just some text, long enough to search in')),
    ).toThrow();
  });
});

describe('text of Office documents', () => {
  it('finds the paragraphs of each kind of file', () => {
    expect(textPart('Plan.DOCX').part).toBe('word/document.xml');
    expect(textPart('b.xlsx').part).toBe('xl/sharedStrings.xml');
    expect(textPart('s.pptx').part).toBe('ppt/slides/slide1.xml');
    expect(textPart('x.odt')).toEqual({ part: 'content.xml', elements: ['p', 'h'] });
    expect(xmlParagraphs(docx(['One', '  ', 'Two &amp; three']), ['p'])).toEqual([
      'One',
      'Two & three',
    ]);
  });

  it('wraps paragraphs into lines of the card and stops at its length', () => {
    expect(wrapParagraphs(['aaa bbb ccc'], 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapParagraphs(['x'.repeat(20)], 8)).toEqual(['xxxxxxxx', 'xxxxxxxx', 'xxxx']);
    expect(
      wrapParagraphs(
        Array.from({ length: 40 }, (_, i) => `line ${i}`),
        38,
        5,
      ),
    ).toHaveLength(5);
  });

  it('shows the first paragraphs of a docx', async () => {
    const zip = makeZip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': docx(['Quarterly report', 'Revenue grew.']),
    });
    expect(await officeContent(fileOf('report.docx', zip))).toEqual({
      lines: ['Quarterly report', 'Revenue grew.'],
    });
  });

  it('shows the first slide of a pptx and the strings of an xlsx', async () => {
    const slide =
      '<p:sld xmlns:p="x" xmlns:a="y"><a:p><a:r><a:t>Kickoff</a:t></a:r></a:p><a:p><a:r><a:t>Goals</a:t></a:r></a:p></p:sld>';
    expect(
      await officeContent(fileOf('deck.pptx', makeZip({ 'ppt/slides/slide1.xml': slide }))),
    ).toEqual({ lines: ['Kickoff', 'Goals'] });
    const strings = '<sst xmlns="z"><si><t>Name</t></si><si><r><t>Total</t></r></si></sst>';
    expect(
      await officeContent(fileOf('sheet.xlsx', makeZip({ 'xl/sharedStrings.xml': strings }))),
    ).toEqual({ lines: ['Name', 'Total'] });
  });

  it('has nothing to show for an empty or unknown document', async () => {
    expect(
      await officeContent(fileOf('empty.docx', makeZip({ 'word/document.xml': docx([]) }))),
    ).toBeNull();
    expect(await officeContent(fileOf('other.docx', makeZip({ 'a.txt': 'x' })))).toBeNull();
    await expect(officeContent(fileOf('bad.docx', new Uint8Array(40)))).rejects.toThrow();
  });
});
