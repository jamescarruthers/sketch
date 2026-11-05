// The theme setting: System, Light or Dark. It is a preference of this browser, not of the design: it is
// kept in localStorage alone, so it is not in a saved file, not an undo step and not a history entry.
import '../render/palette';
import type { Theme } from '../render/tokens';
import { setTheme } from '../render/style';

export type ThemeSetting = 'system' | 'light' | 'dark';

export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'light', 'dark'];
export const THEME_LABEL: Record<ThemeSetting, string> = { system: 'System', light: 'Light', dark: 'Dark' };
/** index.html reads the same key before first paint. */
export const THEME_KEY = 'sketch.theme';

export const parseSetting = (raw: string | null | undefined): ThemeSetting => (raw === 'light' || raw === 'dark' ? raw : 'system');

export const resolveTheme = (setting: ThemeSetting, osDark: boolean): Theme => (setting === 'system' ? (osDark ? 'dark' : 'light') : setting);

/** Storage can throw, on a read or a write, when it is blocked or full: the setting is then for this session only. */
function remembered(): ThemeSetting {
  try {
    return parseSetting(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

function remember(setting: ThemeSetting): void {
  try {
    localStorage.setItem(THEME_KEY, setting);
  } catch {
    // Nothing to do: it applies now and is forgotten on reload.
  }
}

export class ThemeController {
  setting: ThemeSetting = remembered();
  theme: Theme = 'light';
  private readonly media = matchMedia('(prefers-color-scheme: dark)');

  /** `changed` runs after every change to the setting or to the theme it resolves to. */
  constructor(private readonly changed: () => void) {
    // Live: with System, the OS switching between light and dark switches the app.
    this.media.addEventListener('change', () => {
      if (this.setting === 'system') this.apply();
    });
    this.apply(false);
  }

  set(setting: ThemeSetting): void {
    this.setting = setting;
    remember(setting);
    this.apply();
  }

  private apply(notify = true): void {
    this.theme = resolveTheme(this.setting, this.media.matches);
    document.documentElement.dataset.theme = this.theme;
    setTheme(this.theme);
    if (notify) this.changed();
  }
}
