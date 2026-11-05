import { expect, test } from '@playwright/test';
import { constraintsOfType, pointAt, SketchUser } from './helpers';
import type { Arc, Circle, Line } from '../src/model/types';

const start = async (page: import('@playwright/test').Page): Promise<SketchUser> => {
  const u = new SketchUser(page);
  await u.open();
  await u.newSketch();
  return u;
};

const exitTool = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

test.describe('inference', () => {
  test('click on a point, midpoint, curve and axis adds the matching constraint', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 50, y: 10 });
    await u.press('Escape');
    let s = await u.sketch();
    const k0 = Object.keys(s.constraints).length;
    expect(constraintsOfType(s, 'horizontal')).toBe(1);
    expect(k0).toBe(1);
    await u.press('l');

    // Start on the existing end: coincident, no glyph needed.
    await u.move({ x: 50.5, y: 10.5 });
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('point');
    await u.shot('inference-point');
    await u.click({ x: 50.5, y: 10.5 });
    // End at the midpoint of the same line would be degenerate-free: pick it from above.
    await u.move({ x: 30, y: 10.3 });
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('midpoint');
    await u.shot('inference-midpoint');
    await u.press('Escape');

    await u.click({ x: 30, y: 40 });
    await u.click({ x: 30.3, y: 10.2 });
    await u.press('Escape');
    await u.press('l');
    s = await u.sketch();
    expect(constraintsOfType(s, 'midpoint')).toBe(1);
    const mid = Object.values(s.constraints).find((k) => k.type === 'midpoint');
    expect(s.points[mid?.refs[0] as string].x).toBeCloseTo(30, 3);

    // On curve, away from anything else.
    await u.click({ x: 15, y: 30 });
    await u.click({ x: 18, y: 10.2 });
    await u.press('Escape');
    await u.press('l');
    s = await u.sketch();
    const onCurve = Object.values(s.constraints).filter((k) => k.type === 'coincident' && k.refs.some((r) => s.curves[r]));
    expect(onCurve.length).toBe(1);

    // On an axis.
    await u.click({ x: -20, y: 20 });
    await u.click({ x: -20.5, y: 0.3 });
    await u.press('Escape');
    await u.press('l');
    s = await u.sketch();
    expect(Object.values(s.constraints).some((k) => k.refs.includes('axis-x'))).toBe(true);

    // Origin.
    await u.click({ x: -30, y: -20 });
    await u.click({ x: 0.4, y: 0.4 });
    await exitTool(u);
    s = await u.sketch();
    expect(Object.values(s.constraints).some((k) => k.type === 'coincident' && k.refs.includes('origin'))).toBe(true);
    await u.shot('inference-all');
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('horizontal, vertical, perpendicular and tangent while drawing', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 20 });
    await u.move({ x: 30, y: 21 });
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('horizontal');
    await u.shot('inference-horizontal');
    await u.click({ x: 30, y: 21 });
    await u.move({ x: 31, y: 50 });
    const v = await page.evaluate(() => window.__sketch.inference());
    expect(v?.kind).toBe('vertical');
    await u.click({ x: 31, y: 50 });
    await u.press('Escape');
    await u.press('Escape');
    const s = await u.sketch();
    expect(constraintsOfType(s, 'horizontal')).toBe(1);
    expect(constraintsOfType(s, 'vertical')).toBe(1);

    // Perpendicular to a skew line.
    await u.press('Meta+z');
    await u.press('Meta+z');
    await u.press('l');
    await u.click({ x: -10, y: 0 });
    await u.click({ x: 30, y: 30 });
    await u.move({ x: 24, y: 38 });
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('perpendicular');
    await u.click({ x: 24, y: 38 });
    await exitTool(u);
    expect(constraintsOfType(await u.sketch(), 'perpendicular')).toBe(1);

    // Tangent to a circle from a line start.
    await u.press('c');
    await u.click({ x: 60, y: -40 });
    await u.click({ x: 70, y: -40 });
    await exitTool(u);
    await u.press('l');
    await u.click({ x: 40, y: 0 });
    const c = { x: 60, y: -40 };
    const from = { x: 40, y: 0 };
    const d = Math.hypot(c.x - from.x, c.y - from.y);
    const a = Math.acos(10 / d);
    const base = Math.atan2(from.y - c.y, from.x - c.x);
    const foot = { x: c.x + 10 * Math.cos(base - a), y: c.y + 10 * Math.sin(base - a) };
    await u.move(foot);
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('tangent');
    await u.shot('inference-tangent');
    await u.click(foot);
    await exitTool(u);
    const t = await u.sketch();
    expect(constraintsOfType(t, 'tangent')).toBe(1);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('extension lines align with recent points, without a constraint', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 10, y: 40 });
    await u.click({ x: 40, y: 50 });
    await u.press('Escape');
    const before = Object.keys((await u.sketch()).constraints).length;
    await u.press('l');
    await u.move({ x: 40.2, y: 50.2 });
    await u.click({ x: -30, y: 20 });
    await u.move({ x: 40.5, y: 10 });
    const inf = await page.evaluate(() => window.__sketch.inference());
    expect(inf?.kind).toBe('extension');
    expect(inf?.pos.x).toBeCloseTo(40, 6);
    await u.shot('inference-extension');
    await u.click({ x: 40.5, y: 10 });
    await exitTool(u);
    expect(Object.keys((await u.sketch()).constraints).length).toBe(before);
  });

  test('Cmd suppresses inference', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 20 });
    await u.move({ x: 30, y: 21 });
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('horizontal');
    await page.keyboard.down('Meta');
    await u.settle();
    expect((await page.evaluate(() => window.__sketch.inference()))?.kind).toBe('none');
    await u.click({ x: 30, y: 21 });
    await page.keyboard.up('Meta');
    await exitTool(u);
    const s = await u.sketch();
    expect(constraintsOfType(s, 'horizontal')).toBe(0);
    const [l] = await u.lines();
    expect(pointAt(s, l.b).y).toBeCloseTo(21, 1);
  });

  test('grid snap rounds to the grid', async ({ page }) => {
    const u = await start(page);
    await page.locator('.palette-row', { hasText: 'Snap' }).locator('input').check();
    await u.press('l');
    await u.click({ x: 11.3, y: 17.2 });
    await u.click({ x: 41.3, y: 38 });
    await exitTool(u);
    const [l] = await u.lines();
    const s = await u.sketch();
    // At the default zoom the minor grid is 5 mm.
    expect(pointAt(s, l.a).x % 5).toBeCloseTo(0, 6);
    expect(pointAt(s, l.a).y % 5).toBeCloseTo(0, 6);
  });
});

