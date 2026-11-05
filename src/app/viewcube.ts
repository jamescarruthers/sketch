// The ViewCube [fusion]: a small cube in the canvas's top right that turns with the camera and names the world's
// six sides, Z up. Pure: what it shows, what is under a point of it, and which way a click on it turns the camera.
// Screen coordinates are CSS pixels, Y down, as in camera.ts. Drawn by src/render/viewcube.ts (docs/SPEC.md section 5).
import type { Vec2, Vec3 } from '../model/types';
import { add3, cross3, dot3, len3, norm3, rotate3, scale3, sub3, v3 } from '../model/frames';

/** Which way a camera looks: screen right and up, unit and square. It looks along -(right x up). */
export type Turn = { right: Vec3; up: Vec3 };

/** One of the 26 things on the cube to click, as the way it faces: each component -1, 0 or 1. */
export type CubeTarget = Vec3;

export interface CubeFace {
  /** The outward normal, a world axis. */
  n: Vec3;
  label: string;
  /** How its label lies: along `right`, standing up `up`, so it reads from outside (right x up is n). */
  right: Vec3;
  up: Vec3;
}

/** Where the cube is on the canvas: its centre, and half its edge, in CSS pixels. */
export interface CubeLayout {
  x: number;
  y: number;
  half: number;
}

/** The square the cube takes, in CSS px, and half the cube's edge: turned any way, it never leaves the square. */
export const CUBE_BOX = 100;
export const CUBE_HALF = 28;
/** The ViewCube's Home icon, outside the square at its top left, in CSS px. */
export const CUBE_ICON = 18;
/** How far in from each edge of a face, as a part of half its edge, a click takes the edge or corner instead. */
export const CUBE_BAND = 0.3;
/** A face turned further away than this is culled. */
const FACING = 1e-9;

const Z = v3(0, 0, 1);

/**
 * How a face's label lies. The sides read upright with Z up. TOP reads upright from FRONT, looking down with
 * +Y up the screen; BOTTOM reads upright from FRONT turned under, with -Y up the screen.
 */
export function labelAxes(n: Vec3): { right: Vec3; up: Vec3 } {
  const up = n.z > 0 ? v3(0, 1, 0) : n.z < 0 ? v3(0, -1, 0) : Z;
  return { right: cross3(up, n), up };
}

const face = (n: Vec3, label: string): CubeFace => ({ n, label, ...labelAxes(n) });

/** FRONT looks from -Y toward +Y, RIGHT from +X, TOP from +Z, so Home shows the FRONT, RIGHT and TOP corner. */
export const CUBE_FACES: readonly CubeFace[] = [
  face(v3(0, 0, 1), 'TOP'), face(v3(0, 0, -1), 'BOTTOM'),
  face(v3(0, -1, 0), 'FRONT'), face(v3(0, 1, 0), 'BACK'),
  face(v3(-1, 0, 0), 'LEFT'), face(v3(1, 0, 0), 'RIGHT'),
];

/** The 6 faces, 12 edges and 8 corners. */
export const CUBE_TARGETS: readonly CubeTarget[] = [-1, 0, 1].flatMap((x) => [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((z) => v3(x, y, z))))
  .filter((d) => d.x !== 0 || d.y !== 0 || d.z !== 0);

/** `top`, `front-right`, `top-front-right`: up or down, then front or back, then left or right. */
export function targetName(d: CubeTarget): string {
  const parts = [d.z > 0 ? 'top' : d.z < 0 ? 'bottom' : '', d.y < 0 ? 'front' : d.y > 0 ? 'back' : '', d.x < 0 ? 'left' : d.x > 0 ? 'right' : ''];
  return parts.filter(Boolean).join('-');
}

export function targetNamed(name: string): CubeTarget | null {
  return CUBE_TARGETS.find((d) => targetName(d) === name) ?? null;
}

export const toward = (t: Turn): Vec3 => cross3(t.right, t.up);

/** A point of the cube, in units of half its edge from its centre, on the canvas. */
export function cubeToScreen(t: Turn, layout: CubeLayout, p: Vec3): Vec2 {
  return { x: layout.x + dot3(p, t.right) * layout.half, y: layout.y - dot3(p, t.up) * layout.half };
}

/** The faces turned toward the camera, nearest square-on first. The cube is convex, so they never overlap. */
export function visibleFaces(t: Turn): CubeFace[] {
  const n = toward(t);
  return CUBE_FACES.filter((f) => dot3(f.n, n) > FACING).sort((a, b) => dot3(b.n, n) - dot3(a.n, n));
}

