import { describe, expect, it } from 'vitest';
import type { Plane, Vec3 } from '../model/types';
import { add3, PLANE_FRAMES, scale3, toWorld, v3 } from '../model/frames';
import { HOME, orbitBy, planeAt, project, toward, turn, type Camera } from './camera';

const W = 1000;
const H = 800;
const SIZE = 50;
const home: Camera = { right: { ...HOME.right }, up: { ...HOME.up }, centre: v3(20, 20, 20), ppm: 6 };

/** The plane picked where a point of `plane`, in its own coordinates, shows on screen. */
const pickAt = (cam: Camera, plane: Plane, x: number, y: number): Plane | null =>
  planeAt(cam, project(cam, toWorld(PLANE_FRAMES[plane], { x, y }), W, H), W, H, SIZE);

describe('planeAt: the origin plane square under the cursor', () => {
  it('finds each square where nothing is in front of it, from Home', () => {
    // From front right above (+X, -Y, +Z): XY is seen from above, XZ (ZX) faces the camera, YZ stands behind.
    expect(pickAt(home, 'XY', 40, 40)).toBe('XY');
    expect(pickAt(home, 'ZX', 25, 25)).toBe('ZX');
    expect(pickAt(home, 'YZ', 40, 40)).toBe('YZ');
  });

  it('is null off every square, and past the edge of one', () => {
    expect(planeAt(home, project(home, v3(-30, -30, -30), W, H), W, H, SIZE)).toBeNull();
    expect(pickAt(home, 'XY', 70, 70)).toBeNull();
    expect(pickAt(home, 'XY', 40, 40)).toBe('XY');
    // The same spot on a smaller square is off it.
    expect(planeAt(home, project(home, v3(40, 40, 0), W, H), W, H, 30)).toBeNull();
  });

  it('takes the square nearest the camera where two overlap on screen', () => {
    // XY at (10, 10) is behind XZ from Home: the ray toward the camera meets y = 0 at (20, 0, 10), inside XZ.
    expect(pickAt(home, 'XY', 10, 10)).toBe('ZX');
    // YZ at (10, 10) is behind XZ too: the ray meets y = 0 at (10, 0, 20).
    expect(pickAt(home, 'YZ', 10, 10)).toBe('ZX');
  });

  it('goes by depth, not by the order the squares are drawn in', () => {
    // From below and the +Y side, XY (drawn first) is in front of XZ (drawn last).
    const below: Camera = { ...home, right: norm(v3(-1, 1, 0)), up: norm(v3(1, 1, 2)) };
    const c = toward(below);
    expect(c.z).toBeLessThan(0);
    expect(c.y).toBeGreaterThan(0);
    // A point of XZ, and the point of XY on the same ray, nearer the camera.
    const behind = v3(10, 0, 15);
    const t = -behind.z / c.z;
    const front = add3(behind, scale3(c, t));
    expect(t).toBeGreaterThan(0);
    expect(Math.abs(front.z)).toBeLessThan(1e-9);
    expect(front.x).toBeGreaterThan(0);
    expect(front.x).toBeLessThan(SIZE);
    expect(front.y).toBeGreaterThan(0);
    expect(front.y).toBeLessThan(SIZE);
    expect(planeAt(below, project(below, behind, W, H), W, H, SIZE)).toBe('XY');
  });

  it('follows the camera as it orbits and turns', () => {
    // Turned half round about Z: now from behind left (-X, +Y), and YZ faces the camera.
    const round = turn(home, v3(0, 0, 1), Math.PI, v3(0, 0, 0));
    expect(pickAt(round, 'YZ', 10, 10)).toBe('YZ');
    expect(pickAt(round, 'ZX', 10, 10)).toBe('YZ');
    // A drag that leaves XY edge-on: looking straight along the floor, XY is never picked.
    const level = orbitBy(home, 0, -Math.atan(1 / Math.SQRT2) * 360 / Math.PI);
    expect(Math.abs(toward(level).z)).toBeLessThan(1e-9);
    for (let x = 1; x < SIZE; x += 7) for (let y = 1; y < SIZE; y += 7) expect(pickAt(level, 'XY', x, y)).not.toBe('XY');
  });

  it('ignores the zoom and where the view is centred', () => {
    const near: Camera = { ...home, ppm: 40, centre: v3(-100, 50, 3) };
    expect(pickAt(near, 'XY', 40, 40)).toBe('XY');
    expect(pickAt(near, 'XY', 10, 10)).toBe('ZX');
  });
});

function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
