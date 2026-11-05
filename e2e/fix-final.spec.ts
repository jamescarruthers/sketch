// The last round of audit fixes, through real mouse and keyboard. Ids are the open list in docs/AUDIT.md.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { pointAt, SketchUser, type Xy } from './helpers';
import type { Arc, Circle, Id, Line, Sketch } from '../src/model/types';

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
const dialog = (u: SketchUser, title: string): Locator => u.page.locator(`.dialog[data-dialog="${title}"]`);
const selectInField = (d: Locator, label: string): Promise<void> => d.locator(`[data-field="${label}"] .select-toggle`).click();
const ok = async (u: SketchUser, d: Locator): Promise<void> => {
  await d.locator('.btn.primary').click();
  await u.settle();
};

async function dimension(u: SketchUser, pick: Xy[], at: Xy, value: string): Promise<void> {
  await u.press('d');
  for (const p of pick) await u.click(p);
  await u.click(at);
  await u.page.keyboard.press('ControlOrMeta+a');
  await u.page.keyboard.type(value);
  await u.press('Enter');
  await exitTool(u);
}

const radiusOf = (s: Sketch, a: Arc): number => {
  const c = pointAt(s, a.c);
  const e = pointAt(s, a.a);
  return Math.hypot(c.x - e.x, c.y - e.y);
};

