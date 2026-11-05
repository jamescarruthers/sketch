// Regressions for the constraint solver's root cause and the audit findings on constraining,
// dimensioning and modifying. Real mouse and keyboard; results read from window.__sketch.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { pointAt, SketchUser, type Xy } from './helpers';
import { View } from '../src/app/view';
import { curvatureAt, resolve, unitTangent } from '../src/geom/curves';
import { layoutDimension } from '../src/render/dimensions';
import { layoutBadges } from '../src/render/glyphs';
import type { Arc, Circle, ControlSpline, Curve, Dimension, Ellipse, FitSpline, Line, Sketch } from '../src/model/types';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { errors: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

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

async function menu(u: SketchUser, panel: 'create' | 'modify' | 'constraints', label: string, flyout?: string): Promise<void> {
  await u.page.locator(`.panel[data-panel="${panel}"] .panel-name`).click();
  if (flyout) await u.page.locator(`.menu-item.flyout[data-item="${flyout}"]`).hover();
  await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  await u.settle();
}
const constrain = (u: SketchUser, label: string): Promise<void> => menu(u, 'constraints', label);
const modify = (u: SketchUser, label: string, flyout?: string): Promise<void> => menu(u, 'modify', label, flyout);
const dialog = (u: SketchUser, title: string): Locator => u.page.locator(`.dialog[data-dialog="${title}"]`);
const ok = async (u: SketchUser, d: Locator): Promise<void> => {
  await d.locator('.btn.primary').click();
  await u.settle();
};
const field = (d: Locator, label: string): Locator =>
  d.locator('.form-row').filter({ has: d.page().locator(`.form-label:text-is("${label}")`) }).locator('input');
async function dimension(u: SketchUser, pick: Xy[], at: Xy, value: string): Promise<void> {
  await u.press('d');
  for (const p of pick) await u.click(p);
  await u.click(at);
  await u.page.keyboard.press('ControlOrMeta+a');
  await u.page.keyboard.type(value);
  await u.press('Enter');
  await exitTool(u);
}
async function rectangle(u: SketchUser, a: Xy, b: Xy): Promise<void> {
  await u.press('r');
  await u.click(a);
  await u.click(b);
  await exitTool(u);
}
const marking = async (u: SketchUser, at: Xy, item: string): Promise<void> => {
  await u.rightClick(at);
  await u.page.locator(`.marking-list [data-item="${item}"]`).click();
  await u.settle();
};

async function line(u: SketchUser, ...pts: Xy[]): Promise<void> {
  await u.press('l');
  for (const p of pts) await u.click(p);
  await exitTool(u);
}
async function circle(u: SketchUser, c: Xy, rim: Xy): Promise<void> {
  await u.press('c');
  await u.click(c);
  await u.click(rim);
  await exitTool(u);
}
async function arc3(u: SketchUser, a: Xy, b: Xy, mid: Xy): Promise<void> {
  await menu(u, 'create', '3-Point Arc', 'Arc');
  await u.click(a);
  await u.click(b);
  await u.click(mid);
  await exitTool(u);
}
const lengthOf = (s: Sketch, l: Line): number => Math.hypot(pointAt(s, l.a).x - pointAt(s, l.b).x, pointAt(s, l.a).y - pointAt(s, l.b).y);
const dirOf = (s: Sketch, l: Line): Xy => ({ x: pointAt(s, l.b).x - pointAt(s, l.a).x, y: pointAt(s, l.b).y - pointAt(s, l.a).y });
const arcRadius = (s: Sketch, a: Arc): number => Math.hypot(pointAt(s, a.a).x - pointAt(s, a.c).x, pointAt(s, a.a).y - pointAt(s, a.c).y);
const curveList = async <T extends Curve>(u: SketchUser, type: T['type']): Promise<T[]> => (await u.curves(type)) as T[];
const note = (u: SketchUser): Promise<string> => u.page.evaluate(() => document.querySelector('.status-note')?.textContent ?? '');

test.describe('root cause: constraints keep sizes', () => {
  test('M-F5 Parallel rotates the line and keeps its length', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -60, y: 30 }, { x: -20, y: 30 });
    await line(u, { x: 30, y: -40 }, { x: 40, y: 40 });
    await constrain(u, 'Parallel');
    await u.click({ x: -40, y: 30 });
    await u.click({ x: 35, y: 0 });
    const s = await u.sketch();
    const [first, second] = await u.lines();
    expect(lengthOf(s, first)).toBeCloseTo(40, 3);
    expect(lengthOf(s, second)).toBeCloseTo(Math.hypot(10, 80), 3);
    expect(Math.abs(dirOf(s, second).y)).toBeLessThan(1e-5);
  });

  test('M-F5 Perpendicular rotates the line and keeps its length', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -60, y: 30 }, { x: -20, y: 30 });
    await line(u, { x: 30, y: -30 }, { x: 70, y: -20 });
    await constrain(u, 'Perpendicular');
    await u.click({ x: -40, y: 30 });
    await u.click({ x: 50, y: -25 });
    const s = await u.sketch();
    const [, second] = await u.lines();
    expect(lengthOf(s, second)).toBeCloseTo(Math.hypot(40, 10), 3);
    expect(Math.abs(dirOf(s, second).x)).toBeLessThan(1e-5);
  });

  test('W-P1-1 Perpendicular keeps both lines with the locked line second', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 0, y: 0 }, { x: 60, y: 0 });
    await line(u, { x: 0, y: 0 }, { x: 15, y: 50 });
    await constrain(u, 'Perpendicular');
    await u.click({ x: 7.5, y: 25 });
    await u.click({ x: 30, y: 0 });
    const s = await u.sketch();
    const [first, second] = await u.lines();
    expect(lengthOf(s, first)).toBeCloseTo(60, 3);
    expect(lengthOf(s, second)).toBeCloseTo(Math.hypot(15, 50), 3);
    expect(Math.abs(dirOf(s, second).x)).toBeLessThan(1e-5);
    // The tutorial's next step: Equal on the same pair is not a conflict.
    await exitTool(u);
    await constrain(u, 'Equal');
    await u.click({ x: 30, y: 0 });
    await u.click({ x: 0, y: 25 });
    const a = await u.analysis();
    expect(a.unsatisfied).toEqual([]);
    expect(lengthOf(await u.sketch(), (await u.lines())[1])).toBeCloseTo(60, 3);
  });

  test('W-P1-1 Parallel with a line whose ends sit on an axis, in that order', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 0, y: 0 }, { x: 60, y: 0 });
    await line(u, { x: 10, y: 20 }, { x: 40, y: 60 });
    await constrain(u, 'Parallel');
    await u.click({ x: 25, y: 40 });
    await u.click({ x: 30, y: 0 });
    const s = await u.sketch();
    const [first, second] = await u.lines();
    expect(lengthOf(s, first)).toBeGreaterThan(55);
    expect(lengthOf(s, second)).toBeCloseTo(50, 3);
    expect(Math.abs(dirOf(s, first).x * dirOf(s, second).y - dirOf(s, first).y * dirOf(s, second).x)).toBeLessThan(1e-3);
  });

  for (const order of ['first then second', 'second then first']) {
    test(`M-F8 Parallel then Perpendicular on one pair is reported, ${order}`, async ({ page }) => {
      const u = await start(page);
      await line(u, { x: -60, y: 30 }, { x: -20, y: 30 });
      await line(u, { x: 10, y: -20 }, { x: 50, y: -10 });
      const a = { x: -40, y: 30 };
      const b = { x: 30, y: -15 };
      await constrain(u, 'Parallel');
      await u.click(a);
      await u.click(b);
      await exitTool(u);
      const lines = await u.lines();
      const mid = async (l: Line): Promise<Xy> => {
        const s = await u.sketch();
        const p = pointAt(s, l.a);
        const q = pointAt(s, l.b);
        return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      };
      const [ma, mb] = [await mid(lines[0]), await mid(lines[1])];
      await constrain(u, 'Perpendicular');
      await u.click(order === 'first then second' ? ma : mb);
      await u.click(order === 'first then second' ? mb : ma);
      const s = await u.sketch();
      for (const l of await u.lines()) expect(lengthOf(s, l)).toBeGreaterThan(30);
      expect(await note(u)).toMatch(/not applied|conflict/i);
      expect(Object.values(s.constraints).filter((k) => k.type === 'perpendicular').length).toBe(0);
    });
  }

  test('M-F4 Concentric moves an arc unchanged', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: -40, y: 30 }, { x: -20, y: 30 });
    await arc3(u, { x: 10, y: 30 }, { x: 50, y: 30 }, { x: 30, y: 50 });
    await constrain(u, 'Concentric');
    await u.click({ x: -20, y: 30 });
    await u.click({ x: 30, y: 50 });
    const s = await u.sketch();
    const [c] = await curveList<Circle>(u, 'circle');
    const [a] = await curveList<Arc>(u, 'arc');
    expect(arcRadius(s, a)).toBeCloseTo(20, 3);
    expect(pointAt(s, a.c).x).toBeCloseTo(pointAt(s, c.c).x, 4);
    expect(Math.hypot(pointAt(s, a.a).x - pointAt(s, a.b).x, pointAt(s, a.a).y - pointAt(s, a.b).y)).toBeCloseTo(40, 3);
  });

  test('M-F4 Concentric moves an ellipse unchanged', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: -60, y: 0 }, { x: -40, y: 0 });
    await menu(u, 'create', 'Ellipse');
    await u.click({ x: 30, y: 30 });
    await u.click({ x: 60, y: 30 });
    await u.click({ x: 30, y: 45 });
    await exitTool(u);
    await constrain(u, 'Concentric');
    await u.click({ x: -40, y: 0 });
    await u.click({ x: 60, y: 30 });
    const s = await u.sketch();
    const [e] = await curveList<Ellipse>(u, 'ellipse');
    const c = pointAt(s, e.c);
    expect(c.x).toBeCloseTo(-60, 3);
    expect(Math.hypot(pointAt(s, e.major).x - c.x, pointAt(s, e.major).y - c.y)).toBeCloseTo(30, 3);
    expect(Math.hypot(pointAt(s, e.minor).x - c.x, pointAt(s, e.minor).y - c.y)).toBeCloseTo(15, 3);
  });

  test('M-F7 Tangent moves a circle to a line without resizing either', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -60, y: -30 }, { x: 60, y: -30 });
    await circle(u, { x: 0, y: 30 }, { x: 20, y: 30 });
    await constrain(u, 'Tangent');
    await u.click({ x: -30, y: -30 });
    await u.click({ x: 20, y: 30 });
    const s = await u.sketch();
    const [c] = await curveList<Circle>(u, 'circle');
    const [l] = await u.lines();
    expect(c.r).toBeCloseTo(20, 3);
    expect(lengthOf(s, l)).toBeCloseTo(120, 3);
    expect(pointAt(s, c.c).y).toBeCloseTo(-10, 3);
    expect(pointAt(s, l.a).y).toBeCloseTo(-30, 3);
  });

  for (const reverse of [false, true]) {
    test(`M-F7 Tangent moves one circle to another without resizing, reverse=${reverse}`, async ({ page }) => {
      const u = await start(page);
      await circle(u, { x: -50, y: 0 }, { x: -30, y: 0 });
      await circle(u, { x: 50, y: 30 }, { x: 70, y: 30 });
      await constrain(u, 'Tangent');
      await u.click(reverse ? { x: 70, y: 30 } : { x: -30, y: 0 });
      await u.click(reverse ? { x: -30, y: 0 } : { x: 70, y: 30 });
      const s = await u.sketch();
      const [a, b] = await curveList<Circle>(u, 'circle');
      expect(a.r).toBeCloseTo(20, 3);
      expect(b.r).toBeCloseTo(20, 3);
      const gap = Math.hypot(pointAt(s, a.c).x - pointAt(s, b.c).x, pointAt(s, a.c).y - pointAt(s, b.c).y);
      expect(gap).toBeCloseTo(40, 3);
    });

    test(`M-F18 Coincident moves the point to the circle, reverse=${reverse}`, async ({ page }) => {
      const u = await start(page);
      await menu(u, 'create', 'Point');
      await u.click({ x: 50, y: 30 });
      await exitTool(u);
      await circle(u, { x: 0, y: 0 }, { x: 20, y: 0 });
      await constrain(u, 'Coincident');
      await u.click(reverse ? { x: -20, y: 0 } : { x: 50, y: 30 });
      await u.click(reverse ? { x: 50, y: 30 } : { x: -20, y: 0 });
      const s = await u.sketch();
      const [c] = await curveList<Circle>(u, 'circle');
      expect(c.r).toBeCloseTo(20, 3);
      const p = Object.values(s.points).find((q) => q.explicit) as { x: number; y: number };
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(20, 3);
    });
  }

  test('C-F18 Tangent on the same circle twice leaves it alone', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: 0, y: 0 }, { x: 20, y: 0 });
    await constrain(u, 'Tangent');
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 0, y: -20 });
    const [c] = await curveList<Circle>(u, 'circle');
    expect(c.r).toBeCloseTo(20, 3);
    const s = await u.sketch();
    expect(Object.values(s.constraints).filter((k) => k.type === 'tangent').length).toBe(0);
  });
});

