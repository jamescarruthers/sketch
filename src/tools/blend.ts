// Blend Curve [ref SKT-BLEND-CURVE]: palette G1/G2, pick a curve, then the second near the wanted end.
import type { Id, Vec2 } from '../model/types';
import { curveEnds } from '../model/document';
import { closestPoint } from '../geom/curves';
import { blend, blendPreview, type BlendMode, type CurveEnd } from '../geom/modify';
import { controlSplineEval } from '../geom/spline';
import { COLORS } from '../render/style';
import type { Hit, Preview, Tool, ToolContext, ToolDef } from './tool';

const SAMPLES = 48;

const nearestEnd = (ctx: ToolContext, id: Id, p: Vec2): CurveEnd =>
  (closestPoint(ctx.sketch, ctx.sketch.curves[id], p).t < 0.5 ? 0 : 1);

function createBlend(ctx: ToolContext): Tool {
  let mode: BlendMode = 'G1';
  let first: { id: Id; end: CurveEnd } | null = null;
  let hover: { id: Id; end: CurveEnd } | null = null;

  const accept = (h: Hit): boolean => {
    const c = ctx.sketch.curves[h.id];
    return h.kind === 'curve' && !!c && c.type !== 'text' && !!curveEnds(c);
  };

  const options = (): void => {
    ctx.palette.options([{
      key: 'continuity', label: 'Blend Type', kind: 'select', value: mode,
      options: [{ value: 'G1', label: 'Tangent (G1)' }, { value: 'G2', label: 'Curvature (G2)' }],
      onChange: (v) => {
        mode = v as BlendMode;
        ctx.invalidate();
      },
    }]);
  };

  const prompt = (): void => ctx.status(first ? 'Pick the second curve, near the end to blend to' : 'Pick the first curve, near the end to blend from');

  const light = (): void => ctx.setHighlight(first ? [first.id] : []);

  const look = (screen: Vec2): Hit | null => {
    const hit = ctx.hit(screen, { kinds: ['curve'], accept });
    ctx.setHover(hit);
    hover = hit ? { id: hit.id, end: nearestEnd(ctx, hit.id, hit.pos) } : null;
    return hit;
  };

  return {
    start() {
      ctx.selection.clear();
      options();
      prompt();
    },
    stop() {
      ctx.setHover(null);
      ctx.setHighlight([]);
    },
    move(e) {
      look(e.screen);
    },
    click(e) {
      look(e.screen);
      if (!hover) return;
      const pick = hover;
      if (!first) {
        first = pick;
      } else if (first.id === pick.id) {
        first = null; // [ref] click the curve again to deselect it.
      } else {
        const a = first;
        const m = mode;
        ctx.commit('Blend Curve', (c) => blend(c.design, c.sketch, a.id, a.end, pick.id, pick.end, m).created.length > 0);
        first = null;
      }
      light();
      prompt();
    },
    escape() {
      if (!first) return false;
      first = null;
      light();
      prompt();
      return true;
    },
    draw(p: Preview) {
      if (!first || !hover || first.id === hover.id) return;
      const b = blendPreview(ctx.sketch, first.id, first.end, hover.id, hover.end, mode);
      if (!b) return;
      const ev = controlSplineEval(b.ctrl, b.degree);
      p.poly(Array.from({ length: SAMPLES + 1 }, (_, i) => ev.at(i / SAMPLES)), false, { color: COLORS.preview, width: 2, dash: [6, 4] });
    },
    docChanged() {
      first = null;
      hover = null;
      light();
    },
  };
}

export const blendTool: ToolDef = {
  meta: { id: 'blend-curve', label: 'Blend Curve', panel: 'modify' },
  create: createBlend,
};
