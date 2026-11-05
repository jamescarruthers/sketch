// Save as SVG, multi-layer DXF and Print 1:1, through the real menus. Downloads and the PDF are parsed back.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { SketchUser, type Xy } from './helpers';
import { parseDxfCounts, parseDxfEntities, parseDxfLayers } from '../src/io/dxf-parse';

const start = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  return u;
};

const exitTool = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

async function line(u: SketchUser, a: Xy, b: Xy): Promise<void> {
  await u.press('l');
  await u.click(a);
  await u.click(b);
  await exitTool(u);
}

async function addLayer(u: SketchUser, name: string, color: string): Promise<void> {
  await u.page.locator('[data-action="add-layer"]').click();
  await u.settle();
  const added = u.page.locator('.layer-row.active');
  await added.locator('.layer-name').dblclick();
  await added.locator('.layer-rename').fill(name);
  await u.page.keyboard.press('Enter');
  await u.settle();
  await u.page.locator('.layer-row.active .layer-swatch').fill(color);
  await u.settle();
}

const fileMenu = async (u: SketchUser, item: string): Promise<void> => {
  await u.page.locator('[data-menu="file"]').click();
  await u.page.locator('.menu-item', { hasText: item }).click();
  await u.settle();
};

async function saveAs(u: SketchUser, title: string): Promise<string> {
  const { page } = u;
  await page.locator(`.dialog[data-dialog="${title}"]`).getByRole('button', { name: 'OK' }).click();
  await u.settle();
  const named = page.locator('.dialog[data-dialog="Save SVG"], .dialog[data-dialog="Save DXF"]');
  const waiting = page.waitForEvent('download');
  await named.getByRole('button', { name: 'Save' }).click();
  const file = await waiting;
  return readFileSync(await file.path(), 'utf8');
}

const attr = (svg: string, tag: string, name: string): string[] =>
  [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*?\\b${name}="([^"]*)"`, 'g'))].map((m) => m[1]);

test.describe('save as svg', () => {
  test('from the File menu: real mm, one group per layer, hidden left out, locked kept', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 10, y: 10 }, { x: 60, y: 30 });
    await addLayer(u, 'Red', '#ff0000');
    await line(u, { x: 10, y: 40 }, { x: 60, y: 60 });
    await page.locator('.layer-row', { hasText: 'Red' }).locator('.layer-lock').click();
    await addLayer(u, 'Hidden', '#00ff00');
    await line(u, { x: -300, y: -300 }, { x: -200, y: -250 });
    await addLayer(u, 'Top', '#0000ff');
    await page.locator('.layer-row', { hasText: 'Hidden' }).locator('.layer-eye').click();
    await u.settle();

    await fileMenu(u, 'Save as SVG');
    const dialog = page.locator('.dialog[data-dialog="Save as SVG"]');
    for (const label of ['Points', 'Projected Geometry', 'Construction Geometry', 'Include Dimensions']) {
      await expect(dialog.locator('.form-row', { hasText: label }).locator('input')).not.toBeChecked();
    }
    const svg = await saveAs(u, 'Save as SVG');
    expect(attr(svg, 'g', 'data-layer')).toEqual(['Layer 1', 'Red', 'Top']);
    expect(attr(svg, 'g', 'stroke')).toEqual(['#5f7186', '#ff0000', '#0000ff']);
    expect(attr(svg, 'line', 'x1')).toHaveLength(2);
    const [width] = attr(svg, 'svg', 'width');
    const [box] = attr(svg, 'svg', 'viewBox');
    expect(width).toMatch(/mm$/);
    expect(Number.parseFloat(width)).toBeCloseTo(52, 3);
    expect(box.split(' ').map(Number)[2]).toBeCloseTo(52, 3);
    expect(attr(svg, 'line', 'y1')[0]).toBe('-10');
  });

  test('from the sketch right-click, with dimensions when asked, and never a glyph', async ({ page }) => {
    const u = await start(page);
    await u.press('r');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 60, y: 30 });
    await exitTool(u);
    await u.press('d');
    await u.click({ x: 35, y: 10 });
    await u.click({ x: 35, y: 2 });
    await page.keyboard.press('Enter');
    await u.settle();
    await exitTool(u);
    await page.locator('.sketch-row').click({ button: 'right' });
    await page.locator('.popup-menu [data-item="Save as SVG"]').click();
    await u.settle();
    const dialog = page.locator('.dialog[data-dialog="Save as SVG"]');
    await dialog.locator('.form-row', { hasText: 'Include Dimensions' }).locator('input').check();
    const svg = await saveAs(u, 'Save as SVG');
    expect(svg).toContain('>50.00<');
    expect(attr(svg, 'line', 'x1').length).toBeGreaterThan(4);
    // Four sides, and a dimension: nothing round, as a glyph would be.
    expect(attr(svg, 'circle', 'r')).toEqual([]);
  });

  test('File > Save as SVG with no sketch says so', async ({ page }) => {
    const u = new SketchUser(page);
    await u.open();
    await fileMenu(u, 'Save as SVG');
    await expect(page.locator('.dialog[data-dialog="Save as SVG"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__sketch.note)).toContain('Create a sketch');
  });
});

