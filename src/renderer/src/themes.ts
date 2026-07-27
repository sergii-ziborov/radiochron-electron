/**
 * The theme registry.
 *
 * Identifiers mirror the family registry used by BranchPilot and repo-lens, so
 * "night-city" means the same palette wherever it appears. The default is
 * RadioChron's own olive-and-yellow rather than one of the borrowed ones.
 */

export interface AppTheme {
  id: string;
  label: string;
  /** Swatch colour for the picker: each theme's accent. */
  dot: string;
  description: string;
}

export const DEFAULT_THEME = 'radiochron';

export const APP_THEMES: readonly AppTheme[] = [
  { id: 'radiochron', label: 'RadioChron', dot: '#fcee0a', description: 'Olive terminal' },
  { id: 'light', label: 'Light', dot: '#2563eb', description: 'Clean light' },
  { id: 'dark', label: 'Dark', dot: '#2f81f7', description: 'Clean dark' },
  { id: 'night-city', label: 'Night City', dot: '#ff2eea', description: 'Neon city nights' },
  { id: 'cyberpunk', label: 'Cyberpunk', dot: '#fcee0a', description: 'Chrome neon' },
  { id: 'deus-ex', label: 'Deus Ex', dot: '#f2c94c', description: 'Amber interface' }
];

export function isThemeId(id: string): boolean {
  return APP_THEMES.some((theme) => theme.id === id);
}

/** Storage key. Versioned so a future palette change can migrate rather than reset. */
export const THEME_STORAGE_KEY = 'radiochron.theme.v1';

/**
 * Apply a theme to the document.
 *
 * Also mirrored into localStorage so the pre-paint script in index.html can set
 * the attribute before the first frame; settings on disk remain the durable
 * source of truth and win once they load.
 */
export function applyTheme(id: string): string {
  const resolved = isThemeId(id) ? id : DEFAULT_THEME;
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, resolved);
  } catch {
    // Private mode or a locked profile: the theme still applies for this run.
  }
  return resolved;
}
