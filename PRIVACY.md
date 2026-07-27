# Privacy model

RadioChron Desktop is local-first and has no background analytics or telemetry.

## Data read locally

Depending on the action selected, the app can read:

- Wi-Fi interface state, SSID, BSSID, signal, channel, and security metadata;
- local IP configuration, gateway, DNS, and neighbor-cache entries;
- Windows WLAN AutoConfig events when running on Windows;
- nearby Bluetooth Low Energy advertisements after an explicit scan;
- Windows-known Bluetooth device names, paired/connected state, transport, and
  device type after an explicit scan;
- saved Wi-Fi profile details, including a password only after an explicit reveal action;
- host and adapter identity when the experimental scan-identity panel is used.

Installed builds keep state in Electron's per-user application-data directory.
Bluetooth analytics store privacy-minimized opaque identity keys, system IDs,
names, paired/connected state, transport/type, RSSI
evidence, address type, assigned Company IDs, advertised service UUIDs,
connectable/Tx-power flags, zones, and scan timestamps for at most 30 days or
512 scans. The analytics archive does not store raw Bluetooth addresses, raw
Windows device IDs, or raw
manufacturer/service payload bytes. `Reset history` removes the archive and
resets the in-process detector.
Source development may also use `data/`; that directory is excluded from Git
and must be treated as sensitive.

## Retention

Nothing collected is kept indefinitely by default. Observations record which
access points and Bluetooth devices were within range, when, and how strongly —
evidence that is useful for diagnosis and, kept long enough, also a record of
who was nearby. **Settings → Data retention** controls two windows:

- **Individual sightings** — observations, collector events, identity alerts and
  vulnerability scans. Default 30 days. This is the bulk of the database.
- **The device list** — how long a device stays listed after it was last seen.
  Default 90 days, deliberately longer: that something has been a fixture here
  for months is worth keeping after the sightings that proved it are gone.

Expired records are deleted at startup and once a day while the application
runs, and the database is rebuilt afterwards so the disk space is actually
returned rather than merely marked free. The same screen deletes on demand and
reports what is currently stored.

Either window may be set to zero, which keeps that category indefinitely. That
is a deliberate choice an operator has to type: a damaged or unreadable settings
file falls back to the defaults above rather than to "keep everything".

## Network activity

- Baseline collection uses native RadioChron collectors. Windows uses the WLAN
  API; macOS uses CoreWLAN and requires Location Services for SSID/BSSID access.
- Bluetooth scans use WinRT on Windows and CoreBluetooth on macOS, only when
  requested by the operator. Windows also reads the local DeviceInformation
  inventory; no Bluetooth inventory is sent to a server.
- The documentation screenshot mode uses synthetic fixtures and does not query
  the host radio, addresses, neighbor cache, profile secrets or computer name.
- The internet reachability check contacts Cloudflare only after the operator requests it.
- Poll and active LAN profiles send traffic to the local network and are visibly labelled before use.
- Optional Codex or Claude review passes selected evidence to the configured external CLI provider. The provider's own privacy policy then applies.

## Credentials

Saved Wi-Fi passwords are requested from Windows only on demand, displayed in renderer memory, and are not intentionally persisted by the application. Do not include revealed credentials in screenshots, exports, logs, or issue reports.

## Sharing diagnostics

Before sharing a report or diagnostics bundle, redact SSIDs, BSSIDs, MAC addresses, IP addresses, hostnames, usernames, absolute paths, and any saved credential material.