test.describe('fillet and chamfer', () => {
  const crossing = async (u: SketchUser): Promise<void> => {
    await line(u, { x: -40, y: 15 }, { x: 60, y: 15 });
    await line(u, { x: 10, y: -40 }, { x: 10, y: 70 });
  };

  test('M-F1 Fillet between crossing lines, on the short arms', async ({ page }) => {
    const u = await start(page);
    await crossing(u);
    await menu(u, 'modify', 'Fillet');
    await u.click({ x: -20, y: 15 });
    await u.click({ x: 10, y: -20 });
    await u.press('Enter');
    const [a] = await curveList<Arc>(u, 'arc');
    expect(a).toBeTruthy();
    const s = await u.sketch();
    expect(arcRadius(s, a)).toBeGreaterThan(5);
    expect(pointAt(s, a.c).x).toBeLessThan(10);
    expect(pointAt(s, a.c).y).toBeLessThan(15);
  });

  test('M-F2 Chamfer between crossing lines', async ({ page }) => {
    const u = await start(page);
    await crossing(u);
    await modify(u, 'Equal Distance Chamfer', 'Chamfer');
    await u.click({ x: -20, y: 15 });
    await u.click({ x: 10, y: -20 });
    await u.press('Enter');
    const s = await u.sketch();
    const lines = await u.lines();
    expect(lines).toHaveLength(3);
    const near = lines.find((l) => Math.hypot(pointAt(s, l.a).x - pointAt(s, l.b).x, pointAt(s, l.a).y - pointAt(s, l.b).y) < 40);
    expect(near).toBeTruthy();
  });

  const lineAndArc = async (u: SketchUser): Promise<void> => {
    await line(u, { x: -60, y: 12 }, { x: 60, y: 12 });
    await arc3(u, { x: -35, y: -25 }, { x: 30, y: -25 }, { x: 3, y: 40 });
  };

  test('M-F3 Fillet line and intersecting arc from inside the arc trims the arc and keeps it on its circle', async ({ page }) => {
    const u = await start(page);
    await lineAndArc(u);
    const before = (await curveList<Arc>(u, 'arc'))[0];
    const s0 = await u.sketch();
    const centre = pointAt(s0, before.c);
    const radius = arcRadius(s0, before);
    await menu(u, 'modify', 'Fillet');
    await u.click({ x: 5, y: 12 });
    await u.click({ x: centre.x, y: centre.y + radius });
    await u.press('Enter');
    const s = await u.sketch();
    const arcs = Object.values(s.curves).filter((c): c is Arc => c.type === 'arc');
    expect(arcs).toHaveLength(2);
    const big = arcs.find((a) => Math.abs(arcRadius(s, a) - radius) < 1) as Arc;
    const fillet = arcs.find((a) => a !== big) as Arc;
    expect(arcRadius(s, fillet)).toBeGreaterThan(1);
    expect(arcRadius(s, fillet)).toBeLessThan(radius);
    // Kept to its own sweep: nothing of it runs on past the original ends, which sit at y = -25.
    for (const p of [pointAt(s, big.a), pointAt(s, big.b)]) expect(p.y).toBeGreaterThan(-25.001);
    expect(pointAt(s, fillet.c).y).toBeGreaterThan(12);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('M-F3 Fillet line and intersecting arc from outside the arc', async ({ page }) => {
    const u = await start(page);
    await lineAndArc(u);
    const s0 = await u.sketch();
    const before = (await curveList<Arc>(u, 'arc'))[0];
    const centre = pointAt(s0, before.c);
    const radius = arcRadius(s0, before);
    await menu(u, 'modify', 'Fillet');
    await u.click({ x: 55, y: 12 });
    await u.click({ x: centre.x, y: centre.y + radius });
    await u.press('Enter');
    expect(await curveList<Arc>(u, 'arc')).toHaveLength(2);
  });

  test('M-F3 Fillet line and circle', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -60, y: 0 }, { x: 60, y: 0 });
    await circle(u, { x: 0, y: 10 }, { x: 20, y: 10 });
    await menu(u, 'modify', 'Fillet');
    await u.click({ x: 50, y: 0 });
    await u.click({ x: 20, y: 10 });
    await u.press('Enter');
    expect(await curveList<Arc>(u, 'arc')).toHaveLength(1);
    expect(await curveList<Circle>(u, 'circle')).toHaveLength(1);
  });

  test('M-F27 A HUD value field takes a click', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 60 });
    await menu(u, 'modify', 'Fillet');
    await u.click({ x: 0, y: 20 });
    const input = page.locator('.hud-field input').first();
    await input.click();
    await expect(input).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('6');
    await u.press('Enter');
    const s = await u.sketch();
    expect(arcRadius(s, (await curveList<Arc>(u, 'arc'))[0])).toBeCloseTo(6, 3);
  });

  test('M-F22 Chamfer dimensions stand clear of the lines', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 50 });
    await modify(u, 'Distance And Angle Chamfer', 'Chamfer');
    await u.click({ x: -20, y: 10 });
    await u.click({ x: 10, y: 30 });
    await u.press('Enter');
    const s = await u.sketch();
    const dims = Object.values(s.dimensions);
    expect(dims.length).toBe(2);
    const dist = dims.find((d) => d.kind === 'distance');
    const angle = dims.find((d) => d.kind === 'angle');
    const [a, b] = [dist?.label as Xy, angle?.label as Xy];
    // Off the arm it measures, and off the other label.
    expect(Math.abs(a.y - 10)).toBeGreaterThan(1);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(5);
    const view = new View();
    Object.assign(view, await page.evaluate(() => window.__sketch.view));
    expect(layoutDimension(await u.design(), s, angle as Dimension, view)?.arcs[0].r).toBeGreaterThan(5);
    expect(Object.values(s.points).some((p) => p.shown)).toBe(true);
  });
});

