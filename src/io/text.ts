// Text outlines through opentype.js. Layout is glyph by glyph on purpose: Font.getPath runs string
// shaping, which throws on Inter's GSUB tables.
import { parse, type Font, type Glyph, type PathCommand } from 'opentype.js';
import type { Curve, Design, Id, Sketch, TextEntity, Vec2 } from '../model/types';
import { addConstraint, addControlSpline, addLine, allocId, deleteEntities, getPointPos } from '../model/document';
import { lengthBetween, lengthOf, flattenParam, resolve, reversed, unitTangent, type ParamCurve } from '../geom/curves';
import { EPS_CHORD, EPS_POINT, EPS_ZERO, TEXT_FLATTEN_TOL } from '../geom/tolerance';
import { add, dist, len, lerp, norm, perp, rotateAbout, scale, sub } from '../geom/vec';
import { evaluateInDesign, textParameters } from '../model/parameters';

const fonts = new Map<string, Font>();
const fontKey = (family: string, bold: boolean, italic: boolean): string => `${family}|${bold ? 'b' : ''}${italic ? 'i' : ''}`;

/** Register one weight and style of a family from a .ttf, .otf or .woff file's bytes. */
export function registerFont(family: string, bold: boolean, italic: boolean, data: ArrayBuffer): void {
  fonts.set(fontKey(family, bold, italic), parse(data));
}

/** Registered family names, without duplicates, in registration order. */
export function fontFamilies(): string[] {
  return [...new Set([...fonts.keys()].map((k) => k.split('|')[0]))];
}

function findFont(entity: TextEntity): Font | undefined {
  return fonts.get(fontKey(entity.font, entity.bold, entity.italic)) ?? fonts.get(fontKey(entity.font, false, false));
}

/** True once the entity's font can be drawn. Until then textOutlines returns nothing. */
export const fontReady = (entity: TextEntity): boolean => findFont(entity) !== undefined;

/**
 * Replace {name} by a text parameter's text, or the value of a parameter, dimension or expression
 * [ref SKT-CREATE-TEXT]. Text can name text that names text; a name that leads back to itself, and an
 * unknown name, stay as written.
 */
export function substituteText(text: string, design: Design | undefined): string {
  return design ? expandText(text, design, textParameters(design), new Set()) : text;
}

function expandText(text: string, design: Design, named: Map<string, string>, within: Set<string>): string {
  return text.replace(/\{([^{}]+)\}/g, (whole, inner: string) => {
    const name = inner.trim();
    const value = named.get(name);
    if (value !== undefined) return within.has(name) ? whole : expandText(value, design, named, new Set([...within, name]));
    const r = evaluateInDesign(design, name, 'number');
    if (!r.ok) return whole;
    const v = r.kind === 'angle' ? (r.value * 180) / Math.PI : r.value;
    return String(Number(v.toFixed(4)));
  });
}

/** One glyph outline span, in sketch space. Quadratics are elevated, so cubics are the only curve. */
export type OutlineSeg = { kind: 'L'; a: Vec2; b: Vec2 } | { kind: 'C'; a: Vec2; c1: Vec2; c2: Vec2; b: Vec2 };
export type Contour = OutlineSeg[];

type Xf = (p: Vec2) => Vec2;

