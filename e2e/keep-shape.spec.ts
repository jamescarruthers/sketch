// A constraint or a value keeps the shape of what it touches: docs/AUDIT.md, CHK-*. The rules under
// test: the free or lighter object gives way whichever was picked first, nothing joined to what moves
// changes shape where it need not, no arc or closed shape turns over, and a value that was good once
// is good again. The AUDIT says how many of these failed on the build the check ran against; the rest
// are the same cases the other way round, which were right already and must stay so.
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

const leave = async (u: SketchUser): Promise<void> => {
  await u.press('Escape');
  await u.press('Escape');
};

const panels: Record<string, 'create' | 'modify' | 'constraints'> = {
  Coincident: 'constraints', Midpoint: 'constraints', Concentric: 'constraints', Parallel: 'constraints', Collinear: 'constraints',
  Perpendicular: 'constraints', 'Horizontal/Vertical': 'constraints', Symmetry: 'constraints', Tangent: 'constraints', Equal: 'constraints', 'Fix/UnFix': 'constraints',
  Curvature: 'constraints', Fillet: 'modify', 'Change Parameters': 'modify', 'Blend Curve': 'modify',
};
const flyouts: Record<string, string> = {
  'Three Point Arc Slot': 'Slot', '3-Point Arc': 'Arc', 'Center Diameter Circle': 'Circle', '2-Point Rectangle': 'Rectangle', 'Center To Center Slot': 'Slot', 'Overall Slot': 'Slot',
  'Circumscribed Polygon': 'Polygon', 'Inscribed Polygon': 'Polygon', 'Fit Point Spline': 'Spline', 'Control Point Spline': 'Spline',
};

async function tool(u: SketchUser, label: string): Promise<void> {
  await u.page.locator(`.panel[data-panel="${panels[label] ?? 'create'}"] .panel-name`).click();
  if (flyouts[label]) await u.page.locator(`.menu-item.flyout[data-item="${flyouts[label]}"]`).hover();
  await u.page.locator(`.menu-item[data-item="${label}"]`).click();
  await u.settle();
}

/** Clicks with snapping off, so a click near something leaves no constraint behind. */
async function draw(u: SketchUser, label: string, clicks: Xy[]): Promise<void> {
  await tool(u, label);
  await u.page.keyboard.down('ControlOrMeta');
  for (const p of clicks) await u.click(p);
  await u.page.keyboard.up('ControlOrMeta');
  await leave(u);
}

const pick = async (u: SketchUser, label: string, ...picks: Xy[]): Promise<void> => {
  await tool(u, label);
  for (const p of picks) await u.click(p);
  await leave(u);
};

const gap = (s: Sketch, a: Id, b: Id): number => Math.hypot(pointAt(s, a).x - pointAt(s, b).x, pointAt(s, a).y - pointAt(s, b).y);
const onLine = (s: Sketch, l: Line, t = 0.4): Xy => {
  const [a, b] = [pointAt(s, l.a), pointAt(s, l.b)];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};
const ofType = <C extends { type: string }>(s: Sketch, type: C['type']): C[] => Object.values(s.curves).filter((c) => c.type === type) as unknown as C[];
const lines = (s: Sketch): Line[] => ofType<Line>(s, 'line');
const arcs = (s: Sketch): Arc[] => ofType<Arc>(s, 'arc');
const circles = (s: Sketch): Circle[] => ofType<Circle>(s, 'circle');

/** Counter-clockwise from a to b, in degrees. */
const sweep = (s: Sketch, a: Arc): number => {
  const [c, p, q] = [pointAt(s, a.c), pointAt(s, a.a), pointAt(s, a.b)];
  const t = Math.atan2((p.x - c.x) * (q.y - c.y) - (p.y - c.y) * (q.x - c.x), (p.x - c.x) * (q.x - c.x) + (p.y - c.y) * (q.y - c.y));
  return ((t < 0 ? t + 2 * Math.PI : t) * 180) / Math.PI;
};
const onArc = (s: Sketch, a: Arc): Xy => {
  const [c, p] = [pointAt(s, a.c), pointAt(s, a.a)];
  const t = Math.atan2(p.y - c.y, p.x - c.x) + (sweep(s, a) * Math.PI) / 360;
  return { x: c.x + gap(s, a.c, a.a) * Math.cos(t), y: c.y + gap(s, a.c, a.a) * Math.sin(t) };
};

/** Every size a user reads off the sketch, by curve: lengths, radii and sweeps. */
const sizes = (s: Sketch): Record<Id, number[]> => Object.fromEntries(Object.values(s.curves).flatMap((c) => {
  if (c.type === 'line') return [[c.id, [gap(s, c.a, c.b)]]];
  if (c.type === 'circle') return [[c.id, [c.r]]];
  if (c.type === 'arc') return [[c.id, [gap(s, c.c, c.a), sweep(s, c)]]];
  return [];
}));

const sameSizes = (now: Sketch, was: Sketch, only?: Id[]): void => {
  const [a, b] = [sizes(now), sizes(was)];
  for (const id of only ?? Object.keys(b)) b[id]?.forEach((v, i) => expect(a[id][i], `${id}[${i}]`).toBeCloseTo(v, 4));
};

const sameSpot = (a: Xy, b: Xy): void => {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
};

const nothingRed = async (u: SketchUser): Promise<void> => {
  expect((await u.analysis()).unsatisfied).toEqual([]);
  expect(await note(u)).toBe('');
};

const note = (u: SketchUser): Promise<string> => u.page.evaluate(() => window.__sketch.note);

const dimension = async (u: SketchUser, at: Xy, label: Xy, value: string): Promise<void> => {
  await u.press('d');
  await u.click(at);
  await u.click(label);
  await u.page.keyboard.press('ControlOrMeta+a');
  await u.page.keyboard.type(value);
  await u.press('Enter');
  await leave(u);
};

/** Modify > Change Parameters, one value, as the report did it. */
async function setValue(u: SketchUser, name: string, value: number): Promise<void> {
  await tool(u, 'Change Parameters');
  const d: Locator = u.page.locator('[data-dialog="Parameters"]');
  const inputs = d.locator('input');
  let row = -1;
  for (let i = 0; i < await inputs.count(); i++) if (await inputs.nth(i).inputValue() === name) row = i;
  expect(row).toBeGreaterThanOrEqual(0);
  await inputs.nth(row + 1).click();
  await u.page.keyboard.press('ControlOrMeta+a');
  await u.page.keyboard.type(String(value));
  await u.page.keyboard.press('Tab');
  await u.settle();
  await d.locator('.btn.primary').click();
  await u.settle();
  await leave(u);
}

// ---------------------------------------------------------------------------
// Concentric with a joined arc

/** Two lines and an arc through a third point, joined at both ends. */
async function profile(u: SketchUser, k = 1): Promise<void> {
  await tool(u, 'Line');
  await u.click({ x: -30 * k, y: -20 * k });
  await u.click({ x: 30 * k, y: -22 * k });
  await u.click({ x: 27 * k, y: 21 * k });
  await leave(u);
  await tool(u, '3-Point Arc');
  await u.click({ x: 27 * k, y: 21 * k });
  await u.click({ x: -30 * k, y: -20 * k });
  await u.click({ x: -14 * k, y: 17 * k });
  await leave(u);
}

test.describe('CHK-P1-1: Concentric with a joined arc', () => {
  for (const k of [0.6, 1, 1.5]) {
    for (const at of [{ x: -52, y: 49 }, { x: 75, y: 30 }, { x: -20, y: -60 }]) {
      for (const circleFirst of [true, false]) {
        test(`the free circle goes to the arc, size ${k}, circle at ${at.x},${at.y}, ${circleFirst ? 'circle' : 'arc'} first`, async ({ page }) => {
          const u = await start(page);
          await profile(u, k);
          await draw(u, 'Center Diameter Circle', [at, { x: at.x + 6, y: at.y + 4 }]);
          const before = await u.sketch();
          const [arc] = arcs(before);
          const [circle] = circles(before);
          const picks = [{ x: at.x + circle.r, y: at.y }, onArc(before, arc)];
          await pick(u, 'Concentric', ...(circleFirst ? picks : picks.reverse()));
          const s = await u.sketch();
          sameSizes(s, before);
          sameSpot(pointAt(s, circle.c), pointAt(before, arc.c));
          sameSpot(pointAt(s, arc.c), pointAt(before, arc.c));
          await nothingRed(u);
        });
      }
    }
  }

  for (const free of ['slot', 'arc'] as const) {
    for (const freeFirst of [true, false]) {
      test(`${free === 'slot' ? 'a slot arc' : 'a free arc'} and the joined arc keep their shapes, ${freeFirst ? free : 'joined arc'} first`, async ({ page }) => {
        const u = await start(page);
        await profile(u);
        if (free === 'slot') await draw(u, 'Center To Center Slot', [{ x: -90, y: 40 }, { x: -60, y: 55 }, { x: -70, y: 60 }]);
        else await draw(u, '3-Point Arc', [{ x: -80, y: 40 }, { x: -56, y: 40 }, { x: -68, y: 52 }]);
        const before = await u.sketch();
        const [joined, other] = arcs(before);
        const picks = [onArc(before, other), onArc(before, joined)];
        await pick(u, 'Concentric', ...(freeFirst ? picks : picks.reverse()));
        const s = await u.sketch();
        sameSizes(s, before);
        sameSpot(pointAt(s, joined.c), pointAt(s, other.c));
        await nothingRed(u);
      });
    }
  }

  for (const circleFirst of [true, false]) {
    test(`a pinned circle stays and the free profile travels whole to it, ${circleFirst ? 'circle' : 'arc'} first`, async ({ page }) => {
      const u = await start(page);
      await profile(u);
      await draw(u, 'Center Diameter Circle', [{ x: -60, y: 40 }, { x: -52, y: 40 }]);
      const s0 = await u.sketch();
      const [circle] = circles(s0);
      await pick(u, 'Fix/UnFix', { x: -52, y: 40 });
      const before = await u.sketch();
      const picks = [{ x: -52, y: 40 }, onArc(before, arcs(before)[0])];
      await pick(u, 'Concentric', ...(circleFirst ? picks : picks.reverse()));
      const s = await u.sketch();
      sameSizes(s, before);
      sameSpot(pointAt(s, circle.c), { x: -60, y: 40 });
      sameSpot(pointAt(s, arcs(s)[0].c), { x: -60, y: 40 });
      await nothingRed(u);
    });

    test(`pinned on both sides, an arc that would have to go the long way is refused, ${circleFirst ? 'circle' : 'arc'} first`, async ({ page }) => {
      const u = await start(page);
      await profile(u);
      await draw(u, 'Center Diameter Circle', [{ x: -52, y: 49 }, { x: -46, y: 53 }]);
      const s0 = await u.sketch();
      const [circle] = circles(s0);
      const rim = { x: -52 + circle.r, y: 49 };
      await pick(u, 'Fix/UnFix', rim);
      for (const l of lines(s0)) await pick(u, 'Fix/UnFix', onLine(s0, l));
      const before = await u.sketch();
      const picks = [rim, onArc(before, arcs(before)[0])];
      await pick(u, 'Concentric', ...(circleFirst ? picks : picks.reverse()));
      expect(await note(u)).toMatch(/Concentric was not applied: it conflicts with the sketch as it stands: no way was found to reach that without an arc flipping/);
      expect(Object.values((await u.sketch()).constraints).filter((k) => k.type === 'concentric')).toEqual([]);
      sameSizes(await u.sketch(), before);
    });
  }

  test('two joined arcs of one body meet with neither flipped, and the body stays', async ({ page }) => {
    const u = await start(page);
    await draw(u, '2-Point Rectangle', [{ x: -22, y: 16 }, { x: 22, y: 42 }]);
    await tool(u, '3-Point Arc');
    await u.click({ x: 22, y: 16 });
    await u.click({ x: 22, y: 42 });
    await u.click({ x: 31, y: 29 });
    await leave(u);
    await tool(u, '3-Point Arc');
    await u.click({ x: -22, y: 42 });
    await u.click({ x: -22, y: 16 });
    await u.click({ x: -31, y: 29 });
    await leave(u);
    const before = await u.sketch();
    const [right, left] = arcs(before);
    await pick(u, 'Concentric', onArc(before, left), onArc(before, right));
    const s = await u.sketch();
    sameSizes(s, before, lines(before).map((l) => l.id));
    sameSpot(pointAt(s, right.c), pointAt(s, left.c));
    for (const a of [left, right]) expect(sweep(s, a)).toBeLessThan(180);
    await nothingRed(u);
  });
});

// ---------------------------------------------------------------------------
// A radius ten times over on a tangent chain

/** Line, two tangent arcs by press and drag, line. Returns the arc-1 dimension's name. */
async function scurve(u: SketchUser, shift: Xy = { x: 0, y: 0 }): Promise<string> {
  const at = (x: number, y: number): Xy => ({ x: x + shift.x, y: y + shift.y });
  await u.press('l');
  await u.click(at(-52, -11));
  await u.click(at(-24, -4));
  await u.drag(at(-24, -4), at(-2, 11), 9);
  await u.drag(at(-2, 11), at(21, -1), 9);
  await u.click(at(53, 7));
  await leave(u);
  const s = await u.sketch();
  const [arc] = arcs(s);
  const r = gap(s, arc.c, arc.a);
  const q = onArc(s, arc);
  const c = pointAt(s, arc.c);
  await dimension(u, q, { x: q.x + (q.x - c.x) * 0.35, y: q.y + (q.y - c.y) * 0.35 }, r.toFixed(2));
  return Object.values((await u.sketch()).dimensions)[0].name;
}

test.describe('CHK-P1-2: a radius on a tangent chain', () => {
  const walks: [string, number[]][] = [
    ['up and back as reported', [2, 5, 10, 5, 1]],
    ['straight up and back', [10, 1]],
    ['down and back', [0.5, 0.2, 0.1, 1]],
    ['through the start and on', [10, 1, 0.5, 1]],
  ];
  for (const [what, factors] of walks) {
    for (const shift of [{ x: 0, y: 0 }, { x: 20, y: -15 }]) {
      test(`${what}, chain at ${shift.x},${shift.y}: no loop, and every value is taken`, async ({ page }) => {
        const u = await start(page);
        const name = await scurve(u, shift);
        const before = await u.sketch();
        const r = Object.values(before.dimensions)[0].value;
        for (const f of factors) {
          await setValue(u, name, Number((r * f).toFixed(3)));
          const s = await u.sketch();
          expect(Object.values(s.dimensions)[0].value).toBeCloseTo(r * f, 2);
          await nothingRed(u);
          // Nothing joined to the arc being sized has changed.
          const [, second] = arcs(s);
          expect(sweep(s, second)).toBeCloseTo(sweep(before, second), 3);
          for (const l of lines(before)) expect(gap(s, l.a, l.b)).toBeCloseTo(gap(before, l.a, l.b), 4);
        }
        const end = await u.sketch();
        for (const id of Object.keys(before.points)) sameSpot(pointAt(end, id), pointAt(before, id));
      });
    }
  }

  test('the original value is still good after something else changed in between', async ({ page }) => {
    const u = await start(page);
    const name = await scurve(u);
    const before = await u.sketch();
    const r = Object.values(before.dimensions)[0].value;
    await setValue(u, name, Number((r * 10).toFixed(2)));
    const mid = await u.sketch();
    await pick(u, 'Horizontal/Vertical', onLine(mid, lines(mid)[1]));
    await setValue(u, name, r);
    const s = await u.sketch();
    expect(Object.values(s.dimensions)[0].value).toBeCloseTo(r, 3);
    expect(gap(s, arcs(s)[0].c, arcs(s)[0].a)).toBeCloseTo(r, 3);
    sameSizes(s, before, [arcs(s)[1].id, ...lines(s).map((l) => l.id)]);
    await nothingRed(u);
  });
});

// ---------------------------------------------------------------------------
// The light object picked first