test.describe('trim and extend', () => {
  test('M-F6 Trim keeps a line dimension at the new length', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -50, y: 0 }, { x: 50, y: 0 });
    await line(u, { x: 10, y: -30 }, { x: 10, y: 30 });
    await dimension(u, [{ x: -20, y: 0 }], { x: -20, y: -15 }, '100');
    await modify(u, 'Trim');
    await u.click({ x: 30, y: 0 });
    await exitTool(u);
    const s = await u.sketch();
    const dims = Object.values(s.dimensions);
    expect(dims).toHaveLength(1);
    expect(dims[0].value).toBeCloseTo(60, 3);
    expect(dims[0].driving).toBe(true);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('M-F6 Extend keeps a line dimension at the new length', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -50, y: 0 }, { x: 0, y: 0 });
    await line(u, { x: 30, y: -30 }, { x: 30, y: 30 });
    await dimension(u, [{ x: -20, y: 0 }], { x: -20, y: -15 }, '50');
    await modify(u, 'Extend');
    await u.click({ x: -3, y: 0 });
    await exitTool(u);
    const s = await u.sketch();
    const dims = Object.values(s.dimensions);
    expect(dims).toHaveLength(1);
    expect(dims[0].value).toBeCloseTo(80, 3);
  });

  test('M-F23 Trim keeps a T end on the piece that holds it', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 8 }, { x: 40, y: 8 });
    await line(u, { x: -10, y: 30 }, { x: -10, y: -30 });
    await line(u, { x: 0, y: 8 }, { x: 0, y: 40 });
    const before = await u.sketch();
    const mids = Object.values(before.constraints).filter((k) => k.type === 'midpoint');
    expect(mids).toHaveLength(1);
    const point = mids[0].refs[0];
    await modify(u, 'Trim');
    await u.click({ x: -25, y: 8 });
    await exitTool(u);
    const s = await u.sketch();
    expect(Object.values(s.constraints).some((k) => k.type === 'coincident' && k.refs.includes(point))).toBe(true);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('M-F25 Extend with nothing to reach says so plainly', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -50, y: 0 }, { x: 0, y: 0 });
    await modify(u, 'Extend');
    await u.click({ x: -3, y: 0 });
    expect(await note(u)).toContain('no intersection');
    expect(await note(u)).not.toContain('[');
  });

  test('M-F24 Break previews each end with a cross', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 20 }, { x: 40, y: 20 });
    await line(u, { x: 5, y: -10 }, { x: 5, y: 50 });
    await modify(u, 'Break');
    await u.move({ x: 25, y: 20 });
    await u.settle();
    const at = await u.screen({ x: 5, y: 20 });
    const red = async (dx: number, dy: number): Promise<boolean> => page.evaluate(([x, y]) => {
      const c = [...document.querySelectorAll('canvas')].find((k) => k.width > 100) as HTMLCanvasElement;
      const box = c.getBoundingClientRect();
      const k = c.width / box.width;
      const [r, g, b] = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(Math.round((x - box.left) * k), Math.round((y - box.top) * k), 1, 1).data;
      return r > g + 50 && r > b + 50;
    }, [at.x + dx, at.y + dy]);
    expect(await red(4, 4)).toBe(true);
    expect(await red(-4, 4)).toBe(true);
    expect(await red(0, 4)).toBe(false);
  });

  test('M-F24 Break of a circle links its arcs with a concentric constraint', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: 0, y: 0 }, { x: 20, y: 0 });
    await line(u, { x: -30, y: 5 }, { x: 30, y: 5 });
    await modify(u, 'Break');
    await u.click({ x: 0, y: 20 });
    await exitTool(u);
    const s = await u.sketch();
    expect(Object.values(s.constraints).some((k) => k.type === 'concentric')).toBe(true);
    expect(await curveList<Arc>(u, 'arc')).toHaveLength(2);
  });
});

