import { describe, expect, it } from 'vitest';
import type { Frame, Vec2, Vec3 } from './types';
import {
  coplanar, dot3, fold, foldArrows, meetingLine, meetingLines, normalOf, PLANE_FRAMES, planeName, sameFrame, samePlane, tidyFrame, toPlane, toWorld, v3, type Arrow,
} from './frames';
import { facing, project, turn } from '../app/camera';

const XY = PLANE_FRAMES.XY;
const X: [Vec2, Vec2] = [{ x: -20, y: 0 }, { x: 30, y: 0 }];

/** Fold, which must be allowed. */
const folded = (f: Frame, [a, b]: [Vec2, Vec2], arrow: Arrow): Frame => {
  const r = fold(f, a, b, arrow);
  if (!r) throw new Error(`${arrow} is not allowed`);
  return r.frame;
};

/** The same line in a frame's coordinates. */
const into = (from: Frame, to: Frame, [a, b]: [Vec2, Vec2]): [Vec2, Vec2] => {
  const at = (p: Vec2): Vec2 => {
    const q = toPlane(to, toWorld(from, p));
    expect(Math.abs(q.z)).toBeLessThan(1e-9);
    return { x: q.x, y: q.y };
  };
  return [at(a), at(b)];
};

/** -0 reads as 0: cross products leave it, and toEqual tells them apart. */
const n0 = (f: Frame): Vec3 => {
  const n = normalOf(f);
  return { x: n.x + 0, y: n.y + 0, z: n.z + 0 };
};

const expectUnit = (f: Frame): void => {
  for (const [a, b, want] of [[f.u, f.u, 1], [f.v, f.v, 1], [f.u, f.v, 0]] as const) expect(dot3(a, b)).toBeCloseTo(want, 12);
};

