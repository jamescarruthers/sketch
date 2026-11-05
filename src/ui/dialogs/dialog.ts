// Reusable floating dialogs: form rows, selection fields and OK/Cancel. See docs/TOOLS.md.
import type { Design, Id } from '../../model/types';
import { evaluateInDesign } from '../../model/parameters';
import type { Hit } from '../../app/hit';
import { icon } from '../icons';

export interface DialogOptions {
  title: string;
  /** Called on OK. Return false to keep the dialog open. */
  onOk(): void | boolean;
  /** Called on Cancel, Esc and the close button. */
  onCancel?(): void;
  /** Runs once after the dialog closes, whichever way. */
  onClose?(): void;
  /** Any control changed: refresh a live preview. */
  onChange?(): void;
  okLabel?: string;
  /** A dialog that only shows something: OK is its one button, and there is nothing to cancel. */
  noCancel?: boolean;
  /** Pixel width. Default 320. */
  width?: number;
}

export interface Field<T> {
  get(): T;
  set(value: T): void;
  /** The row element, e.g. to hide it. */
  row: HTMLElement;
}

export interface ExpressionField extends Field<string> {
  /** The resolved value, or null when the text does not evaluate. */
  value(): number | null;
}

export interface SelectionFieldOptions {
  label: string;
  /** Which picks this field takes. */
  accept(hit: Hit): boolean;
  /** Default true. */
  multiple?: boolean;
  /** Fewest picks for OK. Default 1. */
  min?: number;
  initial?: Id[];
  /** Status prompt while this field takes picks [ref images]. */
  prompt?: string;
}

export interface SelectionField {
  ids(): Id[];
  set(ids: Id[]): void;
  clear(): void;
  /** Start taking picks from the canvas. Fields are mutually exclusive. */
  activate(): void;
  readonly active: boolean;
  readonly options: SelectionFieldOptions;
  /** Toggle a pick from the canvas. */
  pick(id: Id): void;
  /** Add several picks, from a window select. */
  pickMany(ids: Id[]): void;
}

export interface DialogHostEnv {
  readonly design: Design;
  /** A dialog opened or closed, or its selection fields changed. */
  dialogChanged(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const out = document.createElement(tag);
  if (cls) out.className = cls;
  if (text !== undefined) out.textContent = text;
  return out;
};

export class Dialog {
  readonly root = el('div', 'dialog');
  readonly body = el('div', 'dialog-body');
  private readonly okButton = el('button', 'btn primary', 'OK');
  private readonly error = el('div', 'dialog-error');
  private readonly fields: SelectionFieldImpl[] = [];
  closed = false;

  constructor(private readonly host: DialogHost, readonly options: DialogOptions) {
    this.root.style.width = `${options.width ?? 320}px`;
    this.root.dataset.dialog = options.title;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', options.title);
    const head = el('div', 'dialog-head');
    head.append(el('span', '', options.title));
    const x = el('button', 'icon-btn');
    x.innerHTML = icon('close');
    x.title = options.noCancel ? 'Close' : 'Cancel';
    x.onclick = () => this.cancel();
    head.append(x);
    const foot = el('div', 'dialog-foot');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = () => this.cancel();
    this.okButton.textContent = options.okLabel ?? 'OK';
    this.okButton.onclick = () => this.ok();
    foot.append(this.error, this.okButton);
    if (!options.noCancel) foot.append(cancel);
    this.root.append(head, this.body, foot);
    this.dragBy(head);
  }

