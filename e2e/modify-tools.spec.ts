// Modify tools, Mirror, Patterns, Parameters, AutoConstrain and DXF, through real mouse and keyboard
// events. Results are asserted numerically from the read-only window.__sketch handle.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { constraintsOfType, pointAt, SketchUser, type Xy } from './helpers';
import type { Arc, Circle, ControlSpline, Curve, Id, Line, Sketch } from '../src/model/types';
import { View } from '../src/app/view';
import { layoutBadges } from '../src/render/glyphs';

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

/** A tool from a panel's menu, through its flyout if it has one. */
async function menu(u: SketchUser, panel: 'create' | 'modify' | 'constraints', label: string, flyout?: string): Promise<void> {
  await u.page.locator(`.panel[data-panel="${panel}"] .panel-name`).click();
  if (flyout) await u.page.locator(`.menu-item.flyout[data-item="${flyout}"]`).hover();
  await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  await u.settle();
}

const modify = (u: SketchUser, label: string, flyout?: string): Promise<void> => menu(u, 'modify', label, flyout);
const constrain = (u: SketchUser, label: string): Promise<void> => menu(u, 'constraints', label);

async function lineChain(u: SketchUser, ...pts: Xy[]): Promise<void> {
  await u.press('l');
  for (const p of pts) await u.click(p);
  await exitTool(u);
}

async function rectangle(u: SketchUser, a: Xy, b: Xy): Promise<void> {
  await u.press('r');
  await u.click(a);
  await u.click(b);
  await exitTool(u);
}

async function circle(u: SketchUser, c: Xy, rim: Xy): Promise<void> {
  await u.press('c');
  await u.click(c);
  await u.click(rim);
  await exitTool(u);
}

/** Dimension a line by its middle, placing the label at `at`, typing the value. */
async function dimension(u: SketchUser, pick: Xy[], at: Xy, value: string): Promise<void> {
  await u.press('d');
  for (const p of pick) await u.click(p);
  await u.click(at);
  await u.page.keyboard.press('ControlOrMeta+a');
  await u.page.keyboard.type(value);
  await u.press('Enter');
  await exitTool(u);
}

const dialog = (u: SketchUser, title: string): Locator => u.page.locator(`.dialog[data-dialog="${title}"]`);

const fieldRow = (d: Locator, label: string): Locator => d.locator('.form-row').filter({ has: d.page().locator(`.form-label:text-is("${label}")`) });

async function setField(d: Locator, label: string, value: string, nth = 0): Promise<void> {
  const input = fieldRow(d, label).nth(nth).locator('input');
  await input.fill(value);
}

const selectInField = (d: Locator, label: string): Promise<void> => d.locator(`[data-field="${label}"] .select-toggle`).click();

const ok = async (u: SketchUser, d: Locator): Promise<void> => {
  await d.locator('.btn.primary').click();
  await u.settle();
};

/** Where a feature's glyph is, in sketch coordinates, computed as the renderer lays it out. */
async function glyph(u: SketchUser, id: Id): Promise<Xy> {
  const s = await u.sketch();
  const view = new View();
  Object.assign(view, await u.page.evaluate(() => window.__sketch.view));
  const b = layoutBadges(s, view).find((x) => x.constraint === id);
  if (!b) throw new Error(`no glyph for ${id}`);
  return view.toWorld({ x: b.x, y: b.y });
}

const near = (a: Xy, b: Xy, tol = 1e-3): boolean => Math.hypot(a.x - b.x, a.y - b.y) < tol;

const lineEnds = (s: Sketch, l: Line): [Xy, Xy] => [pointAt(s, l.a), pointAt(s, l.b)];

/** Same line, either way round. */
const findLine = (s: Sketch, p: Xy, q: Xy): Line | undefined => Object.values(s.curves).find((c): c is Line => {
  if (c.type !== 'line') return false;
  const [a, b] = lineEnds(s, c);
  return (near(a, p) && near(b, q)) || (near(a, q) && near(b, p));
});

const clean = async (u: SketchUser): Promise<void> => {
  expect((await u.analysis()).unsatisfied).toEqual([]);
};

const radiusOf = (s: Sketch, a: Arc): number => Math.hypot(pointAt(s, a.a).x - pointAt(s, a.c).x, pointAt(s, a.a).y - pointAt(s, a.c).y);

// ---------------------------------------------------------------------------
// Trim, Extend, Break

test('trim: hover previews the segment, click removes it to the nearest intersections', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -40, y: 0 }, { x: 40, y: 0 });
  await lineChain(u, { x: -20, y: -20 }, { x: -20, y: 20 });
  await lineChain(u, { x: 20, y: -20 }, { x: 20, y: 20 });
  await u.tool('Trim');
  await u.move({ x: 0, y: 0 });
  await u.shot('modify-trim-hover');
  await u.click({ x: 0, y: 0 });
  const s = await u.sketch();
  expect(findLine(s, { x: -40, y: 0 }, { x: -20, y: 0 })).toBeTruthy();
  expect(findLine(s, { x: 20, y: 0 }, { x: 40, y: 0 })).toBeTruthy();
  expect((await u.lines()).length).toBe(4);
  await clean(u);

  // No intersection left on an end stub's free side: the stub goes to the cut, then a loose line deletes.
  await u.click({ x: -30, y: 0 });
  expect(findLine(await u.sketch(), { x: -40, y: 0 }, { x: -20, y: 0 })).toBeFalsy();
  await u.press('Enter');
  expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');
});

test('trim: a curve with no intersection is deleted [ref]', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: 0, y: 0 }, { x: 30, y: 10 });
  await u.press('t');
  await u.click({ x: 15, y: 5 });
  expect((await u.lines()).length).toBe(0);
});

test('regression: trim a circle by two lines leaves an arc tied to both', async ({ page }) => {
  const u = await start(page);
  await circle(u, { x: 0, y: 0 }, { x: 30, y: 0 });
  await lineChain(u, { x: 10, y: -50 }, { x: 10, y: 50 });
  await lineChain(u, { x: 20, y: -50 }, { x: 20, y: 50 });
  await u.press('t');
  await u.click({ x: -30, y: 0 });
  await exitTool(u);
  const s = await u.sketch();
  expect(Object.values(s.curves).filter((c) => c.type === 'circle').length).toBe(0);
  const [arc] = (await u.curves('arc')) as Arc[];
  expect(arc).toBeTruthy();
  expect(radiusOf(s, arc)).toBeCloseTo(30, 3);
  // What was removed ran round the left, so both ends sit on the first line, at x = 10.
  expect(pointAt(s, arc.a).x).toBeCloseTo(10, 2);
  expect(pointAt(s, arc.b).x).toBeCloseTo(10, 2);
  expect(constraintsOfType(s, 'coincident')).toBeGreaterThanOrEqual(2);
  await clean(u);
});

test('regression: press and drag across three segments trims them all, as one undo step', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -60, y: 20 }, { x: 60, y: 20 });
  await lineChain(u, { x: -60, y: -20 }, { x: 60, y: -20 });
  for (const x of [-30, 0, 30]) await lineChain(u, { x, y: -40 }, { x, y: 40 });
  const before = (await u.lines()).length;
  await u.press('t');
  await u.drag({ x: -40, y: 0 }, { x: 40, y: 0 }, 2);
  await u.shot('modify-trim-sweep');
  const s = await u.sketch();
  // Each vertical lost its middle stretch between the two rails.
  for (const x of [-30, 0, 30]) {
    expect(findLine(s, { x, y: 20 }, { x, y: 40 })).toBeTruthy();
    expect(findLine(s, { x, y: -40 }, { x, y: -20 })).toBeTruthy();
  }
  expect((await u.lines()).length).toBe(before + 3);
  await page.keyboard.press('Meta+z');
  await u.settle();
  expect((await u.lines()).length).toBe(before);
});

test('extend: reaches the next intersection, and a miss is a message', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: 20, y: -30 }, { x: 20, y: 30 });
  await lineChain(u, { x: -20, y: 0 }, { x: 0, y: 0 });
  await lineChain(u, { x: -20, y: 45 }, { x: 0, y: 45 });
  await modify(u, 'Extend');
  await u.move({ x: -3, y: 0 });
  await u.shot('modify-extend-hover');
  await u.click({ x: -3, y: 0 });
  let s = await u.sketch();
  const stretched = findLine(s, { x: -20, y: 0 }, { x: 20, y: 0 });
  expect(stretched).toBeTruthy();

  const count = Object.keys(s.curves).length;
  await u.click({ x: -3, y: 45 });
  expect(await page.evaluate(() => window.__sketch.note)).toContain('no intersection');
  s = await u.sketch();
  expect(findLine(s, { x: -20, y: 45 }, { x: 0, y: 45 })).toBeTruthy();
  expect(Object.keys(s.curves).length).toBe(count);
  await clean(u);
  await exitTool(u);
});

test('break: hover shows the break points, click splits at both intersections', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -40, y: 0 }, { x: 40, y: 0 });
  await lineChain(u, { x: -10, y: -20 }, { x: -10, y: 20 });
  await lineChain(u, { x: 10, y: -20 }, { x: 10, y: 20 });
  await modify(u, 'Break');
  await u.move({ x: 0, y: 0 });
  await u.shot('modify-break-hover');
  await u.click({ x: 0, y: 0 });
  const s = await u.sketch();
  expect((await u.lines()).length).toBe(5);
  for (const [a, b] of [[-40, -10], [-10, 10], [10, 40]]) {
    expect(findLine(s, { x: a, y: 0 }, { x: b, y: 0 })).toBeTruthy();
  }
  await clean(u);
  // A line nothing crosses stays whole and says why.
  await lineChain(u, { x: -40, y: 40 }, { x: 40, y: 40 });
  await modify(u, 'Break');
  await u.click({ x: 0, y: 40 });
  expect(await page.evaluate(() => window.__sketch.note)).toContain('Nothing crosses');
  expect((await u.lines()).length).toBe(6);
  await exitTool(u);
});

// ---------------------------------------------------------------------------
// Fillet and chamfer

test('regression: fillet at a vertex, typed radius, removes the corner coincident', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 });
  let s = await u.sketch();
  expect(constraintsOfType(s, 'coincident')).toBeGreaterThanOrEqual(1);
  const cornerTies = Object.values(s.constraints).filter((k) => k.type === 'coincident' && k.refs.every((r) => {
    const p = s.points[r];
    return p && near(p, { x: 40, y: 0 });
  }));
  expect(cornerTies.length).toBe(1);

  await u.tool('Fillet');
  await u.move({ x: 40, y: 0 });
  await u.shot('modify-fillet-hover');
  await u.click({ x: 40, y: 0 });
  await u.move({ x: 0, y: 40 });
  await page.keyboard.type('5');
  await u.shot('modify-fillet-typed');
  await u.press('Enter');
  expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');

  s = await u.sketch();
  const [arc] = (await u.curves('arc')) as Arc[];
  expect(radiusOf(s, arc)).toBeCloseTo(5, 3);
  expect(pointAt(s, arc.c).x).toBeCloseTo(35, 2);
  expect(pointAt(s, arc.c).y).toBeCloseTo(5, 2);
  expect(s.constraints[cornerTies[0].id]).toBeUndefined();
  expect(constraintsOfType(s, 'tangent')).toBe(2);
  const dims = Object.values(s.dimensions);
  expect(dims.map((d) => [d.kind, d.expression])).toEqual([['radius', '5 mm']]);
  await clean(u);
});

