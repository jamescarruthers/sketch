// Create and Constraint tools, driven with real mouse and keyboard events. Geometry is asserted
// numerically from the read-only window.__sketch handle.
import { expect, test, type Page } from '@playwright/test';
import { constraintsOfType, pointAt, SketchUser, type Xy } from './helpers';
import type { Arc, Circle, Conic, ControlSpline, Curve, Ellipse, FitSpline, Line, Sketch } from '../src/model/types';
import { curvatureAt, resolve } from '../src/geom/curves';

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

/** Pick a tool as a user would: its ribbon button if pinned, else the Create menu (and flyout). */
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

const dist = (a: Xy, b: Xy): number => Math.hypot(a.x - b.x, a.y - b.y);
const deg = (r: number): number => (r * 180) / Math.PI;

/** Solver status: nothing unsatisfied; `dof` 0 means fully defined. */
async function expectSolved(u: SketchUser, dof?: number): Promise<void> {
  const a = await u.analysis();
  expect(a.unsatisfied).toEqual([]);
  expect(a.ok).toBe(true);
  if (dof !== undefined) expect(a.dof).toBe(dof);
}

const radiusOf = (s: Sketch, id: string): number => {
  const c = s.curves[id];
  if (c.type === 'circle') return c.r;
  if (c.type === 'arc') return dist(pointAt(s, c.c), pointAt(s, c.a));
  throw new Error(`no radius for ${c.type}`);
};
const centreOf = (s: Sketch, id: string): Xy => {
  const c = s.curves[id];
  if (c.type === 'circle' || c.type === 'arc') return pointAt(s, c.c);
  throw new Error(`no centre for ${c.type}`);
};
/** Distance from a point to the infinite line through a stored line. */
const lineDistance = (s: Sketch, lineId: string, p: Xy): number => {
  const l = s.curves[lineId] as Line;
  const a = pointAt(s, l.a);
  const b = pointAt(s, l.b);
  return Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / dist(a, b);
};
/** How far a tangent constraint is from holding: 0 when it does. */
function tangentError(s: Sketch, refs: string[]): number {
  const [a, b] = refs.map((r) => s.curves[r]);
  if (a.type === 'line' && b.type !== 'line') return Math.abs(lineDistance(s, a.id, centreOf(s, b.id)) - radiusOf(s, b.id));
  if (b.type === 'line' && a.type !== 'line') return Math.abs(lineDistance(s, b.id, centreOf(s, a.id)) - radiusOf(s, a.id));
  if (a.type === 'line' && b.type === 'line') {
    const l = b as Line;
    return Math.max(lineDistance(s, a.id, pointAt(s, l.a)), lineDistance(s, a.id, pointAt(s, l.b)));
  }
  const d = dist(centreOf(s, a.id), centreOf(s, b.id));
  const r1 = radiusOf(s, a.id);
  const r2 = radiusOf(s, b.id);
  return Math.min(Math.abs(d - (r1 + r2)), Math.abs(d - Math.abs(r1 - r2)));
}
const expectTangents = (s: Sketch): void => {
  for (const k of Object.values(s.constraints)) if (k.type === 'tangent') expect(tangentError(s, k.refs)).toBeLessThan(1e-6);
};

const dimsByKind = (s: Sketch, kind: string) => Object.values(s.dimensions).filter((d) => d.kind === kind);
const curvesOf = <T extends Curve>(s: Sketch, type: T['type']): T[] => Object.values(s.curves).filter((c): c is T => c.type === type);

test.describe('arcs', () => {
  test('3-point arc: typed distance, typed radius, constraints', async ({ page }) => {
    const u = await start(page);
    await pick(u, '3-Point Arc', 'Arc');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 30, y: 0 });
    await u.type('40');
    await u.press('Enter');
    await u.move({ x: 20, y: 30 });
    await u.type('25');
    await u.shot('arc-3pt-hud');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const [arc] = curvesOf<Arc>(s, 'arc');
    expect(arc).toBeTruthy();
    const a = pointAt(s, arc.a);
    const b = pointAt(s, arc.b);
    const c = pointAt(s, arc.c);
    expect(dist(a, b)).toBeCloseTo(40, 4);
    expect(dist(c, a)).toBeCloseTo(25, 4);
    expect(dist(c, b)).toBeCloseTo(25, 4);
    expect(dimsByKind(s, 'radius')).toHaveLength(1);
    expect(dimsByKind(s, 'distance')).toHaveLength(1);
    expect(constraintsOfType(s, 'coincident')).toBe(1);
    await expectSolved(u);
  });
});

/** Draw a chain of lines with the Line tool, then leave it. */
async function chain(u: SketchUser, pts: Xy[]): Promise<void> {
  await u.press('l');
  for (const p of pts) await u.click(p);
  await exitTool(u);
}

test.describe('tangent circles', () => {
  test('2-tangent circle with a typed radius touches both lines', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: 10, y: 0 }, { x: 70, y: 0 }]);
    await chain(u, [{ x: 0, y: 10 }, { x: 0, y: 70 }]);
    await pick(u, '2-Tangent Circle', 'Circle');
    await u.click({ x: 50, y: 0 });
    await u.click({ x: 0, y: 50 });
    await u.move({ x: 30, y: 30 });
    await u.type('12');
    await u.shot('circle-2tan');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const [c] = curvesOf<Circle>(s, 'circle');
    expect(c.r).toBeCloseTo(12, 4);
    const m = pointAt(s, c.c);
    expect(m.x).toBeCloseTo(12, 4);
    expect(m.y).toBeCloseTo(12, 4);
    expect(constraintsOfType(s, 'tangent')).toBe(2);
    expect(dimsByKind(s, 'radius')).toHaveLength(1);
    await expectSolved(u);
  });

  test('3-tangent circle by window select is the incircle', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 0, y: 45 }, { x: 0, y: 0 }]);
    await pick(u, '3-Tangent Circle', 'Circle');
    await u.drag({ x: -15, y: -12 }, { x: 75, y: 60 });
    await exitTool(u);
    const s = await u.sketch();
    const [c] = curvesOf<Circle>(s, 'circle');
    expect(c.r).toBeCloseTo(15, 4);
    expect(pointAt(s, c.c).x).toBeCloseTo(15, 4);
    expect(pointAt(s, c.c).y).toBeCloseTo(15, 4);
    expect(constraintsOfType(s, 'tangent')).toBe(3);
    await u.shot('circle-3tan');
    await expectSolved(u);
  });
});

test.describe('polygons', () => {
  test('circumscribed hexagon: typed radius and sides, tangent at midpoints', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Circumscribed Polygon', 'Polygon');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 20, y: 0 });
    await u.type('20');
    await u.press('Tab');
    await u.type('6');
    await u.shot('polygon-circumscribed-hud');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const lines = Object.values(s.curves).filter((c): c is Line => c.type === 'line');
    const [circle] = curvesOf<Circle>(s, 'circle');
    expect(lines).toHaveLength(6);
    expect(circle.lineType).toBe('construction');
    expect(circle.r).toBeCloseTo(20, 5);
    const R = 20 / Math.cos(Math.PI / 6);
    for (const l of lines) {
      const a = pointAt(s, l.a);
      const b = pointAt(s, l.b);
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(R, 5);
      expect(dist(a, b)).toBeCloseTo(R, 5);
      // Tangent at the midpoint: the midpoint is on the circle.
      expect(Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2)).toBeCloseTo(20, 5);
    }
    // The cursor pointed along +X: an edge midpoint sits at (20, 0).
    expect(lines.some((l) => Math.abs((pointAt(s, l.a).x + pointAt(s, l.b).x) / 2 - 20) < 1e-5)).toBe(true);
    expect(constraintsOfType(s, 'tangent')).toBe(6);
    expect(constraintsOfType(s, 'equal')).toBe(5);
    expect(dimsByKind(s, 'radius')).toHaveLength(1);
    // Centre and radius are fixed; only the orientation is left, as in Fusion.
    await expectSolved(u, 1);
  });

  test('inscribed pentagon: vertex follows the cursor', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Inscribed Polygon', 'Polygon');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 0, y: 25 });
    await u.type('15');
    await u.press('Tab');
    await u.type('5');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const lines = Object.values(s.curves).filter((c): c is Line => c.type === 'line');
    expect(lines).toHaveLength(5);
    const tops = lines.map((l) => pointAt(s, l.a)).filter((p) => Math.abs(p.x) < 1e-5);
    expect(tops).toHaveLength(1);
    expect(tops[0].y).toBeCloseTo(15, 5);
    const side = 2 * 15 * Math.sin(Math.PI / 5);
    for (const l of lines) expect(dist(pointAt(s, l.a), pointAt(s, l.b))).toBeCloseTo(side, 5);
    expect(constraintsOfType(s, 'equal')).toBe(4);
    await expectSolved(u, 1);
  });

  test('edge polygon: typed edge length and angle, side by mouse, fully defined', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Edge Polygon', 'Polygon');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 15, y: 10 });
    await u.type('20');
    await u.press('Tab');
    await u.type('30');
    await u.press('Enter');
    await u.move({ x: -10, y: 22 });
    await u.type('6');
    await u.shot('polygon-edge-hud');
    await u.click({ x: -10, y: 22 });
    await exitTool(u);
    const s = await u.sketch();
    const lines = Object.values(s.curves).filter((c): c is Line => c.type === 'line');
    expect(lines).toHaveLength(6);
    const a = pointAt(s, lines[0].a);
    const b = pointAt(s, lines[0].b);
    expect(a.x).toBeCloseTo(0, 5);
    expect(b.x).toBeCloseTo(20 * Math.cos(Math.PI / 6), 5);
    expect(b.y).toBeCloseTo(10, 5);
    const [circle] = curvesOf<Circle>(s, 'circle');
    expect(circle.r).toBeCloseTo(20, 5);
    const centre = pointAt(s, circle.c);
    // The hexagon stands on the left of the edge direction.
    expect(centre.x).toBeCloseTo(10 * Math.cos(Math.PI / 6) - (20 / (2 * Math.tan(Math.PI / 6))) * 0.5, 4);
    expect(dimsByKind(s, 'distance')).toHaveLength(1);
    expect(dimsByKind(s, 'angle')).toHaveLength(1);
    await expectSolved(u, 0);
  });
});