describe('which arrows fold about a line', () => {
  it('takes Up and Down across the screen, Left and Right up it, and Up and Down at exactly 45 degrees', () => {
    expect(foldArrows({ x: 0, y: 0 }, { x: 10, y: 0 })).toEqual(['up', 'down']);
    expect(foldArrows({ x: 0, y: 0 }, { x: 10, y: 4 })).toEqual(['up', 'down']);
    expect(foldArrows({ x: 0, y: 0 }, { x: 0, y: -10 })).toEqual(['left', 'right']);
    expect(foldArrows({ x: 0, y: 0 }, { x: 4, y: 10 })).toEqual(['left', 'right']);
    expect(foldArrows({ x: 0, y: 0 }, { x: 10, y: 10 })).toEqual(['up', 'down']);
    expect(foldArrows({ x: 3, y: 3 }, { x: -7, y: 13 })).toEqual(['up', 'down']);
    expect(foldArrows({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });

  it('does nothing with the other pair', () => {
    expect(fold(XY, X[0], X[1], 'left')).toBeNull();
    expect(fold(XY, X[0], X[1], 'right')).toBeNull();
    expect(fold(XY, { x: 0, y: 0 }, { x: 0, y: 5 }, 'up')).toBeNull();
    expect(fold(XY, { x: 0, y: 0 }, { x: 5, y: 5 }, 'left')).toBeNull();
  });
});

describe('folding the plane', () => {
  it('lands XY folded Up about the X axis on the ZX plane, normal +Y, exactly', () => {
    const f = folded(XY, X, 'up');
    expect(f).toEqual({ o: v3(0, 0, 0), u: v3(1, 0, 0), v: v3(0, 0, -1) });
    expect(n0(f)).toEqual(v3(0, 1, 0));
    expect(samePlane(f, PLANE_FRAMES.ZX)).toBe(true);
  });

  it('turns the other way for Down, and about a vertical line for Left and Right', () => {
    expect(n0(folded(XY, X, 'down'))).toEqual(v3(0, -1, 0));
    const y: [Vec2, Vec2] = [{ x: 0, y: -5 }, { x: 0, y: 25 }];
    const right = folded(XY, y, 'right');
    expect(right).toEqual({ o: v3(0, 0, 0), u: v3(0, 0, -1), v: v3(0, 1, 0) });
    expect(n0(right)).toEqual(v3(1, 0, 0));
    expect(samePlane(right, PLANE_FRAMES.YZ)).toBe(true);
    expect(n0(folded(XY, y, 'left'))).toEqual(v3(-1, 0, 0));
  });

  it('keeps the hinge on the new plane, and the origin at the foot of the world origin', () => {
    const off: [Vec2, Vec2] = [{ x: -5, y: 12 }, { x: 40, y: 12 }];
    const f = folded(XY, off, 'up');
    expect(f.o).toEqual(v3(0, 12, 0));
    into(XY, f, off);
    expect(planeName(f)).toBeNull();
  });

  it('turns a slanted line the way the arrow points, on the side of the line it points to', () => {
    for (const [line, arrow, side] of [
      [[{ x: 0, y: 0 }, { x: 10, y: 4 }], 'up', { x: -4, y: 10 }],
      [[{ x: 0, y: 0 }, { x: 10, y: 4 }], 'down', { x: 4, y: -10 }],
      [[{ x: 2, y: 1 }, { x: 6, y: 11 }], 'right', { x: 10, y: -4 }],
      [[{ x: 2, y: 1 }, { x: 6, y: 11 }], 'left', { x: -10, y: 4 }],
      [[{ x: 0, y: 0 }, { x: 10, y: 10 }], 'up', { x: -1, y: 1 }],
      [[{ x: 0, y: 0 }, { x: 10, y: 10 }], 'down', { x: 1, y: -1 }],
    ] as [[Vec2, Vec2], Arrow, Vec2][]) {
      const f = folded(XY, line, arrow);
      expectUnit(f);
      into(XY, f, line);
      const n = normalOf(f);
      const l = Math.hypot(side.x, side.y);
      expect(n.x).toBeCloseTo(side.x / l, 12);
      expect(n.y).toBeCloseTo(side.y / l, 12);
      expect(n.z).toBeCloseTo(0, 12);
    }
  });

  it('swings back exactly with the opposite arrow on the same hinge', () => {
    for (const [line, arrow, back] of [
      [X, 'up', 'down'],
      [X, 'down', 'up'],
      [[{ x: -5, y: 12 }, { x: 40, y: 12 }], 'up', 'down'],
      [[{ x: 7, y: -3 }, { x: 7, y: 30 }], 'left', 'right'],
    ] as [[Vec2, Vec2], Arrow, Arrow][]) {
      const f = folded(XY, line, arrow);
      expect(folded(f, into(XY, f, line), back)).toEqual(XY);
    }
    // A slanted hinge comes back to within rounding, and tidies to the same frame.
    const slant: [Vec2, Vec2] = [{ x: 1, y: 2 }, { x: 13, y: 7 }];
    const f = folded(XY, slant, 'up');
    const again = folded(f, into(XY, f, slant), 'down');
    expect(sameFrame(again, XY)).toBe(true);
    expect(tidyFrame(again)).toEqual(XY);
  });

  it('comes round to where it began after four folds the same way, with no drift', () => {
    let f: Frame = XY;
    for (let i = 0; i < 4; i++) f = folded(f, into(XY, f, X), 'up');
    expect(f).toEqual(XY);
  });

  it('keeps the hinge where it was on screen through the swing', () => {
    const line: [Vec2, Vec2] = [{ x: -5, y: 12 }, { x: 40, y: 20 }];
    const r = fold(XY, line[0], line[1], 'up');
    if (!r) throw new Error('no fold');
    const start = facing(XY, { cx: 15, cy: -8, ppm: 3 });
    for (const t of [0.3, 0.7, 1]) {
      const cam = turn(start, r.axis, (Math.PI / 2) * t, r.pivot);
      for (const p of line) {
        const before = project(start, toWorld(XY, p), 800, 600);
        const after = project(cam, toWorld(XY, p), 800, 600);
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
      }
    }
    // Landed, the camera looks straight at the new plane: its axes are the new sketch's.
    const end = turn(start, r.axis, Math.PI / 2, r.pivot);
    expect(end.right.x).toBeCloseTo(r.frame.u.x, 12);
    expect(end.up.y).toBeCloseTo(r.frame.v.y, 12);
    expect(end.up.z).toBeCloseTo(r.frame.v.z, 12);
  });
});

describe('frames', () => {
  it('snaps noise to exact values and squares the axes, and tidying twice changes nothing', () => {
    const f = tidyFrame({ o: v3(3e-9, 1, 2), u: v3(1 + 4e-13, 2e-13, -1e-13), v: v3(3e-13, -1e-13, 1 - 5e-13) });
    expect(f).toEqual({ o: v3(0, 1, 2), u: v3(1, 0, 0), v: v3(0, 0, 1) });
    const s = Math.SQRT1_2;
    const slant = tidyFrame({ o: v3(0, 0, 0), u: v3(s, s, 0), v: v3(-s, s + 1e-7, 0) });
    expectUnit(slant);
    expect(tidyFrame(slant)).toEqual(slant);
  });

  it('tells the same plane, facing either way, from another', () => {
    const down = folded(PLANE_FRAMES.ZX, [{ x: 0, y: 0 }, { x: 0, y: 1 }], 'left');
    expect(coplanar(XY, down)).toBe(true);
    expect(samePlane(XY, down)).toBe(false);
    expect(coplanar(XY, PLANE_FRAMES.YZ)).toBe(false);
    expect(coplanar(XY, { ...XY, o: v3(0, 0, 1) })).toBe(false);
    expect(samePlane(XY, { ...XY, o: v3(5, -2, 0) })).toBe(true);
    expect(planeName(PLANE_FRAMES.YZ)).toBe('YZ');
  });
});

describe('where other planes meet this one', () => {
  it('is the hinge for a fold, the other way round too, and nothing for a parallel plane', () => {
    const up = folded(XY, [{ x: -5, y: 12 }, { x: 40, y: 12 }], 'up');
    const line = meetingLine(up, XY);
    if (!line) throw new Error('no line');
    // In the folded sketch's coordinates the hinge is its x axis.
    expect(line.p.x + 0).toBe(0);
    expect(line.p.y + 0).toBe(0);
    expect(Math.abs(line.d.x)).toBeCloseTo(1, 12);
    const back = meetingLine(XY, up);
    expect(back?.p.y).toBeCloseTo(12, 12);
    expect(Math.abs(back?.d.x ?? 0)).toBeCloseTo(1, 12);
    expect(meetingLine(XY, { ...XY, o: v3(0, 0, 7) })).toBeNull();
    expect(meetingLine(XY, folded(PLANE_FRAMES.ZX, [{ x: 0, y: 0 }, { x: 0, y: 1 }], 'left'))).toBeNull();
  });

  it('runs at a slant for a slanted plane, and every point on it lies on both planes', () => {
    const slant = folded(XY, [{ x: 1, y: 2 }, { x: 13, y: 7 }], 'up');
    const tilted = folded(slant, [{ x: -3, y: 4 }, { x: 1, y: 13 }], 'right');
    const line = meetingLine(XY, tilted);
    if (!line) throw new Error('no line');
    for (const t of [-50, 0, 30]) {
      const q = toWorld(XY, { x: line.p.x + line.d.x * t, y: line.p.y + line.d.y * t });
      expect(Math.abs(toPlane(tilted, q).z)).toBeLessThan(1e-9);
    }
    expect(Math.hypot(line.d.x, line.d.y)).toBeCloseTo(1, 12);
  });

  it('draws one line for sketches sharing a plane, facing either way', () => {
    const up = folded(XY, X, 'up');
    const down = folded(XY, X, 'down');
    const lines = meetingLines(XY, [
      { id: 'a', frame: up }, { id: 'b', frame: XY }, { id: 'c', frame: down }, { id: 'd', frame: PLANE_FRAMES.YZ },
    ]);
    expect(lines.map((l) => l.ids)).toEqual([['a', 'c'], ['d']]);
  });
});