test('fillet: two picked curves, initial radius follows the smaller, handle drag changes it', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -50, y: 0 }, { x: 30, y: 0 });
  await lineChain(u, { x: 30, y: 10 }, { x: 30, y: 50 });
  await u.tool('Fillet');
  await u.click({ x: 0, y: 0 });
  await u.move({ x: 30, y: 30 });
  await u.shot('modify-fillet-pair-hover');
  await u.click({ x: 30, y: 30 });
  await u.shot('modify-fillet-pair-handle');
  // 20% of the 40 mm line: the arc's middle, where the handle sits, is at r(1 - 1/sqrt 2) each way.
  const r0 = 8;
  const h = r0 * (1 - Math.SQRT1_2);
  // Sliding the handle toward the centre by the same again doubles r.
  await u.drag({ x: 30 - h, y: h }, { x: 30 - 2 * h, y: 2 * h });
  await u.press('Enter');
  const s = await u.sketch();
  const [arc] = (await u.curves('arc')) as Arc[];
  expect(radiusOf(s, arc)).toBeCloseTo(16, 0);
  expect(Math.max(...lineEnds(s, (await u.lines())[0]).map((p) => p.x))).toBeLessThan(30 - 10);
  await clean(u);
});

test('fillet: several vertices share one radius through one dimension', async ({ page }) => {
  const u = await start(page);
  await rectangle(u, { x: -30, y: -20 }, { x: 30, y: 20 });
  await u.tool('Fillet');
  await u.click({ x: 30, y: 20 });
  await u.click({ x: -30, y: -20 });
  await page.keyboard.type('6');
  await u.press('Enter');
  const s = await u.sketch();
  const arcs = (await u.curves('arc')) as Arc[];
  expect(arcs.length).toBe(2);
  for (const a of arcs) expect(radiusOf(s, a)).toBeCloseTo(6, 3);
  expect(Object.values(s.dimensions).length).toBe(1);
  expect(constraintsOfType(s, 'equal')).toBe(1);
  await clean(u);
});

test('fillet: two parallel lines take a semicircle at the picked end', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -30, y: 0 }, { x: 30, y: 0 });
  await lineChain(u, { x: -30, y: 20 }, { x: 30, y: 20 });
  await u.tool('Fillet');
  await u.click({ x: 20, y: 0 });
  await u.click({ x: 20, y: 20 });
  await u.press('Enter');
  const s = await u.sketch();
  const [arc] = (await u.curves('arc')) as Arc[];
  expect(radiusOf(s, arc)).toBeCloseTo(10, 3);
  expect(pointAt(s, arc.c).x).toBeCloseTo(30, 3);
  expect(pointAt(s, arc.c).y).toBeCloseTo(10, 3);
  await clean(u);
});

// The line comes in square to the arc. A line along the X axis would be tangent to this arc, with no corner to round.
test('fillet: a line and an arc that meet', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: 0, y: -40 }, { x: 0, y: 0 });
  await menu(u, 'create', '3-Point Arc', 'Arc');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 0, y: 40 });
  await u.click({ x: 20, y: 20 });
  await exitTool(u);
  await u.tool('Fillet');
  await u.click({ x: 0, y: 0 });
  await page.keyboard.type('4');
  await u.press('Enter');
  const s = await u.sketch();
  const arcs = (await u.curves('arc')) as Arc[];
  expect(arcs.length).toBe(2);
  expect(arcs.map((a) => radiusOf(s, a)).some((r) => Math.abs(r - 4) < 1e-3)).toBe(true);
  expect(constraintsOfType(s, 'tangent')).toBe(2);
  await clean(u);
});

test('fillet: an arc of more than a half turn keeps its corner', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: 0, y: 0 }, { x: 40, y: 0 });
  // Three quarters of a turn about (-20, 0), so the pick on it lies back behind the corner.
  await menu(u, 'create', '3-Point Arc', 'Arc');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: -20, y: -20 });
  await u.click({ x: -20, y: 20 });
  await exitTool(u);
  const s0 = await u.sketch();
  const [long] = (await u.curves('arc')) as Arc[];
  expect(pointAt(s0, long.c).x).toBeCloseTo(-20, 3);
  await u.tool('Fillet');
  await u.click({ x: 0, y: 0 });
  await page.keyboard.type('3');
  await u.press('Enter');
  const s = await u.sketch();
  const arcs = (await u.curves('arc')) as Arc[];
  expect(arcs.length).toBe(2);
  const round = arcs.find((a) => Math.abs(radiusOf(s, a) - 3) < 1e-3) as Arc;
  // Right by the corner, in the wedge above the line and outside the circle.
  const c = pointAt(s, round.c);
  expect(c.y).toBeCloseTo(3, 3);
  expect(c.x).toBeGreaterThan(0);
  expect(c.x).toBeLessThan(10);
  await clean(u);
});

test('fillet: a vertex pick rounds the vertex, not the far crossing of the same curves', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: 0, y: 0 }, { x: 60, y: 0 });
  await menu(u, 'create', 'Center Point Arc', 'Arc');
  await u.click({ x: 20, y: 0 });
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 20, y: 20 });
  await exitTool(u);
  await u.tool('Fillet');
  await u.click({ x: 0, y: 0 });
  await page.keyboard.type('2');
  await u.press('Enter');
  const s = await u.sketch();
  const round = ((await u.curves('arc')) as Arc[]).find((a) => Math.abs(radiusOf(s, a) - 2) < 1e-3) as Arc;
  expect(Math.hypot(pointAt(s, round.c).x, pointAt(s, round.c).y)).toBeLessThan(10);
  await clean(u);
});

test('fillet: a tangent join has no corner, says so, and changes nothing', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -40, y: 0 }, { x: 0, y: 0 });
  await menu(u, 'create', '3-Point Arc', 'Arc');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 0, y: 40 });
  await u.click({ x: 20, y: 20 });
  await exitTool(u);
  const before = await u.sketch();
  await u.tool('Fillet');
  await u.click({ x: 0, y: 0 });
  expect(await page.evaluate(() => window.__sketch.note)).toContain('no corner');
  await page.keyboard.type('4');
  await u.press('Enter');
  const s = await u.sketch();
  expect(s.curves).toEqual(before.curves);
  await exitTool(u);
});

test('fillet: a radius that cannot fit is refused and the tool stays', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 });
  await u.tool('Fillet');
  await u.click({ x: 20, y: 0 });
  await page.keyboard.type('50');
  await u.press('Enter');
  expect(await page.evaluate(() => window.__sketch.note)).toContain('does not fit');
  expect((await u.curves('arc')).length).toBe(0);
  expect(await page.evaluate(() => window.__sketch.tool)).toBe('fillet');
  await exitTool(u);
});

test('equal chamfer at a vertex: second dimension follows the first', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 });
  await modify(u, 'Equal Distance Chamfer', 'Chamfer');
  await u.move({ x: 40, y: 0 });
  await u.shot('modify-chamfer-hover');
  await u.click({ x: 40, y: 0 });
  await page.keyboard.type('6');
  await u.shot('modify-chamfer-equal');
  await u.press('Enter');
  const s = await u.sketch();
  expect(findLine(s, { x: 34, y: 0 }, { x: 40, y: 6 })).toBeTruthy();
  const dims = Object.values(s.dimensions);
  expect(dims.length).toBe(2);
  expect(dims[1].expression).toBe(dims[0].name);
  await clean(u);
});

test('two distance chamfer on an extended intersection, with independent values', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -40, y: 0 }, { x: 20, y: 0 });
  await lineChain(u, { x: 30, y: 10 }, { x: 30, y: 50 });
  await modify(u, 'Two Distance Chamfer', 'Chamfer');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 30, y: 30 });
  await page.keyboard.type('12');
  await page.keyboard.press('Tab');
  await page.keyboard.type('20');
  await u.settle();
  await u.shot('modify-chamfer-two');
  await u.press('Enter');
  const s = await u.sketch();
  expect(findLine(s, { x: 18, y: 0 }, { x: 30, y: 20 })).toBeTruthy();
  const values = Object.values(s.dimensions).map((d) => d.value).sort((a, b) => a - b);
  expect(values[0]).toBeCloseTo(12, 3);
  expect(values[1]).toBeCloseTo(20, 3);
  await clean(u);
});

test('distance and angle chamfer, switched in the palette keeping the picks', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 });
  await modify(u, 'Equal Distance Chamfer', 'Chamfer');
  await u.click({ x: 40, y: 0 });
  await u.page.locator('.palette .type-btn[aria-label="Distance And Angle Chamfer"]').click();
  await u.settle();
  expect(await page.evaluate(() => window.__sketch.tool)).toBe('chamfer-distance-angle');
  await expect(page.locator('.hud-field')).toHaveCount(2);
  await u.shot('modify-chamfer-angle');
  await page.keyboard.type('10');
  await page.keyboard.press('Tab');
  await page.keyboard.type('30');
  await u.press('Enter');
  const s = await u.sketch();
  const dims = Object.values(s.dimensions);
  expect(dims.map((d) => d.kind).sort()).toEqual(['angle', 'distance']);
  expect(dims.find((d) => d.kind === 'angle')?.value).toBeCloseTo(Math.PI / 6, 4);
  expect(dims.find((d) => d.kind === 'distance')?.value).toBeCloseTo(10, 4);
  // 30 degrees at the first line's cut: the far end sits 10 tan 30 up the other line.
  const edge = Object.values(s.curves).filter((c): c is Line => c.type === 'line').find((l) => {
    const [a, b] = lineEnds(s, l);
    return a.y !== 0 && b.y !== 0 ? false : Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6;
  }) as Line;
  const ends = lineEnds(s, edge).sort((a, b) => a.y - b.y);
  expect(ends[1].x).toBeCloseTo(40, 3);
  expect(ends[0].x).toBeCloseTo(30, 3);
  expect(ends[1].y).toBeCloseTo(10 * Math.tan(Math.PI / 6), 3);
  await clean(u);
});

test('chamfer: drag the handle moves both values the first time', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -40, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 40 });
  await modify(u, 'Two Distance Chamfer', 'Chamfer');
  await u.click({ x: 0, y: 0 });
  // Proportional start: 20% of 40 mm on each line.
  await u.drag({ x: -8, y: 0 }, { x: -14, y: 0 });
  await u.press('Enter');
  const values = Object.values((await u.sketch()).dimensions).map((d) => d.value);
  expect(values[0]).toBeCloseTo(14, 0);
  expect(values[1]).toBeCloseTo(14, 0);
  await clean(u);
});

// ---------------------------------------------------------------------------
// Scale