test.describe('CHK-P1-3: the light object gives way, picked first or not', () => {
  const rects: [Xy, Xy][] = [[{ x: -113, y: 31 }, { x: -69, y: 63 }], [{ x: -100, y: -60 }, { x: -70, y: 0 }]];
  const frees: [Xy, Xy][] = [[{ x: 30, y: -34 }, { x: 64, y: -13 }], [{ x: 10, y: 50 }, { x: 45, y: 20 }]];
  for (const [r0, r1] of rects) {
    for (const [f0, f1] of frees) {
      for (const lineFirst of [true, false]) {
        const tag = `rectangle ${r1.x - r0.x} x ${r1.y - r0.y}, line at ${f0.x},${f0.y}, ${lineFirst ? 'line' : 'corner'} first`;
        const scene = async (page: Page): Promise<{ u: SketchUser; before: Sketch; side: Id[]; free: Line }> => {
          const u = await start(page);
          await draw(u, '2-Point Rectangle', [r0, r1]);
          await draw(u, 'Line', [f0, f1]);
          const before = await u.sketch();
          const all = lines(before);
          return { u, before, side: all.slice(0, 4).map((l) => l.id), free: all[4] };
        };

        test(`Coincident, ${tag}`, async ({ page }) => {
          const { u, before, free } = await scene(page);
          const picks = [pointAt(before, free.a), r0];
          await pick(u, 'Coincident', ...(lineFirst ? picks : picks.reverse()));
          const s = await u.sketch();
          sameSizes(s, before);
          sameSpot(pointAt(s, free.a), r0);
          await nothingRed(u);
        });

        test(`Midpoint, ${tag}`, async ({ page }) => {
          const { u, before, free } = await scene(page);
          const picks = [onLine(before, free), r0];
          await pick(u, 'Midpoint', ...(lineFirst ? picks : picks.reverse()));
          const s = await u.sketch();
          sameSizes(s, before);
          const [a, b] = [pointAt(s, free.a), pointAt(s, free.b)];
          sameSpot({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, r0);
          await nothingRed(u);
        });
      }
    }
  }

  for (const lineFirst of [true, false]) {
    test(`Midpoint from a free line to a filleted rectangle keeps its sides, ${lineFirst ? 'line' : 'fillet end'} first`, async ({ page }) => {
      const u = await start(page);
      await draw(u, '2-Point Rectangle', [{ x: -90, y: 20 }, { x: -50, y: 50 }]);
      await tool(u, 'Fillet');
      await u.click({ x: -90, y: 20 });
      await u.page.keyboard.type('6');
      await u.press('Enter');
      await leave(u);
      await draw(u, 'Line', [{ x: 30, y: -34 }, { x: 64, y: -13 }]);
      const before = await u.sketch();
      const free = lines(before).find((l) => pointAt(before, l.a).x > 0) as Line;
      const [fillet] = arcs(before);
      const picks = [onLine(before, free), pointAt(before, fillet.a)];
      await pick(u, 'Midpoint', ...(lineFirst ? picks : picks.reverse()));
      const s = await u.sketch();
      sameSizes(s, before);
      await nothingRed(u);
    });

    test(`Midpoint from a free line to a slot's centre keeps the slot, ${lineFirst ? 'line' : 'centre'} first`, async ({ page }) => {
      const u = await start(page);
      await draw(u, 'Center To Center Slot', [{ x: -80, y: 30 }, { x: -45, y: 30 }, { x: -50, y: 38 }]);
      await draw(u, 'Line', [{ x: 30, y: -34 }, { x: 64, y: -13 }]);
      const before = await u.sketch();
      const free = lines(before).at(-1) as Line;
      const picks = [onLine(before, free), pointAt(before, arcs(before)[0].c)];
      await pick(u, 'Midpoint', ...(lineFirst ? picks : picks.reverse()));
      const s = await u.sketch();
      sameSizes(s, before);
      await nothingRed(u);
    });
  }

  for (const lineFirst of [true, false]) {
    test(`Coincident from a rectangle corner to a free line moves the line, ${lineFirst ? 'line' : 'corner'} first`, async ({ page }) => {
      const u = await start(page);
      await draw(u, '2-Point Rectangle', [{ x: -80, y: 20 }, { x: -40, y: 50 }]);
      await draw(u, 'Line', [{ x: 30, y: -34 }, { x: 64, y: -13 }]);
      const before = await u.sketch();
      const free = lines(before).at(-1) as Line;
      const picks = [onLine(before, free), { x: -80, y: 20 }];
      await pick(u, 'Coincident', ...(lineFirst ? picks : picks.reverse()));
      const s = await u.sketch();
      sameSizes(s, before);
      sameSpot(pointAt(s, lines(before)[0].a), pointAt(before, lines(before)[0].a));
      await nothingRed(u);
    });

    test(`Coincident from a free line's end to a rectangle side keeps both, ${lineFirst ? 'line end' : 'side'} first`, async ({ page }) => {
      const u = await start(page);
      await draw(u, '2-Point Rectangle', [{ x: -80, y: 20 }, { x: -40, y: 50 }]);
      await draw(u, 'Line', [{ x: 30, y: -34 }, { x: 64, y: -13 }]);
      const before = await u.sketch();
      const free = lines(before).at(-1) as Line;
      const picks = [pointAt(before, free.a), onLine(before, lines(before)[0])];
      await pick(u, 'Coincident', ...(lineFirst ? picks : picks.reverse()));
      sameSizes(await u.sketch(), before);
      await nothingRed(u);
    });
  }

  test('Coincident between two free lines: the first still stays', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: 0, y: 20 }, { x: 20, y: 30 }]);
    await draw(u, 'Line', [{ x: 50, y: 40 }, { x: 70, y: 10 }]);
    const before = await u.sketch();
    const [a, b] = lines(before);
    await pick(u, 'Coincident', pointAt(before, a.b), pointAt(before, b.a));
    const s = await u.sketch();
    sameSizes(s, before);
    sameSpot(pointAt(s, a.a), pointAt(before, a.a));
    sameSpot(pointAt(s, b.a), pointAt(before, a.b));
  });

  test('a pinned point stays, and the free line comes to it', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: 30, y: -34 }, { x: 64, y: -13 }]);
    const before = await u.sketch();
    const [free] = lines(before);
    await pick(u, 'Coincident', pointAt(before, free.a), { x: 0, y: 0 });
    const s = await u.sketch();
    sameSizes(s, before);
    sameSpot(pointAt(s, free.a), { x: 0, y: 0 });
    await nothingRed(u);
  });
});

// ---------------------------------------------------------------------------
// False refusals

test.describe('CHK-P2-1: Coincident from a line end to a slot', () => {
  const layouts: [Xy[], Xy[]][] = [
    [[{ x: 30, y: -34 }, { x: 64, y: -13 }], [{ x: -80, y: 30 }, { x: -45, y: 30 }, { x: -50, y: 38 }]],
    [[{ x: -70, y: -40 }, { x: -30, y: -55 }], [{ x: 20, y: 30 }, { x: 40, y: 60 }, { x: 45, y: 40 }]],
    [[{ x: 10, y: 60 }, { x: 45, y: 40 }], [{ x: -60, y: -30 }, { x: -60, y: 5 }, { x: -50, y: -10 }]],
  ];
  const targets: [string, (s: Sketch) => Xy][] = [
    ['end centre', (s) => pointAt(s, arcs(s)[0].c)],
    ['other end centre', (s) => pointAt(s, arcs(s)[1].c)],
    ['arc end', (s) => pointAt(s, arcs(s)[0].a)],
  ];
  layouts.forEach(([free, slot], n) => {
    for (const [what, where] of targets) {
      for (const lineFirst of [true, false]) {
        test(`layout ${n}, ${what}, ${lineFirst ? 'line end' : 'slot'} first`, async ({ page }) => {
          const u = await start(page);
          await draw(u, 'Center To Center Slot', slot);
          await draw(u, 'Line', free);
          const before = await u.sketch();
          const line = lines(before).at(-1) as Line;
          const target = where(before);
          const picks = [pointAt(before, line.a), target];
          await pick(u, 'Coincident', ...(lineFirst ? picks : picks.reverse()));
          const s = await u.sketch();
          sameSizes(s, before);
          sameSpot(pointAt(s, line.a), target);
          await nothingRed(u);
        });
      }
    }
  });
});

test.describe('refusals say what actually failed', () => {
  test('a size the constraints will not let stay still changes, and it says so', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Center Diameter Circle', [{ x: -30, y: 10 }, { x: -18, y: 10 }]);
    await draw(u, 'Center Diameter Circle', [{ x: 10, y: 10 }, { x: 18, y: 10 }]);
    const s0 = await u.sketch();
    const [a, b] = circles(s0);
    await pick(u, 'Tangent', { x: -30 + a.r, y: 10 }, { x: 10 + b.r, y: 10 });
    expect(await note(u)).toBe('');
    const s1 = await u.sketch();
    await u.press('d');
    await u.click(pointAt(s1, a.c));
    await u.click(pointAt(s1, b.c));
    await u.click({ x: 0, y: -40 });
    await u.page.keyboard.press('ControlOrMeta+a');
    await u.page.keyboard.type('90');
    await u.press('Enter');
    await leave(u);
    expect(await note(u)).toMatch(/the constraints also changed a radius/);
    const s = await u.sketch();
    expect(gap(s, a.c, b.c)).toBeCloseTo(90, 4);
    await u.press('ControlOrMeta+z');
    expect(await u.sketch()).toEqual(s1);
  });

  test('a line on its own end really would collapse, and it says so', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: 0, y: 10 }, { x: 40, y: 10 }]);
    const before = await u.sketch();
    const [l] = lines(before);
    await pick(u, 'Coincident', pointAt(before, l.a), pointAt(before, l.b));
    expect(await note(u)).toMatch(/not applied.*collapse a line to zero length/);
    expect(await u.sketch()).toEqual(before);
  });

  test('Perpendicular on a held line and a fixed slanted one names the conflict', async ({ page }) => {
    const u = await start(page);
    await draw(u, '2-Point Rectangle', [{ x: -30, y: 10 }, { x: 20, y: 40 }]);
    await draw(u, 'Line', [{ x: 40, y: -40 }, { x: 70, y: -10 }]);
    const s0 = await u.sketch();
    const free = lines(s0).at(-1) as Line;
    await pick(u, 'Fix/UnFix', onLine(s0, free));
    const before = await u.sketch();
    const top = lines(before).find((l) => Math.abs(pointAt(before, l.a).y - 40) < 1e-6 && Math.abs(pointAt(before, l.b).y - 40) < 1e-6) as Line;
    await pick(u, 'Perpendicular', onLine(before, free), onLine(before, top));
    expect(await note(u)).toMatch(/not applied: it conflicts with the sketch as it stands/);
    sameSizes(await u.sketch(), before);
    for (const id of Object.keys(before.points)) sameSpot(pointAt(await u.sketch(), id), pointAt(before, id));
  });

  test('a side too long for its triangle changes nothing else, and says so', async ({ page }) => {
    const u = await start(page);
    await tool(u, 'Line');
    await u.click({ x: -30, y: -20 });
    await u.click({ x: 30, y: -20 });
    await u.click({ x: 5, y: 30 });
    await u.click({ x: -30, y: -20 });
    await leave(u);
    const s0 = await u.sketch();
    const [bottom, right, left] = lines(s0);
    await pick(u, 'Fix/UnFix', onLine(s0, bottom));
    const beside = (l: Line, by: number): Xy => {
      const [a, b] = [pointAt(s0, l.a), pointAt(s0, l.b)];
      const n = Math.hypot(b.x - a.x, b.y - a.y);
      return { x: (a.x + b.x) / 2 + ((b.y - a.y) / n) * by, y: (a.y + b.y) / 2 - ((b.x - a.x) / n) * by };
    };
    await dimension(u, onLine(s0, right), beside(right, 6), gap(s0, right.a, right.b).toFixed(3));
    await dimension(u, onLine(s0, left), beside(left, 6), gap(s0, left.a, left.b).toFixed(3));
    const before = await u.sketch();
    expect(Object.values(before.dimensions).map((d) => [d.kind, d.driving])).toEqual([['distance', true], ['distance', true]]);
    expect((await u.analysis()).dof).toBe(0);
    await setValue(u, Object.values(before.dimensions)[0].name, 200);
    const s = await u.sketch();
    for (const id of Object.keys(before.points)) sameSpot(pointAt(s, id), pointAt(before, id));
    expect(await note(u)).not.toBe('');
    expect(await note(u)).not.toMatch(/collapse/);
  });
});

// ---------------------------------------------------------------------------
// The stacked polygon, slot and tangent circle

/** The report's `polyslot`, to just before the slot dimension goes up. Returns the slot dimension's name. */
async function polyslot(u: SketchUser, record: (s: Sketch) => void): Promise<{ edge: string; slot: string }> {
  await draw(u, 'Circumscribed Polygon', [{ x: -37, y: 11 }, { x: -22, y: 19 }]);
  await u.press('Enter');
  await leave(u);
  await draw(u, 'Overall Slot', [{ x: 9, y: -14 }, { x: 44, y: -3 }, { x: 46, y: -9 }]);
  await draw(u, 'Center Diameter Circle', [{ x: -44, y: -41 }, { x: -38, y: -38 }]);
  await draw(u, 'Line', [{ x: 5, y: 36 }, { x: 37, y: 51 }]);
  const s = await u.sketch();
  const small = circles(s).find((c) => c.r < 10) as Circle;
  const big = circles(s).find((c) => c.r >= 10) as Circle;
  const normal = lines(s).filter((l) => l.lineType === 'normal');
  const edges = normal.filter((l) => pointAt(s, l.a).x < -10);
  const side = normal.filter((l) => pointAt(s, l.a).x > 0 && pointAt(s, l.a).y < 15)[0];
  const free = normal.at(-1) as Line;
  const [far, near] = arcs(s);
  const where = (c: Line | Arc | Circle, now: Sketch): Xy => {
    const cur = now.curves[c.id] as Line | Arc | Circle;
    if (cur.type === 'line') return onLine(now, cur, 0.3);
    if (cur.type === 'arc') return onArc(now, cur);
    return { x: pointAt(now, cur.c).x + cur.r * Math.cos(2.3), y: pointAt(now, cur.c).y + cur.r * Math.sin(2.3) };
  };
  const step = async (label: string, ...curves: (Line | Arc | Circle)[]): Promise<void> => {
    const now = await u.sketch();
    await pick(u, label, ...curves.map((c) => where(c, now)));
    record(await u.sketch());
  };
  await step('Horizontal/Vertical', edges[0]);
  await step('Horizontal/Vertical', side);
  await step('Equal', edges[1], free);
  await step('Tangent', far, small);
  await step('Tangent', edges[2], small);
  const tangent = await u.sketch();
  await step('Concentric', near, big);
  const now = await u.sketch();
  // With the slot and polygon rigid, a tangent chain this short cannot stay as it was: the free circle
  // takes it, and says so, and the slot keeps its length, which is what used to go (24.04 to 2.75).
  expect(gap(now, side.a, side.b)).toBeCloseTo(gap(tangent, side.a, side.b), 4);
  expect(gap(now, far.c, far.a)).toBeCloseTo(gap(tangent, far.c, far.a), 4);
  if (Math.abs((now.curves[small.id] as Circle).r - small.r) > 1e-4) expect(await note(u)).toMatch(/the constraints also changed a radius/);
  const p = where(edges[0], now);
  await dimension(u, p, { x: p.x, y: p.y + 24 }, '17');
  record(await u.sketch());
  const q = onLine(await u.sketch(), (await u.sketch()).curves[side.id] as Line, 0.65);
  await dimension(u, q, { x: q.x + 18, y: q.y }, '23');
  expect(await note(u)).toBe('');
  record(await u.sketch());
  const ds = Object.values((await u.sketch()).dimensions);
  return { edge: ds[0].name, slot: ds[1].name };
}

test.describe('CHK-P2-2, CHK-P2-3: the polygon, slot and tangent circle', () => {
  for (const up of [230, 115, 460]) {
    test(`slot ${up} leaves its free radius and comes back to 23, and undo and redo are exact`, async ({ page }) => {
      test.setTimeout(90_000);
      const u = await start(page);
      const states: Sketch[] = [];
      const names = await polyslot(u, (s) => states.push(s));
      const rest = states.at(-1) as Sketch;
      const [arc] = arcs(rest);
      const small = circles(rest).find((c) => c.r < 10) as Circle;
      for (const v of [up, 2.3, 23]) {
        await setValue(u, names.slot, v);
        const s = await u.sketch();
        states.push(s);
        expect(gap(s, arc.c, arc.a)).toBeCloseTo(gap(rest, arc.c, arc.a), 4);
        expect((s.curves[small.id] as Circle).r).toBeCloseTo(small.r, 4);
        await nothingRed(u);
      }
      const end = await u.sketch();
      for (const id of Object.keys(rest.points)) sameSpot(pointAt(end, id), pointAt(rest, id));
      // Back through every recorded state, bit for bit, then forward again.
      for (let i = states.length - 2; i >= 0; i--) {
        await u.press('ControlOrMeta+z');
        expect(await u.sketch()).toEqual(states[i]);
      }
      for (let i = 1; i < states.length; i++) {
        await u.press('ControlOrMeta+Shift+z');
        expect(await u.sketch()).toEqual(states[i]);
      }
    });
  }
});

