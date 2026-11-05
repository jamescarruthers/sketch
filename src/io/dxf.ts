// R12 ASCII DXF: LINE, CIRCLE, ARC, POINT and POLYLINE only, so any reader can take it.
import type { Curve, Design, Id, Sketch, Vec2 } from '../model/types';
import { getPointPos } from '../model/document';
import { pointLayer } from '../model/layers';
import { flattenParam, resolve } from '../geom/curves';
import { DXF_FLATTEN_TOL } from '../geom/tolerance';
import { textOutlines } from './text';

export type DxfUnits = Design['units'];

export interface DxfOptions {
  /** Output unit; pass the design's by default [ref]. */
  units?: DxfUnits;
  /** Include explicit sketch points. */
  points?: boolean;
  projected?: boolean;
  construction?: boolean;
  /** Centerlines. On unless turned off. */
  centerlines?: boolean;
  /** Chord error for polylines, mm. */
  tolerance?: number;
  /** Supplies {param} substitution in text. */
  design?: Design;
}

const MM_PER_UNIT: Record<DxfUnits, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

/** A layer table entry: name and AutoCAD Color Index. */
interface DxfLayer { name: string; aci: number }

const PLAIN_LAYERS: DxfLayer[] = [
  { name: '0', aci: 7 }, { name: 'CONSTRUCTION', aci: 30 }, { name: 'PROJECTED', aci: 6 }, { name: 'POINTS', aci: 3 },
];

