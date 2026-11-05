// Canvas handles for tools: the radius arrow on a fillet, the XY triad on Move, a pattern's quantity
// grip. A tool lists its handles each frame, draws them with drawHandles and asks handleAt on press.
import type { Id, Sketch, Vec2 } from '../model/types';
import { boundingBox } from '../geom/curves';
import { boxAdd, dist, emptyBox, norm, type Box } from '../geom/vec';
import type { View } from '../app/view';
import type { Preview } from '../render/painter';
import { COLORS } from '../render/style';

export interface Handle {
  key: string;
  at: Vec2;
  /** arrow: a direction to drag along; grip: free; ring: rotation; square: free move. */
  shape: 'arrow' | 'grip' | 'ring' | 'square';
  /** Arrow direction in sketch space. */
  dir?: Vec2;
  /** Short text beside the handle. */
  tip?: string;
}

const GRAB_PX = 11;

/** Bounds of curves and loose points: where handles hang from. Null when none of the ids resolve. */
export function boundsOf(sketch: Sketch, ids: readonly Id[]): Box | null {
  const box = emptyBox();
  for (const id of ids) {
    const c = sketch.curves[id];
    if (c) {
      const b = boundingBox(sketch, c);
      boxAdd(box, { x: b.minX, y: b.minY });
      boxAdd(box, { x: b.maxX, y: b.maxY });
    } else if (sketch.points[id] && !sketch.points[id].owner) boxAdd(box, sketch.points[id]);
  }
  return Number.isFinite(box.minX) ? box : null;
}

export const centreOf = (b: Box): Vec2 => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

export function handleAt(view: View, handles: readonly Handle[], screen: Vec2): Handle | null {
  let best: Handle | null = null;
  let bestD = GRAB_PX;
  for (const h of handles) {
    const d = dist(view.toScreen(h.at), screen);
    if (d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

export function drawHandles(p: Preview, handles: readonly Handle[], active: string | null = null): void {
  const { view } = p;
  p.raw((g) => {
    g.setLineDash([]);
    for (const h of handles) {
      const s = view.toScreen(h.at);
      const color = h.key === active ? COLORS.manipActive : COLORS.manip;
      g.fillStyle = color;
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.beginPath();
      if (h.shape === 'arrow') {
        const d = norm(h.dir ?? { x: 1, y: 0 });
        const u = { x: d.x, y: -d.y };
        const n = { x: -u.y, y: u.x };
        g.moveTo(s.x + u.x * 13, s.y + u.y * 13);
        g.lineTo(s.x - u.x * 2 + n.x * 6, s.y - u.y * 2 + n.y * 6);
        g.lineTo(s.x - u.x * 2 - n.x * 6, s.y - u.y * 2 - n.y * 6);
        g.closePath();
        g.fill();
      } else if (h.shape === 'square') {
        g.rect(s.x - 5, s.y - 5, 10, 10);
        g.fillStyle = COLORS.dotHole;
        g.fill();
        g.stroke();
      } else if (h.shape === 'ring') {
        g.arc(s.x, s.y, 7, 0.4, Math.PI * 1.7);
        g.stroke();
        g.beginPath();
        g.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
        g.fill();
      } else {
        g.arc(s.x, s.y, 5.5, 0, Math.PI * 2);
        g.fillStyle = COLORS.dotHole;
        g.fill();
        g.stroke();
      }
    }
  });
  for (const h of handles) {
    if (h.tip) p.text({ x: h.at.x + view.px(10), y: h.at.y - view.px(16) }, h.tip);
  }
}
