import { beforeEach, describe, expect, it } from 'vitest';
import type { Constraint, Curve, Design, Dimension, Id, Line, Sketch, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import { addArc, addCircle, addConstraint, addDimension, addLine, curveEnds, getPointPos, newDesign, newSketch } from '../model/document';
import { measureDimension } from '../model/parameters';
import { applyResult, autoConstrainAvailable, generateResults, type AutoSolve } from './autoconstrain';
import { closestPoint } from './curves';

// Independent stand-in for the wasm solver: dof = variables minus the rank of a numeric Jacobian.

type Vars = { names: string[]; values: number[] };

function vars(sketch: Sketch): Vars {
  const names: string[] = [];
  const values: number[] = [];
  for (const p of Object.values(sketch.points)) {
    names.push(`${p.id}.x`, `${p.id}.y`);
    values.push(p.x, p.y);
  }
  for (const c of Object.values(sketch.curves)) {
    if (c.type === 'circle') {
      names.push(`${c.id}.r`);
      values.push(c.r);
    }
  }
  return { names, values };
}

function withVars(sketch: Sketch, v: Vars): Sketch {
  const s = structuredClone(sketch);
  v.names.forEach((n, i) => {
    const [id, f] = n.split('.');
    if (f === 'r') (s.curves[id] as Extract<Curve, { type: 'circle' }>).r = v.values[i];
    else if (f === 'x') s.points[id].x = v.values[i];
    else s.points[id].y = v.values[i];
  });
  return s;
}

function rowsFor(s: Sketch): number[] {
  const out: number[] = [];
  const pos = (id: Id): Vec2 => getPointPos(s, id);
  const dir = (id: Id): Vec2 => {
    if (id === AXIS_X) return { x: 1, y: 0 };
    if (id === AXIS_Y) return { x: 0, y: 1 };
    const l = s.curves[id] as Line;
    const a = pos(l.a);
    const b = pos(l.b);
    return { x: b.x - a.x, y: b.y - a.y };
  };
  const radius = (id: Id): number => {
    const c = s.curves[id];
    if (c.type === 'circle') return c.r;
    if (c.type === 'arc') {
      const m = pos(c.c);
      const a = pos(c.a);
      return Math.hypot(a.x - m.x, a.y - m.y);
    }
    return 0;
  };
  const rule = (k: Constraint): void => {
    const [a, b, c] = k.refs;
    switch (k.type) {
      case 'coincident': {
        const on = s.curves[b] ?? s.curves[a];
        if (on) {
          const p = pos(s.curves[b] ? a : b);
          out.push(closestPoint(s, on, p).dist);
        } else {
          const p = pos(a);
          const q = pos(b);
          out.push(p.x - q.x, p.y - q.y);
        }
        break;
      }
      case 'horizontal': out.push(b ? pos(a).y - pos(b).y : dir(a).y); break;
      case 'vertical': out.push(b ? pos(a).x - pos(b).x : dir(a).x); break;
      case 'parallel': { const u = dir(a); const w = dir(b); out.push(u.x * w.y - u.y * w.x); break; }
      case 'perpendicular': { const u = dir(a); const w = dir(b); out.push(u.x * w.x + u.y * w.y); break; }
      case 'equal': {
        const la = s.curves[a].type === 'line' ? Math.hypot(dir(a).x, dir(a).y) : radius(a);
        const lb = s.curves[b].type === 'line' ? Math.hypot(dir(b).x, dir(b).y) : radius(b);
        out.push(la - lb);
        break;
      }
      case 'concentric': {
        const p = pos((s.curves[a] as Extract<Curve, { type: 'circle' }>).c);
        const q = pos((s.curves[b] as Extract<Curve, { type: 'circle' }>).c);
        out.push(p.x - q.x, p.y - q.y);
        break;
      }
      case 'symmetric': {
        const p = pos(a);
        const q = pos(b);
        const u = dir(c);
        out.push((p.x - q.x) * u.x + (p.y - q.y) * u.y);
        out.push((p.x + q.x) / 2 * u.y - (p.y + q.y) / 2 * u.x);
        break;
      }
      default: break;
    }
  };
  for (const k of Object.values(s.constraints)) rule(k);
  for (const m of Object.values(s.dimensions) as Dimension[]) {
    if (m.kind === 'angle') {
      const u = dir(m.refs[0]);
      out.push(Math.atan2(u.y, u.x));
    } else if (m.kind === 'horizontal' || m.kind === 'vertical') {
      const p = pos(m.refs[0]);
      const q = pos(m.refs[1]);
      out.push(m.kind === 'horizontal' ? q.x - p.x : q.y - p.y);
    } else if (m.driving) {
      out.push(measureDimension(s, m) ?? 0);
    }
  }
  return out;
}

function rank(mat: number[][]): number {
  const a = mat.map((r) => [...r]);
  let r = 0;
  const cols = a[0]?.length ?? 0;
  for (let c = 0; c < cols && r < a.length; c++) {
    let best = r;
    for (let i = r + 1; i < a.length; i++) if (Math.abs(a[i][c]) > Math.abs(a[best][c])) best = i;
    if (Math.abs(a[best][c]) < 1e-5) continue;
    [a[r], a[best]] = [a[best], a[r]];
    for (let i = r + 1; i < a.length; i++) {
      const f = a[i][c] / a[r][c];
      for (let k = c; k < cols; k++) a[i][k] -= f * a[r][k];
    }
    r++;
  }
  return r;
}

const fakeSolve: AutoSolve = (sketch) => {
  const v = vars(sketch);
  const h = 1e-6;
  const cols: number[][] = [];
  for (let i = 0; i < v.values.length; i++) {
    const up = { ...v, values: [...v.values] };
    up.values[i] += h;
    const dn = { ...v, values: [...v.values] };
    dn.values[i] -= h;
    const a = rowsFor(withVars(sketch, up));
    const b = rowsFor(withVars(sketch, dn));
    cols.push(a.map((x, k) => (x - b[k]) / (2 * h)));
  }
  const rowsN = cols[0]?.length ?? 0;
  const mat = Array.from({ length: rowsN }, (_, r) => cols.map((c) => c[r]));
  return { ok: true, dof: v.values.length - rank(mat) };
};

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

const rectangle = (x0: number, y0: number, x1: number, y1: number): Line[] => {
  const pts: Vec2[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return pts.map((p, i) => addLine(d, s, p, pts[(i + 1) % 4]));
};

describe('fake solver sanity', () => {
  it('counts dof', () => {
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(fakeSolve(s).dof).toBe(4);
    addConstraint(d, s, 'horizontal', [l.id]);
    expect(fakeSolve(s).dof).toBe(3);
    addConstraint(d, s, 'coincident', [l.a, ORIGIN]);
    expect(fakeSolve(s).dof).toBe(1);
    addDimension(d, s, 'distance', [l.a, l.b], 10);
    expect(fakeSolve(s).dof).toBe(0);
  });
});

describe('availability', () => {
  it('refuses empty and oversized sketches', () => {
    expect(autoConstrainAvailable(s).ok).toBe(false);
    expect(generateResults(s, { solve: fakeSolve })).toEqual([]);
    for (let i = 0; i < 251; i++) addLine(d, s, { x: i, y: 0 }, { x: i, y: 1 });
    expect(autoConstrainAvailable(s).ok).toBe(false);
  });
});

describe('generateResults', () => {
  it('fully constrains a loose rectangle and offers several results', () => {
    rectangle(0, 0, 40, 20);
    const results = generateResults(s, { solve: fakeSolve });
    expect(results.length).toBe(3);
    expect(results[0].fullyConstrained).toBe(true);
    expect(results[0].dof).toBe(0);
    const types = results[0].constraints.map((k) => k.type);
    expect(types.filter((t) => t === 'coincident').length).toBeGreaterThanOrEqual(4);
    expect(types).toContain('horizontal');
    expect(types).toContain('vertical');
    expect(results.map((r) => r.label).length).toBe(new Set(results.map((r) => r.label)).size);
  });
  it('leaves the sketch untouched until applied, and applying reaches dof 0', () => {
    rectangle(0, 0, 40, 20);
    const before = JSON.stringify(s);
    const results = generateResults(s, { solve: fakeSolve });
    expect(JSON.stringify(s)).toBe(before);
    const ids = applyResult(d, s, results[0]);
    expect(ids.length).toBe(results[0].constraints.length + results[0].dimensions.length);
    expect(fakeSolve(s).dof).toBe(0);
    expect(Object.values(s.dimensions).every((m) => /^d\d+$/.test(m.name))).toBe(true);
  });
  it('is deterministic', () => {
    rectangle(0, 0, 40, 20);
    addCircle(d, s, { x: 20, y: 10 }, 5);
    const a = generateResults(s, { solve: fakeSolve });
    const b = generateResults(s, { solve: fakeSolve });
    expect(a).toEqual(b);
  });
  it('anchors to an explicit datum', () => {
    const lines = rectangle(5, 5, 45, 25);
    const datum = lines[2].a;
    const r = generateResults(s, { solve: fakeSolve, datum })[0];
    expect(r.fullyConstrained).toBe(true);
    const dims = r.dimensions.filter((m) => m.refs.includes(ORIGIN));
    expect(dims.every((m) => m.refs[1] === datum)).toBe(true);
    expect(dims.length).toBe(2);
  });
  it('honours the quantity slider', () => {
    rectangle(0, 0, 40, 20);
    const full = generateResults(s, { solve: fakeSolve })[0];
    const half = generateResults(s, { solve: fakeSolve, quantity: 0.5 })[0];
    const none = generateResults(s, { solve: fakeSolve, quantity: 0 })[0];
    const total = (r: typeof full) => r.constraints.length + r.dimensions.length;
    expect(total(half)).toBeLessThan(total(full));
    expect(total(none)).toBe(0);
    expect(half.fullyConstrained).toBe(false);
    expect(none.dof).toBe(16);
  });
  it('recognises circle size, concentricity and equal radii', () => {
    const a = addCircle(d, s, { x: 7, y: 3 }, 5);
    const b = addCircle(d, s, { x: 7, y: 3 }, 8);
    const c = addCircle(d, s, { x: 30, y: 0 }, 5);
    const r = generateResults(s, { solve: fakeSolve, count: 1 })[0];
    const by = (t: string) => r.constraints.filter((k) => k.type === t);
    expect(by('concentric')[0].refs).toEqual([a.id, b.id]);
    expect(by('equal')[0].refs.sort()).toEqual([a.id, c.id].sort());
    expect(r.dimensions.some((m) => m.kind === 'diameter')).toBe(true);
    expect(r.fullyConstrained).toBe(true);
  });
  it('sees tangent, symmetric, midpoint, parallel, perpendicular and point on curve', () => {
    const l = addLine(d, s, { x: -10, y: 5 }, { x: 0, y: 5 });
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 });
    const right = addLine(d, s, { x: 12, y: 3 }, { x: 12, y: 9 });
    const left = addLine(d, s, { x: -12, y: 3 }, { x: -12, y: 9 });
    const slant = addLine(d, s, { x: 30, y: 0 }, { x: 40, y: 10 });
    const slant2 = addLine(d, s, { x: 50, y: 0 }, { x: 60, y: 10 });
    const normal = addLine(d, s, { x: 70, y: 10 }, { x: 80, y: 0 });
    const onCurve = addLine(d, s, { x: 35, y: 5 }, { x: 35, y: -20 });
    const onMid = addLine(d, s, { x: 12, y: 6 }, { x: 25, y: 40 });
    let remaining = 100000;
    const accepting: AutoSolve = () => ({ ok: true, dof: remaining-- });
    const k = generateResults(s, { solve: accepting, count: 1 })[0].constraints;
    const has = (t: string, ...refs: Id[]) => k.some((c) => c.type === t && refs.every((r) => c.refs.includes(r)));
    expect(has('tangent', l.id, a.id)).toBe(true);
    expect(has('symmetric', right.a, left.a, AXIS_Y)).toBe(true);
    expect(has('parallel', slant.id, slant2.id)).toBe(true);
    expect(has('perpendicular', slant.id, normal.id)).toBe(true);
    expect(has('coincident', onCurve.a, slant.id)).toBe(true);
    expect(has('midpoint', onMid.a, right.id)).toBe(true);
    expect(curveEnds(l)).toBeTruthy();
  });
  it('ties a circle centre to the origin and to a line end, and never uses a zero dimension', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    const e = addCircle(d, s, { x: 30, y: 0 }, 5);
    const l = addLine(d, s, { x: 0, y: 0 }, { x: 0, y: 20 });
    const m = addLine(d, s, { x: 30, y: 0 }, { x: 30, y: 20 });
    const r = generateResults(s, { solve: fakeSolve, count: 1 })[0];
    const ties = r.constraints.filter((k) => k.type === 'coincident');
    expect(ties.some((k) => k.refs.includes(ORIGIN) && k.refs.includes(c.c))).toBe(true);
    expect(ties.some((k) => k.refs.includes(e.c) && k.refs.includes(m.a))).toBe(true);
    expect(l.a).toBeTruthy();
    expect(r.fullyConstrained).toBe(true);
    expect(r.dimensions.every((x) => x.value > 1e-6)).toBe(true);
  });
  it('tolerance controls what counts as true', () => {
    addLine(d, s, { x: 0, y: 0 }, { x: 40, y: 3 });
    const tight = generateResults(s, { solve: fakeSolve, count: 1 })[0];
    expect(tight.constraints.some((k) => k.type === 'horizontal')).toBe(false);
    const loose = generateResults(s, { solve: fakeSolve, count: 1, angleTolerance: 0.1 })[0];
    expect(loose.constraints.some((k) => k.type === 'horizontal')).toBe(true);
  });
  it('rejects additions the solver says do not help', () => {
    rectangle(0, 0, 40, 20);
    let calls = 0;
    const stuck: AutoSolve = () => {
      calls++;
      return { ok: true, dof: 16 };
    };
    const r = generateResults(s, { solve: stuck, count: 1 })[0];
    expect(calls).toBeGreaterThan(10);
    expect(r.constraints).toEqual([]);
    expect(r.dimensions).toEqual([]);
    expect(r.fullyConstrained).toBe(false);
  });
  it('does not touch projected or derived geometry', () => {
    const p = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    p.projected = { origin: 'x' };
    addLine(d, s, { x: 0, y: 10 }, { x: 10, y: 10 });
    const r = generateResults(s, { solve: fakeSolve, count: 1 })[0];
    expect(r.constraints.flatMap((k) => k.refs)).not.toContain(p.id);
  });
});
