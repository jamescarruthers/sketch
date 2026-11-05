// The browser tree: Origin and Sketches, with visibility and the sketch context menu [ref].
import type { App } from '../app/app';
import type { Id } from '../model/types';
import { icon } from './icons';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const out = document.createElement(tag);
  if (cls) out.className = cls;
  if (text !== undefined) out.textContent = text;
  return out;
};

export class Browser {
  readonly root = el('aside', 'browser');
  private readonly tree = el('div', 'tree');
  private menu: HTMLElement | null = null;
  private renaming: Id | null = null;

  constructor(private readonly app: App) {
    this.root.setAttribute('aria-label', 'Browser');
    this.root.append(el('div', 'browser-head', 'BROWSER'), this.tree);
    app.on('doc', () => this.render());
    app.on('mode', () => this.render());
    app.on('status', () => this.refreshLocks());
    document.addEventListener('pointerdown', (e) => {
      if (this.menu && !(e.target as HTMLElement).closest('.popup-menu')) this.closeMenu();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (this.menu && e.key === 'Escape') {
        this.closeMenu();
        e.stopPropagation();
      }
    }, true);
    this.render();
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }

  private node(label: string, name: string, depth: number): HTMLElement {
    const row = el('div', 'tree-row');
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.innerHTML = `<span class="tree-icon">${icon(name)}</span>`;
    row.append(el('span', 'tree-label', label));
    return row;
  }

  private render(): void {
    const { app } = this;
    this.tree.replaceChildren();
    this.tree.append(this.node(app.design.name, 'document', 0));
    this.tree.append(this.node('Origin', 'origin', 1));
    const group = this.node('Sketches', 'folder', 1);
    this.tree.append(group);
    for (const id of app.design.order) {
      const s = app.design.sketches[id];
      if (s) this.tree.append(this.sketchRow(id));
    }
    this.refreshLocks();
  }

  private sketchRow(id: Id): HTMLElement {
    const { app } = this;
    const s = app.design.sketches[id];
    const row = el('div', `tree-row sketch-row${app.activeId === id ? ' active' : ''}`);
    row.dataset.sketch = id;
    row.style.paddingLeft = '36px';
    const eye = el('button', `eye${s.visible ? '' : ' off'}`);
    eye.innerHTML = icon(s.visible ? 'eye' : 'eye-off');
    eye.title = s.visible ? 'Hide' : 'Show';
    eye.setAttribute('aria-label', `${s.visible ? 'Hide' : 'Show'} ${s.name}`);
    eye.onclick = (e) => {
      e.stopPropagation();
      app.setSketchVisible(id, !s.visible);
    };
    const glyph = el('span', 'tree-icon');
    glyph.dataset.lock = id;
    if (this.renaming === id) {
      const input = el('input', 'rename');
      input.value = s.name;
      const done = (keep: boolean): void => {
        const value = input.value;
        this.renaming = null;
        if (keep) app.renameSketch(id, value);
        this.render();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.onblur = () => {
        // A redraw of the tree takes the box away and puts a new one in its place: that is not the end of the rename.
        if (this.renaming === id && input.isConnected) done(true);
      };
      row.append(eye, glyph, input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
    } else {
      row.append(eye, glyph, el('span', 'tree-label', s.name));
    }
    row.onclick = () => {
      if (this.renaming === id) return;
      // In the Orbit view, design mode's included, a click edits the sketch, and the camera swings round to face it.
      // While a plane is picked it does so too, and the pick ends [ref GUID-0EEF7073].
      if (app.orbiting) app.enterSketch(id);
    };
    row.ondblclick = () => app.enterSketch(id);
    row.oncontextmenu = (e) => {
      e.preventDefault();
      this.sketchMenu(id, e.clientX, e.clientY);
    };
    return row;
  }

  /** Flash a sketch's row [ref Find in Browser]. */
  find(id: Id): void {
    const row = this.tree.querySelector<HTMLElement>(`[data-sketch="${id}"]`);
    row?.classList.add('found');
    setTimeout(() => row?.classList.remove('found'), 1200);
  }

  /** A sketch shows a red lock once fully constrained [ref]. */
  private refreshLocks(): void {
    const { app } = this;
    for (const slot of this.tree.querySelectorAll<HTMLElement>('[data-lock]')) {
      const id = slot.dataset.lock as Id;
      const s = app.design.sketches[id];
      if (!s) continue;
      const a = app.analysisOf(id);
      const filled = Object.keys(s.curves).length > 0;
      const locked = filled && a.dof === 0 && a.unsatisfied.size === 0;
      slot.innerHTML = icon(locked ? 'sketch-locked' : 'sketch-node');
      slot.title = locked ? 'Fully constrained' : '';
    }
  }

  private sketchMenu(id: Id, x: number, y: number): void {
    const { app } = this;
    this.closeMenu();
    const menu = el('div', 'popup-menu');
    const item = (label: string, run: () => void): void => {
      const b = el('button', 'menu-item');
      b.dataset.item = label;
      b.innerHTML = `<span class="menu-label">${label}</span>`;
      b.onclick = () => {
        this.closeMenu();
        run();
      };
      menu.append(b);
    };
    item('Edit Sketch', () => app.enterSketch(id));
    item('Export DXF', () => app.runSketchAction('export-dxf', id));
    item('Save as SVG', () => app.runSketchAction('export-svg', id));
    item(app.dimensionsInDesign.has(id) ? 'Hide Dimensions' : 'Show Dimensions', () => {
      if (app.dimensionsInDesign.has(id)) app.dimensionsInDesign.delete(id);
      else app.dimensionsInDesign.add(id);
      app.invalidate();
    });
    item('Redefine Sketch Plane', () => app.redefineSketchPlane(id));
    item('Rename', () => {
      this.renaming = id;
      this.render();
    });
    item('Delete', () => app.deleteSketch(id));
    document.body.append(menu);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    this.menu = menu;
  }
}