test('scale: a fully dimensioned rectangle scales its dimensions and stays constrained', async ({ page }) => {
  const u = await start(page);
  await rectangle(u, { x: 0, y: 0 }, { x: 40, y: 25 });
  await dimension(u, [{ x: 20, y: 25 }], { x: 20, y: 34 }, '40');
  await dimension(u, [{ x: 40, y: 12 }], { x: 50, y: 12 }, '25');
  expect((await u.analysis()).dof).toBe(0);

  await page.keyboard.press('ControlOrMeta+a');
  await modify(u, 'Sketch Scale');
  const d = dialog(u, 'Sketch Scale');
  await expect(d.locator('[data-field="Entities"] .select-count')).toHaveText('4 selected');
  await expect(d.locator('.btn.primary')).toBeDisabled();
  await u.click({ x: 0, y: 0 });
  await setField(d, 'Scale Factor', '2');
  await u.settle();
  await u.shot('modify-scale-dialog');
  await ok(u, d);

  const s = await u.sketch();
  const dims = Object.values(s.dimensions).map((m) => m.value).sort((a, b) => a - b);
  expect(dims[0]).toBeCloseTo(50, 4);
  expect(dims[1]).toBeCloseTo(80, 4);
  expect(findLine(s, { x: 0, y: 50 }, { x: 80, y: 50 })).toBeTruthy();
  await clean(u);
  expect((await u.analysis()).dof).toBe(0);
  expect(await u.statusLine()).toContain('Status: Constrained');
});

test('scale: dragging the handle sets the factor, Enter applies', async ({ page }) => {
  const u = await start(page);
  await rectangle(u, { x: 0, y: 0 }, { x: 40, y: 20 });
  await page.keyboard.press('ControlOrMeta+a');
  await modify(u, 'Sketch Scale');
  const d = dialog(u, 'Sketch Scale');
  await u.click({ x: 0, y: 0 });
  // The handle sits on the far corner at factor 1.
  await u.drag({ x: 40, y: 20 }, { x: 20, y: 10 });
  await expect(fieldRow(d, 'Scale Factor').locator('input')).toHaveValue(/^0\.\d+/);
  await u.shot('modify-scale-drag');
  await u.press('Enter');
  const s = await u.sketch();
  expect(Math.max(...Object.values(s.points).map((p) => p.x))).toBeCloseTo(20, 0);
  await clean(u);
});

test('scale: a dimension reaching outside the selection takes the new measure', async ({ page }) => {
  const u = await start(page);
  await circle(u, { x: 30, y: 0 }, { x: 35, y: 0 });
  const [c] = (await u.curves('circle')) as Circle[];
  await u.press('d');
  await u.click({ x: 30, y: 0 });
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 15, y: -14 });
  await u.press('Enter');
  await exitTool(u);
  await dimension(u, [{ x: 33.5, y: 3.5 }], { x: 50, y: 20 }, '10');

  await u.click({ x: 26.5, y: -3.5 });
  await modify(u, 'Sketch Scale');
  await u.click({ x: 0, y: 0 });
  await setField(dialog(u, 'Sketch Scale'), 'Scale Factor', '2');
  await ok(u, dialog(u, 'Sketch Scale'));
  const s = await u.sketch();
  const now = s.curves[c.id] as Circle;
  expect(pointAt(s, now.c).x).toBeCloseTo(60, 3);
  expect(now.r).toBeCloseTo(10, 3);
  await clean(u);
});

// ---------------------------------------------------------------------------
// Offset

async function offsetRectangle(u: SketchUser): Promise<void> {
  await rectangle(u, { x: -20, y: -10 }, { x: 20, y: 10 });
  await u.tool('Offset');
  await u.click({ x: 20, y: 0 });
  await u.move({ x: 34, y: 0 });
  await setField(dialog(u, 'Offset'), 'Distance', '5 mm');
  await u.move({ x: 34, y: 2 });
}

test('offset: a chain auto-selects, the mouse picks the side, glyph and dimension appear', async ({ page }) => {
  const u = await start(page);
  await offsetRectangle(u);
  const d = dialog(u, 'Offset');
  await expect(d.locator('[data-field="Curves"] .select-count')).toHaveText('4 selected');
  // Off by default: on, it would cap the distance so no segment of the chain vanishes (M-F16).
  await expect(d.locator('.form-row', { hasText: 'Match Topology' }).locator('input')).not.toBeChecked();
  await u.shot('modify-offset-dialog');
  await ok(u, d);
  const s = await u.sketch();
  const out = Object.values(s.curves).filter((c) => c.derivedFrom);
  expect(out.length).toBe(4);
  expect(findLine(s, { x: 25, y: -15 }, { x: 25, y: 15 })).toBeTruthy();
  expect(findLine(s, { x: -25, y: 15 }, { x: 25, y: 15 })).toBeTruthy();
  const feature = Object.values(s.features)[0];
  expect(feature.type).toBe('offset');
  const dims = Object.values(s.dimensions);
  expect(dims.length).toBe(1);
  expect(dims[0].expression).toBe('5 mm');
  await glyph(u, feature.id);
  await u.shot('modify-offset-done');
  await clean(u);
});

test('offset: inside a profile, by clicking the region, picks the inner side', async ({ page }) => {
  const u = await start(page);
  await rectangle(u, { x: -20, y: -10 }, { x: 20, y: 10 });
  await u.tool('Offset');
  await u.click({ x: 3, y: 2 });
  const d = dialog(u, 'Offset');
  await expect(d.locator('[data-field="Curves"] .select-count')).toHaveText('4 selected');
  await setField(d, 'Distance', '4');
  await u.move({ x: 3, y: 4 });
  await ok(u, d);
  expect(findLine(await u.sketch(), { x: 16, y: -6 }, { x: 16, y: 6 })).toBeTruthy();
});

test('offset: Two Sides and Symmetric make a feature per side, symmetric linked by name', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -30, y: 0 }, { x: 30, y: 0 });
  await u.tool('Offset');
  await u.click({ x: 0, y: 0 });
  let d = dialog(u, 'Offset');
  await d.locator('select').selectOption('two');
  await setField(d, 'Distance 1', '3');
  await setField(d, 'Distance 2', '7');
  await u.move({ x: 0, y: 20 });
  await u.shot('modify-offset-two');
  await ok(u, d);
  let s = await u.sketch();
  expect(findLine(s, { x: -30, y: 3 }, { x: 30, y: 3 })).toBeTruthy();
  expect(findLine(s, { x: -30, y: -7 }, { x: 30, y: -7 })).toBeTruthy();

  await lineChain(u, { x: -30, y: 40 }, { x: 30, y: 40 });
  await u.tool('Offset');
  await u.click({ x: 0, y: 40 });
  d = dialog(u, 'Offset');
  await d.locator('select').selectOption('symmetric');
  await setField(d, 'Distance', '6');
  await ok(u, d);
  s = await u.sketch();
  expect(findLine(s, { x: -30, y: 46 }, { x: 30, y: 46 })).toBeTruthy();
  expect(findLine(s, { x: -30, y: 34 }, { x: 30, y: 34 })).toBeTruthy();
  const made = Object.values(s.dimensions).slice(-2);
  expect(made[1].expression).toBe(made[0].name);
});

test('regression: an offset of a rectangle follows when the source changes', async ({ page }) => {
  const u = await start(page);
  await offsetRectangle(u);
  await ok(u, dialog(u, 'Offset'));
  await u.tool('Select');
  await u.drag({ x: 20, y: 6 }, { x: 30, y: 6 });
  const s = await u.sketch();
  expect(findLine(s, { x: 30, y: -10 }, { x: 30, y: 10 })).toBeTruthy();
  expect(findLine(s, { x: 35, y: -15 }, { x: 35, y: 15 })).toBeTruthy();
  await clean(u);
});

test('offset: deleting the dimension unlocks, right-click restores it, deleting the glyph removes the link', async ({ page }) => {
  const u = await start(page);
  await offsetRectangle(u);
  await ok(u, dialog(u, 'Offset'));
  await u.tool('Select');
  let s = await u.sketch();
  const fid = Object.keys(s.features)[0];
  const dim = Object.values(s.dimensions)[0];

  await u.click(dim.label);
  expect(await page.evaluate(() => window.__sketch.selection)).toEqual([dim.id]);
  await u.press('Delete');
  s = await u.sketch();
  expect(s.dimensions[dim.id]).toBeUndefined();
  expect(s.features[fid]).toBeTruthy();
  await u.drag({ x: 20, y: 6 }, { x: 26, y: 6 });
  s = await u.sketch();
  expect(findLine(s, { x: 31, y: -15 }, { x: 31, y: 15 })).toBeTruthy();

  await u.rightClick(await glyph(u, fid));
  await page.locator('.marking-list [data-item="add-offset-dimension"]').click();
  await u.settle();
  s = await u.sketch();
  expect(Object.values(s.dimensions).length).toBe(1);
  await u.shot('modify-offset-restored');

  await u.click(await glyph(u, fid));
  expect(await page.evaluate(() => window.__sketch.selection)).toEqual([fid]);
  await u.press('Delete');
  s = await u.sketch();
  expect(s.features[fid]).toBeUndefined();
  expect(Object.values(s.curves).filter((c) => c.derivedFrom).length).toBe(0);
  await u.drag({ x: 26, y: 6 }, { x: 20, y: 6 });
  s = await u.sketch();
  expect(findLine(s, { x: 31, y: -15 }, { x: 31, y: 15 })).toBeTruthy();
});

test('offset: an open chain with an arc keeps its shape, on the side the mouse is', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -40, y: 0 }, { x: 0, y: 0 });
  await menu(u, 'create', '3-Point Arc', 'Arc');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 20, y: 20 });
  await u.click({ x: 14.1, y: 5.9 });
  await exitTool(u);
  await u.tool('Offset');
  await u.click({ x: -20, y: 0 });
  const d = dialog(u, 'Offset');
  await expect(d.locator('[data-field="Curves"] .select-count')).toHaveText('2 selected');
  await setField(d, 'Distance', '4');
  await u.move({ x: -20, y: 10 });
  await ok(u, d);
  const s = await u.sketch();
  const out = Object.values(s.curves).filter((c) => c.derivedFrom);
  expect(out.map((c) => c.type).sort()).toEqual(['arc', 'line']);
  const line = out.find((c): c is Line => c.type === 'line') as Line;
  for (const p of lineEnds(s, line)) expect(p.y).toBeCloseTo(4, 3);
  const arc = out.find((c): c is Arc => c.type === 'arc') as Arc;
  const [source] = ((await u.curves('arc')) as Arc[]).filter((c) => !c.derivedFrom);
  expect(radiusOf(s, arc)).toBeCloseTo(radiusOf(s, source) - 4, 3);
  await clean(u);
});

test('offset: an ellipse picked near an axis stays an ellipse, elsewhere it becomes an oval', async ({ page }) => {
  const u = await start(page);
  const ellipse = async (y: number): Promise<void> => {
    await menu(u, 'create', 'Ellipse');
    await u.click({ x: 0, y });
    await u.click({ x: 30, y });
    await u.click({ x: 0, y: y + 15 });
    await exitTool(u);
  };
  await ellipse(-30);
  await u.tool('Offset');
  await u.click({ x: 30, y: -30 });
  let d = dialog(u, 'Offset');
  await setField(d, 'Distance', '3');
  await u.move({ x: 45, y: -30 });
  await u.shot('modify-offset-ellipse');
  await ok(u, d);
  let out = Object.values((await u.sketch()).curves).filter((c) => c.derivedFrom);
  expect(out.map((c) => c.type)).toEqual(['ellipse']);

  await ellipse(30);
  await u.tool('Offset');
  // 45 degrees of parameter round: far from either axis.
  await u.click({ x: 30 * Math.SQRT1_2, y: 30 + 15 * Math.SQRT1_2 });
  d = dialog(u, 'Offset');
  await setField(d, 'Distance', '3');
  await u.move({ x: 34, y: 45 });
  await u.shot('modify-offset-oval');
  await ok(u, d);
  out = Object.values((await u.sketch()).curves).filter((c) => c.derivedFrom);
  expect(out.map((c) => c.type).sort()).toEqual(['ellipse', 'fitSpline']);
  await clean(u);
});