/** Glyph contours in em units with y up; opentype paths are y down. */
function glyphContours(glyph: Glyph, unitsPerEm: number): Contour[] {
  const cmds: PathCommand[] = glyph.getPath(0, 0, unitsPerEm).commands;
  const pt = (x = 0, y = 0): Vec2 => ({ x, y: -y });
  const out: Contour[] = [];
  let cur: Contour = [];
  let at: Vec2 = { x: 0, y: 0 };
  let start = at;
  const close = (): void => {
    if (dist(at, start) > EPS_CHORD) cur.push({ kind: 'L', a: at, b: start });
    if (cur.length) out.push(cur);
    cur = [];
  };
  for (const c of cmds) {
    if (c.type === 'M') {
      if (cur.length) close();
      at = pt(c.x, c.y);
      start = at;
    } else if (c.type === 'L') {
      const b = pt(c.x, c.y);
      if (dist(at, b) > EPS_CHORD) cur.push({ kind: 'L', a: at, b });
      at = b;
    } else if (c.type === 'Q') {
      const q = pt(c.x1, c.y1);
      const b = pt(c.x, c.y);
      cur.push({ kind: 'C', a: at, c1: lerp(at, q, 2 / 3), c2: lerp(b, q, 2 / 3), b });
      at = b;
    } else if (c.type === 'C') {
      const b = pt(c.x, c.y);
      cur.push({ kind: 'C', a: at, c1: pt(c.x1, c.y1), c2: pt(c.x2, c.y2), b });
      at = b;
    } else {
      close();
    }
  }
  if (cur.length) close();
  return out;
}

const mapContour = (c: Contour, f: Xf): Contour => c.map((s) => (s.kind === 'L'
  ? { kind: 'L', a: f(s.a), b: f(s.b) }
  : { kind: 'C', a: f(s.a), c1: f(s.c1), c2: f(s.c2), b: f(s.b) }));

function capHeight(font: Font): number {
  return font.tables.os2?.sCapHeight || font.ascender * 0.72;
}

interface Placed { glyph: Glyph; x: number; width: number }

/** Lay a line along x in font units. spacing is a percentage of each glyph's advance [ref]. */
function layoutLine(font: Font, text: string, spacing: number): { glyphs: Placed[]; width: number } {
  const glyphs: Placed[] = [];
  let x = 0;
  let prev: Glyph | null = null;
  for (const ch of Array.from(text)) {
    const glyph = font.charToGlyph(ch);
    if (prev) x += font.getKerningValue(prev, glyph);
    const advance = glyph.advanceWidth ?? font.unitsPerEm / 2;
    glyphs.push({ glyph, x, width: advance });
    x += advance * (1 + spacing / 100);
    prev = glyph;
  }
  return { glyphs, width: x };
}

/** Break one line at spaces to fit `width` in font units [ref text-multiline.png]. A word too long for a line breaks anywhere. */
function wrapLine(font: Font, line: string, spacing: number, width: number): string[] {
  const fits = (t: string): boolean => layoutLine(font, t, spacing).width <= width;
  if (!(width > 0) || fits(line)) return [line];
  const out: string[] = [];
  let cur = '';
  for (const word of line.split(/(?<=\s)/)) {
    if (fits((cur + word).trimEnd())) {
      cur += word;
      continue;
    }
    if (cur) out.push(cur.trimEnd());
    cur = '';
    for (const ch of Array.from(word)) {
      if (cur && !fits((cur + ch).trimEnd())) {
        out.push(cur);
        cur = '';
      }
      cur += ch;
    }
  }
  if (cur.trim() || !out.length) out.push(cur.trimEnd());
  return out;
}

function frameContours(entity: TextEntity, sketch: Sketch, font: Font, text: string): Contour[] {
  if (!entity.frame) return [];
  const [p0, p1, , p3] = entity.frame.map((id) => getPointPos(sketch, id));
  const ux = sub(p1, p0);
  const uy = sub(p3, p0);
  const W = len(ux);
  const H = len(uy);
  const ex = norm(ux);
  const ey = norm(uy);
  const k = entity.height / capHeight(font);
  const lines = text.split('\n').flatMap((line) => wrapLine(font, line, entity.spacing, W / k));
  const lead = (font.ascender - font.descender) * k;
  const block = entity.height + (lines.length - 1) * lead;
  const contours: Contour[] = [];
  lines.forEach((line, i) => {
    const laid = layoutLine(font, line, entity.spacing);
    const lw = laid.width * k;
    const left = entity.halign === 'left' ? 0 : entity.halign === 'center' ? (W - lw) / 2 : W - lw;
    const top = entity.valign === 'top' ? H : entity.valign === 'middle' ? (H + block) / 2 : block;
    const baseline = top - entity.height - i * lead;
    for (const g of laid.glyphs) {
      const f: Xf = (p) => {
        let x = left + (g.x + p.x) * k;
        let y = baseline + p.y * k;
        if (entity.flipH) x = W - x;
        if (entity.flipV) y = H - y;
        return add(p0, add(scale(ex, x), scale(ey, y)));
      };
      for (const c of glyphContours(g.glyph, font.unitsPerEm)) contours.push(mapContour(c, f));
    }
  });
  return contours;
}