test.describe('dxf', () => {
  test('writes named layers in the nearest ACI colours, without hidden ones', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 10, y: 10 }, { x: 60, y: 30 });
    await addLayer(u, 'Red Part', '#ff0000');
    await line(u, { x: 10, y: 40 }, { x: 60, y: 60 });
    await addLayer(u, 'Gone', '#00ff00');
    await line(u, { x: 10, y: 70 }, { x: 60, y: 80 });
    await page.locator('.layer-row', { hasText: 'Layer 1' }).locator('.layer-name').click();
    await page.locator('.layer-row', { hasText: 'Gone' }).locator('.layer-eye').click();
    await u.settle();
    await page.locator('.sketch-row').click({ button: 'right' });
    await page.locator('.popup-menu [data-item="Export DXF"]').click();
    await u.settle();
    const text = await saveAs(u, 'Export DXF');
    const table = parseDxfLayers(text);
    expect(table.get('Red_Part')).toBe(1);
    expect(table.has('Gone')).toBe(false);
    expect(parseDxfCounts(text)).toMatchObject({ LINE: 2, wellFormed: true });
    expect(parseDxfEntities(text).map((e) => e.layer).sort()).toEqual(['Layer_1', 'Red_Part']);
  });
});

// ---------------------------------------------------------------------------
// A small PDF reader: enough to measure the paths Chromium writes.

interface PdfPage { w: number; h: number; segments: { x1: number; y1: number; x2: number; y2: number }[] }

const PT_TO_MM = 25.4 / 72;
type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The straight stroked or filled segments of one content stream, in PDF points. */
function segmentsOf(content: string): PdfPage['segments'] {
  const out: PdfPage['segments'] = [];
  const stack: M[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  let args: number[] = [];
  let at: [number, number] = [0, 0];
  for (const tok of content.split(/\s+/)) {
    if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      args.push(Number(tok));
      continue;
    }
    if (tok === 'q') stack.push(ctm);
    else if (tok === 'Q') ctm = stack.pop() ?? ctm;
    else if (tok === 'cm' && args.length >= 6) ctm = mul(args.slice(-6) as M, ctm);
    else if (tok === 'm' && args.length >= 2) at = apply(ctm, args[args.length - 2], args[args.length - 1]);
    else if (tok === 'l' && args.length >= 2) {
      const to = apply(ctm, args[args.length - 2], args[args.length - 1]);
      out.push({ x1: at[0], y1: at[1], x2: to[0], y2: to[1] });
      at = to;
    }
    args = [];
  }
  return out;
}

/** Pages in file order. Each page's drawing is one content stream, and Chromium writes them in page order. */
function readPdf(buf: Buffer): PdfPage[] {
  const text = buf.toString('latin1');
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  const streams: string[] = [];
  const re = /stream\r?\n/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    try {
      const body = inflateSync(buf.subarray(start, end)).toString('latin1');
      if (/^[\s\d.q]/.test(body) && /\bcm\b/.test(body) && /\bS\b/.test(body)) streams.push(body);
    } catch {
      // Not deflated, or a font: nothing to measure there.
    }
    re.lastIndex = end + 'endstream'.length;
  }
  return boxes.map((b, i) => ({
    w: Number(b[3]) * PT_TO_MM, h: Number(b[4]) * PT_TO_MM, segments: segmentsOf(streams[i] ?? ''),
  }));
}

const lengthMm = (s: PdfPage['segments'][number]): number => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * PT_TO_MM;