/** The middle of the arc's sweep, a point on it to click. */
function arcMiddle(s: Sketch, a: Arc): Xy {
  const c = pointAt(s, a.c);
  const p = pointAt(s, a.a);
  const q = pointAt(s, a.b);
  const from = Math.atan2(p.y - c.y, p.x - c.x);
  const sweep = ((Math.atan2(q.y - c.y, q.x - c.x) - from) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const r = radiusOf(s, a);
  return { x: c.x + r * Math.cos(from + sweep / 2), y: c.y + r * Math.sin(from + sweep / 2) };
}

const near = (u: Xy, v: Xy): void => {
  expect(u.x).toBeCloseTo(v.x, 3);
  expect(u.y).toBeCloseTo(v.y, 3);
};

const CORNERS = { tl: { x: -22, y: 42 }, tr: { x: 22, y: 42 }, bl: { x: -22, y: 16 }, br: { x: 22, y: 16 } };

test.describe('OPEN-1: the wall outlet cutout, as the audit drew it', () => {
  const CASES: [string, Xy, Xy][] = [
    ['audit', { x: -31, y: 25 }, { x: 31, y: 33 }],
    ['deep', { x: -40, y: 25 }, { x: 40, y: 33 }],
    ['shallow', { x: -26, y: 25 }, { x: 26, y: 33 }],
    ['very shallow', { x: -25, y: 33 }, { x: 25, y: 25 }],
    ['unequal', { x: -36, y: 33 }, { x: 28, y: 25 }],
  ];
  for (const [name, leftBulge, rightBulge] of CASES) {
    for (const order of ['left then right', 'right then left']) {
      test(`${name}, ${order}: fully defined at radius 17, reference arc still until Vertical`, async ({ page }) => {
        test.setTimeout(90_000);
        const u = await start(page);
        await menu(u, 'create', 'Center Rectangle', 'Rectangle');
        await u.click({ x: 0, y: 0 });
        await u.click({ x: 60, y: 62 });
        await exitTool(u);
        await u.press('l');
        await u.click({ x: -60, y: 0 });
        await u.click({ x: 60, y: 0 });
        await exitTool(u);
        await u.tool('Select');
        await u.click({ x: 20, y: 0 });
        await page.locator('.palette .type-btn[aria-label="Construction"]').click();
        await u.press('Escape');
        await menu(u, 'create', 'Center Diameter Circle', 'Circle');
        await u.click({ x: 0, y: 0 });
        await u.click({ x: 7, y: 7 });
        await exitTool(u);

        await menu(u, 'create', '2-Point Rectangle', 'Rectangle');
        await u.click(CORNERS.tl);
        await u.click(CORNERS.br);
        await exitTool(u);
        await u.tool('Select');
        await u.click({ x: -22, y: 30 });
        await u.click({ x: 22, y: 30 }, { shift: true });
        await page.locator('.palette .type-btn[aria-label="Construction"]').click();
        await u.press('Escape');

        await menu(u, 'create', '3-Point Arc', 'Arc');
        await u.click(CORNERS.tl);
        await u.click(CORNERS.bl);
        await u.click(leftBulge);
        await u.click(CORNERS.tr);
        await u.click(CORNERS.br);
        await u.click(rightBulge);
        await exitTool(u);

        await u.tool('Mirror');
        const d = dialog(u, 'Mirror');
        await u.drag({ x: -45, y: 54 }, { x: 50, y: 8 });
        await selectInField(d, 'Mirror Line');
        await u.click({ x: 30, y: 0 });
        await ok(u, d);
        expect((await u.curves('arc')).length).toBe(4);

        let s = await u.sketch();
        const upper = (Object.values(s.curves).filter((c): c is Arc => c.type === 'arc'))
          .filter((a) => pointAt(s, a.a).y > 0)
          .sort((p, q) => arcMiddle(s, p).x - arcMiddle(s, q).x);
        expect(upper.length).toBe(2);
        const [ref, mover] = order === 'left then right' ? upper : [upper[1], upper[0]];
        const edgeAt = (y: number): Line => (Object.values(s.curves).filter((c): c is Line => c.type === 'line'))
          .find((l) => Math.abs(pointAt(s, l.a).y - y) < 1e-3 && Math.abs(pointAt(s, l.b).y - y) < 1e-3) as Line;
        const bottom = edgeAt(16);
        const top = edgeAt(42);
        const refCentre = pointAt(s, ref.c);
        const refRadius = radiusOf(s, ref);
        const refEnds = [pointAt(s, ref.a), pointAt(s, ref.b)];
        const moverEnds = [pointAt(s, mover.a), pointAt(s, mover.b)];

        await constrain(u, 'Concentric');
        await u.click(arcMiddle(s, ref));
        await u.click(arcMiddle(s, mover));
        await exitTool(u);
        s = await u.sketch();
        // The reference is untouched, the other arc's centre has come to it, nothing else moved.
        near(pointAt(s, ref.c), refCentre);
        expect(radiusOf(s, ref)).toBeCloseTo(refRadius, 3);
        near(pointAt(s, ref.a), refEnds[0]);
        near(pointAt(s, ref.b), refEnds[1]);
        near(pointAt(s, mover.c), refCentre);
        near(pointAt(s, mover.a), moverEnds[0]);
        near(pointAt(s, mover.b), moverEnds[1]);
        for (const l of [bottom, top]) {
          const live = s.curves[l.id] as Line;
          expect(Math.abs(pointAt(s, live.a).x - pointAt(s, live.b).x)).toBeCloseTo(44, 3);
        }
        expect(await u.statusLine()).not.toContain('Over');

        await constrain(u, 'Horizontal/Vertical');
        await u.click({ x: 0, y: 0 });
        await u.click(pointAt(s, ref.c));
        await exitTool(u);
        s = await u.sketch();
        expect(pointAt(s, ref.c).x).toBeCloseTo(0, 4);
        near(pointAt(s, ref.a), refEnds[0]);
        near(pointAt(s, mover.a), moverEnds[0]);

        await constrain(u, 'Equal');
        await u.click(arcMiddle(s, ref));
        await u.click(arcMiddle(s, mover));
        await exitTool(u);
        s = await u.sketch();
        expect(radiusOf(s, ref)).toBeCloseTo(radiusOf(s, mover), 4);
        await expect(page.locator('.message.warn')).toHaveCount(0);

        // Activity 3.
        await dimension(u, [{ x: 20, y: 62 }], { x: 20, y: 72 }, '70');
        expect(Object.keys((await u.sketch()).dimensions).length).toBe(1);
        await dimension(u, [{ x: 35, y: 45 }], { x: 48, y: 45 }, '114');
        expect(Object.keys((await u.sketch()).dimensions).length).toBe(2);
        s = await u.sketch();
        const hole = Object.values(s.curves).find((c): c is Circle => c.type === 'circle') as Circle;
        await dimension(u, [{ x: hole.r * Math.cos(0.55), y: -hole.r * Math.sin(0.55) }], { x: 28, y: -7 }, '12');
        s = await u.sketch();
        expect(Object.keys(s.dimensions).length).toBe(3);
        const middle = (l: Line): Xy => {
          const live = s.curves[l.id] as Line;
          return { x: (pointAt(s, live.a).x + pointAt(s, live.b).x) / 2 + 3, y: pointAt(s, live.a).y };
        };

        await u.press('d');
        await u.click(middle(bottom));
        await u.click({ x: -25, y: 0 });
        await u.click({ x: -28, y: 8 });
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('11');
        await u.press('Enter');
        await exitTool(u);

        s = await u.sketch();
        await u.press('d');
        await u.click(middle(bottom));
        await u.click(middle(top));
        await u.click({ x: 30, y: 26 });
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('28');
        await u.press('Enter');
        await exitTool(u);

        s = await u.sketch();
        const live = s.curves[ref.id] as Arc;
        await dimension(u, [arcMiddle(s, live)], { x: arcMiddle(s, live).x * 1.2, y: 45 }, '17');

        const a = await u.analysis();
        expect(a.unsatisfied).toEqual([]);
        expect(a.dof).toBe(0);
        expect(await u.statusLine()).toContain('Status: Constrained');
        s = await u.sketch();
        const half = Math.sqrt(17 ** 2 - 14 ** 2);
        const arcs = Object.values(s.curves).filter((c): c is Arc => c.type === 'arc');
        expect(arcs.length).toBe(4);
        for (const arc of arcs) expect(radiusOf(s, arc)).toBeCloseTo(17, 3);
        const atTop = arcs.filter((p) => pointAt(s, p.a).y > 0);
        for (const arc of atTop) {
          near(pointAt(s, arc.c), { x: 0, y: 25 });
          expect(Math.abs(pointAt(s, arc.a).x)).toBeCloseTo(half, 3);
          expect(Math.abs(pointAt(s, arc.b).x)).toBeCloseTo(half, 3);
        }
        // Mirror images of each other across the Y axis too, as the bulges point opposite ways.
        const mids = atTop.map((p) => arcMiddle(s, p)).sort((p, q) => p.x - q.x);
        expect(mids[0].x).toBeCloseTo(-mids[1].x, 3);
        expect(mids[0].y).toBeCloseTo(mids[1].y, 3);
        expect(mids[0].x).toBeCloseTo(-17, 3);
        const lower = arcs.filter((p) => pointAt(s, p.a).y < 0);
        for (const arc of lower) near(pointAt(s, arc.c), { x: 0, y: -25 });
      });
    }
  }
});

test('OPEN-1: Concentric between a joined arc and a free circle leaves the rectangle in the app too', async ({ page }) => {
  const u = await start(page);
  await menu(u, 'create', '2-Point Rectangle', 'Rectangle');
  await u.click({ x: 0, y: 10 });
  await u.click({ x: 40, y: 40 });
  await exitTool(u);
  await menu(u, 'create', '3-Point Arc', 'Arc');
  await u.click({ x: 40, y: 40 });
  await u.click({ x: 40, y: 10 });
  await u.click({ x: 52, y: 25 });
  await exitTool(u);
  await menu(u, 'create', 'Center Diameter Circle', 'Circle');
  await u.click({ x: 20, y: 25 });
  await u.click({ x: 26, y: 25 });
  await exitTool(u);
  let s = await u.sketch();
  const ids = (t: string): Id[] => Object.values(s.curves).filter((c) => c.type === t).map((c) => c.id);
  const lines = ids('line').map((id) => s.curves[id] as Line);
  const before = lines.flatMap((l) => [pointAt(s, l.a), pointAt(s, l.b)]);
  const centre = { ...pointAt(s, (s.curves[ids('arc')[0]] as Arc).c) };
  await constrain(u, 'Concentric');
  await u.click({ x: 26, y: 25 });
  await u.click({ x: 52, y: 25 });
  await exitTool(u);
  s = await u.sketch();
  const after = lines.flatMap((l) => [pointAt(s, l.a), pointAt(s, l.b)]);
  before.forEach((p, i) => near(after[i], p));
  // The free circle gives way, though it was picked first: the arc is joined and keeps its shape.
  const arc = s.curves[ids('arc')[0]] as Arc;
  near(pointAt(s, arc.c), centre);
  near(pointAt(s, (s.curves[ids('circle')[0]] as Circle).c), centre);
});
