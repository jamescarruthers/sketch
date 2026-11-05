import { describe, expect, it } from 'vitest';
import type { Vec2, Vec3 } from '../model/types';
import { cross3, dot3, norm3, v3 } from '../model/frames';
import { HOME, orbitBy, type Camera } from './camera';
import {
  CUBE_BAND, CUBE_FACES, CUBE_HALF, CUBE_TARGETS, cubePick, labelAxes, targetName, targetNamed, targetPoint, targetTurn, visibleFaces,
  type CubeLayout, type CubeTarget, type Turn,
} from './viewcube';

const layout: CubeLayout = { x: 300, y: 60, half: CUBE_HALF };
const home: Turn = { right: { ...HOME.right }, up: { ...HOME.up } };
const look = (t: Turn): Vec3 => cross3(t.right, t.up);
const near = (a: Vec3, b: Vec3, digits = 12): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
};
const turnOf = (cam: Camera): Turn => ({ right: cam.right, up: cam.up });
const asCamera = (t: Turn): Camera => ({ ...t, centre: v3(0, 0, 0), ppm: 1 });

/** Where a point of the cube, in units of half its edge, shows: written out here, not through the module. */
const screenOf = (t: Turn, p: Vec3): Vec2 => ({ x: layout.x + dot3(p, t.right) * layout.half, y: layout.y - dot3(p, t.up) * layout.half });

/**
 * A point inside `d`'s part of a face that shows it, in the middle of the band for an edge or corner: or null
 * when no face showing it is turned toward the camera by more than `least`.
 */
function pointOn(t: Turn, d: CubeTarget, least = 0.15): Vec2 | null {
  const n = look(t);
  for (const f of CUBE_FACES) {
    if (dot3(f.n, d) !== 1 || dot3(f.n, n) < least) continue;
    const at = (c: number): number => c * (1 - CUBE_BAND / 2);
    const s = at(dot3(d, f.right));
    const u = at(dot3(d, f.up));
    return screenOf(t, v3(f.n.x + f.right.x * s + f.up.x * u, f.n.y + f.right.y * s + f.up.y * u, f.n.z + f.right.z * s + f.up.z * u));
  }
  return null;
}

const named = (name: string): CubeTarget => targetNamed(name) as CubeTarget;

describe('the 26 targets', () => {
  it('are 6 faces, 12 edges and 8 corners, each named once', () => {
    const count = (k: number) => CUBE_TARGETS.filter((d) => Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z) === k).length;
    expect([CUBE_TARGETS.length, count(1), count(2), count(3)]).toEqual([26, 6, 12, 8]);
    expect(new Set(CUBE_TARGETS.map(targetName)).size).toBe(26);
    for (const d of CUBE_TARGETS) expect(targetNamed(targetName(d))).toEqual(d);
    expect(targetName(v3(0, -1, 0))).toBe('front');
    expect(targetName(v3(1, -1, 1))).toBe('top-front-right');
    expect(targetName(v3(-1, 1, 0))).toBe('back-left');
  });
});

describe('face culling', () => {
  it('shows FRONT, RIGHT and TOP from Home, nearest square-on first, all three alike', () => {
    expect(visibleFaces(home).map((f) => f.label).sort()).toEqual(['FRONT', 'RIGHT', 'TOP']);
  });

  it('shows one face looking straight at it, and two from an edge', () => {
    expect(visibleFaces(targetTurn(named('front'), home)).map((f) => f.label)).toEqual(['FRONT']);
    expect(visibleFaces(targetTurn(named('top'), home)).map((f) => f.label)).toEqual(['TOP']);
    expect(visibleFaces(targetTurn(named('back-left'), home)).map((f) => f.label).sort()).toEqual(['BACK', 'LEFT']);
  });

  it('hides the far side however the camera is turned: never two opposite faces, and at most three', () => {
    let cam = asCamera(home);
    for (let i = 0; i < 40; i++) {
      cam = orbitBy(cam, 37, -23);
      const shown = visibleFaces(turnOf(cam));
      expect(shown.length).toBeGreaterThanOrEqual(1);
      expect(shown.length).toBeLessThanOrEqual(3);
      for (const f of shown) {
        expect(dot3(f.n, look(turnOf(cam)))).toBeGreaterThan(0);
        expect(shown.some((g) => dot3(g.n, f.n) === -1)).toBe(false);
      }
    }
  });
});

