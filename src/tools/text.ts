// Text: a dialog for frame text and text on a path [ref SKT-CREATE-TEXT, SKT-REF-TEXT-DIALOG], with a live
// preview, a rotation handle for the frame, Explode Text, and double-click to edit.
import type { Design, Id, Sketch, TextEntity, Vec2 } from '../model/types';
import { addFrameText, addPathText, type TextFormat } from '../model/document';
import { textNames, textParameters } from '../model/parameters';
import { explodeText, fontFamilies, fontReady, syncFrameEdges, textOutlines } from '../io/text';
import { add, dist, lerp, rotateAbout, sub } from '../geom/vec';
import type { Dialog, Field, ExpressionField, SelectionField } from '../ui/dialogs/dialog';
import { COLORS } from '../render/style';
import type { ContextAction, DoubleClickHandler } from './registry';
import { defineDialogTool } from './dialog-tool';
import { angleOf } from './kit';
import type { Hit, Preview, Tool, ToolContext, ToolDef, ToolPointer } from './tool';

const HANDLE_PX = 34;
const GRAB_PX = 10;

interface State {
  dialog: Dialog;
  /** Text being edited, or null when creating. */
  edit: Id | null;
  type: Field<string>;
  path: SelectionField;
  text: HTMLTextAreaElement;
  font: Field<string>;
  bold: Field<boolean>;
  italic: Field<boolean>;
  height: ExpressionField;
  spacing: Field<number>;
  flipH: Field<boolean>;
  flipV: Field<boolean>;
  halign: Field<string>;
  valign: Field<string>;
  placement: Field<string>;
  fit: Field<boolean>;
  angle: ExpressionField;
  frameRows: HTMLElement[];
  pathRows: HTMLElement[];
  /** Frame corners clicked so far, and where the cursor is. */
  corners: Vec2[];
  cursor: Vec2 | null;
  /** The snap point the frame turns about. Null means the first corner. */
  pivot: Vec2 | null;
}

let live: State | null = null;

const isPath = (s: State): boolean => s.type.get() === 'path';

const textOf = (ctx: ToolContext, id: Id | null): TextEntity | null => {
  const c = id ? ctx.sketch.curves[id] : undefined;
  return c?.type === 'text' ? c : null;
};

/** The frame as clicked and rotated: bottom-left, bottom-right, top-right, top-left. */
function frameCorners(s: State): [Vec2, Vec2, Vec2, Vec2] | null {
  const a = s.corners[0];
  const b = s.corners[1] ?? s.cursor;
  if (!a || !b || Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6) return null;
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  // The angle field resolves to radians.
  const turn = s.angle.value() ?? 0;
  const base: [Vec2, Vec2, Vec2, Vec2] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const pivot = s.pivot ?? a;
  return base.map((p) => (turn === 0 ? p : rotateAbout(p, pivot, turn))) as [Vec2, Vec2, Vec2, Vec2];
}

/** The nine snap points of the frame [ref text-frame.gif]: corners, edge midpoints, centre. */
function snapPoints(s: State): Vec2[] {
  const c = frameCorners(s);
  if (!c || s.corners.length < 2) return [];
  return [...c, ...c.map((p, i) => lerp(p, c[(i + 1) % 4], 0.5)), lerp(c[0], c[2], 0.5)];
}

/** Turn about `to` from now on, leaving the frame exactly where it is. */
function setPivot(s: State, to: Vec2): void {
  const turn = s.angle.value() ?? 0;
  const from = s.pivot ?? s.corners[0];
  const d = sub(to, from);
  const shift = sub(d, rotateAbout(d, { x: 0, y: 0 }, -turn));
  s.corners = s.corners.map((p) => add(p, shift));
  s.pivot = to;
}

const formatOf = (s: State): TextFormat => ({
  font: s.font.get(), bold: s.bold.get(), italic: s.italic.get(), spacing: s.spacing.get(), flipH: s.flipH.get(),
  flipV: s.flipV.get(), halign: s.halign.get() as TextEntity['halign'], valign: s.valign.get() as TextEntity['valign'],
  above: s.placement.get() === 'above', fitToPath: s.fit.get(),
});