test('control for CHK-P2-3: a tangent the geometry meets from its other side stays put on undo', async ({ page }) => {
  const u = await start(page);
  await draw(u, 'Center Diameter Circle', [{ x: -20, y: 0 }, { x: -5, y: 0 }]);
  await draw(u, 'Center Diameter Circle', [{ x: -14, y: 0 }, { x: -9, y: 0 }]);
  const s0 = await u.sketch();
  const [big, small] = circles(s0);
  await pick(u, 'Tangent', { x: pointAt(s0, big.c).x, y: big.r }, { x: pointAt(s0, small.c).x, y: small.r });
  const a = await u.sketch();
  await pick(u, 'Horizontal/Vertical', pointAt(a, big.c), pointAt(a, small.c));
  const b = await u.sketch();
  await u.press('ControlOrMeta+z');
  expect(await u.sketch()).toEqual(a);
  await u.press('ControlOrMeta+Shift+z');
  expect(await u.sketch()).toEqual(b);
});

// ---------------------------------------------------------------------------
// Free line lengths

test.describe('CHK-P2-4: free line lengths stay where they can', () => {
  test('Horizontal on the first line of a tangent S-curve', async ({ page }) => {
    const u = await start(page);
    await u.press('l');
    await u.click({ x: -52, y: -11 });
    await u.click({ x: -24, y: -4 });
    await u.drag({ x: -24, y: -4 }, { x: -2, y: 11 }, 9);
    await u.drag({ x: -2, y: 11 }, { x: 21, y: -1 }, 9);
    await u.click({ x: 53, y: 7 });
    await leave(u);
    const before = await u.sketch();
    await pick(u, 'Horizontal/Vertical', onLine(before, lines(before)[0]));
    sameSizes(await u.sketch(), before);
    await nothingRed(u);
  });

  test('a radius ten times over keeps the free-ended last line', async ({ page }) => {
    const u = await start(page);
    const name = await scurve(u);
    const before = await u.sketch();
    await setValue(u, name, Number((Object.values(before.dimensions)[0].value * 10).toFixed(2)));
    const s = await u.sketch();
    const last = lines(before)[1];
    expect(gap(s, last.a, last.b)).toBeCloseTo(gap(before, last.a, last.b), 4);
  });

  /** Three lines end to end, ends free. */
  const chain = async (u: SketchUser, k: number): Promise<void> => {
    await tool(u, 'Line');
    await u.click({ x: -60 * k, y: -20 * k });
    await u.click({ x: -30 * k, y: 10 * k });
    await u.click({ x: -5 * k, y: -5 * k });
    await u.click({ x: 25 * k, y: 18 * k });
    await leave(u);
  };
  const shapes: [string, string, number, number][] = [
    ['Parallel', 'line 1 then 2', 0, 1], ['Parallel', 'line 2 then 1', 1, 0],
    ['Perpendicular', 'line 2 then 3', 1, 2], ['Perpendicular', 'line 3 then 2', 2, 1],
    ['Collinear', 'line 3 then 2', 2, 1], ['Collinear', 'line 2 then 3', 1, 2],
    ['Collinear', 'line 1 then 3', 0, 2],
  ];
  for (const k of [1, 1.4]) {
    for (const [label, how, i, j] of shapes) {
      test(`${label} on a chain, ${how}, size ${k}`, async ({ page }) => {
        const u = await start(page);
        await chain(u, k);
        const before = await u.sketch();
        const ls = lines(before);
        await pick(u, label, onLine(before, ls[i]), onLine(before, ls[j]));
        const s = await u.sketch();
        sameSizes(s, before);
        await nothingRed(u);
      });
    }
  }

  test('Parallel from a free line to a side of a closed profile moves the free line', async ({ page }) => {
    const u = await start(page);
    await profile(u);
    await draw(u, 'Line', [{ x: 40, y: 40 }, { x: 70, y: 60 }]);
    const before = await u.sketch();
    const [side, , free] = lines(before);
    await pick(u, 'Parallel', onLine(before, free), onLine(before, side));
    sameSizes(await u.sketch(), before);
    await nothingRed(u);
  });

  for (const freeFirst of [true, false]) {
    test(`Symmetry between a free arc and a joined one moves the free arc, ${freeFirst ? 'free' : 'joined'} first`, async ({ page }) => {
      const u = await start(page);
      await profile(u);
      await draw(u, 'Line', [{ x: 45, y: -50 }, { x: 45, y: 50 }]);
      await draw(u, '3-Point Arc', [{ x: 60, y: 30 }, { x: 60, y: -30 }, { x: 72, y: 0 }]);
      const before = await u.sketch();
      const [joined, free] = arcs(before);
      const axis = lines(before).at(-1) as Line;
      const picks = [onArc(before, free), onArc(before, joined)];
      await pick(u, 'Symmetry', ...(freeFirst ? picks : picks.reverse()), onLine(before, axis));
      const s = await u.sketch();
      expect(sizes(s)[free.id][0]).toBeCloseTo(sizes(before)[joined.id][0], 4);
      sameSizes(s, before, [joined.id, ...lines(before).map((l) => l.id)]);
      await nothingRed(u);
    });
  }
});

// ---------------------------------------------------------------------------
// A triangle through a run of edits