// ---------------------------------------------------------------------------
// Blend

test('blend G1: tangent control spline between the picked ends, with hover preview', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -50, y: 0 }, { x: -15, y: 0 });
  await lineChain(u, { x: 15, y: 25 }, { x: 50, y: 25 });
  await modify(u, 'Blend Curve');
  await u.click({ x: -20, y: 0 });
  await u.move({ x: 20, y: 25 });
  await u.shot('modify-blend-hover');
  await u.click({ x: 20, y: 25 });
  const s = await u.sketch();
  const [spline] = (await u.curves('controlSpline')) as ControlSpline[];
  expect(spline.degree).toBe(3);
  expect(near(pointAt(s, spline.pts[0]), { x: -15, y: 0 }, 1e-2)).toBe(true);
  expect(near(pointAt(s, spline.pts[spline.pts.length - 1]), { x: 15, y: 25 }, 1e-2)).toBe(true);
  expect(pointAt(s, spline.pts[1]).y).toBeCloseTo(0, 2);
  expect(pointAt(s, spline.pts[2]).y).toBeCloseTo(25, 2);
  expect(constraintsOfType(s, 'tangent')).toBe(2);
  await clean(u);
  await exitTool(u);
});

test('blend G2: curvature continuous at an arc, from the palette', async ({ page }) => {
  const u = await start(page);
  await menu(u, 'create', '3-Point Arc', 'Arc');
  await u.click({ x: -40, y: 0 });
  await u.click({ x: -20, y: 20 });
  await u.click({ x: -34.1, y: 14.1 });
  await exitTool(u);
  await lineChain(u, { x: 30, y: 30 }, { x: 60, y: 30 });
  await modify(u, 'Blend Curve');
  await page.locator('.palette select').selectOption('G2');
  await u.settle();
  await u.click({ x: -22, y: 19 });
  await u.move({ x: 34, y: 30 });
  await u.shot('modify-blend-g2');
  await u.click({ x: 34, y: 30 });
  const s = await u.sketch();
  const [spline] = (await u.curves('controlSpline')) as ControlSpline[];
  expect(spline.degree).toBe(5);
  expect(constraintsOfType(s, 'curvature')).toBe(2);
  // Three control points set the end curvature, so against the line they must lie straight.
  const [p0, p1, p2] = spline.pts.slice(-3).reverse().map((id) => pointAt(s, id));
  expect(p0.y).toBeCloseTo(p1.y, 2);
  expect(p1.y).toBeCloseTo(p2.y, 2);
  await clean(u);
  await exitTool(u);
});

// ---------------------------------------------------------------------------
// Move/Copy

test('move: M with a selection, typed dx dy, OK', async ({ page }) => {
  const u = await start(page);
  await rectangle(u, { x: -20, y: -10 }, { x: 0, y: 10 });
  await page.keyboard.press('ControlOrMeta+a');
  await u.press('m');
  const d = dialog(u, 'Move/Copy');
  await expect(d.locator('[data-field="Objects"] .select-count')).toHaveText('4 selected');
  await setField(d, 'X Distance', '15');
  await setField(d, 'Y Distance', '-5');
  await u.settle();
  await u.shot('modify-move-dialog');
  await ok(u, d);
  const s = await u.sketch();
  expect(findLine(s, { x: -5, y: -15 }, { x: 15, y: -15 })).toBeTruthy();
  expect((await u.lines()).length).toBe(4);
  await clean(u);
});

test('move: Copy leaves the original, rotated about the selection centre', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -10, y: 0 }, { x: 10, y: 0 });
  await page.keyboard.press('ControlOrMeta+a');
  await u.press('m');
  const d = dialog(u, 'Move/Copy');
  await setField(d, 'X Distance', '30');
  await setField(d, 'Z Angle', '90');
  await fieldRow(d, 'Create Copy').locator('input').check();
  await ok(u, d);
  const s = await u.sketch();
  expect((await u.lines()).length).toBe(2);
  expect(findLine(s, { x: -10, y: 0 }, { x: 10, y: 0 })).toBeTruthy();
  expect(findLine(s, { x: 30, y: -10 }, { x: 30, y: 10 })).toBeTruthy();
});

test('move: the XY manipulator and rotate ring feed the fields', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -20, y: -10 }, { x: 20, y: -10 });
  await page.keyboard.press('ControlOrMeta+a');
  await u.press('m');
  const d = dialog(u, 'Move/Copy');
  const c = { x: 0, y: -10 };
  const arm = 72 / 4;
  await u.drag({ x: c.x + arm, y: c.y }, { x: c.x + arm + 12, y: c.y + 5 });
  await expect(fieldRow(d, 'X Distance').locator('input')).toHaveValue('12 mm');
  await expect(fieldRow(d, 'Y Distance').locator('input')).toHaveValue('0 mm');
  await u.drag({ x: 12, y: -10 }, { x: 12, y: 0 });
  await expect(fieldRow(d, 'X Distance').locator('input')).toHaveValue('12 mm');
  await expect(fieldRow(d, 'Y Distance').locator('input')).toHaveValue('10 mm');
  const ring = { x: 12 + arm * 0.75, y: 0 + arm * 0.75 };
  await u.drag(ring, { x: 12 - arm * 0.75, y: 0 + arm * 0.75 });
  await expect(fieldRow(d, 'Z Angle').locator('input')).toHaveValue('90 deg');
  await u.shot('modify-move-manipulator');
  await ok(u, d);
  const s = await u.sketch();
  expect(findLine(s, { x: 12, y: -20 }, { x: 12, y: 20 })).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Change Parameters

test('parameters: user parameters drive dimensions, with live errors and read-only driven rows', async ({ page }) => {
  const u = await start(page);
  await rectangle(u, { x: 0, y: 0 }, { x: 40, y: 25 });
  await dimension(u, [{ x: 20, y: 25 }], { x: 20, y: 34 }, '40');
  await dimension(u, [{ x: 40, y: 12 }], { x: 50, y: 12 }, '25');
  // The opposite side is forced equal, so this one goes Driven.
  await u.press('d');
  await u.click({ x: 20, y: 0 });
  await u.click({ x: 20, y: -9 });
  await exitTool(u);
  let s = await u.sketch();
  const [width, height, driven] = Object.values(s.dimensions);
  expect(driven.driving).toBe(false);

  await modify(u, 'Change Parameters');
  const d = dialog(u, 'Parameters');
  await d.locator('[data-action="add-parameter"]').click();
  const row = d.locator('.param-row[data-param="p1"]');
  await row.locator('input').nth(0).fill('span');
  await row.locator('input').nth(0).press('Enter');
  const user = d.locator('.param-row[data-param="span"]');
  const expr = user.locator('input').nth(1);
  await expr.fill('60 mm');
  await expr.press('Enter');
  await expect(user.locator('.param-value')).toHaveText('60.00');

  // A live error: red, explained, OK off. Nothing commits.
  const model = d.locator(`.param-row[data-param="${width.name}"]`);
  const widthExpr = model.locator('input').nth(1);
  await widthExpr.fill('span *');
  await expect(widthExpr).toHaveClass(/invalid/);
  await expect(d.locator('.dialog-error')).not.toBeEmpty();
  await expect(d.locator('.btn.primary')).toBeDisabled();
  await widthExpr.fill(`${width.name} + 1`);
  await expect(d.locator('.dialog-error')).toContainText('Circular');
  await widthExpr.fill('span / 2 + 10 mm');
  await expect(d.locator('.dialog-error')).toBeEmpty();
  await widthExpr.press('Enter');
  await expect(model.locator('.param-value')).toHaveText('40.00');
  await expr.fill('100 mm');
  await expr.press('Enter');
  await expect(model.locator('.param-value')).toHaveText('60.00');

  // Driven is shown in parentheses and cannot be typed in, and follows.
  const drivenRow = d.locator(`.param-row[data-param="${driven.name}"]`);
  await expect(drivenRow.locator('.param-value')).toHaveText('(60.00)');
  await expect(drivenRow.locator('.param-driven')).toHaveJSProperty('readOnly', true);
  await expect(drivenRow.locator('.param-unit')).toHaveText('mm');
  await u.shot('modify-parameters');

  // A parameter in use cannot go.
  await user.locator('.param-delete').click();
  await expect(d.locator('.dialog-error')).toContainText(width.name);
  await ok(u, d);

  s = await u.sketch();
  expect(s.dimensions[width.id].value).toBeCloseTo(60, 6);
  expect(findLine(s, { x: 0, y: 25 }, { x: 60, y: 25 })).toBeTruthy();
  expect(height.value).toBeCloseTo(25, 3);
  await clean(u);
  const design = await u.design();
  expect(design.parameters.map((p) => p.name)).toEqual(['span']);
});

test('parameters: renaming follows into expressions; Cancel puts everything back', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: 0, y: 0 }, { x: 30, y: 0 });
  await dimension(u, [{ x: 15, y: 0 }], { x: 15, y: 10 }, '30');
  await modify(u, 'Change Parameters');
  let d = dialog(u, 'Parameters');
  await d.locator('[data-action="add-parameter"]').click();
  const expr = d.locator('.param-row[data-param="p1"] input').nth(1);
  await expr.fill('44 mm');
  await expr.press('Enter');
  const dimRow = d.locator('.param-row[data-param="d1"]');
  await dimRow.locator('input').nth(1).fill('p1');
  await dimRow.locator('input').nth(1).press('Enter');
  await ok(u, d);
  expect(Object.values((await u.sketch()).dimensions)[0].value).toBeCloseTo(44, 6);

  await modify(u, 'Change Parameters');
  d = dialog(u, 'Parameters');
  const name = d.locator('.param-row[data-param="p1"] input').nth(0);
  await name.fill('long');
  await name.press('Enter');
  await expect(d.locator('.param-row[data-param="d1"] input').nth(1)).toHaveValue('long');
  await expect(fieldless(d, 'long')).toHaveValue('44 mm');
  await fieldless(d, 'long').fill('50 mm');
  await fieldless(d, 'long').press('Enter');
  await expect(d.locator('.param-row[data-param="d1"] .param-value')).toHaveText('50.00');
  await d.locator('.dialog-foot .btn', { hasText: 'Cancel' }).click();
  await u.settle();
  const after = await u.design();
  expect(after.parameters[0].name).toBe('p1');
  expect(after.parameters[0].expression).toBe('44 mm');
  const sk = await u.sketch();
  expect((sk as Sketch).dimensions[Object.keys(sk?.dimensions ?? {})[0]].expression).toBe('p1');
  expect(Object.values(sk.dimensions)[0].value).toBeCloseTo(44, 6);
});

