# Trust-Store + Signed-Manifest E2E Evaluation

**Slice**: v1.0.0 Blocker #2 closure (acceptance #2)
**Operator**: Claude (Sonnet 4.5, Anthropic agent)
**Date**: 2026-05-05
**Verdict**: **PASS**

This report closes acceptance criterion #2 of v1.0.0 Blocker #2 per
[`../runbooks/v1-blockers.md`](../runbooks/v1-blockers.md) §3.3.

The 3-phase Phase 1 (sign) → Phase 2 (install with gate active) →
Phase 3 (tampering rejection) loop from
[`../runbooks/trust-store-e2e.md`](../runbooks/trust-store-e2e.md)
was executed end-to-end with all four expected audit-chain anchors
captured against a real Windows PowerShell `install-version.ps1`
invocation.

---

## §1 Phase 1 — Sign

### §1.1 Keypair generation

```text
$ node scripts/sign-manifest.js genkey
generated keypair
  alg:         Ed25519
  keyId:       7c4955dc96f3a691
  private:     private.pem
  trust frag:  public.json
  archive:     keypair.json
```

Files produced (in `<tmp>/keystore/`):
- `private.pem` — 119 bytes, Ed25519 PKCS8
- `public.json` — 268 bytes, schema `harness-release-trust/v1`, single key entry with `keyId=7c4955dc96f3a691`
- `keypair.json` — combined archive

### §1.2 Manifest body

```json
{
  "version": "1.0.0-e2e",
  "publishedAt": "2026-05-05T12:35:00.000Z",
  "url": "file:///C:/Users/SJ/AppData/Local/Temp/harness-e2e-28EKFg/release.zip",
  "sha256": "16e69fe2cd15a719c0066c9812c16cfa5a5bef02d7c6896221e210cfb43e871f",
  "minNodeVersion": "24.0.0",
  "publicSectorOnly": false
}
```

The `release.zip` is a 10 KB synthetic test bundle (`README-release.txt`
+ `package.json`). The `file://` URL is dev-only; production deployers
use `https://`. `ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL=1` was set for the
duration of this E2E test (loud warning was emitted at fetch time).

### §1.3 Signing

```text
$ node scripts/sign-manifest.js sign \
    --manifest manifest.json \
    --private-key keystore/private.pem \
    --key-id 7c4955dc96f3a691 \
    --out manifest.signed.json
signed manifest
  alg:    Ed25519
  keyId:  7c4955dc96f3a691
  out:    manifest.signed.json
```

Signature object embedded in `manifest.signed.json`:

```json
"signature": {
  "alg": "Ed25519",
  "keyId": "7c4955dc96f3a691",
  "value": "axZCmSyFuUyVbtaSieWF7nwYk4E+6kDBP0ZI2sacQ4yl7xL2GlmiN1rZQdNtAeycSy5QyObr4wKJt+y1XhYlBg==",
  "coverage": [...]
}
```

### §1.4 Phase 1 verdict: **PASS**

Keypair generated, manifest signed with the deployer's private key,
public key fragment is the trust-store entry shipped to operators.

---

## §2 Phase 2 — Install via launcher with gate active

Each scenario was run via `install-version.ps1` (the production
fail-closed gate at Windows-PowerShell layer, not the underlying
`launcher-cli verify-manifest-signature` Node helper). Audit anchors
are emitted via `Write-AuditLine` and visible on stderr (also
captured to the audit ledger).

### §2.1 Scenario A — Signed manifest + known key (positive case)

```text
[validate-manifest-url] WARNING: accepting non-https URL ... ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL=1
[install-version] manifest OK: version=1.0.0-e2e
[install-version] resolving trust store path...
[install-version] trust store: ...harness-e2e-...\trust-store.json (source=env-trust-store, exists=True)
[install-version] verifying manifest signature...
[launcher-signature] launcher_signature_verified keyId=7c4955dc96f3a691 label=default trustStore=...
[install-version] signature gate: VERIFIED keyId=7c4955dc96f3a691
```

**✅ Audit anchor #1 captured**: `launcher_signature_verified keyId=7c4955dc96f3a691 label=default`

### §2.2 Scenario B — Unsigned manifest (negative case)

Manifest body without the `signature` object:

```text
[install-version] verifying manifest signature...
[launcher-signature] launcher_signature_failed reason=signature_missing
exit 37
```

**✅ Audit anchor #2 captured**: `launcher_signature_failed reason=signature_missing`

### §2.3 Scenario C — Manifest signed by unknown key (negative case)

A second keypair was generated (`keyId=268ca8e46bb4dee3`) and used
to sign a separate manifest. The trust store was NOT updated to
include this new key.

```text
[install-version] verifying manifest signature...
[launcher-signature] launcher_signature_failed reason=unknown_key_id keyId=268ca8e46bb4dee3
exit 38
```

**✅ Audit anchor #3 captured**: `launcher_signature_failed reason=unknown_key_id keyId=268ca8e46bb4dee3`

### §2.4 Phase 2 verdict: **PASS** (3 of 3 expected anchors)

---

## §3 Phase 3 — Tampering rejection

### §3.1 Scenario D — Post-signature zip tampering

