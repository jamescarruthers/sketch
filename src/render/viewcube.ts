// Draws the ViewCube (src/app/viewcube.ts): the faces turned toward the camera, the part under the cursor lit,
// the labels laid on their faces through the cube's own projection, and the axis triad at the origin corner.
import type { Vec3 } from '../model/types';
import { add3, dot3, scale3, v3 } from '../model/frames';
import { CUBE_BAND, CUBE_FACES, cubeToScreen, facePoint, targetAt, targetName, toward, visibleFaces, type CubeLayout, type Turn } from '../app/viewcube';
import { COLORS } from './style';

/** A face turned less toward the camera than this has its label left off: it would be a smear. */
const LABEL_FACING = 0.2;
/** The labels' largest size, and the part of a face's width the longest of them may take. */
const LABEL_PX = 10;
const LABEL_SPAN = 0.78;
/** The triad's length, in units of half the cube's edge, from the origin corner. */
const TRIAD = 0.55;

/** The three cuts across a face, each way, that bound its middle, its edge bands and its corners. */
const CUTS: [number, number][] = [[-1, -(1 - CUBE_BAND)], [-(1 - CUBE_BAND), 1 - CUBE_BAND], [1 - CUBE_BAND, 1]];

export function drawCube(g: CanvasRenderingContext2D, dpr: number, t: Turn, layout: CubeLayout, hover: string | null): void {
  const at = (p: Vec3) => cubeToScreen(t, layout, p);
  const n = toward(t);
  g.save();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.setLineDash([]);
  g.globalAlpha = 1;
  g.lineJoin = 'round';
  const quad = (pts: Vec3[]): void => {
    g.beginPath();
    pts.forEach((p, i) => {
      const s = at(p);
      if (i === 0) g.moveTo(s.x, s.y);
      else g.lineTo(s.x, s.y);
    });
    g.closePath();
  };
  const faces = visibleFaces(t);
  for (const f of faces) {
    quad([facePoint(f, -1, -1), facePoint(f, 1, -1), facePoint(f, 1, 1), facePoint(f, -1, 1)]);
    g.fillStyle = COLORS.cubeFace;
    g.fill();
    if (hover) {
      // Each of the nine parts of the face is the face, an edge or a corner: those that are the one hovered light.
      g.fillStyle = COLORS.cubeHover;
      for (const [s0, s1] of CUTS) {
        for (const [t0, t1] of CUTS) {
          if (targetName(targetAt(f, (s0 + s1) / 2, (t0 + t1) / 2)) !== hover) continue;
          quad([facePoint(f, s0, t0), facePoint(f, s1, t0), facePoint(f, s1, t1), facePoint(f, s0, t1)]);
          g.fill();
        }
      }
    }
  }

  // One size for every label, the one the longest fits at.
  g.font = `600 ${LABEL_PX}px Inter, system-ui, sans-serif`;
  const widest = Math.max(...CUBE_FACES.map((f) => g.measureText(f.label).width));
  const size = Math.min(LABEL_PX, (LABEL_PX * LABEL_SPAN * 2 * layout.half) / widest);
  g.font = `600 ${size.toFixed(2)}px Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = COLORS.cubeInk;
  for (const f of faces) {
    if (dot3(f.n, n) < LABEL_FACING) continue;
    // The face's own coordinates onto the screen, a pixel a pixel face-on: x along its right, y down its up.
    const c = at(f.n);
    const r = at(add3(f.n, scale3(f.right, 1 / layout.half)));
    const u = at(add3(f.n, scale3(f.up, 1 / layout.half)));
    g.setTransform(dpr * (r.x - c.x), dpr * (r.y - c.y), -dpr * (u.x - c.x), -dpr * (u.y - c.y), dpr * c.x, dpr * c.y);
    g.fillText(f.label, 0, 0.5);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  g.strokeStyle = COLORS.cubeEdge;
  g.lineWidth = 1;
  for (const f of faces) {
    quad([facePoint(f, -1, -1), facePoint(f, 1, -1), facePoint(f, 1, 1), facePoint(f, -1, 1)]);
    g.stroke();
  }

  // X, Y and Z from the corner the axes run from, along its edges, over the faces so none is ever hidden.
  const origin = v3(-1, -1, -1);
  const o = at(origin);
  g.lineWidth = 2;
  g.lineCap = 'round';
  for (const [d, color] of [[v3(1, 0, 0), COLORS.axisX], [v3(0, 1, 0), COLORS.axisY], [v3(0, 0, 1), COLORS.axisZ]] as [Vec3, string][]) {
    const e = at(add3(origin, scale3(d, TRIAD)));
    if (Math.hypot(e.x - o.x, e.y - o.y) < 1) continue;
    g.strokeStyle = color;
    g.beginPath();
    g.moveTo(o.x, o.y);
    g.lineTo(e.x, e.y);
    g.stroke();
  }
  g.restore();
}