const signedArea = (s: Sketch, ls: Line[]): number => {
  const [p, q, r] = ls.map((l) => pointAt(s, l.a));
  return ((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
};

test.describe('CHK-P2-5: a triangle through a run of value edits', () => {
  const triangles: Xy[][] = [
    [{ x: -41, y: -23 }, { x: 27, y: -16 }, { x: -5, y: 38 }],
    [{ x: -30, y: 20 }, { x: 45, y: 28 }, { x: 10, y: -35 }],
    [{ x: -50, y: -5 }, { x: 30, y: -30 }, { x: 22, y: 40 }],
  ];
  const runs: [number, number][][] = [
    [[0, 1.5], [0, 2.2], [0, 0.3], [1, 3], [1, 10], [1, 0.1], [0, 1], [1, 1]],
    [[1, 10], [0, 0.3], [1, 0.1], [0, 1], [1, 1]],
  ];
  triangles.forEach((t, n) => {
    runs.forEach((run, m) => {
      test(`triangle ${n}, run ${m}: never turns over, and comes back exactly`, async ({ page }) => {
        test.setTimeout(90_000);
        const u = await start(page);
        await tool(u, 'Line');
        for (const p of [...t, t[0]]) await u.click(p);
        await leave(u);
        const s0 = await u.sketch();
        const [one, two] = lines(s0);
        const midOf = (l: Line): Xy => onLine(s0, l, 0.5);
        await dimension(u, midOf(one), { x: midOf(one).x + 5, y: midOf(one).y - 13 }, gap(s0, one.a, one.b).toFixed(3));
        await dimension(u, midOf(two), { x: midOf(two).x + 13, y: midOf(two).y + 7 }, gap(s0, two.a, two.b).toFixed(3));
        const before = await u.sketch();
        const [d0, d1] = Object.values(before.dimensions);
        const ls = lines(before);
        const side = Math.sign(signedArea(before, ls));
        for (const [which, f] of run) {
          const d = which === 0 ? d0 : d1;
          await setValue(u, d.name, Number((d.value * f).toFixed(3)));
          const s = await u.sketch();
          expect(Object.values(s.dimensions)[which].value).toBeCloseTo(d.value * f, 2);
          expect(Math.sign(signedArea(s, ls)), `after ${d.name} x ${f}`).toBe(side);
          await nothingRed(u);
        }
        const end = await u.sketch();
        for (const id of Object.keys(before.points)) sameSpot(pointAt(end, id), pointAt(before, id));
      });
    });

    // Only where the line's length is within 1% of what its horizontal dimension reads. Further off is
    // not a return to anything: the third side stays given way, which README Limitations says.
    if (n < 2) test(`triangle ${n}: a value near the start, as read off the sketch, comes back to near the start shape`, async ({ page }) => {
      test.setTimeout(90_000);
      const u = await start(page);
      await tool(u, 'Line');
      for (const p of [...t, t[0]]) await u.click(p);
      await leave(u);
      const s0 = await u.sketch();
      const [one, two] = lines(s0);
      const [m0, m1] = [onLine(s0, one, 0.5), onLine(s0, two, 0.5)];
      // As the report did it: each typed at the line's length, though the first reads horizontally.
      await dimension(u, m0, { x: m0.x + 5, y: m0.y - 13 }, gap(s0, one.a, one.b).toFixed(2));
      await dimension(u, m1, { x: m1.x + 13, y: m1.y + 7 }, gap(s0, two.a, two.b).toFixed(2));
      const before = await u.sketch();
      const ls = lines(before);
      const [d0, d1] = Object.values(before.dimensions);
      const [v0, v1] = [gap(before, one.a, one.b), gap(before, two.a, two.b)];
      const side = Math.sign(signedArea(before, ls));
      const run: [string, number][] = [
        [d0.name, v0 * 1.5], [d0.name, v0 * 2.2], [d0.name, v0 * 0.3],
        [d1.name, v1 * 3], [d1.name, v1 * 10], [d1.name, v1 * 0.1], [d0.name, v0], [d1.name, v1],
      ];
      for (const [name, v] of run) {
        await setValue(u, name, Number(v.toFixed(2)));
        expect(Math.sign(signedArea(await u.sketch(), ls))).toBe(side);
        await nothingRed(u);
      }
      const s = await u.sketch();
      for (const l of ls) {
        const was = gap(before, l.a, l.b);
        expect(Math.abs(gap(s, l.a, l.b) - was) / was).toBeLessThan(0.05);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// The small ones from the same check

test.describe('CHK-P3', () => {
  for (const off of [0, 0.3]) {
    test(`P3-2: a Mirror window started on a curve, ${off} mm off it, still opens`, async ({ page }) => {
      const u = await start(page);
      await draw(u, '2-Point Rectangle', [{ x: -30, y: 10 }, { x: -10, y: 30 }]);
      await draw(u, 'Line', [{ x: -60, y: 45 }, { x: -2, y: 45 }]);
      await u.tool('Mirror');
      const d = u.page.locator('.dialog[data-dialog="Mirror"]');
      await u.drag({ x: -40, y: 45 - off }, { x: -5, y: 5 }, 8);
      await expect(d.locator('[data-field="Objects"] .select-count')).toHaveText(/^[1-9]\d* selected$/);
    });
  }

  test('P3-2: a press on a curve in Mirror with no drag still picks it', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: -60, y: 45 }, { x: -2, y: 45 }]);
    await u.tool('Mirror');
    await u.click({ x: -30, y: 45 });
    await expect(u.page.locator('.dialog[data-dialog="Mirror"] [data-field="Objects"] .select-count')).toHaveText('1 selected');
  });

  test('P3-4: Look At takes a dimension label in, clear of the ribbon', async ({ page }) => {
    const u = await start(page);
    await draw(u, '2-Point Rectangle', [{ x: -30, y: -10 }, { x: 30, y: 10 }]);
    const s = await u.sketch();
    await dimension(u, onLine(s, lines(s)[2], 0.5), { x: 0, y: 60 }, '60');
    await u.press('F6');
    const after = await u.sketch();
    const label = Object.values(after.dimensions)[0].label;
    const at = await u.screen(label);
    const canvas = await u.page.locator('canvas').first().boundingBox();
    expect(at.y).toBeGreaterThan(40);
    expect(at.y).toBeLessThan((canvas as { height: number }).height - 40);
  });

  test('P3-6: Symmetry says why an unlike second pick is not taken', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Center Diameter Circle', [{ x: -40, y: 0 }, { x: -30, y: 0 }]);
    await draw(u, '3-Point Arc', [{ x: 30, y: -10 }, { x: 30, y: 10 }, { x: 42, y: 0 }]);
    await tool(u, 'Symmetry');
    await u.click({ x: -30, y: 0 });
    await u.click({ x: 42, y: 0 });
    expect(await note(u)).toBe('Symmetry pairs two of a kind: pick another circle');
    await leave(u);
  });

  test('P3-8: the SOLID tab during a sketch has one panel named CREATE', async ({ page }) => {
    await start(page);
    await page.locator('.tab', { hasText: 'SOLID' }).click();
    await expect(page.locator('.ribbon .panel-name').filter({ hasText: 'CREATE' })).toHaveCount(1);
    await expect(page.locator('.ribbon .panel[data-panel="create"] .panel-name')).toHaveCount(1);
  });

  test('P3-9: Dark toolbox hints reach 4.5:1', async ({ page }) => {
    const u = await start(page);
    await page.locator('[data-menu="file"]').click();
    await page.locator('.menu-item.flyout[data-item="Theme"]').hover();
    await page.locator('.menu-item[data-item="Theme Dark"]').click();
    await u.settle();
    await u.press('s');
    const ratio = await page.evaluate(() => {
      const rgb = (c: string): number[] => (c.match(/[\d.]+/g) as string[]).slice(0, 3).map(Number);
      const lum = (c: number[]): number => {
        const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const worst = [...document.querySelectorAll('.toolbox .menu-hint')].filter((e) => e.textContent).map((e) => {
        let box: Element | null = e;
        let bg = 'rgba(0, 0, 0, 0)';
        while (box && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
          bg = getComputedStyle(box).backgroundColor;
          box = box.parentElement;
        }
        const [a, b] = [lum(rgb(getComputedStyle(e).color)), lum(rgb(bg))];
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      return Math.min(...worst);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------------------------------------------------------------------------
// The recheck: what the first round left, and what it brought in

const sideways = (s: Sketch, l: Line, by: number): Xy => {
  const [a, b] = [pointAt(s, l.a), pointAt(s, l.b)];
  const n = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (a.x + b.x) / 2 + ((b.y - a.y) / n) * by, y: (a.y + b.y) / 2 - ((b.x - a.x) / n) * by };
};

/** A value that may be refused: what it took, or the note that says why not. */
const tryValue = async (u: SketchUser, name: string, v: number): Promise<boolean> => {
  await setValue(u, name, v);
  return (await note(u)).includes('not applied') === false;
};

test.describe('CHK2-P1-A: going back to a value leaves fixed geometry alone', () => {
  const layouts: [Xy, Xy][] = [[{ x: -20, y: 5 }, { x: 30, y: 18 }], [{ x: -40, y: -30 }, { x: 10, y: 12 }], [{ x: 5, y: 30 }, { x: 45, y: 42 }]];
  layouts.forEach(([a, b], n) => {
    for (const end of ['a', 'b'] as const) {
      for (const back of [1, 1.005]) {
        test(`layout ${n}, end ${end} fixed after the edit, back at x${back}`, async ({ page }) => {
          const u = await start(page);
          await draw(u, 'Line', [a, b]);
          const s0 = await u.sketch();
          const [l] = lines(s0);
          await dimension(u, onLine(s0, l), { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 22 }, '50');
          const base = await u.sketch();
          const [d] = Object.values(base.dimensions);
          await setValue(u, d.name, d.value * 2);
          const big = await u.sketch();
          await pick(u, 'Fix/UnFix', pointAt(big, l[end]));
          const pinned = { ...pointAt(await u.sketch(), l[end]) };
          await setValue(u, d.name, d.value * back);
          const s = await u.sketch();
          sameSpot(pointAt(s, l[end]), pinned);
          expect(Object.values(s.dimensions)[0].value).toBeCloseTo(d.value * back, 4);
          await nothingRed(u);
        });
      }
    }
  });

  for (const [w, h] of [[60, 40], [80, 30]]) {
    test(`a fixed top line of a ${w} x ${h} rectangle stays through a return, and the conflict shows`, async ({ page }) => {
      const u = await start(page);
      await draw(u, '2-Point Rectangle', [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }]);
      const s0 = await u.sketch();
      const bottom = lines(s0).find((l) => pointAt(s0, l.a).y < 0 && pointAt(s0, l.b).y < 0) as Line;
      await dimension(u, onLine(s0, bottom), { x: 4, y: -h / 2 - 14 }, String(w));
      const base = await u.sketch();
      const [d] = Object.values(base.dimensions);
      await setValue(u, d.name, w * 2);
      const big = await u.sketch();
      const top = lines(big).find((l) => pointAt(big, l.a).y > 0 && pointAt(big, l.b).y > 0) as Line;
      await pick(u, 'Fix/UnFix', onLine(big, top));
      const held = [{ ...pointAt(big, top.a) }, { ...pointAt(big, top.b) }];
      await setValue(u, d.name, w);
      const s = await u.sketch();
      sameSpot(pointAt(s, top.a), held[0]);
      sameSpot(pointAt(s, top.b), held[1]);
      const told = (await u.analysis()).unsatisfied.length > 0 || (await note(u)) !== '';
      expect(told).toBe(true);
    });
  }

  test('Fix put on and taken off again: the return is a return', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: -20, y: 5 }, { x: 30, y: 18 }]);
    const s0 = await u.sketch();
    const [l] = lines(s0);
    await dimension(u, onLine(s0, l), { x: 5, y: 40 }, '50');
    const base = await u.sketch();
    const [d] = Object.values(base.dimensions);
    await setValue(u, d.name, 100);
    const big = await u.sketch();
    await pick(u, 'Fix/UnFix', pointAt(big, l.b));
    await pick(u, 'Fix/UnFix', pointAt(big, l.b));
    await setValue(u, d.name, 50);
    expect(Object.values((await u.sketch()).dimensions)[0].value).toBeCloseTo(50, 6);
    await nothingRed(u);
  });
});

test.describe('a horizontal or vertical value on a line', () => {
  for (const [a, b] of [[{ x: -20, y: 5 }, { x: 30, y: 18 }], [{ x: -35, y: -12 }, { x: 15, y: 20 }]] as [Xy, Xy][]) {
    for (const f of [2, 0.5]) {
      test(`from ${a.x},${a.y}, x${f}: stretches the line, does not turn it`, async ({ page }) => {
        const u = await start(page);
        await draw(u, 'Line', [a, b]);
        const s0 = await u.sketch();
        const [l] = lines(s0);
        await dimension(u, onLine(s0, l), { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 22 }, String(Math.abs(b.x - a.x)));
        const base = await u.sketch();
        const [d] = Object.values(base.dimensions);
        expect(d.kind).toBe('horizontal');
        const rise = (s: Sketch): number => pointAt(s, l.b).y - pointAt(s, l.a).y;
        await setValue(u, d.name, d.value * f);
        expect(rise(await u.sketch())).toBeCloseTo(rise(base), 4);
        await nothingRed(u);
      });
    }
  }
});

test.describe('CHK2-P1-B: a radius does not loop an arc', () => {
  /** Line, two tangent arcs, line, with both end pieces joined as drawn. */
  const chain = async (u: SketchUser, p: Xy[], tangentLast: boolean): Promise<Sketch> => {
    await u.press('l');
    await u.click(p[0]);
    await u.click(p[1]);
    await u.drag(p[1], p[2], 9);
    await u.drag(p[2], p[3], 9);
    await u.click(p[4]);
    await leave(u);
    const s = await u.sketch();
    if (tangentLast && arcs(s).length > 1) await pick(u, 'Tangent', onArc(s, arcs(s)[1]), onLine(s, lines(s)[1], 0.6));
    return u.sketch();
  };
  const chains: [string, Xy[], boolean][] = [
    ['steep, last line tangent', [{ x: -40, y: -50 }, { x: -30, y: -20 }, { x: -5, y: 5 }, { x: 12, y: -22 }, { x: 20, y: -55 }], true],
    ['recorded', [{ x: -52, y: -11 }, { x: -24, y: -4 }, { x: -2, y: 11 }, { x: 21, y: -1 }, { x: 53, y: 7 }], false],
    ['wide, last line by a corner', [{ x: -70, y: -30 }, { x: -40, y: -20 }, { x: -5, y: 10 }, { x: 30, y: -10 }, { x: 70, y: 5 }], false],
    ['flat', [{ x: -60, y: 0 }, { x: -30, y: 3 }, { x: -10, y: 14 }, { x: 10, y: 4 }, { x: 50, y: 10 }], false],
  ];
  const walks: [string, number[]][] = [['up', [2, 5, 10]], ['down then a value off the trail', [0.2, 0.1, 1.3]]];
  for (const [name, p, last] of chains) {
    for (const [what, factors] of walks) {
      for (const which of [0, 1]) {
        test(`${name}, arc ${which + 1}, ${what}: no arc goes past where it began or a half turn`, async ({ page }) => {
          const u = await start(page);
          const before = await chain(u, p, last);
          expect(arcs(before).length).toBe(2);
          const arc = arcs(before)[which];
          const r = gap(before, arc.c, arc.a);
          const q = onArc(before, arc);
          const c = pointAt(before, arc.c);
          await dimension(u, q, { x: q.x + (q.x - c.x) * 0.3, y: q.y + (q.y - c.y) * 0.3 }, r.toFixed(2));
          const base = await u.sketch();
          const [d] = Object.values(base.dimensions);
          const limit = (a: Arc): number => Math.max(180, sweep(base, a)) + 1.5;
          for (const f of factors) {
            await tryValue(u, d.name, Number((d.value * f).toFixed(3)));
            const s = await u.sketch();
            for (const a of arcs(base)) expect(sweep(s, a), `arc ${a.id} at x${f}`).toBeLessThanOrEqual(limit(a));
          }
        });
      }
    }
  }

  for (const bulge of [{ x: -18.5, y: 24.2 }, { x: -22, y: 30 }, { x: -12, y: 20 }]) {
    test(`an arc closing a profile, bulge ${bulge.x},${bulge.y}, halved, does not close on itself`, async ({ page }) => {
      const u = await start(page);
      await tool(u, 'Line');
      await u.click({ x: -30, y: -20 });
      await u.click({ x: 30, y: -22 });
      await u.click({ x: 27, y: 21 });
      await leave(u);
      await tool(u, '3-Point Arc');
      await u.click({ x: 27, y: 21 });
      await u.click({ x: -30, y: -20 });
      await u.click(bulge);
      await leave(u);
      const before = await u.sketch();
      const [arc] = arcs(before);
      const q = onArc(before, arc);
      await dimension(u, q, { x: q.x - 6, y: q.y + 12 }, gap(before, arc.c, arc.a).toFixed(2));
      const [d] = Object.values((await u.sketch()).dimensions);
      await tryValue(u, d.name, Number((d.value * 0.5).toFixed(3)));
      expect(sweep(await u.sketch(), arc)).toBeLessThan(357);
      await honest(u);
    });
  }
});

/** A spline by its points, finished at the check mark. */
const spline = async (u: SketchUser, label: string, pts: Xy[]): Promise<void> => {
  await tool(u, label);
  for (const p of pts) await u.click(p);
  await u.page.locator('.hud-check').click();
  await u.settle();
  await leave(u);
};
const splineOf = (s: Sketch): { id: Id; pts: Id[] } => Object.values(s.curves).find((c) => c.type === 'fitSpline' || c.type === 'controlSpline') as unknown as { id: Id; pts: Id[] };
/** Each control point relative to the first: a spline that moves whole has not changed. */
const splineShape = (s: Sketch): Xy[] => {
  const pts = splineOf(s).pts.map((id) => pointAt(s, id));
  return pts.map((p) => ({ x: p.x - pts[0].x, y: p.y - pts[0].y }));
};

test.describe('CHK2-P1-C: a line dimension leaves a spline or Blend in shape', () => {
  const blends: [Xy[], Xy[]][] = [
    [[{ x: -50, y: 20 }, { x: -10, y: 20 }], [{ x: 10, y: 40 }, { x: 50, y: 40 }]],
    [[{ x: -60, y: -10 }, { x: -20, y: 5 }], [{ x: 5, y: 30 }, { x: 45, y: 20 }]],
  ];
  blends.forEach(([one, two], n) => {
    for (const v of [80, 120, 400, 10]) {
      test(`Blend ${n}: its first line at ${v} leaves the Blend and the other line alone`, async ({ page }) => {
        const u = await start(page);
        await draw(u, 'Line', one);
        await draw(u, 'Line', two);
        const s0 = await u.sketch();
        const [a, b] = lines(s0);
        await tool(u, 'Blend Curve');
        await u.click(onLine(s0, a, 0.95));
        await u.click(onLine(s0, b, 0.05));
        await leave(u);
        const before = await u.sketch();
        const p = onLine(before, a, 0.2);
        await dimension(u, p, { x: p.x + 2, y: p.y - 16 }, gap(before, a.a, a.b).toFixed(3));
        const base = await u.sketch();
        const [d] = Object.values(base.dimensions);
        await setValue(u, d.name, v);
        const s = await u.sketch();
        expect(Object.values(s.dimensions)[0].value).toBeCloseTo(v, 4);
        splineShape(base).forEach((q, i) => sameSpot(splineShape(s)[i], q));
        expect(gap(s, b.a, b.b)).toBeCloseTo(gap(base, b.a, b.b), 4);
        await nothingRed(u);
      });
    }
  });

  const shapes: [string, string][] = [['Fit Point Spline', 'fit'], ['Control Point Spline', 'control']];
  for (const [label, name] of shapes) {
    for (const tie of ['none', 'Tangent', 'Curvature']) {
      for (const v of [120, 400, 10]) {
        test(`a line joined to a ${name} spline, ${tie}, at ${v}: the spline stays as it was`, async ({ page }) => {
          const u = await start(page);
          await draw(u, 'Line', [{ x: -60, y: 20 }, { x: -20, y: 20 }]);
          await spline(u, label, [{ x: -20, y: 20 }, { x: -5, y: 30 }, { x: 10, y: 15 }, { x: 25, y: 30 }, { x: 40, y: 20 }]);
          const s0 = await u.sketch();
          const [l] = lines(s0);
          const sp = splineOf(s0);
          if (tie !== 'none') await pick(u, tie, onLine(s0, l, 0.3), pointAt(s0, sp.pts[name === 'fit' ? 1 : 4]));
          const tied = await u.sketch();
          const q = onLine(tied, l, 0.3);
          await dimension(u, q, { x: q.x, y: q.y + 18 }, '40');
          const base = await u.sketch();
          const [d] = Object.values(base.dimensions);
          await setValue(u, d.name, v);
          const s = await u.sketch();
          expect(Object.values(s.dimensions)[0].value).toBeCloseTo(v, 4);
          expect(gap(s, l.a, l.b)).toBeCloseTo(v, 3);
          splineShape(base).forEach((p, i) => sameSpot(splineShape(s)[i], p));
        });
      }
    }
  }

  for (const v of [400, 4]) {
    test(`a fit spline between two tangent lines: the first at ${v} keeps the spline to size`, async ({ page }) => {
      const u = await start(page);
      await tool(u, 'Line');
      await u.click({ x: -70, y: 10 });
      await u.click({ x: -30, y: 10 });
      await leave(u);
      await spline(u, 'Fit Point Spline', [{ x: -30, y: 10 }, { x: -10, y: 35 }, { x: 10, y: 5 }, { x: 35, y: 25 }]);
      await tool(u, 'Line');
      await u.click({ x: 35, y: 25 });
      await u.click({ x: 65, y: 40 });
      await leave(u);
      const s0 = await u.sketch();
      const sp = splineOf(s0);
      const [one, two] = lines(s0);
      await pick(u, 'Tangent', onLine(s0, one, 0.4), pointAt(s0, sp.pts[1]));
      await pick(u, 'Tangent', onLine(s0, two, 0.5), pointAt(s0, sp.pts[2]));
      const tied = await u.sketch();
      const q = onLine(tied, one, 0.4);
      await dimension(u, q, { x: q.x, y: q.y - 16 }, gap(tied, one.a, one.b).toFixed(3));
      const base = await u.sketch();
      const [d] = Object.values(base.dimensions);
      await setValue(u, d.name, 400);
      await setValue(u, d.name, v);
      const s = await u.sketch();
      const size = (x: Sketch): number => splineOf(x).pts.slice(1).reduce((t, id, i) => t + gap(x, splineOf(x).pts[i], id), 0);
      expect(Math.abs(size(s) - size(base)) / size(base)).toBeLessThan(0.02);
    });
  }
});

test.describe('CHK2-P2-A: a dimension edit holds a free neighbour', () => {
  const chains: Xy[][] = [
    [{ x: -50, y: -10 }, { x: -10, y: 20 }, { x: 30, y: 0 }],
    [{ x: -60, y: 15 }, { x: -25, y: -20 }, { x: 25, y: 12 }, { x: 55, y: -8 }],
    [{ x: -40, y: -30 }, { x: 0, y: 35 }, { x: 45, y: 10 }],
  ];
  chains.forEach((p, n) => {
    for (const which of ['first', 'last', 'middle'] as const) {
      if (which === 'middle' && p.length < 4) continue;
      for (const f of [2, 4, 0.25]) {
        test(`chain ${n}, the ${which} line x${f}: the others keep their lengths`, async ({ page }) => {
          const u = await start(page);
          await draw(u, 'Line', p);
          const s0 = await u.sketch();
          const ls = lines(s0);
          const l = which === 'first' ? ls[0] : which === 'last' ? (ls.at(-1) as Line) : ls[1];
          await dimension(u, onLine(s0, l), sideways(s0, l, 6), gap(s0, l.a, l.b).toFixed(2));
          const base = await u.sketch();
          const [d] = Object.values(base.dimensions);
          const v = Number((d.value * f).toFixed(2));
          await setValue(u, d.name, v);
          const s = await u.sketch();
          expect(gap(s, l.a, l.b)).toBeCloseTo(v, 3);
          for (const o of ls) if (o.id !== l.id) expect(gap(s, o.a, o.b)).toBeCloseTo(gap(base, o.a, o.b), 4);
          await nothingRed(u);
        });
      }
    }
  });

  test('a far end pinned: the neighbour may give way, and the value is met', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', chains[1]);
    const s0 = await u.sketch();
    const ls = lines(s0);
    await pick(u, 'Fix/UnFix', pointAt(s0, ls[0].a));
    await pick(u, 'Fix/UnFix', pointAt(s0, (ls.at(-1) as Line).b));
    await dimension(u, onLine(s0, ls[1]), sideways(s0, ls[1], 6), gap(s0, ls[1].a, ls[1].b).toFixed(2));
    const [d] = Object.values((await u.sketch()).dimensions);
    await setValue(u, d.name, 30);
    const s = await u.sketch();
    expect(gap(s, ls[1].a, ls[1].b)).toBeCloseTo(30, 3);
    sameSpot(pointAt(s, ls[0].a), pointAt(s0, ls[0].a));
    sameSpot(pointAt(s, (ls.at(-1) as Line).b), pointAt(s0, (ls.at(-1) as Line).b));
    await nothingRed(u);
  });

  for (const f of [10, 0.2]) {
    test(`an arc joined by a corner, radius x${f}: the line beyond it keeps its length`, async ({ page }) => {
      const u = await start(page);
      await draw(u, '3-Point Arc', [{ x: -30, y: 0 }, { x: 10, y: 0 }, { x: -10, y: 16 }]);
      const s0 = await u.sketch();
      const [arc] = arcs(s0);
      await tool(u, 'Line');
      await u.click(pointAt(s0, arc.a));
      await u.click({ x: 40, y: 30 });
      await leave(u);
      const before = await u.sketch();
      const [l] = lines(before);
      const q = onArc(before, arc);
      await dimension(u, q, { x: q.x, y: q.y + 14 }, gap(before, arc.c, arc.a).toFixed(2));
      const [d] = Object.values((await u.sketch()).dimensions);
      await setValue(u, d.name, Number((d.value * f).toFixed(2)));
      expect(gap(await u.sketch(), l.a, l.b)).toBeCloseTo(gap(before, l.a, l.b), 4);
    });
  }
});

/** Sides 1 and 2 of a closed triangle dimensioned, 12 mm out, as the recheck did. */
async function triangle(u: SketchUser, t: Xy[], by = 12): Promise<{ before: Sketch; a: { name: string; value: number }; b: { name: string; value: number } }> {
  await tool(u, 'Line');
  for (const p of [...t, t[0]]) await u.click(p);
  await leave(u);
  const s0 = await u.sketch();
  const [one, two] = lines(s0);
  const n = Math.sign(signedArea(s0, lines(s0))) || 1;
  await dimension(u, onLine(s0, one, 0.5), sideways(s0, one, n * by), gap(s0, one.a, one.b).toFixed(2));
  await dimension(u, onLine(s0, two, 0.5), sideways(s0, two, n * by), gap(s0, two.a, two.b).toFixed(2));
  const before = await u.sketch();
  const [a, b] = Object.values(before.dimensions);
  return { before, a, b };
}

test.describe('CHK2-P2-B: a closed loop does not turn over, by any route', () => {
  const triangles: Xy[][] = [
    [{ x: -20, y: -40 }, { x: 50, y: 10 }, { x: -35, y: 35 }],
    [{ x: -41, y: -23 }, { x: 27, y: -16 }, { x: -5, y: 38 }],
    [{ x: -30, y: 30 }, { x: 40, y: 25 }, { x: 5, y: -35 }],
    [{ x: -45, y: 0 }, { x: 30, y: -30 }, { x: 25, y: 35 }],
  ];
  triangles.forEach((t, n) => {
    for (const end of [0.9, 1.1, 0.5]) {
      test(`triangle ${n}, a 100x swing ending at x${end}`, async ({ page }) => {
        test.setTimeout(90_000);
        const u = await start(page);
        const { before, a, b } = await triangle(u, t);
        const ls = lines(before);
        const side = Math.sign(signedArea(before, ls));
        const run: [{ name: string; value: number }, number][] = [[a, 1.5], [a, 2.2], [a, 0.3], [b, 3], [b, 10], [b, 0.1], [a, end], [b, end]];
        for (const [d, f] of run) {
          await tryValue(u, d.name, Number((d.value * f).toFixed(2)));
          const s = await u.sketch();
          expect(Math.sign(signedArea(s, ls)), `after ${d.name} x${f}`).toBe(side);
        }
      });
    }
  });

  test('a quadrilateral through the same swing keeps its side', async ({ page }) => {
    test.setTimeout(90_000);
    const u = await start(page);
    const q = [{ x: -35, y: -25 }, { x: 40, y: -30 }, { x: 45, y: 30 }, { x: -30, y: 35 }];
    await tool(u, 'Line');
    for (const p of [...q, q[0]]) await u.click(p);
    await leave(u);
    const s0 = await u.sketch();
    const ls = lines(s0);
    const [one, two] = ls;
    await dimension(u, onLine(s0, one, 0.5), sideways(s0, one, 6), gap(s0, one.a, one.b).toFixed(2));
    await dimension(u, onLine(s0, two, 0.5), sideways(s0, two, 6), gap(s0, two.a, two.b).toFixed(2));
    const before = await u.sketch();
    const [a, b] = Object.values(before.dimensions);
    const area = (s: Sketch): number => ls.reduce((t, l) => t + pointAt(s, l.a).x * pointAt(s, l.b).y - pointAt(s, l.b).x * pointAt(s, l.a).y, 0);
    const side = Math.sign(area(before));
    for (const [d, f] of [[a, 4], [b, 8], [a, 0.1], [b, 0.1], [a, 1.2], [b, 0.8]] as [typeof a, number][]) {
      await tryValue(u, d.name, Number((d.value * f).toFixed(2)));
      expect(Math.sign(area(await u.sketch()))).toBe(side);
    }
  });
});

test.describe('CHK2-P2-C: geometry on another layer changes nothing here', () => {
  const addLayer = async (u: SketchUser): Promise<void> => {
    await draw(u, 'Center Diameter Circle', [{ x: 70, y: 60 }, { x: 76, y: 60 }]);
    await u.page.locator('[data-action="add-layer"]').click();
    await u.settle();
  };
  for (const f of [10, 0.1]) {
    test(`a return to the first value is exact with a template layer, x${f} on the way`, async ({ page }) => {
      const u = await start(page);
      await addLayer(u);
      const { before, a, b } = await triangle(u, [{ x: -20, y: -40 }, { x: 50, y: 10 }, { x: -35, y: 35 }]);
      await setValue(u, a.name, Number((a.value * f).toFixed(2)));
      await setValue(u, b.name, Number((b.value * 2).toFixed(2)));
      await setValue(u, a.name, a.value);
      await setValue(u, b.name, b.value);
      const s = await u.sketch();
      for (const id of Object.keys(before.points)) sameSpot(pointAt(s, id), pointAt(before, id));
    });
  }

  test('the tangent chain comes back to its first radius with a template layer', async ({ page }) => {
    const u = await start(page);
    await addLayer(u);
    const name = await scurve(u);
    const before = await u.sketch();
    const r = Object.values(before.dimensions)[0].value;
    for (const f of [5, 0.1, 1]) await setValue(u, name, Number((r * f).toFixed(2)));
    const s = await u.sketch();
    for (const id of Object.keys(before.points)) sameSpot(pointAt(s, id), pointAt(before, id));
  });
});

test.describe('CHK2-P2-D: Fillet on what an offset came from', () => {
  for (const r of ['3', '6']) {
    test(`a fillet of ${r} says the link is gone, and Undo brings it back`, async ({ page }) => {
      const u = await start(page);
      await draw(u, '2-Point Rectangle', [{ x: -30, y: -20 }, { x: 30, y: 20 }]);
      await u.tool('Offset');
      await u.click({ x: 0, y: 20 });
      await u.move({ x: 0, y: 30 });
      const d = u.page.locator('.dialog[data-dialog="Offset"]');
      await d.locator('.form-row').filter({ has: page.locator('.form-label:text-is("Distance")') }).locator('input').fill('5 mm');
      await d.locator('.btn.primary').hover();
      await page.keyboard.press('Enter');
      await u.settle();
      const before = await u.sketch();
      expect(Object.values(before.features)).toHaveLength(1);
      await tool(u, 'Fillet');
      await u.click({ x: -30, y: -20 });
      await u.page.keyboard.type(r);
      await u.press('Enter');
      await leave(u);
      expect(Object.values((await u.sketch()).features)).toHaveLength(0);
      expect(await note(u)).toMatch(/link is gone/);
      await u.press('ControlOrMeta+z');
      expect(Object.values((await u.sketch()).features)).toHaveLength(1);
    });
  }
});

test.describe('CHK2-P3', () => {
  test('P3-1: a refusal is not still showing after the next good edit', async ({ page }) => {
    const u = await start(page);
    await draw(u, '2-Point Rectangle', [{ x: -30, y: -20 }, { x: 30, y: 20 }]);
    const s0 = await u.sketch();
    const bottom = lines(s0).find((l) => pointAt(s0, l.a).y < 0 && pointAt(s0, l.b).y < 0) as Line;
    await dimension(u, onLine(s0, bottom), { x: 4, y: -34 }, '60');
    const [d] = Object.values((await u.sketch()).dimensions);
    await setValue(u, d.name, 0.00001);
    expect(await note(u)).toMatch(/not applied/);
    await setValue(u, d.name, 80);
    expect(await note(u)).toBe('');
  });

  for (const undoes of [1, 2]) {
    test(`P3-2: a conflict is as red after ${undoes} undo and redo as before`, async ({ page }) => {
      const u = await start(page);
      await draw(u, '2-Point Rectangle', [{ x: -30, y: -20 }, { x: 30, y: 20 }]);
      const s0 = await u.sketch();
      const ls = lines(s0);
      const bottom = ls.find((l) => pointAt(s0, l.a).y < 0 && pointAt(s0, l.b).y < 0) as Line;
      const right = ls.find((l) => pointAt(s0, l.a).x > 0 && pointAt(s0, l.b).x > 0) as Line;
      await dimension(u, onLine(s0, bottom), { x: 4, y: -34 }, '60');
      await dimension(u, onLine(s0, right), { x: 44, y: 3 }, '40');
      await pick(u, 'Equal', onLine(s0, bottom), onLine(s0, right));
      const red = [...(await u.analysis()).unsatisfied].sort();
      expect(red.length).toBeGreaterThan(1);
      for (let i = 0; i < undoes; i++) await u.press('ControlOrMeta+z');
      for (let i = 0; i < undoes; i++) await u.press('ControlOrMeta+Shift+z');
      expect([...(await u.analysis()).unsatisfied].sort()).toEqual(red);
    });
  }

  for (const [a, b, c] of [[{ x: -55, y: -11 }, { x: -24, y: -1 }, { x: 1, y: 11 }], [{ x: -60, y: 10 }, { x: -30, y: 12 }, { x: -5, y: 13.5 }]]) {
    test(`P3-3: a nearly straight arc from ${a.x},${a.y} does not change the view mid-chain`, async ({ page }) => {
      const u = await start(page);
      const zoom = (): Promise<number> => page.evaluate(() => window.__sketch.view.ppm);
      const was = await zoom();
      await u.press('l');
      await u.click(a);
      await u.click(b);
      await u.drag(b, c, 9);
      expect(await zoom()).toBeCloseTo(was, 6);
      await leave(u);
    });
  }

  test('a line typed long enough to leave the canvas still brings the view out', async ({ page }) => {
    const u = await start(page);
    const zoom = (): Promise<number> => page.evaluate(() => window.__sketch.view.ppm);
    const was = await zoom();
    await draw(u, 'Line', [{ x: 0, y: 5 }, { x: 40, y: 5 }]);
    const s = await u.sketch();
    await dimension(u, onLine(s, lines(s)[0]), { x: 20, y: 20 }, '40');
    await u.press('l');
    await u.click({ x: -30, y: -30 });
    await u.move({ x: 30, y: -30 });
    await page.keyboard.type('1500');
    await u.press('Enter');
    await leave(u);
    expect(await zoom()).toBeLessThan(was);
  });
});

// ---------------------------------------------------------------------------
// The second recheck: continuity, not limits. What an edit can reach by degrees, it reaches.

/** What a dimension measures on the geometry itself, not what it says. */
const measured = (s: Sketch, d: { kind: string; refs: Id[] }): number | null => {
  const ends = d.refs.length === 2 ? d.refs : d.refs.length === 1 && s.curves[d.refs[0]]?.type === 'line' ? [(s.curves[d.refs[0]] as Line).a, (s.curves[d.refs[0]] as Line).b] : null;
  if (d.kind === 'radius') return gap(s, (s.curves[d.refs[0]] as Arc).c, (s.curves[d.refs[0]] as Arc).a);
  if (!ends || !s.points[ends[0]] || !s.points[ends[1]]) return null;
  const [p, q] = ends.map((id) => pointAt(s, id));
  return d.kind === 'horizontal' ? Math.abs(p.x - q.x) : d.kind === 'vertical' ? Math.abs(p.y - q.y) : d.kind === 'distance' ? Math.hypot(p.x - q.x, p.y - q.y) : null;
};

/** The status is true: what reads OK, and every dimension here reads what the geometry measures. */
const honest = async (u: SketchUser): Promise<void> => {
  const s = await u.sketch();
  const a = await u.analysis();
  if (a.unsatisfied.length > 0) return;
  for (const d of Object.values(s.dimensions)) {
    const m = d.driving ? measured(s, d) : null;
    if (m !== null) expect(m, `${d.name} reads ${d.value}`).toBeCloseTo(d.value, 3);
  }
};

const dimensionBetween = async (u: SketchUser, a: Xy, b: Xy, label: Xy, value: string): Promise<void> => {
  await u.press('d');
  await u.click(a);
  await u.click(b);
  await u.click(label);
  await u.page.keyboard.press('ControlOrMeta+a');
  await u.page.keyboard.type(value);
  await u.press('Enter');
  await leave(u);
};

test.describe('CHK3-P1-1: a value on a line with a frozen neighbour', () => {
  for (const tie of ['none', 'Horizontal/Vertical', 'Parallel']) {
    for (const v of [128, 21.36, 60]) {
      test(`joined across layers, ${tie}, at ${v}: the geometry reads what the label reads`, async ({ page }) => {
        const u = await start(page);
        await draw(u, '2-Point Rectangle', [{ x: -40, y: -20 }, { x: 20, y: 20 }]);
        const s0 = await u.sketch();
        const top = lines(s0).find((l) => pointAt(s0, l.a).y > 0 && pointAt(s0, l.b).y > 0) as Line;
        await dimension(u, onLine(s0, top), { x: -10, y: 34 }, '60');
        await page.locator('[data-action="add-layer"]').click();
        await u.settle();
        await draw(u, 'Line', [{ x: 30, y: 30 }, { x: 70, y: 45 }]);
        await draw(u, 'Center Diameter Circle', [{ x: -70, y: 40 }, { x: -63, y: 40 }]);
        await pick(u, 'Coincident', { x: 30, y: 30 }, { x: 20, y: 20 });
        const s1 = await u.sketch();
        const line = lines(s1).at(-1) as Line;
        if (tie === 'Horizontal/Vertical') await pick(u, tie, onLine(s1, line));
        if (tie === 'Parallel') await pick(u, tie, onLine(s1, line), onLine(s1, top));
        const s2 = await u.sketch();
        await dimension(u, onLine(s2, line), { x: 45, y: 62 }, gap(s2, line.a, line.b).toFixed(2));
        const d = Object.values((await u.sketch()).dimensions).at(-1) as { name: string };
        await setValue(u, d.name, v);
        await honest(u);
        expect(Object.values((await u.sketch()).dimensions).at(-1)?.value).toBeCloseTo(v, 4);
      });
    }
  }
});

test.describe('CHK3-P2-1: arcs past a half turn take ordinary edits, and every return', () => {
  const dshape = async (u: SketchUser, r: number, f: number): Promise<{ radius: string; flat: string }> => {
    const x = Math.sqrt(r * r - f * f);
    await draw(u, 'Line', [{ x: -x, y: f }, { x, y: f }]);
    await tool(u, '3-Point Arc');
    await u.click({ x, y: f });
    await u.click({ x: -x, y: f });
    await u.page.keyboard.down('ControlOrMeta');
    await u.click({ x: 0, y: -r });
    await u.page.keyboard.up('ControlOrMeta');
    await leave(u);
    const s = await u.sketch();
    const [l] = lines(s);
    const [a] = arcs(s);
    await pick(u, 'Horizontal/Vertical', onLine(s, l));
    await pick(u, 'Coincident', pointAt(await u.sketch(), a.c), { x: 0, y: 0 });
    const s1 = await u.sketch();
    const q = onArc(s1, a);
    await dimension(u, q, { x: q.x + 12, y: q.y - 12 }, String(r));
    await dimensionBetween(u, onLine(await u.sketch(), l), { x: 0, y: 0 }, { x: r + 14, y: f / 2 }, String(f));
    const ds = Object.values((await u.sketch()).dimensions);
    return { radius: ds[0].name, flat: ds[1].name };
  };
  for (const [r, f] of [[20, 12], [30, 20], [15, 5]]) {
    test(`D-shape r ${r}, flat ${f}, DOF 0: each radius is taken, and so is the start value`, async ({ page }) => {
      const u = await start(page);
      const { radius, flat } = await dshape(u, r, f);
      const before = await u.sketch();
      expect((await u.analysis()).dof).toBe(0);
      const [a] = arcs(before);
      for (const k of [1.1, 1.5, 0.8, 1]) {
        await setValue(u, radius, Number((r * k).toFixed(3)));
        expect(await note(u), `radius x${k}`).toBe('');
        await honest(u);
        expect(gap(await u.sketch(), a.c, a.a)).toBeCloseTo(r * k, 3);
      }
      const s = await u.sketch();
      for (const id of Object.keys(before.points)) sameSpot(pointAt(s, id), pointAt(before, id));
      for (const k of [0.5, 1.2, 1]) {
        await setValue(u, flat, Number((f * k).toFixed(3)));
        expect(await note(u), `flat x${k}`).toBe('');
        await honest(u);
      }
    });
  }

  for (const [g, r] of [[12, 15], [10, 20], [16, 22]]) {
    test(`keyhole, gap ${g}, r ${r}: radius and gap edits are taken, and both come back`, async ({ page }) => {
      const u = await start(page);
      const y = -Math.sqrt(r * r - (g * g) / 4);
      await draw(u, 'Line', [{ x: g / 2, y: 0.3 }, { x: g / 2 + 0.2, y: -40 }, { x: -g / 2, y: -40.4 }, { x: -g / 2 - 0.2, y: 0 }]);
      await tool(u, '3-Point Arc');
      const s0 = await u.sketch();
      const ls = lines(s0);
      await u.click(pointAt(s0, ls[2].b));
      await u.click(pointAt(s0, ls[0].a));
      await u.page.keyboard.down('ControlOrMeta');
      await u.click({ x: 0, y: r - y });
      await u.page.keyboard.up('ControlOrMeta');
      await leave(u);
      for (const l of ls) await pick(u, 'Horizontal/Vertical', onLine(await u.sketch(), l));
      const s1 = await u.sketch();
      const [arc] = arcs(s1);
      await dimension(u, onLine(s1, ls[1]), { x: 3, y: -54 }, String(g));
      const s2 = await u.sketch();
      const q = onArc(s2, arc);
      await dimension(u, q, { x: q.x + 15, y: q.y + 18 }, String(r));
      const base = await u.sketch();
      const [gap0, radius] = Object.values(base.dimensions);
      for (const k of [1.1, 1.5, 0.8, 1]) {
        await setValue(u, radius.name, Number((r * k).toFixed(3)));
        expect(await note(u), `radius x${k}`).toBe('');
        await honest(u);
      }
      for (const k of [0.5, 1.25, 1]) {
        await setValue(u, gap0.name, Number((g * k).toFixed(3)));
        expect(await note(u), `gap x${k}`).toBe('');
        await honest(u);
      }
      expect(sweep(await u.sketch(), arc)).toBeCloseTo(sweep(base, arc), 3);
    });
  }

  for (const sweepStart of [205, 215, 240]) {
    for (const k of [1.25, 0.985]) {
      test(`an arc of ${sweepStart} degrees between fixed lines, radius x${k} and back`, async ({ page }) => {
        const u = await start(page);
        const r = 30;
        const half = (sweepStart * Math.PI) / 360;
        const [ax, ay] = [r * Math.sin(half), r * Math.cos(half)];
        await draw(u, 'Line', [{ x: -ax - 30, y: ay }, { x: -ax, y: ay }]);
        await draw(u, 'Line', [{ x: ax, y: ay }, { x: ax + 30, y: ay }]);
        await tool(u, '3-Point Arc');
        await u.click({ x: ax, y: ay });
        await u.click({ x: -ax, y: ay });
        await u.page.keyboard.down('ControlOrMeta');
        await u.click({ x: 0, y: r > 0 ? -r : r });
        await u.page.keyboard.up('ControlOrMeta');
        await leave(u);
        const s0 = await u.sketch();
        for (const l of lines(s0)) await pick(u, 'Fix/UnFix', onLine(s0, l));
        const [a] = arcs(s0);
        const q = onArc(s0, a);
        await dimension(u, q, { x: q.x + 10, y: q.y - 14 }, gap(s0, a.c, a.a).toFixed(3));
        const base = await u.sketch();
        const [d] = Object.values(base.dimensions);
        await setValue(u, d.name, Number((d.value * k).toFixed(3)));
        await honest(u);
        expect(await note(u)).toBe('');
        await setValue(u, d.name, d.value);
        expect(await note(u)).toBe('');
        expect(sweep(await u.sketch(), a)).toBeCloseTo(sweep(base, a), 3);
      });
    }
  }
});

test.describe('CHK3-P1-2: a value between a spline`s ends moves the ends and leaves the rest', () => {
  const shapes: [string, string][] = [['Fit Point Spline', 'fit'], ['Control Point Spline', 'control']];
  for (const [label, name] of shapes) {
    for (const v of [45, 30, 90, 120]) {
      test(`${name}: joints ${v} apart, interior points stay, the lines stay straight along themselves`, async ({ page }) => {
        const u = await start(page);
        await draw(u, 'Line', [{ x: -60, y: 0.5 }, { x: -20, y: 0.5 }]);
        await spline(u, label, [{ x: -20, y: 0.5 }, { x: 0, y: 20 }, { x: 20, y: -10 }, { x: 40, y: 0.5 }]);
        await tool(u, 'Line');
        await u.click({ x: 40, y: 0.5 });
        await u.page.keyboard.down('ControlOrMeta');
        await u.click({ x: 80, y: 10 });
        await u.page.keyboard.up('ControlOrMeta');
        await leave(u);
        const s0 = await u.sketch();
        const sp = splineOf(s0);
        const [j0, j1] = [sp.pts[0], sp.pts[sp.pts.length - 1]];
        await dimensionBetween(u, pointAt(s0, j0), pointAt(s0, j1), { x: 10, y: 42 }, '60');
        const base = await u.sketch();
        const d = Object.values(base.dimensions)[0];
        await setValue(u, d.name, v);
        const s = await u.sketch();
        await honest(u);
        for (const id of sp.pts.slice(1, -1)) sameSpot(pointAt(s, id), pointAt(base, id));
        for (const l of lines(base)) expect(gap(s, l.a, l.b)).toBeCloseTo(gap(base, l.a, l.b), 3);
      });
    }

    test(`${name}: a rectangle with a spline top goes out and comes back to its start width`, async ({ page }) => {
      const u = await start(page);
      await tool(u, 'Line');
      await u.click({ x: -40, y: 20 });
      await u.click({ x: -40, y: -20 });
      await u.click({ x: 40, y: -20 });
      await u.click({ x: 40, y: 20 });
      await leave(u);
      await spline(u, label, [{ x: 40, y: 20 }, { x: 15, y: 35 }, { x: -15, y: 10 }, { x: -40, y: 20 }]);
      const s0 = await u.sketch();
      const bottom = lines(s0)[1];
      await dimension(u, onLine(s0, bottom), { x: 4, y: -34 }, '80');
      const base = await u.sketch();
      const [d] = Object.values(base.dimensions);
      for (const v of [100, 120, 160, 60, 40, 80]) {
        await setValue(u, d.name, v);
        expect(await note(u), `at ${v}`).toBe('');
        await honest(u);
      }
      const s = await u.sketch();
      for (const id of Object.keys(base.points)) sameSpot(pointAt(s, id), pointAt(base, id));
    });
  }
});

test.describe('CHK3-P2-3: a tail goes with its joint, in an anchored chain too', () => {
  const chains: [string, Xy[]][] = [
    ['from the origin', [{ x: 0, y: 0 }, { x: 50, y: 0.01 }, { x: 80, y: 30 }]],
    ['fresh', [{ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 90, y: 10 }]],
    ['three lines', [{ x: 0, y: 0 }, { x: 30, y: 20 }, { x: 60, y: 5 }, { x: 90, y: 30 }]],
  ];
  for (const [name, p] of chains) {
    for (const f of [1.25, 2, 0.5]) {
      for (const anchor of ['origin', 'Fix'] as const) {
        test(`${name}, anchored by ${anchor}, line 1 x${f}: what follows moves whole`, async ({ page }) => {
          const u = await start(page);
          const shifted = anchor === 'Fix' ? p.map((q) => ({ x: q.x - 40, y: q.y + 12 })) : p;
          await tool(u, 'Line');
          await u.click(shifted[0]);
          await u.page.keyboard.down('ControlOrMeta');
          for (const q of shifted.slice(1)) await u.click(q);
          await u.page.keyboard.up('ControlOrMeta');
          await leave(u);
          const s0 = await u.sketch();
          const ls = lines(s0);
          if (anchor === 'Fix') await pick(u, 'Fix/UnFix', pointAt(s0, ls[0].a));
          await dimension(u, onLine(s0, ls[0]), sideways(s0, ls[0], 6), gap(s0, ls[0].a, ls[0].b).toFixed(2));
          const base = await u.sketch();
          const [d] = Object.values(base.dimensions);
          const v = Number((d.value * f).toFixed(2));
          await setValue(u, d.name, v);
          const s = await u.sketch();
          sameSpot(pointAt(s, ls[0].a), pointAt(base, ls[0].a));
          expect(gap(s, ls[0].a, ls[0].b)).toBeCloseTo(v, 3);
          for (const l of ls.slice(1)) {
            const dir = (x: Sketch): Xy => ({ x: pointAt(x, l.b).x - pointAt(x, l.a).x, y: pointAt(x, l.b).y - pointAt(x, l.a).y });
            sameSpot(dir(s), dir(base));
          }
          await nothingRed(u);
        });
      }
    }
  }

  for (const w of [80, 120, 40]) {
    test(`a tail on an anchored rectangle at width ${w} does not swing`, async ({ page }) => {
      const u = await start(page);
      await tool(u, '2-Point Rectangle');
      await u.click({ x: 0, y: 0 });
      await u.click({ x: 60, y: 40 });
      await leave(u);
      await tool(u, 'Line');
      await u.click({ x: 60, y: 40 });
      await u.page.keyboard.down('ControlOrMeta');
      await u.click({ x: 85, y: 60 });
      await u.page.keyboard.up('ControlOrMeta');
      await leave(u);
      const s0 = await u.sketch();
      const bottom = lines(s0).find((l) => Math.abs(pointAt(s0, l.a).y) < 1e-6 && Math.abs(pointAt(s0, l.b).y) < 1e-6) as Line;
      const tail = lines(s0).at(-1) as Line;
      await dimension(u, onLine(s0, bottom), { x: 24, y: -14 }, '60');
      const [d] = Object.values((await u.sketch()).dimensions);
      await setValue(u, d.name, w);
      const s = await u.sketch();
      const dir = (x: Sketch): Xy => ({ x: pointAt(x, tail.b).x - pointAt(x, tail.a).x, y: pointAt(x, tail.b).y - pointAt(x, tail.a).y });
      sameSpot(dir(s), dir(s0));
    });
  }

  test('a tail whose far end is fixed gives way, and the value is met', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: -20, y: 10 }, { x: 30, y: 12 }, { x: 60, y: 42 }]);
    const s0 = await u.sketch();
    const [one, two] = lines(s0);
    await pick(u, 'Fix/UnFix', pointAt(s0, one.a));
    await pick(u, 'Fix/UnFix', pointAt(s0, two.b));
    await dimension(u, onLine(s0, one), sideways(s0, one, 6), gap(s0, one.a, one.b).toFixed(2));
    const [d] = Object.values((await u.sketch()).dimensions);
    await setValue(u, d.name, 70);
    const s = await u.sketch();
    expect(Object.values(s.dimensions)[0].value).toBeCloseTo(70, 6);
    await honest(u);
    sameSpot(pointAt(s, two.b), pointAt(s0, two.b));
    await nothingRed(u);
  });

  test('a tail tied to something else by Parallel is not a tail', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: -40, y: 30 }, { x: 40, y: 34 }]);
    await draw(u, 'Line', [{ x: -40, y: -10 }, { x: 0, y: -8 }, { x: 40, y: 20 }]);
    const s0 = await u.sketch();
    const [ref, one, two] = lines(s0);
    await pick(u, 'Parallel', onLine(s0, ref), onLine(s0, two));
    await pick(u, 'Fix/UnFix', pointAt(await u.sketch(), one.a));
    await dimension(u, onLine(s0, one), sideways(s0, one, 6), gap(await u.sketch(), one.a, one.b).toFixed(2));
    const [d] = Object.values((await u.sketch()).dimensions);
    await setValue(u, d.name, d.value * 1.5);
    await honest(u);
    await nothingRed(u);
  });
});

