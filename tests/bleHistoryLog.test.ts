import { describe, expect, it } from 'vitest';
import { applyBleIdentityTracking } from '../src/platform/bleIdentityTracking';
import type { DesktopBleHistoryArchive, DesktopBleHistoryPoint } from '../src/platform/bleHistory';
import { summarizeBleHistoryLog } from '../src/renderer/src/bleHistoryLog';

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
  sessions: Array<{ atMs: number; points: DesktopBleHistoryPoint[]; findings?: number }>
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
    findings: Array.from({ length: session.findings ?? 0 }, () => ({
      kind: 'persistent_unknown',
      severity: 'warning',
      identity_key: null,
      summary: 'test'
    })),
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

describe('Bluetooth history log', () => {
  it('reports nothing rather than inventing a session when no scan has run', () => {
    const log = summarizeBleHistoryLog(null);

    expect(log.coverage.session_count).toBe(0);
    expect(log.sessions).toEqual([]);
    expect(log.devices).toEqual([]);
  });

  it('lists scans newest first and counts only genuinely new devices', () => {
    const printer = point({ identity_key: 'ble-id-v1:printer', local_name: 'Printer' });
    const watch = point({ identity_key: 'ble-id-v1:watch', local_name: 'Watch' });

    const log = summarizeBleHistoryLog(
      archive([
        { atMs: START, points: [printer] },
        { atMs: START + MINUTE, points: [printer, watch], findings: 2 },
        { atMs: START + 2 * MINUTE, points: [printer, watch] }
      ])
    );

    expect(log.sessions.map((session) => session.observed_at_ms)).toEqual([
      START + 2 * MINUTE,
      START + MINUTE,
      START
    ]);
    // Newest first, so the "new device" counts read 0, 1, 1 in that order.
    expect(log.sessions.map((session) => session.new_device_count)).toEqual([0, 1, 1]);
    expect(log.sessions[1].finding_count).toBe(2);
    expect(log.coverage.distinct_devices).toBe(2);
  });

  it('counts a rotating address as one recurring device, not several new ones', () => {
    // Without tracking keys this is the reading that makes a history useless:
    // three scans, three brand-new devices, every time.
    const rotating = (key: string) =>
      point({
        identity_key: key,
        identity_confidence: 'ephemeral_address',
        address_type: 'resolvable_private',
        local_name: 'Pixel'
      });

    const log = summarizeBleHistoryLog(
      archive([
        { atMs: START, points: [rotating('ble-id-v1:r1')] },
        { atMs: START + MINUTE, points: [rotating('ble-id-v1:r2')] },
        { atMs: START + 2 * MINUTE, points: [rotating('ble-id-v1:r3')] }
      ])
    );

    expect(log.coverage.distinct_devices).toBe(1);
    expect(log.devices).toHaveLength(1);
    expect(log.devices[0].session_count).toBe(3);
    expect(log.devices[0].first_seen_ms).toBe(START);
    expect(log.devices[0].last_seen_ms).toBe(START + 2 * MINUTE);
    expect(log.sessions.map((session) => session.new_device_count)).toEqual([0, 0, 1]);
  });

  it('separates a fixture from a visitor by how much of its span it was present for', () => {
    const fixture = point({ identity_key: 'ble-id-v1:fixture', local_name: 'Thermostat' });
    const visitor = point({ identity_key: 'ble-id-v1:visitor', local_name: 'Laptop' });

    const log = summarizeBleHistoryLog(
      archive([
        { atMs: START, points: [fixture, visitor] },
        { atMs: START + MINUTE, points: [fixture] },
        { atMs: START + 2 * MINUTE, points: [fixture] },
        { atMs: START + 3 * MINUTE, points: [fixture, visitor] }
      ])
    );

    const byName = new Map(log.devices.map((device) => [device.label, device]));
    expect(byName.get('Thermostat')).toMatchObject({ session_count: 4, span_sessions: 4 });
    // Seen at both ends of a four-scan span but absent in the middle.
    expect(byName.get('Laptop')).toMatchObject({ session_count: 2, span_sessions: 4 });
  });

  it('names an unnamed device distinctly instead of leaving the row blank', () => {
    const log = summarizeBleHistoryLog(
      archive([
        {
          atMs: START,
          points: [
            point({ identity_key: 'ble-id-v1:aaaaaa111111' }),
            point({ identity_key: 'ble-id-v1:bbbbbb222222' })
          ]
        }
      ])
    );

    const labels = log.devices.map((device) => device.label);
    expect(new Set(labels).size).toBe(2);
    expect(labels.every((label) => label.startsWith('unnamed '))).toBe(true);
  });
});