test.describe('print', () => {
  const stubPrint = (page: Page): Promise<void> => page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => { (window as unknown as { printed: number }).printed++; };
  });

  async function print(u: SketchUser, opts: { paper?: string; orientation?: string; margin?: string } = {}): Promise<void> {
    const { page } = u;
    await stubPrint(page);
    await fileMenu(u, 'Print');
    const d = page.locator('.dialog[data-dialog="Print 1:1"]');
    if (opts.paper) await d.locator('.form-row', { hasText: 'Paper Size' }).locator('select').selectOption(opts.paper);
    if (opts.orientation) await d.locator('.form-row', { hasText: 'Orientation' }).locator('select').selectOption(opts.orientation);
    if (opts.margin) await d.locator('.form-row', { hasText: 'Margins' }).locator('input').fill(opts.margin);
    await d.getByRole('button', { name: 'Print' }).click();
    await u.settle();
    expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  }

  const pdf = (page: Page): Promise<Buffer> => page.pdf({ preferCSSPageSize: true, printBackground: true });

  test('the dialog offers the sizes, shows the placement, and says to print at 100%', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 10, y: 10 }, { x: 60, y: 30 });
    await stubPrint(page);
    await u.press('Control+p');
    const d = page.locator('.dialog[data-dialog="Print 1:1"]');
    await expect(d).toBeVisible();
    await expect(d.locator('.form-row', { hasText: 'Paper Size' }).locator('option')).toHaveCount(5);
    for (const name of ['A4', 'A3', 'A2', 'Letter', 'Tabloid']) await expect(d.locator('.form-row', { hasText: 'Paper Size' }).locator('select')).toContainText(name);
    await expect(d.locator('.print-warning')).toContainText('100%');
    await expect(d.locator('.print-warning')).toContainText('Actual size');
    await expect(d.locator('.print-warning')).toContainText('Fit to page');
    await expect(d.locator('.print-warning')).toContainText('ruler');
    await expect(d.locator('.print-preview svg').first()).toBeVisible();
    await expect(d.locator('.print-summary')).toContainText('1 page');
    await d.locator('.form-row', { hasText: 'Margins' }).locator('input').fill('60');
    await expect(d.getByRole('button', { name: 'Print' })).toBeDisabled();
    await expect(d.locator('.dialog-error')).toContainText('scale bar');
  });

  test('a 100 mm line and the scale bar measure 100 mm in the PDF, on a true A4 page', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 10, y: 20 }, { x: 110, y: 20 });
    expect((await u.lines()).length).toBe(1);
    await print(u);
    await expect(page.locator('#print-root .print-page')).toHaveCount(1);
    const pages = readPdf(await pdf(page));
    expect(pages).toHaveLength(1);
    expect(pages[0].w).toBeCloseTo(210, 0);
    expect(pages[0].h).toBeCloseTo(297, 0);
    const hundred = pages[0].segments.filter((s) => Math.abs(lengthMm(s) - 100) < 0.05);
    // The line, and the bar. They are level and at different heights.
    expect(hundred.length).toBeGreaterThanOrEqual(2);
    const heights = new Set(hundred.map((s) => s.y1.toFixed(1)));
    expect(heights.size).toBeGreaterThanOrEqual(2);
    for (const s of hundred) expect(Math.abs(s.y2 - s.y1)).toBeLessThan(0.01);
    await page.emulateMedia({ media: 'print' });
    await u.shot('print-page-a4');
    await page.emulateMedia({ media: 'screen' });
  });

  test('landscape and US sizes come out at their true size', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 10, y: 20 }, { x: 110, y: 20 });
    await print(u, { paper: 'Letter', orientation: 'landscape' });
    const [p] = readPdf(await pdf(page));
    expect(p.w).toBeCloseTo(279.4, 0);
    expect(p.h).toBeCloseTo(215.9, 0);
    expect(p.segments.filter((s) => Math.abs(lengthMm(s) - 100) < 0.05).length).toBeGreaterThanOrEqual(2);
  });

  test('geometry too big for the paper tiles, with labels, marks, overlap and a bar on every page', async ({ page }) => {
    const u = await start(page);
    await u.wheelOut(900);
    await line(u, { x: -150, y: 20 }, { x: 150, y: 20.5 });
    await print(u);
    const sheets = page.locator('#print-root .print-page');
    const n = await sheets.count();
    expect(n).toBe(2);
    await expect(sheets.first().locator('.print-label')).toContainText('Page 1 of 2');
    await expect(sheets.first().locator('.print-label')).toContainText('column 1 of 2');
    await expect(sheets.first().locator('.print-label')).toContainText('overlap 10 mm');
    for (let i = 0; i < n; i++) {
      await expect(sheets.nth(i).locator('.scale-bar-line')).toHaveCount(1);
      await expect(sheets.nth(i).locator('.print-mark')).toHaveCount(3);
      await expect(sheets.nth(i).locator('.print-seam')).toHaveCount(1);
    }
    const pages = readPdf(await pdf(page));
    expect(pages).toHaveLength(2);
    for (const p of pages) expect(p.segments.some((s) => Math.abs(lengthMm(s) - 100) < 0.05)).toBe(true);
  });

  test('hidden layers do not print, locked ones do', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 10, y: 20 }, { x: 60, y: 30 });
    await addLayer(u, 'Hidden', '#00ff00');
    await line(u, { x: 10, y: 40 }, { x: 60, y: 50 });
    await addLayer(u, 'Locked', '#ff0000');
    await line(u, { x: 10, y: 60 }, { x: 60, y: 70 });
    await addLayer(u, 'Top', '#0000ff');
    await page.locator('.layer-row', { hasText: 'Hidden' }).locator('.layer-eye').click();
    await page.locator('.layer-row', { hasText: 'Locked' }).locator('.layer-lock').click();
    await u.settle();
    await print(u);
    const layers = await page.locator('#print-root [data-layer]').evaluateAll((g) => g.map((x) => x.getAttribute('data-layer')));
    expect(layers).toEqual(['Layer 1', 'Locked', 'Top']);
  });
});
