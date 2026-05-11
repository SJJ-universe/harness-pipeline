# Operator Guide — orchestrator-start launcher (Phase E1, D0)

> **Trust scope (Phase E plan §O-D0):** the launcher in this slice is for
> **internal / private distribution only**. SHA256 trust-on-first-use proves
> the bytes match the manifest, but it does not prove the manifest itself is
> authentic. Public-distribution safety (manifest signing, GitHub Release
> asset attestation) arrives in Phase E3 Release Hygiene. **Until then, only
> run release zips received through a trusted internal channel.**

This guide tells an operator how to launch the dashboard from a packaged
release — double-clicking `orchestrator-start.bat` on Windows, or running
`./orchestrator-start.sh` on macOS / Linux.

For developers running from a checked-out repo, the same launcher works in
"dev mode" (it auto-detects `server.js` next to itself).

---

## 1. What the launcher does

```
operator opens orchestrator-start.bat (or .sh)
   │
   ├── 1. Detects Node.js on PATH (errors if absent)
   │
   ├── 2. Picks a mode:
   │     ─ dev mode      : server.js exists alongside → launch directly
   │     ─ installer mode : server.js absent + ORCHESTRATOR_MANIFEST_URL set
   │                       → fetch manifest → SHA256-verify zip → extract
   │
   ├── 3. (installer only) Validates the runtime against minNodeVersion
   │
   ├── 4. Health-checks an existing instance on port 4201
   │     ─ already running → opens browser, exits
   │
   ├── 5. Launches `node start.js` in the background
   │     ─ supervisor forks server.js with restart support
   │
   ├── 6. Polls /api/health for ≤10s, 1s ticks
   │
   └── 7. Opens default browser at http://127.0.0.1:4201
         (skipped when ORCHESTRATOR_NO_BROWSER=1)
```

The supervisor stays running after the launcher exits. To stop the server,
use the dashboard's "Restart / Shutdown" controls or `taskkill /im node.exe`
(Windows) / `kill <pid>` (macOS/Linux).

---

## 2. First-run scenarios

### Scenario A — operator unzips a full release locally

```
orchestrator-pipeline-1.1.0/
├── orchestrator-start.bat        ← double-click this
├── orchestrator-start.sh
├── server.js
├── start.js
├── node_modules/            (~70 MB; pre-installed)
├── public/
├── src/
├── scripts/
│   └── launcher/
│       ├── launcher-cli.js
│       ├── install-version.ps1
│       ├── install-version.sh
│       ├── check-update.ps1
│       └── check-update.sh
└── manifest.json            (matches the release zip; future-facing)
```

The launcher detects `server.js` next to itself → dev mode → no download,
just launch.

### Scenario B — operator has only the launcher (bootstrap stub)

Set the manifest URL once (per-machine env var or alongside the .bat /
.sh as a wrapper script), then double-click:

```powershell
# Windows (PowerShell)
$env:ORCHESTRATOR_MANIFEST_URL = 'https://example.internal/manifest.json'
.\orchestrator-start.bat
```

```bash
# macOS / Linux
export ORCHESTRATOR_MANIFEST_URL='https://example.internal/manifest.json'
./orchestrator-start.sh
```

The launcher delegates to `install-version.ps1` / `install-version.sh`,
which:

1. Downloads `manifest.json`
2. Validates schema via `node launcher-cli.js validate-manifest`
3. Downloads the release zip from the manifest's `url` field
4. Verifies SHA256 against the manifest's `sha256` field (constant-time)
5. **On mismatch:** moves the zip to `quarantine-<v>-<timestamp>.zip` for
   forensics and aborts with exit code 34
6. Extracts to `<DataDir>/versions/<version>/`
7. Writes `<DataDir>/last-install.txt` so the launcher knows where to `cd`

---

## 3. Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `ORCHESTRATOR_DATA_DIR` | Override the data directory (versions, logs, runs). Set this to `D:\orchestrator-portable` to install onto a USB stick. | Win: `%LOCALAPPDATA%\HarnessPipeline` · macOS: `~/Library/Application Support/HarnessPipeline` · Linux: `~/.local/share/HarnessPipeline` |
| `ORCHESTRATOR_CONFIG_DIR` | Override the config directory (profiles.json — Phase E1 D1+). | Win: `%APPDATA%\HarnessPipeline\config` · macOS: `~/Library/Application Support/HarnessPipeline/config` · Linux: `~/.config/HarnessPipeline` |
| `ORCHESTRATOR_MANIFEST_URL` | Manifest URL for installer-mode bootstrap. **Required when `server.js` is absent.** Must use `https://` unless `ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL=1` is also set. | (unset) |
| `ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL` | Set to `1` to permit `http://`, `file://`, etc. for the manifest URL. **Dev/test only — never enable in production.** Loud stderr warning each time. | (unset → https only) |
| `ORCHESTRATOR_PORT` | Dashboard port. | `4201` |
| `ORCHESTRATOR_HOST` | Dashboard bind address. | `127.0.0.1` |
| `ORCHESTRATOR_NO_BROWSER` | Set to `1` to skip browser auto-open (CI / headless). | (unset → opens browser) |

### Portable mode (USB stick)

On Windows:

```powershell
$env:ORCHESTRATOR_DATA_DIR = 'D:\orchestrator-portable'
.\orchestrator-start.bat
```