/** What the dialog describes right now, as an entity in a scratch copy of the sketch. */
function describe(ctx: ToolContext, s: State): { entity: TextEntity; sketch: Sketch } | null {
  const height = s.height.value();
  if (height === null || !(height > 0)) return null;
  const sketch: Sketch = { ...ctx.sketch, points: { ...ctx.sketch.points }, curves: { ...ctx.sketch.curves } };
  const base = {
    id: '__text', type: 'text' as const, lineType: 'normal' as const, text: s.text.value, height, ...formatOf(s),
  } as TextEntity;
  const existing = textOf(ctx, s.edit);
  if (existing) return { entity: { ...base, mode: existing.mode, frame: existing.frame, path: existing.path }, sketch };
  if (isPath(s)) {
    const path = s.path.ids()[0];
    return path ? { entity: { ...base, mode: 'path', path }, sketch } : null;
  }
  const corners = frameCorners(s);
  if (!corners) return null;
  const ids = corners.map((p, i) => {
    sketch.points[`__t${i}`] = { id: `__t${i}`, x: p.x, y: p.y };
    return `__t${i}`;
  }) as [Id, Id, Id, Id];
  return { entity: { ...base, mode: 'frame', frame: ids }, sketch };
}

function fillOutlines(p: Preview, outlines: Vec2[][]): void {
  p.raw((g) => {
    g.fillStyle = COLORS.glyphFill;
    g.beginPath();
    for (const loop of outlines) {
      loop.forEach((pt, i) => {
        const q = p.view.toScreen(pt);
        if (i === 0) g.moveTo(q.x, q.y);
        else g.lineTo(q.x, q.y);
      });
      g.closePath();
    }
    g.fill('nonzero');
  });
}

/** The rotation handle: above the middle of the top edge. */
function handleOf(ctx: ToolContext, s: State): { at: Vec2; from: Vec2 } | null {
  const c = frameCorners(s);
  if (!c || s.corners.length < 2 || s.edit) return null;
  const top = { x: (c[2].x + c[3].x) / 2, y: (c[2].y + c[3].y) / 2 };
  const up = { x: c[3].x - c[0].x, y: c[3].y - c[0].y };
  const l = Math.hypot(up.x, up.y) || 1;
  return { from: top, at: add(top, { x: (up.x / l) * ctx.view.px(HANDLE_PX), y: (up.y / l) * ctx.view.px(HANDLE_PX) }) };
}

/** Fix the name it first shows under, so references to it outlive other texts. */
const nameIt = (design: Design, t: TextEntity): void => {
  t.parameter = textNames(design).get(t.id);
};