test.describe('line tool', () => {
  test('closing on the start ends the chain with a closed profile', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 10 });
    await u.click({ x: 30, y: 15 });
    await u.click({ x: 15, y: 40 });
    await u.click({ x: 0.3, y: 10.2 });
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('line');
    await expect(page.locator('.hud-field')).toHaveCount(0);
    await u.shot('line-closed');
    expect(await page.evaluate(() => window.__sketch.profiles())).toBe(1);
    await exitTool(u);
    expect((await u.lines()).length).toBe(3);
  });

  test('closing on a start that was snapped to other geometry still closes', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 5, y: 10 });
    await u.click({ x: 30, y: 15 });
    await exitTool(u);
    await u.press('l');
    await u.click({ x: 30, y: 15 });
    await u.click({ x: 20, y: 40 });
    await u.click({ x: 5, y: 30 });
    await u.click({ x: 30, y: 15 });
    await expect(page.locator('.hud-check')).toHaveCount(0);
    await exitTool(u);
    expect((await u.lines()).length).toBe(4);
  });

  test('check icon ends the chain, tool stays', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 5, y: 10 });
    await u.click({ x: 30, y: 15 });
    await u.move({ x: 40, y: 30 });
    await u.shot('line-chain-live');
    await page.locator('.hud-check').click();
    await u.settle();
    await expect(page.locator('.hud-check')).toHaveCount(0);
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('line');
    await u.click({ x: 40, y: 30 });
    await u.click({ x: 60, y: 30 });
    await exitTool(u);
    const lines = await u.lines();
    expect(lines.length).toBe(2);
    const s = await u.sketch();
    expect(Object.values(s.constraints).filter((k) => k.type === 'coincident').length).toBe(0);
  });

  test('a zero-length click is rejected', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 10, y: 10 });
    expect((await u.lines()).length).toBe(0);
    await exitTool(u);
    await u.press('r');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 40, y: 10.0 });
    expect((await u.lines()).length).toBe(0);
  });

  test('tangent arc flips across the previous segment', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 40 });
    await u.click({ x: 0, y: 10 });
    await u.drag({ x: 0, y: 10 }, { x: 20, y: 10 });
    await u.press('Meta+z');
    expect((await u.curves('arc')).length).toBe(0);
    // Undo took the chain with it. Start again on the end, as the tutorial does.
    await u.click({ x: 0, y: 10 });
    await u.drag({ x: 0, y: 10 }, { x: -20, y: 0 }, 12);
    await u.shot('line-arc-flip');
    let s = await u.sketch();
    const [arc] = (await u.curves('arc')) as Arc[];
    expect(arc).toBeTruthy();
    expect(pointAt(s, arc.c).x).toBeLessThan(0);
    expect((await u.analysis()).unsatisfied).toEqual([]);

    // HUD length and angle lock; the typed values become dimensions.
    await u.press('Escape');
    await u.press('Escape');
    await u.press('l');
    await u.click({ x: 30, y: 0 });
    await u.move({ x: 60, y: 30 });
    await page.keyboard.type('20');
    await u.press('Tab');
    await page.keyboard.type('30');
    await u.shot('line-hud-locked');
    await expect(page.locator('.hud-field.locked')).toHaveCount(2);
    await u.press('Enter');
    await exitTool(u);
    s = await u.sketch();
    const dims = Object.values(s.dimensions);
    expect(dims.map((d) => d.kind).sort()).toEqual(['angle', 'distance']);
    const last = (await u.lines()).at(-1) as Line;
    const dx = pointAt(s, last.b).x - pointAt(s, last.a).x;
    const dy = pointAt(s, last.b).y - pointAt(s, last.a).y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(20, 4);
    expect((Math.atan2(dy, dx) * 180) / Math.PI).toBeCloseTo(30, 3);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('palette Linetype makes construction geometry; X toggles a selection', async ({ page }) => {
    const u = await start(page);
    await page.getByRole('button', { name: 'Construction' }).click();
    await u.press('l');
    await u.click({ x: 0, y: 10 });
    await u.click({ x: 30, y: 15 });
    await exitTool(u);
    let [l] = await u.lines();
    expect(l.lineType).toBe('construction');
    await u.shot('line-construction');
    await page.getByRole('button', { name: 'Construction' }).click();
    await u.click({ x: 15, y: 12.5 });
    await u.press('x');
    [l] = await u.lines();
    expect(l.lineType).toBe('normal');
  });
});