test.describe('offset', () => {
  test('M-F14 Moving across the curve on the way to OK keeps the chosen side', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -100, y: 60 }, { x: -100, y: -60 });
    await u.tool('Offset');
    await u.click({ x: -100, y: 0 });
    await u.move({ x: -120, y: 0 });
    await page.waitForTimeout(250);
    const d = dialog(u, 'Offset');
    const button = await d.locator('.btn.primary').boundingBox();
    if (!button) throw new Error('no OK button');
    // The way a hand goes: across the curve, over the canvas, to the dialog.
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2, { steps: 12 });
    await page.mouse.down();
    await page.mouse.up();
    await u.settle();
    const s = await u.sketch();
    const out = (await u.lines()).find((l) => Math.abs(pointAt(s, l.a).x + 100) > 1) as Line;
    expect(pointAt(s, out.a).x).toBeCloseTo(-105, 3);
  });

  test('M-F15 With the dimension deleted, dragging the output changes the distance', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 30 }, { x: 40, y: 30 });
    await u.tool('Offset');
    await u.click({ x: 0, y: 30 });
    await u.move({ x: 0, y: 10 });
    await page.keyboard.press('Enter');
    await u.settle();
    await u.tool('Select');
    let s = await u.sketch();
    const dim = Object.values(s.dimensions)[0];
    await u.click(dim.label);
    await u.press('Delete');
    const out = (await u.lines()).find((l) => Math.abs(pointAt(s, l.a).y - 30) > 1) as Line;
    const y0 = pointAt(s, out.a).y;
    expect(Math.abs(y0 - 25)).toBeLessThan(1e-3);
    expect((await u.analysis()).dof).toBeGreaterThan(0);
    await u.drag({ x: 0, y: y0 }, { x: 0, y: 10 });
    s = await u.sketch();
    const after = Object.values(s.features)[0];
    expect(after.type === 'offset' && after.dimension).toBe(null);
    const moved = s.curves[(after as { outputs: string[] }).outputs[0]] as Line;
    expect(pointAt(s, moved.a).y).toBeCloseTo(10, 1);
    expect(pointAt(s, moved.b).y).toBeCloseTo(10, 1);
  });

  test('M-F16 Match Topology limits the distance so no segment vanishes', async ({ page }) => {
    const u = await start(page);
    await rectangle(u, { x: 0, y: 0 }, { x: 40, y: 10 });
    await u.tool('Offset');
    await u.click({ x: 20, y: 10 });
    await u.move({ x: 20, y: 5 });
    const d = dialog(u, 'Offset');
    await field(d, 'Distance').fill('8 mm');
    await field(d, 'Match Topology').check();
    await d.locator('.btn.primary').hover();
    await page.keyboard.press('Enter');
    await u.settle();
    const s = await u.sketch();
    const f = Object.values(s.features)[0];
    expect(f.type).toBe('offset');
    if (f.type === 'offset') {
      expect(f.outputs).toHaveLength(4);
      expect(f.distance).toBeLessThan(5.01);
      expect(f.distance).toBeGreaterThan(4.9);
    }
  });

  test('M-F34 An offset cannot reference a Driven dimension, and a distance too large says so', async ({ page }) => {
    const u = await start(page);
    await rectangle(u, { x: -30, y: -30 }, { x: 30, y: 30 });
    await dimension(u, [{ x: 0, y: -30 }], { x: 0, y: -45 }, '60');
    await dimension(u, [{ x: 30, y: 0 }], { x: 45, y: 0 }, '60');
    await u.press('d');
    await u.click({ x: 0, y: 30 });
    await u.click({ x: 0, y: 48 });
    await exitTool(u);
    const driven = Object.values((await u.sketch()).dimensions).find((m) => !m.driving);
    await circle(u, { x: 100, y: 0 }, { x: 110, y: 0 });
    await u.tool('Offset');
    await u.click({ x: 110, y: 0 });
    await u.move({ x: 103, y: 0 });
    const d = dialog(u, 'Offset');
    if (driven) {
      await field(d, 'Distance').fill(`${driven.name}/2`);
      await u.settle();
      await expect(d.locator('.btn.primary')).toBeDisabled();
    }
    await field(d, 'Distance').fill('50 mm');
    await u.settle();
    await u.move({ x: 103, y: 0 });
    await page.keyboard.press('Enter');
    await u.settle();
    expect(await note(u)).toContain('too large');
    await expect(d).toBeVisible();
  });
});

