//! Bluetooth device watch: connected devices with battery rings.
//!
//! Mechanism (Microsoft Learn): paired-device enumeration via
//! `BluetoothDevice::GetDeviceSelector` / `BluetoothLEDevice::
//! GetDeviceSelector`, connection state from the device objects, and
//! battery for BLE from the standard GATT Battery Service
//! (0x180F, characteristic 0x2A19). Classic Bluetooth exposes no
//! standard battery API, so those devices report `battery: None` and
//! the UI shows the card without a ring. Nothing is faked.
//!
//! A background thread re-scans every 20 s and emits the full list only
//! when it changes. Connect, low-battery and disconnect *alerts* are
//! decided in the frontend provider, which owns the per-discharge
//! alert memory.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BtDevice {
    id: String,
    name: String,
    kind: String,
    battery: Option<i32>,
    connected: bool,
}

/// GATT battery level is a byte, but the spec range is 0-100 and some
/// devices answer 127 (unknown) or garbage. Out-of-range means the
/// device does not report battery; the card renders without a ring.
pub fn valid_battery(byte: u8) -> Option<i32> {
    if byte <= 100 { Some(byte as i32) } else { None }
}

/// The same physical device can enumerate twice (classic + BLE) under
/// different ids. Keep one card per name, preferring the entry that
/// reports a battery.
pub fn dedupe_devices(devices: Vec<BtDevice>) -> Vec<BtDevice> {
    let mut out: Vec<BtDevice> = Vec::new();
    for d in devices {
        if let Some(existing) = out.iter_mut().find(|e| e.name.eq_ignore_ascii_case(&d.name)) {
            if existing.battery.is_none() && d.battery.is_some() {
                *existing = d;
            }
            continue;
        }
        out.push(d);
    }
    out
}

fn kind_from_name(name: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    if n.contains("buds") || n.contains("pods") || n.contains("earbud") { return Some("earbuds"); }
    if n.contains("headphone") { return Some("headphones"); }
    if n.contains("headset") { return Some("earbuds"); }
    if n.contains("mouse") { return Some("mouse"); }
    if n.contains("keyboard") || n.contains("keys") { return Some("keyboard"); }
    if n.contains("speaker") || n.contains("soundbar") || n.contains("boom") { return Some("speaker"); }
    None
}