test.describe('ellipse', () => {
  test('typed axis length, angle and minor length; construction axes; fully defined', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Ellipse');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 30, y: 10 });
    await u.type('30');
    await u.press('Tab');
    await u.type('40');
    await u.press('Enter');
    await u.move({ x: -5, y: 20 });
    await u.type('12');
    await u.shot('ellipse-hud');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const [e] = curvesOf<Ellipse>(s, 'ellipse');
    const c = pointAt(s, e.c);
    const major = pointAt(s, e.major);
    const minor = pointAt(s, e.minor);
    expect(dist(c, major)).toBeCloseTo(30, 5);
    expect(dist(c, minor)).toBeCloseTo(12, 5);
    expect(deg(Math.atan2(major.y - c.y, major.x - c.x))).toBeCloseTo(40, 4);
    expect((major.x - c.x) * (minor.x - c.x) + (major.y - c.y) * (minor.y - c.y)).toBeCloseTo(0, 5);
    const axes = Object.values(s.curves).filter((k) => k.type === 'line');
    expect(axes).toHaveLength(2);
    expect(axes.every((l) => l.lineType === 'construction')).toBe(true);
    expect(dimsByKind(s, 'ellipseAxis')).toHaveLength(2);
    expect(dimsByKind(s, 'angle')).toHaveLength(1);
    await expectSolved(u, 0);
  });

  test('a clicked point on the ellipse sets the minor axis and snaps coincident', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 20, y: 10 });
    await u.click({ x: 40, y: 10 });
    await exitTool(u);
    await pick(u, 'Ellipse');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 30, y: 0 });
    // Ellipse through the free end of the line: x = 20 gives minor = 10 / sqrt(1 - (20/30)^2).
    await u.click({ x: 20, y: 10 });
    await exitTool(u);
    const s = await u.sketch();
    const [e] = curvesOf<Ellipse>(s, 'ellipse');
    const b = dist(pointAt(s, e.c), pointAt(s, e.minor));
    expect(b).toBeCloseTo(10 / Math.sqrt(1 - (20 / 30) ** 2), 4);
    expect(Object.values(s.constraints).some((k) => k.type === 'coincident' && k.refs.includes(e.id))).toBe(true);
    await expectSolved(u);
  });
});

test.describe('slots', () => {
  test('center to center: typed distance, angle and width; fully defined', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Center To Center Slot', 'Slot');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 30, y: 8 });
    await u.type('40');
    await u.press('Tab');
    await u.type('20');
    await u.press('Enter');
    await u.move({ x: 18, y: 18 });
    await u.type('10');
    await u.shot('slot-c2c-hud');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const arcs = curvesOf<Arc>(s, 'arc');
    const lines = Object.values(s.curves).filter((c): c is Line => c.type === 'line' && c.lineType === 'normal');
    expect(arcs).toHaveLength(2);
    expect(lines).toHaveLength(2);
    expect(Object.values(s.curves).filter((c) => c.lineType === 'construction')).toHaveLength(1);
    for (const a of arcs) expect(radiusOf(s, a.id)).toBeCloseTo(5, 5);
    const [c1, c2] = arcs.map((a) => pointAt(s, a.c)).sort((p, q) => p.x - q.x);
    expect(dist(c1, c2)).toBeCloseTo(40, 5);
    expect(deg(Math.atan2(c2.y - c1.y, c2.x - c1.x))).toBeCloseTo(20, 4);
    for (const l of lines) expect(lineDistance(s, l.id, c1)).toBeCloseTo(5, 5);
    expect(constraintsOfType(s, 'tangent')).toBe(4);
    expectTangents(s);
    expect(dimsByKind(s, 'diameter')).toHaveLength(1);
    await expectSolved(u, 0);
  });

  test('overall slot: the typed length runs end to end', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Overall Slot', 'Slot');
    await u.click({ x: -30, y: 10 });
    await u.move({ x: 20, y: 11 });
    await u.type('60');
    await u.press('Tab');
    await u.type('15');
    await u.press('Enter');
    await u.move({ x: 0, y: 22 });
    await u.type('16');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const arcs = curvesOf<Arc>(s, 'arc');
    for (const a of arcs) expect(radiusOf(s, a.id)).toBeCloseTo(8, 5);
    const centres = arcs.map((a) => pointAt(s, a.c));
    expect(dist(centres[0], centres[1])).toBeCloseTo(60 - 16, 3);
    const [l, r] = centres.sort((p, q) => p.x - q.x);
    expect(deg(Math.atan2(r.y - l.y, r.x - l.x))).toBeCloseTo(15, 4);
    expectTangents(s);
    // Position is not dimensioned, so the two translations stay free.
    await expectSolved(u, 2);
  });

  test('center point slot: midpoint on the origin, fully defined', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Center Point Slot', 'Slot');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 20, y: 5 });
    await u.type('25');
    await u.press('Tab');
    await u.type('10');
    await u.press('Enter');
    await u.move({ x: 5, y: 15 });
    await u.type('8');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const arcs = curvesOf<Arc>(s, 'arc');
    const cs = arcs.map((a) => pointAt(s, a.c));
    expect((cs[0].x + cs[1].x) / 2).toBeCloseTo(0, 5);
    expect((cs[0].y + cs[1].y) / 2).toBeCloseTo(0, 5);
    expect(dist(cs[0], cs[1])).toBeCloseTo(50, 5);
    for (const a of arcs) expect(radiusOf(s, a.id)).toBeCloseTo(4, 5);
    expect(constraintsOfType(s, 'midpoint')).toBe(1);
    expectTangents(s);
    await expectSolved(u, 0);
  });

  test('three point arc slot: radius, width, concentric arcs', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Three Point Arc Slot', 'Slot');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 38, y: 12 });
    await u.type('40');
    await u.press('Enter');
    await u.move({ x: 20, y: 12 });
    await u.type('30');
    await u.press('Enter');
    await u.move({ x: 20, y: 30 });
    await u.type('8');
    await u.shot('slot-3pt-hud');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const arcs = curvesOf<Arc>(s, 'arc');
    expect(arcs).toHaveLength(5);
    const radii = arcs.map((a) => radiusOf(s, a.id)).sort((p, q) => p - q);
    expect(radii[0]).toBeCloseTo(4, 4);
    expect(radii[1]).toBeCloseTo(4, 4);
    expect(radii[2]).toBeCloseTo(26, 4);
    expect(radii[3]).toBeCloseTo(30, 4);
    expect(radii[4]).toBeCloseTo(34, 4);
    expect(constraintsOfType(s, 'concentric')).toBe(2);
    expect(constraintsOfType(s, 'tangent')).toBe(4);
    expectTangents(s);
    // Rotation about the first centre is not dimensioned.
    await expectSolved(u, 1);
  });

  test('center point arc slot: typed radius, angle, sweep and width; fully defined', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Center Point Arc Slot', 'Slot');
    await u.click({ x: 0, y: 0 });
    await u.move({ x: 25, y: 10 });
    await u.type('30');
    await u.press('Tab');
    await u.type('20');
    await u.press('Enter');
    await u.move({ x: 20, y: 30 });
    await u.type('70');
    await u.press('Enter');
    await u.move({ x: 22, y: 22 });
    await u.type('8');
    await u.shot('slot-center-arc-hud');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const arcs = curvesOf<Arc>(s, 'arc').filter((a) => a.lineType === 'normal');
    expect(arcs).toHaveLength(4);
    const radii = arcs.map((a) => radiusOf(s, a.id)).sort((p, q) => p - q);
    expect(radii.map((r) => Number(r.toFixed(4)))).toEqual([4, 4, 26, 34]);
    const caps = arcs.filter((a) => radiusOf(s, a.id) < 5).map((a) => pointAt(s, a.c));
    const angles = caps.map((p) => deg(Math.atan2(p.y, p.x))).sort((p, q) => p - q);
    expect(angles[0]).toBeCloseTo(20, 4);
    expect(angles[1] - angles[0]).toBeCloseTo(70, 4);
    expect(dimsByKind(s, 'angle')).toHaveLength(2);
    expectTangents(s);
    await expectSolved(u, 0);
  });
});

test.describe('point and conic', () => {
  test('points are explicit and repeat; a click on a line is coincident with it', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: -20, y: 20 });
    await u.click({ x: 40, y: 20 });
    await exitTool(u);
    await pick(u, 'Point');
    await u.click({ x: 10, y: -10 });
    await u.click({ x: 25, y: -30 });
    await u.click({ x: 20, y: 20.2 });
    await u.click({ x: 10, y: 20.2 });
    await exitTool(u);
    const s = await u.sketch();
    const points = Object.values(s.points).filter((p) => p.explicit);
    expect(points).toHaveLength(4);
    expect(points.some((p) => Math.abs(p.x - 25) < 1e-6 && Math.abs(p.y + 30) < 1e-6)).toBe(true);
    const onLine = Object.values(s.constraints).filter((k) => k.type === 'coincident' && k.refs.some((r) => s.curves[r]));
    expect(onLine).toHaveLength(1);
    expect(points.find((p) => Math.abs(p.x - 20) < 1e-3 && p.y > 0)?.y).toBeCloseTo(20, 5);
    expect(constraintsOfType(s, 'midpoint')).toBe(1);
    await expectSolved(u);
  });

  test('conic: typed rho puts the shoulder where it says', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Conic Curve');
    await u.click({ x: -30, y: 10 });
    await u.click({ x: 30, y: 10 });
    await u.click({ x: 0, y: 50 });
    await u.move({ x: 0, y: 30 });
    await u.type('0.3');
    await u.shot('conic-hud');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const [k] = curvesOf<Conic>(s, 'conic');
    expect(k.rho).toBeCloseTo(0.3, 6);
    const a = pointAt(s, k.a);
    const b = pointAt(s, k.b);
    const v = pointAt(s, k.v);
    expect(a.x).toBeCloseTo(-30, 6);
    expect(v.y).toBeCloseTo(50, 6);
    // The curve's middle sits rho of the way from the chord midpoint to the vertex.
    const w = k.rho / (1 - k.rho);
    const mid = { x: ((a.x + b.x) / 2 + w * v.x) / (1 + w), y: ((a.y + b.y) / 2 + w * v.y) / (1 + w) };
    expect(mid.y).toBeCloseTo(10 + 0.3 * 40, 6);
    await expectSolved(u);
  });

  test('conic: rho by mouse, then Enter ends the tool', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Conic Curve');
    await u.click({ x: -30, y: 10 });
    await u.click({ x: 30, y: 10 });
    await u.click({ x: 0, y: 50 });
    await u.move({ x: 0, y: 30 });
    await u.click({ x: 0, y: 30 });
    await u.press('Enter');
    const [k] = curvesOf<Conic>(await u.sketch(), 'conic');
    expect(k.rho).toBeCloseTo(0.5, 3);
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');
  });
});