/** Text reads left to right: follow the path in whichever direction makes that so. */
function readingDirection(pc: ParamCurve): ParamCurve {
  const s = pc.shape;
  if (s.kind === 'arc' || s.kind === 'ellipse') return s.sweep > 0 ? reversed(pc) : pc;
  return pc.closed || pc.at(1).x >= pc.at(0).x ? pc : reversed(pc);
}

/** Parameter at arc length s, from a cumulative table. */
function lengthTable(pc: ParamCurve): (s: number) => number {
  const flat = flattenParam(pc, TEXT_FLATTEN_TOL);
  const acc = [0];
  for (let i = 1; i < flat.pts.length; i++) acc.push(acc[i - 1] + lengthBetween(pc, flat.ts[i - 1], flat.ts[i]));
  return (s) => {
    const x = Math.max(0, Math.min(s, acc[acc.length - 1]));
    let lo = 0;
    let hi = acc.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (acc[m] <= x) lo = m;
      else hi = m;
    }
    const span = acc[hi] - acc[lo];
    return flat.ts[lo] + (span > EPS_ZERO ? ((x - acc[lo]) / span) * (flat.ts[hi] - flat.ts[lo]) : 0);
  };
}

function pathContours(entity: TextEntity, sketch: Sketch, font: Font, text: string): Contour[] {
  const target = entity.path ? sketch.curves[entity.path] : undefined;
  if (!target || target.type === 'text') return [];
  let pc = readingDirection(resolve(sketch, target));
  if (entity.flipH) pc = reversed(pc);
  const L = lengthOf(pc);
  const table = lengthTable(pc);
  // A closed path has no end: position wraps round, so a moved text cannot run off it.
  const paramAt = (s: number): number => table(pc.closed ? ((s % L) + L) % L : s);
  const k = entity.height / capHeight(font);
  const laid = layoutLine(font, text.replace(/\n/g, ' '), entity.spacing);
  const count = laid.glyphs.length;
  if (count === 0) return [];

  const natural = laid.width * k;
  const fit = !!entity.fitToPath;
  const gap = fit ? (L - laid.glyphs.reduce((t, g) => t + g.width * k, 0)) / Math.max(1, pc.closed ? count : count - 1) : 0;
  let start = 0;
  if (!fit) start = entity.halign === 'left' ? 0 : entity.halign === 'center' ? (L - natural) / 2 : L - natural;
  // A circle runs clockwise from +X. Text reads over the top [ref text-on-path.png]: left starts at
  // nine o'clock, centre sits on twelve, right ends at three.
  if (pc.closed && pc.shape.kind === 'arc' && !entity.flipH) {
    start = entity.halign === 'left' || fit ? L / 2 : entity.halign === 'center' ? (3 * L) / 4 - natural / 2 : L - natural;
  }
  start += entity.offset ?? 0;
  // Below the path, the cap line sits on it.
  const above = entity.above ?? true;
  const lift = above ? 0 : -entity.height;
  const up = entity.flipV ? -1 : 1;

  const contours: Contour[] = [];
  let cursor = 0;
  for (const g of laid.glyphs) {
    const width = g.width * k;
    const mid = fit ? start + cursor + width / 2 : start + (g.x * k) + width / 2;
    cursor += width + gap;
    const t = paramAt(mid);
    const origin = pc.at(t);
    const tan = unitTangent(pc, t);
    const nor = perp(tan);
    const f: Xf = (p) => {
      const x = p.x * k - width / 2;
      const y = (p.y * k + lift) * up;
      return add(origin, add(scale(tan, x), scale(nor, y)));
    };
    for (const c of glyphContours(g.glyph, font.unitsPerEm)) contours.push(mapContour(c, f));
  }
  return contours;
}

