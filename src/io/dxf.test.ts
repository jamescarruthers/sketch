import { beforeEach, describe, expect, it } from 'vitest';
import type { Design, Sketch } from '../model/types';
import {
  addArc, addCircle, addConic, addControlSpline, addEllipse, addFitSpline, addLine, addPoint, newDesign, newSketch,
} from '../model/document';
import { trim } from '../geom/modify';
import { addLayer } from '../model/layers';
import { exportDxf, nearestAci, parseDxfCounts, parseDxfEntities, parseDxfLayers } from './dxf';

let d: Design;
let s: Sketch;
beforeEach(() => {
  d = newDesign();
  s = newSketch(d);
});

/** All values for a group code within entities of a type, in order. */
function groups(text: string, type: string, code: number): number[] {
  const rows = text.split(/\r?\n/);
  const out: number[] = [];
  let inside = false;
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const c = Number(rows[i]);
    if (c === 0) inside = rows[i + 1].trim() === type;
    else if (inside && c === code) out.push(Number(rows[i + 1]));
  }
  return out;
}

describe('dxf', () => {
  it('writes a well formed R12 file', () => {
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    const text = exportDxf(s);
    const c = parseDxfCounts(text);
    expect(c.version).toBe('AC1009');
    expect(c.wellFormed).toBe(true);
    expect(c.LINE).toBe(1);
    expect(text.endsWith('  0\r\nEOF\r\n')).toBe(true);
    expect(text.split('\r\n').length % 2).toBe(1);
  });
  it('round trips counts for each entity type', () => {
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    addLine(d, s, { x: 0, y: 1 }, { x: 10, y: 1 });
    addCircle(d, s, { x: 0, y: 0 }, 3);
    addArc(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 });
    addEllipse(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 });
    addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]);
    addControlSpline(d, s, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 1 }], 3);
    addConic(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }, 0.4);
    const c = parseDxfCounts(exportDxf(s));
    expect([c.LINE, c.CIRCLE, c.ARC, c.POLYLINE]).toEqual([2, 1, 1, 4]);
    expect(c.SEQEND).toBe(4);
    expect(c.other).toBe(0);
    expect(c.VERTEX).toBeGreaterThan(40);
  });
  it('writes arcs counter-clockwise in degrees', () => {
    addArc(d, s, { x: 1, y: 2 }, { x: 1, y: 7 }, { x: -4, y: 2 });
    const text = exportDxf(s);
    expect(groups(text, 'ARC', 50)[0]).toBeCloseTo(90);
    expect(groups(text, 'ARC', 51)[0]).toBeCloseTo(180);
    expect(groups(text, 'ARC', 40)[0]).toBeCloseTo(5);
  });
  it('an arc from a trimmed circle keeps its orientation', () => {
    const c = addCircle(d, s, { x: 0, y: 0 }, 5);
    addLine(d, s, { x: -10, y: 0 }, { x: 10, y: 0 }, { lineType: 'construction' });
    trim(d, s, c.id, { x: 0, y: 5 });
    const text = exportDxf(s);
    expect(groups(text, 'ARC', 50)[0]).toBeCloseTo(180);
    expect(groups(text, 'ARC', 51)[0]).toBeCloseTo(0);
  });
  it('filters construction, projected and points unless asked', () => {
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { lineType: 'construction' });
    const p = addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    p.projected = { origin: 'x' };
    addLine(d, s, { x: 0, y: 5 }, { x: 10, y: 5 }, { lineType: 'centerline' });
    addPoint(d, s, { x: 1, y: 1 }, { explicit: true });
    expect(parseDxfCounts(exportDxf(s)).LINE).toBe(1);
    expect(parseDxfCounts(exportDxf(s, { centerlines: false })).LINE).toBe(0);
    expect(parseDxfCounts(exportDxf(s, { construction: true })).LINE).toBe(2);
    expect(parseDxfCounts(exportDxf(s, { projected: true })).LINE).toBe(2);
    expect(parseDxfCounts(exportDxf(s)).POINT).toBe(0);
    expect(parseDxfCounts(exportDxf(s, { points: true })).POINT).toBe(1);
  });
  it('does not export curve-owned points', () => {
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(parseDxfCounts(exportDxf(s, { points: true })).POINT).toBe(0);
  });
  it('scales to the output unit', () => {
    addLine(d, s, { x: 0, y: 0 }, { x: 25.4, y: 0 });
    addCircle(d, s, { x: 0, y: 0 }, 10);
    const text = exportDxf(s, { units: 'in' });
    expect(groups(text, 'LINE', 11)[0]).toBeCloseTo(1);
    expect(groups(text, 'CIRCLE', 40)[0]).toBeCloseTo(10 / 25.4);
    const cm = exportDxf(s, { units: 'cm' });
    expect(groups(cm, 'CIRCLE', 40)[0]).toBeCloseTo(1);
  });
  it('closes polylines for closed curves and leaves open ones open', () => {
    addEllipse(d, s, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 });
    addFitSpline(d, s, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]);
    const text = exportDxf(s);
    expect(groups(text, 'POLYLINE', 70)).toEqual([1, 0]);
  });
  it('declares every layer it uses', () => {
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 }, { lineType: 'construction' });
    const text = exportDxf(s, { construction: true });
    expect(text).toContain('LAYER\r\n  2\r\nCONSTRUCTION');
  });
});

