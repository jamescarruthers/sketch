// Change Parameters: User and Model parameters in one table. Each accepted edit is a normal commit, so
// the sketch re-solves and {text} updates as you go; Cancel puts every value back.
import type { Design, Dimension, Id, Sketch, TextEntity, UserParameter } from '../model/types';
import { ownerLayer } from '../model/layers';
import { claimName, nextParameterName } from '../model/document';
import { expressionDeps, isValidName, type ExprKind } from '../model/expressions';
import { evaluateInDesign, textNames, textValue, wouldCycle } from '../model/parameters';
import { formatLength } from '../app/format';
import type { Dialog } from '../ui/dialogs/dialog';
import { defineDialogTool } from './dialog-tool';
import type { ToolContext, ToolDef } from './tool';

const WIDTH = 760;
const NEW_EXPRESSION = '10 mm';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const out = document.createElement(tag);
  if (cls) out.className = cls;
  if (text !== undefined) out.textContent = text;
  return out;
};

/** What a value is: a kind of number, or text, which takes any expression as it stands. */
type ValueKind = ExprKind | 'text';

const kindOfUnit = (unit: UserParameter['unit']): ValueKind => (unit === 'text' ? 'text' : unit === 'mm' ? 'length' : unit === 'deg' ? 'angle' : 'number');
const kindOfDim = (d: Dimension): ExprKind => (d.kind === 'angle' ? 'angle' : 'length');

/** A value for reading: user parameters are in their own unit, model ones in the design's. */
const shown = (value: number, kind: ExprKind, units: Design['units'] = 'mm'): string => {
  if (kind === 'angle') return ((value * 180) / Math.PI).toFixed(2);
  return kind === 'number' ? value.toFixed(4) : formatLength(value, units);
};

const allDimensions = (design: Design): Dimension[] => design.order.flatMap((id) => Object.values(design.sketches[id].dimensions));

const swapName = (text: string, from: string, to: string): string =>
  text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word) => (word === from ? to : word));

function renameEverywhere(design: Design, from: string, to: string): void {
  for (const p of design.parameters) p.expression = swapName(p.expression, from, to);
  for (const d of allDimensions(design)) d.expression = swapName(d.expression, from, to);
  for (const id of design.order) {
    for (const c of Object.values(design.sketches[id].curves)) {
      if (c.type === 'text') c.text = c.text.replace(/\{([^{}]+)\}/g, (_w, inner: string) => `{${swapName(inner, from, to)}}`);
    }
  }
}

function usersOf(design: Design, name: string): string[] {
  const out = design.parameters.filter((p) => p.unit !== 'text' && expressionDeps(p.expression).includes(name)).map((p) => p.name);
  for (const d of allDimensions(design)) if (d.driving && expressionDeps(d.expression).includes(name)) out.push(d.name);
  const names = textNames(design);
  for (const id of design.order) {
    for (const c of Object.values(design.sketches[id].curves)) {
      if (c.type === 'text' && [...c.text.matchAll(/\{([^{}]+)\}/g)].some((m) => expressionDeps(m[1]).includes(name))) out.push(names.get(c.id) as string);
    }
  }
  return out;
}

const nameTaken = (design: Design, name: string): boolean =>
  design.parameters.some((p) => p.name === name) || allDimensions(design).some((d) => d.name === name);


/** Why an expression cannot stand for `name`, or null. */
function problem(design: Design, name: string, expression: string, kind: ValueKind, positive: boolean): string | null {
  if (kind === 'text') return null;
  const r = evaluateInDesign(design, expression, kind);
  if (!r.ok) return r.error.message;
  const cycle = wouldCycle(design, name, expression);
  if (cycle) return `Circular reference: ${cycle.join(' > ')}`;
  return positive && !(r.value > 0) ? 'A dimension must be greater than zero' : null;
}

interface State {
  edits: number;
  /** Fields holding text that does not evaluate. */
  bad: Set<HTMLInputElement>;
  table: HTMLElement;
  /** Re-read what a commit may have changed, leaving the focused input alone. */
  refreshers: (() => void)[];
  /** Folds this dialog's edits into one undo step. */
  undo: { end(): void; drop(): void };
}

