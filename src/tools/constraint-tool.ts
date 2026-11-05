// Shared base for constraint tools: preselect then click, or click then pick [ref]. The first pick
// is the reference: its points are held during the solve, so the second moves to match [ref Activity 2].
// The exception is a first pick lighter than the second: the free object gives way whichever came first.
import type { Id } from '../model/types';
import { AXIS_X, AXIS_Y, ORIGIN } from '../model/types';
import { curvePoints } from '../model/document';
import { weightOf } from '../solver/seat';
import { drawBadge, type GlyphKind } from '../render/glyphs';
import type { CommitScope, Hit, Tool, ToolContext, ToolDef, ToolMeta } from './tool';

const CURSOR_GAP = 18;
const CURSOR_GLYPH: Record<string, GlyphKind> = {
  coincident: 'coincident', hv: 'horizontal', equal: 'equal', tangent: 'tangent', parallel: 'parallel',
  perpendicular: 'perpendicular', fix: 'fix', midpoint: 'midpoint', concentric: 'concentric', collinear: 'collinear',
  symmetry: 'symmetric', curvature: 'curvature',
};

export interface ConstraintSpec {
  meta: Omit<ToolMeta, 'panel'>;
  /** Picks that make one application. May depend on the first pick. */
  count: number | ((first: Hit) => number);
  /** Whether `hit` is valid given `picked`. Valid targets highlight, invalid ones do not [ref]. */
  accept(ctx: ToolContext, hit: Hit, picked: Hit[]): boolean;
  /** Add the constraint. Return false to abandon. `ctx` is there for a status message. */
  apply(c: CommitScope, picks: Hit[], ctx: ToolContext): void | boolean;
  /** Status prompts by number of picks so far; the last repeats. */
  prompts: string[];
  /** Undo label. Defaults to meta.label. */
  label?: string;
  /** Why a pick the tool will not take cannot be taken, when that is worth saying. */
  refuse?(ctx: ToolContext, hit: Hit, picked: Hit[]): string | null;
  /** Tool-specific holds. Default: every point of the first pick. */
  hold?(ctx: ToolContext, picks: Hit[]): Id[];
  /** Put a preselection into pick order, when the order it was selected in does not matter. */
  arrange?(ctx: ToolContext, picks: Hit[]): Hit[];
  /** Told that `apply` was refused: true to have it applied once more, some other way. */
  retry?(): boolean;
}

/** The stored points of a pick. */
export function pointsOf(ctx: ToolContext, hit: Hit): Id[] {
  if (hit.kind === 'point') return hit.id === ORIGIN ? [] : [hit.id];
  if (hit.kind !== 'curve' || hit.id === AXIS_X || hit.id === AXIS_Y) return [];
  const c = ctx.sketch.curves[hit.id];
  return c ? curvePoints(c) : [];
}

/** The pick to hold: the first, unless it is the lighter of two. */
export function heavier(ctx: ToolContext, picks: Hit[]): Hit {
  if (picks.length !== 2) return picks[0];
  const heavy = picks.map((h) => weightOf(ctx.sketch, h.kind === 'point' ? [h.id] : pointsOf(ctx, h)));
  return heavy[0] < heavy[1] ? picks[1] : picks[0];
}

export function defineConstraintTool(spec: ConstraintSpec): ToolDef {
  const label = spec.label ?? spec.meta.label;
  const need = (first: Hit): number => (typeof spec.count === 'number' ? spec.count : spec.count(first));
  return {
    meta: { ...spec.meta, panel: 'constraints' },
    create(ctx) {
      const picked: Hit[] = [];

      const prompt = (): void => {
        ctx.status(spec.prompts[Math.min(picked.length, spec.prompts.length - 1)]);
      };
      const clearPicks = (): void => {
        picked.length = 0;
        ctx.selection.clear();
        prompt();
      };
      const applyPicks = (picks: Hit[]): boolean => {
        const once = (): boolean => ctx.commit(label, (c) => {
          // The active layer moves whichever way round it was picked: this overrides first-pick-stays.
          const foreign = picks.filter((h) => ctx.foreign(h));
          const holds = foreign.length ? foreign.flatMap((h) => pointsOf(ctx, h)) : spec.hold ? spec.hold(ctx, picks) : pointsOf(ctx, heavier(ctx, picks));
          c.hold(...holds);
          return spec.apply(c, picks, ctx);
        });
        return once() || (!!spec.retry?.() && once());
      };

      /** Another layer is a reference only: the last pick has to leave something on the active layer to move. */
      const validFor = (hit: Hit, picks: Hit[]): boolean => {
        if (!spec.accept(ctx, hit, picks)) return false;
        const all = [...picks, hit];
        if (all.length < need(all[0]) || !all.some((h) => ctx.foreign(h))) return true;
        return all.some((h) => ctx.onActive(h));
      };

      /** Preselection: one reference paired with each of the rest, or each alone. */
      const usePreselection = (): boolean => {
        const raw = ctx.selection.ids().map((id) => ctx.hitOf(id)).filter((h): h is Hit => !!h);
        const hits = spec.arrange ? spec.arrange(ctx, raw) : raw;
        if (hits.length === 0) return false;
        const first = hits[0];
        const n = need(first);
        if (n === 1) {
          const valid = hits.filter((h) => validFor(h, []));
          if (!valid.length) return false;
          valid.forEach((h) => applyPicks([h]));
          ctx.selection.clear();
          ctx.end();
          return true;
        }
        if (!validFor(first, [])) return false;
        if (hits.length < n) {
          picked.push(...hits);
          return false;
        }
        let any = false;
        if (n === 2) {
          for (const h of hits.slice(1)) {
            if (validFor(h, [first]) && applyPicks([first, h])) any = true;
          }
        } else if (hits.length === n && hits.every((h, i) => validFor(h, hits.slice(0, i)))) {
          any = applyPicks(hits);
        }
        ctx.selection.clear();
        if (any) ctx.end();
        return any;
      };

      const hover = (screen: { x: number; y: number }): Hit | null => ctx.hit(screen, {
        reserved: true, accept: (h) => validFor(h, picked),
      });

      const tool: Tool = {
        start() {
          if (!usePreselection()) prompt();
        },
        stop() {
          ctx.setHover(null);
          picked.length = 0;
        },
        move(e) {
          ctx.setHover(hover(e.screen));
        },
        click(e) {
          const hit = hover(e.screen);
          if (!hit) {
            const under = spec.refuse ? ctx.hit(e.screen, { reserved: true, kinds: ['curve'] }) : null;
            const why = under ? spec.refuse?.(ctx, under, picked) : null;
            if (why) ctx.message(why, 'warn');
            return;
          }
          picked.push(hit);
          const total = need(picked[0]);
          if (picked.length < total) {
            ctx.selection.add([hit.id]);
            prompt();
            return;
          }
          const picks = [...picked];
          clearPicks();
          applyPicks(picks);
        },
        enter: () => false,
        draw(p) {
          // The tool's own glyph rides beside the cursor [ref SKT-CONSTRAIN-*].
          const at = ctx.pointer?.screen;
          const glyph = CURSOR_GLYPH[spec.meta.id];
          if (at && glyph) p.raw((g) => drawBadge(g, glyph, at.x + CURSOR_GAP, at.y + CURSOR_GAP, 'idle'));
        },
        escape() {
          if (picked.length === 0) return false;
          clearPicks();
          return true;
        },
        docChanged: clearPicks,
      };
      return tool;
    },
  };
}
