import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DesktopBleHistoryArchive, DesktopBleViewResult } from '../../platform/bleHistory';
import { BluetoothHistoryLog } from './BluetoothHistoryLog';
import { BluetoothAnalytics } from './BluetoothAnalytics';
import { BluetoothControls } from './BluetoothControls';
import { BluetoothDeviceModal } from './BluetoothDeviceModal';
import { BluetoothDevices } from './BluetoothDevices';
import { BluetoothFindings } from './BluetoothFindings';
import { BluetoothMap } from './BluetoothMap';
import { BluetoothMapScrubber } from './BluetoothMapScrubber';
import { bleHistoryUpTo, bleKeysInSession } from './bleHistoryLog';
import { BluetoothOverview } from './BluetoothOverview';
import { buildBleWorkspaceDevices, type BleWorkspaceDevice } from './bleWorkspaceModel';
import type { BluetoothView } from './bluetoothWorkspace';

interface BluetoothPanelProps {
  demoMode: boolean;
  activeView: BluetoothView;
}

export function BluetoothPanel({ demoMode, activeView }: BluetoothPanelProps) {
  const [durationMs, setDurationMs] = useState(4_000);
  const [zone, setZone] = useState('Desktop sensor');
  const [result, setResult] = useState<DesktopBleViewResult | null>(null);
  const [history, setHistory] = useState<DesktopBleHistoryArchive | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<BleWorkspaceDevice | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Null is live; an index rewinds the map to that recorded scan. */
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const archive = history ?? result?.analytics_history ?? null;

  const devices = useMemo(
    () => buildBleWorkspaceDevices(result, archive),
    [archive, result]
  );

  // Devices as they stood at the selected scan: built from the archive sliced
  // to that moment, then narrowed to the ones actually present in it.
  const historicalDevices = useMemo(() => {
    if (historyIndex === null) return null;
    const present = bleKeysInSession(archive, historyIndex);
    return buildBleWorkspaceDevices(null, bleHistoryUpTo(archive, historyIndex)).filter((device) =>
      present.has(device.key)
    );
  }, [archive, historyIndex]);

  const mapDevices = historicalDevices ?? devices;

  const scan = useCallback(async () => {
    if (!window.monitor?.scanBluetooth) {
      setError('This build does not expose the RadioChron BLE bridge.');
      return;
    }
    setScanning(true);
    setError(null);
    try {
      const nextResult = await window.monitor.scanBluetooth({ durationMs, zone: zone.trim() || null });
      setResult(nextResult);
      setHistory(nextResult.analytics_history);
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setScanning(false);
    }
  }, [durationMs, zone]);

  useEffect(() => {
    let cancelled = false;
    if (!window.monitor?.getBluetoothHistory) return;
    void window.monitor.getBluetoothHistory()
      .then((storedHistory) => {
        if (!cancelled) setHistory(storedHistory);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (demoMode && !result && !scanning) void scan();
  }, [demoMode, result, scan, scanning]);

  async function resetHistory(): Promise<void> {
    if (!window.monitor?.resetBluetoothTracker) return;
    setError(null);
    try {
      await window.monitor.resetBluetoothTracker();
      setResult(null);
      setHistory(null);
      setSelectedDevice(null);
      setHistoryIndex(null);
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  return (
    <section className="bluetooth-layout">
      <BluetoothControls
        zone={zone}
        durationMs={durationMs}
        scanning={scanning}
        adapterCount={result?.scan.adapter_count ?? 0}
        systemDeviceCount={result?.scan.system_devices?.length ?? 0}
        discoveryMode={result?.scan.discovery_mode ?? null}
        elapsedMs={result?.scan.elapsed_ms ?? null}
        lastScanMs={result?.scanned_at_ms ?? history?.sessions.at(-1)?.observed_at_ms ?? null}
        onZoneChange={setZone}
        onDurationChange={setDurationMs}
        onScan={() => void scan()}
        onReset={() => void resetHistory()}
      />

      {demoMode ? <p className="ble-demo-banner">Synthetic BLE lab data · names, addresses and history are mocked.</p> : null}
      {error ? <p className="error banner">{error}</p> : null}
      {history?.storage_warning ? <p className="error banner">{history.storage_warning}</p> : null}

      {activeView === 'overview' ? (
        <BluetoothOverview
          devices={devices}
          findings={result?.findings ?? []}
          scanCount={(history ?? result?.analytics_history)?.sessions.length ?? 0}
          onSelect={setSelectedDevice}
        />
      ) : null}
      {activeView === 'map' ? (
        <>
          <BluetoothMapScrubber
            history={archive}
            selectedIndex={historyIndex}
            deviceCount={mapDevices.length}
            onSelect={setHistoryIndex}
            onLive={() => setHistoryIndex(null)}
          />
          <BluetoothMap
            devices={mapDevices}
            zone={zone}
            adapterCount={result?.scan.adapter_count ?? 0}
            discoveryMode={result?.scan.discovery_mode ?? null}
            lastScanMs={
              historyIndex === null
                ? result?.scanned_at_ms ?? history?.sessions.at(-1)?.observed_at_ms ?? null
                : bleHistoryUpTo(archive, historyIndex)?.sessions.at(-1)?.observed_at_ms ?? null
            }
            onSelect={setSelectedDevice}
          />
        </>
      ) : null}
      {activeView === 'devices' ? <BluetoothDevices devices={devices} onSelect={setSelectedDevice} /> : null}
      {activeView === 'log' ? (
        <BluetoothHistoryLog history={history ?? result?.analytics_history ?? null} />
      ) : null}
      {activeView === 'history' ? <BluetoothAnalytics history={history ?? result?.analytics_history ?? null} /> : null}
      {activeView === 'findings' ? (
        <BluetoothFindings findings={result?.findings ?? []} history={history ?? result?.analytics_history ?? null} />
      ) : null}

      {selectedDevice ? <BluetoothDeviceModal device={selectedDevice} onClose={() => setSelectedDevice(null)} /> : null}
    </section>
  );
}
