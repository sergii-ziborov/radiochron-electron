import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { historyFootprint, purgeExpiredHistory } from '../src/collector/retention';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
  settingsFilePath
} from '../src/collector/settings';

const NOW = new Date('2026-07-27T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** A database shaped like the real one, seeded across a spread of ages. */
function seed(databaseFile: string): void {
  const db = new DatabaseSync(databaseFile);
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE baseline_runs (
      run_id TEXT PRIMARY KEY,
      started_at_utc TEXT NOT NULL
    );
    CREATE TABLE collector_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES baseline_runs(run_id) ON DELETE CASCADE,
      ts_utc TEXT
    );
    CREATE TABLE device_observations (id INTEGER PRIMARY KEY AUTOINCREMENT, ts_utc TEXT NOT NULL);
    CREATE TABLE device_identity_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at_utc TEXT NOT NULL);
    CREATE TABLE vulnerability_scans (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at_utc TEXT NOT NULL);
    CREATE TABLE device_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, last_seen_utc TEXT NOT NULL);
    CREATE TABLE device_inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, last_seen_utc TEXT NOT NULL);
    CREATE TABLE scan_locations (id INTEGER PRIMARY KEY AUTOINCREMENT, last_seen_utc TEXT NOT NULL);
  `);

  const ages = [1, 10, 45, 200];
  for (const age of ages) {
    const runId = `run-${age}`;
    db.prepare('INSERT INTO baseline_runs (run_id, started_at_utc) VALUES (?, ?)').run(
      runId,
      daysAgo(age)
    );
    // One event carries no timestamp of its own: it may only be removed by the
    // cascade from its run, never by a sweep over its own column.
    db.prepare('INSERT INTO collector_events (run_id, ts_utc) VALUES (?, ?)').run(
      runId,
      daysAgo(age)
    );
    db.prepare('INSERT INTO collector_events (run_id, ts_utc) VALUES (?, NULL)').run(runId);

    for (const table of ['device_observations']) {
      db.prepare(`INSERT INTO ${table} (ts_utc) VALUES (?)`).run(daysAgo(age));
    }
    for (const table of ['device_identity_alerts', 'vulnerability_scans']) {
      db.prepare(`INSERT INTO ${table} (created_at_utc) VALUES (?)`).run(daysAgo(age));
    }
    for (const table of ['device_metrics', 'device_inventory', 'scan_locations']) {
      db.prepare(`INSERT INTO ${table} (last_seen_utc) VALUES (?)`).run(daysAgo(age));
    }
  }
  db.close();
}

function count(databaseFile: string, table: string): number {
  const db = new DatabaseSync(databaseFile);
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return Number(row.count);
  } finally {
    db.close();
  }
}

async function withDatabase(run: (databaseFile: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'radiochron-retention-'));
  const databaseFile = join(dir, 'monitor.sqlite');
  try {
    seed(databaseFile);
    await run(databaseFile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('history retention', () => {
  it('removes detail past its window and keeps everything inside it', async () => {
    await withDatabase((databaseFile) => {
      const report = purgeExpiredHistory(
        { detailDays: 30, inventoryDays: 90, purgeOnStartup: true },
        databaseFile,
        NOW
      );

      // Seeded at 1, 10, 45 and 200 days: the first two survive 30 days.
      expect(count(databaseFile, 'device_observations')).toBe(2);
      expect(count(databaseFile, 'device_identity_alerts')).toBe(2);
      expect(count(databaseFile, 'baseline_runs')).toBe(2);
      // 90 days keeps three of the four inventory rows.
      expect(count(databaseFile, 'device_inventory')).toBe(3);
      expect(count(databaseFile, 'scan_locations')).toBe(3);

      expect(report.total_deleted).toBeGreaterThan(0);
      expect(report.detail_cutoff_utc).toBe(daysAgo(30));
      expect(report.inventory_cutoff_utc).toBe(daysAgo(90));
    });
  });

  it('takes undated events with their run rather than stranding them', async () => {
    await withDatabase((databaseFile) => {
      expect(count(databaseFile, 'collector_events')).toBe(8);

      purgeExpiredHistory(
        { detailDays: 30, inventoryDays: 90, purgeOnStartup: true },
        databaseFile,
        NOW
      );

      // Two runs survive, each with a dated and an undated event. Sweeping the
      // events table alone would have left the undated ones behind forever.
      expect(count(databaseFile, 'collector_events')).toBe(4);
    });
  });

  it('treats zero as keep forever and deletes nothing at all', async () => {
    await withDatabase((databaseFile) => {
      const report = purgeExpiredHistory(
        { detailDays: 0, inventoryDays: 0, purgeOnStartup: false },
        databaseFile,
        NOW
      );

      expect(report.total_deleted).toBe(0);
      expect(report.detail_cutoff_utc).toBeNull();
      expect(count(databaseFile, 'device_observations')).toBe(4);
      expect(count(databaseFile, 'device_inventory')).toBe(4);
    });
  });

  it('keeps the inventory longer than the detail that established it', async () => {
    await withDatabase((databaseFile) => {
      purgeExpiredHistory(
        { detailDays: 5, inventoryDays: 365, purgeOnStartup: true },
        databaseFile,
        NOW
      );

      expect(count(databaseFile, 'device_observations')).toBe(1);
      expect(count(databaseFile, 'device_inventory')).toBe(4);
    });
  });

  it('reports what is stored without changing it', async () => {
    await withDatabase((databaseFile) => {
      const footprint = historyFootprint(databaseFile);

      expect(footprint.rows.device_observations).toBe(4);
      expect(footprint.rows.collector_events).toBe(8);
      expect(footprint.size_bytes).toBeGreaterThan(0);
      expect(count(databaseFile, 'device_observations')).toBe(4);
    });
  });
});

describe('retention settings', () => {
  it('falls back to the default rather than to zero on a damaged value', () => {
    // Zero disables retention entirely, so it must never be arrived at by
    // accident — a negative or unparsable value has to restore the default.
    const settings = normalizeSettings({
      retention: { detailDays: -5, inventoryDays: 'forever', purgeOnStartup: 'yes' }
    });

    expect(settings.retention.detailDays).toBe(DEFAULT_SETTINGS.retention.detailDays);
    expect(settings.retention.inventoryDays).toBe(DEFAULT_SETTINGS.retention.inventoryDays);
    expect(settings.retention.purgeOnStartup).toBe(DEFAULT_SETTINGS.retention.purgeOnStartup);
  });

  it('accepts an explicit zero, because keeping forever is a real choice', () => {
    expect(normalizeSettings({ retention: { detailDays: 0 } }).retention.detailDays).toBe(0);
  });

  it('round-trips through disk and merges a partial update', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'radiochron-settings-'));
    try {
      const file = settingsFilePath(dir);

      // A missing file is the first run, not an error.
      expect(await loadSettings(file)).toEqual(DEFAULT_SETTINGS);

      const saved = await saveSettings(file, { retention: { detailDays: 7 } });
      expect(saved.retention.detailDays).toBe(7);
      // The untouched field keeps its previous value rather than resetting.
      expect(saved.retention.inventoryDays).toBe(DEFAULT_SETTINGS.retention.inventoryDays);
      expect(await loadSettings(file)).toEqual(saved);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
