import type { DesktopBleHistoryArchive } from '../../platform/bleHistory';
import { blePointTrackingKey } from '../../platform/bleIdentityTracking';

/**
 * A plain chronicle of what was seen and when.
 *
 * The analytics view answers "what does the aggregate look like". This answers
 * the different question an operator actually asks after an incident — "what
 * happened, in order" — which charts are bad at and a list is good at.
 *
 * Devices are counted by tracking key, the same key the device list groups by,
 * so a phone whose private address rotated between two scans is one recurring
 * device here rather than two new ones.
 */

export interface BleHistoryCoverage {
  session_count: number;
  oldest_ms: number | null;
  newest_ms: number | null;
  distinct_devices: number;
  storage_warning: string | null;
  retained_days: number;
}

export interface BleHistorySessionRow {
  scan_id: string;
  observed_at_ms: number;
  zone: string | null;
  elapsed_ms: number;
  device_count: number;
  /** Devices in this session not seen in any earlier retained session. */
  new_device_count: number;
  finding_count: number;
  strongest_rssi_dbm: number | null;
}

export interface BleHistoryDeviceRow {
  tracking_key: string;
  label: string;
  protocol: string | null;
  first_seen_ms: number;
  last_seen_ms: number;
  session_count: number;
  /** Sessions between first and last sighting; 1 means seen only once. */
  span_sessions: number;
}

export interface BleHistoryLog {
  coverage: BleHistoryCoverage;
  sessions: BleHistorySessionRow[];
  devices: BleHistoryDeviceRow[];
}

const EMPTY: BleHistoryLog = {
  coverage: {
    session_count: 0,
    oldest_ms: null,
    newest_ms: null,
    distinct_devices: 0,
    storage_warning: null,
    retained_days: 0
  },
  sessions: [],
  devices: []
};

/** Something readable for a device that never advertised a name. */
function deviceLabel(
  localName: string | null,
  protocol: string | null,
  trackingKey: string
): string {
  if (localName && localName.trim()) return localName.trim();
  if (protocol) return `${protocol} beacon`;
  // The tail of the fingerprint is enough to tell two rows apart by eye.
  return `unnamed ${trackingKey.slice(-6)}`;
}

export function summarizeBleHistoryLog(history: DesktopBleHistoryArchive | null): BleHistoryLog {
  const sessions = [...(history?.sessions ?? [])].sort(
    (left, right) => left.observed_at_ms - right.observed_at_ms
  );
  if (sessions.length === 0) return EMPTY;

  const seen = new Set<string>();
  const devices = new Map<string, BleHistoryDeviceRow & { first_index: number; last_index: number }>();
  const rows: BleHistorySessionRow[] = [];

  sessions.forEach((session, index) => {
    const keysHere = new Set<string>();
    let newDevices = 0;
    let strongest: number | null = null;

    for (const point of session.points) {
      const key = blePointTrackingKey(point);
      keysHere.add(key);
      if (!seen.has(key)) {
        seen.add(key);
        newDevices += 1;
      }
      if (strongest === null || point.rssi_dbm > strongest) {
        strongest = point.rssi_dbm;
      }

      const existing = devices.get(key);
      if (existing) {
        existing.last_seen_ms = session.observed_at_ms;
        existing.session_count += 1;
        existing.last_index = index;
        // A later sighting usually carries the better name.
        if (point.local_name?.trim()) {
          existing.label = deviceLabel(point.local_name, point.protocol, key);
        }
      } else {
        devices.set(key, {
          tracking_key: key,
          label: deviceLabel(point.local_name, point.protocol, key),
          protocol: point.protocol,
          first_seen_ms: session.observed_at_ms,
          last_seen_ms: session.observed_at_ms,
          session_count: 1,
          span_sessions: 1,
          first_index: index,
          last_index: index
        });
      }
    }

    rows.push({
      scan_id: session.scan_id,
      observed_at_ms: session.observed_at_ms,
      zone: session.zone,
      elapsed_ms: session.elapsed_ms,
      device_count: keysHere.size,
      new_device_count: newDevices,
      finding_count: session.findings.length,
      strongest_rssi_dbm: strongest
    });
  });

  const deviceRows: BleHistoryDeviceRow[] = [...devices.values()]
    .map(({ first_index, last_index, ...device }) => ({
      ...device,
      span_sessions: last_index - first_index + 1
    }))
    .sort((left, right) => right.last_seen_ms - left.last_seen_ms);

  return {
    coverage: {
      session_count: sessions.length,
      oldest_ms: sessions[0].observed_at_ms,
      newest_ms: sessions[sessions.length - 1].observed_at_ms,
      distinct_devices: devices.size,
      storage_warning: history?.storage_warning ?? null,
      retained_days: history?.retention.max_age_days ?? 0
    },
    // Newest first: the question is almost always about what just happened.
    sessions: rows.reverse(),
    devices: deviceRows
  };
}
