import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { APP_THEMES, applyTheme, DEFAULT_THEME } from './themes';

interface RetentionSettings {
  detailDays: number;
  inventoryDays: number;
  purgeOnStartup: boolean;
}

interface HistoryFootprint {
  database_file: string;
  size_bytes: number;
  rows: Record<string, number>;
}

interface RetentionReport {
  total_deleted: number;
  reclaimed_bytes: number;
  deleted: Record<string, number>;
}

/** Named so the row reads as prose rather than as a column name. */
const TABLE_LABELS: Record<string, string> = {
  baseline_runs: 'Collection runs',
  collector_events: 'Collector events',
  device_observations: 'Device sightings',
  device_identity_alerts: 'Identity alerts',
  vulnerability_scans: 'Vulnerability scans',
  device_metrics: 'Per-location metrics',
  device_inventory: 'Known devices',
  scan_locations: 'Scan locations'
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeWindow(days: number): string {
  if (days === 0) return 'kept indefinitely';
  if (days === 1) return 'kept for 1 day';
  return `kept for ${days} days`;
}

export function SettingsPanel(): ReactElement {
  const [retention, setRetention] = useState<RetentionSettings | null>(null);
  const [theme, setTheme] = useState<string>(DEFAULT_THEME);
  const [footprint, setFootprint] = useState<HistoryFootprint | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const bridge = window.monitor;
    if (!bridge?.getSettings) return;
    const settings = await bridge.getSettings();
    setRetention(settings.retention);
    // Settings on disk win over the localStorage value the boot script used.
    setTheme(applyTheme(settings.theme ?? DEFAULT_THEME));
    if (bridge.getHistoryFootprint) {
      setFootprint(await bridge.getHistoryFootprint());
    }
  }, []);

  const chooseTheme = useCallback(async (id: string) => {
    // Applied first so the change is instant; persistence follows.
    setTheme(applyTheme(id));
    await window.monitor?.updateSettings?.({ theme: id });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (patch: Partial<RetentionSettings>) => {
      const bridge = window.monitor;
      if (!bridge?.updateSettings) return;
      setBusy(true);
      try {
        const saved = await bridge.updateSettings({ retention: patch });
        setRetention(saved.retention);
        setStatus('Saved.');
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const purgeNow = useCallback(async () => {
    const bridge = window.monitor;
    if (!bridge?.purgeExpiredHistory) return;
    setBusy(true);
    setStatus(null);
    try {
      const report: RetentionReport = await bridge.purgeExpiredHistory();
      setStatus(
        report.total_deleted === 0
          ? 'Nothing was outside the retention window.'
          : `Removed ${report.total_deleted} record(s) and reclaimed ${formatBytes(report.reclaimed_bytes)}.`
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (!retention) {
    return (
      <section className="panel">
        <h2>Settings</h2>
        <p className="muted">Settings are unavailable in this build.</p>
      </section>
    );
  }

  return (
    <section className="panel settings-panel">
      <h2>Appearance</h2>
      <p className="muted">
        Every colour resolves through one palette, so a theme changes the whole
        application rather than a header. Names match the other RadioChron tools.
      </p>
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {APP_THEMES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={theme === option.id}
            className={theme === option.id ? 'theme-option theme-option-active' : 'theme-option'}
            onClick={() => void chooseTheme(option.id)}
          >
            <span className="theme-dot" style={{ background: option.dot }} aria-hidden="true" />
            <span className="theme-name">{option.label}</span>
            <small>{option.description}</small>
          </button>
        ))}
      </div>

      <h2>Data retention</h2>
      <p className="muted">
        This application records the access points and Bluetooth devices around it, with times and
        signal strength. That is useful evidence and it is also a record of who was nearby, so it is
        deleted on a schedule you choose rather than kept forever.
      </p>

      <label className="settings-field">
        <span>Keep individual sightings</span>
        <input
          type="number"
          min={0}
          max={3650}
          value={retention.detailDays}
          disabled={busy}
          onChange={(event) => {
            const days = Number(event.target.value);
            if (Number.isFinite(days) && days >= 0) {
              setRetention({ ...retention, detailDays: days });
            }
          }}
          onBlur={() => void update({ detailDays: retention.detailDays })}
        />
        <small>
          Sightings, collector events, alerts and scans — {describeWindow(retention.detailDays)}.
          This is the bulk of the database. Zero keeps everything.
        </small>
      </label>

      <label className="settings-field">
        <span>Keep the device list</span>
        <input
          type="number"
          min={0}
          max={3650}
          value={retention.inventoryDays}
          disabled={busy}
          onChange={(event) => {
            const days = Number(event.target.value);
            if (Number.isFinite(days) && days >= 0) {
              setRetention({ ...retention, inventoryDays: days });
            }
          }}
          onBlur={() => void update({ inventoryDays: retention.inventoryDays })}
        />
        <small>
          A device stays listed for this long after it was last seen —{' '}
          {describeWindow(retention.inventoryDays)}. Usually longer than sightings: that something
          has been here for months is worth keeping after the individual sightings are gone.
        </small>
      </label>

      <label className="settings-field settings-field-inline">
        <input
          type="checkbox"
          checked={retention.purgeOnStartup}
          disabled={busy}
          onChange={(event) => void update({ purgeOnStartup: event.target.checked })}
        />
        <span>Delete expired history automatically</span>
        <small>At startup and once a day while the application runs.</small>
      </label>

      <div className="settings-actions">
        <button type="button" onClick={() => void purgeNow()} disabled={busy}>
          Delete expired history now
        </button>
        {status ? <span className="settings-status">{status}</span> : null}
      </div>

      {footprint ? (
        <div className="settings-footprint">
          <h3>Stored right now</h3>
          <p className="muted">
            {footprint.database_file} — {formatBytes(footprint.size_bytes)}
          </p>
          <table>
            <tbody>
              {Object.entries(footprint.rows).map(([table, rows]) => (
                <tr key={table}>
                  <td>{TABLE_LABELS[table] ?? table}</td>
                  <td>{rows.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