test.describe('a free line to a polygon vertex', () => {
  for (const at of [{ x: -37, y: 11 }, { x: 30, y: -30 }]) {
    for (const lineFirst of [true, false]) {
      test(`polygon at ${at.x},${at.y}: the line moves whole, ${lineFirst ? 'line' : 'vertex'} first`, async ({ page }) => {
        const u = await start(page);
        await draw(u, 'Circumscribed Polygon', [at, { x: at.x + 15, y: at.y + 8 }]);
        await u.press('Enter');
        await leave(u);
        await draw(u, 'Line', [{ x: 40, y: 45 }, { x: 72, y: 60 }]);
        const before = await u.sketch();
        const free = lines(before).at(-1) as Line;
        const edge = lines(before).find((l) => l.lineType === 'normal') as Line;
        const picks = [pointAt(before, free.b), pointAt(before, edge.a)];
        await pick(u, 'Coincident', ...(lineFirst ? picks : picks.reverse()));
        const s = await u.sketch();
        sameSizes(s, before);
        sameSpot(pointAt(s, free.b), pointAt(before, edge.a));
        await nothingRed(u);
      });
    }
  }
});

test.describe('a tight trapezoid takes a value that needs more than one corner to move', () => {
  for (const f of [0.56, 0.58]) {
    test(`bottom x${f}`, async ({ page }) => {
      const u = await start(page);
      await tool(u, 'Line');
      for (const p of [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 60, y: 40 }, { x: 20, y: 40 }, { x: 0, y: 0 }]) await u.click(p);
      await leave(u);
      await dimension(u, { x: 40, y: 0 }, { x: 40, y: -12 }, '80');
      await dimension(u, { x: 40, y: 40 }, { x: 40, y: 52 }, '40');
      await dimensionBetween(u, { x: 70, y: 20 }, { x: 40, y: 0 }, { x: 64, y: 6 }, '60');
      await dimensionBetween(u, { x: 10, y: 20 }, { x: 40, y: 0 }, { x: 16, y: 6 }, '60');
      const [d] = Object.values((await u.sketch()).dimensions);
      await setValue(u, d.name, Number((80 * f).toFixed(2)));
      expect(await note(u)).toBe('');
      await honest(u);
      expect(Object.values((await u.sketch()).dimensions)[0].value).toBeCloseTo(80 * f, 1);
    });
  }
});

