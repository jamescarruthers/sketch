// Heads-up value fields near the geometry [ref]. A typed value locks the field; the tool reads locks
// through HudApi and a one-line helper turns each into a driving dimension.
import type { Design, Vec2 } from '../model/types';
import { evaluateInDesign } from '../model/parameters';
import type { View } from '../app/view';
import { formatValue } from '../app/format';
import type { HudApi, HudField, HudLock, ValueEditor } from '../tools/tool';
import { icon } from './icons';

interface Live {
  spec: HudField;
  root: HTMLElement;
  input: HTMLInputElement;
  /** What the user typed. Empty means the field still follows the cursor. */
  text: string;
  lock: HudLock | null;
  invalid: boolean;
  /** Where it last sat on screen, and whether it has moved with the cursor. */
  last: Vec2 | null;
  moving: boolean;
  /** Set again after it appeared, so it may be following the cursor. A box set once sits where it was put. */
  refreshed: boolean;
  /** Where the pointer was when the box last shifted. */
  pointerFrom: Vec2 | null;
  /** The pointer got clear of where it was while the box did not shift, so the box does not follow it. */
  stayed: boolean;
  /** The pointer has been off the input, so it can come to the box rather than the box to it. */
  cleared: boolean;
}

export interface HudHost {
  readonly view: View;
  readonly design: Design;
  /** A field's text changed: the tool should re-resolve the cursor. */
  hudChanged(): void;
  /** Where the canvas last saw the pointer, in canvas pixels. */
  pointerScreen(): Vec2 | null;
  /** A button is down on the canvas, so a drag is what moves a box, not the cursor it would follow. */
  pointerHeld(): boolean;
  message(text: string, kind?: 'info' | 'warn'): void;
}

const expressionFor = (text: string, kind: HudField['kind'], design: Design): string => {
  const plain = /^[-+]?[\d.]+$/.test(text.trim());
  if (!plain) return text.trim();
  return kind === 'angle' ? `${text.trim()} deg` : kind === 'length' ? `${text.trim()} ${design.units}` : text.trim();
};

/** A box at the middle of a segment moves half a pixel for each pixel of hand travel. */
const BOX_SHIFT_PX = 0.2;
/** Past both ends of a point snap's 10 px reach, where a box that follows the cursor can hold still. */
const STAYED_PX = 24;

export class Hud implements HudApi {
  private fields: Live[] = [];
  private checkEl: HTMLButtonElement | null = null;
  private checkAt: Vec2 | null = null;
  private editor: { spec: ValueEditor; root: HTMLElement; input: HTMLInputElement } | null = null;
  /** Typed values of earlier steps of a multi-click tool, kept until the tool clears the HUD. */
  private held = new Map<string, HudLock>();
  private lastPointer: Vec2 | null = null;
  private viewVersion = -1;
  /** The view changed and the pointer has not moved since, so a box that shifted was not following it. */
  private viewShifted = false;

  constructor(private readonly layer: HTMLElement, private readonly host: HudHost) {}

  get active(): boolean {
    return this.fields.length > 0;
  }

  get editing(): boolean {
    return this.editor !== null;
  }

  /** The focused HUD input, if any. */
  focused(): HTMLInputElement | null {
    const el = document.activeElement;
    if (this.editor?.input === el) return this.editor.input;
    return this.fields.find((f) => f.input === el)?.input ?? null;
  }

