import { beforeEach, describe, expect, it } from 'vitest';
import type { Design, Line, Sketch } from './types';
import { ORIGIN } from './types';
import {
  addArc, addCircle, addConstraint, addDimension, addFitSpline, addLine, addPathText, addPoint, allocId, copySelection, curvePoints,
  deleteEntities, deleteSketch, findChain, getPointPos, newDesign, newSketch, pasteClipboard, setLineType, toggleConstruction,
} from './document';

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign('T');
  s = newSketch(d);
});

describe('document', () => {
  it('allocates ids that never repeat and names sketches', () => {
    expect(allocId(d, 'x')).not.toBe(allocId(d, 'x'));
    expect(s.name).toBe('Sketch1');
    expect(newSketch(d).name).toBe('Sketch2');
    deleteSketch(d, s.id);
    expect(d.order.length).toBe(1);
  });
  it('curves own their points; coincidence is a constraint', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    const b = addLine(d, s, { x: 1, y: 0 }, { x: 2, y: 0 });
    expect(a.b).not.toBe(b.a);
    expect(s.points[a.a].owner).toBe(a.id);
  });
  it('resolves the origin without storing it', () => {
    expect(getPointPos(s, ORIGIN)).toEqual({ x: 0, y: 0 });
    expect(s.points[ORIGIN]).toBeUndefined();
    expect(() => getPointPos(s, 'nope')).toThrow();
  });
});

describe('deleteEntities', () => {
  it('cascades a curve to its points, constraints and dimensions', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    const b = addLine(d, s, { x: 1, y: 0 }, { x: 2, y: 1 });
    const k = addConstraint(d, s, 'coincident', [a.b, b.a]);
    const h = addConstraint(d, s, 'horizontal', [a.id]);
    const m = addDimension(d, s, 'distance', [a.a, a.b], 1);
    const keep = addDimension(d, s, 'distance', [b.a, b.b], 1);
    const r = deleteEntities(s, [a.id]);
    expect(r.curves).toEqual([a.id]);
    expect(r.points.sort()).toEqual([a.a, a.b].sort());
    expect(s.constraints[k.id]).toBeUndefined();
    expect(s.constraints[h.id]).toBeUndefined();
    expect(s.dimensions[m.id]).toBeUndefined();
    expect(s.dimensions[keep.id]).toBeDefined();
    expect(s.points[b.a]).toBeDefined();
  });
  it('keeps explicit points, freed of their owner', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    s.points[a.a].explicit = true;
    deleteEntities(s, [a.id]);
    expect(s.points[a.a].owner).toBeUndefined();
    expect(s.points[a.b]).toBeUndefined();
  });
  it('keeps a shared point', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    const b = addLine(d, s, { x: 1, y: 0 }, { x: 2, y: 0 });
    delete s.points[b.a];
    b.a = a.b;
    deleteEntities(s, [a.id]);
    expect(s.points[b.a]).toBeDefined();
  });
  it('deleting a line end deletes the line, deleting a fit point shortens the spline', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    deleteEntities(s, [a.a]);
    expect(s.curves[a.id]).toBeUndefined();
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]);
    deleteEntities(s, [f.pts[1]]);
    expect(f.pts.length).toBe(2);
    expect(f.handles.length).toBe(2);
    deleteEntities(s, [f.pts[1]]);
    expect(s.curves[f.id]).toBeUndefined();
  });
  it('deleting a loose constraint or dimension touches nothing else', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    const k = addConstraint(d, s, 'horizontal', [a.id]);
    deleteEntities(s, [k.id]);
    expect(s.curves[a.id]).toBeDefined();
    expect(Object.keys(s.constraints)).toEqual([]);
  });
  it('removes text on a deleted path', () => {
    const a = addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    const t = addPathText(d, s, 'Hi', 2, a.id);
    deleteEntities(s, [a.id]);
    expect(s.curves[t.id]).toBeUndefined();
  });
  it('a free point goes on its own', () => {
    const p = addPoint(d, s, { x: 1, y: 1 }, { explicit: true });
    const k = addConstraint(d, s, 'coincident', [p.id, ORIGIN]);
    deleteEntities(s, [p.id]);
    expect(s.points[p.id]).toBeUndefined();
    expect(s.constraints[k.id]).toBeUndefined();
  });
});

describe('setLineType', () => {
  it('changes type but leaves projected geometry alone', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    const b = addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    b.projected = { origin: 'x' };
    setLineType(s, [a.id, b.id], 'centerline');
    expect(a.lineType).toBe('centerline');
    expect(b.lineType).toBe('normal');
    toggleConstruction(s, [a.id]);
    expect(a.lineType).toBe('normal');
    toggleConstruction(s, [a.id]);
    expect(a.lineType).toBe('construction');
  });
});

