// Title bar, tabs and the ribbon. Built from src/tools/menu.ts and the registry; nothing tool
// specific lives here.
import type { App } from '../app/app';
import { FINISH_ENTRIES, MENU, type MenuEntry, type MenuPanel } from '../tools/menu';
import { THEME_LABEL, THEME_SETTINGS } from '../app/theme';
import { icon } from './icons';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const out = document.createElement(tag);
  if (cls) out.className = cls;
  if (text !== undefined) out.textContent = text;
  return out;
};

interface MenuAction { label: string; hint?: string; icon?: string; disabled?: string | null; run(): void }

export class Toolbar {
  readonly root = el('header', 'topbar');
  private readonly ribbon = el('div', 'ribbon');
  private readonly tabs = el('div', 'tabs');
  private readonly title = el('span', 'doc-title');
  private readonly undo = el('button', 'icon-btn');
  private readonly redo = el('button', 'icon-btn');
  private popup: HTMLElement | null = null;
  /** SOLID stays reachable while sketching [ref SKT-3D-SKETCH]. */
  private onSolid = false;

  constructor(private readonly app: App) {
    const title = el('div', 'titlebar');
    const file = el('button', 'menu-btn', 'File');
    file.dataset.menu = 'file';
    file.onclick = () => this.fileMenu(file);
    this.undo.innerHTML = icon('undo');
    this.undo.title = 'Undo';
    this.undo.setAttribute('aria-label', 'Undo');
    this.undo.onclick = () => app.run('undo');
    this.redo.innerHTML = icon('redo');
    this.redo.title = 'Redo';
    this.redo.setAttribute('aria-label', 'Redo');
    this.redo.onclick = () => app.run('redo');
    const plus = el('button', 'icon-btn new-tab', '+');
    plus.title = 'New Design';
    plus.setAttribute('aria-label', 'New Design');
    plus.onclick = () => this.app.run('new');
    title.append(file, this.undo, this.redo, this.title, plus);

    const row = el('div', 'ribbon-row');
    const workspace = el('button', 'workspace');
    workspace.innerHTML = `DESIGN ${icon('caret')}`;
    workspace.disabled = true;
    const right = el('div', 'ribbon-right');
    right.append(this.tabs, this.ribbon);
    row.append(workspace, right);
    this.root.append(title, row);

    app.on('mode', () => {
      this.onSolid = false;
      this.build();
    });
    app.on('tool', () => this.markActive());
    app.on('doc', () => this.refresh());
    this.build();
    document.addEventListener('pointerdown', (e) => {
      if (this.popup && !(e.target as HTMLElement).closest('.popup-menu')) this.closePopup();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (this.popup && e.key === 'Escape') {
        this.closePopup();
        e.stopPropagation();
      }
    }, true);
  }