/** Pixels on the canvas within a few levels of an RGB colour. */
async function countColour(page: Page, [r, g, b]: [number, number, number]): Promise<number> {
  return page.evaluate(([cr, cg, cb]) => {
    const canvas = document.querySelector('canvas.canvas') as HTMLCanvasElement;
    const data = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - cr) < 12 && Math.abs(data[i + 1] - cg) < 12 && Math.abs(data[i + 2] - cb) < 12) n++;
    }
    return n;
  }, [r, g, b]);
}

/** Right-click and choose from the marking menu's list. */
async function menu(u: SketchUser, at: Xy, item: string): Promise<void> {
  await u.rightClick(at);
  await u.page.locator(`.marking-list .menu-item[data-item="${item}"]`).click();
  await u.settle();
}

const splinePoints = (s: Sketch, sp: FitSpline | ControlSpline): Xy[] => sp.pts.map((id) => pointAt(s, id));

test.describe('splines', () => {
  test('fit point spline: check icon, Enter, and click-start-to-close', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Fit Point Spline', 'Spline');
    for (const p of [{ x: -50, y: 10 }, { x: -30, y: 30 }, { x: -10, y: 10 }, { x: 10, y: 30 }]) await u.click(p);
    await u.shot('spline-fit-open');
    await page.locator('.hud-check').click();
    await u.settle();
    for (const p of [{ x: 20, y: -20 }, { x: 40, y: -40 }, { x: 60, y: -20 }]) await u.click(p);
    await u.press('Enter');
    for (const p of [{ x: 30, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 40 }, { x: 30, y: 40 }]) await u.click(p);
    await u.click({ x: 30, y: 20 });
    await exitTool(u);
    const s = await u.sketch();
    const splines = curvesOf<FitSpline>(s, 'fitSpline');
    expect(splines).toHaveLength(3);
    const [first, second, third] = splines;
    expect(splinePoints(s, first)).toEqual([{ x: -50, y: 10 }, { x: -30, y: 30 }, { x: -10, y: 10 }, { x: 10, y: 30 }].map((p) => expect.objectContaining(p)));
    expect(first.closed).toBe(false);
    expect(first.pts).toHaveLength(4);
    expect(second.pts).toHaveLength(3);
    expect(second.closed).toBe(false);
    expect(third.closed).toBe(true);
    expect(third.pts).toHaveLength(4);
    expect(pointAt(s, third.pts[0]).x).toBeCloseTo(30, 6);
    expect(pointAt(s, third.pts[3]).y).toBeCloseTo(40, 6);
    await expectSolved(u);
  });

  test('control point spline: palette degree, default 5', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Control Point Spline', 'Spline');
    await expect(page.locator('.palette-row', { hasText: 'Spline Degree' }).locator('select')).toHaveValue('5');
    for (const p of [{ x: -40, y: 10 }, { x: -20, y: 40 }, { x: 0, y: 10 }, { x: 20, y: 40 }, { x: 40, y: 10 }, { x: 60, y: 30 }]) await u.click(p);
    await u.press('Enter');
    await pick(u, 'Control Point Spline', 'Spline');
    await page.locator('.palette-row', { hasText: 'Spline Degree' }).locator('select').selectOption('3');
    for (const p of [{ x: -40, y: -10 }, { x: -20, y: -40 }, { x: 0, y: -10 }, { x: 20, y: -40 }]) await u.click(p);
    await page.locator('.hud-check').click();
    await exitTool(u);
    const s = await u.sketch();
    const [a, b] = curvesOf<ControlSpline>(s, 'controlSpline');
    expect(a.degree).toBe(5);
    expect(a.pts).toHaveLength(6);
    expect(b.degree).toBe(3);
    expect(b.pts).toHaveLength(4);
    expect(pointAt(s, b.pts[3])).toMatchObject({ x: 20, y: -40 });
    await u.shot('spline-control');
    await expectSolved(u);
  });

  test('start on a curve end and drag: handle, coincident and tangent', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: -60, y: 20 }, { x: -20, y: 20 }]);
    await pick(u, 'Fit Point Spline', 'Spline');
    await u.drag({ x: -20, y: 20 }, { x: 0, y: 20 });
    await u.click({ x: 20, y: 50 });
    await u.click({ x: 50, y: 20 });
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const [sp] = curvesOf<FitSpline>(s, 'fitSpline');
    const [line] = Object.values(s.curves).filter((c): c is Line => c.type === 'line');
    expect(sp.pts).toHaveLength(3);
    expect(sp.handles[0]).not.toBeNull();
    const p0 = pointAt(s, sp.pts[0]);
    const h = pointAt(s, sp.handles[0] as string);
    expect(dist(p0, pointAt(s, line.b))).toBeLessThan(1e-6);
    // The handle lies along the line's direction, so the spline leaves tangent to it.
    expect(Math.abs((h.y - p0.y) * 40 - (h.x - p0.x) * 0)).toBeLessThan(1e-6);
    expect(h.x).toBeGreaterThan(p0.x);
    expect(Object.values(s.constraints).some((k) => k.type === 'tangent' && k.refs.includes(line.id) && k.refs.includes(sp.id))).toBe(true);
    expect(Object.values(s.constraints).some((k) => k.type === 'coincident' && k.refs.includes(sp.pts[0]))).toBe(true);
    await u.shot('spline-tangent-start');
    await expectSolved(u);
  });

  test('selected spline: curvature comb, density and degree change in the palette', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Control Point Spline', 'Spline');
    for (const p of [{ x: -50, y: 10 }, { x: -25, y: 50 }, { x: 0, y: 10 }, { x: 25, y: 50 }, { x: 50, y: 10 }]) await u.click(p);
    await u.press('Enter');
    await u.press('Escape');
    await u.press('Control+a');
    const comb: [number, number, number] = [164, 93, 224];
    const before = await countColour(page, comb);
    const row = page.locator('.palette-row', { hasText: 'Curvature Comb' }).locator('input');
    await row.check();
    await u.settle();
    const after = await countColour(page, comb);
    expect(before).toBe(0);
    expect(after).toBeGreaterThan(100);
    await u.shot('spline-comb');
    await row.uncheck();
    await u.settle();
    expect(await countColour(page, comb)).toBe(0);

    const degree = page.locator('.palette-row', { hasText: 'Change Spline Degree' }).locator('select');
    await expect(degree).toHaveValue('5');
    const was = (await u.sketch()).curves;
    const [old] = Object.values(was).filter((c): c is ControlSpline => c.type === 'controlSpline');
    await degree.selectOption('3');
    await u.settle();
    const s = await u.sketch();
    const [sp] = curvesOf<ControlSpline>(s, 'controlSpline');
    expect(sp.degree).toBe(3);
    expect(sp.pts[0]).toBe(old.pts[0]);
    expect(pointAt(s, sp.pts[sp.pts.length - 1])).toMatchObject({ x: 50, y: 10 });
    expect(sp.pts).toHaveLength(4);
    await expectSolved(u);
  });

  test('right-click: close and open, insert a fit point, activate and drag a curvature handle', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Fit Point Spline', 'Spline');
    for (const p of [{ x: -30, y: 10 }, { x: 0, y: 10 }, { x: 30, y: 10 }]) await u.click(p);
    await u.press('Enter');
    await u.press('Escape');

    await menu(u, { x: 15, y: 10.1 }, 'spline-insert-fit');
    let s = await u.sketch();
    let [sp] = curvesOf<FitSpline>(s, 'fitSpline');
    expect(sp.pts).toHaveLength(4);
    expect(pointAt(s, sp.pts[2]).x).toBeCloseTo(15, 3);
    expect(pointAt(s, sp.pts[2]).y).toBeCloseTo(10, 6);

    await menu(u, { x: -15, y: 10.1 }, 'spline-close');
    s = await u.sketch();
    expect(curvesOf<FitSpline>(s, 'fitSpline')[0].closed).toBe(true);
    await u.shot('spline-closed');
    await menu(u, { x: 0, y: 10.1 }, 'spline-open');
    s = await u.sketch();
    expect(curvesOf<FitSpline>(s, 'fitSpline')[0].closed).toBe(false);

    // The point at x = 0 is a fit point: give it a tangent handle, then move the handle.
    await menu(u, { x: 0, y: 10 }, 'spline-handle-on');
    s = await u.sketch();
    [sp] = curvesOf<FitSpline>(s, 'fitSpline');
    const handleId = sp.handles[1] as string;
    expect(handleId).toBeTruthy();
    const h = pointAt(s, handleId);
    expect(h.y).toBeCloseTo(10, 5);
    expect(h.x).toBeGreaterThan(0);
    await u.press('Escape');
    await u.drag(h, { x: h.x, y: 30 });
    s = await u.sketch();
    expect(pointAt(s, handleId).y).toBeCloseTo(30, 3);
    expect(pointAt(s, sp.pts[1])).toMatchObject({ x: 0, y: 10 });
    await u.shot('spline-handle');
    await menu(u, pointAt(s, handleId), 'spline-handle-off');
    s = await u.sketch();
    [sp] = curvesOf<FitSpline>(s, 'fitSpline');
    expect(sp.handles.every((x) => x === null)).toBe(true);
    expect(s.points[handleId]).toBeUndefined();
    await expectSolved(u);
  });
});