/** A point of a face from its own coordinates, each -1 to 1 along its label's right and up. */
export const facePoint = (f: CubeFace, s: number, t: number): Vec3 => add3(f.n, add3(scale3(f.right, s), scale3(f.up, t)));

/** What a point of a face, in its coordinates, picks: the face, or in the band round it the edge or corner there. */
export function targetAt(f: CubeFace, s: number, t: number): CubeTarget {
  const side = (c: number): number => (c > 1 - CUBE_BAND ? 1 : c < -(1 - CUBE_BAND) ? -1 : 0);
  const d = add3(f.n, add3(scale3(f.right, side(s)), scale3(f.up, side(t))));
  // Integers, with no -0 in them.
  return v3(Math.round(d.x) || 0, Math.round(d.y) || 0, Math.round(d.z) || 0);
}

/** Where a canvas point lies on a face, in its coordinates, through the cube's projection. Null when the face is edge-on. */
function onFace(t: Turn, layout: CubeLayout, f: CubeFace, s: Vec2): { s: number; t: number } | null {
  const c = cubeToScreen(t, layout, f.n);
  const ra = cubeToScreen(t, layout, add3(f.n, f.right));
  const ua = cubeToScreen(t, layout, add3(f.n, f.up));
  const a = { x: ra.x - c.x, y: ra.y - c.y };
  const b = { x: ua.x - c.x, y: ua.y - c.y };
  const det = a.x * b.y - a.y * b.x;
  if (Math.abs(det) < 1e-9) return null;
  const qx = s.x - c.x;
  const qy = s.y - c.y;
  return { s: (qx * b.y - qy * b.x) / det, t: (a.x * qy - a.y * qx) / det };
}

/** The face, edge or corner under a canvas point, by a ray through it along the view onto the faces turned toward it. */
export function cubePick(t: Turn, layout: CubeLayout, s: Vec2): CubeTarget | null {
  for (const f of visibleFaces(t)) {
    const q = onFace(t, layout, f, s);
    if (q && Math.abs(q.s) <= 1 && Math.abs(q.t) <= 1) return targetAt(f, q.s, q.t);
  }
  return null;
}

/**
 * A canvas point that picks `d`, at the middle of its part of the face that shows it most square-on: for a face,
 * at (s, t) of it instead when given. Null when no face that shows it is turned toward the camera.
 */
export function targetPoint(t: Turn, layout: CubeLayout, d: CubeTarget, at?: { s: number; t: number }): Vec2 | null {
  const f = visibleFaces(t).find((k) => dot3(k.n, d) === 1);
  if (!f) return null;
  const mid = (c: number): number => (c === 0 ? 0 : c * (1 - CUBE_BAND / 2));
  const isFace = Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z) === 1;
  const p = isFace && at ? facePoint(f, at.s, at.t) : facePoint(f, mid(dot3(d, f.right)), mid(dot3(d, f.up)));
  return cubeToScreen(t, layout, p);
}

/** A unit vector this near a world axis is square to it. */
const SQUARE = 1e-6;

/** `a` as the world axis X or Y it lies along, if it does. */
function squareAxis(a: Vec3): Vec3 | null {
  for (const axis of [v3(1, 0, 0), v3(0, 1, 0)]) {
    const c = dot3(a, axis);
    if (Math.abs(Math.abs(c) - 1) < SQUARE) return scale3(axis, Math.sign(c));
  }
  return null;
}

/**
 * Which way a click on `d` turns the camera, from `from`. A face looks straight at it, an edge at 45 degrees
 * between its two faces, a corner isometric, all with Z up the screen. TOP and BOTTOM keep the spin there is,
 * the screen's right turned the least way round onto the new view, when that is square to X or Y; otherwise
 * TOP has +Y up the screen and BOTTOM -Y, as their labels read.
 */
export function targetTurn(d: CubeTarget, from: Turn): Turn {
  const look = norm3(d);
  if (d.x === 0 && d.y === 0) {
    const was = toward(from);
    const axis = cross3(was, look);
    const s = len3(axis);
    // Already that way, or the opposite: turning about the screen's right keeps it.
    const right = s < 1e-12 ? from.right : rotate3(from.right, scale3(axis, 1 / s), Math.atan2(s, dot3(was, look)));
    const kept = squareAxis(right) ?? v3(1, 0, 0);
    return { right: kept, up: cross3(look, kept) };
  }
  const up = norm3(sub3(Z, scale3(look, dot3(Z, look))));
  return { right: cross3(up, look), up };
}