/** The check's mixed scene, in its order: rectangle, chain, free line, slot, polygon, and the rest around them. */
async function mixedScene(u: SketchUser, n: number): Promise<{ free: Line; poly: Line[] }> {
  const j = (x: number, y: number, k = 0): Xy => ({ x: x + ((n * 7 + k * 3) % 5) * 0.4 - 0.8, y: y + ((n * 3 + k * 5) % 5) * 0.4 - 0.8 });
  const added = async (make: () => Promise<void>): Promise<Id[]> => {
    const was = await u.sketch();
    await make();
    await leave(u);
    return Object.keys((await u.sketch()).curves).filter((id) => !was.curves[id]);
  };
  await added(() => draw(u, '2-Point Rectangle', [j(-113, 31, 1), j(-69, 63, 2)]));
  await added(() => draw(u, 'Line', [j(-52, 29, 3), j(-29, 48, 4), j(-7, 33, 5), j(13, 58, 6)]));
  const [freeId] = await added(() => draw(u, 'Line', [j(30, 34, 7), j(64, 53, 8)]));
  await added(() => draw(u, 'Center To Center Slot', [j(-112, 6, 9), j(-79, 13, 10), j(-76, 3, 11)]));
  const poly = await added(async () => {
    await draw(u, 'Inscribed Polygon', [j(-44, 6, 12), j(-30, 11, 13)]);
    await u.press('Enter');
  });
  await added(() => draw(u, 'Center Diameter Circle', [j(1, 5, 14), j(9, 13, 15)]));
  await added(() => draw(u, '3-Point Arc', [j(28, 18, 16), j(29, -11, 17), j(21, 5, 18)]));
  const [p1, p2, p3] = [j(44, -9, 19), j(82, -12, 20), j(79, 19, 21)];
  await added(async () => {
    await draw(u, 'Line', [p1, p2]);
    await tool(u, 'Line');
    await u.click(p2);
    await u.page.mouse.move(0, 0);
    await u.click(p3);
    await leave(u);
    await tool(u, '3-Point Arc');
    await u.click(p3);
    await u.click(p1);
    await u.page.keyboard.down('ControlOrMeta');
    await u.click({ x: (p1.x + p3.x) / 2 - 7, y: (p1.y + p3.y) / 2 + 11 });
    await u.page.keyboard.up('ControlOrMeta');
  });
  await added(() => draw(u, '2-Point Rectangle', [j(-112, -71, 22), j(-71, -31, 23)]));
  await added(() => draw(u, 'Center Diameter Circle', [j(92, 56, 24), j(99, 60, 25)]));
  await added(() => draw(u, 'Line', [j(84, -71, 26), j(106, -55, 27)]));
  const s = await u.sketch();
  return { free: s.curves[freeId] as Line, poly: poly.map((id) => s.curves[id]).filter((c): c is Line => c.type === 'line' && c.lineType === 'normal') };
}

test.describe('a free line to a polygon vertex in the mixed scene', () => {
  for (const n of [0, 1, 2, 3]) {
    for (const vertexFirst of [true, false]) {
      test(`layout ${n}, ${vertexFirst ? 'vertex' : 'line end'} first: the line moves whole and nothing changes size`, async ({ page }) => {
        test.setTimeout(90_000);
        const u = await start(page);
        const { free, poly } = await mixedScene(u, n);
        const before = await u.sketch();
        const picks = [pointAt(before, poly[0].a), pointAt(before, free.b)];
        await pick(u, 'Coincident', ...(vertexFirst ? picks : picks.reverse()));
        const s = await u.sketch();
        expect(Object.values(s.constraints).length).toBe(Object.values(before.constraints).length + 1);
        sameSizes(s, before);
        sameSpot(pointAt(s, free.b), pointAt(before, poly[0].a));
        await nothingRed(u);
      });
    }
  }
});

