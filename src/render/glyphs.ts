// Constraint badges, inference marks and the origin glyph, all drawn at screen size.
import type { Constraint, ConstraintType, Curve, Feature, Id, Sketch, Vec2 } from '../model/types';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import { coincidentClasses, curveEnds, curvePoints, getPointPos } from '../model/document';
import { resolve, unitTangent } from '../geom/curves';
import { add, len, norm, perp, scale, sub } from '../geom/vec';
import type { View } from '../app/view';
import type { InferenceKind } from '../app/snap';
import { COLORS } from './style';

export const BADGE = 15;

export type GlyphKind = ConstraintType | 'fix' | 'perp-corner' | 'offset' | 'pattern' | 'mirror';

/** Stroke a small symbol centred on 0,0, about 9 px across. */
function symbol(g: CanvasRenderingContext2D, kind: GlyphKind): void {
  g.beginPath();
  switch (kind) {
    case 'horizontal':
      g.moveTo(-4.5, 0); g.lineTo(4.5, 0);
      break;
    case 'vertical':
      g.moveTo(0, -4.5); g.lineTo(0, 4.5);
      break;
    case 'parallel':
      g.moveTo(-1.5, 4.5); g.lineTo(2.5, -4.5);
      g.moveTo(-3.5 + 0, 4.5 - 0); g.lineTo(0.5, -4.5);
      g.moveTo(1.5, 4.5); g.lineTo(5, -3);
      break;
    case 'perpendicular': case 'perp-corner':
      g.moveTo(-4.5, 4); g.lineTo(4.5, 4);
      g.moveTo(0, 4); g.lineTo(0, -4.5);
      break;
    case 'tangent':
      g.arc(0, 1.5, 3.2, 0, Math.PI * 2);
      g.moveTo(-5, -2.6); g.lineTo(5, -2.6);
      break;
    case 'equal':
      g.moveTo(-4, -2); g.lineTo(4, -2);
      g.moveTo(-4, 2); g.lineTo(4, 2);
      break;
    case 'midpoint':
      g.moveTo(0, -4); g.lineTo(4.4, 3.4); g.lineTo(-4.4, 3.4); g.closePath();
      break;
    case 'concentric':
      g.arc(0, 0, 4.4, 0, Math.PI * 2);
      g.moveTo(2, 0);
      g.arc(0, 0, 2, 0, Math.PI * 2);
      break;
    case 'collinear':
      g.moveTo(-5, 3.4); g.lineTo(5, -3.4);
      g.moveTo(-1, 0.6); g.arc(-1.8, 1.2, 1, 0, Math.PI * 2);
      break;
    case 'symmetric':
      g.moveTo(0, -5); g.lineTo(0, 5);
      g.moveTo(-5, -2); g.lineTo(-2, 0); g.lineTo(-5, 2);
      g.moveTo(5, -2); g.lineTo(2, 0); g.lineTo(5, 2);
      break;
    case 'curvature':
      g.moveTo(-5, 3); g.quadraticCurveTo(-1, 3, 0, 0); g.quadraticCurveTo(1, -3, 5, -3);
      break;
    case 'coincident':
      g.moveTo(-4.5, 3); g.lineTo(4.5, 3);
      g.moveTo(1.6, -0.6); g.arc(0, -0.6, 1.6, 0, Math.PI * 2);
      break;
    case 'offset':
      g.moveTo(-4.5, 4); g.quadraticCurveTo(-4.5, -3.5, 4.5, -3.5);
      g.moveTo(-1, 4.5); g.quadraticCurveTo(-1, 0, 4.5, 0);
      break;
    case 'pattern':
      g.rect(-4.5, -4.5, 3.4, 3.4); g.rect(1.1, -4.5, 3.4, 3.4);
      g.rect(-4.5, 1.1, 3.4, 3.4); g.rect(1.1, 1.1, 3.4, 3.4);
      break;
    case 'mirror':
      g.moveTo(0, -5); g.lineTo(0, 5);
      g.moveTo(-1.8, 3.5); g.lineTo(-5, 3.5); g.lineTo(-1.8, -3); g.closePath();
      g.moveTo(1.8, 3.5); g.lineTo(5, 3.5); g.lineTo(1.8, -3); g.closePath();
      break;
    case 'fix':
      g.rect(-3.5, -0.5, 7, 5);
      g.moveTo(-2, -0.5); g.arc(0, -0.5, 2, Math.PI, 0, false);
      break;
    default:
      g.arc(0, 0, 2, 0, Math.PI * 2);
  }
  g.stroke();
}

