import { describe, expect, it } from 'vitest';
import { applyBleIdentityTracking } from '../src/platform/bleIdentityTracking';
import type { DesktopBleHistoryArchive, DesktopBleHistoryPoint } from '../src/platform/bleHistory';
import { bleHistoryUpTo, bleKeysInSession } from '../src/renderer/src/bleHistoryLog';
import { buildBleWorkspaceDevices } from '../src/renderer/src/bleWorkspaceModel';

const START = 1_770_000_000_000;
const MINUTE = 60_000;

function point(overrides: Partial<DesktopBleHistoryPoint> = {}): DesktopBleHistoryPoint {
  return {
    identity_key: 'ble-id-v1:default',
    identity_confidence: 'static_address',
    protocol: null,
    local_name: null,
    address_type: 'public',
    rssi_dbm: -70,
    payload_hash: 'ble-payload-v1:0000000000000000',
    service_uuids: [],
    company_ids: [],
    service_data_uuids: [],
    ...overrides
  };
}

function archive(
  sessions: Array<{ atMs: number; points: DesktopBleHistoryPoint[] }>
): DesktopBleHistoryArchive {
  const built = sessions.map((session, index) => ({
    scan_id: `scan-${index}`,
    observed_at_ms: session.atMs,
    zone: null,
    elapsed_ms: 4_000,
    adapter_count: 1,
    advertisement_count: session.points.length,
    system_device_count: 0,
    error_count: 0,
    points: session.points,
    findings: [],
    system_devices: []
  }));
  applyBleIdentityTracking(built as never);
  return {
    schema_version: 4,
    generated_at_ms: START,
    storage_warning: null,
    retention: { max_age_days: 30, max_sessions: 512 },
    sessions: built
  } as DesktopBleHistoryArchive;
}

const printer = point({ identity_key: 'ble-id-v1:printer', local_name: 'Printer' });
const laptop = point({ identity_key: 'ble-id-v1:laptop', local_name: 'Laptop' });
const phone = point({ identity_key: 'ble-id-v1:phone', local_name: 'Phone' });

const THREE_SCANS = archive([
  { atMs: START, points: [printer] },
  { atMs: START + MINUTE, points: [printer, laptop] },
  { atMs: START + 2 * MINUTE, points: [printer, phone] }
]);

/** What the map renders when the scrubber sits on a given scan. */
function devicesAt(history: DesktopBleHistoryArchive, index: number) {
  const present = bleKeysInSession(history, index);
  return buildBleWorkspaceDevices(null, bleHistoryUpTo(history, index)).filter((device) =>
    present.has(device.key)
  );
}

describe('Bluetooth map history scrubber', () => {
  it('shows only the devices present in the selected scan', () => {
    expect(devicesAt(THREE_SCANS, 0).map((device) => device.localName)).toEqual(['Printer']);
    expect(devicesAt(THREE_SCANS, 1).map((device) => device.localName).sort()).toEqual([
      'Laptop',
      'Printer'
    ]);
    // The laptop was there a minute ago; rewinding to now must not resurrect it.
    expect(devicesAt(THREE_SCANS, 2).map((device) => device.localName).sort()).toEqual([
      'Phone',
      'Printer'
    ]);
  });

  it('reports the counts known at that moment, not today totals', () => {
    // The printer had been seen once by the first scan and three times by the
    // last. Pinning current totals to an old timestamp would be a lie.
    const atFirst = devicesAt(THREE_SCANS, 0).find((device) => device.localName === 'Printer');
    const atLast = devicesAt(THREE_SCANS, 2).find((device) => device.localName === 'Printer');

    expect(atFirst?.observationCount).toBe(1);
    expect(atLast?.observationCount).toBe(3);
    expect(atFirst?.lastSeenMs).toBe(START);
    expect(atLast?.lastSeenMs).toBe(START + 2 * MINUTE);
  });

  it('clamps an out-of-range position instead of returning nothing', () => {
    expect(bleHistoryUpTo(THREE_SCANS, 99)?.sessions).toHaveLength(3);
    expect(bleHistoryUpTo(THREE_SCANS, -5)?.sessions).toHaveLength(1);
    expect(bleKeysInSession(THREE_SCANS, 99).size).toBe(2);
  });

  it('handles an empty archive without inventing a session', () => {
    const empty = archive([]);
    expect(bleHistoryUpTo(empty, 0)?.sessions).toEqual([]);
    expect(bleKeysInSession(empty, 0).size).toBe(0);
    expect(bleHistoryUpTo(null, 0)).toBeNull();
  });

  it('orders by observation time even when sessions arrive out of order', () => {
    // The archive is appended to over time and could be rewritten; the scrubber
    // must move through chronology, not through array position.
    const shuffled = archive([
      { atMs: START + 2 * MINUTE, points: [phone] },
      { atMs: START, points: [printer] },
      { atMs: START + MINUTE, points: [laptop] }
    ]);

    expect(devicesAt(shuffled, 0).map((device) => device.localName)).toEqual(['Printer']);
    expect(devicesAt(shuffled, 2).map((device) => device.localName)).toEqual(['Phone']);
  });
});
