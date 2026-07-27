import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { statSync } from 'node:fs';

import { DEFAULT_RUN_DATABASE_FILE } from './runStore';
import type { RetentionSettings } from './settings';

export interface RetentionReport {
  ran_at_utc: string;
  /** Null when the corresponding retention is set to keep forever. */
  detail_cutoff_utc: string | null;
  inventory_cutoff_utc: string | null;
  /** Rows removed, per table. Tables with nothing to remove are omitted. */
  deleted: Record<string, number>;
  total_deleted: number;
  /** Bytes the database shrank by. Zero when nothing was reclaimed. */
  reclaimed_bytes: number;
}

/**
 * Per-sighting detail. Deleting these is the point of retention — they are what
 * grows without bound and what identifies who was nearby and when.
 */
const DETAIL_SWEEPS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'device_observations', column: 'ts_utc' },
  { table: 'device_identity_alerts', column: 'created_at_utc' },
  { table: 'vulnerability_scans', column: 'created_at_utc' }
];

/**
 * Aggregates. A device stays listed after its sightings are gone, which is
 * usually what an operator wants: the fact that something is a fixture here
 * outlives the evidence that established it.
 */
const INVENTORY_SWEEPS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'device_metrics', column: 'last_seen_utc' },
  { table: 'device_inventory', column: 'last_seen_utc' },
  { table: 'scan_locations', column: 'last_seen_utc' }
];

function cutoff(days: number, now: Date): string | null {
  // Zero is the documented "keep forever"; see RetentionSettings.
  if (days <= 0) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Delete history that has outlived the retention settings.
 *
 * Timestamps are stored as ISO-8601 text throughout, so an ordinary string
 * comparison is a correct chronological one and no parsing per row is needed.
 *
 * Runs are swept before their events: `collector_events.run_id` cascades, so
 * deleting a run takes its events with it, and sweeping events separately would
 * only orphan the ones whose own timestamp is null.
 */
export function purgeExpiredHistory(
  settings: RetentionSettings,
  databaseFile?: string,
  now: Date = new Date()
): RetentionReport {
  const file = resolve(databaseFile ?? DEFAULT_RUN_DATABASE_FILE);
  const detailCutoff = cutoff(settings.detailDays, now);
  const inventoryCutoff = cutoff(settings.inventoryDays, now);

  const report: RetentionReport = {
    ran_at_utc: now.toISOString(),
    detail_cutoff_utc: detailCutoff,
    inventory_cutoff_utc: inventoryCutoff,
    deleted: {},
    total_deleted: 0,
    reclaimed_bytes: 0
  };

  if (!detailCutoff && !inventoryCutoff) {
    return report;
  }

  const sizeBefore = fileSize(file);
  const db = new DatabaseSync(file);

  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

    const sweep = (table: string, column: string, limit: string): void => {
      // The tables are a fixed literal list above, never caller input.
      const result = db.prepare(`DELETE FROM ${table} WHERE ${column} < ?`).run(limit);
      const removed = Number(result.changes ?? 0);
      if (removed > 0) {
        report.deleted[table] = removed;
        report.total_deleted += removed;
      }
    };

    if (detailCutoff) {
      // Cascades into collector_events.
      sweep('baseline_runs', 'started_at_utc', detailCutoff);
      for (const { table, column } of DETAIL_SWEEPS) {
        sweep(table, column, detailCutoff);
      }
    }

    if (inventoryCutoff) {
      for (const { table, column } of INVENTORY_SWEEPS) {
        sweep(table, column, inventoryCutoff);
      }
    }
  } finally {
    if (report.total_deleted > 0) {
      // Deleted pages stay allocated until the file is rebuilt, and reclaiming
      // disk is half the reason an operator sets retention at all. VACUUM
      // cannot run inside a transaction, which is why nothing above opens one.
      try {
        db.exec('VACUUM');
      } catch {
        // A concurrent reader can block the rebuild. The rows are already gone;
        // the space is reclaimed on the next sweep.
      }
    }
    db.close();
  }

  const sizeAfter = fileSize(file);
  report.reclaimed_bytes = Math.max(0, sizeBefore - sizeAfter);
  return report;
}

/** Row counts per retained table, for showing what a purge would act on. */
export function historyFootprint(databaseFile?: string): {
  database_file: string;
  size_bytes: number;
  rows: Record<string, number>;
} {
  const file = resolve(databaseFile ?? DEFAULT_RUN_DATABASE_FILE);
  const rows: Record<string, number> = {};
  const db = new DatabaseSync(file);

  try {
    for (const { table } of [
      { table: 'baseline_runs' },
      { table: 'collector_events' },
      ...DETAIL_SWEEPS,
      ...INVENTORY_SWEEPS
    ]) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
          | { count: number }
          | undefined;
        rows[table] = Number(row?.count ?? 0);
      } catch {
        // A table that does not exist yet simply has nothing in it.
        rows[table] = 0;
      }
    }
  } finally {
    db.close();
  }

  return { database_file: file, size_bytes: fileSize(file), rows };
}