/** `cross`: it ties two layers together, so it reads apart from the rest. `bad`: the link is broken. */
export function drawBadge(
  g: CanvasRenderingContext2D, kind: GlyphKind, x: number, y: number, state: 'idle' | 'hover' | 'selected',
  mark: { cross?: boolean; bad?: boolean } = {},
): void {
  const r = BADGE / 2;
  const idleFill = mark.bad ? COLORS.badgeBadFill : mark.cross ? COLORS.badgeCrossFill : COLORS.badgeFill;
  const idleEdge = mark.bad ? COLORS.error : mark.cross ? COLORS.cross : COLORS.badgeEdge;
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.setLineDash([]);
  g.fillStyle = state === 'selected' ? COLORS.badgeSelectedFill : state === 'hover' ? COLORS.badgeHoverFill : idleFill;
  g.strokeStyle = state === 'idle' ? idleEdge : COLORS.selected;
  g.lineWidth = mark.cross ? 1.4 : 1;
  g.beginPath();
  g.roundRect(-r + 0.5, -r + 0.5, BADGE - 1, BADGE - 1, 2.5);
  g.fill();
  g.stroke();
  g.strokeStyle = mark.bad ? COLORS.error : COLORS.badgeInk;
  g.lineWidth = 1.2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  symbol(g, kind);
  if (mark.cross) {
    // A notch in the corner: a link to something off this layer.
    g.fillStyle = mark.bad ? COLORS.error : COLORS.cross;
    g.beginPath();
    g.moveTo(r - 5.5, -r + 0.5);
    g.lineTo(r - 0.5, -r + 0.5);
    g.lineTo(r - 0.5, -r + 5.5);
    g.closePath();
    g.fill();
  }
  g.restore();
}

const INFERENCE_GLYPH: Partial<Record<InferenceKind, GlyphKind>> = {
  midpoint: 'midpoint', onCurve: 'coincident', quadrant: 'coincident', tangent: 'tangent',
  horizontal: 'horizontal', vertical: 'vertical', perpendicular: 'perp-corner', parallel: 'parallel',
};