test.describe('dimensions', () => {
  test('M-F11 A slanted line offers horizontal and vertical by where the mouse goes', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 0, y: 0 }, { x: 40, y: 30 });
    await u.press('d');
    await u.click({ x: 20, y: 15 });
    await u.click({ x: 20, y: 60 });
    await u.press('Enter');
    await exitTool(u);
    let s = await u.sketch();
    expect(Object.values(s.dimensions)[0].kind).toBe('horizontal');
    expect(Object.values(s.dimensions)[0].value).toBeCloseTo(40, 3);
    await u.press('Control+z');
    await u.press('d');
    await u.click({ x: 20, y: 15 });
    await u.click({ x: 70, y: 15 });
    await u.press('Enter');
    await exitTool(u);
    s = await u.sketch();
    expect(Object.values(s.dimensions)[0].kind).toBe('vertical');
    expect(Object.values(s.dimensions)[0].value).toBeCloseTo(30, 3);
  });

  test('M-F12 Tangent dimension from a line to a circle rim holds', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -50, y: -40 }, { x: 50, y: -40 });
    await circle(u, { x: 0, y: 0 }, { x: 15, y: 0 });
    await u.press('d');
    await u.click({ x: 20, y: -40 });
    await u.click({ x: 0, y: -15 });
    await u.rightClick({ x: 40, y: 20 });
    await page.locator('.marking-list [data-item="dim-tangent"]').click();
    await u.settle();
    await u.click({ x: 40, y: 20 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('10');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const [d] = Object.values(s.dimensions);
    expect(d.kind).toBe('tangentLine');
    const [c] = await curveList<Circle>(u, 'circle');
    const [l] = await u.lines();
    const gap = Math.abs(pointAt(s, c.c).y - pointAt(s, l.a).y) - c.r;
    expect(gap).toBeCloseTo(10, 3);
    expect(c.r).toBeCloseTo(15, 3);
  });

  test('M-F31 The editor shows name and value, goes red as text goes bad, and Toggle reads Driving on a Driven', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 0, y: 0 }, { x: 50, y: 0 });
    await u.press('d');
    await u.click({ x: 25, y: 0 });
    await u.click({ x: 25, y: -20 });
    await expect(page.locator('.hud-field.editor .hud-pill')).toContainText('d1 : ');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('10+');
    await expect(page.locator('.hud-field.editor')).toHaveClass(/invalid/);
    await page.keyboard.type('5');
    await expect(page.locator('.hud-field.editor')).not.toHaveClass(/invalid/);
    await u.press('Enter');
    await exitTool(u);
    const label = Object.values((await u.sketch()).dimensions)[0].label;
    await marking(u, label, 'toggle-driven');
    await u.rightClick(label);
    await expect(page.locator('.marking-list [data-item="toggle-driven"]')).toHaveText(/Toggle Driving/);
  });

  test('W-P2-5 A dimension placed on an origin axis is placed', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: 0, y: 0 }, { x: 20, y: 0 });
    await u.press('d');
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 50, y: 0 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('62');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    expect(Object.values(s.dimensions)).toHaveLength(1);
    expect(Object.values(s.dimensions)[0].kind).toBe('diameter');
    expect((await curveList<Circle>(u, 'circle'))[0].r).toBeCloseTo(31, 3);
  });

  test('C-F15 Dimension to a centerline is a diameter by default', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 0 }, { x: 40, y: 10 });
    await line(u, { x: -40, y: 40 }, { x: 40, y: 50 });
    await marking2(u, { x: 20, y: 7.5 });
    await u.press('Escape');
    await u.press('d');
    await u.click({ x: 20, y: 7.5 });
    await u.click({ x: 20, y: 47.5 });
    await u.click({ x: 60, y: 20 });
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const [d] = Object.values(s.dimensions);
    expect(d.kind).toBe('diameter');
    expect(d.value).toBeGreaterThan(70);
  });
});

/** Normal/Centerline from the marking menu's ring. */
async function marking2(u: SketchUser, at: Xy): Promise<void> {
  await marking(u, at, 'toggle-centerline');
}