describe('findChain', () => {
  const chain = (n: number): Line[] => {
    const ls: Line[] = [];
    for (let i = 0; i < n; i++) ls.push(addLine(d, s, { x: i, y: 0 }, { x: i + 1, y: 0 }));
    for (let i = 0; i + 1 < n; i++) addConstraint(d, s, 'coincident', [ls[i].b, ls[i + 1].a]);
    return ls;
  };
  it('walks both ways from the middle and orders the links', () => {
    const ls = chain(4);
    const c = findChain(s, ls[2].id);
    expect(c.closed).toBe(false);
    expect(c.links.map((l) => l.curve)).toEqual(ls.map((l) => l.id));
    expect(c.links.every((l) => !l.reversed)).toBe(true);
  });
  it('detects closed loops', () => {
    const ls = chain(3);
    addConstraint(d, s, 'coincident', [ls[2].b, ls[0].a]);
    const c = findChain(s, ls[1].id);
    expect(c.closed).toBe(true);
    expect(c.links.length).toBe(3);
  });
  it('flags reversed links', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    const b = addLine(d, s, { x: 2, y: 0 }, { x: 1, y: 0 });
    addConstraint(d, s, 'coincident', [a.b, b.b]);
    const c = findChain(s, a.id);
    expect(c.links).toEqual([{ curve: a.id, reversed: false }, { curve: b.id, reversed: true }]);
  });
  it('stops at a branch', () => {
    const ls = chain(2);
    const branch = addLine(d, s, { x: 1, y: 0 }, { x: 1, y: 1 });
    addConstraint(d, s, 'coincident', [ls[0].b, branch.a]);
    expect(findChain(s, ls[0].id).links.length).toBe(1);
  });
  it('does not cross a gap, unless asked to compare positions', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 1, y: 0 });
    const b = addLine(d, s, { x: 1, y: 0 }, { x: 2, y: 0 });
    expect(findChain(s, a.id).links.length).toBe(1);
    expect(findChain(s, a.id, (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6).links.map((l) => l.curve)).toEqual([a.id, b.id]);
  });
  it('a circle is a closed chain of one', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 1);
    expect(findChain(s, c.id)).toEqual({ links: [{ curve: c.id, reversed: false }], closed: true });
  });
});

describe('copy and paste', () => {
  it('keeps internal constraints only, across sketches, with fresh ids', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const b = addLine(d, s, { x: 10, y: 0 }, { x: 10, y: 10 });
    const out = addLine(d, s, { x: 10, y: 10 }, { x: 0, y: 10 });
    addConstraint(d, s, 'coincident', [a.b, b.a]);
    addConstraint(d, s, 'horizontal', [a.id]);
    addConstraint(d, s, 'perpendicular', [a.id, b.id]);
    addConstraint(d, s, 'coincident', [b.b, out.a]);
    addConstraint(d, s, 'coincident', [a.a, ORIGIN]);
    addConstraint(d, s, 'parallel', [a.id, out.id]);
    addDimension(d, s, 'distance', [a.a, a.b], 10);
    addDimension(d, s, 'distance', [b.b, out.b], 10);

    const clip = copySelection(s, [a.id, b.id]);
    const other = newSketch(d);
    const r = pasteClipboard(d, other, clip, { offset: { x: 5, y: 5 } });

    expect(r.curves.length).toBe(2);
    expect(Object.keys(other.points).length).toBe(4);
    expect(Object.values(other.constraints).map((k) => k.type).sort()).toEqual(['coincident', 'horizontal', 'perpendicular']);
    expect(Object.keys(other.dimensions).length).toBe(1);
    const newA = other.curves[r.map.get(a.id)!] as Line;
    expect(getPointPos(other, newA.a)).toEqual({ x: 5, y: 5 });
    expect(other.points[newA.a].owner).toBe(newA.id);
    expect(r.curves).not.toContain(a.id);
    const kids = Object.values(other.constraints).flatMap((k) => k.refs);
    for (const ref of kids) expect(other.points[ref] ?? other.curves[ref]).toBeDefined();
  });
  it('allocates new dimension names and follows renames in expressions', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const m = addDimension(d, s, 'distance', [a.a, a.b], 10);
    addDimension(d, s, 'distance', [a.a, a.b], 10, { expression: `${m.name} * 2` });
    const r = pasteClipboard(d, s, copySelection(s, [a.id]));
    const ds = r.dimensions.map((id) => s.dimensions[id]);
    expect(ds.map((x) => x.name)).toEqual(['d3', 'd4']);
    expect(ds[1].expression).toBe('d3 * 2');
  });
  it('drops feature-owned constraints and projection links', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    a.projected = { origin: 'x' };
    addConstraint(d, s, 'horizontal', [a.id], { feature: 'f1' });
    const r = pasteClipboard(d, s, copySelection(s, [a.id]));
    expect(s.curves[r.curves[0]].projected).toBeUndefined();
    expect(r.constraints).toEqual([]);
  });
  it('copying a point of a curve brings the curve', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const clip = copySelection(s, [a.a]);
    expect(clip.curves.length).toBe(1);
    expect(clip.points.length).toBe(2);
  });
  it('the clipboard is a snapshot', () => {
    const a = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const clip = copySelection(s, [a.id]);
    s.points[a.a].x = 99;
    expect(clip.points.find((p) => p.id === a.a)?.x).toBe(0);
  });
  it('every curve point resolves after paste', () => {
    const f = addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]);
    const r = pasteClipboard(d, s, copySelection(s, [f.id]));
    for (const p of curvePoints(s.curves[r.curves[0]])) expect(s.points[p]).toBeDefined();
  });
});
