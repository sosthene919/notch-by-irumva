# Updates and signing

Current state (honest): builds are **unsigned**. There is no Authenticode certificate and no update host yet, so Phase 6 ships the *groundwork*, not a live updater:

- Version lives in `app/src-tauri/tauri.conf.json` and `app/package.json` (keep in sync; the NSIS filename derives from it).
- Every CI build uploads the NSIS installer + `sbom.json` (see `.github/workflows/ci.yml`).
- Credits/copyright are in the executable version metadata (verified Phase 1).

To go live, in order:
1. Obtain an Authenticode code-signing certificate (OV/EV) for IRUMVA.
2. Sign in CI: set `TAURI_SIGNING_*`/certificate thumbprint in `tauri.conf.json` (`bundle.windows.certificateThumbprint`, `timestampUrl` per Tauri's Windows installer docs) using GitHub Actions secrets; timestamp every signature.
3. SmartScreen: EV certs get immediate reputation; OV builds reputation over downloads. Document the first-run SmartScreen prompt in the README until reputation builds.
4. Updater: enable Tauri's updater with a minisign keypair (`tauri signer generate`), publish `latest.json` + signed artifacts over HTTPS only, and verify signature + rollback (keep the previous installer available). The updater endpoints/keys must never be committed in plaintext beyond the public key.
5. Vulnerability disclosure: `SECURITY.md` at release (Phase 6 docs); report address monitored by the maintainer.

Until step 1 exists, releases are manual: build in CI, download the artifact, install over the previous version (NSIS per-user upgrades in place; the Phase 1 uninstall/registry checks still apply).
