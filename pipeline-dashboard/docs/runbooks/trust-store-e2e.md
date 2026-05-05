# Runbook — Trust-Store + Signed-Manifest End-to-End

**Slice TRUST-STORE-E2E-RUNBOOK (Phase 2 v2 follow-up, 2026-05-05)**

This runbook walks the operator through the three-phase signing /
install / tampering-rejection loop that v1.0.0 Blocker #2 demands
(per [`v1-blockers.md`](v1-blockers.md) §3, acceptance #1).

It is the operator playbook for the **paranoid** install path: the
release manifest must be signed with a private key whose public key
has been registered in the trust store, and the launcher must
**fail-closed** when either the signature is missing, the signing
key is unknown, or the package SHA256 doesn't match the manifest.

---

> **작업 디렉토리 / Working directory**: every command below runs
> from inside the npm package directory `pipeline-dashboard/`
> (which sits inside the git repo at `harness-pipeline-analysis/`).
> Running `git` from the parent works (git walks up to find `.git`);
> running `npm`/`node scripts/...` from the parent fails with
> `ENOENT`. **`cd` first** before every block:
>
> ```powershell
> cd C:\path\to\harness-pipeline-analysis\pipeline-dashboard
> ```

## §1 Audience and trust scope

This runbook is for two distinct operator roles:

| Role | Phase | What they do |
| --- | --- | --- |
| **Deployer / release engineer** | Phase 1 | Generates the keypair, signs the release manifest. Holds the **private key**. |
| **Installation operator** | Phase 2, 3 | Receives the released zip + manifest + trust-store update. Runs the launcher. Holds **only the public key**. |

The two roles MUST be separable in production. The private key
never leaves the deployer's signing environment. The trust store
distributed to installation operators contains only public keys.

> **공공기관 배포 주의**: 공공기관 환경에서는 두 역할의 인적 분리가
> 의무인 경우가 많습니다. 본 runbook은 그 분리를 전제로 작성됐으며,
> 한 사람이 모든 단계를 수행하는 dev/lab 시나리오에도 그대로 적용
> 가능합니다.

---

## §2 Prerequisites

| Item | Required | Phase | Notes |
| --- | :---: | :---: | --- |
| Node.js 24+ | yes | 1, 2, 3 | Both `sign-manifest.js` and the launcher require Node 24+. |
| `scripts/sign-manifest.js` reachable | yes | 1 | Verify with `node scripts/sign-manifest.js --help`. |
| Release zip + `manifest.json` template | yes | 1 | Manifest fields: `version`, `url`, `sha256`, `minNodeVersion`. See `scripts/launcher/manifest.json.example`. |
| Trust store JSON file | yes | 2, 3 | Schema `harness-release-trust/v1`. See [`../fixtures/trust-store-example.json`](../fixtures/trust-store-example.json). Path resolved by [`launcher/trust-store-path.js`](../../scripts/launcher/trust-store-path.js). |
| `harness-start.bat` (Windows) or `harness-start.sh` (Linux/macOS) | yes | 2, 3 | Bundled with the release. |
| Audit ledger writable | yes | 2, 3 | Launcher writes to `runs/system/ledger.jsonl`. Dir must be writable by the launcher user. |
| `HARNESS_REQUIRE_SIGNED_MANIFEST=1` env at install time | yes for v1.0.0 | 2, 3 | Production fail-closed posture. Without this, the launcher accepts unsigned manifests in standard mode (the old, lenient behavior). |

---

## §3 Phase 1 — Generate signed release manifest

The deployer generates a fresh keypair (or reuses the existing
deployer key), signs the release manifest, and publishes the
signed manifest plus the public key.

### §3.1 Generate keypair (one-time per deployer)

```powershell
cd C:\path\to\harness-pipeline-analysis\pipeline-dashboard
node scripts/sign-manifest.js genkey --out C:\path\to\private\keystore\
```

This emits two files in the chosen directory:

- `<keyId>-private.pem` — Ed25519 private key. **NEVER commit, never share.**
- `<keyId>-public.pem` — Ed25519 public key (DER-base64 form for the trust store).

The `keyId` is auto-generated (timestamp + short random suffix) so
fresh runs don't overwrite. Pick a stable keyId convention for your
deployer (e.g. `harness-prod-2026Q2`) and re-name the file pair if
you want a memorable identifier.

### §3.2 Sign the release manifest

```powershell
cd C:\path\to\harness-pipeline-analysis\pipeline-dashboard
node scripts/sign-manifest.js sign `
  --manifest C:\releases\v1.0.0\manifest.json `
  --private-key C:\path\to\private\keystore\harness-prod-2026Q2-private.pem `
  --key-id harness-prod-2026Q2 `
  --out C:\releases\v1.0.0\manifest.signed.json
```

The signed manifest contains the original fields plus a `signature`
object (Ed25519 over a canonical-JSON serialization of the original
manifest body). Distribute `manifest.signed.json` alongside the zip.

### §3.3 Publish trust-store update

Add the new public key to the trust store distributed to operators:

```json
{
  "schema": "harness-release-trust/v1",
  "keys": [
    {
      "keyId": "harness-prod-2026Q2",
      "label": "Harness Production Release Key (Q2 2026)",
      "publicKeyDerBase64": "<base64 of the .pub.pem DER bytes>",
      "addedAt": "2026-05-06T00:00:00.000Z",
      "addedBy": "release-engineer-jane"
    }
  ]
}
```

The fixture at [`../fixtures/trust-store-example.json`](../fixtures/trust-store-example.json)
shows the schema shape with a placeholder key. **The placeholder
value (`REPLACE_ME...`) MUST never appear in a real trust store —
the integration test enforces that anti-real-key guard.**

### §3.4 Phase 1 acceptance

Phase 1 closes when:

1. `<keyId>-private.pem` and `<keyId>-public.pem` exist in the
   deployer's keystore.
2. `manifest.signed.json` parses + the `signature.keyId` matches
   the freshly minted keypair.
3. The trust-store JSON shipped to operators contains the new public
   key entry, and the schema validator (`manifestSigner.loadTrustStore`)
   accepts it.

---

## §4 Phase 2 — Install via launcher with the gate active

The installation operator places the trust store at the resolved
path (see [`launcher/trust-store-path.js`](../../scripts/launcher/trust-store-path.js))
and runs the launcher with the production fail-closed env.

### §4.1 Position the trust store

Per [`launcher/trust-store-path.js`](../../scripts/launcher/trust-store-path.js)
the resolver walks five sources in priority order. For a default
Windows install:

```powershell
# Standard location (no env override needed):
$trustDir = "$env:APPDATA\HarnessPipeline"
mkdir $trustDir -Force | Out-Null
Copy-Item C:\releases\v1.0.0\trust-store.json "$trustDir\trust-store.json"
```

Or explicit override (portable / deployer-pinned path):

```powershell
$env:HARNESS_TRUST_STORE = "C:\path\to\custom\trust-store.json"
```

### §4.2 Invoke the launcher with production posture

```powershell
$env:HARNESS_REQUIRE_SIGNED_MANIFEST = "1"
$env:HARNESS_MANIFEST_URL = "https://releases.example.com/v1.0.0/manifest.signed.json"
.\harness-start.bat
```

### §4.3 Expected verdict — signed manifest accepted

Audit-chain anchor (in `runs/system/ledger.jsonl`):

```text
launcher_signature_verified  reason=keyId=harness-prod-2026Q2 posture=standard
```

Launcher behavior:

- SHA256 verification passes.
- Signature verification passes.
- Install proceeds; server starts; `[harness-start] server up at http://127.0.0.1:4201`.

### §4.4 Expected verdict — unsigned manifest rejected

Repeat §4.2 but point `HARNESS_MANIFEST_URL` at an **unsigned**
manifest (one without the `signature` object).

```text
launcher_signature_failed  reason=signature_missing
exit 37
```

Operator sees:

```text
[harness-start] install-version.ps1 failed - see log above.
```

### §4.5 Expected verdict — unknown keyId rejected

Sign a manifest with a key whose public key is **not** in the
trust store, then attempt install:

```text
launcher_signature_failed  reason=signature_unknown_key keyId=harness-rogue-2026Q2
exit 38
```

### §4.6 Public-sector posture (escape hatch ignored)

Set both:

```powershell
$env:HARNESS_DEPLOYMENT_PROFILE = "public-sector"
$env:HARNESS_ALLOW_UNSIGNED_MANIFEST = "1"   # dev escape — IGNORED in public-sector
.\harness-start.bat
```

Expected:

```text
[harness-start] WARNING: HARNESS_ALLOW_UNSIGNED_MANIFEST=1 is IGNORED under public-sector posture.
launcher_signature_failed  reason=signature_missing posture=public-sector
exit 37
```

The dev escape `HARNESS_ALLOW_UNSIGNED_MANIFEST=1` allows install
of unsigned manifests in **standard** mode (with `launcher_signature_bypass`
audit + LOUD warning). Public-sector posture **never** honors that
escape — that is the load-bearing safety property.

### §4.7 Phase 2 acceptance

Phase 2 closes when **all** of the following audit-chain entries
have been observed at least once in the operator's ledger:

1. `launcher_signature_verified` — signed-with-known-key install accepted
2. `launcher_signature_failed reason=signature_missing` — unsigned install rejected (exit 37)
3. `launcher_signature_failed reason=signature_unknown_key` — unknown-key install rejected (exit 38)

The committed evidence file is the deployer's exported audit
ledger excerpt covering these three rows. See §6 below.

---

## §5 Phase 3 — Tampering rejection

The installation operator simulates a man-in-the-middle attack: a
release zip whose contents have been modified after the deployer
signed the manifest.

### §5.1 Probe scenario

```powershell
# Take a known-good signed manifest pointing at the legitimate zip.
$sig = "C:\releases\v1.0.0\manifest.signed.json"
$zip = "C:\releases\v1.0.0\harness-pipeline-1.0.0.zip"

# Tamper with the zip (any bit flip suffices).
Add-Content -Path $zip -Value " "

# Attempt install.
$env:HARNESS_REQUIRE_SIGNED_MANIFEST = "1"
$env:HARNESS_MANIFEST_URL = "file:///$($sig -replace '\\', '/')"
.\harness-start.bat
```

### §5.2 Expected verdict

Audit-chain anchor:

```text
launcher_signature_failed  reason=hash_mismatch expected=<sha256-from-manifest> actual=<sha256-of-tampered-zip>
exit 37
```

Operator-facing:

```text
[harness-start] install-version.ps1 failed - see log above.
[harness-start] [KO] 서버가 10초 안에 응답하지 않았습니다.   (only if launcher continues past install)
```

(In practice the launcher exits 37 before the server-up step, so
the Korean fallback message in §4.4 of [`first-time-use.md`](first-time-use.md)
does NOT fire — the install never completes.)

### §5.3 Phase 3 acceptance

Phase 3 closes when the operator's ledger contains at least one
`launcher_signature_failed reason=hash_mismatch` row, with the
`expected` and `actual` SHA256 values both present and visibly
different.

---

## §6 Evidence collection

For each phase, the operator runs the following commands to
extract the audit-chain rows that constitute v1.0.0 Blocker #2's
acceptance #2 (the committed E2E report):

### §6.1 Filter the ledger for signature events

```powershell
Select-String -Path runs\system\ledger.jsonl `
  -Pattern '"verb":"launcher_signature_'
```

This yields the chronological list of signature events the
launcher emitted across all install attempts since the ledger
started.

### §6.2 Run the auditor-bundle exporter

For a sealed evidence packet matching the harness's other audit
exports:

```powershell
cd C:\path\to\harness-pipeline-analysis\pipeline-dashboard
node scripts/external-review-bundle.js `
  --since 2026-05-05T00:00:00Z `
  --filter launcher_signature_ `
  --out docs/reports/2026-05-05-trust-store-e2e-eval.bundle.json
```

(The flag set above is illustrative — see
[`../../scripts/external-review-bundle.js`](../../scripts/external-review-bundle.js)
`--help` for the actual argument names supported in the current
build.)

### §6.3 Write the eval report

The eval report at `docs/reports/<YYYY-MM-DD>-trust-store-e2e-eval.md`
is what closes Blocker #2 acceptance #2. Required content:

```markdown
# Trust-Store + Signed-Manifest E2E Evaluation

**Slice**: v1.0.0 Blocker #2 closure
**Operator**: <name + role>
**Date range**: <start> → <end>
**Verdict**: PASS / PASS-WITH-CONCERNS / FAIL

## Phase 1 — Sign
- Keypair: <keyId>
- Signed manifest hash: <sha256>

## Phase 2 — Install
- ✓ launcher_signature_verified observed (<timestamp>)
- ✓ launcher_signature_failed reason=signature_missing observed (<timestamp>)
- ✓ launcher_signature_failed reason=signature_unknown_key observed (<timestamp>)

## Phase 3 — Tampering rejection
- ✓ launcher_signature_failed reason=hash_mismatch observed (<timestamp>)
  - expected: <sha256>
  - actual:   <sha256>

## Sealed evidence
- bundle: docs/reports/<date>-trust-store-e2e-eval.bundle.json
- bundle sha256: <hash>

## Notes
- ...
```

---

## §7 Risks and known gaps

| Risk | Mitigation |
| --- | --- |
| Private key leakage into source control | Deployer's `.gitignore` excludes the keystore directory; trust-store-example.json fixture has the `REPLACE_ME` placeholder check enforced by integration test |
| Operator runs Phase 2 without `HARNESS_REQUIRE_SIGNED_MANIFEST=1` | The standard-mode install ACCEPTS unsigned manifests. v1.0.0 release notes MUST require this env. The deployment-readiness preflight check (Phase E1) will catch missing env in a future round. |
| Audit ledger loss between phases | Phase evidence depends on `runs/system/ledger.jsonl`. Operator must rotate / archive the ledger between phases or use `external-review-bundle.js` per phase. |
| `HARNESS_ALLOW_UNSIGNED_MANIFEST=1` left set in production | This dev-escape env is honored only in standard mode and emits LOUD warning + `launcher_signature_bypass` audit. Public-sector posture ignores it entirely (§4.6). v1.0.0 release notes MUST call this out as a production no-op. |
| Trust-store path resolver returns wrong path | Closed by integration test [`tests/integration/trust-store-path-precedence.test.js`](../../tests/integration/trust-store-path-precedence.test.js) (TRUST-STORE-PATH-IT round, 2026-05-05). |
| TRUST-STORE-0 UI absent | Formally **deferred** to post-v1.0.0 (see [`../scorecard.md`](../scorecard.md) backlog). Operators manage the trust-store JSON file directly during the v1.0.0 window. The path resolver is what makes that file-direct workflow safe. |

---

## §8 References

- [`v1-blockers.md`](v1-blockers.md) §3 — the v1.0.0 blocker this runbook unlocks.
- [`../live-evidence-schema.md`](../live-evidence-schema.md) §5 — audit-chain anchor verbs (cross-cutting).
- [`../fixtures/trust-store-example.json`](../fixtures/trust-store-example.json) — sample trust-store with the placeholder key.
- [`../../scripts/sign-manifest.js`](../../scripts/sign-manifest.js) — Ed25519 signing tool.
- [`../../scripts/launcher/launcher-cli.js`](../../scripts/launcher/launcher-cli.js) — launcher bridge (verify-manifest-signature, resolve-trust-store-path).
- [`../../scripts/launcher/install-version.ps1`](../../scripts/launcher/install-version.ps1) — production fail-closed gate (Windows).
- [`../../scripts/launcher/install-version.sh`](../../scripts/launcher/install-version.sh) — production fail-closed gate (POSIX).
- [`../../scripts/launcher/trust-store-path.js`](../../scripts/launcher/trust-store-path.js) — shared path resolver.
- [`../../tests/integration/trust-store-path-precedence.test.js`](../../tests/integration/trust-store-path-precedence.test.js) — full 5-step precedence chain test (TRUST-STORE-PATH-IT).
- [`deployment-readiness.md`](deployment-readiness.md) — preflight runbook.
- [`first-time-use.md`](first-time-use.md) — non-technical end-user onboarding.
