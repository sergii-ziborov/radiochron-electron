import { hostname } from 'node:os';
import { getRadioChronCoreClient } from 'radiochron';
import {
  buildClientTimeline,
  detectReconnectLoops,
  sortWlanEventsChronologically
} from '../analysis/timeline';
import { createPlatformAdapter } from '../platform';
import type {
  BaselineEventsResult,
  BaselinePlatformAdapter,
  BaselineTimelineResult,
  EventContext,
  HistoryOptions,
  TimelineOptions,
  WindowsWifiEvent
} from './types';

export async function getBaselineEvents(
  options: HistoryOptions,
  adapter: BaselinePlatformAdapter = createPlatformAdapter()
): Promise<BaselineEventsResult> {
  const context = createEventContext('events');
  const getSourceStatus = adapter.getWlanEventSourceStatus ?? adapter.getSourceStatus;
  const [sources, events] = await Promise.all([
    getSourceStatus.call(adapter),
    loadRecentEvents(adapter, context, options.last)
  ]);

  return {
    run_id: context.runId,
    host_id: context.hostId,
    ts_utc: new Date().toISOString(),
    sources,
    order: 'chronological',
    events: sortWlanEventsChronologically(events)
  };
}

export async function getBaselineTimeline(
  options: TimelineOptions,
  adapter: BaselinePlatformAdapter = createPlatformAdapter()
): Promise<BaselineTimelineResult> {
  const context = createEventContext('timeline');
  const getSourceStatus = adapter.getWlanEventSourceStatus ?? adapter.getSourceStatus;
  const [sources, events] = await Promise.all([
    getSourceStatus.call(adapter),
    loadRecentEvents(adapter, context, options.last)
  ]);
  const orderedEvents = sortWlanEventsChronologically(events);
  const timeline = buildClientTimeline(orderedEvents, context);
  // UI projection only. Causal reconnect-loop meaning for product surfaces
  // should prefer `radiochron.history().verdict` / core classifier when present.
  const alerts = detectReconnectLoops(timeline, context, {
    windowMinutes: options.windowMinutes,
    minCycles: options.minCycles
  });

  return {
    run_id: context.runId,
    host_id: context.hostId,
    ts_utc: new Date().toISOString(),
    sources,
    event_count: orderedEvents.length,
    timeline_count: timeline.length,
    alert_count: alerts.length,
    timeline,
    alerts
  };
}

async function loadRecentEvents(
  adapter: BaselinePlatformAdapter,
  context: EventContext,
  last: number
): Promise<WindowsWifiEvent[]> {
  // Vitest unit tests inject adapters; skip the live bridge there.
  if (process.env.VITEST) {
    return adapter.getRecentWlanEvents(context, last);
  }
  try {
    const history = await getRadioChronCoreClient().history({
      maxEvents: last,
      withinSeconds: null
    });
    if (history.available && Array.isArray(history.events) && history.events.length > 0) {
      return history.events.map((event) =>
        mapCoreHistoryEvent(event as Record<string, unknown>, context)
      );
    }
  } catch {
    // Fall back to the platform adapter when the bridge is unavailable.
  }
  return adapter.getRecentWlanEvents(context, last);
}

function mapCoreHistoryEvent(
  event: Record<string, unknown>,
  context: EventContext
): WindowsWifiEvent {
  const data =
    event.data && typeof event.data === 'object' && !Array.isArray(event.data)
      ? (event.data as Record<string, string>)
      : {};
  return {
    schema: 'wifi.windows_baseline.v1',
    event_type: 'windows_wifi_event',
    ts_utc:
      typeof event.time_created === 'string'
        ? event.time_created
        : new Date().toISOString(),
    source: 'radiochron_core_history',
    run_id: context.runId,
    host_id: context.hostId,
    event_id: Number(event.event_id) || 0,
    record_id:
      typeof event.record_id === 'number'
        ? event.record_id
        : event.record_id == null
          ? null
          : Number(event.record_id),
    provider_name: 'Microsoft-Windows-WLAN-AutoConfig',
    level: null,
    adapter: data.InterfaceGuid ?? data.DeviceGuid ?? null,
    interface_guid: data.InterfaceGuid ?? data.DeviceGuid ?? null,
    local_mac: null,
    ssid: data.SSID ?? null,
    bss_type: null,
    message_fields: data,
    raw_message: typeof event.meaning === 'string' ? event.meaning : ''
  };
}

function createEventContext(runId: string): EventContext {
  return {
    runId,
    hostId: hostname()
  };
}