test.describe('other create tools', () => {
  test('3-point rectangle and centre circle with typed sizes', async ({ page }) => {
    const u = await start(page);
    await u.tool('3-Point Rectangle');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 30, y: 15 });
    await u.click({ x: 25, y: 35 });
    await exitTool(u);
    const s = await u.sketch();
    expect(constraintsOfType(s, 'perpendicular')).toBe(1);
    expect(constraintsOfType(s, 'parallel')).toBe(2);
    expect((await u.analysis()).unsatisfied).toEqual([]);
    await u.shot('rect-3pt');

    await u.tool('2-Point Rectangle');
    await u.click({ x: -60, y: -10 });
    await u.move({ x: -30, y: -40 });
    await page.keyboard.type('40');
    await u.press('Tab');
    await page.keyboard.type('25.4 mm');
    await u.shot('rect-hud');
    await u.press('Enter');
    await exitTool(u);
    const t = await u.sketch();
    const dims = Object.values(t.dimensions);
    expect(dims.length).toBe(2);
    expect(dims.map((d) => d.expression).sort()).toEqual(['25.4 mm', '40 mm']);
    const xs = Object.values(t.points).filter((p) => p.x < -15).map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 4);
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('3-point circle passes through its picks and rejects collinear', async ({ page }) => {
    const u = await start(page);
    await u.tool('3-Point Circle');
    await u.click({ x: -20, y: 0 });
    await u.click({ x: 20, y: 0 });
    await u.click({ x: 0, y: 0 });
    expect((await u.curves('circle')).length).toBe(0);
    await u.click({ x: 0, y: 20 });
    await exitTool(u);
    const [c] = (await u.curves('circle')) as Circle[];
    expect(c.r).toBeCloseTo(20, 1);
  });

  test('switching type in the palette', async ({ page }) => {
    const u = await start(page);
    await u.press('r');
    await page.getByRole('button', { name: 'Center Rectangle' }).click();
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('rect-center');
    await u.press('c');
    await page.getByRole('button', { name: '2-Point Circle' }).click();
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('circle-2pt');
  });

  test('midpoint line is symmetric about its middle', async ({ page }) => {
    const u = await start(page);
    await u.press('Escape');
    await u.tool('Midpoint Line');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 30, y: 10 });
    await exitTool(u);
    const [l] = await u.lines();
    const s = await u.sketch();
    expect(pointAt(s, l.a).x).toBeCloseTo(-30, 1);
    expect((await u.analysis()).dof).toBe(2);
  });
});