test.describe('CHK3-P1-3: a seat that flips an arc it is not about is no seat', () => {
  const stadiums: number[][][] = [
    [[-29.81, 11.01], [31.4, 13.05], [-28.87, -11.46], [31.7, -10.14], [-43.83, 0.28], [45.93, 1.52]],
    [[-31, 12.5], [29.5, 10.8], [-30.2, -13], [30.8, -11.2], [-45, -1], [44.2, 0.4]],
    [[-28, 10.5], [32.5, 12], [-29.5, -10], [32, -12.5], [-42.5, 1.2], [46.5, -1]],
  ];
  stadiums.forEach(([a, b, c, e, ml, mr], n) => {
    test(`rough stadium ${n}: Tangent on the left leaves the right arc's sweep on its side`, async ({ page }) => {
      const u = await start(page);
      const at = ([x, y]: number[]): Xy => ({ x, y });
      await draw(u, 'Line', [at(a), at(b)]);
      await draw(u, 'Line', [at(c), at(e)]);
      await tool(u, '3-Point Arc');
      await u.click(at(a));
      await u.click(at(c));
      await u.page.keyboard.down('ControlOrMeta');
      await u.click(at(ml));
      await u.page.keyboard.up('ControlOrMeta');
      await leave(u);
      await tool(u, '3-Point Arc');
      await u.click(at(b));
      await u.click(at(e));
      await u.page.keyboard.down('ControlOrMeta');
      await u.click(at(mr));
      await u.page.keyboard.up('ControlOrMeta');
      await leave(u);
      const s0 = await u.sketch();
      const [left, right] = arcs(s0);
      const [one, two] = lines(s0);
      const was = sweep(s0, right);
      await pick(u, 'Tangent', onArc(s0, left), onLine(s0, one));
      const s1 = await u.sketch();
      await pick(u, 'Tangent', onArc(s1, left), onLine(s1, two));
      const s = await u.sketch();
      expect((sweep(s, right) - 180) * (was - 180), 'stays on its side of a half turn').toBeGreaterThan(0);
    });
  });
});

test('CHK3-P3-2: no note about radii when every value is back at its start', async ({ page }) => {
  const u = await start(page);
  await tool(u, 'Three Point Arc Slot');
  await u.page.keyboard.down('ControlOrMeta');
  for (const p of [{ x: -40, y: 0 }, { x: 40, y: 0 }, { x: 0, y: -44 }, { x: 0, y: -36 }]) await u.click(p);
  await u.page.keyboard.up('ControlOrMeta');
  await leave(u);
  const s0 = await u.sketch();
  const big = arcs(s0).sort((p, q) => gap(s0, q.c, q.a) - gap(s0, p.c, p.a))[0];
  const q = onArc(s0, big);
  await dimension(u, q, { x: q.x + 10, y: q.y - 12 }, gap(s0, big.c, big.a).toFixed(2));
  const [d] = Object.values((await u.sketch()).dimensions);
  for (const k of [1.25, 1.5, 0.8, 2]) await setValue(u, d.name, Number((d.value * k).toFixed(3)));
  // As read off the screen, which is near the start value and not always on it.
  await setValue(u, d.name, Number((d.value * 1.002).toFixed(2)));
  expect(await note(u)).toBe('');
});

// ---------------------------------------------------------------------------
// What the fourth check found, in the shapes people draw. The harness behind these ran every checker
// sweep on each build: docs/AUDIT.md, "Closed in the third recheck round".

const arc3 = async (u: SketchUser, a: Xy, b: Xy, through: Xy): Promise<void> => {
  await tool(u, '3-Point Arc');
  await u.click(a);
  await u.click(b);
  await u.page.keyboard.down('ControlOrMeta');
  await u.click(through);
  await u.page.keyboard.up('ControlOrMeta');
  await leave(u);
};

const outline = async (u: SketchUser, c: Xy[], left: Xy, right: Xy): Promise<void> => {
  await draw(u, 'Line', [c[0], c[1]]);
  await draw(u, 'Line', [c[3], c[2]]);
  await arc3(u, c[0], c[3], left);
  await arc3(u, c[1], c[2], right);
};

const tangentAll = async (u: SketchUser): Promise<void> => {
  const s = await u.sketch();
  for (const a of arcs(s)) for (const l of lines(s)) {
    const now = await u.sketch();
    await pick(u, 'Tangent', onArc(now, now.curves[a.id] as Arc), onLine(now, now.curves[l.id] as Line, 0.5));
  }
};

const furthest = (a: Sketch, b: Sketch): number => Math.max(...Object.keys(a.points).map((id) => (b.points[id] ? gap2(a, b, id) : 0)));
const gap2 = (a: Sketch, b: Sketch, id: Id): number => Math.hypot(a.points[id].x - b.points[id].x, a.points[id].y - b.points[id].y);

test.describe('CHK4-R1: tangents on a rough outline are a small move', () => {
  const jig = (seed: number, i: number): number => (seed ? ((seed * 37 + i * 53) % 29) / 10 - 1.4 : 0);
  for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    test(`a link, seed ${seed}`, async ({ page }) => {
      const u = await start(page);
      const c = [{ x: -30 + jig(seed, 1), y: 20 + jig(seed, 2) }, { x: 30 + jig(seed, 3), y: 10 + jig(seed, 4) }, { x: 30 + jig(seed, 5), y: -10 + jig(seed, 6) }, { x: -30 + jig(seed, 7), y: -20 + jig(seed, 8) }];
      await outline(u, c, { x: -52, y: jig(seed, 9) }, { x: 42, y: jig(seed, 10) });
      const was = await u.sketch();
      await tangentAll(u);
      const s = await u.sketch();
      for (const l of lines(was)) expect(gap(s, l.a, l.b)).toBeGreaterThan(gap(was, l.a, l.b) * 0.9);
      expect(furthest(was, s)).toBeLessThan(8);
      await nothingRed(u);
    });
  }
  test('a stadium', async ({ page }) => {
    const u = await start(page);
    await outline(u, [{ x: -31, y: 13 }, { x: 29, y: 11 }, { x: 31, y: -13 }, { x: -29, y: -11 }], { x: -43, y: 1 }, { x: 43, y: -1 });
    const was = await u.sketch();
    await tangentAll(u);
    const s = await u.sketch();
    for (const l of lines(was)) expect(gap(s, l.a, l.b)).toBeGreaterThan(gap(was, l.a, l.b) * 0.9);
    expect(furthest(was, s)).toBeLessThan(8);
    await nothingRed(u);
  });
});

/** A 2-Point Rectangle from the origin to (60, 40), and its top dimensioned 60. */
const anchored = async (u: SketchUser): Promise<{ top: Line; right: Line; d: string }> => {
  await tool(u, '2-Point Rectangle');
  await u.click({ x: 0, y: 0 });
  await u.click({ x: 60, y: 40 });
  await leave(u);
  const s = await u.sketch();
  const top = lines(s).slice().sort((p, q) => pointAt(s, q.a).y + pointAt(s, q.b).y - pointAt(s, p.a).y - pointAt(s, p.b).y)[0];
  const right = lines(s).slice().sort((p, q) => pointAt(s, q.a).x + pointAt(s, q.b).x - pointAt(s, p.a).x - pointAt(s, p.b).x)[0];
  await dimension(u, onLine(s, top), { x: 30, y: 52 }, '60');
  return { top, right, d: Object.values((await u.sketch()).dimensions)[0].name };
};

/** A run of lines, the given ends snapped onto what is there and the rest placed free. */
const lineFrom = async (u: SketchUser, snapped: Xy, free: Xy[], back?: Xy): Promise<Line[]> => {
  const was = lines(await u.sketch()).map((l) => l.id);
  await tool(u, 'Line');
  await u.click(snapped);
  await u.page.keyboard.down('ControlOrMeta');
  for (const p of free) await u.click(p);
  await u.page.keyboard.up('ControlOrMeta');
  if (back) await u.click(back);
  await leave(u);
  return lines(await u.sketch()).filter((l) => !was.includes(l.id));
};

test.describe('CHK4-R2: a shape on two points keeps its lengths', () => {
  for (const v of [80, 90, 120, 200]) {
    test(`an ear with the width at ${v}`, async ({ page }) => {
      const u = await start(page);
      const { d } = await anchored(u);
      const ear = await lineFrom(u, { x: 60, y: 40 }, [{ x: 90, y: 20 }], { x: 60, y: 0 });
      const was = await u.sketch();
      await setValue(u, d, v);
      const s = await u.sketch();
      for (const l of ear) expect(gap(s, l.a, l.b)).toBeCloseTo(gap(was, l.a, l.b), 4);
      expect(pointAt(s, ear[0].b).x).toBeCloseTo(v + 30, 4);
      await nothingRed(u);
    });
  }
  for (const v of [60, 20, 4]) {
    test(`a roof with the height at ${v}`, async ({ page }) => {
      const u = await start(page);
      const { right } = await anchored(u);
      const s0 = await u.sketch();
      await dimension(u, onLine(s0, right), { x: 72, y: 20 }, '40');
      const roof = await lineFrom(u, { x: 0, y: 40 }, [{ x: 30, y: 65 }], { x: 60, y: 40 });
      const was = await u.sketch();
      const h = Object.values(was.dimensions)[1].name;
      await setValue(u, h, v);
      const s = await u.sketch();
      for (const l of roof) expect(gap(s, l.a, l.b)).toBeCloseTo(gap(was, l.a, l.b), 4);
      expect(pointAt(s, roof[0].b).y).toBeGreaterThan(v);
      await nothingRed(u);
    });
  }
  test('an ear on a rectangle nothing anchors', async ({ page }) => {
    const u = await start(page);
    await draw(u, '2-Point Rectangle', [{ x: -30, y: -20 }, { x: 30, y: 20 }]);
    const s0 = await u.sketch();
    const top = lines(s0).slice().sort((p, q) => pointAt(s0, q.a).y - pointAt(s0, p.a).y)[0];
    await dimension(u, onLine(s0, top), { x: 0, y: 32 }, '60');
    const ear = await lineFrom(u, { x: 30, y: 20 }, [{ x: 60, y: 0 }], { x: 30, y: -20 });
    const was = await u.sketch();
    await setValue(u, Object.values(was.dimensions)[0].name, 120);
    const s = await u.sketch();
    for (const l of ear) expect(gap(s, l.a, l.b)).toBeCloseTo(gap(was, l.a, l.b), 4);
    await nothingRed(u);
  });
});

test.describe('CHK4-R3, R4: what hangs off one point goes with it, whole', () => {
  for (const v of [80, 120]) {
    test(`a tail with its own dimension, width ${v}: the height stays`, async ({ page }) => {
      const u = await start(page);
      const { right, d } = await anchored(u);
      const [tail] = await lineFrom(u, { x: 60, y: 40 }, [{ x: 85, y: 60 }]);
      const s0 = await u.sketch();
      await dimension(u, onLine(s0, tail), { x: 66, y: 58 }, gap(s0, tail.a, tail.b).toFixed(2));
      const was = await u.sketch();
      await setValue(u, d, v);
      const s = await u.sketch();
      expect(gap(s, right.a, right.b)).toBeCloseTo(40, 4);
      sameSizes(s, was, [tail.id]);
      await nothingRed(u);
    });
  }
  test('a triangle on a corner goes straight to 120', async ({ page }) => {
    const u = await start(page);
    const { d } = await anchored(u);
    const tri = await lineFrom(u, { x: 60, y: 40 }, [{ x: 85, y: 60 }, { x: 100, y: 30 }], { x: 60, y: 40 });
    const was = await u.sketch();
    await setValue(u, d, 120);
    const s = await u.sketch();
    sameSizes(s, was, tri.map((l) => l.id));
    await nothingRed(u);
  });
  test('a triangle on the end of a single line', async ({ page }) => {
    const u = await start(page);
    const tri = await lineFrom(u, { x: 0, y: 0 }, [{ x: 60, y: 0.01 }, { x: 90, y: 20 }, { x: 80, y: -20 }], { x: 60, y: 0.01 });
    const s0 = await u.sketch();
    await dimension(u, onLine(s0, tri[0]), { x: 25, y: -12 }, '60');
    const was = await u.sketch();
    await setValue(u, Object.values(was.dimensions)[0].name, 120);
    const s = await u.sketch();
    sameSizes(s, was, tri.slice(1).map((l) => l.id));
    await nothingRed(u);
  });
});