function apply(ctx: ToolContext, s: State, fn: (design: Design) => void): void {
  ctx.commit('Change Parameters', (c) => fn(c.design));
  s.edits++;
  for (const r of s.refreshers) r();
}

function setProblem(s: State, d: Dialog, input: HTMLInputElement, message: string | null): void {
  input.classList.toggle('invalid', !!message);
  if (message) s.bad.add(input);
  else s.bad.delete(input);
  d.setError(message);
  d.setOkEnabled(s.bad.size === 0);
}

/** Enter accepts this field, not the whole dialog. */
const acceptOnEnter = (input: HTMLInputElement): void => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      input.blur();
    }
  });
};

function exprInput(
  ctx: ToolContext, s: State, d: Dialog, read: () => string, name: () => string, kind: () => ValueKind, positive: boolean, write: (design: Design, value: string) => void,
): HTMLInputElement {
  const input = el('input');
  input.value = read();
  input.spellcheck = false;
  acceptOnEnter(input);
  input.oninput = () => setProblem(s, d, input, problem(ctx.design, name(), input.value, kind(), positive));
  input.onchange = () => {
    if (s.bad.has(input) || input.value === read()) return;
    const text = input.value;
    apply(ctx, s, (design) => write(design, text));
  };
  s.refreshers.push(() => {
    if (document.activeElement !== input && !s.bad.has(input)) input.value = read();
  });
  return input;
}

function nameInput(ctx: ToolContext, s: State, d: Dialog, read: () => string, write: (design: Design, to: string) => void): HTMLInputElement {
  const input = el('input');
  input.value = read();
  input.spellcheck = false;
  acceptOnEnter(input);
  const check = (): string | null => {
    const to = input.value.trim();
    if (to === read()) return null;
    if (!isValidName(to)) return `'${to}' is not a valid name`;
    return nameTaken(ctx.design, to) ? `'${to}' is already in use` : null;
  };
  input.oninput = () => setProblem(s, d, input, check());
  input.onchange = () => {
    const to = input.value.trim();
    // The same again changes nothing, but it is an answer: what was said about the last try is over.
    if (!s.bad.has(input) && to === read()) ctx.clearNote();
    if (s.bad.has(input) || to === read()) return;
    apply(ctx, s, (design) => write(design, to));
  };
  s.refreshers.push(() => {
    if (document.activeElement !== input && !s.bad.has(input)) input.value = read();
  });
  return input;
}

function header(table: HTMLElement): void {
  const row = el('div', 'param-row param-head');
  for (const t of ['Name', 'Unit', 'Expression', 'Value', 'Comments', '']) row.append(el('span', '', t));
  table.append(row);
}

function userRow(ctx: ToolContext, s: State, d: Dialog, index: number, rebuild: () => void): HTMLElement {
  const row = el('div', 'param-row');
  let name = ctx.design.parameters[index].name;
  const param = (design: Design): UserParameter => design.parameters.find((p) => p.name === name) as UserParameter;
  row.dataset.param = name;
  const nameBox = nameInput(ctx, s, d, () => name, (design, to) => {
    renameEverywhere(design, name, to);
    param(design).name = to;
    name = to;
    row.dataset.param = to;
  });
  const unit = el('select');
  for (const [value, label] of [['mm', 'mm'], ['deg', 'deg'], ['', 'No Units'], ['text', 'Text']]) {
    const o = el('option', '', label);
    o.value = value;
    unit.append(o);
  }
  unit.value = param(ctx.design).unit;
  const expr = exprInput(
    ctx, s, d, () => param(ctx.design).expression, () => name, () => kindOfUnit(unit.value as UserParameter['unit']), false,
    (design, text) => { param(design).expression = text; },
  );
  unit.onchange = () => {
    const next = unit.value as UserParameter['unit'];
    const issue = problem(ctx.design, name, expr.value, kindOfUnit(next), false);
    setProblem(s, d, expr, issue);
    if (!issue) apply(ctx, s, (design) => { param(design).unit = next; });
  };
  const value = el('span', 'param-value');
  const showValue = (): void => {
    const p = param(ctx.design);
    if (!p) return;
    const kind = kindOfUnit(p.unit);
    value.textContent = kind === 'text' ? textValue(p) : shown(p.value, kind);
  };
  showValue();
  s.refreshers.push(showValue);
  const comment = el('input');
  comment.value = param(ctx.design).comment;
  acceptOnEnter(comment);
  comment.onchange = () => {
    const text = comment.value;
    apply(ctx, s, (design) => { param(design).comment = text; });
  };
  const remove = el('button', 'icon-btn param-delete', '×');
  remove.title = 'Delete';
  remove.setAttribute('aria-label', `Delete ${name}`);
  remove.onclick = () => {
    const users = usersOf(ctx.design, name);
    if (users.length) {
      d.setError(`'${name}' is used by ${users.join(', ')}`);
      return;
    }
    // The rows are by index: the ones standing are about to read a list one shorter.
    s.refreshers = [];
    apply(ctx, s, (design) => {
      design.parameters = design.parameters.filter((p) => p.name !== name);
    });
    // Every row is new, each from what is stored: what was typed wrong has gone with the old ones.
    s.bad.clear();
    d.setError(null);
    d.setOkEnabled(true);
    rebuild();
  };
  row.append(nameBox, unit, expr, value, comment, remove);
  return row;
}

