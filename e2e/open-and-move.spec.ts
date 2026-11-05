// What the app does on its own account when a file opens, and what a move takes with it: both say so.
import { expect, test, type Page } from '@playwright/test';
import { pointAt, SketchUser, type Xy } from './helpers';
import type { Arc, Design, FitSpline, Sketch } from '../src/model/types';
import { addConstraint, addLine, newDesign, newSketch } from '../src/model/document';
import { deserialize, serialize } from '../src/io/project';
import { curvatureAt, resolve } from '../src/geom/curves';

const base = { lineType: 'normal' as const, layer: 'layer-1' };

/** The file a build before fit spline G2 left: Curvature on an arc and a fit spline, at G1, and a far line. */
function oldFile(): string {
  const d = newDesign('Old');
  const s = newSketch(d);
  s.name = 'Joint';
  const pt = (id: string, x: number, y: number): string => {
    s.points[id] = { id, x, y, owner: id === 'c1' || id === 'b1' ? 'arc1' : 'fs1' };
    return id;
  };
  const r = (724 / 36);
  pt('c1', 0, 48 - r);
  pt('a1', 20, 30);
  pt('b1', -20, 30);
  s.curves.arc1 = { ...base, id: 'arc1', type: 'arc', c: 'c1', a: 'a1', b: 'b1' } as Arc;
  pt('f1', 40, 50);
  pt('f2', 60, 20);
  pt('f3', 80, 40);
  pt('h1', 20 + 28 / 3 * (30 - (48 - r)) / r, 30 - 28 / 3 * 20 / r);
  s.curves.fs1 = { ...base, id: 'fs1', type: 'fitSpline', pts: ['a1', 'f1', 'f2', 'f3'], closed: false, handles: ['h1', null, null, null] } as FitSpline;
  addConstraint(d, s, 'curvature', ['fs1', 'arc1'], { variant: 0 });
  const on = resolve(s, s.curves.fs1).at(0.6);
  s.points.ride = { id: 'ride', x: on.x, y: on.y, explicit: true };
  addConstraint(d, s, 'coincident', ['ride', 'fs1']);
  addLine(d, s, { x: -60, y: -60 }, { x: -20, y: -60 });
  return serialize(d);
}

async function open(u: SketchUser, name: string, content: string): Promise<void> {
  const [chooser] = await Promise.all([
    u.page.waitForEvent('filechooser'),
    (async () => {
      await u.page.locator('[data-menu="file"]').click();
      await u.page.locator('.menu-item[data-item="Open..."]').first().click();
    })(),
  ]);
  await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content, 'utf8') });
  await u.page.waitForTimeout(250);
  await u.settle();
}

const state = (page: Page) => page.evaluate(() => {
  const h = window.__sketch;
  return { dirty: h.dirty, canUndo: h.canUndo, note: h.note };
});

const only = (d: Design): Sketch => Object.values(d.sketches)[0];
const pts = (s: Sketch): Record<string, [number, number]> => Object.fromEntries(Object.values(s.points).map((p) => [p.id, [p.x, p.y]]));
const startKappa = (s: Sketch): number => Math.abs(curvatureAt(resolve(s, s.curves.fs1), 0));