// ---------------------------------------------------------------------------
// Constraints: each one on a small sketch, then the relationship itself to 1e-6.

async function circle(u: SketchUser, c: Xy, r: number): Promise<void> {
  await pick(u, 'Center Diameter Circle', 'Circle');
  await u.click(c);
  await u.click({ x: c.x + r, y: c.y });
  await exitTool(u);
}

async function spline(u: SketchUser, pts: Xy[], kind: 'Fit Point Spline' | 'Control Point Spline' = 'Fit Point Spline'): Promise<void> {
  await pick(u, kind, 'Spline');
  for (const p of pts) await u.click(p);
  await u.press('Enter');
  await u.press('Escape');
}

/** Curvature magnitude at the start of the only fit spline, by the app's own curve. */
const fitStartKappa = (s: Sketch): number => Math.abs(curvatureAt(resolve(s, curvesOf<FitSpline>(s, 'fitSpline')[0]), 0));
const conicMid = (s: Sketch, k: Conic): Xy => resolve(s, s.curves[k.id]).at(0.5);

const lineEnds = (s: Sketch, l: Line): [Xy, Xy] => [pointAt(s, l.a), pointAt(s, l.b)];
const lineByIndex = (s: Sketch, i: number): Line => Object.values(s.curves).filter((c): c is Line => c.type === 'line' && c.lineType === 'normal')[i];
/** A point a fraction of the way along a-b, for clicking on a line. */
const along = (a: Xy, b: Xy, t: number): Xy => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const cross2 = (a: Xy, b: Xy): number => a.x * b.y - a.y * b.x;
const dir = (l: [Xy, Xy]): Xy => ({ x: l[1].x - l[0].x, y: l[1].y - l[0].y });

