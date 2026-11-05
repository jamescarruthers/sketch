// S key: a search box over every tool [ref].
import type { App } from '../app/app';
import { allEntries } from '../tools/menu';
import { icon } from './icons';

interface Row { id: string; label: string; shortcut?: string; disabled: string | null }

export class Toolbox {
  private root: HTMLElement | null = null;
  private rows: Row[] = [];
  private index = 0;
  private list: HTMLElement | null = null;

  constructor(private readonly app: App) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  private search(q: string): Row[] {
    const needle = q.trim().toLowerCase();
    const entries = allEntries().map((e) => ({ id: e.id, label: e.label, shortcut: e.shortcut, disabled: this.app.disabledReason(e.id) }));
    const matched = entries.filter((e) => e.label.toLowerCase().includes(needle));
    return matched.sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled)).slice(0, 10);
  }

  open(): void {
    if (this.root || this.app.mode !== 'sketch') return;
    const root = document.createElement('div');
    root.className = 'toolbox';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Toolbox');
    const input = document.createElement('input');
    input.placeholder = 'Search tools';
    input.spellcheck = false;
    const list = document.createElement('div');
    list.className = 'toolbox-list';
    root.append(input, list);
    this.app.stage.append(root);
    this.root = root;
    this.list = list;
    const update = (): void => {
      this.rows = this.search(input.value);
      this.index = 0;
      this.renderList();
    };
    input.oninput = update;
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter') this.choose(this.rows[this.index]);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = Math.max(this.rows.length, 1);
        this.index = (this.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.renderList();
      }
    };
    input.onblur = () => setTimeout(() => this.close(), 120);
    update();
    // The S keydown itself must not land in the box.
    setTimeout(() => input.focus());
  }

  private renderList(): void {
    if (!this.list) return;
    this.list.replaceChildren();
    this.rows.forEach((r, i) => {
      const b = document.createElement('button');
      b.className = `menu-item${i === this.index ? ' active' : ''}${r.disabled ? ' disabled' : ''}`;
      b.innerHTML = `<span class="menu-icon">${icon(r.id)}</span><span class="menu-label">${r.label}</span><span class="menu-hint">${r.shortcut ?? ''}</span>`;
      if (r.disabled) b.title = r.disabled;
      b.onpointerdown = (e) => {
        e.preventDefault();
        this.choose(r);
      };
      this.list?.append(b);
    });
  }

  private choose(r: Row | undefined): void {
    if (!r || r.disabled) return;
    this.close();
    this.app.activate(r.id);
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.list = null;
  }
}
