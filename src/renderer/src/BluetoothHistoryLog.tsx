import { useMemo, type ReactElement } from 'react';
import type { DesktopBleHistoryArchive } from '../../platform/bleHistory';
import { summarizeBleHistoryLog } from './bleHistoryLog';

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatGap(fromMs: number, toMs: number): string {
  const minutes = Math.round((toMs - fromMs) / 60_000);
  if (minutes < 1) return 'moments';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function BluetoothHistoryLog({
  history
}: {
  history: DesktopBleHistoryArchive | null;
}): ReactElement {
  const log = useMemo(() => summarizeBleHistoryLog(history), [history]);

  if (log.coverage.session_count === 0) {
    return (
      <section className="panel">
        <h2>History</h2>
        <p className="muted">
          No scans have been recorded yet. Run a Bluetooth scan and the sessions will be listed here
          in order, kept for {log.coverage.retained_days || 30} days.
        </p>
      </section>
    );
  }

  const { coverage } = log;

  return (
    <section className="panel ble-history-log">
      <h2>History</h2>
      <p className="muted">
        {coverage.session_count} scan{coverage.session_count === 1 ? '' : 's'} covering{' '}
        {formatGap(coverage.oldest_ms ?? 0, coverage.newest_ms ?? 0)}, {coverage.distinct_devices}{' '}
        distinct device{coverage.distinct_devices === 1 ? '' : 's'}. Devices are counted after
        address rotation is resolved, so one phone is one device however often its address changed.
        Records older than {coverage.retained_days} days are discarded.
      </p>
      {coverage.storage_warning ? (
        <p className="ble-history-warning">{coverage.storage_warning}</p>
      ) : null}

      <h3>Scans</h3>
      <table className="ble-history-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Zone</th>
            <th>Devices</th>
            <th>New</th>
            <th>Strongest</th>
            <th>Findings</th>
          </tr>
        </thead>
        <tbody>
          {log.sessions.map((session) => (
            <tr key={session.scan_id}>
              <td>{formatTime(session.observed_at_ms)}</td>
              <td>{session.zone ?? '—'}</td>
              <td>{session.device_count}</td>
              <td>{session.new_device_count > 0 ? session.new_device_count : '—'}</td>
              <td>
                {session.strongest_rssi_dbm === null ? '—' : `${session.strongest_rssi_dbm} dBm`}
              </td>
              <td>{session.finding_count > 0 ? session.finding_count : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Devices, by when they were last seen</h3>
      <table className="ble-history-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>First seen</th>
            <th>Last seen</th>
            <th>Scans</th>
            <th>Present</th>
          </tr>
        </thead>
        <tbody>
          {log.devices.map((device) => (
            <tr key={device.tracking_key}>
              <td>{device.label}</td>
              <td>{formatTime(device.first_seen_ms)}</td>
              <td>{formatTime(device.last_seen_ms)}</td>
              <td>{device.session_count}</td>
              <td>
                {/* Seen in every scan across its span, or only some of them —
                    the difference between a fixture and a visitor. */}
                {device.span_sessions > 1
                  ? `${Math.round((device.session_count / device.span_sessions) * 100)}% of ${device.span_sessions}`
                  : 'once'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
