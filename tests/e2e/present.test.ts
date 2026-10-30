// MIT License © 2026 Carlos Lopez
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PresenterSite, configure, draw, items } from '../support/presenter-site';
import { makePdf } from '../support/pdf';
import { makeZip } from '../support/zip';

// The static presenter page (spec/06_static_presenter) in Chrome: it starts a session from a
// "screen" (a canvas stream standing in for the picker, which automation cannot drive), a
// viewer joins through the site's viewer page over real WebRTC, video arrives, drawings go
// both ways, and pause, a lost source and the end reach the viewer.

let site: PresenterSite;
beforeAll(async () => {
  site = await PresenterSite.start();
}, 180000);
afterAll(() => site?.close());

const presenterPage = (surface?: string) => site.presenterPage(surface);
const startSharing = (page: Awaited<ReturnType<PresenterSite['presenterPage']>>) =>
  site.startSharing(page);
const joinViewer = (link: string) => site.joinViewer(link);

describe('static presenter page', () => {
  it('is linked from the viewer page and shows the start screen', async () => {
    const page = await presenterPage();
    await expect.poll(() => page.locator('#startShare').isVisible()).toBe(true);
    const ctx = await site.context();
    const landing = await ctx.newPage();
    await landing.goto(`${site.origin}/`);
    await expect
      .poll(() => landing.locator('a[href="present.html"]').count(), { timeout: 10000 })
      .toBe(1);
  });

  it('shares a source: video reaches a viewer, drawings go both ways, pause and end follow', async () => {
    const presenter = await presenterPage();
    const link = await startSharing(presenter);
    expect(link.startsWith(`${site.origin}/#inkpad=`)).toBe(true);
    const viewer = await joinViewer(link);

    // The video arrives, at the source's own size.
    await expect
      .poll(
        () =>
          viewer.evaluate(() => (document.getElementById('video') as HTMLVideoElement).videoWidth),
        { timeout: 30000 },
      )
      .toBe(640);
    await expect.poll(() => presenter.locator('#people').textContent()).toBe('1 viewer');

    // The presenter draws on the host session: the viewer sees it, and the other way round.
    await draw(presenter, [200, 200]);
    await expect.poll(() => items(viewer), { timeout: 15000 }).toBe(1);
    await draw(viewer, [200, 380]);
    await expect.poll(() => items(presenter), { timeout: 15000 }).toBe(2);

    // Viewers can draw: off disables the viewer's pen, on enables it.
    const pen = () => viewer.locator('collab-whiteboard button[aria-label="Pen"]').isDisabled();
    await presenter.bringToFront();
    await presenter.locator('#drawing').uncheck();
    await expect.poll(pen, { timeout: 10000 }).toBe(true);
    await presenter.locator('#drawing').check();
    await expect.poll(pen, { timeout: 10000 }).toBe(false);

    // Pause shows on the viewer; resume brings the video back.
    await presenter.locator('#pause').click();
    await expect.poll(() => viewer.locator('#notice').textContent()).toMatch(/paused/);
    await presenter.locator('#pause').click();
    await expect.poll(() => viewer.locator('#notice').textContent()).toBe('');

    // Clear removes the drawings everywhere.
    presenter.once('dialog', (d) => void d.accept());
    await presenter.locator('#clear').click();
    await expect.poll(() => items(viewer), { timeout: 15000 }).toBe(0);
    await expect.poll(() => items(presenter), { timeout: 15000 }).toBe(0);

    // The user stops sharing in the browser: the session stays, paused, with a way back.
    await presenter.evaluate(() =>
      (window as unknown as { shared: MediaStreamTrack }).shared.dispatchEvent(new Event('ended')),
    );
    await expect.poll(() => presenter.locator('#warning').textContent()).toMatch(/Sharing stopped/);
    await expect.poll(() => viewer.locator('#notice').textContent()).toMatch(/paused/);

    // End: the viewer is told, the presenter sees the end screen.
    presenter.once('dialog', (d) => void d.accept());
    await presenter.locator('#end').click();
    await presenter.locator('#over').waitFor({ state: 'visible' });
    await expect.poll(() => viewer.locator('#notice').textContent()).toMatch(/ended/);
    await expect.poll(() => viewer.locator('#wait').isVisible()).toBe(true);
  });

  it('starts a board without video: backgrounds, files pinned with previews, copies dragged out', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);
    const viewer = await joinViewer(link);
    await viewer.locator('#app').waitFor({ state: 'visible', timeout: 30000 });

    // A sheet instead of the video, and nothing to wait for.
    await expect.poll(() => viewer.locator('#page').isVisible(), { timeout: 15000 }).toBe(true);
    expect(await viewer.locator('#video').isVisible()).toBe(false);
    expect(await viewer.locator('#notice').textContent()).toBe('');
    expect(await presenter.locator('#pause').isVisible()).toBe(false);

    // The presenter changes the background for everyone.
    const frame = (page: typeof viewer) =>
      page.locator('#page').evaluate((e) => getComputedStyle(e).borderTopColor);
    await expect.poll(() => frame(viewer)).toBe('rgb(185, 190, 198)');
    await presenter.locator('#background').selectOption('cork');
    await expect.poll(() => frame(viewer), { timeout: 15000 }).toBe('rgb(138, 96, 56)');
    await expect.poll(() => frame(presenter)).toBe('rgb(138, 96, 56)');

    // Files dropped on the presenter's board: a text file, a real picture, a binary one.
    await presenter.evaluate(async () => {
      const png = await new Promise<Blob>((resolve) => {
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 80;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#3e63dd';
        ctx.fillRect(0, 0, 120, 80);
        canvas.toBlob((b) => resolve(b!), 'image/png');
      });
      const dt = new DataTransfer();
      dt.items.add(new File(['hello board'], 'notes.txt', { type: 'text/plain' }));
      dt.items.add(new File([png], 'blue.png', { type: 'image/png' }));
      dt.items.add(new File([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], 'bundle.zip'));
      document.getElementById('stage')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: 300,
          clientY: 200,
        }),
      );
    });
    const pinned = (page: typeof viewer) =>
      page.locator('collab-whiteboard .item.image-item').count();
    await expect.poll(() => pinned(presenter), { timeout: 15000 }).toBe(3);
    await expect.poll(() => pinned(viewer), { timeout: 15000 }).toBe(3);

    // Each has a preview picture, a shadow and a pin.
    const hrefs = await viewer
      .locator('collab-whiteboard .item.image-item image')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')?.slice(0, 22)));
    expect(hrefs.every((h) => h?.startsWith('data:image/'))).toBe(true);
    expect(await viewer.locator('collab-whiteboard .item.image-item circle').count()).toBe(6);
    expect(await viewer.locator('collab-whiteboard .item.image-item g[filter]').count()).toBe(3);

    // The viewer drags a copy of the text file out: once it has arrived, the drag carries it.
    const dragOut = (name: string) =>
      viewer.evaluate(async (title) => {
        const proxy = [
          ...document
            .querySelector('collab-whiteboard')!
            .shadowRoot!.querySelectorAll<HTMLElement>('.proxy'),
        ].find((p) => p.title.startsWith(title))!;
        const dt = new DataTransfer();
        const ev = new DragEvent('dragstart', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
        });
        proxy.dispatchEvent(ev);
        const file = dt.files[0];
        return {
          refused: ev.defaultPrevented,
          name: file?.name,
          text: file?.type === 'text/plain' ? await file.text() : undefined,
          size: file?.size,
          url: dt.getData('DownloadURL').slice(0, 30),
        };
      }, name);
    await expect
      .poll(async () => (await dragOut('notes.txt')).refused, { timeout: 15000 })
      .toBe(false);
    expect(await dragOut('notes.txt')).toMatchObject({
      name: 'notes.txt',
      text: 'hello board',
      url: 'text/plain:notes.txt:blob:http',
    });
    await expect.poll(async () => (await dragOut('bundle.zip')).size, { timeout: 15000 }).toBe(7);

    // A file over the limit that is not a picture is refused with a message.
    await presenter.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(6 * 1024 * 1024)], 'huge.zip'));
      document.getElementById('stage')!.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    await expect.poll(() => presenter.locator('#toast').textContent()).toMatch(/too large/);
    expect(await pinned(presenter)).toBe(3);
  });

  it('previews a PDF and an Office file with their content, and gives the link as a QR code', async () => {
    const presenter = await presenterPage();
    const link = await site.startBoard(presenter);

    // The QR code of the link, for a camera.
    await presenter.locator('#showQr').click();
    await presenter.locator('#qr').waitFor({ state: 'visible' });
    expect(await presenter.locator('#qrCode svg path').count()).toBe(1);
    expect(await presenter.locator('#qrLink').textContent()).toBe(link);
    await presenter.locator('#closeQr').click();
    await expect.poll(() => presenter.locator('#qr').isVisible()).toBe(false);

    // A PDF and a docx dropped on the board show their content, not just the type.
    const docx = makeZip({
      'word/document.xml':
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Quarterly report: revenue grew and costs fell this year</w:t></w:r></w:p></w:body></w:document>',
    });
    await presenter.evaluate(
      async ([pdf, office]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(pdf!)], 'plan.pdf', { type: 'application/pdf' }));
        dt.items.add(new File([new Uint8Array(office!)], 'report.docx'));
        document.getElementById('stage')!.dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: dt,
            bubbles: true,
            cancelable: true,
            clientX: 300,
            clientY: 200,
          }),
        );
      },
      [[...makePdf()], [...docx]],
    );
    const pinned = presenter.locator('collab-whiteboard .item.image-item image');
    await expect.poll(() => pinned.count(), { timeout: 30000 }).toBe(2);

    // Dark pixels in the content area of each card: a plain card only has light grey bars.
    const dark = (index: number) =>
      pinned.nth(index).evaluate(async (node) => {
        const img = new Image();
        img.src = node.getAttribute('href')!;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const px = g.getImageData(20, 80, 280, 205).data;
        let n = 0;
        for (let i = 0; i < px.length; i += 4) {
          if ((px[i]! + px[i + 1]! + px[i + 2]!) / 3 < 100) n++;
        }
        return n;
      });
    expect(await dark(0)).toBeGreaterThan(3000); // the black bar of the page
    expect(await dark(1)).toBeGreaterThan(100); // the first lines of the document
  });

  it('hides the pointer when asked, and remembers the settings', async () => {
    const presenter = await presenterPage();
    await configure(presenter, 'never');
    await expect.poll(() => presenter.locator('#summary').textContent()).toMatch(/Pat.*hidden/);
    await presenter.locator('#startShare').click();
    await presenter.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    const asked = await presenter.evaluate(
      () => (window as unknown as { asked: { video: { cursor?: string } } }).asked,
    );
    expect(asked.video.cursor).toBe('never');
    // Stored: a reload shows them again.
    await presenter.reload();
    await expect.poll(() => presenter.locator('#summary').textContent()).toMatch(/Pat.*hidden/);
  });

  it('applies video settings to a running share', async () => {
    const presenter = await presenterPage();
    await startSharing(presenter);
    await presenter.locator('#settingsLive').click();
    await presenter.locator('#tab-video').click();
    await presenter.locator('#fps').fill('5');
    await presenter.locator('#settingsForm button[type=submit]').click();
    await expect.poll(() => presenter.locator('#toast').textContent()).toMatch(/Saved/);
    await presenter.locator('#settingsLive').click();
    await presenter.locator('#tab-video').click();
    expect(await presenter.locator('#fps').inputValue()).toBe('5');
  });

  it('folds the controls and the tools away so they do not hide the view', async () => {
    const presenter = await presenterPage();
    await startSharing(presenter);
    const toolbar = presenter.locator('collab-whiteboard .toolbar');
    await expect.poll(() => toolbar.isVisible()).toBe(true);
    await expect.poll(() => presenter.locator('#panel').isVisible()).toBe(true);

    await presenter.locator('#toolsToggle').click();
    await expect.poll(() => toolbar.isVisible()).toBe(false);
    await presenter.locator('#panelToggle').click();
    await expect.poll(() => presenter.locator('#panel').isVisible()).toBe(false);

    // Remembered across a reload (the next session starts folded).
    await presenter.reload();
    await presenter.locator('#startShare').click();
    await presenter.locator('#app').waitFor({ state: 'visible', timeout: 30000 });
    await expect.poll(() => presenter.locator('#panel').isVisible()).toBe(false);
    await expect.poll(() => toolbar.isVisible()).toBe(false);

    // Back again.
    await presenter.locator('#toolsToggle').click();
    await expect.poll(() => toolbar.isVisible()).toBe(true);
  });

  it('lays the settings out in tabs that fit without scrolling', async () => {
    const presenter = await presenterPage();
    await presenter.setViewportSize({ width: 1280, height: 720 });
    await presenter.locator('#openSettings').click();
    const overflow = () =>
      presenter.locator('#settings').evaluate((d) => d.scrollHeight - d.clientHeight);
    for (const tab of ['general', 'video', 'connection']) {
      await presenter.locator(`#tab-${tab}`).click();
      await expect.poll(() => presenter.locator(`#pane-${tab}`).isVisible()).toBe(true);
      expect(await overflow(), tab).toBeLessThanOrEqual(0);
    }
    // Only the chosen section shows, and the arrow keys move between them.
    expect(await presenter.locator('#pane-general').isVisible()).toBe(false);
    await presenter.locator('#tab-connection').focus();
    await presenter.keyboard.press('ArrowRight');
    await expect.poll(() => presenter.locator('#pane-general').isVisible()).toBe(true);
    // Reopening starts on the first section; a phone-sized window still fits.
    await presenter.locator('#closeSettings').click();
    await presenter.setViewportSize({ width: 390, height: 700 });
    await presenter.locator('#openSettings').click();
    await expect.poll(() => presenter.locator('#pane-general').isVisible()).toBe(true);
    await presenter.locator('#tab-video').click();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  it('warns when a whole screen is shared', async () => {
    const presenter = await presenterPage('monitor');
    await startSharing(presenter);
    await expect.poll(() => presenter.locator('#warning').textContent()).toMatch(/whole screen/);
  });

  it('shows why when sharing is refused', async () => {
    const ctx = await site.context();
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = () =>
        Promise.reject(new DOMException('no', 'NotAllowedError'));
    });
    await page.goto(`${site.origin}/present.html`);
    await page.locator('#startShare').click();
    await expect.poll(() => page.locator('#startProblem').textContent()).toMatch(/cancelled/);
    expect(await page.locator('#app').isVisible()).toBe(false);
  });
});