test.describe('CHK4-R5: a degree 1 spline is straight between its points', () => {
  test('Offset stays the distance from each leg', async ({ page }) => {
    const u = await start(page);
    const pts = [{ x: -40, y: 0 }, { x: -10, y: 30 }, { x: 20, y: -10 }, { x: 50, y: 20 }];
    await tool(u, 'Control Point Spline');
    await u.page.locator('.palette-row select').first().selectOption('1');
    await u.settle();
    await u.page.keyboard.down('ControlOrMeta');
    for (const p of pts) await u.click(p);
    await u.page.keyboard.up('ControlOrMeta');
    await u.press('Enter');
    await leave(u);
    const s0 = await u.sketch();
    expect(Object.values(s0.curves).find((c) => c.type === 'controlSpline')).toMatchObject({ degree: 1 });
    await u.tool('Offset');
    await u.settle();
    await u.click({ x: -25, y: 15 });
    await u.settle();
    await u.page.keyboard.press('ControlOrMeta+a');
    await u.page.keyboard.type('5');
    await u.page.keyboard.press('Tab');
    await u.settle();
    await u.page.locator('[data-dialog="Offset"] .btn.primary').click();
    await u.settle();
    await leave(u);
    const s = await u.sketch();
    const out = lines(s).filter((l) => l.derivedFrom);
    expect(out.length).toBe(3);
    out.forEach((l, i) => {
      const [p, q] = [pts[i], pts[i + 1]];
      const n = Math.hypot(q.x - p.x, q.y - p.y);
      const off = (r: Xy): number => Math.abs((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / n;
      expect(off(pointAt(s, l.a))).toBeCloseTo(5, 3);
      expect(off(pointAt(s, l.b))).toBeCloseTo(5, 3);
    });
  });
});

test.describe('CHK4-R6: the status bar fits the window', () => {
  test('at 360 px the bar stays inside the window', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await start(page);
    const overflow = await page.locator('.statusbar').evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
  for (const width of [1100, 865, 700, 560]) {
    test(`at ${width} px the bar stays inside and Min Distance can be read`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      const u = await start(page);
      await draw(u, 'Line', [{ x: -12, y: 10 }, { x: 8, y: 10 }]);
      await draw(u, 'Line', [{ x: -12, y: -30 }, { x: 8, y: -30 }]);
      await u.click({ x: -2, y: 10 });
      await u.page.keyboard.down('Shift');
      await u.click({ x: -2, y: -30 });
      await u.page.keyboard.up('Shift');
      const bar = await page.locator('.statusbar').boundingBox();
      const reading = await page.locator('.status-measure').boundingBox();
      expect(bar?.width).toBeLessThanOrEqual(width);
      expect(await page.locator('.status-measure').textContent()).toContain('Min Distance');
      expect((reading?.x ?? 0) + (reading?.width ?? 0)).toBeLessThanOrEqual(width);
      expect(await page.locator('.status-measure').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    });
  }
});

test.describe('CHK4: ordinary shapes through a value and back', () => {
  const shapes: [string, (u: SketchUser) => Promise<void>][] = [
    ['a D', async (u) => {
      await draw(u, 'Line', [{ x: -16, y: 12 }, { x: 16, y: 12 }]);
      await arc3(u, { x: 16, y: 12 }, { x: -16, y: 12 }, { x: 0, y: -20 });
    }],
    ['a keyhole', async (u) => {
      await lineFrom(u, { x: 6, y: 0 }, [{ x: 6, y: -40 }, { x: -6, y: -40 }, { x: -6, y: 0 }]);
      await arc3(u, { x: -6, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 28 });
    }],
    ['a teardrop', async (u) => {
      await lineFrom(u, { x: -22, y: 8 }, [{ x: 0, y: 50 }, { x: 22, y: 8 }]);
      await arc3(u, { x: 22, y: 8 }, { x: -22, y: 8 }, { x: 0, y: -22 });
    }],
    ['a flag', async (u) => {
      await draw(u, '2-Point Rectangle', [{ x: -30, y: 10 }, { x: 20, y: 40 }]);
      await lineFrom(u, { x: -30, y: 10 }, [{ x: -30, y: -40 }]);
    }],
    ['a chain', async (u) => {
      await lineFrom(u, { x: -60, y: -20 }, [{ x: -30, y: 10 }, { x: -5, y: -5 }, { x: 25, y: 18 }, { x: 55, y: 0 }]);
    }],
    ['a gear tooth', async (u) => {
      await lineFrom(u, { x: -40, y: 0 }, [{ x: -22, y: 0.01 }, { x: -14, y: 18 }, { x: 14, y: 18.01 }, { x: 22, y: 0.02 }, { x: 40, y: 0.03 }, { x: 40.01, y: -30 }, { x: -40.01, y: -30.01 }], { x: -40, y: 0 });
    }],
    ['a bracket', async (u) => {
      await lineFrom(u, { x: -40, y: -30 }, [{ x: 40, y: -30.01 }, { x: 40.01, y: -10 }, { x: -10, y: -10.01 }, { x: -10.01, y: 40 }, { x: -40, y: 40.01 }], { x: -40, y: -30 });
    }],
    ['a slot chain', async (u) => {
      await outline(u, [{ x: -40, y: 9 }, { x: -10, y: 9.5 }, { x: -10.5, y: -9 }, { x: -40, y: -9.5 }], { x: -49, y: 0 }, { x: -1, y: 0 });
      await lineFrom(u, { x: -10.5, y: -9 }, [{ x: 30, y: -20 }, { x: 60, y: 5 }]);
    }],
  ];
  for (const [name, drawIt] of shapes) {
    test(`${name}: its first line to 0.7, 1.6 and back`, async ({ page }) => {
      const u = await start(page);
      await drawIt(u);
      const s0 = await u.sketch();
      const [l] = lines(s0);
      const size = gap(s0, l.a, l.b);
      const [p, q] = [pointAt(s0, l.a), pointAt(s0, l.b)];
      await dimension(u, onLine(s0, l), { x: (p.x + q.x) / 2 + ((q.y - p.y) / size) * 6, y: (p.y + q.y) / 2 - ((q.x - p.x) / size) * 6 }, size.toFixed(2));
      const was = await u.sketch();
      const [d] = Object.values(was.dimensions);
      for (const f of [0.7, 1.6]) {
        await setValue(u, d.name, Number((d.value * f).toFixed(2)));
        expect(await note(u)).not.toContain('not applied');
        await honest(u);
        await setValue(u, d.name, d.value);
        const back = await u.sketch();
        for (const id of Object.keys(was.points)) sameSpot(pointAt(back, id), pointAt(was, id));
      }
    });
  }
});

test.describe('CHK5: what the fourth check found', () => {
  const box = async (u: SketchUser): Promise<{ w: string; h: string }> => {
    await tool(u, '2-Point Rectangle');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 80, y: 40 });
    await leave(u);
    const s = await u.sketch();
    const [bottom] = lines(s).filter((l) => Math.abs(pointAt(s, l.a).y) + Math.abs(pointAt(s, l.b).y) < 1e-6);
    const [right] = lines(s).filter((l) => Math.abs(pointAt(s, l.a).x - 80) + Math.abs(pointAt(s, l.b).x - 80) < 1e-6);
    await dimension(u, onLine(s, bottom), { x: 40, y: -10 }, '80');
    await dimension(u, onLine(s, right), { x: 92, y: 20 }, '40');
    const names = Object.values((await u.sketch()).dimensions).map((d) => d.name);
    return { w: names[0], h: names[1] };
  };
  const fillet = async (u: SketchUser, a: Xy, b: Xy, r: string): Promise<void> => {
    await tool(u, 'Fillet');
    await u.click(a);
    await u.click(b);
    await u.settle();
    await u.page.keyboard.press('ControlOrMeta+a');
    await u.page.keyboard.type(r);
    await u.press('Enter');
    await u.press('Enter');
    await leave(u);
  };

  for (const at of [5, 30]) {
    test(`F1: a Fillet with its picks ${at} from the corner keeps the long sides`, async ({ page }) => {
      const u = await start(page);
      await box(u);
      await fillet(u, { x: 80 - at, y: 0 }, { x: 80, y: at }, '6');
      const s = await u.sketch();
      const sizes2 = lines(s).map((l) => gap(s, l.a, l.b)).sort((p, q) => p - q);
      expect(sizes2[0]).toBeCloseTo(34, 3);
      expect(sizes2[1]).toBeCloseTo(40, 3);
      expect(sizes2[2]).toBeCloseTo(74, 3);
      expect(sizes2[3]).toBeCloseTo(80, 3);
    });
  }

  test('F2: a dimension a Fillet takes leaves what used it as it was, and its name stays unused', async ({ page }) => {
    const u = await start(page);
    const { w, h } = await box(u);
    await draw(u, 'Line', [{ x: -40, y: 60 }, { x: 0, y: 60 }]);
    const s0 = await u.sketch();
    const free = lines(s0).at(-1) as Line;
    await dimension(u, onLine(s0, free), { x: -20, y: 70 }, `${w} / 2`);
    const was = await u.sketch();
    const tail = Object.values(was.dimensions).at(-1) as { id: Id };
    await fillet(u, { x: 75, y: 0 }, { x: 80, y: 5 }, '6');
    const s = await u.sketch();
    expect(gap(s, free.a, free.b)).toBeCloseTo(40, 4);
    expect(s.dimensions[tail.id].value).toBeCloseTo(40, 4);
    const named = Object.values(s.dimensions).map((d) => d.name);
    if (!named.includes(w)) expect(s.dimensions[tail.id].expression).toContain('80');
    expect(new Set(named).size).toBe(named.length);
    expect(named.filter((n) => n === w || n === h).length).toBeLessThanOrEqual(2);
    expect(await note(u)).not.toContain('Unknown name');
  });

  test('F2: delete what an expression used, add another: it keeps its value, says so, and Undo puts it back', async ({ page }) => {
    const u = await start(page);
    await tool(u, '2-Point Rectangle');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 80, y: 40 });
    await leave(u);
    const s0 = await u.sketch();
    const bottom = lines(s0).find((l) => Math.abs(pointAt(s0, l.a).y) + Math.abs(pointAt(s0, l.b).y) < 1e-6) as Line;
    const right = lines(s0).find((l) => Math.abs(pointAt(s0, l.a).x - 80) + Math.abs(pointAt(s0, l.b).x - 80) < 1e-6) as Line;
    await dimension(u, onLine(s0, bottom), { x: 40, y: -10 }, '80');
    const [d1] = Object.values((await u.sketch()).dimensions);
    await dimension(u, onLine(s0, right), { x: 92, y: 20 }, `${d1.name} / 2`);
    const withBoth = await u.sketch();
    const d2 = Object.values(withBoth.dimensions)[1];
    expect(d2.value).toBeCloseTo(40, 6);
    await u.click({ x: 40, y: -10 });
    await u.press('Delete');
    expect(await note(u)).toContain('is gone');
    const after = await u.sketch();
    expect(after.dimensions[d2.id].expression).toBe('(80 mm) / 2');
    await draw(u, 'Line', [{ x: -40, y: 60 }, { x: -7, y: 60 }]);
    const s1 = await u.sketch();
    const free = lines(s1).at(-1) as Line;
    await dimension(u, onLine(s1, free), { x: -20, y: 70 }, '33');
    const s2 = await u.sketch();
    expect(Object.values(s2.dimensions).map((k) => k.name)).not.toContain(d1.name);
    expect(gap(s2, right.a, right.b)).toBeCloseTo(40, 6);
    for (let i = 0; i < 3; i++) await u.press('ControlOrMeta+z');
    const back = await u.sketch();
    expect(back.dimensions[d2.id].expression).toBe(`${d1.name} / 2`);
    expect(back.dimensions[d1.id].name).toBe(d1.name);
  });

  test('F2: a file with a dangling expression opens and says which dimension', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: -30, y: 0 }, { x: 10, y: 0 }]);
    const s0 = await u.sketch();
    const [l] = lines(s0);
    await dimension(u, onLine(s0, l), { x: -10, y: 10 }, '40');
    const design = await u.page.evaluate(() => JSON.parse(JSON.stringify(window.__sketch.design())));
    const [sketch] = Object.values(design.sketches) as Sketch[];
    Object.values(sketch.dimensions)[0].expression = 'd9 / 2';
    const [chooser] = await Promise.all([u.page.waitForEvent('filechooser'), (async () => {
      await u.page.locator('[data-menu="file"]').click();
      await u.page.locator('.menu-item[data-item="Open..."]').click();
      await u.page.locator('[data-dialog="Unsaved Changes"]').getByRole('button', { name: "Don't Save" }).click();
    })()]);
    await chooser.setFiles({ name: 'dangling.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(design), 'utf8') });
    await u.settle();
    expect(await note(u)).toContain("Unknown name 'd9'");
  });

  test('S1: Horizontal that would flatten a roof tries Vertical', async ({ page }) => {
    const u = await start(page);
    await tool(u, '2-Point Rectangle');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 60, y: 40 });
    await leave(u);
    const [line] = await lineFrom(u, { x: 0, y: 40 }, [{ x: 30, y: 48 }], { x: 60, y: 40 });
    const s = await u.sketch();
    await pick(u, 'Horizontal/Vertical', onLine(s, line, 0.5));
    const after = await u.sketch();
    expect(Object.values(after.constraints).some((k) => k.type === 'vertical' && k.refs.includes(line.id))).toBe(true);
    expect(await note(u)).toBe('');
  });

  test('S3: a Fillet that takes a corner held by Symmetry says so', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: 0, y: -30 }, { x: 0, y: 30 }]);
    await lineFrom(u, { x: -20, y: 10 }, [{ x: -20, y: -10 }]);
    await lineFrom(u, { x: -20, y: -10 }, [{ x: 20, y: -10 }]);
    await lineFrom(u, { x: 20, y: -10 }, [{ x: 20, y: 10 }]);
    await pick(u, 'Symmetry', { x: -20, y: -10 }, { x: 20, y: -10 }, { x: 0, y: 20 });
    expect(Object.values((await u.sketch()).constraints).some((k) => k.type === 'symmetric')).toBe(true);
    await tool(u, 'Fillet');
    await u.click({ x: -20, y: -8 });
    await u.click({ x: -18, y: -10 });
    await u.settle();
    await u.page.keyboard.press('ControlOrMeta+a');
    await u.page.keyboard.type('2');
    await u.press('Enter');
    await u.press('Enter');
    await leave(u);
    expect(await note(u)).toContain('Symmetry');
  });

  test('S4: Fit leaves nothing under the palette', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: -65, y: 0 }, { x: 65, y: 20 }]);
    await u.press('F6');
    await u.settle();
    const s = await u.sketch();
    const [l] = lines(s);
    const end = await u.screen(pointAt(s, l.b));
    const start_ = await u.screen(pointAt(s, l.a));
    const palette = await page.locator('.palette').boundingBox();
    const browser = await page.locator('.browser').boundingBox();
    expect(Math.max(end.x, start_.x)).toBeLessThan(palette?.x ?? 0);
    expect(Math.min(end.x, start_.x)).toBeGreaterThan((browser?.x ?? 0) + (browser?.width ?? 0));
  });

  test('S5: entering the same value again clears what was said about a refused try', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: 0, y: 10 }, { x: 40, y: 10 }]);
    const s0 = await u.sketch();
    const [l] = lines(s0);
    await dimension(u, onLine(s0, l), { x: 20, y: 22 }, '40');
    await draw(u, 'Line', [{ x: 0, y: -10 }, { x: 40, y: -10 }]);
    const s1 = await u.sketch();
    const other = lines(s1).at(-1) as Line;
    await pick(u, 'Coincident', pointAt(s1, other.a), pointAt(s1, other.b));
    expect(await note(u)).toContain('not applied');
    await setValue(u, Object.values((await u.sketch()).dimensions)[0].name, 40);
    expect(await note(u)).toBe('');
  });
});

test.describe('CHK6: what the fifth check found', () => {
  const pulley = async (u: SketchUser): Promise<Record<string, Line>> => {
    const ls = await lineFrom(u, { x: -17, y: 33 }, [{ x: 1, y: 16 }, { x: 17, y: 34 }, { x: 29, y: 33 }, { x: 30, y: 1 }, { x: -30, y: 0 }, { x: -29, y: 33 }], { x: -17, y: 33 });
    const [v1, v2, rimR, wr, base, wl, rimL] = ls;
    for (const l of [rimR, wr, base, wl, rimL]) {
      const s = await u.sketch();
      await pick(u, 'Horizontal/Vertical', onLine(s, s.curves[l.id] as Line, 0.5));
    }
    const on = async (label: string, a: Line, b: Line): Promise<void> => {
      const s = await u.sketch();
      await pick(u, label, onLine(s, s.curves[a.id] as Line, 0.4), onLine(s, s.curves[b.id] as Line, 0.4));
    };
    await on('Equal', v1, v2);
    await on('Perpendicular', v1, v2);
    await on('Equal', wl, wr);
    return { v1, v2, rimR, wr, base, wl, rimL };
  };

  test('P1-1: after free lines gave way the status is the analysis of the real sketch', async ({ page }) => {
    const u = await start(page);
    const { base, wr, rimL, rimR } = await pulley(u);
    let s = await u.sketch();
    await pick(u, 'Midpoint', { x: 0, y: 0 }, onLine(s, s.curves[base.id] as Line, 0.4));
    s = await u.sketch();
    await pick(u, 'Collinear', onLine(s, s.curves[rimL.id] as Line, 0.5), onLine(s, s.curves[rimR.id] as Line, 0.5));
    s = await u.sketch();
    await dimension(u, onLine(s, s.curves[base.id] as Line), { x: 0, y: -12 }, '58');
    s = await u.sketch();
    await dimension(u, onLine(s, s.curves[wr.id] as Line), { x: 42, y: 15 }, '33');
    const free = (await u.analysis()).dof;
    expect(free).toBeGreaterThan(0);
    await setValue(u, Object.values((await u.sketch()).dimensions)[0].name, 24);
    const after = await u.analysis();
    expect(after.dof).toBeGreaterThan(0);
    await page.locator('.palette-link', { hasText: 'Compute Sketch' }).click();
    await u.settle();
    expect((await u.analysis()).dof).toBe(after.dof);
  });

  test('P2-5: an unused user parameter can be deleted', async ({ page }) => {
    const u = await start(page);
    await tool(u, 'Change Parameters');
    const d = page.locator('[data-dialog="Parameters"]');
    await d.locator('.param-section button').first().click();
    await u.settle();
    await d.locator('.param-section button').first().click();
    await u.settle();
    await expect(d.locator('.param-delete')).toHaveCount(2);
    await d.locator('.param-delete').first().click();
    await u.settle();
    await expect(d.locator('.param-delete')).toHaveCount(1);
    await d.locator('.param-delete').first().click();
    await u.settle();
    await expect(d.locator('.param-delete')).toHaveCount(0);
    await d.locator('.btn.primary').click();
    await u.settle();
    expect(await page.evaluate(() => window.__sketch.design().parameters.length)).toBe(0);
  });

  test('P3-3: a chamfer begun at a vertex leaves one chord', async ({ page }) => {
    const u = await start(page);
    await tool(u, '2-Point Rectangle');
    await u.click({ x: 0, y: 0 });
    await u.click({ x: 80, y: 40 });
    await leave(u);
    const before = lines(await u.sketch()).length;
    await page.locator('.panel[data-panel="modify"] .panel-name').click();
    await page.locator('.menu-item.flyout[data-item="Chamfer"]').hover();
    await page.locator('.menu-item[data-item="Equal Distance Chamfer"]').click();
    await u.settle();
    await u.click({ x: 79, y: 0 });
    await u.click({ x: 80, y: 1 });
    await u.page.keyboard.press('ControlOrMeta+a');
    await u.page.keyboard.type('10');
    await u.press('Enter');
    await leave(u);
    const s = await u.sketch();
    expect(lines(s).length).toBe(before + 1);
    const chord = lines(s).at(-1) as Line;
    expect(gap(s, chord.a, chord.b)).toBeCloseTo(Math.hypot(10, 10), 3);
  });

  test('P3-7: OK with nothing changed ends what was said', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: 0, y: 10 }, { x: 40, y: 10 }]);
    const s0 = await u.sketch();
    const [l] = lines(s0);
    await pick(u, 'Coincident', pointAt(s0, l.a), pointAt(s0, l.b));
    expect(await note(u)).toContain('not applied');
    await tool(u, 'Change Parameters');
    await page.locator('[data-dialog="Parameters"] .btn.primary').click();
    await u.settle();
    expect(await note(u)).toBe('');
  });

  test('P3-9: a dimension on another layer is read only in Change Parameters, and says why', async ({ page }) => {
    const u = await start(page);
    await draw(u, 'Line', [{ x: 0, y: 10 }, { x: 40, y: 10 }]);
    const s0 = await u.sketch();
    await dimension(u, onLine(s0, lines(s0)[0]), { x: 20, y: 22 }, '40');
    const [k] = Object.values((await u.sketch()).dimensions);
    await page.locator('.layers-head button, .layers .icon-btn').first().click();
    await u.settle();
    await tool(u, 'Change Parameters');
    const row = page.locator(`[data-dialog="Parameters"] .param-row[data-param="${k.name}"]`);
    await expect(row.locator('input').first()).toHaveAttribute('readonly', '');
    await expect(row.locator('input').nth(1)).toHaveAttribute('readonly', '');
    await expect(row.locator('.param-why')).toContainText('make it active');
    await page.locator('[data-dialog="Parameters"] .btn.primary').click();
    await u.settle();
  });
});