  private refresh(): void {
    this.title.textContent = this.app.design.name;
    this.undo.disabled = !this.app.history.canUndo;
    this.redo.disabled = !this.app.history.canRedo;
    const label = this.app.history.undoLabel;
    this.undo.title = label ? `Undo ${label}` : 'Undo';
    // Availability can depend on the sketch: AutoConstrain needs something to work on.
    for (const b of this.ribbon.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]')) {
      const label = b.getAttribute('aria-label') ?? '';
      const reason = this.app.disabledReason(b.dataset.tool as string);
      b.disabled = !!reason;
      b.title = reason ? `${label}: ${reason}` : label;
    }
  }

  private build(): void {
    const { app } = this;
    this.refresh();
    this.tabs.replaceChildren();
    const inSketch = app.mode === 'sketch';
    const solid = el('button', `tab${inSketch && !this.onSolid ? '' : ' active'}`, 'SOLID');
    solid.onclick = () => {
      this.onSolid = inSketch;
      this.build();
    };
    this.tabs.append(solid);
    if (inSketch) {
      const sketch = el('button', `tab${this.onSolid ? '' : ' active'}`, 'SKETCH');
      sketch.onclick = () => {
        this.onSolid = false;
        this.build();
      };
      this.tabs.append(sketch);
    }
    this.ribbon.replaceChildren();
    if (this.onSolid) {
      // The tutorials reach the sketch tools through Solid > Create [ref GUID-E8BB984B]; Create Sketch picks a plane for the next.
      this.ribbon.append(this.designPanel('SKETCH'), this.panel(MENU[0]));
    } else if (inSketch) {
      MENU.forEach((p) => this.ribbon.append(this.panel(p)));
      this.ribbon.append(this.finishPanel());
    } else {
      this.ribbon.append(this.designPanel());
    }
    this.markActive();
  }

  /** `name` tells it from the Create panel beside it, which is the one that holds the sketch tools. */
  private designPanel(name = 'CREATE'): HTMLElement {
    const panel = el('div', 'panel');
    const icons = el('div', 'panel-icons');
    const b = el('button', 'tool-btn');
    b.dataset.tool = 'create-sketch';
    b.title = 'Create Sketch';
    b.setAttribute('aria-label', 'Create Sketch');
    b.innerHTML = icon('create-sketch');
    b.onclick = () => this.app.run('create-sketch');
    icons.append(b);
    panel.append(icons);
    const title = el('button', 'panel-name');
    title.innerHTML = `${name} ${icon('caret')}`;
    title.onclick = () => this.showMenu(title, [
      { label: 'Create Sketch', icon: 'create-sketch', run: () => this.app.run('create-sketch') },
    ]);
    panel.append(title);
    return panel;
  }

  private toolButton(id: string): HTMLElement {
    const { app } = this;
    const label = this.labelOf(id);
    const reason = app.disabledReason(id);
    const b = el('button', 'tool-btn');
    b.dataset.tool = id;
    b.innerHTML = icon(app.tools.get(id)?.meta.icon ?? id);
    b.title = reason ? `${label}: ${reason}` : label;
    b.setAttribute('aria-label', label);
    b.disabled = !!reason;
    b.onclick = () => app.activate(id);
    return b;
  }

  private labelOf(id: string): string {
    const found = (entries: MenuEntry[]): string | null => {
      for (const e of entries) {
        if ('flyout' in e) {
          const inner = found(e.items);
          if (inner) return inner;
        } else if (e.id === id) return e.label;
      }
      return null;
    };
    return this.app.tools.get(id)?.meta.label ?? MENU.map((p) => found(p.entries)).find((x) => x) ?? id;
  }

  private panel(p: MenuPanel): HTMLElement {
    const panel = el('div', 'panel');
    panel.dataset.panel = p.panel;
    const icons = el('div', 'panel-icons');
    for (const id of p.pinned) icons.append(this.toolButton(id));
    const name = el('button', 'panel-name');
    name.innerHTML = `${p.label.toUpperCase()} ${icon('caret')}`;
    name.onclick = () => this.showMenu(name, p.entries.map((e) => this.toAction(e)).flat(), p.entries);
    panel.append(icons, name);
    return panel;
  }

  private toAction(e: MenuEntry): MenuAction[] {
    if ('flyout' in e) return [];
    return [{
      label: e.label, hint: e.shortcut, icon: this.app.tools.get(e.id)?.meta.icon ?? e.id,
      disabled: this.app.disabledReason(e.id), run: () => this.app.activate(e.id),
    }];
  }

  private finishPanel(): HTMLElement {
    const panel = el('div', 'panel finish');
    const b = el('button', 'finish-btn');
    b.dataset.tool = 'finish-sketch';
    b.title = 'Finish Sketch';
    b.setAttribute('aria-label', 'Finish Sketch');
    b.innerHTML = icon('finish-sketch');
    b.onclick = () => this.app.run('finish-sketch');
    const name = el('button', 'panel-name');
    name.innerHTML = `FINISH SKETCH ${icon('caret')}`;
    name.onclick = () => this.showMenu(name, [
      { label: 'Finish Sketch', icon: 'finish-sketch', run: () => this.app.run('finish-sketch') },
      ...FINISH_ENTRIES.flatMap((e) => this.toAction(e)),
    ]);
    panel.append(b, name);
    return panel;
  }

  private markActive(): void {
    const id = this.app.activeToolId;
    for (const b of this.ribbon.querySelectorAll<HTMLElement>('.tool-btn')) {
      b.classList.toggle('active', b.dataset.tool === id);
    }
  }

  private closePopup(): void {
    this.popup?.remove();
    this.popup = null;
  }

  private place(menu: HTMLElement, anchor: HTMLElement): void {
    const box = anchor.getBoundingClientRect();
    document.body.append(menu);
    const w = menu.getBoundingClientRect().width;
    menu.style.left = `${Math.min(box.left, innerWidth - w - 8)}px`;
    menu.style.top = `${box.bottom + 2}px`;
  }

  private row(a: MenuAction): HTMLElement {
    const b = el('button', 'menu-item');
    b.innerHTML = `<span class="menu-icon">${a.icon ? icon(a.icon) : ''}</span><span class="menu-label">${a.label}</span><span class="menu-hint">${a.hint ?? ''}</span>`;
    b.dataset.item = a.label;
    if (a.disabled) {
      b.classList.add('disabled');
      b.title = a.disabled;
      b.setAttribute('aria-disabled', 'true');
    }
    b.onclick = () => {
      if (a.disabled) return;
      this.closePopup();
      a.run();
    };
    return b;
  }

  /** `entries` gives flyouts; without it the plain actions list. */
  private showMenu(anchor: HTMLElement, actions: MenuAction[], entries?: MenuEntry[], extra?: (menu: HTMLElement) => void): void {
    this.closePopup();
    const menu = el('div', 'popup-menu');
    const add = (list: MenuEntry[], into: HTMLElement): void => {
      for (const e of list) {
        if ('flyout' in e) {
          const row = el('div', 'menu-item flyout');
          row.dataset.item = e.flyout;
          row.innerHTML = `<span class="menu-icon">${icon(e.icon)}</span><span class="menu-label">${e.flyout}</span><span class="menu-hint">${icon('chevron')}</span>`;
          const sub = el('div', 'popup-menu sub');
          add(e.items, sub);
          row.append(sub);
          into.append(row);
        } else this.toAction(e).forEach((a) => into.append(this.row(a)));
      }
    };
    if (entries) add(entries, menu);
    else actions.forEach((a) => menu.append(this.row(a)));
    extra?.(menu);
    this.place(menu, anchor);
    this.popup = menu;
  }

  private fileMenu(anchor: HTMLElement): void {
    this.showMenu(anchor, [
      { label: 'New', run: () => this.app.run('new') },
      { label: 'Open...', run: () => this.app.run('open') },
      { label: 'Save', run: () => this.app.run('save') },
      { label: 'Save as SVG...', run: () => this.app.run('save-svg') },
      { label: 'Recover Designs...', run: () => this.app.run('recover') },
      { label: 'Print...', run: () => this.app.run('print') },
    ], undefined, (menu) => menu.append(this.themeRow()));
  }

  /** Theme, with System, Light and Dark beside it and the current one ticked. It is a preference of this browser, not an edit. */
  private themeRow(): HTMLElement {
    const { theme } = this.app;
    const row = el('div', 'menu-item flyout');
    row.dataset.item = 'Theme';
    row.innerHTML = `<span class="menu-icon"></span><span class="menu-label">Theme</span><span class="menu-hint with-text">${THEME_LABEL[theme.setting]}${icon('chevron')}</span>`;
    const sub = el('div', 'popup-menu sub');
    sub.setAttribute('role', 'menu');
    for (const setting of THEME_SETTINGS) {
      const b = el('button', 'menu-item');
      const on = setting === theme.setting;
      b.dataset.item = `Theme ${THEME_LABEL[setting]}`;
      b.dataset.choice = setting;
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(on));
      b.innerHTML = `<span class="menu-icon">${on ? icon('tick') : ''}</span><span class="menu-label">${THEME_LABEL[setting]}</span><span class="menu-hint"></span>`;
      b.onclick = () => {
        this.closePopup();
        theme.set(setting);
      };
      sub.append(b);
    }
    row.append(sub);
    return row;
  }
}