  private dragBy(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const start = { x: e.clientX, y: e.clientY };
      const box = this.root.getBoundingClientRect();
      const parent = (this.root.parentElement as HTMLElement).getBoundingClientRect();
      const move = (m: PointerEvent): void => {
        this.root.style.left = `${box.left - parent.left + m.clientX - start.x}px`;
        this.root.style.top = `${box.top - parent.top + m.clientY - start.y}px`;
        this.root.style.right = 'auto';
      };
      const up = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  changed(): void {
    this.refreshOk();
    this.options.onChange?.();
  }

  /** Label on the left, any control on the right. */
  row(label: string, control: HTMLElement): HTMLElement {
    const row = el('label', 'form-row');
    row.append(el('span', 'form-label', label), control);
    this.body.append(row);
    return row;
  }

  section(title: string): void {
    this.body.append(el('div', 'form-section', title));
  }

  note(text: string): HTMLElement {
    const n = el('div', 'form-note', text);
    this.body.append(n);
    return n;
  }

  /** Any custom element, full width. */
  custom(element: HTMLElement): void {
    this.body.append(element);
  }

  number(label: string, initial: number, opts: { min?: number; max?: number; step?: number } = {}): Field<number> {
    const input = el('input');
    input.type = 'number';
    input.value = String(initial);
    if (opts.min !== undefined) input.min = String(opts.min);
    if (opts.max !== undefined) input.max = String(opts.max);
    if (opts.step !== undefined) input.step = String(opts.step);
    input.oninput = () => this.changed();
    return { get: () => Number(input.value), set: (v) => { input.value = String(v); }, row: this.row(label, input) };
  }

  text(label: string, initial = ''): Field<string> {
    const input = el('input');
    input.value = initial;
    input.oninput = () => this.changed();
    return { get: () => input.value, set: (v) => { input.value = v; }, row: this.row(label, input) };
  }

  /** Text box that takes expressions like `25.4 mm` or `d1 * 2`, and goes red when they fail. */
  expression(label: string, initial: string, kind: 'length' | 'angle' | 'number' = 'length'): ExpressionField {
    const input = el('input');
    input.value = initial;
    const value = (): number | null => {
      const r = evaluateInDesign(this.host.env.design, input.value, kind);
      return r.ok ? r.value : null;
    };
    input.oninput = () => {
      input.classList.toggle('invalid', value() === null);
      this.changed();
    };
    return { get: () => input.value, set: (v) => { input.value = v; }, row: this.row(label, input), value };
  }

  select(label: string, choices: { value: string; label: string }[], initial?: string): Field<string> {
    const s = el('select');
    for (const c of choices) {
      const o = el('option', '', c.label);
      o.value = c.value;
      s.append(o);
    }
    if (initial !== undefined) s.value = initial;
    s.onchange = () => this.changed();
    return { get: () => s.value, set: (v) => { s.value = v; }, row: this.row(label, s) };
  }

  checkbox(label: string, initial = false): Field<boolean> {
    const input = el('input');
    input.type = 'checkbox';
    input.checked = initial;
    input.onchange = () => this.changed();
    return { get: () => input.checked, set: (v) => { input.checked = v; }, row: this.row(label, input) };
  }

  slider(label: string, initial: number, min: number, max: number, step = 1): Field<number> {
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initial);
    input.oninput = () => this.changed();
    return { get: () => Number(input.value), set: (v) => { input.value = String(v); }, row: this.row(label, input) };
  }

  button(label: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'btn', label);
    b.onclick = onClick;
    this.body.append(b);
    return b;
  }

  /**
   * A selection row [ref Mirror]: "Select" toggles canvas picking, the count shows what is held, X
   * clears. The first field added is active.
   */
  selection(options: SelectionFieldOptions): SelectionField {
    const f = new SelectionFieldImpl(this, options);
    this.fields.push(f);
    this.body.append(f.row);
    if (this.fields.length === 1 && !options.initial?.length) f.activate();
    else f.render();
    this.refreshOk();
    return f;
  }

  /** The field taking canvas picks. */
  activeField(): SelectionField | null {
    return this.fields.find((f) => f.active) ?? null;
  }

  allFieldIds(): Id[] {
    return this.fields.flatMap((f) => f.ids());
  }

  /** Drop picks that no longer exist, e.g. after an undo under the dialog. */
  retainFields(exists: (id: Id) => boolean): void {
    for (const f of this.fields) {
      const kept = f.ids().filter(exists);
      if (kept.length !== f.ids().length) f.set(kept);
    }
  }

  deactivateFields(except?: SelectionFieldImpl): void {
    for (const f of this.fields) if (f !== except) f.setActive(false);
  }

  /** Advance to the next empty field after a single-pick field fills [ref]. */
  advance(from: SelectionFieldImpl): void {
    const next = this.fields.find((f) => f !== from && f.ids().length === 0);
    if (next) next.activate();
  }