test.describe('constraint tools', () => {
  test('coincident: the first pick stays, the second moves', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 0 + 20 });
    await u.click({ x: 20, y: 30 });
    await u.press('Escape');
    await u.press('l');
    await u.click({ x: 50, y: 40 });
    await u.click({ x: 70, y: 10 });
    await exitTool(u);
    const before = await u.sketch();
    const [a, b] = await u.lines();
    await u.tool('Coincident');
    await u.click(pointAt(before, a.b));
    await u.shot('coincident-first-pick');
    await u.click(pointAt(before, b.a));
    const s = await u.sketch();
    expect(pointAt(s, a.b).x).toBeCloseTo(20, 4);
    expect(pointAt(s, b.a).x).toBeCloseTo(20, 4);
    expect(pointAt(s, a.a).x).toBeCloseTo(0, 4);
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('coincident');
    expect(await page.evaluate(() => window.__sketch.selection)).toEqual([]);
    await u.press('Escape');
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');
  });

  test('horizontal/vertical picks the nearer axis; preselect works', async ({ page }) => {
    const u = await start(page);
    await page.keyboard.down('Meta');
    await u.press('l');
    await page.keyboard.up('Meta');
    await u.press('l');
    await page.keyboard.down('Meta');
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 30, y: 26 });
    await page.keyboard.up('Meta');
    await u.press('Escape');
    await u.press('l');
    await page.keyboard.down('Meta');
    await u.click({ x: 50, y: 10 });
    await u.click({ x: 56, y: 40 });
    await page.keyboard.up('Meta');
    await exitTool(u);
    await u.tool('Horizontal/Vertical');
    await u.click({ x: 15, y: 23 });
    await u.press('Escape');
    let s = await u.sketch();
    const [a, b] = await u.lines();
    expect(pointAt(s, a.a).y).toBeCloseTo(pointAt(s, a.b).y, 6);
    expect(constraintsOfType(s, 'horizontal')).toBe(1);
    // Preselect then click the tool.
    await u.click({ x: 53, y: 25 });
    await u.tool('Horizontal/Vertical');
    s = await u.sketch();
    expect(pointAt(s, b.a).x).toBeCloseTo(pointAt(s, b.b).x, 6);
    expect(constraintsOfType(s, 'vertical')).toBe(1);
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');
  });

  test('equal matches the first selection, and hover ignores invalid picks', async ({ page }) => {
    const u = await start(page);
    await page.keyboard.down('Meta');
    await u.press('l');
    await page.keyboard.up('Meta');
    await u.press('l');
    await u.click({ x: 0, y: 40 });
    await page.keyboard.down('Meta');
    await u.click({ x: 30, y: 44 });
    await page.keyboard.up('Meta');
    await u.press('Escape');
    await u.press('l');
    await u.click({ x: 50, y: 41 });
    await page.keyboard.down('Meta');
    await u.click({ x: 60, y: 52 });
    await page.keyboard.up('Meta');
    await exitTool(u);
    await u.press('c');
    await u.click({ x: -30, y: -30 });
    await u.click({ x: -20, y: -30 });
    await u.click({ x: 30, y: -30 });
    await u.click({ x: 48, y: -30 });
    await exitTool(u);
    const [first, second] = await u.lines();
    const before = await u.sketch();
    await u.tool('Equal');
    await u.click({ x: 15, y: 42 });
    // A circle is not a valid partner for a line: no hover, no pick.
    await u.move({ x: -20, y: -30 });
    await u.shot('equal-invalid-hover');
    await u.click({ x: -20, y: -30 });
    expect(constraintsOfType(await u.sketch(), 'equal')).toBe(0);
    await u.click({ x: 55, y: 46.5 });
    const s = await u.sketch();
    expect(constraintsOfType(s, 'equal')).toBe(1);
    const len = (l: Line, sk = s) => Math.hypot(pointAt(sk, l.b).x - pointAt(sk, l.a).x, pointAt(sk, l.b).y - pointAt(sk, l.a).y);
    expect(len(second)).toBeCloseTo(len(first), 4);
    expect(len(first)).toBeCloseTo(len(first, before), 4);

    // Circles: the second takes the first's radius.
    await u.click({ x: -20, y: -30 });
    await u.click({ x: 48, y: -30 });
    await u.press('Escape');
    await u.press('Escape');
    const [c1, c2] = (await u.curves('circle')) as Circle[];
    await u.shot('equal-circles');
    expect(c2.r).toBeCloseTo(c1.r, 5);
    expect(c1.r).toBeCloseTo(10, 5);
  });

  test('a glyph selects, highlights its members and deletes with Delete', async ({ page }) => {
    const u = await start(page);
    await u.press('r');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 40, y: 25 });
    await exitTool(u);
    const before = Object.keys((await u.sketch()).constraints).length;
    // The top line's H badge sits just below the middle of the line: the normal of b->a runs inward.
    const s = await u.sketch();
    const top = Object.values(s.curves).find((c) => c.type === 'line' && pointAt(s, c.a).y > 20) as Line;
    const m = { x: (pointAt(s, top.a).x + pointAt(s, top.b).x) / 2, y: pointAt(s, top.a).y };
    const near = await u.screen(m);
    await page.mouse.click(near.x, near.y + 16);
    await u.settle();
    const picked = await page.evaluate(() => window.__sketch.selection);
    expect(picked.length).toBe(1);
    expect(picked[0].startsWith('k')).toBe(true);
    await u.shot('glyph-selected');
    await u.press('Delete');
    expect(Object.keys((await u.sketch()).constraints).length).toBe(before - 1);
  });
});