describe('layers', () => {
  const design = () => {
    const d = newDesign();
    const s = newSketch(d);
    d.layers[0].name = 'Base plate';
    d.layers[0].color = '#ff0000';
    addLine(d, s, { x: 0, y: 0 }, { x: 10, y: 0 });
    addLine(d, s, { x: 0, y: 1 }, { x: 10, y: 1 }, { lineType: 'construction' });
    addPoint(d, s, { x: 5, y: 5 }, { explicit: true });
    const top = addLayer(d);
    top.name = 'Holes/Top';
    top.color = '#0000ff';
    addCircle(d, s, { x: 20, y: 0 }, 4);
    return { d, s, top };
  };

  it('names a real DXF layer for each, in the nearest ACI colour', () => {
    const { d, s } = design();
    const text = exportDxf(s, { design: d });
    const table = parseDxfLayers(text);
    expect(table.get('0')).toBe(7);
    expect(table.get('Base_plate')).toBe(1);
    expect(table.get('Holes_Top')).toBe(5);
    const ents = parseDxfEntities(text);
    expect(ents.filter((e) => e.type === 'LINE').map((e) => e.layer)).toEqual(['Base_plate']);
    expect(ents.filter((e) => e.type === 'CIRCLE')[0]).toMatchObject({ layer: 'Holes_Top' });
    expect(ents.filter((e) => e.type === 'CIRCLE')[0].values.get(10)).toBe(20);
    expect(parseDxfCounts(text).wellFormed).toBe(true);
  });

  it('keeps construction and points on sub-layers of their layer', () => {
    const { d, s } = design();
    const text = exportDxf(s, { design: d, construction: true, points: true });
    expect(parseDxfLayers(text).get('Base_plate_CONSTRUCTION')).toBe(1);
    const ents = parseDxfEntities(text);
    expect(ents.filter((e) => e.type === 'LINE').map((e) => e.layer)).toEqual(['Base_plate', 'Base_plate_CONSTRUCTION']);
    expect(ents.filter((e) => e.type === 'POINT').map((e) => e.layer)).toEqual(['Base_plate_POINTS']);
  });

  it('leaves hidden layers out and keeps locked ones', () => {
    const { d, s, top } = design();
    d.layers[1].locked = true;
    top.visible = false;
    const text = exportDxf(s, { design: d });
    expect(parseDxfLayers(text).has('Holes_Top')).toBe(false);
    expect(parseDxfCounts(text)).toMatchObject({ CIRCLE: 0, LINE: 1 });
  });

  it('keeps layer names legal and distinct', () => {
    const d = newDesign();
    const s = newSketch(d);
    d.layers[0].name = 'A B';
    addLayer(d).name = 'A_B';
    addLayer(d).name = 'a b';
    const names = [...parseDxfLayers(exportDxf(s, { design: d })).keys()];
    expect(names).toHaveLength(4);
    expect(new Set(names.map((n) => n.toUpperCase())).size).toBe(4);
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9$_-]+$/);
  });

  it.each([
    ['#ff0000', 1], ['#ffff00', 2], ['#00ff00', 3], ['#00ffff', 4], ['#0000ff', 5], ['#ff00ff', 6], ['#000000', 7], ['#ffffff', 7],
    ['#808080', 9], ['#ff7f7f', 11], ['#a50000', 12],
  ])('maps %s to ACI %i', (hex, aci) => {
    expect(nearestAci(hex)).toBe(aci);
  });
});