describe('cubePick', () => {
  const visibleFromHome = CUBE_TARGETS.filter((d) => d.x === 1 || d.y === -1 || d.z === 1);
  const opposite: Turn = targetTurn(named('bottom-back-left'), home);

  it('picks each of the 19 targets seen from Home where it is drawn', () => {
    expect(visibleFromHome).toHaveLength(19);
    for (const d of visibleFromHome) {
      const at = pointOn(home, d);
      expect(at, targetName(d)).not.toBeNull();
      expect(targetName(cubePick(home, layout, at as Vec2) as CubeTarget), targetName(d)).toBe(targetName(d));
    }
  });

  it('picks the other 7 from the opposite corner, so all 26 are picked', () => {
    const rest = CUBE_TARGETS.filter((d) => !visibleFromHome.includes(d));
    expect(rest).toHaveLength(7);
    const seen = new Set(visibleFromHome.map(targetName));
    for (const d of CUBE_TARGETS.filter((k) => k.x === -1 || k.y === 1 || k.z === -1)) {
      const at = pointOn(opposite, d) as Vec2;
      expect(targetName(cubePick(opposite, layout, at) as CubeTarget), targetName(d)).toBe(targetName(d));
      seen.add(targetName(d));
    }
    expect(seen.size).toBe(26);
  });

  it('never picks from Home what Home cannot see, anywhere on the cube', () => {
    const hidden = new Set(CUBE_TARGETS.filter((d) => !visibleFromHome.includes(d)).map(targetName));
    const found = new Set<string>();
    for (let x = layout.x - 50; x <= layout.x + 50; x += 1) {
      for (let y = layout.y - 50; y <= layout.y + 50; y += 1) {
        const d = cubePick(home, layout, { x, y });
        if (d) found.add(targetName(d));
      }
    }
    expect([...found].filter((n) => hidden.has(n))).toEqual([]);
    expect(found.size).toBe(19);
  });

  it('picks by the turned cube, every target shown on a face turned toward the camera, from a camera turned anyhow', () => {
    for (const [dx, dy] of [[123, -77], [-260, 140], [400, 330], [35, 210]]) {
      const t = turnOf(orbitBy(asCamera(home), dx, dy));
      let picked = 0;
      for (const d of CUBE_TARGETS) {
        const at = pointOn(t, d);
        if (!at) continue;
        expect(targetName(cubePick(t, layout, at) as CubeTarget), `${dx},${dy} ${targetName(d)}`).toBe(targetName(d));
        picked++;
      }
      expect(picked).toBeGreaterThanOrEqual(7);
    }
  });

  it('is null off the cube, and the face straight on at its middle', () => {
    expect(cubePick(home, layout, { x: layout.x + 60, y: layout.y })).toBeNull();
    expect(cubePick(home, layout, { x: layout.x - 49, y: layout.y - 49 })).toBeNull();
    const front = targetTurn(named('front'), home);
    expect(targetName(cubePick(front, layout, { x: layout.x, y: layout.y }) as CubeTarget)).toBe('front');
    // Straight on, the band round the face is its edges and corners: up the screen is TOP.
    expect(targetName(cubePick(front, layout, { x: layout.x, y: layout.y - layout.half * 0.9 }) as CubeTarget)).toBe('top-front');
    expect(targetName(cubePick(front, layout, { x: layout.x + layout.half * 0.9, y: layout.y + layout.half * 0.9 }) as CubeTarget)).toBe('bottom-front-right');
    expect(cubePick(front, layout, { x: layout.x + layout.half * 1.05, y: layout.y })).toBeNull();
  });

  it('agrees with targetPoint, the point the browser specs click', () => {
    for (const d of visibleFromHome) {
      expect(targetName(cubePick(home, layout, targetPoint(home, layout, d) as Vec2) as CubeTarget)).toBe(targetName(d));
    }
    expect(targetPoint(home, layout, named('back'))).toBeNull();
  });
});