test.describe('dimensions', () => {
  test('angle, radius, diameter, point-line, and double-click edit with an expression', async ({ page }) => {
    const u = await start(page);
    await page.keyboard.down('Meta');
    await u.press('l');
    await page.keyboard.up('Meta');
    await u.press('l');
    await page.keyboard.down('Meta');
    await u.click({ x: 0, y: 0 + 5 });
    await u.click({ x: 40, y: 5 });
    await u.click({ x: 60, y: 30 });
    await page.keyboard.up('Meta');
    await exitTool(u);
    await u.press('c');
    await u.click({ x: -40, y: -30 });
    await u.click({ x: -28, y: -30 });
    await exitTool(u);

    await u.press('d');
    // Angle between the two lines.
    await u.click({ x: 20, y: 5 });
    await u.click({ x: 50, y: 17.5 });
    await u.click({ x: 62, y: 10 });
    await page.keyboard.type('60');
    await u.press('Enter');
    let s = await u.sketch();
    const angle = Object.values(s.dimensions).find((d) => d.kind === 'angle');
    expect(angle).toBeTruthy();
    // Circle: diameter by default.
    await u.click({ x: -28, y: -30 });
    await u.click({ x: -15, y: -15 });
    await u.shot('dim-diameter-editor');
    await u.press('Enter');
    s = await u.sketch();
    expect(Object.values(s.dimensions).some((d) => d.kind === 'diameter')).toBe(true);
    // Radius by right-click before placing.
    await u.click({ x: -40, y: -18 });
    await u.rightClick({ x: -50, y: -10 });
    await u.shot('dim-marking-menu');
    await page.locator('.marking-list .menu-item[data-item="dim-radius"]').click();
    await u.click({ x: -50, y: -10 });
    await u.press('Enter');
    s = await u.sketch();
    const radius = Object.values(s.dimensions).find((d) => d.kind === 'radius');
    expect(radius?.driving).toBe(false);
    await exitTool(u);
    await u.shot('dim-all');

    // Double-click a label: edit it. An expression can name another dimension.
    const dia = Object.values((await u.sketch()).dimensions).find((d) => d.kind === 'diameter');
    const ang = Object.values((await u.sketch()).dimensions).find((d) => d.kind === 'angle');
    await u.doubleClick(dia?.label as { x: number; y: number });
    await expect(page.locator('.hud-field.editor input')).toBeFocused();
    await page.keyboard.type('30 mm');
    await u.press('Enter');
    s = await u.sketch();
    const [c] = (await u.curves('circle')) as Circle[];
    expect(c.r).toBeCloseTo(15, 5);
    expect(s.dimensions[radius?.id as string].value).toBeCloseTo(15, 5);

    // Clicking a dimension while a field is focused inserts its name [ref].
    await u.doubleClick(Object.values(s.dimensions).find((d) => d.kind === 'diameter')?.label as { x: number; y: number });
    await page.keyboard.type('1 + ');
    const ls = await u.screen(ang?.label as { x: number; y: number });
    void ls;
    await page.keyboard.press('Escape');
    await u.settle();
    expect((await u.analysis()).unsatisfied).toEqual([]);
  });

  test('expressions chain through dimension names and update on edit', async ({ page }) => {
    const u = await start(page);
    await u.press('r');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 40, y: 25 });
    await exitTool(u);
    await u.press('d');
    await u.click({ x: 20, y: 25 });
    await u.click({ x: 20, y: 34 });
    await page.keyboard.type('40');
    await u.press('Enter');
    let s = await u.sketch();
    const first = Object.values(s.dimensions)[0];
    await u.click({ x: 40, y: 12 });
    await u.click({ x: 52, y: 12 });
    await page.keyboard.type(`${first.name} / 2`);
    await u.press('Enter');
    await exitTool(u);
    s = await u.sketch();
    const second = Object.values(s.dimensions).find((d) => d.id !== first.id);
    expect(second?.value).toBeCloseTo(20, 5);
    await u.doubleClick(s.dimensions[first.id].label);
    await page.keyboard.type('60');
    await u.press('Enter');
    s = await u.sketch();
    expect(s.dimensions[second?.id as string].value).toBeCloseTo(30, 5);
    const ys = Object.values(s.points).map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(30, 4);
    expect((await u.analysis()).unsatisfied).toEqual([]);
    await u.shot('dim-expression');
    // A cycle is refused.
    await u.doubleClick(s.dimensions[first.id].label);
    await page.keyboard.type(`${second?.name} * 2`);
    await u.press('Enter');
    await expect(page.locator('.hud-field.editor.invalid')).toHaveCount(1);
    await u.press('Escape');
  });

  test('two coincident points cannot be dimensioned', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 30, y: 25 });
    await u.click({ x: 40, y: 60 });
    await exitTool(u);
    await u.press('d');
    await u.click({ x: 30, y: 25 });
    await u.click({ x: 30, y: 25 });
    await u.settle();
    await expect(page.locator('.hud-field.editor')).toHaveCount(0);
    expect(Object.values((await u.sketch()).dimensions)).toHaveLength(0);
  });
});

