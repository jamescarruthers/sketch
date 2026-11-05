// A value nothing constrains stays put when something else is dimensioned: docs/AUDIT.md, OPEN-32.
import { expect, test, type Page } from '@playwright/test';
import { pointAt, SketchUser, type Xy } from './helpers';
import type { Arc, Circle, Line } from '../src/model/types';

const menu = async (u: SketchUser, label: string, flyout: string): Promise<void> => {
  await u.page.locator('.panel[data-panel="create"] .panel-name').click();
  await u.page.locator(`.menu-item.flyout[data-item="${flyout}"]`).hover();
  await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  await u.settle();
};
const leave = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};
const dimension = async (u: SketchUser, pick: Xy, at: Xy, value: string): Promise<void> => {
  await u.press('d');
  await u.click(pick);
  await u.click(at);
  await u.page.keyboard.press('ControlOrMeta+a');
  await u.page.keyboard.type(value);
  await u.press('Enter');
  await leave(u);
};
const start = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  await menu(u, 'Center Rectangle', 'Rectangle');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 60, y: 62 });
  await leave(u);
  return u;
};
const circle = async (u: SketchUser, centre: Xy, rim: Xy): Promise<void> => {
  await menu(u, 'Center Diameter Circle', 'Circle');
  await u.click(centre);
  await u.click(rim);
  await leave(u);
};
const height = async (u: SketchUser): Promise<number> => {
  const s = await u.sketch();
  const ys = Object.values(s.curves).filter((c): c is Line => c.type === 'line').flatMap((l) => [pointAt(s, l.a).y, pointAt(s, l.b).y]);
  return Math.max(...ys) - Math.min(...ys);
};
const radii = async (u: SketchUser): Promise<number[]> => Object.values((await u.sketch()).curves).filter((c): c is Circle => c.type === 'circle').map((c) => c.r);

test('a width dimension moves neither a circle with its rim on the diagonal nor the height', async ({ page }) => {
  const u = await start(page);
  // A click this near the diagonal leaves a point on it, so the circle is tied to the rectangle.
  await circle(u, { x: 0, y: 0 }, { x: 7, y: 7 });
  const s = await u.sketch();
  expect(Object.values(s.constraints).filter((k) => k.type === 'coincident' && k.refs.some((r) => s.curves[r]?.type === 'circle'))).toHaveLength(1);
  const [before] = await radii(u);
  expect(before).toBeCloseTo(9.898165, 5);
  await dimension(u, { x: 30, y: 62 }, { x: 30, y: 74 }, '70');
  expect((await radii(u))[0]).toBeCloseTo(before, 5);
  expect(await height(u)).toBeCloseTo(124, 5);
  await dimension(u, { x: 35, y: 30 }, { x: 46, y: 30 }, '114');
  expect((await radii(u))[0]).toBeCloseTo(before, 5);
  expect(await height(u)).toBeCloseTo(114, 5);
});

test('a width ten times over leaves two circles alone', async ({ page }) => {
  const u = await start(page);
  await circle(u, { x: 0, y: 0 }, { x: 7, y: 7 });
  await circle(u, { x: 0, y: 0 }, { x: 21, y: 22 });
  const before = await radii(u);
  expect(before).toHaveLength(2);
  await dimension(u, { x: 30, y: 62 }, { x: 30, y: 74 }, '1200');
  const after = await radii(u);
  expect(after[0]).toBeCloseTo(before[0], 5);
  expect(after[1]).toBeCloseTo(before[1], 5);
  expect(await height(u)).toBeCloseTo(124, 5);
});

test('a free arc with a point on the diagonal stays where it is', async ({ page }) => {
  const u = await start(page);
  await menu(u, '3-Point Arc', 'Arc');
  await u.click({ x: 22, y: 42 });
  await u.click({ x: 22, y: 16 });
  await u.click({ x: 30, y: 29 });
  await leave(u);
  const arc = async (): Promise<number[]> => {
    const s = await u.sketch();
    const a = Object.values(s.curves).find((c): c is Arc => c.type === 'arc') as Arc;
    const [c, e] = [pointAt(s, a.c), pointAt(s, a.a)];
    return [Math.hypot(c.x - e.x, c.y - e.y), c.x, c.y];
  };
  const before = await arc();
  await dimension(u, { x: 30, y: 62 }, { x: 30, y: 74 }, '70');
  const after = await arc();
  after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 5));
  expect(await height(u)).toBeCloseTo(124, 5);
});
