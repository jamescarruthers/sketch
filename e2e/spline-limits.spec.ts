// A point pulling a spline and a fit spline reaching G2, through the real tools. Curvature is measured
// with the app's own curve maths from the document the page holds.
import { expect, test, type Page } from '@playwright/test';
import { constraintsOfType, pointAt, SketchUser, type Xy } from './helpers';
import type { Arc, ControlSpline, FitSpline, Sketch } from '../src/model/types';
import { curvatureAt, resolve } from '../src/geom/curves';

const start = async (page: Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  return u;
};

async function pick(u: SketchUser, label: string, flyout?: string): Promise<void> {
  const { page } = u;
  const pinned = page.locator(`.tool-btn[aria-label="${label}"]`);
  if (await pinned.count()) await pinned.first().click();
  else {
    await page.getByRole('button', { name: /^CREATE/ }).click();
    if (flyout) await page.locator(`.menu-item.flyout[data-item="${flyout}"]`).hover();
    await page.locator(`.menu-item[data-item="${label}"]`).click();
  }
  await u.settle();
}

const exitTool = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

async function spline(u: SketchUser, pts: Xy[], kind = 'Fit Point Spline'): Promise<void> {
  await pick(u, kind, 'Spline');
  for (const p of pts) await u.click(p);
  await u.press('Enter');
  await u.press('Escape');
}

/** Curvature magnitude where a curve meets `at`, from the end that is there. */
function endKappa(s: Sketch, id: string, ends: [string, string], at: Xy): number {
  const pc = resolve(s, s.curves[id]);
  const d = (e: string): number => Math.hypot(pointAt(s, e).x - at.x, pointAt(s, e).y - at.y);
  return Math.abs(curvatureAt(pc, d(ends[0]) < d(ends[1]) ? 0 : 1));
}

