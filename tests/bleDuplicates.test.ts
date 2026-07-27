import { describe, expect, it } from 'vitest';
import { applyBleIdentityTracking } from '../src/platform/bleIdentityTracking';
import type { DesktopBleHistoryArchive, DesktopBleHistoryPoint } from '../src/platform/bleHistory';
import { buildBleWorkspaceDevices } from '../src/renderer/src/bleWorkspaceModel';

/**
 * Duplicate suppression, end to end.
 *
 * Bluetooth LE privacy addresses rotate every fifteen minutes or so, which is
 * the whole reason a naive device list turns one phone in a pocket into forty
 * entries by lunchtime. Two failures matter and they pull in opposite
 * directions: splitting one device into many, and merging two devices into one.
 * Both are covered here, because a fix for the first that causes the second is
 * worse than the bug.
 */

const START = 1_770_000_000_000;

function point(overrides: Partial<DesktopBleHistoryPoint> = {}): DesktopBleHistoryPoint {
  return {
    identity_key: 'ble-id-v1:0000000000000001',
    identity_confidence: 'ephemeral_address',
    protocol: null,
    local_name: null,
    address_type: 'resolvable_private',
    rssi_dbm: -60,
    payload_hash: 'ble-payload-v1:aaaaaaaaaaaaaaaa',
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

  // The production path runs the tracker over the archive before the UI sees
  // it, so the test has to as well or it would be checking a shape that never
  // reaches a user.
  applyBleIdentityTracking(built as never);

  return {
    schema_version: 4,
    generated_at_ms: START,
    storage_warning: null,
    retention: { max_age_days: 30, max_sessions: 512 },
    sessions: built
  } as DesktopBleHistoryArchive;
}

describe('Bluetooth duplicate suppression', () => {
  it('keeps one entry for a device whose private address rotates', () => {
    // Same name, same payload, same signal — a phone advertising continuously
    // while the controller hands it a fresh random address each session.
    const history = archive([
      { atMs: START, points: [point({ identity_key: 'ble-id-v1:aaa1', local_name: 'Pixel' })] },
      {
        atMs: START + 60_000,
        points: [point({ identity_key: 'ble-id-v1:aaa2', local_name: 'Pixel' })]
      },
      {
        atMs: START + 120_000,
        points: [point({ identity_key: 'ble-id-v1:aaa3', local_name: 'Pixel' })]
      }
    ]);

    const devices = buildBleWorkspaceDevices(null, history);

    expect(devices).toHaveLength(1);
    expect(devices[0].observationCount).toBe(3);
    expect(devices[0].trackingConfidence).toBe('probabilistic_rotation');
  });

  it('keeps two devices apart rather than collapsing them into one', () => {
    // Different names and different payloads: nothing here justifies a merge,
    // and merging would silently hide a device from the operator.
    const watch = { local_name: 'Watch', payload_hash: 'ble-payload-v1:1111111111111111' };
    const buds = { local_name: 'Earbuds', payload_hash: 'ble-payload-v1:2222222222222222' };
    const history = archive([
      {
        atMs: START,
        points: [
          point({ identity_key: 'ble-id-v1:bbb1', ...watch }),
          point({ identity_key: 'ble-id-v1:ccc1', ...buds })
        ]
      },
      {
        atMs: START + 60_000,
        points: [
          point({ identity_key: 'ble-id-v1:bbb2', ...watch }),
          point({ identity_key: 'ble-id-v1:ccc2', ...buds })
        ]
      }
    ]);

    const devices = buildBleWorkspaceDevices(null, history);

    expect(devices).toHaveLength(2);
    expect(new Set(devices.map((device) => device.key)).size).toBe(2);
    expect(devices.map((device) => device.localName).sort()).toEqual(['Earbuds', 'Watch']);
  });

  it('never lists a random address that was seen exactly once', () => {
    // The single largest source of phantom entries: a privacy address seen once
    // will never reappear under that address, so listing it would add a row
    // that can only ever be a duplicate of some device already shown.
    const history = archive([
      {
        atMs: START,
        points: [
          point({ identity_key: 'ble-id-v1:once', local_name: null }),
          point({
            identity_key: 'ble-id-v1:stable',
            identity_confidence: 'static_address',
            address_type: 'public',
            local_name: 'Printer'
          })
        ]
      }
    ]);

    const devices = buildBleWorkspaceDevices(null, history);

    // The public address is kept; the one-shot private address is not.
    expect(devices).toHaveLength(1);
    expect(devices[0].localName).toBe('Printer');
  });

  it('does not list a stable identity twice across many sessions', () => {
    // An iBeacon keeps one identity forever; seeing it fifty times must not
    // produce fifty rows.
    const sessions = Array.from({ length: 50 }, (_, index) => ({
      atMs: START + index * 30_000,
      points: [
        point({
          identity_key: 'ble-id-v1:beacon',
          identity_confidence: 'protocol',
          protocol: 'ibeacon',
          address_type: 'public',
          local_name: 'Beacon'
        })
      ]
    }));

    const devices = buildBleWorkspaceDevices(null, archive(sessions));

    expect(devices).toHaveLength(1);
    expect(devices[0].observationCount).toBe(50);
    expect(devices[0].trackingConfidence).toBe('stable_identity');
    expect(devices[0].firstSeenMs).toBe(START);
    expect(devices[0].lastSeenMs).toBe(START + 49 * 30_000);
  });

  it('does not double a device that is both in the live scan and in history', () => {
    // The classic duplicate: the current scan is merged with retained history,
    // and the device now on screen is also the device recorded a minute ago.
    const advertisement = {
      address: 'AA:BB:CC:DD:EE:01',
      address_type: 'public' as const,
      local_name: 'Sensor',
      rssi_dbm: -48,
      service_uuids: [],
      manufacturer_data: [],
      service_data: []
    };
    const scannedAtMs = START + 60_000;

    const history = archive([
      {
        atMs: START,
        points: [
          point({
            identity_key: 'ble-id-v1:sensor',
            identity_confidence: 'static_address',
            address_type: 'public',
            local_name: 'Sensor'
          })
        ]
      },
      {
        atMs: scannedAtMs,
        points: [
          point({
            identity_key: 'ble-id-v1:sensor',
            identity_confidence: 'static_address',
            address_type: 'public',
            local_name: 'Sensor'
          })
        ]
      }
    ]);

    const live = {
      scanned_at_ms: scannedAtMs,
      scan: { advertisements: [advertisement], system_devices: [] },
      observations: [
        {
          identity: {
            key: 'ble-id-v1:sensor',
            confidence: 'static_address' as const,
            protocol: null
          },
          payload_hash: 'ble-payload-v1:aaaaaaaaaaaaaaaa',
          history: null,
          findings: []
        }
      ],
      histories: [],
      findings: [],
      analytics_history: history
    };

    const devices = buildBleWorkspaceDevices(live as never, history);

    const sensors = devices.filter((device) => device.localName === 'Sensor');
    expect(sensors).toHaveLength(1);
    expect(sensors[0].radioObserved).toBe(true);
  });
});
