// Sketch planes in 3D. A Frame is an origin and two orthonormal in-plane axes, u and v; the normal is
// u x v. Folding turns a frame 90 degrees about a line in it (docs/SPEC.md section 5, 3D mode).
import type { Frame, Plane, Vec2, Vec3 } from './types';

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export function norm3(a: Vec3): Vec3 {
  const l = len3(a);
  return l < 1e-300 ? { x: 0, y: 0, z: 0 } : scale3(a, 1 / l);
}

/** Rotate `p` about the unit `axis` through the origin by `angle` (right-handed), by Rodrigues. */
export function rotate3(p: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add3(add3(scale3(p, c), scale3(cross3(axis, p), s)), scale3(axis, dot3(axis, p) * (1 - c)));
}

/** Rotate by exactly a quarter turn: cos and sin are 0 and 1, with no rounding in them. */
const quarter = (p: Vec3, axis: Vec3, sign: 1 | -1): Vec3 => add3(scale3(cross3(axis, p), sign), scale3(axis, dot3(axis, p)));

/** The origin planes. Each normal is the third axis: XY +Z, YZ +X, ZX +Y. */
export const PLANE_FRAMES: Readonly<Record<Plane, Frame>> = {
  XY: { o: v3(0, 0, 0), u: v3(1, 0, 0), v: v3(0, 1, 0) },
  YZ: { o: v3(0, 0, 0), u: v3(0, 1, 0), v: v3(0, 0, 1) },
  ZX: { o: v3(0, 0, 0), u: v3(0, 0, 1), v: v3(1, 0, 0) },
};

/** A fresh copy, for storing in a sketch. */
export const planeFrame = (plane: Plane): Frame => structuredClone(PLANE_FRAMES[plane]) as Frame;

export const normalOf = (f: Frame): Vec3 => cross3(f.u, f.v);

/** A sketch position in 3D. */
export const toWorld = (f: Frame, p: Vec2): Vec3 => add3(f.o, add3(scale3(f.u, p.x), scale3(f.v, p.y)));

/** A 3D position in a frame's coordinates; `z` is its height above the plane, along the normal. */
export function toPlane(f: Frame, q: Vec3): Vec2 & { z: number } {
  const d = sub3(q, f.o);
  return { x: dot3(d, f.u), y: dot3(d, f.v), z: dot3(d, normalOf(f)) };
}

/** A point this near a plane, in mm, lies on it. */
export const ON_PLANE = 1e-6;
/** A frame component this near 0 or 1 is taken to be exactly that, so folds do not drift. */
const EXACT = 1e-12;
/** Directions this near are the same. */
const SAME_DIRECTION = 1e-9;

const snap = (c: number): number => {
  if (Math.abs(c) < EXACT) return 0;
  if (Math.abs(c - 1) < EXACT) return 1;
  if (Math.abs(c + 1) < EXACT) return -1;
  return c;
};
const snap3 = (a: Vec3): Vec3 => ({ x: snap(a.x), y: snap(a.y), z: snap(a.z) });

/**
 * Exact where it should be: components within 1e-12 of 0 or +-1 become that, u is unit, and v is unit
 * and square to it. An origin within ON_PLANE of zero on an axis is put on it.
 */
export function tidyFrame(f: Frame): Frame {
  // Already unit and square to the last bit or so: left alone, so tidying twice changes nothing.
  const unit = (a: Vec3): Vec3 => (Math.abs(len3(a) - 1) > 1e-15 ? norm3(a) : a);
  const u = snap3(unit(snap3(f.u)));
  const v0 = snap3(f.v);
  const along = dot3(u, v0);
  const v = snap3(unit(Math.abs(along) > 1e-15 ? sub3(v0, scale3(u, along)) : v0));
  const o = { x: Math.abs(f.o.x) < ON_PLANE ? 0 : f.o.x, y: Math.abs(f.o.y) < ON_PLANE ? 0 : f.o.y, z: Math.abs(f.o.z) < ON_PLANE ? 0 : f.o.z };
  return { o, u, v };
}

const near3 = (a: Vec3, b: Vec3, tol: number): boolean => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol;

/** The same coordinates: a sketch on one is drawn as it is on the other. */
export const sameFrame = (a: Frame, b: Frame): boolean =>
  near3(a.o, b.o, ON_PLANE) && near3(a.u, b.u, SAME_DIRECTION) && near3(a.v, b.v, SAME_DIRECTION);

/** On one plane, facing either way. */
export function coplanar(a: Frame, b: Frame): boolean {
  const n = normalOf(a);
  return Math.abs(Math.abs(dot3(n, normalOf(b))) - 1) < SAME_DIRECTION && Math.abs(dot3(sub3(b.o, a.o), n)) < ON_PLANE;
}

/** On one plane, facing the same way. */
export const samePlane = (a: Frame, b: Frame): boolean => coplanar(a, b) && dot3(normalOf(a), normalOf(b)) > 0;

