// The Layers panel: add, rename, colour, show, lock, reorder, delete, and click to make active [user].
import type { App } from '../app/app';
import type { Id, Layer } from '../model/types';
import { icon } from './icons';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const out = document.createElement(tag);
  if (cls) out.className = cls;
  if (text !== undefined) out.textContent = text;
  return out;
};

/** How far a press travels before it is a reorder and not a click. */
const DRAG_PX = 4;

interface Press { id: Id; y: number; moved: boolean; slot: number | null }

export class LayersPanel {
  readonly root = el('aside', 'layers');
  private readonly list = el('div', 'layer-list');
  private renaming: Id | null = null;
  /** A native colour picker lives in its input, so a rebuild while it is open would close it. */
  private picking = false;
  private press: Press | null = null;
  private swallowClick = false;

  constructor(private readonly app: App) {
    this.root.setAttribute('aria-label', 'Layers');
    const head = el('div', 'layers-head');
    const add = el('button', 'icon-btn');
    add.innerHTML = icon('plus');
    add.title = 'Add Layer';
    add.setAttribute('aria-label', 'Add Layer');
    add.dataset.action = 'add-layer';
    add.onclick = () => app.addLayer();
    head.append(el('span', '', 'LAYERS'), add);
    this.root.append(head, this.list);
    app.on('doc', () => this.render());
    app.on('mode', () => this.render());
    this.list.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.layer-row');
      if (!row || (e.target as HTMLElement).closest('button, input')) return;
      this.renaming = row.dataset.layer as Id;
      this.render();
    });
    this.list.addEventListener('pointerdown', (e) => this.begin(e));
    window.addEventListener('pointermove', (e) => this.drag(e));
    window.addEventListener('pointerup', () => this.drop());
    this.render();
  }

  private button(cls: string, name: string, label: string, run: () => void): HTMLButtonElement {
    const b = el('button', `layer-btn ${cls}`);
    b.innerHTML = icon(name);
    b.title = label;
    b.setAttribute('aria-label', label);
    b.onclick = (e) => {
      e.stopPropagation();
      run();
    };
    return b;
  }

  private nameCell(l: Layer): HTMLElement {
    if (this.renaming !== l.id) return el('span', 'layer-name', l.name);
    const input = el('input', 'layer-rename');
    input.value = l.name;
    const done = (keep: boolean): void => {
      const value = input.value;
      this.renaming = null;
      if (keep) this.app.renameLayer(l.id, value);
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.onblur = () => {
      if (this.renaming === l.id) done(true);
    };
    input.onclick = (e) => e.stopPropagation();
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  private row(l: Layer): HTMLElement {
    const { app } = this;
    const active = l.id === app.design.activeLayer;
    const row = el('div', `layer-row${active ? ' active' : ''}${l.visible ? '' : ' hidden'}`);
    row.dataset.layer = l.id;
    row.onclick = () => {
      if (this.swallowClick) this.swallowClick = false;
      else app.setActiveLayer(l.id);
    };
    const eye = this.button(`layer-eye${l.visible ? '' : ' off'}`, l.visible ? 'eye' : 'eye-off', `${l.visible ? 'Hide' : 'Show'} ${l.name}`, () => app.setLayerVisible(l.id, !l.visible));
    const lock = this.button(`layer-lock${l.locked ? ' locked' : ' off'}`, l.locked ? 'lock' : 'lock-open', `${l.locked ? 'Unlock' : 'Lock'} ${l.name}`, () => app.setLayerLocked(l.id, !l.locked));
    const swatch = el('input', 'layer-swatch');
    swatch.type = 'color';
    swatch.value = l.color;
    swatch.title = `Colour of ${l.name}`;
    swatch.setAttribute('aria-label', `Colour of ${l.name}`);
    swatch.onclick = (e) => e.stopPropagation();
    swatch.oninput = () => {
      this.picking = true;
      app.setLayerColor(l.id, swatch.value);
    };
    swatch.onchange = () => {
      this.picking = false;
      app.setLayerColor(l.id, swatch.value);
      this.render();
    };
    const del = this.button('layer-delete', 'close', `Delete ${l.name}`, () => app.deleteLayer(l.id));
    del.disabled = app.design.layers.length < 2;
    if (del.disabled) del.title = 'The last layer cannot be deleted';
    row.append(eye, lock, swatch, this.nameCell(l), del);
    return row;
  }

  private render(): void {
    if (this.picking) return;
    this.list.replaceChildren(...this.app.design.layers.map((l) => this.row(l)));
  }

  private rows(): HTMLElement[] {
    return [...this.list.querySelectorAll<HTMLElement>('.layer-row')];
  }

  private begin(e: PointerEvent): void {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.layer-row');
    if (e.button !== 0 || !row || t.closest('button, input')) return;
    this.press = { id: row.dataset.layer as Id, y: e.clientY, moved: false, slot: null };
  }

  private drag(e: PointerEvent): void {
    const p = this.press;
    if (!p || (!p.moved && Math.abs(e.clientY - p.y) < DRAG_PX)) return;
    p.moved = true;
    const rows = this.rows();
    let slot = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const box = rows[i].getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) {
        slot = i;
        break;
      }
    }
    p.slot = slot;
    rows.forEach((r, i) => {
      r.classList.toggle('dragging', r.dataset.layer === p.id);
      r.classList.toggle('drop-above', i === slot);
      r.classList.toggle('drop-below', slot === rows.length && i === rows.length - 1);
    });
  }

  private drop(): void {
    const p = this.press;
    this.press = null;
    if (!p?.moved || p.slot === null) return;
    this.swallowClick = true;
    // The click that ends a press lands after this; one that never comes must not eat the next.
    setTimeout(() => { this.swallowClick = false; }, 0);
    const from = this.app.design.layers.findIndex((l) => l.id === p.id);
    const to = p.slot > from ? p.slot - 1 : p.slot;
    this.render();
    this.app.reorderLayer(p.id, to);
  }
}