function gap(s: Sketch, id: string, p: Xy): number {
  const pc = resolve(s, s.curves[id]);
  let best = Infinity;
  for (let i = 0; i <= 8000; i++) {
    const q = pc.at(i / 8000);
    best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return best;
}

async function arcAndSpline(u: SketchUser): Promise<void> {
  await pick(u, '3-Point Arc', 'Arc');
  await u.click({ x: 10, y: 0 });
  await u.click({ x: 50, y: 0 });
  await u.click({ x: 30, y: 20 });
  await exitTool(u);
}

test('curvature: a fit spline meets an arc in true G2', async ({ page }) => {
  const u = await start(page);
  await arcAndSpline(u);
  await spline(u, [{ x: 50, y: 0 }, { x: 70, y: 25 }, { x: 90, y: 0 }]);
  await pick(u, 'Curvature');
  await u.click({ x: 30, y: 20 });
  await u.click({ x: 70, y: 25 });
  await exitTool(u);
  const s = await u.sketch();
  expect(constraintsOfType(s, 'curvature')).toBe(1);
  const a = await u.analysis();
  expect(a.ok).toBe(true);
  const [fit] = Object.values(s.curves).filter((c): c is FitSpline => c.type === 'fitSpline');
  const [arc] = Object.values(s.curves).filter((c): c is Arc => c.type === 'arc');
  const r = Math.hypot(pointAt(s, arc.a).x - pointAt(s, arc.c).x, pointAt(s, arc.a).y - pointAt(s, arc.c).y);
  const joint = pointAt(s, fit.pts[0]);
  const k = endKappa(s, fit.id, [fit.pts[0], fit.pts[fit.pts.length - 1]], joint);
  expect(Math.abs(k - 1 / r)).toBeLessThan(1e-5);
});

test('curvature: a fit spline meets a control spline in true G2', async ({ page }) => {
  const u = await start(page);
  await spline(u, [{ x: 50, y: 0 }, { x: 70, y: 25 }, { x: 90, y: 0 }]);
  await spline(u, [{ x: 50, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 15 }, { x: 0, y: 40 }], 'Control Point Spline');
  await pick(u, 'Curvature');
  await u.click({ x: 70, y: 25 });
  const s0 = await u.sketch();
  const [ctrl0] = Object.values(s0.curves).filter((c): c is ControlSpline => c.type === 'controlSpline');
  const on = resolve(s0, ctrl0).at(0.5);
  await u.click(on);
  await exitTool(u);
  const s = await u.sketch();
  expect((await u.analysis()).ok).toBe(true);
  const [fit] = Object.values(s.curves).filter((c): c is FitSpline => c.type === 'fitSpline');
  const [ctrl] = Object.values(s.curves).filter((c): c is ControlSpline => c.type === 'controlSpline');
  const joint = pointAt(s, fit.pts[0]);
  const a = endKappa(s, fit.id, [fit.pts[0], fit.pts[fit.pts.length - 1]], joint);
  const b = endKappa(s, ctrl.id, [ctrl.pts[0], ctrl.pts[ctrl.pts.length - 1]], joint);
  expect(a).toBeGreaterThan(1e-4);
  expect(Math.abs(a - b)).toBeLessThan(1e-5);
});

test('a point on a spline pulls it when dragged', async ({ page }) => {
  const u = await start(page);
  await spline(u, [{ x: -60, y: 0 }, { x: -20, y: 30 }, { x: 20, y: 0 }, { x: 60, y: 30 }]);
  await pick(u, 'Point');
  await u.click({ x: 7, y: 43 });
  await exitTool(u);
  const s0 = await u.sketch();
  const [fit0] = Object.values(s0.curves).filter((c): c is FitSpline => c.type === 'fitSpline');
  const pid = Object.values(s0.points).find((p) => Math.hypot(p.x - 7, p.y - 43) < 1e-6)?.id as string;
  await pick(u, 'Coincident');
  await u.click({ x: 7, y: 43 });
  await u.click({ x: -20, y: 30 });
  await exitTool(u);
  const s1 = await u.sketch();
  const p1 = pointAt(s1, pid);
  // Riding, a point is on the chords between samples, not quite on the curve.
  expect(gap(s1, fit0.id, p1)).toBeLessThan(1e-2);
  const before = fit0.pts.map((id) => ({ ...pointAt(s1, id) }));
  const to = { x: p1.x + 2, y: p1.y + 9 };
  await u.drag(p1, to, 12);
  const s2 = await u.sketch();
  const p2 = pointAt(s2, pid);
  expect(Math.hypot(p2.x - to.x, p2.y - to.y)).toBeLessThan(1);
  expect(gap(s2, fit0.id, p2)).toBeLessThan(1e-2);
  const most = Math.max(...fit0.pts.map((id, i) => Math.hypot(pointAt(s2, id).x - before[i].x, pointAt(s2, id).y - before[i].y)));
  expect(most).toBeGreaterThan(0.5);
  expect((await u.analysis()).ok).toBe(true);
});

/** Arc, fit spline, Curvature, and the spline selected so its handles show. Returns what the drag needs. */
async function g2Joint(u: SketchUser): Promise<{ fit: FitSpline; arc: Arc; handle: string }> {
  await arcAndSpline(u);
  await spline(u, [{ x: 50, y: 0 }, { x: 70, y: 25 }, { x: 90, y: 0 }]);
  await pick(u, 'Curvature');
  await u.click({ x: 30, y: 20 });
  await u.click({ x: 70, y: 25 });
  await exitTool(u);
  const s = await u.sketch();
  const [fit] = Object.values(s.curves).filter((c): c is FitSpline => c.type === 'fitSpline');
  const [arc] = Object.values(s.curves).filter((c): c is Arc => c.type === 'arc');
  await u.click(pointAt(s, fit.pts[1]));
  return { fit, arc, handle: fit.handles[0] as string };
}

function g2Gap(s: Sketch, fit: FitSpline, arc: Arc): number {
  const r = Math.hypot(pointAt(s, arc.a).x - pointAt(s, arc.c).x, pointAt(s, arc.a).y - pointAt(s, arc.c).y);
  return Math.abs(endKappa(s, fit.id, [fit.pts[0], fit.pts[fit.pts.length - 1]], pointAt(s, fit.pts[0])) - 1 / r);
}

const points = (s: Sketch): Record<string, [number, number]> =>
  Object.fromEntries(Object.values(s.points).map((p) => [p.id, [p.x, p.y]]));

for (const [name, offset] of [['along its length', 1.6], ['shorter', 0.6], ['across the tangent', null]] as const) {
  test(`a handle at a G2 fit end, dragged ${name}: G2 holds and Undo is exact`, async ({ page }) => {
    const u = await start(page);
    const { fit, arc, handle } = await g2Joint(u);
    const s0 = await u.sketch();
    const before = points(s0);
    const joint = { ...pointAt(s0, fit.pts[0]) };
    const tip = { ...pointAt(s0, handle) };
    const to = offset === null
      ? { x: tip.x + (joint.y - tip.y) * 0.3, y: tip.y + (tip.x - joint.x) * 0.3 }
      : { x: joint.x + (tip.x - joint.x) * offset, y: joint.y + (tip.y - joint.y) * offset };
    await u.drag(tip, to, 10);
    const s1 = await u.sketch();
    expect((await u.analysis()).ok).toBe(true);
    expect(g2Gap(s1, fit, arc)).toBeLessThan(1e-5);
    // The arc here is pinned to the axis, so the tangent cannot turn: across it, only length can change.
    const changed = JSON.stringify(points(s1)) !== JSON.stringify(before);
    if (offset !== null) expect(changed).toBe(true);
    const j1 = pointAt(s1, fit.pts[0]);
    expect(Math.hypot(j1.x - joint.x, j1.y - joint.y)).toBeLessThan(1e-6);
    expect(pointAt(s1, fit.pts[2])).toMatchObject({ x: pointAt(s0, fit.pts[2]).x, y: pointAt(s0, fit.pts[2]).y });
    if (offset !== null) {
      const h1 = pointAt(s1, handle);
      expect(Math.hypot(h1.x - to.x, h1.y - to.y)).toBeLessThan(1e-3);
    }
    // No drift: nothing moves when the mouse stops, or on a commit that changes nothing.
    await u.settle();
    expect(points(await u.sketch())).toEqual(points(s1));
    // Not stuck: the next press is a new drag of something else.
    await u.press('Escape');
    const far = pointAt(s1, fit.pts[2]);
    await u.drag(far, { x: far.x + 5, y: far.y - 3 }, 6);
    const s2 = await u.sketch();
    expect(pointAt(s2, fit.pts[2]).x).toBeCloseTo(far.x + 5, 3);
    expect(g2Gap(s2, fit, arc)).toBeLessThan(1e-5);
    await u.press('ControlOrMeta+z');
    expect(points(await u.sketch())).toEqual(points(s1));
    if (changed) {
      await u.press('ControlOrMeta+z');
      expect(points(await u.sketch())).toEqual(before);
    }
  });
}
