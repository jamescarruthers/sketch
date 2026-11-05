// The line in Save as SVG that says what an editable file will carry. docs/AUDIT.md, round 8.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SketchUser } from './helpers';
import { addLine, newDesign, newSketch } from '../src/model/document';
import { addLayer } from '../src/model/layers';
import { serialize } from '../src/io/project';

/** Two hidden layers, four construction lines on shown layers and one on a hidden layer. */
const text = (): string => {
  const d = newDesign('Carries');
  const s = newSketch(d);
  addLine(d, s, { x: 0, y: 0 }, { x: 30, y: 0 });
  for (let i = 1; i <= 4; i++) addLine(d, s, { x: 0, y: i * 3 }, { x: 30, y: i * 3 }).lineType = 'construction';
  const a = addLayer(d);
  addLine(d, s, { x: 0, y: 40 }, { x: 30, y: 40 }).lineType = 'construction';
  a.visible = false;
  const b = addLayer(d);
  addLine(d, s, { x: 0, y: 50 }, { x: 30, y: 50 });
  b.visible = false;
  d.activeLayer = d.layers[d.layers.length - 1].id;
  return serialize(d);
};

const start = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), (async () => {
    await page.locator('[data-menu="file"]').click();
    await page.locator('.menu-item[data-item="Open..."]').first().click();
  })()]);
  await chooser.setFiles({ name: 'c.sketch.json', mimeType: 'application/json', buffer: Buffer.from(text(), 'utf8') });
  await page.waitForTimeout(250);
  await page.locator('.sketch-row').first().dblclick();
  await expect(page.locator('.tab.active')).toHaveText('SKETCH');
  return u;
};

const openDialog = async (page: Page): Promise<Locator> => {
  await page.locator('[data-menu="file"]').click();
  await page.locator('.menu-item[data-item="Save as SVG..."]').first().click();
  return page.locator('[data-dialog="Save as SVG"]');
};
const box = (d: Locator, label: string): Locator => d.locator('.form-row', { hasText: label }).locator('input');

test('the dialog says what will be embedded, with real counts, and follows the options', async ({ page }) => {
  await start(page);
  const d = await openDialog(page);
  const line = d.locator('.embed-summary');
  await expect(box(d, 'Include editable data')).toBeChecked();
  await expect(line).toHaveText('Includes 2 hidden layers and 5 construction lines.');
  // Drawn construction on a shown layer is not hidden from anyone: only the one on a hidden layer is left to count.
  await box(d, 'Construction Geometry').check();
  await expect(line).toHaveText('Includes 2 hidden layers and 1 construction line.');
  await box(d, 'Construction Geometry').uncheck();
  await expect(line).toHaveText('Includes 2 hidden layers and 5 construction lines.');
  await box(d, 'Include editable data').uncheck();
  await expect(line).toHaveText('No editable data: the file holds only what is drawn.');
  await box(d, 'Include editable data').check();
  await expect(line).toHaveText('Includes 2 hidden layers and 5 construction lines.');
});

test('with the data unticked the saved file holds none of it', async ({ page }) => {
  await start(page);
  const d = await openDialog(page);
  await box(d, 'Include editable data').uncheck();
  await d.getByRole('button', { name: 'OK' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-dialog="Save SVG"]').getByRole('button', { name: 'Save' }).click()]);
  const svg = readFileSync(await download.path(), 'utf8');
  expect(svg).not.toContain('<metadata');
  expect(svg).not.toContain('sketch:design');
  expect(svg).not.toContain('stroke-dasharray');
  expect(/[A-Za-z0-9+/]{200,}/.test(svg)).toBe(false);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the line fits a 360 px window in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 360, height: 700 });
    await start(page);
    const d = await openDialog(page);
    const line = d.locator('.embed-summary');
    await expect(line).toBeVisible();
    const b = (await d.boundingBox()) as { x: number; width: number };
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(360);
    const lb = (await line.boundingBox()) as { x: number; width: number };
    expect(lb.x + lb.width).toBeLessThanOrEqual(b.x + b.width + 0.5);
    const ink = await line.evaluate((el) => getComputedStyle(el).color);
    const [r, g, bl] = (ink.match(/\d+/g) ?? []).map(Number);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
    if (scheme === 'dark') expect(lum).toBeGreaterThan(0.4);
    else expect(lum).toBeLessThan(0.5);
  });
}
