// The 3D view: an orthographic camera, for the swing between planes and the Orbit view. Screen coordinates
// are CSS pixels, Y down, as in view.ts; a sketch in Sketch mode is this camera looking straight at its frame.
import type { Frame, Plane, Vec2, Vec3 } from '../model/types';
import { add3, cross3, dot3, norm3, normalOf, PLANE_FRAMES, rotate3, scale3, sub3, toPlane, toWorld, v3 } from '../model/frames';
import { View } from './view';

export interface Camera {
  /** Screen right and up, unit and square; the camera looks along -(right x up). */
  right: Vec3;
  up: Vec3;
  /** The 3D point at the centre of the canvas. */
  centre: Vec3;
  /** CSS pixels per millimetre. */
  ppm: number;
}

/** The camera Sketch mode is: looking straight down onto `frame`, at the view's centre and zoom. */
export const facing = (frame: Frame, view: { cx: number; cy: number; ppm: number }): Camera => ({
  right: { ...frame.u }, up: { ...frame.v }, centre: toWorld(frame, { x: view.cx, y: view.cy }), ppm: view.ppm,
});

/** Home: isometric, from the front right and above (+X, -Y, +Z), Z up. */
export const HOME: Readonly<{ right: Vec3; up: Vec3 }> = {
  right: norm3(v3(1, 1, 0)),
  up: norm3(v3(-1, 1, 2)),
};

export const toward = (cam: Camera): Vec3 => cross3(cam.right, cam.up);

export function project(cam: Camera, p: Vec3, width: number, height: number): Vec2 {
  const d = sub3(p, cam.centre);
  return { x: width / 2 + dot3(d, cam.right) * cam.ppm, y: height / 2 - dot3(d, cam.up) * cam.ppm };
}

/** The 3D point on the camera's own plane through its centre that shows at `s`. */
export function unproject(cam: Camera, s: Vec2, width: number, height: number): Vec3 {
  return add3(cam.centre, add3(scale3(cam.right, (s.x - width / 2) / cam.ppm), scale3(cam.up, -(s.y - height / 2) / cam.ppm)));
}

/** A plane this near edge-on to the camera shows as a line, and is not picked. */
const EDGE_ON = 1e-9;

/**
 * The origin plane square under `s`, `size` mm from the origin along its u and v as the 3D view draws it, nearest
 * the camera where squares overlap: a ray through `s` along the view, against each square in turn. Null off them all.
 */
export function planeAt(cam: Camera, s: Vec2, width: number, height: number, size: number): Plane | null {
  const from = unproject(cam, s, width, height);
  // Toward the camera, so the larger the distance along it, the nearer.
  const back = toward(cam);
  let best: { plane: Plane; t: number } | null = null;
  for (const plane of Object.keys(PLANE_FRAMES) as Plane[]) {
    const f = PLANE_FRAMES[plane];
    const n = normalOf(f);
    const across = dot3(back, n);
    if (Math.abs(across) < EDGE_ON) continue;
    const t = dot3(sub3(f.o, from), n) / across;
    const q = toPlane(f, add3(from, scale3(back, t)));
    if (q.x < 0 || q.y < 0 || q.x > size || q.y > size) continue;
    if (!best || t > best.t) best = { plane, t };
  }
  return best?.plane ?? null;
}

/** Turn the whole camera about a line through `pivot`, as rigidly as if it were fixed to it. */
export function turn(cam: Camera, axis: Vec3, angle: number, pivot: Vec3 = cam.centre): Camera {
  return {
    right: rotate3(cam.right, axis, angle),
    up: rotate3(cam.up, axis, angle),
    centre: add3(pivot, rotate3(sub3(cam.centre, pivot), axis, angle)),
    ppm: cam.ppm,
  };
}

/** Orbit by a drag of (dx, dy) pixels: across turns about world Z, up and down tilts about screen right. */
export function orbitBy(cam: Camera, dx: number, dy: number): Camera {
  const k = Math.PI / 360;
  return turn(turn(cam, v3(0, 0, 1), -dx * k), cam.right, -dy * k);
}

/** Zoom by `factor` keeping the point under `s` where it is. */
export function zoomAt(cam: Camera, s: Vec2, factor: number, width: number, height: number): Camera {
  const before = unproject(cam, s, width, height);
  const next = { ...cam, ppm: Math.min(1e5, Math.max(1e-3, cam.ppm * factor)) };
  return { ...next, centre: add3(next.centre, sub3(before, unproject(next, s, width, height))) };
}

export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return { ...cam, centre: add3(cam.centre, add3(scale3(cam.right, -dx / cam.ppm), scale3(cam.up, dy / cam.ppm))) };
}

// Quaternions [w, x, y, z], for turning one camera into another along the shortest way round.
type Quat = [number, number, number, number];

function quatOf(cam: Camera): Quat {
  const r = cam.right;
  const u = cam.up;
  const n = toward(cam);
  // Columns r, u, n: the rotation that takes the world axes to the camera's.
  const m = [[r.x, u.x, n.x], [r.y, u.y, n.y], [r.z, u.z, n.z]];
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4];
  }
  return q;
}

function rotateByQuat(q: Quat, p: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const axis = v3(x, y, z);
  const t = scale3(cross3(axis, p), 2);
  return add3(add3(p, scale3(t, w)), cross3(axis, t));
}

/** Part way from camera `a` to camera `b`: the turn along the shortest arc, the centre and zoom in a line. */
export function between(a: Camera, b: Camera, t: number): Camera {
  const qa = quatOf(a);
  let qb = quatOf(b);
  let d = qa.reduce((s, c, i) => s + c * qb[i], 0);
  if (d < 0) {
    qb = qb.map((c) => -c) as Quat;
    d = -d;
  }
  let q: Quat;
  if (d > 0.9995) q = qa.map((c, i) => c + (qb[i] - c) * t) as Quat;
  else {
    const th = Math.acos(Math.min(1, d));
    const s = Math.sin(th);
    const wa = Math.sin((1 - t) * th) / s;
    const wb = Math.sin(t * th) / s;
    q = qa.map((c, i) => c * wa + qb[i] * wb) as Quat;
  }
  const l = Math.hypot(...q);
  q = q.map((c) => c / l) as Quat;
  return {
    right: rotateByQuat(q, v3(1, 0, 0)),
    up: rotateByQuat(q, v3(0, 1, 0)),
    centre: add3(a.centre, scale3(sub3(b.centre, a.centre), t)),
    ppm: a.ppm * (b.ppm / a.ppm) ** t,
  };
}

/** The view a Painter draws through: sketch coordinates on `frame`, onto the screen by `cam`. */
export class FrameView extends View {
  constructor(readonly cam: Camera, readonly frame: Frame, base: View) {
    super();
    this.width = base.width;
    this.height = base.height;
    this.dpr = base.dpr;
    this.ppm = cam.ppm;
  }

  override toScreen(p: Vec2): Vec2 {
    return project(this.cam, toWorld(this.frame, p), this.width, this.height);
  }
}

/**
 * Screen pixels as a sketch's coordinates, Y up: (x, y) is the screen's (x, -y). Lets the 2D hit test
 * pick what a camera shows, from copies of the geometry already put through it.
 */
export function screenView(base: View): View {
  const v = new View();
  v.resize(base.width, base.height, base.dpr);
  v.ppm = 1;
  v.cx = base.width / 2;
  v.cy = -base.height / 2;
  return v;
}