test('parameters: text in curly braces follows a parameter edit', async ({ page }) => {
  const u = await start(page);
  await modify(u, 'Change Parameters');
  let d = dialog(u, 'Parameters');
  await d.locator('[data-action="add-parameter"]').click();
  await fieldless(d, 'p1').fill('1 mm');
  await fieldless(d, 'p1').press('Enter');
  await ok(u, d);

  await menu(u, 'create', 'Text');
  await u.click({ x: -30, y: 0 });
  await u.click({ x: 30, y: 30 });
  await dialog(u, 'Text').locator('textarea').fill('{p1}');
  await setField(dialog(u, 'Text'), 'Height', '10');
  await ok(u, dialog(u, 'Text'));
  const id = (await page.evaluate(() => window.__sketch.activeId)) as Id;
  const outlines = async (): Promise<number> => parseDxf((await exportFromBrowser(u, id, async () => undefined, 'text')).text).POLYLINE;
  await expect.poll(outlines).toBe(1);

  await modify(u, 'Change Parameters');
  d = dialog(u, 'Parameters');
  await fieldless(d, 'p1').fill('111 mm');
  await fieldless(d, 'p1').press('Enter');
  await ok(u, d);
  await u.shot('modify-parameters-text');
  expect(await outlines()).toBe(3);
});

const fieldless = (d: Locator, param: string): Locator => d.locator(`.param-row[data-param="${param}"] input`).nth(1);

// ---------------------------------------------------------------------------
// Mirror

test('mirror: preselection fills Objects, X clears, a curved line is refused, live preview', async ({ page }) => {
  const u = await start(page);
  await circle(u, { x: 30, y: 30 }, { x: 36, y: 30 });
  await lineChain(u, { x: 0, y: -40 }, { x: 0, y: 40 });
  await menu(u, 'create', '3-Point Arc', 'Arc');
  await u.click({ x: -30, y: 30 });
  await u.click({ x: -30, y: 0 });
  await u.click({ x: -38, y: 15 });
  await exitTool(u);

  await u.click({ x: 34.2, y: 34.2 });
  await u.tool('Mirror');
  const d = dialog(u, 'Mirror');
  await expect(d.locator('[data-field="Objects"] .select-count')).toHaveText('1 selected');
  await expect(d.locator('.btn.primary')).toBeDisabled();

  // Mirror Line was armed by the preselection; the arc will not do.
  await u.click({ x: -38, y: 15 });
  expect(await page.evaluate(() => window.__sketch.note)).toContain('straight');
  await expect(d.locator('[data-field="Mirror Line"] .select-count')).toHaveText('');

  // X next to Objects cancels the preselection [ref note].
  await d.locator('[data-field="Objects"] .icon-btn').click();
  await expect(d.locator('[data-field="Objects"] .select-count')).toHaveText('');
  await u.click({ x: 34.2, y: 34.2 });
  await selectInField(d, 'Mirror Line');
  await u.click({ x: 0, y: 20 });
  await u.shot('modify-mirror-preview');
  await ok(u, d);
  const s = await u.sketch();
  const copies = (await u.curves('circle')) as Circle[];
  expect(copies.length).toBe(2);
  const copy = copies.find((c) => pointAt(s, c.c).x < 0) as Circle;
  expect(pointAt(s, copy.c).x).toBeCloseTo(-30, 3);
  expect(copy.r).toBeCloseTo(6, 3);
  expect(constraintsOfType(s, 'symmetric')).toBeGreaterThanOrEqual(1);
  await clean(u);
});

test('regression: mirror, then moving the source moves the copy', async ({ page }) => {
  const u = await start(page);
  await rectangle(u, { x: 10, y: 10 }, { x: 30, y: 25 });
  await lineChain(u, { x: 0, y: -40 }, { x: 0, y: 40 });
  await u.tool('Mirror');
  const d = dialog(u, 'Mirror');
  await u.drag({ x: 5, y: 30 }, { x: 35, y: 5 });
  await selectInField(d, 'Mirror Line');
  await u.click({ x: 0, y: -20 });
  await ok(u, d);
  await u.tool('Select');
  await u.drag({ x: 30, y: 17 }, { x: 40, y: 17 });
  const s = await u.sketch();
  expect(findLine(s, { x: 40, y: 10 }, { x: 40, y: 25 })).toBeTruthy();
  expect(findLine(s, { x: -40, y: 10 }, { x: -40, y: 25 })).toBeTruthy();
  await clean(u);
  await u.shot('modify-mirror-moved');
});

// ---------------------------------------------------------------------------
// Patterns

async function rectPatternOf(u: SketchUser): Promise<Locator> {
  await rectangle(u, { x: -60, y: -10 }, { x: -50, y: 0 });
  await page_selectAll(u);
  await u.tool('Rectangular Pattern');
  return dialog(u, 'Rectangular Pattern');
}

const page_selectAll = async (u: SketchUser): Promise<void> => {
  await u.page.keyboard.press('ControlOrMeta+a');
  await u.settle();
};

test('rectangular pattern: extent, spacing and a second direction', async ({ page }) => {
  const u = await start(page);
  const d = await rectPatternOf(u);
  await expect(d.locator('[data-field="Objects"] .select-count')).toHaveText('4 selected');
  await fieldRow(d, 'Quantity').first().locator('input').fill('3');
  await fieldRow(d, 'Distance').first().locator('input').fill('40');
  await u.settle();
  await u.shot('modify-pattern-rect');
  await ok(u, d);
  let s = await u.sketch();
  let f = Object.values(s.features)[0];
  expect(f.type).toBe('rectPattern');
  expect((await u.lines()).length).toBe(12);
  expect(findLine(s, { x: -20, y: -10 }, { x: -20, y: 0 })).toBeTruthy();
  expect(findLine(s, { x: -25, y: -10 }, { x: -25, y: 0 })).toBeFalsy();
  await clean(u);

  await u.tool('Select');
  await u.doubleClick(await glyph(u, f.id));
  const e = dialog(u, 'Rectangular Pattern');
  await e.locator('select').first().selectOption('spacing');
  await fieldRow(e, 'Quantity').first().locator('input').fill('2');
  await fieldRow(e, 'Distance').first().locator('input').fill('15');
  await fieldRow(e, 'Quantity').nth(1).locator('input').fill('2');
  await fieldRow(e, 'Distance').nth(1).locator('input').fill('20');
  await ok(u, e);
  s = await u.sketch();
  f = Object.values(s.features)[0];
  expect((await u.lines()).length).toBe(16);
  expect(findLine(s, { x: -35, y: 10 }, { x: -35, y: 20 })).toBeTruthy();
  await clean(u);
});

test('rectangular pattern: distance and quantity handles', async ({ page }) => {
  const u = await start(page);
  const d = await rectPatternOf(u);
  await fieldRow(d, 'Distance').first().locator('input').fill('40');
  await u.settle();
  // Handles hang from the source's centre: distance at the far end, quantity beside its middle.
  const centre = { x: -55, y: -5 };
  await u.drag({ x: centre.x + 40, y: centre.y }, { x: centre.x + 60, y: centre.y });
  await expect(fieldRow(d, 'Distance').first().locator('input')).toHaveValue('60 mm');
  await u.drag({ x: centre.x + 30, y: centre.y - 5 }, { x: centre.x + 30 + 13, y: centre.y - 5 });
  await expect(fieldRow(d, 'Quantity').first().locator('input')).toHaveValue('5');
  await u.shot('modify-pattern-handles');
  await ok(u, d);
  expect((await u.lines()).length).toBe(20);
});

test('rectangular pattern: a picked line sets the direction', async ({ page }) => {
  const u = await start(page);
  await rectangle(u, { x: 0, y: 0 }, { x: 10, y: 10 });
  await lineChain(u, { x: -50, y: -40 }, { x: -20, y: -10 });
  await u.tool('Rectangular Pattern');
  const d = dialog(u, 'Rectangular Pattern');
  await u.drag({ x: -3, y: 13 }, { x: 13, y: -3 });
  await expect(d.locator('[data-field="Objects"] .select-count')).toHaveText('4 selected');
  await selectInField(d, 'Direction 1');
  await u.click({ x: -35, y: -25 });
  await fieldRow(d, 'Quantity').first().locator('input').fill('2');
  await fieldRow(d, 'Distance').first().locator('input').fill(String(20 * Math.SQRT2));
  await u.settle();
  await ok(u, d);
  const s = await u.sketch();
  expect(findLine(s, { x: 20, y: 20 }, { x: 30, y: 20 })).toBeTruthy();
  await clean(u);
});

test('regression: suppress an instance from its canvas box, then the Suppress row restores it', async ({ page }) => {
  const u = await start(page);
  const d = await rectPatternOf(u);
  await fieldRow(d, 'Distance').first().locator('input').fill('40');
  await u.settle();
  const box = { x: -35 + 16 / 4, y: -5 + 16 / 4 };
  await u.click(box);
  await u.shot('modify-pattern-suppress');
  await ok(u, d);
  let s = await u.sketch();
  const f = Object.values(s.features)[0] as Extract<Sketch['features'][string], { type: 'rectPattern' }>;
  expect(f.suppressed).toEqual(['1,0']);
  expect((await u.lines()).length).toBe(8);
  expect(findLine(s, { x: -40, y: -10 }, { x: -40, y: 0 })).toBeFalsy();
  expect(findLine(s, { x: -20, y: -10 }, { x: -20, y: 0 })).toBeTruthy();
  await clean(u);

  await u.tool('Select');
  await u.doubleClick(await glyph(u, f.id));
  const e = dialog(u, 'Rectangular Pattern');
  await fieldRow(e, 'Suppress').locator('input').uncheck();
  await u.settle();
  await u.shot('modify-pattern-no-boxes');
  await ok(u, e);
  s = await u.sketch();
  expect((await u.lines()).length).toBe(12);
  expect((Object.values(s.features)[0] as typeof f).suppressed).toEqual([]);
});

async function circleAndCentre(u: SketchUser): Promise<Locator> {
  await circle(u, { x: 30, y: 0 }, { x: 32, y: 0 });
  await u.tool('Circular Pattern');
  const d = dialog(u, 'Circular Pattern');
  await u.click({ x: 31.4, y: 1.4 });
  await selectInField(d, 'Center Point');
  await u.click({ x: 0, y: 0 });
  return d;
}