test.describe('constraint tools', () => {
  test('M-F21 Symmetry takes ellipses and splines', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 7, y: -60 }, { x: 7, y: 60 });
    await menu(u, 'create', 'Ellipse');
    await u.click({ x: 30, y: 20 });
    await u.click({ x: 50, y: 20 });
    await u.click({ x: 30, y: 30 });
    await exitTool(u);
    await menu(u, 'create', 'Ellipse');
    await u.click({ x: -40, y: 25 });
    await u.click({ x: -60, y: 25 });
    await u.click({ x: -40, y: 35 });
    await exitTool(u);
    await constrain(u, 'Symmetry');
    await u.click({ x: 30 + 20 * Math.SQRT1_2, y: 20 + 10 * Math.SQRT1_2 });
    await u.click({ x: -40 - 20 * Math.SQRT1_2, y: 25 + 10 * Math.SQRT1_2 });
    await u.click({ x: 7, y: 50 });
    const s = await u.sketch();
    expect(Object.values(s.constraints).filter((k) => k.type === 'symmetric')).toHaveLength(1);
    const [a, b] = await curveList<Ellipse>(u, 'ellipse');
    expect(pointAt(s, b.c).x - 7).toBeCloseTo(7 - pointAt(s, a.c).x, 3);
    expect(pointAt(s, b.c).y).toBeCloseTo(pointAt(s, a.c).y, 3);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('M-F33 Symmetry preselected with the line first still mirrors across the line', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 0, y: -40 }, { x: 0, y: 40 });
    await circle(u, { x: 20, y: 10 }, { x: 30, y: 10 });
    await circle(u, { x: -25, y: 15 }, { x: -15, y: 15 });
    await u.click({ x: 0, y: 30 });
    await u.click({ x: 30, y: 10 }, { shift: true });
    await u.click({ x: -15, y: 15 }, { shift: true });
    await constrain(u, 'Symmetry');
    const s = await u.sketch();
    const [a, b] = await curveList<Circle>(u, 'circle');
    expect(pointAt(s, a.c).x).toBeCloseTo(-pointAt(s, b.c).x, 3);
    expect(pointAt(s, a.c).y).toBeCloseTo(pointAt(s, b.c).y, 3);
    const k = Object.values(s.constraints).find((c) => c.type === 'symmetric');
    expect(s.curves[k?.refs[2] as string]?.type).toBe('line');
  });

  test('M-F29 Midpoint takes a circle and a line', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 0 }, { x: 40, y: 0 });
    await circle(u, { x: 10, y: 40 }, { x: 25, y: 40 });
    await line(u, { x: -20, y: -30 }, { x: 40, y: -30 });
    await constrain(u, 'Midpoint');
    await u.click({ x: -20, y: 0 });
    await u.click({ x: 25, y: 40 });
    await exitTool(u);
    let s = await u.sketch();
    const [c] = await curveList<Circle>(u, 'circle');
    expect(pointAt(s, c.c).x).toBeCloseTo(0, 3);
    expect(pointAt(s, c.c).y).toBeCloseTo(0, 3);
    expect(c.r).toBeCloseTo(15, 3);
    await constrain(u, 'Midpoint');
    await u.click({ x: -20, y: 0 });
    await u.click({ x: 0, y: -30 });
    await exitTool(u);
    s = await u.sketch();
    const moved = (await u.lines())[1];
    const mid = { x: (pointAt(s, moved.a).x + pointAt(s, moved.b).x) / 2, y: (pointAt(s, moved.a).y + pointAt(s, moved.b).y) / 2 };
    expect(mid.x).toBeCloseTo(0, 3);
    expect(mid.y).toBeCloseTo(0, 3);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('M-F32 Re-applying H/V adds nothing', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 0, y: 10 }, { x: 40, y: 10 });
    const count = async (): Promise<number> => Object.values((await u.sketch()).constraints).filter((k) => k.type === 'horizontal').length;
    const before = await count();
    await constrain(u, 'Horizontal/Vertical');
    await u.click({ x: 20, y: 10 });
    expect(await count()).toBe(before);
    expect(await note(u)).toContain('already');
  });

  test('M-F9 Curvature with a line on a fit spline is real G2', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 20 }, { x: -5, y: 22 });
    await menu(u, 'create', 'Fit Point Spline', 'Spline');
    await u.click({ x: -5, y: 22 });
    await u.click({ x: 20, y: 35 });
    await u.click({ x: 45, y: 25 });
    await u.press('Enter');
    await exitTool(u);
    await constrain(u, 'Curvature');
    await u.click({ x: -22.5, y: 21 });
    await u.click({ x: 20, y: 35 });
    expect(await note(u)).not.toMatch(/G1/);
    const s = await u.sketch();
    const [sp] = await curveList<FitSpline>(u, 'fitSpline');
    const [l] = await u.lines();
    const pc = resolve(s, sp);
    const t = unitTangent(pc, 0);
    const d = dirOf(s, l);
    expect(Math.abs(t.x * d.y - t.y * d.x) / Math.hypot(d.x, d.y)).toBeLessThan(1e-3);
    expect(Math.abs(curvatureAt(pc, 0))).toBeLessThan(1e-3);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('M-F10 The constraint tool shows its glyph beside the cursor', async ({ page }) => {
    const u = await start(page);
    const at = { x: 40, y: 40 };
    await u.move(at);
    const clip = async (): Promise<Buffer> => {
      const s = await u.screen(at);
      return page.screenshot({ clip: { x: s.x + 6, y: s.y + 6, width: 26, height: 26 } });
    };
    const bare = await clip();
    await constrain(u, 'Parallel');
    await u.move(at);
    await u.settle();
    expect(Buffer.compare(bare, await clip())).not.toBe(0);
  });
});