/** Parameter and dimension names for the {braces} being typed [ref SKT-CREATE-TEXT]. */
function suggest(ctx: ToolContext, area: HTMLTextAreaElement, list: HTMLElement, d: Dialog): void {
  const before = area.value.slice(0, area.selectionStart ?? area.value.length);
  const open = /\{([\w.]*)$/.exec(before);
  list.replaceChildren();
  if (!open) return;
  const dimensions = Object.values(ctx.design.sketches).flatMap((s) => Object.values(s.dimensions).map((k) => k.name));
  const all = [...new Set([...textParameters(ctx.design).keys(), ...ctx.design.parameters.map((p) => p.name), ...dimensions])];
  for (const name of all.filter((n) => n.startsWith(open[1])).slice(0, 8)) {
    const b = document.createElement('button');
    b.className = 'name-item';
    b.textContent = name;
    b.onmousedown = (e) => {
      e.preventDefault();
      const at = before.length;
      area.setRangeText(`${name.slice(open[1].length)}}`, at, at, 'end');
      list.replaceChildren();
      d.changed();
    };
    list.append(b);
  }
}

/**
 * Bold, Italic, Flip and Alignment are icon buttons [ref SKT-REF-TEXT-DIALOG]. The form controls stay
 * underneath and hold the values, so reading them, and the keyboard, work as for any field.
 */
function iconToggle(row: HTMLElement, glyph: string, title: string): void {
  row.classList.add('icon-row');
  const input = row.querySelector('input') as HTMLInputElement;
  input.classList.add('icon-toggle');
  input.title = title;
  input.dataset.glyph = glyph;
}

function iconChoice(row: HTMLElement, field: Field<string>, d: Dialog, choices: { value: string; icon: string; title: string }[]): void {
  row.classList.add('icon-row');
  const select = row.querySelector('select') as HTMLSelectElement;
  select.classList.add('behind');
  const group = document.createElement('span');
  group.className = 'icon-group';
  const paint = (): void => {
    for (const b of group.children) b.classList.toggle('active', (b as HTMLElement).dataset.value === field.get());
  };
  for (const c of choices) {
    const b = document.createElement('button');
    b.className = 'icon-choice';
    b.type = 'button';
    b.title = c.title;
    b.dataset.value = c.value;
    b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16"><path d="${c.icon}" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>`;
    b.onclick = (e) => {
      e.preventDefault();
      field.set(c.value);
      paint();
      d.changed();
    };
    group.append(b);
  }
  select.addEventListener('change', paint);
  row.append(group);
  paint();
}

const AFTER_FRAME = 'Drag the handle or set the angle. Click a snap point to turn about it, then OK';

function drawFrame(p: Preview, ctx: ToolContext, s: State): void {
  const c = frameCorners(s);
  if (c) p.poly(c, true, { color: COLORS.construction, dash: [7, 5], width: 1 });
  const pivot = s.pivot ?? (c ? c[0] : null);
  for (const q of snapPoints(s)) p.dot(q, { color: COLORS.selected, fill: pivot && dist(q, pivot) < 1e-6 ? COLORS.selected : COLORS.dotHole }, 3.5);
  const h = handleOf(ctx, s);
  if (h) {
    p.line(h.from, h.at, { color: COLORS.selected, width: 1 });
    p.dot(h.at, { color: COLORS.selected, fill: COLORS.handleFill }, 5);
  }
}

const setError = (ctx: ToolContext, s: State, d: { setError(m: string | null): void; setOkEnabled(on: boolean): void }): void => {
  const height = s.height.value();
  let problem: string | null = null;
  if (height === null || !(height > 0)) problem = 'Height must be a positive length';
  else if (s.angle.value() === null) problem = 'Angle is not a valid value';
  else if (!s.text.value.trim()) problem = 'Enter some text';
  else if (!s.edit && isPath(s) && !s.path.ids().length) problem = 'Select a path';
  else if (!s.edit && !isPath(s) && (s.corners.length < 2 || !frameCorners(s))) problem = 'Click two corners for the text frame';
  d.setError(problem);
  d.setOkEnabled(!problem);
  void ctx;
};

const base = defineDialogTool<State>({
  meta: { id: 'text', label: 'Text', panel: 'create' },
  title: 'Text',
  width: 340,
  build(ctx, d, arg) {
    const editing = typeof arg === 'string' ? textOf(ctx, arg) : null;
    const types = [{ value: 'frame', label: 'Text' }, { value: 'path', label: 'Text On Path' }];
    const type = d.select('Type', types, editing ? editing.mode : 'frame');
    const state = { dialog: d, edit: editing?.id ?? null, pivot: null } as State;
    state.type = type;
    state.path = d.selection({
      label: 'Path', multiple: false, min: 0, initial: editing?.path ? [editing.path] : [],
      accept: (h: Hit) => h.kind === 'curve' && isPathOk(ctx, h.id, state),
    });
    const area = document.createElement('textarea');
    area.rows = 3;
    area.value = editing?.text ?? '';
    area.spellcheck = false;
    area.style.cssText = 'width:100%;resize:vertical;font:inherit;box-sizing:border-box';
    const textRow = d.row('Text', area);
    const names = document.createElement('div');
    names.className = 'name-list';
    textRow.after(names);
    area.oninput = () => {
      suggest(ctx, area, names, d);
      d.changed();
    };
    area.onkeyup = () => suggest(ctx, area, names, d);
    state.text = area;
    const families = fontFamilies();
    state.font = d.select('Font', (families.length ? families : ['Inter']).map((f) => ({ value: f, label: f })), editing?.font ?? 'Inter');
    state.bold = d.checkbox('Bold', editing?.bold ?? false);
    state.italic = d.checkbox('Italic', editing?.italic ?? false);
    state.height = d.expression('Height', editing ? `${Number(editing.height.toFixed(4))} mm` : '5 mm', 'length');
    state.spacing = d.number('Character Spacing %', editing?.spacing ?? 0, { step: 5 });
    state.placement = d.select('Placement', [{ value: 'above', label: 'Above path' }, { value: 'below', label: 'Below path' }], editing?.above === false ? 'below' : 'above');
    state.fit = d.checkbox('Fit to Path', editing?.fitToPath ?? false);
    state.flipH = d.checkbox('Flip Horizontal', editing?.flipH ?? false);
    state.flipV = d.checkbox('Flip Vertical', editing?.flipV ?? false);
    state.halign = d.select('Horizontal', [
      { value: 'left', label: 'Align Left' }, { value: 'center', label: 'Align Center' }, { value: 'right', label: 'Align Right' },
    ], editing?.halign ?? 'left');
    state.valign = d.select('Vertical', [
      { value: 'top', label: 'Align Top' }, { value: 'middle', label: 'Align Middle' }, { value: 'bottom', label: 'Align Bottom' },
    ], editing?.valign ?? 'bottom');
    iconToggle(state.bold.row, 'B', 'Bold');
    iconToggle(state.italic.row, 'I', 'Italic');
    iconToggle(state.flipH.row, '↔', 'Flip Horizontal');
    iconToggle(state.flipV.row, '↕', 'Flip Vertical');
    iconChoice(state.halign.row, state.halign, d, [
      { value: 'left', title: 'Align Left', icon: 'M2 3h12M2 6.5h7M2 10h12M2 13.5h7' },
      { value: 'center', title: 'Align Center', icon: 'M2 3h12M4.5 6.5h7M2 10h12M4.5 13.5h7' },
      { value: 'right', title: 'Align Right', icon: 'M2 3h12M7 6.5h7M2 10h12M7 13.5h7' },
    ]);
    iconChoice(state.valign.row, state.valign, d, [
      { value: 'top', title: 'Align Top', icon: 'M2 2.5h12M8 13V5M5.5 7.5 8 5l2.5 2.5' },
      { value: 'middle', title: 'Align Middle', icon: 'M2 8h12M8 2v3.5M8 14v-3.5' },
      { value: 'bottom', title: 'Align Bottom', icon: 'M2 13.5h12M8 3v8M5.5 8.5 8 11l2.5-2.5' },
    ]);
    state.angle = d.expression('Angle', '0 deg', 'angle');
    state.frameRows = [state.valign.row, state.angle.row];
    const pathRow = d.body.querySelector<HTMLElement>('[data-field="Path"]') as HTMLElement;
    state.pathRows = [pathRow, state.placement.row, state.fit.row];
    state.corners = [];
    state.cursor = null;
    live = state;
    if (editing) type.row.style.display = 'none';
    void textRow;
    return state;
  },
  changed(ctx, s, d) {
    const path = isPath(s);
    for (const r of s.frameRows) r.style.display = path ? 'none' : '';
    for (const r of s.pathRows) r.style.display = path ? '' : 'none';
    if (s.edit) s.angle.row.style.display = 'none';
    ctx.status(s.edit ? 'Edit the text, then OK' : path ? 'Select the curve for the text to follow, then fill in the dialog'
      : s.corners.length < 2 ? 'Click the first corner, then the opposite corner of the text frame' : AFTER_FRAME);
    setError(ctx, s, d);
  },
  click(ctx, s, e) {
    if (s.edit || isPath(s)) return false;
    const on = snapPoints(s).find((p) => dist(ctx.view.toScreen(p), e.screen) < GRAB_PX);
    if (on) {
      setPivot(s, on);
      ctx.invalidate();
      return true;
    }
    const pos = e.snapped.pos;
    if (s.corners.length >= 2) {
      s.corners = [pos];
      s.pivot = null;
      s.angle.set('0 deg');
    } else s.corners.push(pos);
    s.cursor = null;
    s.dialog.changed();
    ctx.status(s.corners.length < 2 ? 'Click the opposite corner of the text frame' : AFTER_FRAME);
    ctx.invalidate();
    return true;
  },
  preview(p, ctx, s) {
    const d = describe(ctx, s);
    if (!d || !s.text.value) {
      drawFrame(p, ctx, s);
      return;
    }
    if (fontReady(d.entity)) fillOutlines(p, textOutlines(d.entity, d.sketch, { design: ctx.design }));
    if (d.entity.mode === 'frame' && !s.edit) drawFrame(p, ctx, s);
  },
  ok(ctx, s) {
    const d = describe(ctx, s);
    const height = s.height.value();
    if (!d || height === null) return false;
    const fmt = formatOf(s);
    const edited = textOf(ctx, s.edit);
    const done = ctx.commit(edited ? 'Edit Text' : 'Text', (c) => {
      if (edited) {
        Object.assign(c.sketch.curves[edited.id] as TextEntity, { text: s.text.value, height, ...fmt });
        return;
      }
      if (isPath(s)) {
        nameIt(c.design, addPathText(c.design, c.sketch, s.text.value, height, s.path.ids()[0], fmt, c.curveOpts));
        return;
      }
      const corners = frameCorners(s) as [Vec2, Vec2, Vec2, Vec2];
      const t = addFrameText(c.design, c.sketch, s.text.value, height, corners, fmt, c.curveOpts);
      nameIt(c.design, t);
      c.select(t.id);
    });
    return done;
  },
});

/** A path can be any curve but text, and not a curve it already follows. */
function isPathOk(ctx: ToolContext, id: Id, s: State): boolean {
  if (!isPath(s) || id === 'axis-x' || id === 'axis-y') return false;
  const c = ctx.sketch.curves[id];
  return !!c && c.type !== 'text' && !(c.type === 'line' && c.frameOf);
}

let rotating: { from: number; start: number } | null = null;

export const textTool: ToolDef = {
  meta: base.meta,
  create(ctx, arg): Tool {
    const inner = base.create(ctx, arg);
    const handleHit = (e: ToolPointer): boolean => {
      const s = live;
      const h = s ? handleOf(ctx, s) : null;
      return !!h && dist(ctx.view.toScreen(h.at), e.screen) < GRAB_PX;
    };
    return {
      ...inner,
      stop() {
        rotating = null;
        inner.stop?.();
        live = null;
      },
      snap: () => (live && !live.edit && !isPath(live) ? {} : null),
      move(e) {
        const s = live;
        if (s && rotating) {
          const turn = (angleOf(s.pivot ?? s.corners[0], e.world) - rotating.from) * (180 / Math.PI);
          s.angle.set(`${Number((rotating.start + turn).toFixed(3))} deg`);
          ctx.invalidate();
          return;
        }
        if (s && !s.edit && !isPath(s) && s.corners.length === 1) {
          s.cursor = e.snapped.pos;
          ctx.invalidate();
        }
        inner.move?.(e);
      },
      down(e) {
        const s = live;
        if (s && e.button === 0 && handleHit(e)) {
          rotating = { from: angleOf(s.pivot ?? s.corners[0], e.world), start: ((s.angle.value() ?? 0) * 180) / Math.PI };
          return;
        }
        inner.down?.(e);
      },
      up(e) {
        if (rotating) {
          rotating = null;
          return;
        }
        inner.up?.(e);
      },
      click(e) {
        if (rotating) return;
        inner.click?.(e);
      },
    };
  },
};

/** The text a hit belongs to: its letters, or an edge of its frame. */
function hitText(ctx: ToolContext, hit: Hit): Id | null {
  if (hit.kind !== 'curve') return null;
  const c = ctx.sketch.curves[hit.id];
  if (c?.type === 'text') return c.id;
  return c?.type === 'line' && c.frameOf ? c.frameOf : null;
}

/** Right-click: Explode Text [ref SKT-EXPLODE-TEXT]. */
export const explodeTextAction: ContextAction = {
  id: 'explode-text',
  label: 'Explode Text',
  applies: (ctx, hit) => !!hit && hitText(ctx, hit) !== null,
  run(ctx, hit) {
    const id = hitText(ctx, hit as Hit) as Id;
    const entity = textOf(ctx, id);
    if (!entity || !fontReady(entity)) {
      ctx.message('The font is still loading', 'warn');
      return;
    }
    const done = ctx.commit('Explode Text', ({ design, sketch }) => {
      // A text something else refers to keeps its parameter [ref SKT-EXPLODE-TEXT, Note].
      const name = `${textNames(design).get(id)}_text`;
      const used = Object.values(design.sketches).flatMap((s) => Object.values(s.curves)).some((c) => c.id !== id && c.type === 'text' && c.text.includes(`{${name}}`));
      if (used) design.parameters.push({ name, expression: entity.text, value: 0, comment: '', unit: 'text' });
      explodeText(design, sketch, id, { design });
      syncFrameEdges(design, sketch);
    });
    if (done) ctx.message('The exploded text is fixed. Fix/UnFix releases it for editing.');
  },
};

/** Double-click text to edit it. */
export const editTextOnDoubleClick: DoubleClickHandler = {
  applies: (ctx, hit) => hitText(ctx, hit) !== null,
  run: (ctx, hit) => ctx.activate('text', hitText(ctx, hit)),
};

export const textTools: ToolDef[] = [textTool];