  private make(spec: HudField): Live {
    const root = document.createElement('div');
    root.className = 'hud-field';
    root.dataset.key = spec.key;
    if (spec.label) {
      const tag = document.createElement('span');
      tag.textContent = spec.label;
      root.append(tag);
    }
    const input = document.createElement('input');
    input.spellcheck = false;
    input.autocomplete = 'off';
    root.append(input);
    this.layer.append(root);
    const live: Live = { spec, root, input, text: '', lock: null, invalid: false, last: null, moving: false, refreshed: false, pointerFrom: null, stayed: false, cleared: false };
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => {
      live.text = input.value;
      this.evaluate(live);
      this.host.hudChanged();
    });
    return live;
  }

  private evaluate(f: Live): void {
    const text = f.text.trim();
    f.lock = null;
    f.invalid = false;
    if (text) {
      const expression = expressionFor(text, f.spec.kind, this.host.design);
      const r = evaluateInDesign(this.host.design, expression, f.spec.kind);
      if (r.ok) f.lock = { value: r.value, expression };
      else f.invalid = true;
    }
    f.root.classList.toggle('locked', !!f.lock);
    f.root.classList.toggle('invalid', f.invalid);
  }

  set(specs: HudField[]): void {
    const keep = new Set(specs.map((s) => s.key));
    this.fields = this.fields.filter((f) => {
      if (keep.has(f.spec.key)) return true;
      f.root.remove();
      return false;
    });
    this.fields = specs.map((spec) => {
      const kept = this.fields.find((l) => l.spec.key === spec.key);
      const f = kept ?? this.make(spec);
      if (kept) f.refreshed = true;
      f.spec = spec;
      if (!f.text && document.activeElement !== f.input) {
        f.input.value = formatValue(spec.value, spec.kind, this.host.design.units);
      }
      return f;
    });
    this.position();
  }

  clear(): void {
    for (const f of this.fields) f.root.remove();
    this.fields = [];
    this.held.clear();
  }

  /** Next click step: drop the fields but remember what was typed, so the commit can dimension it. */
  advance(): void {
    for (const f of this.fields) if (f.lock) this.held.set(f.spec.key, f.lock);
    for (const f of this.fields) f.root.remove();
    this.fields = [];
  }

  locked(key: string): HudLock | null {
    const live = this.fields.find((f) => f.spec.key === key);
    return live ? live.lock : this.held.get(key) ?? null;
  }

  hasLocks(): boolean {
    return this.fields.some((f) => f.lock);
  }

  valid(): boolean {
    return !this.fields.some((f) => f.invalid);
  }

  apply(p: Vec2): Vec2 {
    let out = p;
    for (const f of this.fields) if (f.lock && f.spec.lock) out = f.spec.lock(out, f.lock.value);
    return out;
  }

  check(at: Vec2 | null, onClick?: () => void): void {
    this.checkAt = at;
    if (!at) {
      this.checkEl?.remove();
      this.checkEl = null;
      return;
    }
    if (!this.checkEl) {
      const b = document.createElement('button');
      b.className = 'hud-check';
      b.title = 'Finish';
      b.setAttribute('aria-label', 'Finish chain');
      b.innerHTML = icon('check');
      this.layer.append(b);
      this.checkEl = b;
    }
    if (onClick) this.checkEl.onclick = onClick;
    this.position();
  }

  edit(spec: ValueEditor): void {
    this.closeEditor();
    const root = document.createElement('div');
    root.className = 'hud-field editor';
    const input = document.createElement('input');
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.value = spec.initial;
    root.append(input);
    const pill = document.createElement('div');
    pill.className = 'hud-pill';
    root.append(pill);
    this.layer.append(root);
    this.editor = { spec, root, input };
    // Red as soon as the text stops evaluating [ref GUID-715E7B9F].
    const review = (): void => {
      const expression = expressionFor(input.value.trim(), spec.kind, this.host.design);
      const r = evaluateInDesign(this.host.design, expression, spec.kind);
      root.classList.toggle('invalid', !r.ok);
      if (r.ok) pill.textContent = `${spec.name ? `${spec.name} : ` : ''}${formatValue(r.value, spec.kind, this.host.design.units)}`;
    };
    input.addEventListener('input', review);
    review();
    this.position();
    input.focus();
    input.select();
  }

  /** Accept the open editor. False when the text is rejected and the editor stays. */
  acceptEditor(): boolean {
    const ed = this.editor;
    if (!ed) return true;
    const text = ed.input.value.trim();
    const expression = expressionFor(text, ed.spec.kind, this.host.design);
    const r = evaluateInDesign(this.host.design, expression, ed.spec.kind);
    ed.root.classList.toggle('invalid', !r.ok);
    if (!r.ok) {
      this.host.message(r.error.message, 'warn');
      return false;
    }
    if (ed.spec.accept(expression, r.value) === false) {
      ed.root.classList.add('invalid');
      return false;
    }
    this.closeEditor();
    return true;
  }

  cancelEditor(): void {
    const ed = this.editor;
    this.closeEditor();
    ed?.spec.cancel();
  }

  closeEditor(): void {
    this.editor?.root.remove();
    this.editor = null;
  }

  /** Tab order [ref]. Returns false when there is nothing to tab through. */
  tab(backwards: boolean): boolean {
    if (this.fields.length === 0) return false;
    const i = this.fields.findIndex((f) => f.input === document.activeElement);
    const n = this.fields.length;
    // With nothing focused the first field is the implied one, as typing goes there: Tab moves on from it.
    const from = i < 0 ? 0 : i;
    const next = (from + (backwards ? n - 1 : 1)) % n;
    this.fields[next].input.focus();
    return true;
  }

  /** Move the keyboard into the first field; the pending keystroke lands in it. */
  focusFirst(): boolean {
    const f = this.fields[0];
    if (!f) return false;
    f.input.focus();
    return true;
  }

  /** Esc inside a field: drop what was typed. True when there was something to drop. */
  dropFocused(): boolean {
    const f = this.fields.find((l) => l.input === document.activeElement);
    if (!f) return false;
    f.input.blur();
    if (!f.text) return false;
    f.text = '';
    this.evaluate(f);
    f.input.value = formatValue(f.spec.value, f.spec.kind, this.host.design.units);
    this.host.hudChanged();
    return true;
  }

  /** Insert a dimension name into the focused field [ref]. */
  insertName(name: string): boolean {
    const input = this.focused();
    if (!input) return false;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(name, start, end, 'end');
    input.dispatchEvent(new Event('input'));
    input.focus();
    return true;
  }

  /** True when the pointer moved since the last look. */
  private watchPointer(pointer: Vec2 | null): boolean {
    const last = this.lastPointer;
    if (pointer?.x === last?.x && pointer?.y === last?.y) return false;
    this.lastPointer = pointer;
    return true;
  }

  /** Re-anchor everything after a pan, zoom or move. */
  position(): void {
    const { view } = this.host;
    const place = (el: HTMLElement, at: Vec2): void => {
      const s = view.toScreen(at);
      el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -50%)`;
    };
    const pointer = this.host.pointerScreen();
    const pointerMoved = this.watchPointer(pointer);
    if (view.version !== this.viewVersion) {
      this.viewVersion = view.version;
      this.viewShifted = true;
    }
    const origin = this.layer.getBoundingClientRect();
    for (const f of this.fields) {
      place(f.root, f.spec.at);
      // A box that stays put takes a click as soon as the pointer gets to it. One that travels with
      // the cursor never gets the pointer: it sits where the shape is being placed, so a press there
      // is the tool's, however long the pointer waited first. A box the tool keeps setting counts as
      // travelling until the pointer has left it behind, and one that appeared under the pointer
      // leaves that press to the tool as well. How long the pointer has waited never matters.
      const s = view.toScreen(f.spec.at);
      const shifted = !!f.last && Math.hypot(f.last.x - s.x, f.last.y - s.y) > BOX_SHIFT_PX;
      if (shifted && !this.viewShifted && !this.host.pointerHeld()) f.moving = true;
      // Held until it shifts, so a box creeping behind a slow hand adds up.
      if (shifted || !f.last) {
        f.last = s;
        f.pointerFrom = pointer;
      } else if (pointer && f.pointerFrom) {
        f.stayed ||= Math.hypot(pointer.x - f.pointerFrom.x, pointer.y - f.pointerFrom.y) > STAYED_PX;
      } else f.pointerFrom = pointer;
      const box = f.input.getBoundingClientRect();
      const under = !!pointer
        && pointer.x >= box.left - origin.left && pointer.x < box.right - origin.left
        && pointer.y >= box.top - origin.top && pointer.y < box.bottom - origin.top;
      f.cleared ||= !under;
      const stays = !f.moving && f.cleared && (f.stayed || !f.refreshed);
      f.root.classList.toggle('riding', document.activeElement !== f.input && !stays);
    }
    if (pointerMoved) this.viewShifted = false;
    if (this.editor) place(this.editor.root, this.editor.spec.at);
    if (this.checkEl && this.checkAt) place(this.checkEl, this.checkAt);
  }
}