test.describe('move, autoconstrain, panels', () => {
  test('M-F38 Moving one side of a rectangle keeps it joined', async ({ page }) => {
    const u = await start(page);
    await rectangle(u, { x: -30, y: -20 }, { x: 30, y: 20 });
    await u.click({ x: 0, y: 20 });
    await u.tool('Select');
    await u.click({ x: 0, y: 20 });
    await u.press('m');
    const d = dialog(u, 'Move/Copy');
    await field(d, 'Y Distance').fill('10 mm');
    await ok(u, d);
    const s = await u.sketch();
    for (const l of await u.lines()) expect(lengthOf(s, l)).toBeGreaterThan(30);
    const ys = Object.values(s.points).map((p) => p.y);
    expect(Math.max(...ys)).toBeCloseTo(30, 3);
    const coincident = Object.values(s.constraints).filter((k) => k.type === 'coincident').length;
    expect(coincident).toBeGreaterThanOrEqual(4);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('M-F20 AutoConstrain has Start Over, and tiles that differ', async ({ page }) => {
    const u = await start(page);
    await rectangle(u, { x: 10, y: 10 }, { x: 70, y: 50 });
    await constrain(u, 'AutoConstrain');
    const d = dialog(u, 'AutoConstrain');
    const titles = await d.locator('.auto-counts').evaluateAll((els) => els.map((e) => (e as HTMLElement).title));
    const names = await d.locator('.auto-tile-name').allTextContents();
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(titles).size).toBeGreaterThan(1);
    const proposed = await page.evaluate(() => document.querySelectorAll('.auto-tile').length);
    expect(proposed).toBeGreaterThanOrEqual(3);
    await d.locator('[data-action="auto-start-over"]').click();
    await u.settle();
    expect(await d.locator('.auto-tile').count()).toBeGreaterThan(0);
  });

  test('M-F26 AutoConstrain is in the Sketch Palette and under Automate', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 0, y: 0 }, { x: 60, y: 0 });
    await page.locator('.panel[data-panel="automate"] .panel-name').click();
    await expect(page.locator('.menu-item[data-item="AutoConstrain"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('.palette-link', { hasText: 'AutoConstrain' }).click();
    await expect(dialog(u, 'AutoConstrain')).toBeVisible();
  });

  test('M-F28 Hide fully constrained while finding', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 0, y: 0 }, { x: 40, y: 0 });
    await page.locator('.palette-link', { hasText: 'Find Under-Constrained' }).click();
    await expect(page.locator('.palette-row', { hasText: 'Hide Fully Constrained' })).toBeVisible();
  });

  test('M-F37 Modify menu is in the page\'s order', async ({ page }) => {
    const u = await start(page);
    await page.locator('.panel[data-panel="modify"] .panel-name').click();
    const items = await page.locator('.menu-item').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.item));
    await u.settle();
    expect(items.indexOf('Sketch Scale')).toBeLessThan(items.indexOf('Offset'));
    expect(items.indexOf('Offset')).toBeLessThan(items.indexOf('Blend Curve'));
  });
});

test('M-F30 Sketch Scale takes the base point without a click on its field', async ({ page }) => {
  const u = await start(page);
  await line(u, { x: 10, y: 10 }, { x: 40, y: 10 });
  await modify(u, 'Sketch Scale');
  await u.click({ x: 25, y: 10 });
  await u.click({ x: 10, y: 10 });
  const d = dialog(u, 'Sketch Scale');
  await field(d, 'Scale Factor').fill('2');
  await ok(u, d);
  const s = await u.sketch();
  const [l] = await u.lines();
  expect(lengthOf(s, l)).toBeCloseTo(60, 3);
  expect(pointAt(s, l.a).x).toBeCloseTo(10, 3);
});

test.describe('display details', () => {
  test('C-F12 A slot\'s typed angle is drawn at the slot, clear of the other labels', async ({ page }) => {
    const u = await start(page);
    await menu(u, 'create', 'Center To Center Slot', 'Slot');
    await u.click({ x: -20, y: -10 });
    await u.move({ x: 20, y: 5 });
    await page.keyboard.type('50');
    await page.keyboard.press('Tab');
    await page.keyboard.type('15');
    await u.press('Enter');
    await u.move({ x: 20, y: 20 });
    await page.keyboard.type('20');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const d = Object.values(s.dimensions).find((m) => m.kind === 'angle') as Dimension;
    const view = new View();
    Object.assign(view, await page.evaluate(() => window.__sketch.view));
    const layout = layoutDimension(await u.design(), s, d, view);
    const centre = layout?.arcs[0].c as Xy;
    expect(Math.hypot(centre.x + 20, centre.y + 10)).toBeLessThan(1e-3);
    for (const other of Object.values(s.dimensions)) {
      if (other === d) continue;
      const a = view.toScreen(d.label);
      const b = view.toScreen(other.label);
      expect(Math.abs(a.x - b.x) > 50 || Math.abs(a.y - b.y) > 16).toBe(true);
    }
  });

  test('M-F35 Show Dimensions works while editing another sketch, and a click there inserts the name', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -40, y: 20 }, { x: 40, y: 20 });
    await dimension(u, [{ x: 0, y: 20 }], { x: 0, y: 30 }, '80');
    const first = Object.values((await u.sketch()).dimensions)[0];
    await page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await u.settle();
    await u.newSketch();
    await page.locator('.tree-row', { hasText: 'Sketch1' }).first().click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Show Dimensions' }).click();
    await u.settle();
    await line(u, { x: -40, y: -20 }, { x: 40, y: -20 });
    await u.press('d');
    await u.click({ x: 0, y: -20 });
    await u.click({ x: 0, y: -35 });
    await u.click(first.label);
    await expect(page.locator('.hud-field.editor input')).toHaveValue(new RegExp(first.name));
  });

  test('M-F36 A blend hides its control points and puts its badges at the joins', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: -50, y: 20 }, { x: -10, y: 20 });
    await line(u, { x: 10, y: 40 }, { x: 50, y: 40 });
    await modify(u, 'Blend Curve');
    await u.click({ x: -12, y: 20 });
    await u.click({ x: 12, y: 40 });
    await exitTool(u);
    const s = await u.sketch();
    const [b] = await curveList<ControlSpline>(u, 'controlSpline');
    expect(b.blend).toBe(true);
    const view = new View();
    Object.assign(view, await page.evaluate(() => window.__sketch.view));
    const spots = layoutBadges(s, view).filter((g) => g.type === 'tangent').map((g) => view.toWorld({ x: g.x, y: g.y }));
    expect(spots).toHaveLength(2);
    expect(Math.hypot(spots[0].x - spots[1].x, spots[0].y - spots[1].y)).toBeGreaterThan(15);
  });

  test('M-F24 Picking an ellipse near its axis shows the axis in the preview, and away from it does not', async ({ page }) => {
    const u = await start(page);
    await menu(u, 'create', 'Ellipse');
    await u.click({ x: 30, y: 20 });
    await u.click({ x: 60, y: 20 });
    await u.click({ x: 30, y: 35 });
    await exitTool(u);
    /** Preview-blue pixels along the major axis, well inside the ellipse. */
    const onAxis = async (pick: Xy): Promise<number> => {
      await u.tool('Offset');
      await u.click(pick);
      await u.move({ x: 45, y: 26 });
      await u.settle();
      const a = await u.screen({ x: 34, y: 20 });
      const b = await u.screen({ x: 52, y: 20 });
      const count = await page.evaluate(([x0, x1, y]) => {
        const c = [...document.querySelectorAll('canvas')].find((k) => k.width > 100) as HTMLCanvasElement;
        const box = c.getBoundingClientRect();
        const k = c.width / box.width;
        const row = (c.getContext('2d') as CanvasRenderingContext2D).getImageData((x0 - box.left) * k, (y - box.top) * k - 1, (x1 - x0) * k, 3).data;
        let n = 0;
        for (let i = 0; i < row.length; i += 4) if (row[i + 2] > row[i] + 80) n++;
        return n;
      }, [a.x, b.x, a.y]);
      await page.keyboard.press('Escape');
      await u.settle();
      return count;
    };
    expect(await onAxis({ x: 30 + 30 * Math.cos(1.4), y: 20 + 15 * Math.sin(1.4) })).toBeGreaterThan(0);
    expect(await onAxis({ x: 30 + 30 * Math.SQRT1_2, y: 20 + 15 * Math.SQRT1_2 })).toBe(0);
  });
});

