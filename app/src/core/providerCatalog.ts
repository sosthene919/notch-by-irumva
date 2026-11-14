/**
 * Provider catalogue for the Settings window. The settings popup runs
 * in its own window where no providers are started, so it cannot ask
 * the ActivityManager who exists; this static list mirrors the
 * providers registered in App.tsx (same ids, same plain-language
 * descriptions). Enabled state always comes from saved prefs.
 */
export interface ProviderInfo { id: string; description: string }

export const PROVIDER_CATALOG: ProviderInfo[] = [
  { id: 'timers', description: 'Timers, stopwatch and alarms created inside Notch. Reads nothing from the system.' },
  { id: 'notifications', description: 'Pops the island open briefly for Notch alerts: timer finished, low or full battery, microphone/camera/location in use. Alerts are generated on this PC only.' },
  { id: 'reminders', description: 'Reminders from your to-do list and water goal, created inside Notch.' },
  { id: 'now-playing', description: 'Reads the current media session (Spotify, browsers, VLC and others) through Windows media controls. Can pause, play and skip.' },
  { id: 'battery', description: 'Reads battery percentage and charging state from Windows power status.' },
  { id: 'volume', description: 'Shows volume and mute changes for the default speakers, and lets you change them from the island.' },
  { id: 'privacy', description: 'Shows which app is using your microphone, camera or location, from Windows privacy records. Read-only.' },
  { id: 'windows-notifications', description: 'Mirrors Windows app notifications (WhatsApp, Chrome, Mail and others) from the notification center on this PC. Shown briefly in the notch; hidden on the lock screen.' },
  { id: 'bluetooth', description: 'Shows Bluetooth devices as they connect, with battery level when the device reports it (BLE battery service). No pairing happens here.' },
];