test('regression: pattern quantity edit through a double click on the glyph', async ({ page }) => {
  const u = await start(page);
  const d = await circleAndCentre(u);
  await fieldRow(d, 'Quantity').locator('input').fill('4');
  await u.settle();
  await u.shot('modify-pattern-circ');
  await ok(u, d);
  expect((await u.curves('circle')).length).toBe(4);
  const s = await u.sketch();
  const f = Object.values(s.features)[0];
  await u.tool('Select');
  await u.doubleClick(await glyph(u, f.id));
  const e = dialog(u, 'Circular Pattern');
  await expect(fieldRow(e, 'Quantity').locator('input')).toHaveValue('4');
  await fieldRow(e, 'Quantity').locator('input').fill('8');
  await ok(u, e);
  const after = (await u.curves('circle')) as Circle[];
  expect(after.length).toBe(8);
  const now = await u.sketch();
  const angles = after.map((c) => Math.atan2(pointAt(now, c.c).y, pointAt(now, c.c).x)).sort((a, b) => a - b);
  for (let i = 1; i < 8; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo(Math.PI / 4, 3);
  await clean(u);
  // The same pattern, not a second one.
  expect(Object.keys(now.features).length).toBe(1);
});

test('circular pattern: Angle spacing with the angle and quantity handles, Symmetric too', async ({ page }) => {
  const u = await start(page);
  const d = await circleAndCentre(u);
  await d.locator('select').selectOption('angle');
  await setField(d, 'Total Angle', '90');
  await fieldRow(d, 'Quantity').locator('input').fill('3');
  await u.settle();
  // The angle handle is the source rotated by the total angle.
  await u.drag({ x: 0, y: 30 }, { x: -30, y: 0 });
  await expect(fieldRow(d, 'Total Angle').locator('input')).toHaveValue('180 deg');
  await u.drag({ x: 30 + 34 / 4, y: 0 }, { x: 30 + 34 / 4 + 13, y: 0 });
  await expect(fieldRow(d, 'Quantity').locator('input')).toHaveValue('5');
  await u.shot('modify-pattern-angle');
  await ok(u, d);
  const s = await u.sketch();
  const list = (await u.curves('circle')) as Circle[];
  expect(list.length).toBe(5);
  expect(list.some((c) => near(pointAt(s, c.c), { x: -30, y: 0 }, 1e-3))).toBe(true);
  expect(list.some((c) => near(pointAt(s, c.c), { x: 0, y: 30 }, 1e-3))).toBe(true);

  await page.keyboard.press('ControlOrMeta+z');
  await u.settle();
  await u.tool('Circular Pattern');
  const e = dialog(u, 'Circular Pattern');
  await u.click({ x: 31.4, y: 1.4 });
  await selectInField(e, 'Center Point');
  await u.click({ x: 0, y: 0 });
  await e.locator('select').selectOption('symmetric');
  await setField(e, 'Total Angle', '180');
  await fieldRow(e, 'Quantity').locator('input').fill('3');
  await ok(u, e);
  const t = await u.sketch();
  const both = (await u.curves('circle')) as Circle[];
  expect(both.some((c) => near(pointAt(t, c.c), { x: 0, y: 30 }, 1e-3))).toBe(true);
  expect(both.some((c) => near(pointAt(t, c.c), { x: 0, y: -30 }, 1e-3))).toBe(true);
});

// ---------------------------------------------------------------------------
// AutoConstrain

/** A rectangle and a circle, drawn exactly, so the rules have plenty to find. */
async function loose(u: SketchUser): Promise<void> {
  await rectangle(u, { x: -40, y: -20 }, { x: 20, y: 20 });
  await circle(u, { x: -10, y: 0 }, { x: -4, y: 0 });
}

const tiles = (d: Locator): Locator => d.locator('.auto-tile');

test('autoconstrain: labelled local, tiles with counts and lock state, purple preview, OK applies', async ({ page }) => {
  const u = await start(page);
  await loose(u);
  const before = await u.sketch();
  await constrain(u, 'AutoConstrain');
  const d = dialog(u, 'AutoConstrain');
  await expect(d.locator('.auto-engine')).toContainText('Local rules engine');
  await expect(tiles(d)).toHaveCount(3);
  await expect(tiles(d).first()).toHaveClass(/active/);
  await expect(tiles(d).first().locator('.auto-lock.locked')).toHaveAttribute('title', 'Fully Constrained');
  const tip = await tiles(d).first().locator('.auto-counts').getAttribute('title');
  expect(tip).toMatch(/^Adds \d+ constraints and \d+ dimensions/);
  await expect(tiles(d).first().locator('.auto-count').first()).toContainText('constraints');
  // Nothing is in the document until OK.
  expect(JSON.stringify(await u.sketch())).toBe(JSON.stringify(before));
  await u.shot('modify-auto-dialog');

  await tiles(d).nth(1).locator('.auto-tile-head').click();
  await expect(tiles(d).nth(1)).toHaveClass(/active/);
  await tiles(d).first().locator('.auto-tile-head').click();
  await ok(u, d);
  const a = await u.analysis();
  expect(a.dof).toBe(0);
  expect(a.unsatisfied).toEqual([]);
  expect(await u.statusLine()).toContain('Status: Constrained');
  const s = await u.sketch();
  expect(Object.keys(s.dimensions).length).toBeGreaterThan(0);
  // Undo takes the whole result off in one step.
  await page.keyboard.press('ControlOrMeta+z');
  await u.settle();
  expect(JSON.stringify(Object.keys((await u.sketch()).constraints))).toBe(JSON.stringify(Object.keys(before.constraints)));
});

test('autoconstrain: slider reduces, Generate more adds two at a time to the limit', async ({ page }) => {
  const u = await start(page);
  await loose(u);
  await constrain(u, 'AutoConstrain');
  const d = dialog(u, 'AutoConstrain');
  const first = tiles(d).first();
  const added = async (): Promise<number> => {
    const m = /Adds (\d+) constraints and (\d+) dimensions/.exec((await first.locator('.auto-counts').getAttribute('title')) ?? '') as RegExpExecArray;
    return Number(m[1]) + Number(m[2]);
  };
  const full = await added();
  await d.locator('input[aria-label="Constraint quantity"]').fill('30');
  await expect.poll(added).toBeLessThan(full);
  await expect(first.locator('.auto-lock.open')).toHaveAttribute('title', 'Partially Constrained');
  await u.shot('modify-auto-slider');
  await d.locator('[aria-label="Add Constraints"]').click();
  const more = await added();
  expect(more).toBeLessThan(full);
  await d.locator('input[aria-label="Constraint quantity"]').fill('100');
  await expect.poll(added).toBe(full);

  await d.locator('[data-action="auto-generate"]').click();
  await expect(tiles(d)).toHaveCount(5);
  await expect(d.locator('[data-action="auto-generate"]')).toBeDisabled();
  await d.locator('.dialog-foot .btn', { hasText: 'Cancel' }).click();
  await u.settle();
  expect(Object.keys((await u.sketch()).dimensions).length).toBe(0);
});

test('autoconstrain: Set Datum from More, and From Datum before generating', async ({ page }) => {
  const u = await start(page);
  await loose(u);
  await constrain(u, 'AutoConstrain');
  let d = dialog(u, 'AutoConstrain');
  await d.locator('[data-action="auto-more"]').click();
  await d.locator('.menu-item[data-item="Set Datum"]').click();
  await expect(d.locator('.auto-datum')).toContainText('Select a point');
  await expect(d.locator('.btn.primary')).toBeDisabled();
  await u.click({ x: 20, y: 20 });
  await expect(d.locator('.auto-datum')).toContainText('Datum: Point');
  await u.shot('modify-auto-datum');
  await ok(u, d);
  let s = await u.sketch();
  const near20 = (id: Id): boolean => id !== 'origin' && !!s.points[id] && near(s.points[id], { x: 20, y: 20 });
  expect(Object.values(s.dimensions).some((m) => m.refs.some(near20))).toBe(true);

  await page.keyboard.press('ControlOrMeta+z');
  await u.settle();
  await constrain(u, 'AutoConstrain From Datum');
  d = dialog(u, 'AutoConstrain');
  await expect(tiles(d)).toHaveCount(0);
  await expect(d.locator('.auto-datum')).toContainText('Select a point');
  await u.click({ x: -40, y: -20 });
  await expect(tiles(d)).toHaveCount(3);
  await ok(u, d);
  s = await u.sketch();
  expect((await u.analysis()).dof).toBe(0);
  await clean(u);
});

test('autoconstrain: a selected point is the datum', async ({ page }) => {
  const u = await start(page);
  await loose(u);
  await u.click({ x: 20, y: 20 });
  await constrain(u, 'AutoConstrain');
  await expect(dialog(u, 'AutoConstrain').locator('.auto-datum')).toContainText('Datum: Point');
  await exitTool(u);
});

test('autoconstrain: Modify Geometry snaps what is nearly true within the tolerance', async ({ page }) => {
  const u = await start(page);
  // Nearly horizontal: 0.75 mm rise over 40 mm, beyond the default tolerance.
  await u.press('l');
  await page.keyboard.down('Meta');
  await u.click({ x: 0, y: 10 });
  await u.click({ x: 40, y: 10.75 });
  await page.keyboard.up('Meta');
  await exitTool(u);
  const [line] = await u.lines();
  await constrain(u, 'AutoConstrain');
  const d = dialog(u, 'AutoConstrain');
  await expect(tiles(d)).toHaveCount(3);
  await d.getByLabel('Modify Geometry').check();
  await d.locator('input[aria-label="Tolerance"]').fill('2');
  await expect(d.locator('input[aria-label="Tolerance"]')).toHaveValue('2');
  await u.settle();
  await ok(u, d);
  const s = await u.sketch();
  const [a, b] = lineEnds(s, s.curves[line.id] as Line);
  expect(a.y).toBeCloseTo(b.y, 3);
  await clean(u);
});

test('autoconstrain: delete a preview item, Refresh regenerates without it', async ({ page }) => {
  const u = await start(page);
  await loose(u);
  await constrain(u, 'AutoConstrain');
  const d = dialog(u, 'AutoConstrain');
  await expect(tiles(d)).toHaveCount(3);
  const counts = (): Promise<string | null> => tiles(d).first().locator('.auto-counts').getAttribute('title');
  const before = await counts();
  // The circle's diameter: its proposed label sits a radius up and across from the centre.
  await u.click({ x: -4, y: 6 });
  await u.press('Delete');
  await expect.poll(counts).not.toBe(before);
  await expect(d.locator('[data-action="auto-refresh"]')).toBeVisible();
  await u.shot('modify-auto-refresh');
  await d.locator('[data-action="auto-refresh"]').click();
  await expect(d.locator('[data-action="auto-refresh"]')).toHaveCount(0);
  await ok(u, d);
  const s = await u.sketch();
  expect(Object.values(s.dimensions).some((m) => m.kind === 'diameter')).toBe(false);
  await clean(u);
});

test('finish with autoconstrain: applies and finishes; Cancel finishes without; limits grey it', async ({ page }) => {
  const u = await start(page);
  const open = async (): Promise<Locator> => {
    await page.locator('.panel.finish .panel-name').click();
    return page.locator('.menu-item[data-item="Finish with AutoConstrain"]');
  };
  // An empty sketch: 0 entities [ref].
  const item = await open();
  await expect(item).toHaveClass(/disabled/);
  await expect(item).toHaveAttribute('title', 'The sketch is empty');
  await page.keyboard.press('Escape');

  await loose(u);
  await (await open()).click();
  await expect(dialog(u, 'Finish with AutoConstrain')).toContainText('Constraining your sketch...');
  await u.shot('modify-auto-finish');
  await expect(page.locator('.tab.active')).toHaveText('SOLID');
  const design = await u.design();
  const sketch = Object.values(design.sketches)[0];
  expect(Object.keys(sketch.dimensions).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__sketch.mode)).toBe('design');

  // Undo the result, go back in, and Cancel this time.
  await page.keyboard.press('ControlOrMeta+z');
  await u.settle();
  await page.locator(`.sketch-row[data-sketch="${sketch.id}"]`).dblclick();
  await u.settle();
  await (await open()).click();
  await dialog(u, 'Finish with AutoConstrain').locator('.btn', { hasText: 'Cancel' }).click();
  await expect(page.locator('.tab.active')).toHaveText('SOLID');
  expect(Object.keys(Object.values((await u.design()).sketches)[0].dimensions).length).toBe(0);
});