test.describe('splines, projection, text', () => {
  test('C-F2 Tangent drag on a Control Point Spline keeps the clicks and stays tangent', async ({ page }) => {
    const u = await start(page);
    await line(u, { x: 0, y: -40 }, { x: 0, y: -20 });
    await menu(u, 'create', 'Control Point Spline', 'Spline');
    await u.drag({ x: 0, y: -20 }, { x: 10, y: -10 });
    for (const p of [{ x: 20, y: -15 }, { x: 30, y: -30 }, { x: 50, y: -30 }]) await u.click(p);
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const [sp] = await curveList<ControlSpline>(u, 'controlSpline');
    expect((await u.analysis()).unsatisfied).toEqual([]);
    const pts = sp.pts.map((id) => pointAt(s, id));
    for (const p of [{ x: 20, y: -15 }, { x: 30, y: -30 }, { x: 50, y: -30 }]) {
      expect(pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-3)).toBe(true);
    }
    expect(Math.abs(pts[1].x - pts[0].x)).toBeLessThan(1e-3);
  });

  test('C-F7 Change Spline Degree offers 1 to 9', async ({ page }) => {
    const u = await start(page);
    await menu(u, 'create', 'Control Point Spline', 'Spline');
    const options = page.locator('.palette-row', { hasText: 'Spline Degree' }).locator('select option');
    await expect(options).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    await page.locator('.palette-row', { hasText: 'Spline Degree' }).locator('select').selectOption('2');
    for (const p of [{ x: -40, y: 0 }, { x: -20, y: 30 }, { x: 0, y: 0 }, { x: 20, y: 30 }]) await u.click(p);
    await u.press('Enter');
    const [sp] = await curveList<ControlSpline>(u, 'controlSpline');
    expect(sp.degree).toBe(2);
  });

  test('C-F16 Project takes a sketch point', async ({ page }) => {
    const u = await start(page);
    await menu(u, 'create', 'Point');
    await u.click({ x: -50, y: 0 });
    await exitTool(u);
    await u.page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await u.settle();
    await u.newSketch();
    await menu(u, 'create', 'Project', 'Project / Include');
    await u.click({ x: -50, y: 0 });
    const d = dialog(u, 'Project');
    await ok(u, d);
    const s = await u.sketch();
    expect(Object.values(s.curves)).toHaveLength(0);
    expect(Object.values(s.points).filter((p) => Math.abs(p.x + 50) < 1e-6)).toHaveLength(1);
  });

  const projectedCircle = async (u: SketchUser): Promise<void> => {
    await circle(u, { x: 0, y: 0 }, { x: 20, y: 0 });
    await u.page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await u.settle();
    await u.newSketch();
    await menu(u, 'create', 'Project', 'Project / Include');
    await u.click({ x: 20, y: 0 });
    await ok(u, dialog(u, 'Project'));
    await exitTool(u);
  };

  test('C-F17 Break Link frees a projected curve', async ({ page }) => {
    const u = await start(page);
    await projectedCircle(u);
    await marking(u, { x: 0, y: 20 }, 'break-link');
    const [c] = await curveList<Circle>(u, 'circle');
    expect(c.projected).toBeUndefined();
    await u.drag({ x: 20, y: 0 }, { x: 30, y: 0 });
    const [after] = await curveList<Circle>(u, 'circle');
    expect(after.r).toBeCloseTo(30, 1);
  });

  test('C-F17 Manage Lost Projections: Break Link, Delete Geometry and Delete All, from a lost curve', async ({ page }) => {
    const u = await start(page);
    await projectedCircle(u);
    await page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await u.settle();
    const design = await u.design();
    const [source] = design.order;
    await page.locator('.tree-row', { hasText: design.sketches[source].name }).first().dblclick();
    await u.settle();
    await u.tool('Select');
    await u.click({ x: 0, y: 20 });
    await u.press('Delete');
    await page.getByRole('button', { name: 'Finish Sketch' }).first().click();
    await u.settle();
    const other = (await u.design()).order[1];
    await page.locator('.tree-row', { hasText: (await u.design()).sketches[other].name }).first().dblclick();
    await u.settle();
    await marking(u, { x: 0, y: 20 }, 'manage-lost-projections');
    const d = dialog(u, 'Manage Lost Projections');
    await expect(d.locator('.lost-row')).toHaveCount(1);
    await d.locator('[data-action="break-link"]').click();
    await u.settle();
    await expect(d.locator('.lost-row')).toHaveCount(0);
    const [c] = await curveList<Circle>(u, 'circle');
    expect(c.projected).toBeUndefined();
  });

  test('C-F11 Text has text and height parameters in Change Parameters', async ({ page }) => {
    const u = await start(page);
    await menu(u, 'create', 'Text');
    await u.click({ x: -30, y: 0 });
    await u.click({ x: 30, y: 20 });
    const t = dialog(u, 'Text');
    await t.locator('textarea').fill('Hi');
    await ok(u, t);
    await exitTool(u);
    await modify(u, 'Change Parameters');
    const d = dialog(u, 'Parameters');
    await expect(d.locator('.param-row[data-param="Text1_text"] input')).toHaveValue('Hi');
    const height = d.locator('.param-row[data-param="Text1_height"] input');
    await height.fill('12 mm');
    await height.blur();
    await d.locator('.param-row[data-param="Text1_text"] input').fill('Yo');
    await d.locator('.param-row[data-param="Text1_text"] input').blur();
    await ok(u, d);
    const [text] = await u.curves('text');
    expect(text.type === 'text' && text.height).toBeCloseTo(12, 6);
    expect(text.type === 'text' && text.text).toBe('Yo');
  });
});
