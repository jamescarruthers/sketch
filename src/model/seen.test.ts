import { describe, expect, it } from 'vitest';
import type { Design, Sketch } from './types';
import { addArc, addCircle, addFrameText, addLine, addPoint, newDesign, newSketch } from './document';
import { fold, PLANE_FRAMES, toWorld } from './frames';
import { isEmpty, seenFrom, seesCurve } from './seen';
import { isLost, linkedCopy, syncProjections } from '../io/projection';
import { deserialize, serialize } from '../io/project';
import { decodeSvgData } from '../io/svg-data';
import { exportSvg } from '../io/svg';

/** A rectangle on XY whose bottom edge is the X axis, and the sketch folded Up about that edge. */
function folded(): { d: Design; xy: Sketch; up: Sketch; bottom: string } {
  const d = newDesign();
  const xy = newSketch(d, 'XY');
  const bottom = addLine(d, xy, { x: 0, y: 0 }, { x: 40, y: 0 }).id;
  addLine(d, xy, { x: 40, y: 0 }, { x: 40, y: 20 });
  addLine(d, xy, { x: 40, y: 20 }, { x: 0, y: 20 });
  addLine(d, xy, { x: 0, y: 20 }, { x: 0, y: 0 });
  addCircle(d, xy, { x: 20, y: 10 }, 5);
  addPoint(d, xy, { x: 30, y: 0 }, { explicit: true });
  const f = fold(xy.frame, { x: 0, y: 0 }, { x: 40, y: 0 }, 'up');
  if (!f) throw new Error('no fold');
  const up = newSketch(d, f.frame);
  return { d, xy, up, bottom };
}