test.describe('constraints', () => {
  test('tangent: line and circle, the first pick stays', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: -30, y: 10 }, { x: 30, y: 10 }]);
    await circle(u, { x: 20, y: 40 }, 8);
    await pick(u, 'Tangent');
    // Hovering only lights valid targets: a line then a second line is not one.
    await u.click({ x: -20, y: 10 });
    await u.click({ x: 20, y: 48 });
    await exitTool(u);
    const s = await u.sketch();
    const [c] = curvesOf<Circle>(s, 'circle');
    const l = lineByIndex(s, 0);
    expect(constraintsOfType(s, 'tangent')).toBe(1);
    expect(lineEnds(s, l)).toEqual([expect.objectContaining({ x: -30, y: 10 }), expect.objectContaining({ x: 30, y: 10 })]);
    expect(Math.abs(Math.abs(pointAt(s, c.c).y - 10) - c.r)).toBeLessThan(1e-6);
    expectTangents(s);
    await expectSolved(u);
  });

  test('tangent: circles pick external or internal contact from where they are', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: -40, y: -30 }, 12);
    await circle(u, { x: 10, y: -30 }, 8);
    await circle(u, { x: 45, y: 35 }, 22);
    await circle(u, { x: 52, y: 35 }, 6);
    await pick(u, 'Tangent');
    await u.click({ x: -40, y: -18 });
    await u.click({ x: 10, y: -22 });
    await u.click({ x: 45, y: 57 });
    await u.click({ x: 52, y: 41 });
    await exitTool(u);
    const s = await u.sketch();
    const ks = Object.values(s.constraints).filter((k) => k.type === 'tangent');
    expect(ks).toHaveLength(2);
    expect(ks.map((k) => k.variant).sort()).toEqual([0, 1]);
    expectTangents(s);
    await expectSolved(u);
  });

  test('tangent with a spline: only a touching end is a valid pick, and the fit end gets a handle', async ({ page }) => {
    const u = await start(page);
    await spline(u, [{ x: -50, y: 20 }, { x: -30, y: 50 }, { x: -10, y: 20 }]);
    await chain(u, [{ x: 20, y: -20 }, { x: 60, y: -40 }]);
    await pick(u, 'Tangent');
    await u.click({ x: 40, y: -30 });
    // The spline's ends are nowhere near this line: not a valid second pick.
    await u.move({ x: -30, y: 50 });
    await u.click({ x: -30, y: 50 });
    expect(constraintsOfType(await u.sketch(), 'tangent')).toBe(0);
    await exitTool(u);

    await chain(u, [{ x: -10, y: 20 }, { x: 20, y: 30 }]);
    await pick(u, 'Tangent');
    await u.click(along({ x: -10, y: 20 }, { x: 20, y: 30 }, 0.7));
    await u.click({ x: -30, y: 50 });
    await exitTool(u);
    const s = await u.sketch();
    const [sp] = curvesOf<FitSpline>(s, 'fitSpline');
    const touching = Object.values(s.curves).filter((c): c is Line => c.type === 'line' && c.lineType === 'normal')[1];
    expect(constraintsOfType(s, 'tangent')).toBe(1);
    const last = sp.handles[sp.pts.length - 1];
    expect(last).toBeTruthy();
    const e = pointAt(s, sp.pts[sp.pts.length - 1]);
    const h = pointAt(s, last as string);
    expect(Math.abs(cross2({ x: h.x - e.x, y: h.y - e.y }, dir(lineEnds(s, touching))))).toBeLessThan(1e-6);
    await expectSolved(u);
  });

  test('parallel: the second line turns to the first, which stays', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: -40, y: 10 }, { x: 20, y: 30 }]);
    await chain(u, [{ x: -30, y: -40 }, { x: 40, y: -10 }]);
    await pick(u, 'Parallel');
    // A circle is not a valid second pick; the line is.
    await u.click(along({ x: -40, y: 10 }, { x: 20, y: 30 }, 0.3));
    await u.click(along({ x: -30, y: -40 }, { x: 40, y: -10 }, 0.7));
    await exitTool(u);
    const s = await u.sketch();
    const a = lineEnds(s, lineByIndex(s, 0));
    const b = lineEnds(s, lineByIndex(s, 1));
    // Holds are soft, so the reference may settle by a billionth of a millimetre.
    expect(a[0].x).toBeCloseTo(-40, 6);
    expect(a[0].y).toBeCloseTo(10, 6);
    expect(a[1].x).toBeCloseTo(20, 6);
    expect(a[1].y).toBeCloseTo(30, 6);
    expect(cross2(dir(a), dir(b)) / (Math.hypot(dir(a).x, dir(a).y) * Math.hypot(dir(b).x, dir(b).y))).toBeCloseTo(0, 6);
    expect(constraintsOfType(s, 'parallel')).toBe(1);
    await expectSolved(u);
  });

  test('perpendicular: line to line, and a line through a circle', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: -40, y: 20 }, { x: 10, y: 30 }]);
    await chain(u, [{ x: -40, y: -40 }, { x: 10, y: -20 }]);
    // Preselect both, then the tool applies at once.
    await u.click({ x: -15, y: 25 });
    await u.click({ x: -15, y: -30 }, { shift: true });
    await pick(u, 'Perpendicular');
    let s = await u.sketch();
    const a = lineEnds(s, lineByIndex(s, 0));
    const b = lineEnds(s, lineByIndex(s, 1));
    expect(dir(a).x * dir(b).x + dir(a).y * dir(b).y).toBeCloseTo(0, 6);
    expect(a[0]).toMatchObject({ x: -40, y: 20 });
    expect(constraintsOfType(s, 'perpendicular')).toBe(1);

    await circle(u, { x: 50, y: -40 }, 10);
    await chain(u, [{ x: 30, y: 10 }, { x: 70, y: 30 }]);
    await pick(u, 'Perpendicular');
    await u.click({ x: 50, y: -30 });
    await u.click({ x: 50, y: 20 });
    await exitTool(u);
    s = await u.sketch();
    const [c] = curvesOf<Circle>(s, 'circle');
    const l = lineByIndex(s, 2);
    expect(lineDistance(s, l.id, pointAt(s, c.c))).toBeLessThan(1e-6);
    expect(constraintsOfType(s, 'perpendicular')).toBe(2);
    await expectSolved(u);
  });

  test('fix and unfix: green, immovable, and a second click releases it', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: -30, y: 20 }, { x: 30, y: 30 }]);
    const green: [number, number, number] = [26, 158, 75];
    expect(await countColour(page, green)).toBe(0);
    await pick(u, 'Fix/UnFix');
    await u.click({ x: 0, y: 25 });
    let s = await u.sketch();
    const l = lineByIndex(s, 0);
    expect(l.fixed).toBe(true);
    expect(s.points[l.a].fixed && s.points[l.b].fixed).toBe(true);
    expect(await countColour(page, green)).toBeGreaterThan(100);
    await u.shot('fix-green');
    await u.press('Escape');
    await u.drag({ x: 0, y: 25 }, { x: 20, y: 60 });
    s = await u.sketch();
    expect(lineEnds(s, lineByIndex(s, 0))[0]).toMatchObject({ x: -30, y: 20 });
    await pick(u, 'Fix/UnFix');
    await u.click({ x: 0, y: 25 });
    await exitTool(u);
    s = await u.sketch();
    expect(lineByIndex(s, 0).fixed).toBeUndefined();
    expect(Object.values(s.points).some((p) => p.fixed)).toBe(false);
    expect(await countColour(page, green)).toBe(0);
    await u.drag({ x: 0, y: 25 }, { x: 20, y: 60 });
    expect(lineEnds(await u.sketch(), lineByIndex(await u.sketch(), 0))[0].x).not.toBeCloseTo(-30, 1);
    await expectSolved(u);
  });

  test('midpoint: the line moves so the point is its middle', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: -30, y: 10 }, { x: 30, y: 20 }]);
    await pick(u, 'Point');
    await u.click({ x: 8, y: 45 });
    await exitTool(u);
    await pick(u, 'Midpoint');
    await u.click({ x: 8, y: 45 });
    await u.click({ x: -10, y: 13.3 });
    await exitTool(u);
    const s = await u.sketch();
    const p = Object.values(s.points).find((q) => q.explicit) as { x: number; y: number };
    const [a, b] = lineEnds(s, lineByIndex(s, 0));
    expect(p).toMatchObject({ x: 8, y: 45 });
    expect((a.x + b.x) / 2).toBeCloseTo(8, 6);
    expect((a.y + b.y) / 2).toBeCloseTo(45, 6);
    expect(constraintsOfType(s, 'midpoint')).toBe(1);
    await expectSolved(u);
  });

  test('midpoint of an arc, and an end of the curve is not a valid pick', async ({ page }) => {
    const u = await start(page);
    await pick(u, '3-Point Arc', 'Arc');
    await u.click({ x: -30, y: 15 });
    await u.click({ x: 30, y: 15 });
    await u.click({ x: 0, y: 40 });
    await exitTool(u);
    await pick(u, 'Point');
    await u.click({ x: 10, y: 55 });
    await exitTool(u);
    await pick(u, 'Midpoint');
    // The third click sat over the chord's middle, which adds a midpoint of its own [ref GUID-087596A4].
    const placed = constraintsOfType(await u.sketch(), 'midpoint');
    // The arc's own end cannot be its midpoint: nothing happens, and the pick is dropped.
    await u.click({ x: 30, y: 15 });
    await u.click({ x: -21.57, y: 31.07 });
    expect(constraintsOfType(await u.sketch(), 'midpoint')).toBe(placed);
    await u.press('Escape');
    await u.click({ x: 10, y: 55 });
    await u.click({ x: -21.57, y: 31.07 });
    await exitTool(u);
    const s = await u.sketch();
    const [arc] = curvesOf<Arc>(s, 'arc');
    const p = Object.values(s.points).find((q) => q.explicit) as Xy;
    const c = pointAt(s, arc.c);
    const a = pointAt(s, arc.a);
    const b = pointAt(s, arc.b);
    expect(dist(p, c)).toBeCloseTo(dist(a, c), 5);
    expect(dist(p, a)).toBeCloseTo(dist(p, b), 5);
    await expectSolved(u);
  });

  test('concentric: centres meet and the first circle stays', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: -30, y: 30 }, 15);
    await circle(u, { x: 30, y: -30 }, 10);
    await pick(u, 'Concentric');
    await u.click({ x: -15, y: 30 });
    await u.click({ x: 40, y: -30 });
    await exitTool(u);
    const s = await u.sketch();
    const [a, b] = curvesOf<Circle>(s, 'circle');
    expect(pointAt(s, a.c)).toMatchObject({ x: -30, y: 30 });
    expect(dist(pointAt(s, a.c), pointAt(s, b.c))).toBeLessThan(1e-6);
    expect(constraintsOfType(s, 'concentric')).toBe(1);
    await expectSolved(u);
  });

  test('collinear: the second line lies along the first', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: -40, y: 10 }, { x: -5, y: 25 }]);
    await chain(u, [{ x: 10, y: -30 }, { x: 45, y: 5 }]);
    await pick(u, 'Collinear');
    await u.click({ x: -22, y: 17.4 });
    await u.click({ x: 28, y: -12 });
    await exitTool(u);
    const s = await u.sketch();
    const first = lineByIndex(s, 0);
    const second = lineByIndex(s, 1);
    for (const p of lineEnds(s, second)) expect(lineDistance(s, first.id, p)).toBeLessThan(1e-6);
    expect(lineEnds(s, first)[0]).toMatchObject({ x: -40, y: 10 });
    expect(constraintsOfType(s, 'collinear')).toBe(1);
    await expectSolved(u);
  });

  test('symmetry: points, then lines, about a line; picks bind in order', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: 20, y: -50 }, { x: 20, y: 50 }]);
    await pick(u, 'Point');
    await u.click({ x: -10, y: 30 });
    await u.click({ x: 45, y: 10 });
    await exitTool(u);
    await pick(u, 'Symmetry');
    await u.click({ x: -10, y: 30 });
    await u.click({ x: 45, y: 10 });
    await u.click({ x: 20, y: -30 });
    await exitTool(u);
    let s = await u.sketch();
    const [p, q] = Object.values(s.points).filter((x) => x.explicit);
    const axis = lineByIndex(s, 0);
    expect(p).toMatchObject({ x: -10, y: 30 });
    expect((p.x + q.x) / 2).toBeCloseTo(20, 6);
    expect(p.y).toBeCloseTo(q.y, 6);
    const k = Object.values(s.constraints).find((c) => c.type === 'symmetric');
    expect(k?.refs).toEqual([Object.keys(s.points).find((id) => s.points[id] === p) ?? '', Object.keys(s.points).find((id) => s.points[id] === q) ?? '', axis.id]);

    await chain(u, [{ x: -50, y: -40 }, { x: -30, y: -20 }]);
    await chain(u, [{ x: 55, y: -45 }, { x: 70, y: -10 }]);
    await pick(u, 'Symmetry');
    await u.click({ x: -40, y: -30 });
    await u.click({ x: 62.5, y: -27.5 });
    await u.click({ x: 20, y: 40 });
    await exitTool(u);
    s = await u.sketch();
    const l1 = lineEnds(s, lineByIndex(s, 1));
    const l2 = lineEnds(s, lineByIndex(s, 2));
    expect(l1[0]).toMatchObject({ x: -50, y: -40 });
    // Mirrored about x = 20, start to start.
    expect((l1[0].x + l2[0].x) / 2).toBeCloseTo(20, 6);
    expect(l1[0].y).toBeCloseTo(l2[0].y, 6);
    expect((l1[1].x + l2[1].x) / 2).toBeCloseTo(20, 6);
    expect(l1[1].y).toBeCloseTo(l2[1].y, 6);
    await expectSolved(u);
  });

  test('curvature: a control spline meeting a line takes its first three points onto it', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: -60, y: 20 }, { x: -20, y: 20 }]);
    await spline(u, [{ x: -20, y: 20 }, { x: -5, y: 45 }, { x: 15, y: 10 }, { x: 35, y: 35 }, { x: 55, y: 15 }], 'Control Point Spline');
    await pick(u, 'Curvature');
    await u.click({ x: -50, y: 20 });
    await u.click({ x: 55, y: 15 });
    await exitTool(u);
    const s = await u.sketch();
    const [sp] = curvesOf<ControlSpline>(s, 'controlSpline');
    for (const id of sp.pts.slice(0, 3)) expect(pointAt(s, id).y).toBeCloseTo(20, 6);
    expect(constraintsOfType(s, 'curvature')).toBe(1);
    expect(Object.values(s.constraints).find((k) => k.type === 'curvature')?.refs[0]).toBe(sp.id);
    await expectSolved(u);
  });

  // A natural fit spline end is real G2 against a line (M-F9). Anything curved gets a handle to steer with
  // and real G2, measured here with the app's own curve maths. Only a pairing with nothing to steer says so.
  test('curvature on a fit spline: a line takes it with no warning', async ({ page }) => {
    const u = await start(page);
    await spline(u, [{ x: -50, y: 20 }, { x: -30, y: 50 }, { x: -10, y: 20 }]);
    await chain(u, [{ x: -10, y: 20 }, { x: 20, y: 30 }]);
    await pick(u, 'Curvature');
    await u.click(along({ x: -10, y: 20 }, { x: 20, y: 30 }, 0.7));
    await u.click({ x: -30, y: 50 });
    expect(await page.evaluate(() => window.__sketch.note)).not.toContain('tangent');
    await exitTool(u);
    expect(constraintsOfType(await u.sketch(), 'curvature')).toBe(1);
    await expectSolved(u);
  });

  test('curvature on a fit spline: an arc reaches G2 with no warning', async ({ page }) => {
    const u = await start(page);
    await pick(u, '3-Point Arc', 'Arc');
    await u.click({ x: 10, y: 0 });
    await u.click({ x: 50, y: 0 });
    await u.click({ x: 30, y: 20 });
    await exitTool(u);
    await spline(u, [{ x: 50, y: 0 }, { x: 70, y: 25 }, { x: 90, y: 0 }]);
    await pick(u, 'Curvature');
    await u.click({ x: 30, y: 20 });
    await u.click({ x: 70, y: 25 });
    expect(await page.evaluate(() => window.__sketch.note)).not.toContain('tangent');
    await exitTool(u);
    const s = await u.sketch();
    expect(constraintsOfType(s, 'curvature')).toBe(1);
    await expectSolved(u);
    const [arc] = curvesOf<Arc>(s, 'arc');
    expect(Math.abs(fitStartKappa(s) - 1 / radiusOf(s, arc.id))).toBeLessThan(1e-5);
  });

  test('curvature on a fit spline: a circle reaches G2 with no warning', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: -30, y: 30 }, 20);
    await spline(u, [{ x: -10, y: 30 }, { x: 15, y: 55 }, { x: 40, y: 30 }]);
    await pick(u, 'Curvature');
    await u.click({ x: -50, y: 30 });
    await u.click({ x: 15, y: 55 });
    expect(await page.evaluate(() => window.__sketch.note)).not.toContain('tangent');
    await exitTool(u);
    const s = await u.sketch();
    expect(constraintsOfType(s, 'curvature')).toBe(1);
    await expectSolved(u);
    const [round] = curvesOf<Circle>(s, 'circle');
    expect(Math.abs(fitStartKappa(s) - 1 / round.r)).toBeLessThan(1e-5);
  });

  test('curvature on a fit spline: an ellipse reaches G2 with no warning', async ({ page }) => {
    const u = await start(page);
    await pick(u, 'Ellipse');
    await u.click({ x: -30, y: 30 });
    await u.click({ x: -5, y: 30 });
    await u.click({ x: -30, y: 45 });
    await exitTool(u);
    await spline(u, [{ x: -5, y: 30 }, { x: 15, y: 55 }, { x: 40, y: 30 }]);
    await pick(u, 'Curvature');
    await u.click({ x: -55, y: 30 });
    await u.click({ x: 15, y: 55 });
    expect(await page.evaluate(() => window.__sketch.note)).not.toContain('tangent');
    await exitTool(u);
    const s = await u.sketch();
    expect(constraintsOfType(s, 'curvature')).toBe(1);
    await expectSolved(u);
    // At the end of the major axis the radius of curvature is b^2 / a.
    const [e] = curvesOf<Ellipse>(s, 'ellipse');
    const c = pointAt(s, e.c);
    const a = dist(c, pointAt(s, e.major));
    const b = dist(c, pointAt(s, e.minor));
    expect(Math.abs(fitStartKappa(s) - a / (b * b))).toBeLessThan(1e-4);
  });

  test('curvature: a conic and an arc have nothing to steer, stay tangent and say so', async ({ page }) => {
    const u = await start(page);
    await pick(u, '3-Point Arc', 'Arc');
    await u.click({ x: 10, y: 0 });
    await u.click({ x: 50, y: 0 });
    await u.click({ x: 30, y: 20 });
    await exitTool(u);
    await pick(u, 'Conic Curve');
    await u.click({ x: 50, y: 0 });
    await u.click({ x: 90, y: 0 });
    await u.click({ x: 70, y: 30 });
    await u.press('Enter');
    await exitTool(u);
    const [k] = curvesOf<Conic>(await u.sketch(), 'conic');
    await pick(u, 'Curvature');
    await u.click({ x: 30, y: 20 });
    const on = conicMid(await u.sketch(), k);
    await u.click(on);
    await expect.poll(() => page.evaluate(() => window.__sketch.note)).toContain('tangent');
    await exitTool(u);
  });
});