/** How far along a text's path the point nearest `p` is. */
function distanceAlong(flat: Vec2[], acc: number[], p: Vec2): number {
  let best = { d: Infinity, s: 0 };
  for (let i = 0; i + 1 < flat.length; i++) {
    const a = flat[i];
    const ab = sub(flat[i + 1], a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2)) : 0;
    const d = dist(p, add(a, scale(ab, t)));
    if (d < best.d) best = { d, s: acc[i] + t * (acc[i + 1] - acc[i]) };
  }
  return best.s;
}

/** Move text on a path by the travel along it from one position to another [ref SKT-CREATE-TEXT tip]. */
export function slideOnPath(entity: TextEntity, sketch: Sketch, from: Vec2, to: Vec2): void {
  const target = entity.path ? sketch.curves[entity.path] : undefined;
  if (!target || target.type === 'text') return;
  let pc = readingDirection(resolve(sketch, target));
  if (entity.flipH) pc = reversed(pc);
  const { pts } = flattenParam(pc, TEXT_FLATTEN_TOL);
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + dist(pts[i - 1], pts[i]));
  const L = acc[acc.length - 1];
  let ds = distanceAlong(pts, acc, to) - distanceAlong(pts, acc, from);
  if (pc.closed) ds = ((ds + L * 1.5) % L) - L / 2;
  entity.offset = (entity.offset ?? 0) + ds;
}

/** Text on a path has no points of its own: Move/Copy carries it along the path instead [ref]. */
export function slidePathText(sketch: Sketch, ids: Id[], spec: { dx?: number; dy?: number; angle?: number; pivot?: Vec2 }): void {
  for (const id of ids) {
    const t = sketch.curves[id];
    if (t?.type !== 'text' || t.mode !== 'path' || !t.path || ids.includes(t.path)) continue;
    const target = sketch.curves[t.path];
    if (!target || target.type === 'text') continue;
    const from = resolve(sketch, target).at(0.25);
    const turned = spec.angle && spec.pivot ? rotateAbout(from, spec.pivot, spec.angle) : from;
    slideOnPath(t, sketch, from, add(turned, { x: spec.dx ?? 0, y: spec.dy ?? 0 }));
  }
}

/**
 * Keep every frame text's four edges as construction lines on its corner points, so the frame is
 * always shown, and takes picks, snaps, dimensions and constraints like any line [ref text-frame.gif].
 * Whatever copied, pasted or deleted the text, this puts the lines right. True when anything changed.
 */
export function syncFrameEdges(design: Design, sketch: Sketch): boolean {
  let changed = false;
  const orphans: Id[] = [];
  const have = new Map<Id, Set<Id>>();
  for (const c of Object.values(sketch.curves)) {
    if (c.type !== 'line' || !c.frameOf) continue;
    const owner = sketch.curves[c.frameOf];
    if (owner?.type === 'text' && owner.frame?.includes(c.a) && owner.frame.includes(c.b)) {
      have.set(owner.id, (have.get(owner.id) ?? new Set()).add(c.a));
    } else if (sketch.points[c.a]?.owner === c.id) {
      // A copy of an edge is a plain line with its own points.
      delete c.frameOf;
      changed = true;
    } else orphans.push(c.id);
  }
  if (orphans.length) {
    deleteEntities(sketch, orphans);
    changed = true;
  }
  for (const c of Object.values(sketch.curves)) {
    if (c.type !== 'text' || !c.frame) continue;
    c.frame.forEach((a, i) => {
      if (have.get(c.id)?.has(a)) return;
      const id = allocId(design, 'l');
      sketch.curves[id] = { id, type: 'line', lineType: 'construction', layer: c.layer, a, b: (c.frame as Id[])[(i + 1) % 4], frameOf: c.id };
      changed = true;
    });
  }
  return changed;
}

