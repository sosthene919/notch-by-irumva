import type { ActivityProvider } from '../core/activityManager';
import type { Activity, BtDevice } from '../core/types';
import { onBluetoothDevices } from '../platform/native';

export interface BluetoothSource {
  subscribe(cb: (devices: BtDevice[]) => void): Promise<() => void> | (() => void);
}

export const nativeBluetoothSource: BluetoothSource = {
  subscribe: (cb) => onBluetoothDevices(cb),
};

interface DeviceMemory {
  battery: number | null;
  alerted20: boolean;
  alerted10: boolean;
}

/**
 * Decides which Bluetooth changes deserve an activity. Pure and
 * testable: connect and low-battery are alerts; disconnect is a quiet
 * compact-only notice. Low battery fires once per discharge at 20%
 * and again at 10%; the flags re-arm when the battery recovers.
 */
export class BluetoothAlerter {
  private prev = new Map<string, DeviceMemory>();
  private seeded = false;

  next(devices: BtDevice[], now = Date.now()): Activity[] {
    const out: Activity[] = [];
    const current = new Map<string, DeviceMemory>();
    for (const d of devices) {
      if (!d.connected) continue;
      const before = this.prev.get(d.id);
      const mem: DeviceMemory = {
        battery: d.battery,
        alerted20: before?.alerted20 ?? false,
        alerted10: before?.alerted10 ?? false,
      };
      if (d.battery !== null && d.battery > 25) { mem.alerted20 = false; mem.alerted10 = false; }
      if (this.seeded) {
        if (!before) {
          out.push({
            id: `bt-connect-${d.id}`, providerId: 'bluetooth', kind: 'device-connected',
            title: d.name, subtitle: 'Connected', priority: 88, startedAt: now, expiresAt: now + 12_000,
            data: { deviceId: d.id, deviceKind: d.kind, app: d.name, ...(d.battery !== null ? { battery: d.battery } : {}) },
          });
        } else if (d.battery !== null) {
          if (d.battery <= 10 && !mem.alerted10) {
            mem.alerted10 = true; mem.alerted20 = true;
            out.push(this.lowBattery(d, now));
          } else if (d.battery <= 20 && !mem.alerted20) {
            mem.alerted20 = true;
            out.push(this.lowBattery(d, now));
          }
        }
      }
      current.set(d.id, mem);
    }
    if (this.seeded) {
      for (const [id, mem] of this.prev) {
        if (!current.has(id)) {
          out.push({
            id: `bt-disconnect-${id}-${now}`, providerId: 'bluetooth', kind: 'device-disconnected',
            title: 'Device disconnected', subtitle: '', priority: 35, startedAt: now, expiresAt: now + 8_000,
            data: { deviceId: id, battery: mem.battery ?? -1 },
          });
        }
      }
    }
    this.prev = current;
    this.seeded = true;
    return out;
  }

  private lowBattery(d: BtDevice, now: number): Activity {
    return {
      id: `bt-low-${d.id}-${d.battery}`, providerId: 'bluetooth', kind: 'device-low-battery',
      title: `${d.name} battery low`, subtitle: `${d.battery}% remaining`, priority: 88,
      startedAt: now, expiresAt: now + 30_000,
      data: { deviceId: d.id, deviceKind: d.kind, app: d.name, battery: d.battery ?? -1 },
    };
  }
}

/**
 * Connected Bluetooth devices from the Rust watch (Enumeration + GATT
 * battery). The device list itself is forwarded to the hub's Devices
 * page; only changes become activities.
 */
export function createBluetoothProvider(
  onDevices: (devices: BtDevice[]) => void,
  source: BluetoothSource = nativeBluetoothSource,
) {
  let unlisten: (() => void) | null = null;
  const alerter = new BluetoothAlerter();
  const provider: ActivityProvider = {
    id: 'bluetooth',
    description: 'Shows Bluetooth devices as they connect, with battery level when the device reports it (BLE battery service). No pairing happens here.',
    async start(publish) {
      try {
        unlisten = await source.subscribe((devices) => {
          onDevices(devices);
          for (const a of alerter.next(devices)) publish(a);
        });
      } catch { /* watch unavailable; provider stays silent */ }
    },
    stop() { unlisten?.(); unlisten = null; },
  };
  return provider;
}