test.describe('text', () => {
  test('frame text: corners, rotation handle, typed angle, {parameter}; explode; edit', async ({ page }) => {
    const u = await start(page);
    // d1 = 40 mm, to read back through {d1}.
    await u.press('r');
    await u.click({ x: -60, y: 20 });
    await u.move({ x: -20, y: 45 });
    await u.type('40');
    await u.press('Tab');
    await u.type('25');
    await u.press('Enter');
    await exitTool(u);

    await pick(u, 'Text');
    const dialog = page.locator('.dialog[data-dialog="Text"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
    await u.click({ x: -30, y: -50 });
    await u.click({ x: 40, y: -25 });
    await dialog.locator('textarea').fill('W={d1}');
    const fonts = dialog.locator('.form-row', { hasText: 'Font' }).locator('select');
    await expect(fonts).toHaveValue('Inter');
    await dialog.locator('.form-row', { hasText: 'Height' }).locator('input').fill('9 mm');
    await dialog.locator('.form-row', { hasText: 'Horizontal' }).locator('select').selectOption('center');
    await dialog.locator('.form-row', { hasText: 'Bold' }).locator('input').check();
    await u.shot('text-dialog-frame');

    // The rotation handle sits above the middle of the top edge: drag it a quarter turn about the first corner.
    const ppm = await page.evaluate(() => window.__sketch.view.ppm);
    const handle = { x: 5, y: -25 + 34 / ppm };
    const pivot = { x: -30, y: -50 };
    const target = { x: -30 - 40, y: -50 + 5 };
    await u.drag(handle, target);
    const angleBox = dialog.locator('.form-row', { hasText: 'Angle' }).locator('input');
    const turn = deg(Math.atan2(target.y - pivot.y, target.x - pivot.x) - Math.atan2(handle.y - pivot.y, handle.x - pivot.x));
    expect(Number.parseFloat(await angleBox.inputValue())).toBeCloseTo(turn, 0);
    await u.shot('text-dialog-rotated');

    await angleBox.fill('30');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    let s = await u.sketch();
    const [t] = curvesOf<import('../src/model/types').TextEntity>(s, 'text');
    expect(t.mode).toBe('frame');
    expect(t.text).toBe('W={d1}');
    expect(t.height).toBeCloseTo(9, 6);
    expect(t.halign).toBe('center');
    expect(t.bold).toBe(true);
    const f = (t.frame as string[]).map((id) => pointAt(s, id));
    expect(dist(f[0], f[1])).toBeCloseTo(70, 5);
    expect(dist(f[1], f[2])).toBeCloseTo(25, 5);
    expect(deg(Math.atan2(f[1].y - f[0].y, f[1].x - f[0].x))).toBeCloseTo(30, 5);
    expect(f[0].x).toBeCloseTo(-30, 6);
    await expectSolved(u);
    await u.shot('text-frame');

    // {d1} reads 40: the same outlines as the literal text.
    const counts = await page.evaluate(() => {
      const sk = window.__sketch.sketch() as import('../src/model/types').Sketch;
      const id = (Object.values(sk.curves).find((c) => c.type === 'text') as import('../src/model/types').TextEntity).id;
      const n = (text: string): number => window.__sketch.textOutlines(id, text).length;
      return { param: n('W={d1}'), literal: n('W=40'), other: n('W={d2}') };
    });
    expect(counts.param).toBe(counts.literal);
    expect(counts.param).toBeGreaterThan(2);

    // Double-click the frame to edit it.
    await u.press('Escape');
    const edge = along(f[0], f[1], 0.3);
    await u.doubleClick(edge);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('textarea')).toHaveValue('W={d1}');
    await dialog.locator('textarea').fill('Hi');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    s = await u.sketch();
    expect(curvesOf<import('../src/model/types').TextEntity>(s, 'text')).toHaveLength(1);
    expect(curvesOf<import('../src/model/types').TextEntity>(s, 'text')[0].text).toBe('Hi');

    // Explode Text.
    await menu(u, edge, 'explode-text');
    s = await u.sketch();
    expect(curvesOf(s, 'text')).toHaveLength(0);
    const bits = Object.values(s.curves).filter((c) => c.type === 'line' || c.type === 'controlSpline');
    expect(bits.length).toBeGreaterThan(8);
    expect(bits.filter((c) => c.lineType === 'normal' && c.fixed).length).toBeGreaterThan(8);
    await expectSolved(u);
  });

  test('text on a path follows the circle', async ({ page }) => {
    const u = await start(page);
    await circle(u, { x: 0, y: 30 }, 25);
    await pick(u, 'Text');
    const dialog = page.locator('.dialog[data-dialog="Text"]');
    await dialog.locator('.form-row', { hasText: 'Type' }).locator('select').selectOption('path');
    await dialog.locator('textarea').fill('AROUND');
    await dialog.locator('.form-row', { hasText: 'Height' }).locator('input').fill('6 mm');
    await dialog.locator('.form-row', { hasText: 'Fit to Path' }).locator('input').check();
    await u.click({ x: 25, y: 30 });
    await u.shot('text-dialog-path');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    const s = await u.sketch();
    const [circ] = curvesOf<Circle>(s, 'circle');
    const [t] = curvesOf<import('../src/model/types').TextEntity>(s, 'text');
    expect(t.mode).toBe('path');
    expect(t.path).toBe(circ.id);
    expect(t.fitToPath).toBe(true);
    // The glyphs lie around the rim: every outline point is within the height of the circle.
    const ok = await page.evaluate(([cx, cy, r]) => {
      const sk = window.__sketch.sketch() as import('../src/model/types').Sketch;
      const e = Object.values(sk.curves).find((c) => c.type === 'text') as import('../src/model/types').TextEntity;
      const loops = window.__sketch.textOutlines(e.id);
      return loops.length > 4 && loops.every((l) => l.every((p) => Math.abs(Math.hypot(p.x - cx, p.y - cy) - r) < 7));
    }, [0, 30, 25]);
    expect(ok).toBe(true);
    await expectSolved(u);
  });
});

test.describe('project', () => {
  test('linked projection follows its source, unlinked does not, a deleted source turns it orange', async ({ page }) => {
    const u = await start(page);
    // Sketch1: a rectangle and a circle.
    await u.press('r');
    await u.click({ x: -50, y: 15 });
    await u.click({ x: -10, y: 45 });
    await exitTool(u);
    await circle(u, { x: 40, y: 30 }, 12);
    await page.locator('[data-action="palette-finish"]').click();
    await u.settle();
    await u.newSketch();

    await pick(u, 'Project', 'Project / Include');
    const dialog = page.locator('.dialog[data-dialog="Project"]');
    await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
    await u.click(along({ x: -50, y: 15 }, { x: -10, y: 15 }, 0.3));
    await u.click({ x: 52, y: 30 });
    await u.shot('project-dialog');
    await dialog.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    const design = await u.design();
    const [s1id, s2id] = design.order;
    const s1 = design.sketches[s1id];
    let s2 = await u.sketch();
    expect(s2.id).toBe(s2id);
    const proj = Object.values(s2.curves).filter((c) => c.projected);
    expect(proj).toHaveLength(2);
    expect(proj.every((c) => 'sketchId' in (c.projected as object) && (c.projected as { sketchId: string }).sketchId === s1id)).toBe(true);
    const projLine = proj.find((c) => c.type === 'line') as Line;
    const srcLine = s1.curves[(projLine.projected as { curveId: string }).curveId] as Line;
    expect(dist(pointAt(s2, projLine.a), pointAt(s1, srcLine.a))).toBeLessThan(1e-9);
    const projCircle = proj.find((c) => c.type === 'circle') as Circle;
    expect(projCircle.r).toBeCloseTo(12, 9);
    const purple: [number, number, number] = [138, 63, 199];
    expect(await countColour(page, purple)).toBeGreaterThan(100);
    // Locked: dragging it moves nothing.
    await u.drag(along(pointAt(s2, projLine.a), pointAt(s2, projLine.b), 0.3), { x: 0, y: 70 });
    s2 = await u.sketch();
    expect(pointAt(s2, projLine.a)).toMatchObject({ x: pointAt(s1, srcLine.a).x });
    await expectSolved(u);
    await u.shot('project-linked');

    // Unlinked: a fixed copy with no source.
    await pick(u, 'Project', 'Project / Include');
    await dialog.locator('.form-row', { hasText: 'Projection Link' }).locator('input').uncheck();
    await u.click(along({ x: -10, y: 15 }, { x: -10, y: 45 }, 0.3));
    await dialog.getByRole('button', { name: 'OK' }).click();
    await u.settle();
    s2 = await u.sketch();
    const copy = Object.values(s2.curves).filter((c) => !c.projected && c.type === 'line');
    expect(copy).toHaveLength(1);
    expect(copy[0].fixed).toBe(true);

    // Move the source corner, then come back: the linked copy follows, the unlinked one stays.
    await page.locator('[data-action="palette-finish"]').click();
    await page.locator(`.sketch-row[data-sketch="${s1id}"]`).dblclick();
    await u.settle();
    await u.drag({ x: -50, y: 15 }, { x: -58, y: 8 });
    const moved = await u.sketch();
    const corner = pointAt(moved, (Object.values(moved.curves).find((c) => c.id === srcLine.id) as Line).a);
    expect(corner.x).toBeCloseTo(-58, 3);
    await page.locator(`.sketch-row[data-sketch="${s2id}"]`).dblclick();
    await u.settle();
    s2 = await u.sketch();
    const follow = s2.curves[projLine.id] as Line;
    expect(pointAt(s2, follow.a).x).toBeCloseTo(-58, 3);
    expect(pointAt(s2, follow.a).y).toBeCloseTo(8, 3);

    // Delete the source line: the link is lost and the copy turns orange.
    await page.locator(`.sketch-row[data-sketch="${s1id}"]`).dblclick();
    await u.settle();
    await u.click(along({ x: -58, y: 8 }, { x: -10, y: 8 }, 0.35));
    await u.press('Delete');
    await page.locator(`.sketch-row[data-sketch="${s2id}"]`).dblclick();
    await u.settle();
    s2 = await u.sketch();
    expect(s2.curves[projLine.id]).toBeTruthy();
    const orange: [number, number, number] = [242, 165, 22];
    expect(await countColour(page, orange)).toBeGreaterThan(50);
    await u.shot('project-lost');
    await expectSolved(u);
  });
});

