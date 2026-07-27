export type BluetoothView = 'overview' | 'map' | 'devices' | 'log' | 'history' | 'findings';

export const BLUETOOTH_TABS: ReadonlyArray<{ key: BluetoothView; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'map', label: 'Map' },
  { key: 'devices', label: 'Devices' },
  // Two different questions: "what happened, in order" and "what does the
  // aggregate look like". The second was the only one with a tab, and it was
  // labelled Analytics, so there was no way to reach a plain history at all.
  { key: 'log', label: 'History' },
  { key: 'history', label: 'Analytics' },
  { key: 'findings', label: 'Findings' }
];