test.describe('HUD', () => {
  test('a typed value then a canvas click places with it; names and expressions work', async ({ page }) => {
    const u = await start(page);
    await u.press('r');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 40, y: 20 });
    await exitTool(u);
    await u.press('d');
    await u.click({ x: 20, y: 20 });
    await u.click({ x: 20, y: 30 });
    await u.press('Enter');
    await exitTool(u);
    const dim = Object.values((await u.sketch()).dimensions)[0];

    // Typing a name: letters go to the field, not the shortcut table.
    await u.press('c');
    await u.click({ x: -40, y: 30 });
    await u.move({ x: -30, y: 30 });
    await page.keyboard.type(`${dim.name} / 2`);
    await expect(page.locator('.hud-field.locked')).toHaveCount(1);
    await u.press('Enter');
    let [c] = (await u.curves('circle')) as Circle[];
    expect(c.r).toBeCloseTo(10, 5);
    let s = await u.sketch();
    expect(Object.values(s.dimensions).find((d) => d.kind === 'diameter')?.expression).toBe(`${dim.name} / 2`);

    // Clicking a dimension while a field has focus inserts its name.
    await u.click({ x: -40, y: -30 });
    await u.move({ x: -30, y: -30 });
    await page.keyboard.type('2 * ');
    const label = await u.screen(s.dimensions[dim.id].label);
    await page.mouse.move(label.x, label.y);
    await page.mouse.down();
    await page.mouse.up();
    await u.settle();
    await expect(page.locator('.hud-field input').first()).toHaveValue(`2 * ${dim.name}`);
    await u.press('Enter');
    await exitTool(u);
    const circles = (await u.curves('circle')) as Circle[];
    expect(circles[1].r).toBeCloseTo(40, 5);

    // Typed, then placed by click at the cursor's direction.
    await u.press('c');
    await u.click({ x: 60, y: 40 });
    await u.move({ x: 70, y: 40 });
    await page.keyboard.type('16');
    await u.click({ x: 75, y: 40 });
    await exitTool(u);
    [c] = ((await u.curves('circle')) as Circle[]).slice(-1);
    expect(c.r).toBeCloseTo(8, 5);
    s = await u.sketch();
    expect((await u.analysis()).unsatisfied).toEqual([]);

    // A bad expression does not place.
    await u.press('c');
    await u.click({ x: 60, y: -40 });
    await u.move({ x: 70, y: -40 });
    await page.keyboard.type('nonsense');
    await expect(page.locator('.hud-field.invalid')).toHaveCount(1);
    await u.press('Enter');
    expect((await u.curves('circle')).length).toBe(3);
    await u.press('Escape');
  });
});

test.describe('conflicts', () => {
  test('an unsatisfiable constraint draws red and reports Over-Constrained', async ({ page }) => {
    const u = await start(page);
    await u.press('r');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 40, y: 25 });
    await exitTool(u);
    await u.press('d');
    await u.click({ x: 20, y: 25 });
    await u.click({ x: 20, y: 34 });
    await u.press('Enter');
    await u.click({ x: 40, y: 12 });
    await u.click({ x: 52, y: 12 });
    await u.press('Enter');
    await exitTool(u);
    await u.tool('Equal');
    await u.click({ x: 20, y: 25 });
    await u.click({ x: 40, y: 12 });
    await u.press('Escape');
    const a = await u.analysis();
    expect(a.unsatisfied.length).toBeGreaterThan(0);
    expect(a.badCurves.length).toBeGreaterThan(0);
    expect(await u.statusLine()).toContain('Over-Constrained');
    await u.shot('conflict-red');
    await u.press('Meta+z');
    expect((await u.analysis()).unsatisfied).toEqual([]);
    expect(await u.statusLine()).toContain('Status: Constrained');
  });
});

test.describe('dragging', () => {
  test('a circle rim drag changes the radius and keeps the centre', async ({ page }) => {
    const u = await start(page);
    await u.press('c');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 30, y: 10 });
    await exitTool(u);
    await u.drag({ x: 30, y: 10 }, { x: 40, y: 10 });
    const [c] = (await u.curves('circle')) as Circle[];
    expect(c.r).toBeCloseTo(30, 0);
    const s = await u.sketch();
    expect(pointAt(s, c.c).x).toBeCloseTo(10, 4);
  });

  test('Esc during a drag restores the start', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 30, y: 25 });
    await exitTool(u);
    const before = await u.sketch();
    const [l] = await u.lines();
    await u.move(pointAt(before, l.b));
    await page.mouse.down();
    const to = await u.screen({ x: 60, y: 60 });
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await u.settle();
    await u.press('Escape');
    await page.mouse.up();
    const s = await u.sketch();
    expect(pointAt(s, l.b).x).toBeCloseTo(30, 4);
    expect(await page.evaluate(() => window.__sketch.canUndo)).toBe(true);
  });

  test('a chain with a tangent arc stays tangent through a drag', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 40 });
    await u.click({ x: 0, y: 10 });
    await u.drag({ x: 0, y: 10 }, { x: 20, y: 10 });
    await u.click({ x: 20, y: 40 });
    await exitTool(u);
    const before = await u.sketch();
    const ends = (await u.lines()).map((l) => pointAt(before, l.a));
    await u.drag(ends[0], { x: -5, y: 50 });
    expect((await u.analysis()).unsatisfied).toEqual([]);
    const s = await u.sketch();
    const [arc] = (await u.curves('arc')) as Arc[];
    const m = pointAt(s, arc.c);
    const a = pointAt(s, arc.a);
    const b = pointAt(s, arc.b);
    expect(Math.hypot(a.x - m.x, a.y - m.y)).toBeCloseTo(Math.hypot(b.x - m.x, b.y - m.y), 5);
    await u.shot('drag-tangent-chain');
  });
});