The dashboard's logs / runs / installed versions all live under
`D:\orchestrator-portable\`. Move the USB stick to another machine with the
same Node.js and the orchestrator keeps working.

---

## 4. check-update — manifest polling without auto-update

By design, the launcher does **not** auto-update — supply-chain risk is
too high to take fully unattended. Operators run `check-update` either
interactively or via a scheduled task to surface "new version available"
notifications.

```powershell
# Windows
.\scripts\launcher\check-update.ps1 -ManifestUrl 'https://example.internal/manifest.json'
.\scripts\launcher\check-update.ps1 -ManifestUrl '...' -Json   # for scripts
```

```bash
# macOS / Linux
./scripts/launcher/check-update.sh --manifest-url 'https://example.internal/manifest.json'
./scripts/launcher/check-update.sh --manifest-url '...' --json
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Up to date |
| `1` | Update available — run `install-version` to upgrade |
| `2` | Error (manifest fetch / parse / semver compare) |

When an update is available, run `install-version` manually (same
arguments as `check-update`).

---

## 5. Manifest format

The manifest is a tiny JSON document (typically <1 KB) that pins exactly
which release zip belongs to which version:

```json
{
  "version": "1.1.0",
  "publishedAt": "2026-05-15T09:00:00Z",
  "url": "https://example.internal/releases/orchestrator-pipeline-1.1.0.zip",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "minNodeVersion": "24.0.0"
}
```

All five fields are required. Schema rules (enforced by
`validateManifestSchema` in `src/runtime/launcherManifest.js`):

- `version` — semver-ish (`MAJOR.MINOR.PATCH` with optional `-prerelease`
  / `+build`). Used as the install directory name, so path-traversal
  characters (`/`, `\`, `..`) are rejected.
- `url` — must use `https://`. Plain `http://` is blocked to prevent
  in-transit tampering.
- `sha256` — exactly 64 lowercase hex chars. Mixed case rejected (so the
  comparison stays trivial).
- `publishedAt` — ISO 8601 timestamp. Parseability is checked, not range.
- `minNodeVersion` — semver. The launcher refuses to start on older
  runtimes.

A reference manifest lives at `scripts/launcher/manifest.json.example`.

---

## 6. Troubleshooting

### "Node.js not found on PATH"

Install Node.js 24+ from <https://nodejs.org/>. The launcher refuses to
guess at install paths.

### "SHA256 mismatch — moved to quarantine-…"

Treat as a security signal:

1. The release zip's bytes do not match the manifest's `sha256`.
2. The launcher moved the zip to `<DataDir>/quarantine-<v>-<ts>.zip` for
   inspection.
3. Re-download the zip and the manifest **separately** (not via the same
   compromised channel) and compare. If both still mismatch, the
   manifest URL itself may have been tampered with.

### "ORCHESTRATOR_MANIFEST_URL not set — cannot fetch"

The launcher is in installer mode (no `server.js` next to it) but no
manifest URL is configured. Either:

1. Re-run from a directory containing `server.js` (the dev/full-zip
   case), **or**
2. Set `ORCHESTRATOR_MANIFEST_URL=<https url>` and re-run.

### "Server did not respond within 10s"

The supervisor (`node start.js`) launched but the launcher's
`verify-health` check never saw a response identifying as
`HarnessPipeline`. Check `<INSTALL_DIR>/launcher.log` (macOS / Linux) or
the PowerShell window output (Windows) for the underlying error.

Common causes:

- Port `4201` already taken **by an unrelated service** → the launcher
  intentionally refuses to declare success unless the response carries
  `"app": "HarnessPipeline"` (Phase E1 D0-e port-squat defense). Either
  free the port or set `ORCHESTRATOR_PORT=<other>` and retry.
- Port `4201` already taken **by another HarnessPipeline instance** →
  the launcher correctly detects this via `verify-health` and opens
  the browser instead of starting a second server.
- Antivirus blocking node binary → whitelist `node.exe` and retry.
- Corrupted `node_modules/` → re-run installer with `-Force` (PowerShell)
  or `--force` (bash) to re-extract.

### "$InstallDir exists but missing .install-complete sentinel"

A previous install attempt was interrupted (power loss, Ctrl-C during
extract, antivirus quarantine mid-zip). The launcher's atomic-install
logic detects this on the next run and removes the partial directory
before retrying. No operator action is required — the message is
informational so you can correlate with whatever caused the original
interruption.

If the sentinel is missing despite a clean prior install, the install
directory may have been tampered with. Treat the same way as a SHA256
mismatch: don't override; investigate the chain of custody.

### Windows SmartScreen banner ("Microsoft Defender SmartScreen prevented…")

First-run behavior with unsigned executables. Click **More info → Run
anyway** to proceed. Code-signing certificates are tracked in Phase F+.

---

## 7. Trust scope reminder (read this before public distribution)

Every version of this guide must end with the same disclaimer because the
trust scope changes between Phase E1 (now) and Phase E3 Release Hygiene:

- **Today (Phase E1):** SHA256 trust-on-first-use only. Authenticity
  comes from the trusted distribution channel through which the
  operator received `orchestrator-start.bat`/`.sh`.
- **Phase E3 (planned):** manifest signing — either GPG or
  Sigstore/cosign-style keyless, decided in the Phase E3 RFC. After
  E3 lands, the launcher will refuse to extract zips whose manifest
  signature does not verify against a pinned public key.

If you are distributing the launcher beyond a trusted internal team,
**wait for Phase E3** or provide signed equivalents out-of-band.