After signing the manifest pinning `sha256=16e69fe2...`, the release
zip was modified by appending the string `"TAMPER "` to its end.
The launcher was then invoked with the (still legitimately signed)
manifest. Expected: signature verifies (because the manifest itself
is unchanged) but SHA256 catches the byte-level tampering.

```text
[launcher-signature] launcher_signature_verified keyId=7c4955dc96f3a691 ...
[install-version] signature gate: VERIFIED keyId=7c4955dc96f3a691
[install-version] downloading zip...
[install-version] verifying SHA256 (expected: 16e69fe2cd15a719c...)...
[launcher-signature] launcher_signature_failed reason=hash_mismatch
SHA256 mismatch - moved to ...quarantine-1.0.0-e2e-...zip for forensics
exit 34
```

**✅ Audit anchor #4 captured**: `launcher_signature_failed reason=hash_mismatch`

### §3.2 Quarantine

The tampered zip was moved (not deleted) to a forensic quarantine
location: `data/quarantine-1.0.0-e2e-20260505123911.zip`. This is
the documented behavior — a SHA mismatch is a security signal, not a
transient error, so the bytes are preserved for inspection.

### §3.3 Phase 3 verdict: **PASS**

---

## §4 Defects discovered + fixed during evidence collection

### §4.1 Bug: `install-version.ps1` did not emit `launcher_signature_failed reason=hash_mismatch`

The runbook (`trust-store-e2e.md` §5.2) called for this audit-chain
verb on tampering rejection. Inspection of `install-version.ps1`
(line 384–397) showed the SHA-mismatch path only `Write-Error`'d and
quarantined — no audit row.

**Fix landed in same round**: added
`Write-AuditLine 'launcher_signature_failed' 'reason=hash_mismatch'`
at the SHA-mismatch branch in `install-version.ps1`. The verb sits
in the `launcher_signature_*` family because a SHA mismatch
invalidates the signature's coverage promise — even though the
cryptographic signature was verified earlier in the run, the bytes
the signature attested to are not the bytes that arrived.

### §4.2 Manifest schema rejected `file://` URLs even with the dev-only env override

The fetch-stage validator (`launcher-cli validate-manifest-url`) honors
`ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL=1`. The manifest BODY validator
in `src/runtime/launcherManifest.js` did not — it always required
`https://`. This made the E2E test impossible without spinning up an
HTTPS server with self-signed cert.

**Fix landed in same round**: extended the env override to also relax
the body-url check. Production posture (env unset) keeps the strict
`https://` rule. Two new unit tests pin both branches:
- `ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL=1 relaxes manifest-body url check`
- `env unset or != '1' keeps file:// rejected (production posture)`

---

## §5 Sealed evidence

| Artifact | Path | Verdict |
| --- | --- | :---: |
| Signed manifest | `<tmp>/manifest.signed.json` | — |
| Trust store (operator-side fragment) | `<tmp>/trust-store.json` | — |
| Tampered release zip (forensic) | `<tmp>/data/quarantine-1.0.0-e2e-20260505123911.zip` | — |
| Audit-anchor capture | this report §2.1–§3.1 | PASS |

The temp working directory `C:\Users\SJ\AppData\Local\Temp\harness-e2e-28EKFg`
contains the working artifacts; only the audit-anchor capture +
this report constitute committed evidence (the keys + signed
manifests are scenario-specific and not committed by design).

---

## §6 Acceptance summary

Per [`../runbooks/v1-blockers.md`](../runbooks/v1-blockers.md) §3.3:

| Criterion | Status |
| --- | :---: |
| #1 Committed runbook | ✅ closed earlier (TRUST-STORE-E2E-RUNBOOK round) |
| #2 Committed eval report with 3 audit-chain anchors | ✅ **THIS REPORT** |
| #3 Resolver integration test | ✅ closed earlier (TRUST-STORE-PATH-IT round) |
| #4 TRUST-STORE-0 UI deferral | ✅ closed earlier (TRUST-STORE-0-DEFER round) |

**v1.0.0 Blocker #2 — CLOSED.**

---

## §7 References

- [`../runbooks/trust-store-e2e.md`](../runbooks/trust-store-e2e.md) — operator playbook (this report follows §3 + §4 + §5).
- [`../runbooks/v1-blockers.md`](../runbooks/v1-blockers.md) §3 — Blocker #2 acceptance criteria.
- [`../live-evidence-schema.md`](../live-evidence-schema.md) §5 — audit-chain anchors taxonomy.
- [`../../scripts/sign-manifest.js`](../../scripts/sign-manifest.js) — Ed25519 signing tool.
- [`../../scripts/launcher/install-version.ps1`](../../scripts/launcher/install-version.ps1) — production fail-closed gate.
- [`../../scripts/launcher/launcher-cli.js`](../../scripts/launcher/launcher-cli.js) — verify-manifest-signature bridge.
- [`../../tests/integration/trust-store-path-precedence.test.js`](../../tests/integration/trust-store-path-precedence.test.js) — full 5-step precedence chain test (TRUST-STORE-PATH-IT).
- [`../../tests/unit/launcherManifest.test.js`](../../tests/unit/launcherManifest.test.js) — manifest schema unit tests (extended in this round).