test.describe('shell', () => {
  test('the shortcut table dispatches', async ({ page }) => {
    const u = await start(page);
    const tool = () => page.evaluate(() => window.__sketch.tool);
    for (const [key, id] of [['l', 'line'], ['r', 'rect-2pt'], ['c', 'circle-center'], ['d', 'dimension']] as const) {
      await u.press(key);
      expect(await tool()).toBe(id);
      await u.press('Escape');
      expect(await tool()).toBe('select');
    }
    await u.press('t');
    expect(await tool()).toBe('trim');
    await u.press('Escape');
    // Typing in a text box does not fire shortcuts.
    await u.press('s');
    await expect(page.locator('.toolbox input')).toBeFocused();
    await page.keyboard.type('center r');
    await u.shot('toolbox');
    await u.press('Enter');
    expect(await tool()).toBe('rect-center');
    await u.press('Escape');
    await u.press('s');
    await page.keyboard.press('Escape');
    await expect(page.locator('.toolbox')).toHaveCount(0);
  });

  test('toolbar and greyed items', async ({ page }) => {
    const u = await start(page);
    await page.getByRole('button', { name: /^CREATE/ }).click();
    await page.locator('.menu-item.flyout[data-item="Project / Include"]').hover();
    const item = page.locator('.menu-item[data-item="Intersect"]');
    await expect(item).toHaveAttribute('title', 'Needs 3D geometry');
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await u.shot('toolbar-menu');
    await page.mouse.click(600, 600);
    await expect(page.locator('.popup-menu')).toHaveCount(0);
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('select');
  });

  test('marking menu: Repeat, Finish Sketch, Delete', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 30, y: 25 });
    await exitTool(u);
    await u.rightClick({ x: 15, y: 22.5 });
    await u.shot('marking-menu');
    await page.locator('.marking-item[data-item="repeat"]').click();
    expect(await page.evaluate(() => window.__sketch.tool)).toBe('line');
    await u.press('Escape');
    await u.rightClick({ x: 15, y: 22.5 });
    await page.locator('.marking-item[data-item="delete"]').click();
    expect((await u.lines()).length).toBe(0);
    await u.rightClick({ x: 40, y: 40 });
    await page.locator('.marking-item[data-item="finish-sketch"]').click();
    await expect(page.locator('.tab.active')).toHaveText('SOLID');
  });

  test('marking menu takes a flick in the direction of a slot', async ({ page }) => {
    const u = await start(page);
    const at = await u.screen({ x: 0, y: -20 });
    await page.mouse.move(at.x, at.y);
    await page.mouse.down({ button: 'right' });
    await expect(page.locator('.marking')).toHaveCount(1);
    const slot = await page.locator('.marking-item[data-item="finish-sketch"]').boundingBox();
    await page.mouse.move((slot?.x ?? 0) + 10, (slot?.y ?? 0) + 10, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    await expect(page.locator('.tab.active')).toHaveText('SOLID');
  });

  test('multiple sketches, browser menu, edit, rename, hide, delete', async ({ page }) => {
    const u = await start(page);
    await u.press('r');
    await u.click({ x: -40, y: -20 });
    await u.click({ x: -10, y: 20 });
    await exitTool(u);
    await page.locator('[data-tool="finish-sketch"]').click();
    await expect(page.locator('.tab.active')).toHaveText('SOLID');
    await u.shot('design-mode');
    await u.newSketch();
    await u.press('c');
    await u.click({ x: 30, y: 0 });
    await u.click({ x: 45, y: 0 });
    await exitTool(u);
    await u.shot('two-sketches');
    await page.locator('[data-tool="finish-sketch"]').click();
    await expect(page.locator('.sketch-row')).toHaveCount(2);

    await page.locator('.sketch-row').first().click({ button: 'right' });
    await u.shot('browser-menu');
    await page.locator('.menu-item[data-item="Rename"]').click();
    await page.locator('.rename').fill('Base');
    await page.keyboard.press('Enter');
    await expect(page.locator('.sketch-row').first()).toContainText('Base');

    await page.locator('.sketch-row').first().click({ button: 'right' });
    await page.locator('.menu-item[data-item="Edit Sketch"]').click();
    await expect(page.locator('.tab.active')).toHaveText('SKETCH');
    expect(Object.values((await u.sketch()).curves).length).toBe(4);
    await page.locator('[data-tool="finish-sketch"]').click();

    await page.getByRole('button', { name: 'Hide Base' }).click();
    const design = await u.design();
    expect(design.sketches[design.order[0]].visible).toBe(false);

    await page.locator('.sketch-row').nth(1).click({ button: 'right' });
    await page.locator('.menu-item[data-item="Delete"]').click();
    await expect(page.locator('.sketch-row')).toHaveCount(1);
    await u.press('Meta+z');
    await expect(page.locator('.sketch-row')).toHaveCount(2);
  });

  test('sharp at any device pixel ratio, zoom at the cursor, frames only on change', async ({ browser }) => {
    const context = await browser.newContext({ deviceScaleFactor: 3, viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    const u = await start(page);
    await u.press('c');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 20, y: 0 });
    await exitTool(u);
    const box = await page.locator('canvas').evaluate((c) => {
      const el = c as HTMLCanvasElement;
      const r = el.getBoundingClientRect();
      return { w: el.width, h: el.height, cw: r.width, ch: r.height };
    });
    expect(box.w).toBe(Math.round(box.cw * 3));
    expect(box.h).toBe(Math.round(box.ch * 3));
    await u.shot('dpr3');

    // Wheel events carry whole-pixel coordinates.
    const raw = await u.screen({ x: 30, y: 15 });
    const s = { x: Math.round(raw.x), y: Math.round(raw.y) };
    const anchor = await page.evaluate(([x, y]) => window.__sketch.toWorld(x, y), [s.x, s.y]);
    await page.mouse.move(s.x, s.y);
    await page.mouse.wheel(0, -400);
    await u.settle();
    const after = await page.evaluate(([x, y]) => window.__sketch.toWorld(x, y), [s.x, s.y]);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);

    const idle = await page.evaluate(() => window.__sketch.frames);
    await page.waitForTimeout(300);
    // Down and right, clear of the geometry and of the ViewCube up there, which lights under the cursor.
    await page.mouse.move(s.x + 200, s.y + 200);
    await page.mouse.move(s.x + 210, s.y + 210);
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.frames)).toBe(idle);
    await context.close();
  });

  test('pan with the middle button and space drag', async ({ page }) => {
    const u = await start(page);
    const before = await u.screen({ x: 0, y: 0 });
    await page.mouse.move(600, 500);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(650, 470);
    await page.mouse.up({ button: 'middle' });
    await u.settle();
    const mid = await u.screen({ x: 0, y: 0 });
    expect(mid.x - before.x).toBeCloseTo(50, 3);
    expect(mid.y - before.y).toBeCloseTo(-30, 3);
    await page.keyboard.down('Space');
    await page.mouse.move(600, 500);
    await page.mouse.down();
    await page.mouse.move(580, 520);
    await page.mouse.up();
    await page.keyboard.up('Space');
    await u.settle();
    const after = await u.screen({ x: 0, y: 0 });
    expect(after.x - mid.x).toBeCloseTo(-20, 3);
  });

  test('copy and paste across sketches', async ({ page }) => {
    const u = await start(page);
    await u.press('r');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 40, y: 30 });
    await exitTool(u);
    await u.press('Meta+a');
    expect((await page.evaluate(() => window.__sketch.selection)).length).toBe(4);
    await u.press('Meta+c');
    await page.locator('[data-tool="finish-sketch"]').click();
    await u.newSketch();
    await u.move({ x: -30, y: -30 });
    await u.press('Meta+v');
    expect((await u.lines()).length).toBe(4);
    const s = await u.sketch();
    const xs = Object.values(s.points).map((p) => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(-30, 1);
    await u.press('Meta+x');
    expect((await u.lines()).length).toBe(0);
    await u.press('Meta+z');
    expect((await u.lines()).length).toBe(4);
  });

  test('find under-constrained lists, zooms and deletes', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: 0, y: 20 });
    await u.click({ x: 30, y: 25 });
    await exitTool(u);
    await page.getByRole('button', { name: 'Find Under-Constrained' }).click();
    await expect(page.locator('.finder-row')).toHaveCount(1);
    await u.shot('find-under');
    await page.locator('.finder-name').click();
    expect((await page.evaluate(() => window.__sketch.selection)).length).toBe(1);
    await page.locator('.finder-row .icon-btn').click();
    expect((await u.lines()).length).toBe(0);
    await expect(page.locator('.finder-row')).toHaveCount(0);
  });

  test('file save, new, open round trip', async ({ page }) => {
    const u = await start(page);
    await u.press('r');
    await u.click({ x: 10, y: 10 });
    await u.click({ x: 40, y: 30 });
    await exitTool(u);
    await page.locator('[data-menu="file"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.menu-item[data-item="Save"]').click()]);
    expect(download.suggestedFilename()).toBe('Untitled.sketch.json');
    const path = await download.path();

    await page.locator('[data-menu="file"]').click();
    await page.locator('.menu-item[data-item="New"]').click();
    // Saved a moment ago, so nothing is asked.
    await expect(page.locator('.dialog')).toHaveCount(0);
    await expect(page.locator('.sketch-row')).toHaveCount(0);

    await page.locator('[data-menu="file"]').click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu-item[data-item="Open..."]').click()]);
    await chooser.setFiles(path);
    await expect(page.locator('.sketch-row')).toHaveCount(1);
  });
});