/** Why a dimension cannot be edited from here, or null: its object is on another layer, or a locked one. */
function layerBar(design: Design, sketch: Sketch, m: Dimension): string | null {
  const owner = ownerLayer(sketch, m);
  const layer = design.layers.find((l) => l.id === owner);
  if (!layer) return null;
  if (layer.locked) return `On locked layer ${layer.name}: unlock it to edit this`;
  return layer.id === design.activeLayer ? null : `On layer ${layer.name}: make it active to edit this`;
}

function modelRow(ctx: ToolContext, s: State, d: Dialog, sketchId: Id, id: Id): HTMLElement {
  const row = el('div', 'param-row');
  const dim = (design: Design): Dimension => design.sketches[sketchId].dimensions[id];
  const current = dim(ctx.design);
  row.dataset.param = current.name;
  const kind = kindOfDim(current);
  const barred = layerBar(ctx.design, ctx.design.sketches[sketchId], current);
  if (barred) {
    const unit = el('span', 'param-unit', kind === 'angle' ? 'deg' : ctx.design.units);
    const value = el('span', 'param-value', shown(current.value, kind, ctx.design.units));
    const read = (text: string): HTMLInputElement => {
      const box = el('input');
      box.value = text;
      box.readOnly = true;
      box.className = 'param-driven';
      box.title = barred;
      return box;
    };
    const why = el('span', 'param-why', barred);
    why.title = barred;
    row.classList.add('param-barred');
    row.append(read(current.name), unit, read(current.expression), value, why, el('span'));
    return row;
  }
  const name = nameInput(ctx, s, d, () => dim(ctx.design).name, (design, to) => {
    renameEverywhere(design, dim(design).name, to);
    dim(design).name = to;
    row.dataset.param = to;
  });
  const unit = el('span', 'param-unit', kind === 'angle' ? 'deg' : ctx.design.units);
  const value = el('span', 'param-value');
  const showValue = (): void => {
    const m = dim(ctx.design);
    if (!m) return;
    const v = shown(m.value, kind, ctx.design.units);
    value.textContent = m.driving ? v : `(${v})`;
  };
  showValue();
  s.refreshers.push(showValue);
  let expression: HTMLElement;
  if (current.driving) {
    expression = exprInput(
      ctx, s, d, () => dim(ctx.design).expression, () => dim(ctx.design).name, () => kind, true,
      (design, text) => { dim(design).expression = text; },
    );
  } else {
    const fixed = el('input');
    fixed.value = `(${shown(current.value, kind, ctx.design.units)} ${kind === 'angle' ? 'deg' : ctx.design.units})`;
    fixed.readOnly = true;
    fixed.className = 'param-driven';
    fixed.title = 'A driven dimension is read only';
    expression = fixed;
  }
  row.append(name, unit, expression, value, el('span'), el('span'));
  return row;
}