test('autoconstrain: more than 250 entities is refused', async ({ page }) => {
  test.setTimeout(120_000);
  const u = await start(page);
  await circle(u, { x: -100, y: -60 }, { x: -99, y: -60 });
  await u.tool('Rectangular Pattern');
  const d = dialog(u, 'Rectangular Pattern');
  await u.click({ x: -99, y: -60 });
  await fieldRow(d, 'Quantity').nth(0).locator('input').fill('26');
  await fieldRow(d, 'Quantity').nth(1).locator('input').fill('10');
  await ok(u, d);
  expect(Object.keys((await u.sketch()).curves).length).toBe(260);
  await page.locator('.panel[data-panel="constraints"] .panel-name').click();
  const item = page.locator('.menu-item[data-item="AutoConstrain"]');
  await expect(item).toHaveClass(/disabled/);
  await expect(item).toHaveAttribute('title', /250/);
  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// DXF

/** Read a DXF as a reader would: code and value pairs, entities counted inside their section. */
function parseDxf(text: string): Record<string, number> {
  const lines = text.split(/\r?\n/);
  const counts: Record<string, number> = { LINE: 0, ARC: 0, CIRCLE: 0, POINT: 0, POLYLINE: 0 };
  let section = '';
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]);
    const value = lines[i + 1].trim();
    if (code === 2 && lines[i - 1]?.trim() === 'SECTION') section = value;
    if (code === 0 && section === 'ENTITIES' && value in counts) counts[value]++;
  }
  expect(lines.filter((l) => l.trim() === 'EOF').length).toBe(1);
  return counts;
}

async function exportFromBrowser(u: SketchUser, id: Id, settings: (d: Locator) => Promise<void>, name: string): Promise<{ text: string; file: string }> {
  await u.page.locator(`.sketch-row[data-sketch="${id}"]`).click({ button: 'right' });
  await u.page.locator('.popup-menu .menu-item[data-item="Export DXF"]').click();
  const d = dialog(u, 'Export DXF');
  await settings(d);
  await ok(u, d);
  const save = dialog(u, 'Save DXF');
  await fieldRow(save, 'Name').locator('input').fill(name);
  const wait = u.page.waitForEvent('download');
  await save.locator('.btn.primary').click();
  const download = await wait;
  return { text: readFileSync(await download.path(), 'utf8'), file: download.suggestedFilename() };
}

test('export dxf: dialog, chosen unit and geometry, chosen name', async ({ page }) => {
  const u = await start(page);
  await rectangle(u, { x: 0, y: 0 }, { x: 25.4, y: 25.4 });
  await lineChain(u, { x: 0, y: 40 }, { x: 25.4, y: 40 });
  await u.click({ x: 12, y: 40 });
  await page.locator('.palette .type-btn[aria-label="Construction"]').click();
  await u.press('Escape');
  const id = (await page.evaluate(() => window.__sketch.activeId)) as Id;

  const plain = await exportFromBrowser(u, id, async (d) => {
    await expect(d.locator('select')).toHaveValue('mm');
    await u.shot('modify-dxf-dialog');
  }, 'plate');
  expect(plain.file).toBe('plate.dxf');
  expect(parseDxf(plain.text).LINE).toBe(4);

  const all = await exportFromBrowser(u, id, async (d) => {
    await d.locator('select').selectOption('in');
    await d.getByLabel('Construction Geometry').check();
  }, 'plate-inch.dxf');
  expect(all.file).toBe('plate-inch.dxf');
  expect(parseDxf(all.text).LINE).toBe(5);
  // One inch square, written in inches.
  const groups = all.text.split(/\r?\n/);
  const xs = groups.flatMap((v, i) => (v.trim() === '11' ? [Number(groups[i + 1])] : []));
  expect(Math.max(...xs)).toBeCloseTo(1, 1);
  await u.shot('modify-dxf-saved');

  // The browser row works from Design mode too.
  await page.locator('[data-action="palette-finish"]').click();
  await expect(page.locator('.tab.active')).toHaveText('SOLID');
  expect(parseDxf((await exportFromBrowser(u, id, async () => undefined, 'after')).text).LINE).toBe(4);
});

// ---------------------------------------------------------------------------
// Acceptance scenarios

const middle = (s: Sketch, l: Line): Xy => {
  const [a, b] = lineEnds(s, l);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};

const arcTop = (s: Sketch, a: Arc): Xy => {
  const c = pointAt(s, a.c);
  const r = radiusOf(s, a);
  const start = Math.atan2(pointAt(s, a.a).y - c.y, pointAt(s, a.a).x - c.x);
  let end = Math.atan2(pointAt(s, a.b).y - c.y, pointAt(s, a.b).x - c.x);
  if (end < start) end += Math.PI * 2;
  const mid = (start + end) / 2;
  return { x: c.x + r * Math.cos(mid), y: c.y + r * Math.sin(mid) };
};

/** The cutout above the axis: horizontal sides, sorted bottom then top. */
const cutoutSides = (s: Sketch): Line[] => Object.values(s.curves)
  .filter((c): c is Line => c.type === 'line' && c.lineType === 'normal')
  .filter((l) => {
    const [a, b] = lineEnds(s, l);
    return Math.abs(a.y - b.y) < 1e-6 && a.y > 0 && Math.abs(a.x) < 30 && Math.abs(b.x) < 30;
  })
  .sort((p, q) => pointAt(s, p.a).y - pointAt(s, q.a).y);

/** GUID-087596A4, GUID-E8C8752F and GUID-0A723EF7, each step through the UI. */
async function wallOutlet(u: SketchUser): Promise<void> {
  const { page } = u;
  // Activity 1. A rectangle centred on the origin.
  await menu(u, 'create', 'Center Rectangle', 'Rectangle');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 40, y: 60 });
  await exitTool(u);

  // A line between the midpoints of the sides, turned into construction.
  await u.press('l');
  await u.move({ x: -40, y: 0 });
  await u.click({ x: -40, y: 0 });
  await u.move({ x: 40, y: 0 });
  await u.click({ x: 40, y: 0 });
  await exitTool(u);
  let s = await u.sketch();
  const axis = (await u.lines()).find((l) => {
    const [a, b] = lineEnds(s, l);
    return Math.abs(a.y) < 1e-6 && Math.abs(b.y) < 1e-6;
  }) as Line;
  // Two more on top of the centre rectangle's diagonals.
  expect(constraintsOfType(s, 'midpoint')).toBe(4);
  await u.tool('Select');
  await u.click({ x: 20, y: 0 });
  expect(await page.evaluate(() => window.__sketch.selection)).toEqual([axis.id]);
  await page.locator('.palette .type-btn[aria-label="Construction"]').click();
  await u.press('Escape');
  expect((await u.sketch()).curves[axis.id].lineType).toBe('construction');

  // The screw hole on the origin.
  await menu(u, 'create', 'Center Diameter Circle', 'Circle');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 7, y: 7 });
  await exitTool(u);

  // The cutout rectangle, its vertical sides as construction.
  await menu(u, 'create', '2-Point Rectangle', 'Rectangle');
  await u.click({ x: -12, y: 25 });
  await u.click({ x: 12, y: 45 });
  await exitTool(u);
  await u.tool('Select');
  await u.click({ x: -12, y: 35 });
  await u.click({ x: 12, y: 35 }, { shift: true });
  expect((await page.evaluate(() => window.__sketch.selection)).length).toBe(2);
  await page.locator('.palette .type-btn[aria-label="Construction"]').click();
  await u.press('Escape');

  // Two arcs: top corner, bottom corner, a point on the arc away from its centre.
  await menu(u, 'create', '3-Point Arc', 'Arc');
  await u.click({ x: -12, y: 45 });
  await u.click({ x: -12, y: 25 });
  await u.click({ x: -16, y: 35 });
  await u.click({ x: 12, y: 45 });
  await u.click({ x: 12, y: 25 });
  await u.click({ x: 16, y: 35 });
  await exitTool(u);
  expect((await u.curves('arc')).length).toBe(2);

  // Mirror: a window over the cutout, "12 objects", then the construction line.
  await u.tool('Mirror');
  const d = dialog(u, 'Mirror');
  await u.drag({ x: -22, y: 50 }, { x: 22, y: 20 });
  await expect(d.locator('[data-field="Objects"] .select-count')).toHaveText('12 selected');
  await selectInField(d, 'Mirror Line');
  await u.click({ x: -25, y: 0 });
  await u.shot('outlet-1-mirror-preview');
  await ok(u, d);
  expect((await u.curves('arc')).length).toBe(4);
  await clean(u);

  // Activity 2. Concentric arcs.
  s = await u.sketch();
  const arcs = (await u.curves('arc')) as Arc[];
  const upper = arcs.filter((a) => pointAt(s, a.c).y > 0).sort((p, q) => arcTop(s, p).x - arcTop(s, q).x);
  const [left, right] = upper;
  await u.tool('Concentric');
  await u.click(arcTop(s, left));
  await u.click(arcTop(s, right));
  await exitTool(u);
  s = await u.sketch();
  expect(near(pointAt(s, (s.curves[left.id] as Arc).c), pointAt(s, (s.curves[right.id] as Arc).c), 1e-4)).toBe(true);

  // A vertical between the circle's centre, picked first, and the arcs' centre.
  await u.tool('Horizontal/Vertical');
  await u.click({ x: 0, y: 0 });
  await u.click(pointAt(s, (s.curves[left.id] as Arc).c));
  await exitTool(u);
  s = await u.sketch();
  expect(pointAt(s, (s.curves[left.id] as Arc).c).x).toBeCloseTo(0, 4);

  // Equal arcs.
  await u.tool('Equal');
  await u.click(arcTop(s, s.curves[left.id] as Arc));
  await u.click(arcTop(s, s.curves[right.id] as Arc));
  await exitTool(u);
  await u.shot('outlet-2-constrained');
  await clean(u);

  // Activity 3. Overall size, screw hole, then the cutout.
  await page.getByLabel('Show Constraints').uncheck();
  s = await u.sketch();
  await dimension(u, [{ x: 20, y: 60 }], { x: 20, y: 70 }, '70');
  await dimension(u, [{ x: 35, y: 30 }], { x: 46, y: 30 }, '114');
  s = await u.sketch();
  const hole = Object.values(s.curves).find((c): c is Circle => c.type === 'circle') as Circle;
  await dimension(u, [{ x: hole.r * Math.SQRT1_2, y: -hole.r * Math.SQRT1_2 }], { x: 26, y: -30 }, '12');

  await u.press('d');
  s = await u.sketch();
  await u.click(middle(s, cutoutSides(s)[0]));
  await u.click({ x: -25, y: 0 });
  await u.click({ x: -28, y: 12 });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('11');
  await u.press('Enter');
  await exitTool(u);

  await u.press('d');
  s = await u.sketch();
  await u.click(middle(s, cutoutSides(s)[0]));
  await u.click(middle(s, cutoutSides(s)[1]));
  await u.click({ x: 30, y: 26 });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('28');
  await u.press('Enter');
  await exitTool(u);

  s = await u.sketch();
  await dimension(u, [arcTop(s, s.curves[left.id] as Arc)], { x: -30, y: 45 }, '17');
  await page.getByLabel('Show Constraints').check();
  await u.settle();
}