test('an old file takes its G2 on open, says so, is dirty, and Undo never finds the old shape', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  const file = oldFile();
  const raw = deserialize(file);
  if (!raw.ok) throw new Error(raw.error);
  expect(startKappa(only(raw.design))).toBeGreaterThan(0.08);
  await open(u, 'old.sketch.json', file);
  const after = await state(page);
  expect(after.note).toContain('Joint');
  expect(after.note).toContain('Curvature');
  expect(after.dirty).toBe(true);
  expect(after.canUndo).toBe(false);
  const settled = only(await u.design());
  const r = Math.hypot(settled.points.a1.x - settled.points.c1.x, settled.points.a1.y - settled.points.c1.y);
  expect(Math.abs(startKappa(settled) - 1 / r)).toBeLessThan(1e-5);

  // A far edit and its Undo land on the settled shape, and looking changes nothing.
  await page.locator('.sketch-row').first().dblclick();
  await u.settle();
  const line = Object.values((await u.sketch()).curves).find((c) => c.type === 'line');
  if (line?.type !== 'line') throw new Error('no line');
  const p = pointAt(settled, line.a);
  await u.drag(p, { x: p.x - 4, y: p.y - 3 }, 6);
  await u.press('ControlOrMeta+z');
  const back = only(await u.design());
  for (const [id, [x, y]] of Object.entries(pts(settled))) {
    expect(Math.hypot(back.points[id].x - x, back.points[id].y - y), id).toBeLessThan(1e-6);
  }

  // A reload still knows this is not what the file holds, and has nothing new to say.
  await page.reload();
  await page.waitForFunction(() => !!window.__sketch);
  await u.settle();
  const again = await state(page);
  expect(again.dirty).toBe(true);
  expect(again.note).not.toContain('Curvature');
});

test('a file saved from this build reopens identical, with no note and clean', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await open(u, 'old.sketch.json', oldFile());
  const settled = await u.design();
  const saved = serialize(settled);
  await page.locator('[data-menu="file"]').click();
  await page.locator('.menu-item[data-item="New"]').first().click();
  await page.locator('.dialog[data-dialog="Unsaved Changes"]').getByRole('button', { name: "Don't Save" }).click();
  await page.waitForTimeout(100);
  await open(u, 'new.sketch.json', saved);
  const after = await state(page);
  expect(after.note).not.toContain('Curvature');
  expect(after.dirty).toBe(false);
  expect(pts(only(await u.design()))).toEqual(pts(only(settled)));
});

test('a file with no curvature to reach opens clean and silent', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  const d = newDesign('Plain');
  const s = newSketch(d);
  addLine(d, s, { x: 0, y: 0 }, { x: 25, y: 0 });
  await open(u, 'plain.sketch.json', serialize(d));
  const after = await state(page);
  expect(after.dirty).toBe(false);
  expect(after.note).toBe('');
});

async function dimensionedTail(u: SketchUser): Promise<void> {
  await u.press('r');
  await u.click({ x: 10, y: 10 });
  await u.move({ x: 50, y: 40 });
  await u.type('40');
  await u.press('Tab');
  await u.type('30');
  await u.press('Enter');
  await u.press('Escape');
  await u.press('Escape');
  const s = await u.sketch();
  const corner = Object.values(s.points).reduce((a, b) => (a.x + a.y > b.x + b.y ? a : b));
  await u.press('l');
  await u.click(corner);
  await u.click({ x: corner.x + 25, y: corner.y + 20 });
  await u.press('Escape');
  await u.press('Escape');
}

test('a move that takes dimensions with it names them, and Undo brings them back', async ({ page }) => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  await dimensionedTail(u);
  const s0 = await u.sketch();
  const names = Object.values(s0.dimensions).map((d) => d.name);
  expect(names.length).toBe(2);
  const corner = Object.values(s0.points).reduce((a, b) => (a.x + a.y > b.x + b.y ? a : b));
  const mid: Xy = { x: corner.x - 12.5, y: corner.y - 10 };
  await u.click(mid);
  await u.press('m');
  const d = page.locator('.dialog[data-dialog="Move/Copy"]');
  await d.locator('.form-row').filter({ has: page.locator('.form-label:text-is("X Distance")') }).locator('input').fill('15');
  await page.keyboard.press('Tab');
  await d.getByRole('button', { name: 'OK' }).click();
  await u.settle();
  const s1 = await u.sketch();
  const left = Object.values(s1.dimensions).map((m) => m.name);
  const gone = names.filter((n) => !left.includes(n));
  expect(gone.length).toBeGreaterThan(0);
  const { note } = await state(page);
  for (const n of gone) expect(note).toContain(n);
  for (const n of left) expect(note).not.toContain(n);
  await u.press('ControlOrMeta+z');
  const s2 = await u.sketch();
  expect(pts(s2)).toEqual(pts(s0));
  expect(Object.keys(s2.dimensions).length).toBe(2);
});