test.describe('fixes to existing tools', () => {
  test('line chain: HUD angle is relative to the previous segment, 0 to 180', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: -40, y: 20 });
    // Below the X axis the angle still reads 0 to 180 from +X.
    await u.move({ x: -20, y: 20 - 20 * Math.tan((30 * Math.PI) / 180) });
    const readout = async (): Promise<number> => Number.parseFloat(await page.locator('.hud-field[data-key="angle"] input').inputValue());
    expect(await readout()).toBeCloseTo(30, 0);
    await u.type('20');
    await u.press('Tab');
    await u.type('30');
    await u.press('Enter');
    // Second segment: the angle is measured from the first segment, here a right angle.
    await u.move({ x: -10, y: 30 });
    await u.type('15');
    await u.press('Tab');
    await u.type('90');
    await u.press('Enter');
    await exitTool(u);
    const s = await u.sketch();
    const [a, b] = await u.lines();
    const d1 = { x: pointAt(s, a.b).x - pointAt(s, a.a).x, y: pointAt(s, a.b).y - pointAt(s, a.a).y };
    const d2 = { x: pointAt(s, b.b).x - pointAt(s, b.a).x, y: pointAt(s, b.b).y - pointAt(s, b.a).y };
    // First segment 30 degrees below +X (the cursor was below), second at 90 to it.
    expect(deg(Math.atan2(d1.y, d1.x))).toBeCloseTo(-30, 4);
    expect(Math.hypot(d2.x, d2.y)).toBeCloseTo(15, 5);
    expect(d1.x * d2.x + d1.y * d2.y).toBeCloseTo(0, 5);
    const angles = Object.values(s.dimensions).filter((d) => d.kind === 'angle');
    expect(angles).toHaveLength(2);
    expect(angles.some((d) => d.refs.includes(a.id) && d.refs.includes(b.id))).toBe(true);
    await expectSolved(u);
  });

  test('line chain: undo steps back one point instead of ending the chain', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: -40, y: 20 });
    await u.click({ x: 0, y: 30 });
    await u.click({ x: 30, y: 10 });
    expect((await u.lines()).length).toBe(2);
    await u.press('Control+z');
    expect((await u.lines()).length).toBe(1);
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('line');
    // The chain goes on from the end of the first segment.
    await u.click({ x: 20, y: 40 });
    await exitTool(u);
    const s = await u.sketch();
    const lines = await u.lines();
    expect(lines).toHaveLength(2);
    expect(dist(pointAt(s, lines[1].a), { x: 0, y: 30 })).toBeLessThan(1e-6);
    expect(pointAt(s, lines[1].b)).toMatchObject({ x: 20, y: 40 });
    // Undo all the way: the chain ends once its first point is gone.
    await u.press('l');
    await u.click({ x: 50, y: -20 });
    await u.click({ x: 60, y: -40 });
    await u.click({ x: 70, y: -20 });
    await u.press('Control+z');
    await u.press('Control+z');
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('line');
    expect((await u.lines()).length).toBe(2);
  });

  test('2-point and 3-point circles: rim clicks on a curve or a midpoint add constraints', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: -40, y: 10 }, { x: 40, y: 10 }]);
    await chain(u, [{ x: 60, y: -30 }, { x: 60, y: 50 }]);
    // Diameter from the midpoint of the first line to a point on the second.
    await pick(u, '2-Point Circle', 'Circle');
    await u.click({ x: 0, y: 10.2 });
    await u.click({ x: 60, y: 40 });
    await exitTool(u);
    let s = await u.sketch();
    const [c1] = curvesOf<Circle>(s, 'circle');
    expect(constraintsOfType(s, 'midpoint')).toBe(1);
    const mid = Object.values(s.constraints).find((k) => k.type === 'midpoint') as { refs: string[] };
    expect(dist(pointAt(s, mid.refs[0]), { x: 0, y: 10 })).toBeLessThan(1e-6);
    expect(Math.abs(dist(pointAt(s, mid.refs[0]), pointAt(s, c1.c)) - c1.r)).toBeLessThan(1e-6);
    const second = Object.values(s.constraints).find((k) => k.type === 'coincident' && k.refs.includes(Object.keys(s.curves).find((id) => s.curves[id].type === 'line' && id !== mid.refs[1]) as string));
    expect(second).toBeTruthy();

    // Three points: one on a curve.
    await pick(u, '3-Point Circle', 'Circle');
    await u.click({ x: -30, y: -30 });
    await u.click({ x: -10, y: -45 });
    await u.click({ x: 20, y: 10.1 });
    await exitTool(u);
    s = await u.sketch();
    const [, c2] = curvesOf<Circle>(s, 'circle');
    expect(Math.abs(dist(pointAt(s, c2.c), { x: 20, y: 10 }) - c2.r)).toBeLessThan(1e-5);
    // A hidden point on the rim stands for the click: it is on the circle and on the line.
    const helper = Object.values(s.points).find((p) => p.owner === c2.id && p.id !== c2.c);
    expect(helper).toBeTruthy();
    const lineId = Object.keys(s.curves).find((id) => s.curves[id].type === 'line') as string;
    expect(Object.values(s.constraints).filter((k) => k.type === 'coincident' && k.refs.includes(helper?.id as string)).flatMap((k) => k.refs).filter((r) => r === c2.id || r === lineId)).toHaveLength(2);
    await expectSolved(u);
  });

  test('dragging a point onto a point or a curve snaps and joins; Ctrl suppresses', async ({ page }) => {
    const u = await start(page);
    await chain(u, [{ x: -40, y: 20 }, { x: 8, y: 20 }]);
    await chain(u, [{ x: 30, y: 40 }, { x: 60, y: 60 }]);
    await chain(u, [{ x: -40, y: -30 }, { x: 40, y: -30 }]);
    await chain(u, [{ x: -30, y: -50 }, { x: -10, y: -70 }]);

    // Onto a point: the glyph shows while dragging, the coincident is added on release.
    const from = { x: 30, y: 40 };
    await u.move(from);
    await page.mouse.down();
    const near = await u.screen({ x: 8.5, y: 20.5 });
    await page.mouse.move(near.x, near.y, { steps: 6 });
    await u.settle();
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('point');
    await u.shot('drag-snap-point');
    await page.mouse.up();
    await u.settle();
    let s = await u.sketch();
    let ls = await u.lines();
    expect(dist(pointAt(s, ls[1].a), pointAt(s, ls[0].b))).toBeLessThan(1e-6);
    expect(constraintsOfType(s, 'coincident')).toBe(1);

    // Onto a curve.
    await u.drag({ x: -10, y: -70 }, { x: 10, y: -30.2 });
    s = await u.sketch();
    ls = await u.lines();
    expect(Math.abs(pointAt(s, ls[3].b).y + 30)).toBeLessThan(1e-6);
    expect(Object.values(s.constraints).some((k) => k.type === 'coincident' && k.refs.includes(ls[3].b) && k.refs.includes(ls[2].id))).toBe(true);

    // Ctrl held: no snap, no constraint.
    await page.keyboard.down('Control');
    await u.drag({ x: 60, y: 60 }, { x: 8.5, y: 20.5 });
    await page.keyboard.up('Control');
    s = await u.sketch();
    ls = await u.lines();
    expect(dist(pointAt(s, ls[1].b), { x: 8.5, y: 20.5 })).toBeLessThan(0.3);
    expect(constraintsOfType(s, 'coincident')).toBe(2);
    await expectSolved(u);
  });
});

test.describe('polygons by sides', () => {
  for (const n of [3, 4, 5, 8]) {
    test(`circumscribed polygon with ${n} sides is regular and fixed but for its turn`, async ({ page }) => {
      const u = await start(page);
      await pick(u, 'Circumscribed Polygon', 'Polygon');
      await u.click({ x: 0, y: 0 });
      await u.move({ x: 0, y: 30 });
      await u.type('18');
      await u.press('Tab');
      await u.type(String(n));
      await u.press('Enter');
      await exitTool(u);
      const s = await u.sketch();
      const lines = Object.values(s.curves).filter((c): c is Line => c.type === 'line');
      expect(lines).toHaveLength(n);
      const R = 18 / Math.cos(Math.PI / n);
      for (const l of lines) expect(Math.hypot(pointAt(s, l.a).x, pointAt(s, l.a).y)).toBeCloseTo(R, 5);
      expect(dist(pointAt(s, lines[0].a), pointAt(s, lines[0].b))).toBeCloseTo(2 * 18 * Math.tan(Math.PI / n), 5);
      await expectSolved(u, 1);
    });
  }
});