describe('what one sketch sees of another', () => {
  it('is the sketch itself when the two share a frame', () => {
    const d = newDesign();
    const a = newSketch(d, 'XY');
    addLine(d, a, { x: 0, y: 0 }, { x: 5, y: 5 });
    expect(seenFrom(PLANE_FRAMES.XY, a)).toBe(a);
  });

  it('from another plane: the lines lying in this one, and the points on it, nothing else', () => {
    const { xy, up, bottom } = folded();
    const view = seenFrom(up.frame, xy);
    expect(Object.keys(view.curves)).toEqual([bottom]);
    const line = view.curves[bottom];
    if (line.type !== 'line') throw new Error('not a line');
    // In the folded sketch's coordinates: u is X, so the edge runs along its x axis at y 0.
    expect([view.points[line.a], view.points[line.b]].map((p) => [p.x, p.y])).toEqual([[0, 0], [40, 0]]);
    // Off the plane: the far corners and the circle's centre.
    expect(Object.values(view.points).every((p) => Math.abs(p.y) < 1e-9)).toBe(true);
    // Points on the plane whose curves are not show of themselves: the side edges' ends, the explicit point.
    const loose = Object.values(view.points).filter((p) => p.shown).map((p) => [p.x, p.y]);
    expect(loose).toContainEqual([30, 0]);
    expect(Object.keys(view.constraints)).toEqual([]);
    expect(seesCurve(up.frame, xy, bottom)).toBe(true);
    expect(Object.keys(xy.curves).filter((id) => seesCurve(up.frame, xy, id))).toEqual([bottom]);
  });

  it('is empty from a plane the other sketch never meets', () => {
    const d = newDesign();
    const a = newSketch(d, 'XY');
    addLine(d, a, { x: 10, y: 10 }, { x: 20, y: 10 });
    expect(isEmpty(seenFrom({ ...PLANE_FRAMES.XY, o: { x: 0, y: 0, z: 5 } }, a))).toBe(true);
  });

  it('from the same plane facing the other way: everything, mirrored, arcs reversed, text left out', () => {
    const d = newDesign();
    const a = newSketch(d, 'XY');
    const arc = addArc(d, a, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    addFrameText(d, a, 'Hi', 5, [{ x: 0, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 30 }, { x: 0, y: 30 }]);
    // XY seen from below: the ZX plane folded down about its X axis.
    const f = fold(PLANE_FRAMES.ZX, { x: 0, y: 0 }, { x: 0, y: 1 }, 'left');
    if (!f) throw new Error('no fold');
    const view = seenFrom(f.frame, a);
    const copy = view.curves[arc.id];
    if (copy.type !== 'arc') throw new Error('not an arc');
    expect([copy.a, copy.b]).toEqual([arc.b, arc.a]);
    for (const id of [arc.a, arc.b, arc.c]) {
      const w = toWorld(a.frame, a.points[id]);
      const back = toWorld(f.frame, view.points[id]);
      expect(back.x).toBeCloseTo(w.x, 12);
      expect(back.y).toBeCloseTo(w.y, 12);
      expect(back.z).toBeCloseTo(w.z, 12);
    }
    expect(Object.values(view.curves).some((c) => c.type === 'text')).toBe(false);
  });
});

describe('a hinge projected onto the folded plane', () => {
  it('follows its source while it stays in the plane, and is lost once it leaves', () => {
    const { d, xy, up, bottom } = folded();
    const copy = linkedCopy(d, up, seenFrom(up.frame, xy), bottom);
    if (copy?.type !== 'line') throw new Error('no copy');
    expect(isLost(d, copy, up)).toBe(false);
    const src = xy.curves[bottom];
    if (src.type !== 'line') throw new Error('not a line');
    // Along the hinge: still in the plane, so the copy follows.
    xy.points[src.b].x = 55;
    expect(syncProjections(d, up)).toBe(true);
    expect(up.points[copy.b].x).toBe(55);
    // Lifted off the hinge line: out of the folded plane. The copy keeps its place and is lost.
    xy.points[src.b].y = 3;
    expect(isLost(d, copy, up)).toBe(true);
    expect(syncProjections(d, up)).toBe(false);
    expect(up.points[copy.b].x).toBe(55);
  });
});

describe('frames on disk', () => {
  const v2 = (plane: string): string => JSON.stringify({
    version: 2, name: 'Old', order: ['s1'], parameters: [], units: 'mm', nextId: 9,
    layers: [{ id: 'layer-1', name: 'Layer 1', color: '#5f7186', visible: true, locked: false }], activeLayer: 'layer-1',
    sketches: { s1: { id: 's1', name: 'Sketch1', plane, visible: true, points: {}, curves: {}, constraints: {}, dimensions: {}, features: {} } },
  });

  it('opens a version 2 design with each plane as its frame', () => {
    for (const plane of ['XY', 'YZ', 'ZX'] as const) {
      const r = deserialize(v2(plane));
      if (!r.ok) throw new Error(r.error);
      expect(r.warnings).toEqual([]);
      expect(r.design.version).toBe(3);
      expect(r.design.sketches.s1.frame).toEqual(PLANE_FRAMES[plane]);
      expect('plane' in r.design.sketches.s1).toBe(false);
    }
  });

  it('keeps a folded frame through JSON and the SVG data exactly, and refuses a sketch with no frame', () => {
    const { d, up } = folded();
    const slant = fold(up.frame, { x: 3, y: 1 }, { x: 11, y: 6 }, 'down');
    if (!slant) throw new Error('no fold');
    newSketch(d, slant.frame);
    const json = deserialize(serialize(d));
    expect(json).toEqual({ ok: true, design: d, warnings: [] });
    const svg = exportSvg(d, [up], { data: true });
    const m = /<sketch:design ([^>]*)>([^<]*)<\/sketch:design>/.exec(svg);
    if (!m) throw new Error('no data');
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const data = decodeSvgData({ format: attrs.format, encoding: attrs.encoding, bytes: attrs.bytes, crc32: attrs.crc32, text: m[2] });
    if (!data.ok) throw new Error(data.error);
    expect(deserialize(data.json)).toEqual({ ok: true, design: d, warnings: [] });
    const raw = JSON.parse(serialize(d)) as Design;
    delete (raw.sketches[up.id] as Partial<Sketch>).frame;
    expect(deserialize(JSON.stringify(raw))).toMatchObject({ ok: false });
  });
});