#[cfg(windows)]
mod imp {
    use super::BtDevice;
    use windows::core::HSTRING;
    use windows::Devices::Bluetooth::GenericAttributeProfile::{GattCharacteristicUuids, GattCommunicationStatus, GattServiceUuids};
    use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice};
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Storage::Streams::DataReader;

    pub async fn scan() -> Vec<BtDevice> {
        let mut out: Vec<BtDevice> = Vec::new();

        // Classic Bluetooth (paired devices).
        if let Ok(selector) = BluetoothDevice::GetDeviceSelector() {
            if let Ok(op) = DeviceInformation::FindAllAsyncAqsFilter(&selector) {
                if let Ok(infos) = op.await {
                    let count = infos.Size().unwrap_or(0);
                    for i in 0..count {
                        let Ok(info) = infos.GetAt(i) else { continue };
                        let Ok(id) = info.Id() else { continue };
                        let Ok(op) = BluetoothDevice::FromIdAsync(&id) else { continue };
                        let Ok(Some(dev)) = op.await.map(Some) else { continue };
                        let connected = dev.ConnectionStatus().map(|s| s == BluetoothConnectionStatus::Connected).unwrap_or(false);
                        if !connected { continue; }
                        let name = dev.Name().map(|s| s.to_string())
                            .ok()
                            .filter(|s| !s.is_empty())
                            .or_else(|| info.Name().map(|s| s.to_string()).ok())
                            .unwrap_or_else(|| "Bluetooth device".into());
                        let class_kind = dev.ClassOfDevice()
                            .and_then(|c| c.MajorClass())
                            .map(|d| format!("{d:?}"))
                            .unwrap_or_default();
                        let kind = super::kind_from_name(&name)
                            .or_else(|| {
                                if class_kind.contains("AudioVideo") { Some("headphones") }
                                else { None }
                            })
                            .unwrap_or("other");
                        out.push(BtDevice { id: id.to_string(), name, kind: kind.into(), battery: None, connected: true });
                    }
                }
            }
        }

        // BLE devices with GATT battery where offered.
        if let Ok(selector) = BluetoothLEDevice::GetDeviceSelector() {
            if let Ok(op) = DeviceInformation::FindAllAsyncAqsFilter(&selector) {
                if let Ok(infos) = op.await {
                    let count = infos.Size().unwrap_or(0);
                    for i in 0..count {
                        let Ok(info) = infos.GetAt(i) else { continue };
                        let Ok(id) = info.Id() else { continue };
                        let id_str = id.to_string();
                        if out.iter().any(|d| d.id == id_str) { continue; }
                        let Ok(op) = BluetoothLEDevice::FromIdAsync(&id) else { continue };
                        let Ok(Some(dev)) = op.await.map(Some) else { continue };
                        let connected = dev.ConnectionStatus().map(|s| s == BluetoothConnectionStatus::Connected).unwrap_or(false);
                        if !connected { continue; }
                        let name = dev.Name().map(|s| s.to_string())
                            .ok()
                            .filter(|s| !s.is_empty())
                            .or_else(|| info.Name().map(|s| s.to_string()).ok())
                            .unwrap_or_else(|| "Bluetooth device".into());
                        let appearance_kind = dev.Appearance()
                            .and_then(|a| a.Category())
                            .map(|cat| match cat {
                                961 => Some("keyboard"),
                                962 => Some("mouse"),
                                2369 | 2370 => Some("headphones"),
                                _ => None,
                            })
                            .ok()
                            .flatten();
                        let kind = super::kind_from_name(&name).or(appearance_kind).unwrap_or("other");
                        let battery = le_battery(&dev).await;
                        out.push(BtDevice { id: id_str, name, kind: kind.into(), battery, connected: true });
                    }
                }
            }
        }
        super::dedupe_devices(out)
    }

    async fn le_battery(dev: &BluetoothLEDevice) -> Option<i32> {
        let uuid = GattServiceUuids::Battery().ok()?;
        let res = dev.GetGattServicesForUuidAsync(uuid).ok()?.await.ok()?;
        if res.Status().ok()? != GattCommunicationStatus::Success { return None; }
        let services = res.Services().ok()?;
        if services.Size().ok()? == 0 { return None; }
        let svc = services.GetAt(0).ok()?;
        let char_uuid = GattCharacteristicUuids::BatteryLevel().ok()?;
        let cres = svc.GetCharacteristicsForUuidAsync(char_uuid).ok()?.await.ok()?;
        if cres.Status().ok()? != GattCommunicationStatus::Success { return None; }
        let chars = cres.Characteristics().ok()?;
        if chars.Size().ok()? == 0 { return None; }
        let chr = chars.GetAt(0).ok()?;
        let val = chr.ReadValueAsync().ok()?.await.ok()?;
        if val.Status().ok()? != GattCommunicationStatus::Success { return None; }
        let buf = val.Value().ok()?;
        let reader = DataReader::FromBuffer(&buf).ok()?;
        if reader.UnconsumedBufferLength().ok()? == 0 { return None; }
        super::valid_battery(reader.ReadByte().ok()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev(id: &str, name: &str, battery: Option<i32>) -> BtDevice {
        BtDevice { id: id.into(), name: name.into(), kind: "earbuds".into(), battery, connected: true }
    }

    #[test]
    fn battery_bytes_outside_0_100_mean_unreported() {
        assert_eq!(valid_battery(0), Some(0));
        assert_eq!(valid_battery(100), Some(100));
        assert_eq!(valid_battery(127), None);
        assert_eq!(valid_battery(255), None);
    }

    #[test]
    fn dual_mode_device_keeps_one_card_preferring_battery() {
        let out = dedupe_devices(vec![
            dev("classic-1", "My Pods", None),
            dev("le-9", "my pods", Some(64)),
            dev("le-2", "Keyboard K380", None),
        ]);
        assert_eq!(out.len(), 2);
        let pods = out.iter().find(|d| d.name.eq_ignore_ascii_case("my pods")).unwrap();
        assert_eq!(pods.battery, Some(64));
        assert_eq!(pods.id, "le-9");
    }

    #[test]
    fn kind_comes_from_the_name_when_it_can() {
        assert_eq!(kind_from_name("AirPods Pro"), Some("earbuds"));
        assert_eq!(kind_from_name("WH-1000XM5 Headphones"), Some("headphones"));
        assert_eq!(kind_from_name("MX Master Mouse"), Some("mouse"));
        assert_eq!(kind_from_name("Generic BLE thing"), None);
    }
}

pub fn start_bluetooth_watch(app: AppHandle) {
    #[cfg(windows)]
    std::thread::spawn(move || {
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            );
        }
        let mut last_json = String::new();
        loop {
            let devices = tauri::async_runtime::block_on(imp::scan());
            let json = serde_json::to_string(&devices).unwrap_or_default();
            if json != last_json {
                last_json = json;
                let _ = app.emit("notch://bluetooth-devices", devices);
            }
            std::thread::sleep(std::time::Duration::from_secs(20));
        }
    });
    #[cfg(not(windows))]
    let _ = app;
}