test.describe('gallery', () => {
  test('one of each shape, then one of each glyph, drawn by hand', async ({ page }) => {
    const u = await start(page);
    await u.wheelOut(500);
    const row = (i: number): number => 150 - i * 45;
    const col = (i: number): number => -190 + i * 65;
    await chain(u, [{ x: col(0), y: row(0) }, { x: col(0) + 40, y: row(0) + 15 }]);
    await pick(u, '2-Point Rectangle');
    await u.click({ x: col(1), y: row(0) });
    await u.click({ x: col(1) + 40, y: row(0) + 25 });
    await exitTool(u);
    await circle(u, { x: col(2) + 20, y: row(0) + 10 }, 15);
    await pick(u, '3-Point Arc', 'Arc');
    await u.click({ x: col(3), y: row(0) });
    await u.click({ x: col(3) + 45, y: row(0) });
    await u.click({ x: col(3) + 22, y: row(0) + 20 });
    await exitTool(u);
    await pick(u, 'Center Point Arc', 'Arc');
    await u.click({ x: col(4) + 20, y: row(0) });
    await u.click({ x: col(4) + 40, y: row(0) });
    await u.click({ x: col(4) + 20, y: row(0) + 20 });
    await exitTool(u);

    await pick(u, 'Circumscribed Polygon', 'Polygon');
    await u.click({ x: col(0) + 20, y: row(1) });
    await u.move({ x: col(0) + 35, y: row(1) + 3 });
    await u.type('6');
    await u.press('Tab');
    await u.type('6');
    await u.press('Enter');
    await exitTool(u);
    await pick(u, 'Inscribed Polygon', 'Polygon');
    await u.click({ x: col(1) + 20, y: row(1) });
    await u.click({ x: col(1) + 20, y: row(1) + 18 });
    await exitTool(u);
    await pick(u, 'Edge Polygon', 'Polygon');
    await u.click({ x: col(2), y: row(1) - 10 });
    await u.click({ x: col(2) + 25, y: row(1) - 10 });
    await u.click({ x: col(2) + 12, y: row(1) + 10 });
    await exitTool(u);
    await pick(u, 'Ellipse');
    await u.click({ x: col(3) + 25, y: row(1) });
    await u.click({ x: col(3) + 50, y: row(1) + 5 });
    await u.click({ x: col(3) + 30, y: row(1) + 12 });
    await exitTool(u);
    await pick(u, 'Conic Curve');
    await u.click({ x: col(4), y: row(1) - 10 });
    await u.click({ x: col(4) + 40, y: row(1) - 10 });
    await u.click({ x: col(4) + 20, y: row(1) + 15 });
    await u.click({ x: col(4) + 20, y: row(1) + 5 });
    await exitTool(u);

    const slots: [string, Xy[]][] = [
      ['Center To Center Slot', [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 8 }]],
      ['Overall Slot', [{ x: 0, y: 0 }, { x: 45, y: 0 }, { x: 20, y: 7 }]],
      ['Center Point Slot', [{ x: 22, y: 0 }, { x: 40, y: 0 }, { x: 25, y: 7 }]],
      ['Three Point Arc Slot', [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 12 }, { x: 20, y: 22 }]],
      ['Center Point Arc Slot', [{ x: 20, y: -20 }, { x: 40, y: -20 }, { x: 20, y: 0 }, { x: 28, y: -2 }]],
    ];
    for (const [i, [label, pts]] of slots.entries()) {
      await pick(u, label, 'Slot');
      for (const q of pts) await u.click({ x: col(i) + q.x, y: row(2) + q.y });
      await exitTool(u);
    }
    await pick(u, 'Fit Point Spline', 'Spline');
    for (const q of [{ x: 0, y: 0 }, { x: 20, y: -10 }, { x: 40, y: -12 }, { x: 60, y: -5 }]) await u.click({ x: col(0) + q.x, y: row(3) + q.y });
    await u.press('Enter');
    await u.press('Escape');
    await pick(u, 'Control Point Spline', 'Spline');
    for (const q of [{ x: 0, y: 0 }, { x: 18, y: -15 }, { x: 36, y: -18 }, { x: 54, y: -8 }, { x: 70, y: 0 }]) await u.click({ x: col(1) + q.x, y: row(3) + q.y });
    await u.press('Enter');
    await u.press('Escape');
    await pick(u, 'Point');
    await u.click({ x: col(2) + 10, y: row(3) });
    await u.click({ x: col(2) + 25, y: row(3) + 10 });
    await exitTool(u);
    await pick(u, 'Text');
    await u.click({ x: col(3), y: row(3) - 8 });
    await u.click({ x: col(3) + 60, y: row(3) + 12 });
    await page.locator('.dialog[data-dialog="Text"] textarea').fill('Sketch');
    await page.locator('.dialog[data-dialog="Text"]').locator('.form-row', { hasText: 'Height' }).locator('input').fill('12 mm');
    await page.locator('.dialog[data-dialog="Text"]').getByRole('button', { name: 'OK' }).click();
    await u.settle();
    await u.press('Escape');
    await circle(u, { x: col(4) + 20, y: row(3) }, 14);
    await u.shot('gallery-shapes');
    expect(Object.keys((await u.sketch()).curves).length).toBeGreaterThan(40);
    await expectSolved(u);
  });

  test('one of each constraint glyph', async ({ page }) => {
    const u = await start(page);
    await u.wheelOut(300);
    // Rectangle: horizontal, vertical.
    await pick(u, '2-Point Rectangle');
    await u.click({ x: -120, y: 60 });
    await u.click({ x: -80, y: 85 });
    await exitTool(u);
    // Parallel and perpendicular pairs.
    await chain(u, [{ x: -60, y: 70 }, { x: -20, y: 85 }]);
    await chain(u, [{ x: -60, y: 40 }, { x: -20, y: 58 }]);
    await pick(u, 'Parallel');
    await u.click(along({ x: -60, y: 70 }, { x: -20, y: 85 }, 0.3));
    await u.click(along({ x: -60, y: 40 }, { x: -20, y: 58 }, 0.3));
    await exitTool(u);
    await chain(u, [{ x: 0, y: 70 }, { x: 40, y: 85 }]);
    await chain(u, [{ x: 10, y: 40 }, { x: 50, y: 52 }]);
    await pick(u, 'Perpendicular');
    await u.click(along({ x: 0, y: 70 }, { x: 40, y: 85 }, 0.3));
    await u.click(along({ x: 10, y: 40 }, { x: 50, y: 52 }, 0.3));
    await exitTool(u);
    // Tangent and equal and concentric.
    await circle(u, { x: -100, y: -10 }, 12);
    await circle(u, { x: -60, y: -20 }, 8);
    await pick(u, 'Tangent');
    await u.click({ x: -100, y: 2 });
    await u.click({ x: -60, y: -12 });
    await exitTool(u);
    await circle(u, { x: -20, y: -10 }, 10);
    await circle(u, { x: 15, y: -15 }, 6);
    await pick(u, 'Equal');
    await u.click({ x: -20, y: 0 });
    await u.click({ x: 15, y: -9 });
    await exitTool(u);
    await circle(u, { x: 60, y: -10 }, 12);
    await circle(u, { x: 90, y: -25 }, 7);
    await pick(u, 'Concentric');
    await u.click({ x: 60, y: 2 });
    await u.click({ x: 97, y: -25 });
    await exitTool(u);
    // Fix, midpoint, collinear.
    await chain(u, [{ x: -110, y: -50 }, { x: -70, y: -45 }]);
    await pick(u, 'Fix/UnFix');
    await u.click(along({ x: -110, y: -50 }, { x: -70, y: -45 }, 0.3));
    await exitTool(u);
    await chain(u, [{ x: -50, y: -50 }, { x: -10, y: -45 }]);
    await pick(u, 'Point');
    await u.click({ x: -30, y: -70 });
    await exitTool(u);
    await pick(u, 'Midpoint');
    await u.click({ x: -30, y: -70 });
    await u.click(along({ x: -50, y: -50 }, { x: -10, y: -45 }, 0.3));
    await exitTool(u);
    await chain(u, [{ x: 10, y: -50 }, { x: 40, y: -42 }]);
    await chain(u, [{ x: 55, y: -70 }, { x: 90, y: -55 }]);
    await pick(u, 'Collinear');
    await u.click(along({ x: 10, y: -50 }, { x: 40, y: -42 }, 0.3));
    await u.click(along({ x: 55, y: -70 }, { x: 90, y: -55 }, 0.3));
    await exitTool(u);
    // Symmetry about a vertical line, and curvature.
    await chain(u, [{ x: 120, y: -70 }, { x: 120, y: 30 }]);
    await chain(u, [{ x: 100, y: 0 }, { x: 108, y: 20 }]);
    await chain(u, [{ x: 150, y: 5 }, { x: 160, y: 25 }]);
    await pick(u, 'Symmetry');
    await u.click(along({ x: 100, y: 0 }, { x: 108, y: 20 }, 0.3));
    await u.click(along({ x: 150, y: 5 }, { x: 160, y: 25 }, 0.3));
    await u.click({ x: 120, y: -40 });
    await exitTool(u);
    await chain(u, [{ x: 70, y: 60 }, { x: 100, y: 60 }]);
    await pick(u, 'Control Point Spline', 'Spline');
    for (const q of [{ x: 100, y: 60 }, { x: 115, y: 85 }, { x: 130, y: 55 }, { x: 150, y: 80 }]) await u.click(q);
    await u.press('Enter');
    await u.press('Escape');
    await pick(u, 'Curvature');
    await u.click({ x: 85, y: 60 });
    await u.click({ x: 150, y: 80 });
    await exitTool(u);
    await u.shot('gallery-glyphs');
    const s = await u.sketch();
    for (const t of ['horizontal', 'vertical', 'coincident', 'parallel', 'perpendicular', 'tangent', 'equal', 'concentric', 'midpoint', 'collinear', 'symmetric', 'curvature']) {
      expect(constraintsOfType(s, t), t).toBeGreaterThan(0);
    }
    expect(Object.values(s.curves).some((c) => c.fixed)).toBe(true);
    await expectSolved(u);
  });
});