export interface TextOptions {
  /** Supplies {param} substitution. */
  design?: Design;
}

/** Outlines as editable spans, in sketch space. Empty when the font is not loaded. */
export function textContours(entity: TextEntity, sketch: Sketch, opts: TextOptions = {}): Contour[] {
  const font = findFont(entity);
  if (!font) return [];
  const text = substituteText(entity.text, opts.design);
  return entity.mode === 'frame' ? frameContours(entity, sketch, font, text) : pathContours(entity, sketch, font, text);
}

function flattenCubic(s: Extract<OutlineSeg, { kind: 'C' }>, tol: number, out: Vec2[]): void {
  const bow = Math.max(dist(s.c1, lerp(s.a, s.b, 1 / 3)), dist(s.c2, lerp(s.a, s.b, 2 / 3)));
  const n = Math.min(32, Math.max(1, Math.ceil(Math.sqrt(bow / tol))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;
    out.push({
      x: b0 * s.a.x + b1 * s.c1.x + b2 * s.c2.x + b3 * s.b.x,
      y: b0 * s.a.y + b1 * s.c1.y + b2 * s.c2.y + b3 * s.b.y,
    });
  }
}

/**
 * Closed glyph polylines in sketch space, last point not repeated. Fill them together with the
 * non-zero rule to get counters right. Empty when the font is not loaded.
 */
export function textOutlines(entity: TextEntity, sketch: Sketch, opts: TextOptions & { tolerance?: number } = {}): Vec2[][] {
  const tol = opts.tolerance ?? TEXT_FLATTEN_TOL;
  return textContours(entity, sketch, opts).map((contour) => {
    const pts: Vec2[] = [contour[0].a];
    for (const s of contour) {
      if (s.kind === 'L') pts.push(s.b);
      else flattenCubic(s, tol, pts);
    }
    if (dist(pts[0], pts[pts.length - 1]) < EPS_POINT) pts.pop();
    return pts;
  });
}

/**
 * Explode text into fixed sketch geometry [ref SKT-EXPLODE-TEXT]: lines and degree 3 control splines,
 * every point fixed. Returns created curve ids; empty, leaving the text, if its font is not loaded.
 */
export function explodeText(design: Design, sketch: Sketch, id: Id, opts: TextOptions = {}): Id[] {
  const entity = sketch.curves[id];
  if (entity?.type !== 'text' || !fontReady(entity)) return [];
  const contours = textContours(entity, sketch, { design, ...opts });
  const lineType = entity.lineType;
  const created: Id[] = [];
  for (const contour of contours) {
    const curves: { curve: Curve; head: Id; tail: Id }[] = [];
    for (const s of contour) {
      if (s.kind === 'L') {
        const c = addLine(design, sketch, s.a, s.b, { lineType });
        curves.push({ curve: c, head: c.a, tail: c.b });
      } else {
        const c = addControlSpline(design, sketch, [s.a, s.c1, s.c2, s.b], 3, { lineType });
        curves.push({ curve: c, head: c.pts[0], tail: c.pts[3] });
      }
    }
    curves.forEach((c, i) => {
      c.curve.fixed = true;
      created.push(c.curve.id);
      addConstraint(design, sketch, 'coincident', [c.tail, curves[(i + 1) % curves.length].head]);
    });
  }
  for (const cid of created) {
    for (const p of Object.values(sketch.points)) if (p.owner === cid) p.fixed = true;
  }
  deleteEntities(sketch, [id]);
  return created;
}