/** ACI 1-255 as RGB: the nine named colours, the 24-hue wheel at five shades, and the greys. */
export function aciPalette(): [number, number, number][] {
  const out: [number, number, number][] = [
    [0, 0, 0], [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255], [65, 65, 65], [128, 128, 128],
  ];
  const shades = [255, 165, 127, 76, 38];
  const hue = (deg: number, v: number, floor: number): [number, number, number] => {
    const at = (n: number): number => {
      const k = (n + deg / 60) % 6;
      return v - (v - floor) * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [Math.round(at(5)), Math.round(at(3)), Math.round(at(1))];
  };
  for (let h = 0; h < 24; h++) {
    for (const v of shades) out.push(hue(h * 15, v, 0), hue(h * 15, v, v / 2));
  }
  for (const v of [51, 91, 132, 173, 214, 255]) out.push([v, v, v]);
  return out;
}

/** Nearest ACI to #rrggbb. Black maps to 7, which is black on paper and white on a dark screen. */
export function nearestAci(color: string): number {
  const n = Number.parseInt(color.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (r + g + b < 60) return 7;
  let best = 7;
  let least = Infinity;
  aciPalette().forEach(([x, y, z], i) => {
    if (i === 0) return;
    const d = (r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2;
    if (d < least) {
      least = d;
      best = i;
    }
  });
  return best;
}

/** R12 layer names take letters, digits, $, - and _ only, and must stay distinct. */
function dxfLayerNames(design: Design): Map<Id, string> {
  const out = new Map<Id, string>();
  const used = new Set<string>(['0']);
  for (const l of design.layers) {
    const stem = l.name.trim().replace(/[^A-Za-z0-9$_-]+/g, '_') || 'Layer';
    let name = stem;
    for (let i = 2; used.has(name.toUpperCase()); i++) name = `${stem}_${i}`;
    used.add(name.toUpperCase());
    out.set(l.id, name);
  }
  return out;
}

class Writer {
  private readonly lines: string[] = [];

  /** One group: a right-aligned code on its line, the value on the next. */
  g(code: number, value: string | number): void {
    this.lines.push(String(code).padStart(3, ' '), String(value));
  }

  n(code: number, value: number): void {
    this.g(code, Number.isInteger(value) ? value.toFixed(1) : value.toFixed(9).replace(/0+$/, ''));
  }

  section(name: string, body: () => void): void {
    this.g(0, 'SECTION');
    this.g(2, name);
    body();
    this.g(0, 'ENDSEC');
  }

  text(): string { return `${this.lines.join('\r\n')}\r\n`; }
}

function plainLayerFor(curve: Curve): string {
  if (curve.projected) return 'PROJECTED';
  return curve.lineType === 'construction' ? 'CONSTRUCTION' : '0';
}

function writeTables(w: Writer, layers: DxfLayer[]): void {
  w.section('TABLES', () => {
    w.g(0, 'TABLE');
    w.g(2, 'LTYPE');
    w.g(70, 1);
    w.g(0, 'LTYPE');
    w.g(2, 'CONTINUOUS');
    w.g(70, 0);
    w.g(3, 'Solid line');
    w.g(72, 65);
    w.g(73, 0);
    w.n(40, 0);
    w.g(0, 'ENDTAB');
    w.g(0, 'TABLE');
    w.g(2, 'LAYER');
    w.g(70, layers.length);
    for (const { name, aci } of layers) {
      w.g(0, 'LAYER');
      w.g(2, name);
      w.g(70, 0);
      w.g(62, aci);
      w.g(6, 'CONTINUOUS');
    }
    w.g(0, 'ENDTAB');
  });
}

function pointGroups(w: Writer, p: Vec2, base = 10): void {
  w.n(base, p.x);
  w.n(base + 10, p.y);
  w.n(base + 20, 0);
}

function polyline(w: Writer, pts: Vec2[], closed: boolean, layer: string): void {
  w.g(0, 'POLYLINE');
  w.g(8, layer);
  w.g(66, 1);
  pointGroups(w, { x: 0, y: 0 });
  w.g(70, closed ? 1 : 0);
  for (const p of pts) {
    w.g(0, 'VERTEX');
    w.g(8, layer);
    pointGroups(w, p);
  }
  w.g(0, 'SEQEND');
  w.g(8, layer);
}

function writeCurve(w: Writer, sketch: Sketch, curve: Curve, layer: string, f: number, tol: number, design: Design | undefined): void {
  const sc = (p: Vec2): Vec2 => ({ x: p.x * f, y: p.y * f });
  if (curve.type === 'text') {
    for (const c of textOutlines(curve, sketch, { tolerance: tol, design })) polyline(w, c.map(sc), true, layer);
    return;
  }
  const pc = resolve(sketch, curve);
  const s = pc.shape;
  if (s.kind === 'line') {
    w.g(0, 'LINE');
    w.g(8, layer);
    pointGroups(w, sc(s.a));
    pointGroups(w, sc(s.b), 11);
    return;
  }
  if (s.kind === 'arc') {
    if (pc.closed) {
      w.g(0, 'CIRCLE');
      w.g(8, layer);
      pointGroups(w, sc(s.c));
      w.n(40, s.r * f);
      return;
    }
    const deg = (a: number): number => (((a * 180) / Math.PI) % 360 + 360) % 360;
    w.g(0, 'ARC');
    w.g(8, layer);
    pointGroups(w, sc(s.c));
    w.n(40, s.r * f);
    w.n(50, deg(s.start));
    w.n(51, deg(s.start + s.sweep));
    return;
  }
  const pts = flattenParam(pc, tol).pts;
  if (pc.closed) pts.pop();
  polyline(w, pts.map(sc), pc.closed, layer);
}

/**
 * Export a sketch to R12 ASCII DXF text. Coordinates are written in `units`. With `design`, each
 * layer of it becomes a named DXF layer in its nearest ACI colour, and hidden layers stay out. A
 * layer's construction, projected geometry and points go on `<name>_CONSTRUCTION` and so on.
 */
export function exportDxf(sketch: Sketch, opts: DxfOptions = {}): string {
  const { design } = opts;
  const names = design ? dxfLayerNames(design) : null;
  const shown = design ? new Set(design.layers.filter((l) => l.visible).map((l) => l.id)) : null;
  const colors = new Map(design?.layers.map((l) => [l.id, nearestAci(l.color)]) ?? []);
  const table = new Map<string, number>(names ? [['0', 7]] : PLAIN_LAYERS.map((l) => [l.name, l.aci]));
  const named = (layer: Id | null | undefined, suffix: string): string => {
    const stem = layer ? names?.get(layer) : undefined;
    if (!stem || !layer) return '0';
    const name = `${stem}${suffix}`;
    table.set(name, colors.get(layer) ?? 7);
    return name;
  };
  for (const id of shown ?? []) named(id, '');
  const layerFor = (c: Curve): string => {
    if (!names) return plainLayerFor(c);
    return named(c.layer, c.projected ? '_PROJECTED' : c.lineType === 'construction' ? '_CONSTRUCTION' : '');
  };
  const curves = Object.values(sketch.curves).filter((c) => !shown || shown.has(c.layer));
  const included = curves.filter((c) => (c.lineType !== 'construction' || opts.construction)
    && (c.lineType !== 'centerline' || opts.centerlines !== false) && (!c.projected || opts.projected));
  const pointLayers = new Map<Id, string>();
  if (opts.points) {
    for (const p of Object.values(sketch.points)) {
      if (!p.explicit) continue;
      const l = pointLayer(sketch, p);
      if (shown && (!l || !shown.has(l))) continue;
      pointLayers.set(p.id, names ? named(l, '_POINTS') : 'POINTS');
    }
  }
  const entityLayers = new Map(included.map((c) => [c.id, layerFor(c)]));
  const units = opts.units ?? 'mm';
  const f = 1 / MM_PER_UNIT[units];
  const tol = opts.tolerance ?? DXF_FLATTEN_TOL;
  const w = new Writer();
  w.g(999, `Sketch ${sketch.name}, units ${units}`);
  w.section('HEADER', () => {
    w.g(9, '$ACADVER');
    w.g(1, 'AC1009');
  });
  writeTables(w, [...table].map(([name, aci]) => ({ name, aci })));
  w.section('BLOCKS', () => {});
  w.section('ENTITIES', () => {
    for (const c of included) writeCurve(w, sketch, c, entityLayers.get(c.id) as string, f, tol, design);
    for (const [id, layer] of pointLayers) {
      const pos = getPointPos(sketch, id);
      w.g(0, 'POINT');
      w.g(8, layer);
      pointGroups(w, { x: pos.x * f, y: pos.y * f });
    }
  });
  w.g(0, 'EOF');
  return w.text();
}

export { parseDxfCounts, parseDxfEntities, parseDxfLayers, type DxfCounts, type DxfEntity } from './dxf-parse';