/** Near the cursor. A snapped point gets a highlighted dot rather than a glyph [ref]. */
export function drawInference(g: CanvasRenderingContext2D, kind: InferenceKind, at: Vec2, cursor: Vec2): void {
  if (kind === 'point') {
    g.save();
    g.fillStyle = COLORS.snapHalo;
    g.beginPath();
    g.arc(at.x, at.y, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = COLORS.selected;
    g.strokeStyle = COLORS.snapRing;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(at.x, at.y, 4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
    return;
  }
  if (kind === 'grid') {
    // A small cross on the grid intersection, like the object snaps [ref SKT-CREATE-LINES].
    g.save();
    g.strokeStyle = COLORS.selected;
    g.lineWidth = 1.5;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(at.x - 5, at.y);
    g.lineTo(at.x + 5, at.y);
    g.moveTo(at.x, at.y - 5);
    g.lineTo(at.x, at.y + 5);
    g.stroke();
    g.restore();
    return;
  }
  const glyph = INFERENCE_GLYPH[kind];
  if (kind === 'quadrant' || kind === 'midpoint' || kind === 'onCurve' || kind === 'tangent') {
    g.save();
    g.fillStyle = COLORS.selected;
    g.beginPath();
    g.arc(at.x, at.y, 3, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  if (glyph) drawBadge(g, glyph, cursor.x + 18, cursor.y + 18, 'selected');
}

/** A circle with two shaded quadrants [ref]. */
export function drawOrigin(g: CanvasRenderingContext2D, at: Vec2, highlighted: boolean): void {
  const r = 7;
  g.save();
  g.translate(Math.round(at.x), Math.round(at.y));
  g.fillStyle = COLORS.originFill;
  g.strokeStyle = highlighted ? COLORS.selected : COLORS.originInk;
  g.lineWidth = highlighted ? 2 : 1.25;
  g.setLineDash([]);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.originInk;
  for (const start of [-Math.PI / 2, Math.PI / 2]) {
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, r, start, start + Math.PI / 2);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/** `constraint` is the constraint's id, or the feature's when `feature` is set. */
export interface Badge {
  constraint: Id; type: GlyphKind; x: number; y: number; feature?: boolean;
  /** Spans layers. */
  cross?: boolean;
}

/** Which glyphs to lay out. Default all. */
export interface BadgeFilter {
  constraint(k: Constraint): boolean;
  feature(f: Feature): boolean;
}

function midOf(sketch: Sketch, curve: Curve): { p: Vec2; n: Vec2; t: Vec2 } {
  const pc = resolve(sketch, curve);
  const at = pc.shape.kind === 'arc' && pc.closed ? 0.125 : 0.5;
  const t = unitTangent(pc, at);
  return { p: pc.at(at), t, n: perp(t) };
}

function refPos(sketch: Sketch, id: Id): Vec2 | null {
  if (id === ORIGIN) return { x: 0, y: 0 };
  return sketch.points[id] ? getPointPos(sketch, id) : null;
}

function contactPoint(sketch: Sketch, a: Curve, b: Curve): Vec2 | null {
  const ids = new Set(curvePoints(a));
  for (const id of curvePoints(b)) if (ids.has(id)) return getPointPos(sketch, id);
  // Ends joined by a coincident, as a blend's are: the badge belongs at the join.
  const rep = coincidentClasses(sketch);
  const ends = (c: Curve): Id[] => curveEnds(c) ?? [];
  for (const p of ends(a)) for (const q of ends(b)) if (rep(p) === rep(q)) return getPointPos(sketch, p);
  return null;
}

/**
 * Where each constraint's badges go, in screen space. Badges on one curve stack along it; feature
 * constraints and point-to-point coincidents are not shown [ref].
 */
export function layoutBadges(sketch: Sketch, view: View, filter?: BadgeFilter): Badge[] {
  const out: Badge[] = [];
  const stack = new Map<string, number>();
  /** One glyph per type per place: a polygon's first edge equal to all the rest shows one equal sign. */
  const shown = new Set<string>();
  const place = (k: Constraint, key: string, base: Vec2, along: Vec2, side: Vec2): void => {
    const once = `${key}|${k.type}`;
    if (k.type !== 'equal' || k.refs.length > 0) {
      if (shown.has(once)) return;
      shown.add(once);
    }
    const n = stack.get(key) ?? 0;
    stack.set(key, n + 1);
    const s = view.toScreen(base);
    const toS = (v: Vec2): Vec2 => ({ x: v.x, y: -v.y });
    const offset = add(scale(toS(side), BADGE + 1), scale(toS(along), (n - 0) * (BADGE + 2)));
    const badge: Badge = { constraint: k.id, type: k.type, x: s.x + offset.x, y: s.y + offset.y };
    if (k.dependentLayer) badge.cross = true;
    out.push(badge);
  };
  const onCurve = (k: Constraint, id: Id): void => {
    const c = sketch.curves[id];
    if (!c || c.type === 'text') return;
    const m = midOf(sketch, c);
    // Equal sits on the rim of a circle, not inside it [ref SKT-CONSTRAIN-EQUAL].
    place(k, id, m.p, m.t, k.type === 'equal' && c.type === 'circle' ? { x: 0, y: 0 } : m.n);
  };
  const atPoint = (k: Constraint, p: Vec2, key: string): void => {
    place(k, key, p, { x: 1, y: 0 }, norm({ x: 1, y: 1 }));
  };

  for (const k of Object.values(sketch.constraints)) {
    if (k.feature || (filter && !filter.constraint(k))) continue;
    const [r0, r1] = k.refs;
    switch (k.type) {
      case 'coincident': {
        const p = refPos(sketch, r0) ?? refPos(sketch, r1);
        const otherIsPoint = refPos(sketch, r0) && refPos(sketch, r1);
        // A join across layers shows, or there would be nothing to select and delete it by.
        if (p && (!otherIsPoint || k.dependentLayer)) atPoint(k, p, `${p.x.toFixed(4)},${p.y.toFixed(4)}`);
        break;
      }
      case 'midpoint': {
        const p = refPos(sketch, r0) ?? refPos(sketch, r1);
        if (p) atPoint(k, p, `${p.x.toFixed(4)},${p.y.toFixed(4)}`);
        break;
      }
      case 'horizontal': case 'vertical':
        if (k.refs.length === 1) onCurve(k, r0);
        else {
          // One on each point [ref 1-25].
          for (const id of [r0, r1]) {
            const q = id === ORIGIN ? null : refPos(sketch, id);
            if (q) atPoint(k, q, `${q.x.toFixed(4)},${q.y.toFixed(4)}`);
          }
        }
        break;
      case 'tangent': case 'curvature': {
        const a = sketch.curves[r0];
        const b = sketch.curves[r1];
        const shared = a && b ? contactPoint(sketch, a, b) : null;
        if (shared) atPoint(k, shared, `${shared.x.toFixed(4)},${shared.y.toFixed(4)}`);
        else {
          onCurve(k, r0);
          onCurve(k, r1);
        }
        break;
      }
      case 'symmetric':
        for (const id of k.refs.slice(0, 2)) {
          const p = refPos(sketch, id);
          if (p) atPoint(k, p, `${p.x.toFixed(4)},${p.y.toFixed(4)}`);
          else onCurve(k, id);
        }
        break;
      case 'offsetCopy': case 'rotatedCopy': break;
      default:
        for (const id of k.refs) if (id !== AXIS_X && id !== AXIS_Y) onCurve(k, id);
    }
  }
  for (const f of Object.values(sketch.features)) {
    if (filter && !filter.feature(f)) continue;
    if (f.type === 'circPattern') {
      // At the centre of the pattern, beside the point so both can be reached [ref circular-pattern.png].
      const at = refPos(sketch, f.center);
      if (!at) continue;
      const before = out.length;
      atPoint({ id: f.id, type: 'equal', refs: [] }, at, `${at.x.toFixed(4)},${at.y.toFixed(4)}`);
      out[before].type = 'pattern';
      out[before].feature = true;
      continue;
    }
    const id = f.type === 'offset' ? f.outputs[0] : f.type === 'mirror' ? f.pairs[0]?.[1] : f.sources[0];
    const c = id ? sketch.curves[id] : undefined;
    if (!c || c.type === 'text') continue;
    const m = midOf(sketch, c);
    const before = out.length;
    place({ id: f.id, type: 'equal', refs: [] }, c.id, m.p, m.t, m.n);
    const glyph: GlyphKind = f.type === 'offset' ? 'offset' : f.type === 'mirror' ? 'mirror' : 'pattern';
    out[before].type = glyph;
    out[before].feature = true;
    // On the original too [ref SKT-SKETCH-MODIFY-TOOLS].
    const source = f.type === 'offset' ? sketch.curves[f.sources[0]] : undefined;
    if (source && source.type !== 'text') {
      const n = midOf(sketch, source);
      place({ id: f.id, type: 'equal', refs: [] }, source.id, n.p, n.t, n.n);
      out[out.length - 1].type = glyph;
      out[out.length - 1].feature = true;
    }
  }
  return out;
}

/** Unit length guard for callers that build frames from a possibly zero vector. */
export const direction = (a: Vec2, b: Vec2): Vec2 => {
  const d = sub(b, a);
  return len(d) > 0 ? norm(d) : { x: 1, y: 0 };
};