/** Text and height, the two model parameters a text feature gets [ref SKT-SKETCH-CREATE-TEXT]. */
function textRows(ctx: ToolContext, s: State, d: Dialog, sketchId: Id, id: Id, name: string): HTMLElement[] {
  const entity = (design: Design): TextEntity => design.sketches[sketchId].curves[id] as TextEntity;
  const text = el('div', 'param-row');
  text.dataset.param = `${name}_text`;
  const box = el('input');
  box.value = entity(ctx.design).text;
  box.spellcheck = false;
  acceptOnEnter(box);
  box.onchange = () => {
    const value = box.value;
    apply(ctx, s, (design) => { entity(design).text = value; });
  };
  const preview = el('span', 'param-value', entity(ctx.design).text);
  s.refreshers.push(() => { preview.textContent = entity(ctx.design)?.text ?? ''; });
  text.append(el('span', 'param-name', `${name}_text`), el('span', 'param-unit', 'Text'), box, preview, el('span'), el('span'));

  const height = el('div', 'param-row');
  height.dataset.param = `${name}_height`;
  const expr = exprInput(
    ctx, s, d, () => entity(ctx.design).heightExpression ?? `${entity(ctx.design).height} mm`, () => `${name}_height`, () => 'length', true,
    (design, value) => { entity(design).heightExpression = value; },
  );
  const value = el('span', 'param-value');
  const showValue = (): void => {
    const c = entity(ctx.design);
    if (c) value.textContent = shown(c.height, 'length', ctx.design.units);
  };
  showValue();
  s.refreshers.push(showValue);
  height.append(el('span', 'param-name', `${name}_height`), el('span', 'param-unit', ctx.design.units), expr, value, el('span'), el('span'));
  return [text, height];
}

function render(ctx: ToolContext, s: State, d: Dialog): void {
  s.refreshers = [];
  s.table.replaceChildren();
  const rebuild = (): void => render(ctx, s, d);
  const add = el('button', 'btn', 'Add User Parameter');
  add.dataset.action = 'add-parameter';
  add.onclick = () => {
    apply(ctx, s, (design) => {
      const name = nextParameterName(design);
      claimName(design, name);
      design.parameters.push({ name, expression: NEW_EXPRESSION, value: 0, comment: '', unit: 'mm' });
    });
    rebuild();
  };
  const head = el('div', 'param-section');
  head.append(el('span', '', 'User Parameters'), add);
  s.table.append(head);
  header(s.table);
  ctx.design.parameters.forEach((_p, i) => s.table.append(userRow(ctx, s, d, i, rebuild)));
  s.table.append(el('div', 'param-section', 'Model Parameters'));
  for (const sid of ctx.design.order) {
    const sketch = ctx.design.sketches[sid];
    const dims = Object.values(sketch.dimensions);
    const texts = Object.values(sketch.curves).filter((c) => c.type === 'text');
    if (!dims.length && !texts.length) continue;
    s.table.append(el('div', 'param-group', sketch.name));
    for (const m of dims) s.table.append(modelRow(ctx, s, d, sid, m.id));
    const names = textNames(ctx.design);
    for (const c of texts) s.table.append(...textRows(ctx, s, d, sid, c.id, names.get(c.id) as string));
  }
}

export const parametersTool: ToolDef = defineDialogTool<State>({
  meta: { id: 'change-parameters', label: 'Change Parameters', panel: 'modify' },
  title: 'Parameters',
  width: WIDTH,
  build(ctx, d) {
    const s: State = {
      edits: 0, bad: new Set(), table: el('div', 'param-table'), refreshers: [], undo: ctx.groupUndo(),
    };
    d.custom(s.table);
    render(ctx, s, d);
    return s;
  },
  changed(_ctx, s, d) {
    if (s.bad.size) d.setOkEnabled(false);
  },
  docChanged(ctx, s, d) {
    s.bad.clear();
    render(ctx, s, d);
  },
  cancel(_ctx, s) {
    s.undo.drop();
  },
  ok(ctx, s) {
    if (s.bad.size) return false;
    s.undo.end();
    // Nothing changed is still an answer: what was said before the dialog is over.
    if (!s.edits) ctx.clearNote();
    return true;
  },
});
