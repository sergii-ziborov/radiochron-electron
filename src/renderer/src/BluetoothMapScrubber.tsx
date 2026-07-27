import type { ReactElement } from 'react';
import type { DesktopBleHistoryArchive } from '../../platform/bleHistory';

function formatTimeOnly(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Rewind the Bluetooth map through recorded scans.
 *
 * The Wi-Fi map has had this since the beginning; Bluetooth stored every
 * session and offered no way to move through them, so the map could only ever
 * show now. Same control, same vocabulary — Live on the right, oldest scan on
 * the left — because it answers the same question about a different radio.
 */
export function BluetoothMapScrubber({
  history,
  selectedIndex,
  deviceCount,
  onSelect,
  onLive
}: {
  history: DesktopBleHistoryArchive | null;
  /** Null means live: the most recent scan plus everything retained. */
  selectedIndex: number | null;
  deviceCount: number;
  onSelect: (index: number | null) => void;
  onLive: () => void;
}): ReactElement {
  const sessions = [...(history?.sessions ?? [])].sort(
    (left, right) => left.observed_at_ms - right.observed_at_ms
  );
  const maxIndex = Math.max(0, sessions.length - 1);
  const sliderIndex = selectedIndex ?? maxIndex;
  const active = selectedIndex === null ? null : sessions[sliderIndex];
  const disabled = sessions.length === 0;

  return (
    <section className={`history-scrubber-shell ${active ? 'history-scrubber-paused' : ''}`}>
      <div className="history-scrubber">
        <div className="history-scrubber-copy">
          <span>{active ? 'History View' : 'Live View'}</span>
          <strong>
            {active
              ? `${formatDateTime(active.observed_at_ms)} | ${deviceCount} device${deviceCount === 1 ? '' : 's'} present`
              : sessions.length > 0
                ? `Live | ${sessions.length} scan${sessions.length === 1 ? '' : 's'} retained`
                : 'Live | no scans recorded yet'}
          </strong>
        </div>
        <div className="history-slider-wrap">
          <small>{sessions[0] ? formatTimeOnly(sessions[0].observed_at_ms) : '--:--'}</small>
          <input
            type="range"
            min={0}
            max={maxIndex}
            step={1}
            value={sliderIndex}
            disabled={disabled}
            aria-label="Bluetooth scan history position"
            onChange={(event) => {
              const next = Number(event.target.value);
              // Sliding to the newest scan is the same thing as going live.
              onSelect(next >= maxIndex ? null : next);
            }}
          />
          <small>
            {sessions[maxIndex] ? formatTimeOnly(sessions[maxIndex].observed_at_ms) : '--:--'}
          </small>
        </div>
        <button type="button" className="scan-now-button" onClick={onLive} disabled={!active}>
          Live
        </button>
      </div>
    </section>
  );
}