  fieldsChanged(): void {
    this.changed();
    this.host.env.dialogChanged();
  }

  private refreshOk(): void {
    const ready = this.fields.every((f) => f.ids().length >= (f.options.min ?? 1));
    this.okButton.disabled = !ready;
  }

  /** A button of its own beside OK, ahead of Cancel: Don't Save. It decides what it does, and closes the dialog itself if it should. */
  footButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'btn', label);
    b.onclick = onClick;
    this.okButton.after(b);
    return b;
  }

  setError(message: string | null): void {
    this.error.textContent = message ?? '';
  }

  setOkEnabled(enabled: boolean): void {
    this.okButton.disabled = !enabled;
  }

  ok(): void {
    if (this.okButton.disabled) return;
    if (this.options.onOk() === false) return;
    this.close();
  }

  cancel(): void {
    this.close();
    this.options.onCancel?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.root.remove();
    this.host.closed(this);
    this.options.onClose?.();
  }
}

class SelectionFieldImpl implements SelectionField {
  readonly row = el('div', 'form-row selection-row');
  private items: Id[];
  private isActive = false;
  private readonly toggle = el('button', 'select-toggle');
  private readonly count = el('span', 'select-count');
  private readonly clearButton = el('button', 'icon-btn');

  constructor(private readonly dialog: Dialog, readonly options: SelectionFieldOptions) {
    this.items = [...(options.initial ?? [])];
    this.row.dataset.field = options.label;
    this.row.append(el('span', 'form-label', options.label));
    const box = el('div', 'select-box');
    // Select on the live field stays live: the tutorials click it first [ref GUID-E24C20F4].
    this.toggle.onclick = () => this.activate();
    this.clearButton.innerHTML = icon('close');
    this.clearButton.title = 'Clear selection';
    this.clearButton.onclick = () => this.clear();
    box.append(this.toggle, this.count, this.clearButton);
    this.row.append(box);
  }

  get active(): boolean {
    return this.isActive;
  }

  ids(): Id[] {
    return [...this.items];
  }

  render(): void {
    this.toggle.textContent = 'Select';
    this.toggle.classList.toggle('active', this.isActive);
    this.count.textContent = this.items.length ? `${this.items.length} selected` : '';
    this.clearButton.style.visibility = this.items.length ? 'visible' : 'hidden';
  }

  setActive(on: boolean): void {
    if (this.isActive === on) return;
    this.isActive = on;
    this.render();
    this.dialog.fieldsChanged();
  }

  activate(): void {
    this.dialog.deactivateFields(this);
    this.setActive(true);
  }

  set(ids: Id[]): void {
    this.items = [...ids];
    this.render();
    this.dialog.fieldsChanged();
  }

  clear(): void {
    this.set([]);
    this.activate();
  }

  pick(id: Id): void {
    if (this.options.multiple === false) {
      this.set([id]);
      this.setActive(false);
      this.dialog.advance(this);
      return;
    }
    this.set(this.items.includes(id) ? this.items.filter((i) => i !== id) : [...this.items, id]);
  }

  pickMany(ids: Id[]): void {
    if (this.options.multiple === false) {
      if (ids[0]) this.pick(ids[0]);
      return;
    }
    this.set([...new Set([...this.items, ...ids])]);
  }
}

/** Owns the dialog stack. One modal-less dialog at a time; tools reach it as `ctx.dialogs`. */
export class DialogHost {
  current: Dialog | null = null;

  constructor(private readonly layer: HTMLElement, readonly env: DialogHostEnv) {}

  open(options: DialogOptions): Dialog {
    this.current?.cancel();
    const d = new Dialog(this, options);
    this.layer.append(d.root);
    this.current = d;
    this.env.dialogChanged();
    return d;
  }

  closed(d: Dialog): void {
    if (this.current === d) this.current = null;
    this.env.dialogChanged();
  }
}

/** A dialog asking one yes or no question. */
export function confirmDialog(host: DialogHost, title: string, message: string, onYes: () => void): void {
  const d = host.open({ title, onOk: onYes, okLabel: 'OK' });
  d.note(message);
}
