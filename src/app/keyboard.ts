// The one key table (docs/SPEC.md section 5). Shortcuts are ignored inside inputs, except the
// bindings marked `always`.
import { allEntries } from '../tools/menu';
import { TOOLS } from '../tools/registry';

export interface KeyBinding { key: string; command: string; always?: boolean }

const FIXED: KeyBinding[] = [
  { key: 'mod+z', command: 'undo' },
  { key: 'mod+shift+z', command: 'redo' },
  { key: 'ctrl+y', command: 'redo' },
  { key: 'mod+a', command: 'select-all' },
  { key: 'mod+c', command: 'copy' },
  { key: 'mod+v', command: 'paste' },
  { key: 'mod+x', command: 'cut' },
  { key: 'delete', command: 'delete' },
  { key: 'backspace', command: 'delete' },
  { key: 'mod+p', command: 'print', always: true },
  { key: 'f6', command: 'fit' },
  { key: 's', command: 'toolbox' },
  { key: 'x', command: 'toggle-construction' },
  { key: 'enter', command: 'enter', always: true },
  { key: 'mod+enter', command: 'enter', always: true },
  { key: 'escape', command: 'escape', always: true },
  { key: 'tab', command: 'hud-next', always: true },
  { key: 'shift+tab', command: 'hud-prev', always: true },
  // 3D mode: fold the sketch plane about the selected line, the way the camera moves; and the Orbit view.
  { key: 'arrowup', command: 'fold-up' },
  { key: 'arrowdown', command: 'fold-down' },
  { key: 'arrowleft', command: 'fold-left' },
  { key: 'arrowright', command: 'fold-right' },
  { key: 'v', command: 'orbit' },
];

/** The whole table: fixed keys plus every tool shortcut, planned tools included. */
export function keyTable(): KeyBinding[] {
  const table = [...FIXED];
  const add = (shortcut: string | undefined, id: string): void => {
    const key = shortcut?.toLowerCase();
    if (key && !table.some((b) => b.key === key)) table.push({ key, command: `tool:${id}` });
  };
  for (const t of TOOLS) add(t.meta.shortcut, t.meta.id);
  for (const e of allEntries()) add(e.shortcut, e.id);
  return table;
}

/** Canonical name of a key event, e.g. "mod+shift+z". Ctrl stays distinct on the Mac for ctrl+y. */
export function keyName(e: KeyboardEvent): string {
  const parts: string[] = [];
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
  if (key === 'y' && e.ctrlKey) return 'ctrl+y';
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(key);
  return parts.join('+');
}

export function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}