describe('targetTurn: where a click turns the camera', () => {
  const check = (t: Turn): void => {
    expect(dot3(t.right, t.right)).toBeCloseTo(1, 12);
    expect(dot3(t.up, t.up)).toBeCloseTo(1, 12);
    expect(dot3(t.right, t.up)).toBeCloseTo(0, 12);
  };

  it('looks straight at a face, Z up for the sides', () => {
    const cases: [string, Vec3, Vec3][] = [
      ['front', v3(0, -1, 0), v3(1, 0, 0)], ['back', v3(0, 1, 0), v3(-1, 0, 0)],
      ['right', v3(1, 0, 0), v3(0, 1, 0)], ['left', v3(-1, 0, 0), v3(0, -1, 0)],
    ];
    for (const [name, from, right] of cases) {
      const t = targetTurn(named(name), home);
      check(t);
      near(look(t), from);
      near(t.up, v3(0, 0, 1));
      near(t.right, right);
    }
  });

  it('looks at an edge from 45 degrees between its faces, and at a corner isometrically, Z up the screen', () => {
    for (const d of CUBE_TARGETS.filter((k) => k.x !== 0 || k.y !== 0)) {
      const t = targetTurn(d, home);
      check(t);
      near(look(t), norm3(d));
      // Z runs straight up the screen: none of it across, some of it up.
      expect(t.right.z).toBeCloseTo(0, 12);
      expect(t.up.z).toBeGreaterThan(0);
    }
    const edge = targetTurn(named('front-right'), home);
    near(edge.right, HOME.right);
    near(edge.up, v3(0, 0, 1));
    const corner = targetTurn(named('top-front-right'), home);
    near(corner.right, HOME.right);
    near(corner.up, HOME.up);
    // Angles: 45 degrees from each face of an edge, 54.7 from each of a corner's.
    expect(dot3(look(targetTurn(named('top-front'), home)), v3(0, 0, 1))).toBeCloseTo(Math.SQRT1_2, 12);
    expect(dot3(look(targetTurn(named('bottom-back-left'), home)), v3(0, 0, -1))).toBeCloseTo(1 / Math.sqrt(3), 12);
  });

  it('TOP from Home, whose spin is not square to an axis, has +Y up the screen; BOTTOM -Y', () => {
    const top = targetTurn(named('top'), home);
    near(look(top), v3(0, 0, 1));
    near(top.right, v3(1, 0, 0));
    near(top.up, v3(0, 1, 0));
    const bottom = targetTurn(named('bottom'), home);
    near(look(bottom), v3(0, 0, -1));
    near(bottom.right, v3(1, 0, 0));
    near(bottom.up, v3(0, -1, 0));
  });

  it('TOP and BOTTOM keep a spin square to an axis', () => {
    // From RIGHT the screen's right is +Y: turned over the top it stays +Y, so -X is up the screen.
    const fromRight = targetTurn(named('top'), targetTurn(named('right'), home));
    near(fromRight.right, v3(0, 1, 0));
    near(fromRight.up, v3(-1, 0, 0));
    // From BACK, turned under.
    const fromBack = targetTurn(named('bottom'), targetTurn(named('back'), home));
    near(fromBack.right, v3(-1, 0, 0));
    near(fromBack.up, v3(0, 1, 0));
    // From TOP spun a quarter turn, TOP again keeps it, and BOTTOM turns under it keeping the right.
    const spun: Turn = { right: v3(0, -1, 0), up: v3(1, 0, 0) };
    near(targetTurn(named('top'), spun).right, v3(0, -1, 0));
    near(targetTurn(named('bottom'), spun).right, v3(0, -1, 0));
    near(look(targetTurn(named('bottom'), spun)), v3(0, 0, -1));
    // A sketch on XZ looks from +Y with Z across the screen: its up, X, stays up.
    const xz: Turn = { right: v3(0, 0, 1), up: v3(1, 0, 0) };
    near(targetTurn(named('top'), xz).up, v3(1, 0, 0));
    // An orbit that left the spin anyhow: TOP goes back to +Y up.
    const anyhow = turnOf(orbitBy(asCamera(targetTurn(named('front'), home)), 31, 0));
    near(targetTurn(named('top'), anyhow).up, v3(0, 1, 0));
  });
});

describe('the label orientation rule', () => {
  it('stands the side labels up Z, and lays every label so it reads from outside', () => {
    for (const f of CUBE_FACES) {
      near(cross3(f.right, f.up), f.n);
      if (f.n.z === 0) near(f.up, v3(0, 0, 1));
    }
    expect(CUBE_FACES.map((f) => f.label).sort()).toEqual(['BACK', 'BOTTOM', 'FRONT', 'LEFT', 'RIGHT', 'TOP']);
  });

  it('reads each side upright looking straight at it with Z up, TOP upright from FRONT and BOTTOM from FRONT turned under', () => {
    const front = targetTurn(named('front'), home);
    for (const f of CUBE_FACES) {
      // Looking straight at the face the way a click on it does, from FRONT for TOP and BOTTOM.
      const t = targetTurn(f.n, f.n.z === 0 ? home : front);
      near(t.right, f.right);
      near(t.up, f.up);
    }
    near(labelAxes(v3(0, 0, 1)).up, v3(0, 1, 0));
    near(labelAxes(v3(0, 0, -1)).up, v3(0, -1, 0));
    // From FRONT the top edge of the FRONT label is the edge TOP's label stands on: its foot is toward FRONT.
    const top = CUBE_FACES.find((f) => f.label === 'TOP') as (typeof CUBE_FACES)[number];
    expect(dot3(top.up, v3(0, -1, 0))).toBe(-1);
  });
});