/** The origin plane a frame is, if it is one exactly. */
export function planeName(f: Frame): Plane | null {
  for (const plane of ['XY', 'YZ', 'ZX'] as Plane[]) if (sameFrame(f, PLANE_FRAMES[plane])) return plane;
  return null;
}

/** Whether a value read from a file is a usable frame. Tidied by the caller. */
export function isFrame(raw: unknown): raw is Frame {
  const vec = (v: unknown): boolean => typeof v === 'object' && v !== null
    && [(v as Vec3).x, (v as Vec3).y, (v as Vec3).z].every((c) => Number.isFinite(c));
  if (typeof raw !== 'object' || raw === null) return false;
  const f = raw as Frame;
  if (!vec(f.o) || !vec(f.u) || !vec(f.v)) return false;
  return Math.abs(len3(f.u) - 1) < 1e-6 && Math.abs(len3(f.v) - 1) < 1e-6 && Math.abs(dot3(f.u, f.v)) < 1e-6;
}

export type Arrow = 'up' | 'down' | 'left' | 'right';

/**
 * The pair of arrows that fold about a line from a to b in sketch coordinates, which in Sketch mode are the
 * screen's: a line running across the screen takes Up and Down, one running up it Left and Right. A line at
 * exactly 45 degrees runs across. Null for a line with no length.
 */
export function foldArrows(a: Vec2, b: Vec2): readonly [Arrow, Arrow] | null {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (Math.hypot(dx, dy) < 1e-9) return null;
  return dy <= dx * (1 + 1e-9) ? ['up', 'down'] : ['left', 'right'];
}

export interface Fold {
  /** The new plane: it holds the line, and its normal is the old plane's direction toward the arrow. */
  frame: Frame;
  /** A point of the hinge, and the unit axis the view turns a quarter about, right-handed. */
  pivot: Vec3;
  axis: Vec3;
}

/**
 * Fold `f` 90 degrees about the line a-b (sketch coordinates) toward `arrow`, the way the camera moves.
 * The new normal is the old plane's in-plane direction perpendicular to the line, on the arrow's side,
 * and the view turns about the line to look down onto it: the new u and v are the old ones turned with
 * it, so the line stays where it was on screen. The new origin is the foot of the world origin on the new
 * plane. Null when `arrow` is not one of the line's pair.
 */
export function fold(f: Frame, a: Vec2, b: Vec2, arrow: Arrow): Fold | null {
  const pair = foldArrows(a, b);
  if (!pair || !pair.includes(arrow)) return null;
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  let w = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
  const wanted = arrow === 'up' ? w.y > 0 : arrow === 'down' ? w.y < 0 : arrow === 'right' ? w.x > 0 : w.x < 0;
  if (!wanted) w = { x: -w.x, y: -w.y };
  const n0 = normalOf(f);
  const toward = norm3(add3(scale3(f.u, w.x), scale3(f.v, w.y)));
  const axis = norm3(cross3(n0, toward));
  const pivot = toWorld(f, a);
  const u = quarter(f.u, axis, 1);
  const v = quarter(f.v, axis, 1);
  const n1 = cross3(u, v);
  const o = scale3(n1, dot3(pivot, n1));
  return { frame: tidyFrame({ o, u, v }), pivot, axis };
}

/** The angle about `n` that turns `from` onto `to`, both square to it: an in-plane roll. */
export function rollAngle(from: Vec3, to: Vec3, n: Vec3): number {
  return Math.atan2(dot3(cross3(from, to), n), dot3(from, to));
}

/**
 * Where the plane of `other` meets the plane of `f`, as an infinite line in `f`'s coordinates: a point on
 * it nearest f's origin, and its unit direction, along n_f x n_other. Null when the planes are parallel.
 */
export function meetingLine(f: Frame, other: Frame): { p: Vec2; d: Vec2 } | null {
  const n = normalOf(other);
  const a = dot3(f.u, n);
  const b = dot3(f.v, n);
  const l = Math.hypot(a, b);
  if (l < SAME_DIRECTION) return null;
  // Points (x, y) of f with a x + b y = c lie on the other plane too.
  const c = dot3(sub3(other.o, f.o), n);
  const d3 = norm3(cross3(normalOf(f), n));
  return { p: { x: (a * c) / (l * l), y: (b * c) / (l * l) }, d: { x: dot3(d3, f.u), y: dot3(d3, f.v) } };
}

/** One line per distinct plane among `others` that meets `f`'s, with the ids on it in order. */
export function meetingLines(f: Frame, others: { id: string; frame: Frame }[]): { p: Vec2; d: Vec2; frame: Frame; ids: string[] }[] {
  const out: { p: Vec2; d: Vec2; frame: Frame; ids: string[] }[] = [];
  for (const s of others) {
    const shared = out.find((l) => coplanar(l.frame, s.frame));
    if (shared) {
      shared.ids.push(s.id);
      continue;
    }
    const line = meetingLine(f, s.frame);
    if (line) out.push({ ...line, frame: s.frame, ids: [s.id] });
  }
  return out;
}
