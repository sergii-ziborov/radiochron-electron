import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * How long collected history is kept before it is deleted.
 *
 * The application observes its surroundings: every access point and Bluetooth
 * device within range, with timestamps and signal strength. Keeping that
 * indefinitely is both a disk problem and a privacy one, so retention is a
 * setting the operator controls rather than a constant somebody has to find in
 * the source.
 */
export interface RetentionSettings {
  /**
   * Days to keep per-sighting detail: observations, collector events,
   * identity alerts and vulnerability scans. This is the bulk of the database.
   */
  detailDays: number;
  /**
   * Days to keep a device in the inventory after it was last seen. Longer than
   * `detailDays` is normal and useful — "this access point has been here since
   * March" survives without keeping every sighting that proved it.
   */
  inventoryDays: number;
  /** Purge when the application starts, and once a day while it runs. */
  purgeOnStartup: boolean;
}

/**
 * Theme identifiers, mirroring the registry shared with BranchPilot and
 * repo-lens. Kept as a plain list here so the main process can validate a
 * stored value without importing renderer code.
 */
export const THEME_IDS = [
  'radiochron',
  'light',
  'dark',
  'night-city',
  'cyberpunk',
  'deus-ex'
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface AppSettings {
  retention: RetentionSettings;
  theme: ThemeId;
}

/**
 * A partial update. Each field is optional at every level, so a caller can
 * change one number without restating the rest and without a stale copy of the
 * others overwriting a concurrent change.
 */
export interface SettingsPatch {
  retention?: Partial<RetentionSettings>;
  theme?: string;
}

/**
 * Ninety days of inventory and thirty of detail: long enough to recognise a
 * device that visits monthly, short enough that a machine left running does not
 * quietly build a year-long record of everyone who walked past it.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  retention: {
    detailDays: 30,
    inventoryDays: 90,
    purgeOnStartup: true
  },
  theme: 'radiochron'
};

/** Ten years. Anything beyond this is indistinguishable from "forever". */
const MAX_DAYS = 3650;

/**
 * Zero means keep forever, and it has to be typed deliberately rather than
 * arrived at by accident: a negative or unparsable value falls back to the
 * default instead of being clamped to zero, so a corrupted settings file can
 * never silently turn retention off.
 */
function normalizeDays(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  if (rounded < 0) return fallback;
  return Math.min(rounded, MAX_DAYS);
}

function normalizeTheme(value: unknown): ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
    ? (value as ThemeId)
    : DEFAULT_SETTINGS.theme;
}

export function normalizeSettings(raw: unknown): AppSettings {
  const source = (raw ?? {}) as Partial<AppSettings>;
  const retention = (source.retention ?? {}) as Partial<RetentionSettings>;

  return {
    theme: normalizeTheme(source.theme),
    retention: {
      detailDays: normalizeDays(retention.detailDays, DEFAULT_SETTINGS.retention.detailDays),
      inventoryDays: normalizeDays(
        retention.inventoryDays,
        DEFAULT_SETTINGS.retention.inventoryDays
      ),
      purgeOnStartup:
        typeof retention.purgeOnStartup === 'boolean'
          ? retention.purgeOnStartup
          : DEFAULT_SETTINGS.retention.purgeOnStartup
    }
  };
}

export function settingsFilePath(userDataDir: string): string {
  return join(userDataDir, 'radiochron', 'settings.json');
}

/** Read settings, falling back to defaults when the file is absent or damaged. */
export async function loadSettings(file: string): Promise<AppSettings> {
  try {
    return normalizeSettings(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    // A missing file is the first run; an unreadable one is not worth refusing
    // to start over, and normalizeSettings guarantees a safe shape either way.
    return normalizeSettings(null);
  }
}

/**
 * Merge a patch into the stored settings and write them back.
 *
 * Written to a temporary file and renamed, so an interrupted write leaves the
 * previous settings intact rather than a truncated file that reads as defaults.
 */
export async function saveSettings(file: string, patch: SettingsPatch): Promise<AppSettings> {
  const current = await loadSettings(file);
  const merged = normalizeSettings({
    ...current,
    ...patch,
    retention: { ...current.retention, ...(patch.retention ?? {}) }
  });
  // normalizeSettings runs after the merge, so an unknown theme id from a
  // tampered file or an older build falls back rather than being stored.

  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
  return merged;
}