test('scenario 2: the wall outlet tutorial ends fully constrained, all black, dof 0', async ({ page }) => {
  test.setTimeout(120_000);
  const u = await start(page);
  await wallOutlet(u);
  await u.shot('outlet-3-done');
  const a = await u.analysis();
  expect(a.unsatisfied).toEqual([]);
  expect(a.dof).toBe(0);
  expect(a.freeCurves).toEqual([]);
  expect(await u.statusLine()).toContain('Status: Constrained');

  const s = await u.sketch();
  const xs = Object.values(s.points).map((p) => p.x);
  const ys = Object.values(s.points).map((p) => p.y);
  expect(Math.max(...xs)).toBeCloseTo(35, 3);
  expect(Math.max(...ys)).toBeCloseTo(57, 3);
  expect(Math.min(...ys)).toBeCloseTo(-57, 3);
  const sides = cutoutSides(s);
  expect(pointAt(s, sides[0].a).y).toBeCloseTo(11, 3);
  expect(pointAt(s, sides[1].a).y).toBeCloseTo(39, 3);
  // The lower cutout follows through the mirror [ref]: same radius, reflected.
  const arcs = (await u.curves('arc')) as Arc[];
  expect(arcs.length).toBe(4);
  for (const a2 of arcs) expect(radiusOf(s, a2)).toBeCloseTo(17, 3);
  const [c] = (await u.curves('circle')) as Circle[];
  expect(c.r).toBeCloseTo(6, 3);
  const halfWidth = Math.sqrt(17 ** 2 - 14 ** 2);
  expect(findLine(s, { x: -halfWidth, y: -11 }, { x: halfWidth, y: -11 })).toBeTruthy();
  expect(findLine(s, { x: -halfWidth, y: -39 }, { x: halfWidth, y: -39 })).toBeTruthy();
  await expect(page.locator(`[data-lock="${s.id}"] svg`)).toHaveCount(1);
  await expect(page.locator(`[data-lock="${s.id}"]`)).toHaveAttribute('title', 'Fully constrained');
});

test('scenario 7: the wall outlet exports to DXF and parses back with matching counts', async ({ page }) => {
  test.setTimeout(120_000);
  const u = await start(page);
  await wallOutlet(u);
  const s = await u.sketch();
  const { text, file } = await exportFromBrowser(u, s.id, async () => undefined, 'wall-outlet');
  expect(file).toBe('wall-outlet.dxf');
  const counts = parseDxf(text);
  const normal = Object.values(s.curves).filter((c) => c.lineType === 'normal');
  const byType = (t: Curve['type']): number => normal.filter((c) => c.type === t).length;
  expect(byType('line')).toBe(8);
  expect(counts.LINE).toBe(byType('line'));
  expect(counts.ARC).toBe(4);
  expect(counts.CIRCLE).toBe(1);

  const full = await exportFromBrowser(u, s.id, async (d) => {
    await d.getByLabel('Construction Geometry').check();
  }, 'wall-outlet-full');
  expect(parseDxf(full.text).LINE).toBe(Object.values(s.curves).filter((c) => c.type === 'line').length);
});

test('scenario 3: the bracket from GUID-AB8D9509', async ({ page }) => {
  test.setTimeout(120_000);
  const u = await start(page);
  await u.wheelOut(1400);

  // Basic shape from the origin: bottom, angled, end, angled back, top, and down to close.
  const pts = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 640, y: 130 }, { x: 570, y: 210 }, { x: 430, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }];
  await lineChain(u, ...pts);
  const lines = await u.lines();
  expect(lines.length).toBe(6);
  let s = await u.sketch();
  const at = (i: number): Line => (s.curves[lines[i].id] as Line);
  const [bottom, lower, end, upper, top, left] = [0, 1, 2, 3, 4, 5];

  // Perpendicular at the origin and both end corners.
  await u.tool('Perpendicular');
  for (const [p, q] of [[bottom, left], [lower, end], [end, upper]]) {
    s = await u.sketch();
    await u.click(middle(s, at(p)));
    await u.click(middle(s, at(q)));
  }
  await exitTool(u);

  // The two lower lines horizontal.
  await u.tool('Horizontal/Vertical');
  s = await u.sketch();
  await u.click(middle(s, at(bottom)));
  await u.click(middle(s, at(top)));
  await exitTool(u);

  // Equal: the two lower lines, and the two end edges.
  await u.tool('Equal');
  for (const [p, q] of [[bottom, lower], [left, end]]) {
    s = await u.sketch();
    await u.click(middle(s, at(p)));
    await u.click(middle(s, at(q)));
  }
  await exitTool(u);
  await clean(u);

  s = await u.sketch();
  await dimension(u, [middle(s, at(bottom))], { x: 250, y: -60 }, '500');

  // The angle between the bottom line and the angled line.
  s = await u.sketch();
  await u.press('d');
  await u.click(middle(s, at(bottom)));
  await u.click(middle(s, at(lower)));
  const elbow = pointAt(s, at(bottom).b);
  await u.click({ x: elbow.x + 120, y: elbow.y + 40 });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('45');
  await u.press('Enter');
  await exitTool(u);

  s = await u.sketch();
  const m = middle(s, at(end));
  await dimension(u, [m], { x: m.x + 60, y: m.y + 60 }, '100');
  await u.shot('bracket-done');

  const a = await u.analysis();
  expect(a.unsatisfied).toEqual([]);
  expect(a.dof).toBe(0);
  expect(await u.statusLine()).toContain('Status: Constrained');
  s = await u.sketch();
  const [p0, p1] = lineEnds(s, at(bottom));
  expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeCloseTo(500, 3);
  const [q0, q1] = lineEnds(s, at(lower));
  expect(Math.hypot(q1.x - q0.x, q1.y - q0.y)).toBeCloseTo(500, 3);
  expect(Math.abs(Math.atan2(q1.y - q0.y, q1.x - q0.x))).toBeCloseTo(Math.PI / 4, 4);
  const [r0, r1] = lineEnds(s, at(end));
  expect(Math.hypot(r1.x - r0.x, r1.y - r0.y)).toBeCloseTo(100, 3);
  const [t0, t1] = lineEnds(s, at(left));
  expect(Math.hypot(t1.x - t0.x, t1.y - t0.y)).toBeCloseTo(100, 3);
  expect(pointAt(s, at(top).a).y).toBeCloseTo(100, 3);
});

test('scenario 4: the gear pattern from GUID-E24C20F4', async ({ page }) => {
  test.setTimeout(90_000);
  const u = await start(page);
  // A 4 mm circle: type the diameter, Enter twice.
  await menu(u, 'create', 'Center Diameter Circle', 'Circle');
  await u.click({ x: 22, y: 3 });
  await u.move({ x: 26, y: 3 });
  await page.keyboard.type('4 mm');
  await u.press('Enter');
  await u.press('Enter');
  const [c] = (await u.curves('circle')) as Circle[];
  expect(c.r).toBeCloseTo(2, 6);

  // Horizontal/Vertical from the circle's centre to the face centre: here, the origin.
  await u.tool('Horizontal/Vertical');
  await u.click({ x: 22, y: 3 });
  await u.click({ x: 0, y: 0 });
  await exitTool(u);
  let s = await u.sketch();
  const centre = pointAt(s, (s.curves[c.id] as Circle).c);
  expect(Math.min(Math.abs(centre.x), Math.abs(centre.y))).toBeCloseTo(0, 3);

  // 25.4 mm between the centres.
  await u.press('d');
  await u.click(centre);
  await u.click({ x: 0, y: 0 });
  await u.click({ x: centre.x / 2, y: centre.y / 2 - 12 });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('25.4 mm');
  await u.press('Enter');
  await exitTool(u);
  let a = await u.analysis();
  expect(a.dof).toBe(0);
  await u.shot('gear-1-defined');

  // The pattern, using Select beside each field as the tutorial does.
  await menu(u, 'create', 'Circular Pattern');
  const d = dialog(u, 'Circular Pattern');
  s = await u.sketch();
  const moved = pointAt(s, (s.curves[c.id] as Circle).c);
  await selectInField(d, 'Objects');
  await u.click({ x: moved.x + 2 * Math.SQRT1_2, y: moved.y - 2 * Math.SQRT1_2 });
  await selectInField(d, 'Center Point');
  await u.click({ x: 0, y: 0 });
  await fieldRow(d, 'Quantity').locator('input').fill('6');
  await u.settle();
  await u.shot('gear-2-preview');
  await ok(u, d);
  await u.shot('gear-3-done');

  s = await u.sketch();
  const circles = (await u.curves('circle')) as Circle[];
  expect(circles.length).toBe(6);
  const angles = circles.map((k) => Math.atan2(pointAt(s, k.c).y, pointAt(s, k.c).x)).sort((p, q) => p - q);
  for (const k of circles) {
    expect(Math.hypot(pointAt(s, k.c).x, pointAt(s, k.c).y)).toBeCloseTo(25.4, 3);
    expect(k.r).toBeCloseTo(2, 3);
  }
  for (let i = 1; i < 6; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo(Math.PI / 3, 3);
  a = await u.analysis();
  expect(a.unsatisfied).toEqual([]);
  expect(a.dof).toBe(0);
  expect(await u.statusLine()).toContain('Status: Constrained');
});

test('scenario 5: trim, fillet and offset round trip through undo and redo, byte for byte', async ({ page }) => {
  const u = await start(page);
  await lineChain(u, { x: -40, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: -40, y: 40 });
  await lineChain(u, { x: -20, y: -20 }, { x: -20, y: 60 });
  const snap = (): Promise<string> => page.evaluate(() => JSON.stringify(window.__sketch.design()));
  const states = [await snap()];

  await u.press('t');
  await u.click({ x: -30, y: 0 });
  await u.click({ x: -30, y: 40 });
  await exitTool(u);
  states.push(await snap());

  await u.tool('Fillet');
  await u.click({ x: 40, y: 0 });
  await page.keyboard.type('8');
  await u.press('Enter');
  states.push(await snap());

  await u.tool('Offset');
  await u.click({ x: 0, y: 40 });
  await u.move({ x: 0, y: 20 });
  await setField(dialog(u, 'Offset'), 'Distance', '4');
  await u.move({ x: 0, y: 22 });
  await ok(u, dialog(u, 'Offset'));
  states.push(await snap());
  await u.shot('roundtrip-done');
  await clean(u);

  const steps = states.length - 1;
  const undo = async (): Promise<void> => page.locator('.icon-btn[aria-label="Undo"]').click();
  const redo = async (): Promise<void> => page.locator('.icon-btn[aria-label="Redo"]').click();
  // The trim of two segments is two steps; walk the whole stack back to the top first.
  await undo();
  await u.settle();
  expect(await snap()).toBe(states[2]);
  await undo();
  await u.settle();
  expect(await snap()).toBe(states[1]);
  await redo();
  await u.settle();
  expect(await snap()).toBe(states[2]);
  await redo();
  await u.settle();
  expect(await snap()).toBe(states[3]);
  await undo();
  await undo();
  await undo();
  await undo();
  await u.settle();
  expect(await snap()).toBe(states[0]);
  for (let i = 0; i < 2 + steps - 1; i++) await redo();
  await u.settle();
  expect(await snap()).toBe(states[3]);
});
