/**
 * Settings + secrets storage (brief section 7).
 * - Settings JSON is encrypted at rest by Rust with DPAPI
 *   (CryptProtectData, current-user scope) — plaintext never touches disk.
 * - Secrets (tokens/keys) go only to Windows Credential Manager via Rust
 *   (CredWriteW/CredReadW). They are never written into settings.
 * Outside Tauri (tests/browser) an in-memory fake bridge is used and
 * nothing persists.
 */
export interface SecureBridge {
  settingsLoad(): Promise<string | null>;
  settingsSave(plaintextJson: string): Promise<boolean>;
  secretSet(key: string, value: string): Promise<boolean>;
  secretGet(key: string): Promise<string | null>;
  secretDelete(key: string): Promise<boolean>;
  dataExport(): Promise<string | null>;
  dataErase(): Promise<boolean>;
}

export function memoryBridge(): SecureBridge & { stored: () => string | null } {
  let settings: string | null = null;
  const secrets = new Map<string, string>();
  return {
    stored: () => settings,
    settingsLoad: async () => settings,
    settingsSave: async (s) => { settings = s; return true; },
    secretSet: async (k, v) => { secrets.set(k, v); return true; },
    secretGet: async (k) => secrets.get(k) ?? null,
    secretDelete: async (k) => secrets.delete(k),
    dataExport: async () => settings,
    dataErase: async () => { settings = null; secrets.clear(); return true; },
  };
}

export class SecureSettings<T extends Record<string, unknown>> {
  constructor(private bridge: SecureBridge, private defaults: T) {}

  async load(): Promise<T> {
    const raw = await this.bridge.settingsLoad().catch(() => null);
    if (!raw) return { ...this.defaults };
    try { return { ...this.defaults, ...(JSON.parse(raw) as T) }; }
    catch { return { ...this.defaults }; }
  }

  async save(value: T): Promise<boolean> {
    // Refuse to persist anything that looks like a secret in settings.
    for (const key of Object.keys(value)) {
      if (/secret|token|password|api[-_]?key/i.test(key)) {
        throw new Error(`Refusing to store "${key}" in settings — use Credential Manager secrets instead.`);
      }
    }
    return this.bridge.settingsSave(JSON.stringify(value));
  }

  setSecret(key: string, value: string) { return this.bridge.secretSet(key, value); }
  getSecret(key: string) { return this.bridge.secretGet(key); }
  deleteSecret(key: string) { return this.bridge.secretDelete(key); }
}
