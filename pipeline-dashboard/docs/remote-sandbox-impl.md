# Remote Sandbox Implementation RFC

**Status**: Design-only. No code in this round.
**Round**: Phase D Round MG (Slice MG1 of MG1–MG2).
**Date**: 2026-04-28.
**Predecessor**: [`remote-sandbox-rfc.md`](./remote-sandbox-rfc.md) (MF1) —
this RFC closes its §4 G10 ("Implementation RFC approved before code starts").
**Roadmap reference**: `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md` §7.

The MF1 RFC defined the **contract** (run origin, sandbox classes,
isolation model, monitor metadata, rollout gates). MF1 §6 left four
"open questions" deliberately unanswered: runtime choice, hook ingress
channel, JWT issuer, audit ledger storage. This RFC commits to specific
tech for each, plus the runner-host control plane, network egress
policy, bootstrap sequence, and failure-mode handling that MF1 left
undecided.

After this RFC is approved, the next round opens implementation
slices. **No code lands until then.**

---

## 0. Scope, status, prerequisites

### What this RFC adds on top of MF1

| Topic | MF1 status | MG1 commitment |
|---|---|---|
| Runtime | "docker, podman, kata, firecracker — pick one" | **docker (rootless preferred, daemon fallback)** |
| Hook ingress channel | "WS-only or HTTPS POST + WS" | **WS primary + HTTPS POST one-shot fallback** |
| JWT issuer | "orchestrator-self-signed vs. external IdP" | **orchestrator-self-signed (HS256, HARNESS_TOKEN-derived)** |
| Audit ledger storage | "append-only file vs. SQLite" | **extend existing `evidenceLedger` JSONL + HMAC signature** |
| Runner-host control plane | (not specified) | **env-only initial, heartbeat-driven discovery** |
| Network egress | "default = orchestrator only" | **nftables/iptables on runner host + dnsmasq allowlist** |
| Container image | (not specified) | **`node:24-bookworm-slim` + multi-stage build + SBOM** |
| Bootstrap sequence | (not specified) | **3-step handshake with bootstrap token → per-run JWT** |
| Failure recovery | "MF1 §4.2 5 rows" | **expanded with concrete detection + remediation** |

### Prerequisites — what must be DONE before this RFC's slices can ship

- **DONE**:
  - MF1 design RFC (`remote-sandbox-rfc.md`)
  - Phase D MD CI gate (`.github/workflows/ci.yml`)
  - Phase D ME Node 24 forward-compat (actions @v6, FORCE_JS_NODE24 env)
  - Phase 3-S security (`verifyWsConnection`, `pathSandbox`, `childRegistry`)
  - Existing `evidenceLedger` (JSONL hash chain)
  - Existing JWT-capable token infrastructure (`HARNESS_TOKEN`, `safeEqual`)

- **STILL OPEN**:
  - MF1 §4 gates G1-G9 — these require implementation slices that
    follow this RFC's approval. None can land before MG1 + MG2 close.
  - Runner host provisioning / configuration management — this RFC
    decides the contract; the actual provisioning is operator concern.

### Non-goals (deliberately out of scope)

- **Multi-tenant orchestration** — Phase 3 (D platformization).
- **GPU passthrough** — rare for harness workloads; covered in a
  follow-up RFC if a use case emerges.
- **Cross-region replication** — orchestrator stays single-instance.
- **HA orchestrator** — manual restart is the today path; HA is Phase 3.
- **Custom user-supplied Dockerfiles** — initial rollout ships one
  fixed image; user-supplied images are a follow-up RFC.
- **Performance benchmarking** — sequenced after R1 (per MF1 §4.1).
- **Image registry choice** — operator decides; this RFC names ghcr.io
  as the suggested default but doesn't commit to it.

---

## 1. Runtime decision: Docker

### 1.1 Comparison

| Runtime | Isolation | Startup | Ops complexity | Notes |
|---|:---:|:---:|:---:|---|
| **Docker (rootless)** | Strong | ~500ms | Low | Default choice. Same userspace as Docker daemon, but no daemon root. |
| Docker (daemon) | Strong | ~500ms | Low | Fallback if rootless unavailable on runner host. |
| Podman | Strong | ~500ms | Low | Drop-in replacement; daemonless. Future migration path. |
| containerd directly | Strong | ~400ms | Medium | Skip Docker layer; harder to debug. |
| Kata Containers | VM-grade | ~2s | High | Reserved for `sandbox_class: vm-strict` (Phase R4). |
| Firecracker | VM-grade | ~150ms | High | Reserved for `vm-strict`; AWS-style microVM. |

### 1.2 Decision

**Docker (rootless preferred, daemon fallback) for `sandbox_class: container-strict`.**

Rationale:
- Operators most likely to have docker installed already.
- Rootless mode (`docker context create rootless`) drops the largest
  privilege escalation vector without changing the API.
- Daemon mode is the fallback because rootless still has gaps on
  older kernels (< 5.13). The runner host startup script probes for
  rootless support and falls back automatically.
- Migration path to podman is trivial — the `docker` binary is
  symlinked to `podman` on hosts that prefer it. Both honour the same
  CLI surface for our use cases.

### 1.3 Version pin

- **Minimum**: docker ≥ 24.0 (rootless GA, BuildKit default).
- **Tested against**: 24.x and 25.x.
- **Older versions**: explicitly rejected at runner-host startup
  (`harness-runner --probe` exits non-zero with a remediation hint).

### 1.4 Why not VM-grade today

`sandbox_class: vm-strict` is reserved for R4. The reasons it's
deferred:
1. Startup latency (kata 2s vs. docker 500ms) hurts the harness's
   low-latency feedback loop.
2. Kata + firecracker require kernel features (KVM, /dev/kvm
   permissions) that are absent on many CI runners and laptops.
3. The MF1 isolation model already enforces strong process / network
   / FS boundaries via container-strict; the additional VM boundary
   is a defence-in-depth, not a base requirement.

The `sandbox_class` taxonomy stays open; vm-strict can be added
without changing this RFC.

---

## 2. Container image

### 2.1 Base image: `node:24-bookworm-slim`

- Matches the harness's Node 24 runtime (Phase 3-S Node 24 alignment).
- `slim` variant is ~70 MiB vs. the full image's ~1 GiB. Workload
  doesn't need the full toolchain.
- `bookworm` (Debian 12) gets backported security fixes through the
  Debian LTS process. Annual major-version review (next: 2027 with
  trixie).

Not chosen:
- `node:24-alpine`: musl-libc has compatibility issues with some
  workload native deps. Defer until those deps switch (`node-pty`
  works, but a future workload may bring something musl-incompatible).
- `node:24` (full): too large; we don't need most of it.
- Distroless (`gcr.io/distroless/nodejs:24`): no shell, harder to
  debug live; gains are marginal for the slim variant we already use.

### 2.2 Multi-stage build

```dockerfile
# Stage 1 — deps cache
FROM node:24-bookworm-slim AS deps
WORKDIR /opt/runner
COPY runner/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts

# Stage 2 — runtime
FROM node:24-bookworm-slim AS runtime
RUN groupadd -g 10001 harness && useradd -u 10001 -g 10001 -m -s /usr/sbin/nologin harness
WORKDIR /opt/runner
COPY --from=deps /opt/runner/node_modules ./node_modules
COPY runner/ ./

# Workload mount points (read-only inputs, writable outputs)
RUN mkdir -p /work/in /work/out && chown harness:harness /work/in /work/out
VOLUME ["/work/in", "/work/out"]

# Runtime hardening
USER harness:harness
ENV NODE_ENV=production NODE_OPTIONS="--unhandled-rejections=strict"

# Single entrypoint
ENTRYPOINT ["node", "/opt/runner/harness-runner.js"]
```

Notes:
- `--ignore-scripts` blocks npm postinstall from running arbitrary
  code at image-build time. The runner has no native deps.
- Non-root UID 10001 matches operator-side `pathSandbox` expectations.
- `/work/in` and `/work/out` are the only volumes — everything else
  is image-baked.

### 2.3 Supply chain

- **SBOM**: `npm sbom --sbom-format=cyclonedx-1.5 > sbom.json`
  generated at image build time; published as an OCI image annotation.
- **Vulnerability scan**: `npm audit --audit-level=moderate` in CI
  (already wired by Phase D MD2 — image build inherits the gate).
- **Image signing**: cosign keyless signing via Sigstore once the
  registry is chosen. Verification at runner startup is a future
  hardening item (G6+ extension).

### 2.4 Registry

- Suggested: `ghcr.io/SJJ-universe/harness-runner:<commit-sha>`.
- Operator can override via `HARNESS_RUNNER_IMAGE` env.
- Tag policy: every commit on master gets a `:<sha>` tag; only
  hand-picked commits get `:stable`. No `:latest` — operators must
  pin.

---

## 3. Hook ingress channel

### 3.1 Decision

**WebSocket primary + HTTPS POST one-shot fallback.**

Two endpoints:

1. `/api/runner/events` (WebSocket, NEW). Authenticated by the
   per-run JWT (`Authorization: Bearer <jwt>` upgrade header). The
   workload's runner agent connects once per run and streams hooks +
   workload commands bidirectionally.

2. `/api/runner/hook` (HTTPS POST, NEW). Authenticated by the same
   JWT. Used for one-shot hooks where WS reconnection cost dominates
   (e.g. PreCompact at session end). Idempotent by `eventId`.

### 3.2 Why both

- **WS is primary** because the harness's existing `verifyWsConnection`
  + replay buffer + hook router are WS-based. Reusing this code path
  keeps remote and local hooks indistinguishable upstream.
- **HTTPS POST exists** for the failure case where the WS dropped and
  the runner needs to flush a queued event before reconnecting. WS-only
  would force the runner to discard or buffer indefinitely on long
  partitions.

### 3.3 Backwards compat

- Local-mode runs continue to use the existing `/api/hook` route
  (loopback-only). No changes there.
- The new `/api/runner/*` routes are gated behind
  `HARNESS_REMOTE_MODE !== "off"`. When off, the routes 404 — runner
  hosts can't accidentally connect to a non-remote orchestrator.

---

## 4. JWT issuer: orchestrator self-signed (HS256)

### 4.1 Algorithm

**HS256** (HMAC-SHA256). Symmetric. Both sides use the same secret.

Why not RS256 (asymmetric):
- Single-tenant: orchestrator is BOTH issuer and verifier. There's no
  "third party verifier" need.
- Symmetric is faster and simpler.
- If Phase 3 brings external IdP, that flows through OIDC and bypasses
  this scheme entirely — symmetric vs. asymmetric is no longer the
  trade-off.

### 4.2 Secret derivation: HKDF from `HARNESS_TOKEN`

```js
// Pseudo-code; actual implementation in src/security/jwt.js (future)
const ikm = Buffer.from(process.env.HARNESS_TOKEN, "utf-8");
const salt = Buffer.from("harness-jwt-v1", "utf-8");
const info = Buffer.from("runner-jwt", "utf-8");
const jwtKey = hkdf("sha256", ikm, salt, info, 32);
```

Properties:
- Deterministic (same `HARNESS_TOKEN` → same key on every restart).
- Domain-separated from the main token (`info=runner-jwt` ensures the
  HKDF output cannot be confused with another use of `HARNESS_TOKEN`).
- Future-proof: a v2 derivation just changes the `info` label.

A SECOND HKDF derivation (info = `"audit-ledger"`) produces the
HMAC-signing key for §5. Keys never overlap.

### 4.3 Claims schema

```json
{
  "sub": "<runId>",
  "aud": "runner-<runId>",
  "iat": 1735689600,
  "exp": 1735693200,
  "harness": {
    "runOrigin": "container-remote",
    "sandboxClass": "container-strict",
    "hostIdentity": "runner-pool-a/3"
  }
}
```

- `sub` = runId. A stolen JWT can only act on its own run.
- `aud` includes runId again. Short defence-in-depth.
- `exp` = `iat` + run-declared timeout + 60s grace.
- `harness.*` mirrors the monitor envelope `origin` field (MF1 §3.1)
  so the runner agent can see what class it's in without a separate
  endpoint.

### 4.4 Lifecycle

1. **Issuance**: orchestrator issues at run start. Single token per
   run. No refresh — runs are bounded.
2. **Verification**: every WS upgrade and every HTTPS POST validates
   `aud === "runner-${runId}"` plus `exp > now`. Mismatch → 401 +
   ledger entry (audit_jwt_invalid).
3. **Revocation**: implicit at run end (orchestrator clears the
   per-run state; subsequent JWTs with that runId fail `aud` check
   because the run is gone). Explicit revocation list deferred to
   Phase 3.

### 4.5 What this does NOT cover

- Refresh tokens (single-tenant doesn't need them).
- External IdP integration (Phase 3).
- Service-to-service tokens between orchestrator and runner host
  control plane — those use bootstrap tokens (§6), not JWTs.

---

## 5. Audit ledger storage

### 5.1 Decision

**Extend existing `src/runtime/evidenceLedger.js`** (JSONL append-only
+ sha256 hash chain) with HMAC-SHA256 signatures per entry.

### 5.2 Why not switch to SQLite

The current ledger handles:
- 200+ events/run × 50+ runs/day × 90-day retention = ~900K rows.
- This is well within JSONL append-only territory. SQLite would
  introduce a transaction boundary that complicates the
  signed-append-only invariant.

If scale crosses ~10M rows or queries demand secondary indexes,
migration to SQLite becomes an option — but that's a future RFC.

### 5.3 Signed entry shape

Existing entry shape (today):
```json
{
  "eventId": "<uuid>",
  "runId": "<runId>",
  "type": "<event-type>",
  "at": <ms-timestamp>,
  "dataHash": "<sha256>",
  "previousHash": "<sha256>",
  "data": { ... }
}
```

Extended (post-MG):
```json
{
  "eventId": "<uuid>",
  "runId": "<runId>",
  "type": "<event-type>",
  "at": <ms-timestamp>,
  "dataHash": "<sha256>",
  "previousHash": "<sha256>",
  "data": { ... },
  "sig": "<hmac-sha256>",
  "sigVer": 1
}
```

The `sig` field signs the canonical concatenation of the other
fields:
```
hmac_sha256(
  ledgerKey,
  eventId + "|" + runId + "|" + type + "|" + at + "|" + dataHash + "|" + previousHash
)
```

`sigVer` is a forward-compat marker. Future extensions can switch to
a different canonicalization or algorithm without breaking old entries.

### 5.4 Verification

A new utility `evidenceLedger.verifyChain(runId)`:
1. Reads JSONL.
2. Walks entries in order, verifying:
   - `previousHash` matches the actual previous entry's `eventHash`.
   - `dataHash` matches `sha256(JSON.stringify(data))`.
   - `sig` matches `hmac_sha256(ledgerKey, canonicalConcat)`.
3. Returns `{ valid: true }` or `{ valid: false, brokenAt: <eventId>, reason: "..." }`.

This is added to readiness gate G8 (MF1 §4):
- Test: append 100 entries, tamper one, verify failure detected.
- Test: append 100 entries, sign all, verify all pass.

### 5.5 Key management

- Signing key: HKDF derivative of `HARNESS_TOKEN` (info =
  `"audit-ledger"`). Same machinery as JWT key but different label.
- Rotating `HARNESS_TOKEN` invalidates ALL old signatures. This is
  acceptable: the ledger is read-only history, and tamper-detection
  is per-chain (the hash chain still works without the signature).
  The signature is the EXTRA layer that an attacker who can write
  files can't forge.

---

## 6. Runner-host control plane

### 6.1 Decision

**Env-driven configuration + heartbeat-driven discovery.** No UI in
this round.

### 6.2 Configuration surface

Operator sets these env vars on the orchestrator:

```bash
# Comma-separated list of runner endpoints
HARNESS_REMOTE_RUNNERS=runner-a.local:8443,runner-b.local:8443

# Per-runner bootstrap token (used for the first handshake before JWT)
HARNESS_REMOTE_RUNNER_TOKEN_runner-a_local=<32-char-hex>
HARNESS_REMOTE_RUNNER_TOKEN_runner-b_local=<32-char-hex>

# Optional override — image to deploy on each runner
HARNESS_RUNNER_IMAGE=ghcr.io/SJJ-universe/harness-runner:<sha>
```

### 6.3 Heartbeat-driven discovery

1. Each runner host's `harness-runner-control` process POSTs to
   `/api/runner/heartbeat` every 5s.
2. The POST is authenticated by the bootstrap token (NOT the JWT —
   JWTs are per-run, heartbeats are pre-run).
3. Orchestrator records `{ hostIdentity, lastSeen, capabilities }`.
4. When a new run starts and the operator selects a runner, the
   orchestrator picks the least-loaded host with `lastSeen` within
   15s.
5. Hosts whose `lastSeen` exceeds 30s are marked `unhealthy` and
   dropped from selection.

### 6.4 Why no UI in this round

- Operators today configure the harness via env. Adding a UI for
  runners alone makes the env-vs-UI inconsistency worse before the
  full Phase 3 platform UI lands.
- The dashboard's existing run-tree shows runners via the monitor
  envelope `origin.hostIdentity` field (MF1 §3.3). That's enough for
  visibility.
- A dedicated "runner pool" dashboard panel is a follow-up — it
  bundles with multi-tenant Phase 3 UI work.

---

## 7. Network egress

### 7.1 Layer 1: Container network policy

Each container starts with:
```bash
docker run --network=harness-egress-only ...
```

Where `harness-egress-only` is a Docker network created at runner-host
startup with:
- `--internal` (no implicit gateway to host network).
- A custom bridge with iptables rules attached to the bridge interface.

### 7.2 Layer 2: iptables/nftables on runner host

For the `harness-egress-only` bridge interface (e.g. `br-harness`):

```
# Allow DNS to controlled resolver
nft add rule inet harness output oifname "br-harness" udp dport 53 ip daddr 10.99.99.1 accept

# Allow traffic to orchestrator host only (port 8443 over TLS)
nft add rule inet harness output oifname "br-harness" tcp dport 8443 ip daddr <orchestrator-ip> accept

# Block cloud metadata (defence-in-depth; should never be reachable)
nft add rule inet harness output oifname "br-harness" ip daddr 169.254.169.254 drop

# Block RFC1918 peers
nft add rule inet harness output oifname "br-harness" ip daddr 10.0.0.0/8 drop
nft add rule inet harness output oifname "br-harness" ip daddr 172.16.0.0/12 drop
nft add rule inet harness output oifname "br-harness" ip daddr 192.168.0.0/16 drop

# Default deny
nft add rule inet harness output oifname "br-harness" drop
```

### 7.3 Layer 3: DNS allowlist via dnsmasq

A dedicated dnsmasq instance on `10.99.99.1` (the resolver address from
§7.2) is configured to resolve only:
- The orchestrator's hostname.
- Codex/Claude API endpoints (when the workload calls them through the
  orchestrator proxy — see MF1 §2.3).
- Anything else returns `NXDOMAIN`.

This means even if a workload finds an IP somehow, it can't resolve
arbitrary hostnames.

### 7.4 What this enforces

The MF1 §2.5 row "Network egress allowlist enforced" is satisfied:
- Cloud metadata blocked at L1 + L2.
- RFC1918 peers blocked at L2.
- Loopback blocked because the container has no host-network namespace.
- Arbitrary external hosts blocked at L1 (only `--network=harness-egress-only` is mounted) + L3 (DNS resolves nothing else).

### 7.5 Operator escape hatches (intentional)

When debugging:
- `HARNESS_RUNNER_EGRESS_DEBUG=1` swaps the network policy to
  log-only (still default-deny but every dropped packet is logged at
  warn level for 10 minutes, then auto-resets).
- `HARNESS_RUNNER_BYPASS=1` is intentionally NOT supported. To
  bypass, the operator must edit nft rules directly — making the
  bypass a deliberate, observable action.

---

## 8. Bootstrap sequence

### 8.1 Three-step handshake

```
runner-host                              orchestrator
   |                                          |
   |-- (1) POST /api/runner/handshake -->     |
   |    Authorization: Bearer <bootstrap>     |
   |    body: { hostIdentity, capabilities }  |
   |                                          |
   |    <-- (1) 200 + { runnerToken } --------|
   |                                          |
   |-- (2) (heartbeat loop, every 5s) ------> |
   |    POST /api/runner/heartbeat            |
   |    Authorization: Bearer <runnerToken>   |
   |                                          |
   |    [later, when a run starts on this host]
   |                                          |
   |    <-- (3) WS /api/runner/events --------|
   |        upgrade auth: Bearer <runJWT>     |
   |                                          |
```

### 8.2 Token taxonomy

| Token | Scope | Lifetime | Source |
|---|---|---|---|
| `bootstrap` | One-shot, runner registration | Until first handshake | `HARNESS_REMOTE_RUNNER_TOKEN_<host>` env |
| `runnerToken` | Heartbeat + run claim | 24h, refreshed on heartbeat | Issued by orchestrator on handshake |
| `runJWT` | Per-run hook ingress | Run duration + 60s grace | Issued by orchestrator on run start |

### 8.3 Why three tiers

- **Bootstrap** is ops-managed (env on the runner host machine).
  Compromise of the orchestrator does not leak it.
- **runnerToken** is short-lived enough that a copy can't be reused
  after the runner is replaced.
- **runJWT** is per-run; even within a runner host, runs cannot
  impersonate each other.

---

## 9. Failure modes (extends MF1 §4.2)

| Failure | Detection | Time to detect | Remediation |
|---|---|:---:|---|
| Runner host crashed | No heartbeat for 30s | 30s | Orchestrator marks all runs on host as failed; replays locally if `HARNESS_REMOTE_FALLBACK=1` |
| Network partition between orch ↔ runner | Heartbeat OK but WS drops | 10s (reconnect timeout) | Runner buffers hooks (max 100 events); replays via HTTPS POST `/api/runner/hook` |
| Workload OOM | Container exits with 137 | Immediate | Orchestrator logs + marks run as failed + appends `oom` event to ledger |
| Workload timeout | Container runs past declared timeout | At timeout | Orchestrator sends container kill (SIGTERM via Docker API) → 30s grace → SIGKILL |
| Image pull failed | Container start error | 60s | Orchestrator falls back to most recent successfully-pulled image; alerts operator |
| JWT expired mid-run | 401 on hook | Immediate | Orchestrator re-issues JWT (with audit ledger entry); workload reconnects WS |
| nft rules misconfigured | First test workload's egress test fails (G3) | At G3 verification | Block runner from selection until ops fixes; surface `runner-egress-misconfigured` event |
| Runner image tampered | `cosign verify` fails (when enabled) | At runner startup | Runner refuses to start; ops must re-pull with verified image |
| Disk full on runner | `/work/out` write fails | First failed write | Runner reports `out-of-disk` event; orchestrator drains other runs from host |
| Audit signature mismatch | `verifyChain()` fails on read | When `verifyChain()` runs (manually or G8 test) | Mark ledger as compromised; preserve raw JSONL for forensics; refuse new entries until ops investigates |

---

## 10. Phase R1 (internal preview) implementation specifics

R1's purpose: validate the isolation model on `container-local`
(runner host = orchestrator host). No actual remote.

### 10.1 What R1 must ship

- `harness-runner` Node entrypoint (small; ~300 LOC).
- Dockerfile + multi-stage build script (`scripts/build-runner.sh`).
- Updated `docker-compose.dev.yml` for local-only testing.
- New routes: `/api/runner/handshake`, `/api/runner/heartbeat`,
  `/api/runner/hook`, `/api/runner/events` (WS).
- New module: `src/security/jwt.js` (HS256 issue/verify with HKDF
  derivation).
- Extended `src/runtime/evidenceLedger.js` with HMAC signing.
- Extended `src/runtime/childRegistry.js` to include remote children.
- New monitor envelope: `origin` field (MF1 §3.1, all four sub-fields).
- Extended `monitor-runs-detail.test.js`: G5 verification.
- New tests: G1 (workspace), G2 (JWT), G3 (egress, against a stub
  external host), G4 (hook auth), G7 (graceful shutdown), G8 (signed
  ledger).

### 10.2 What R1 does NOT ship

- Multi-runner (Phase R3).
- VM-strict (Phase R4).
- Cosign image verification (G6+ extension).
- Runner pool UI (Phase 3).
- Cross-runner load balancing (Phase R3).

### 10.3 Required env

```bash
HARNESS_REMOTE_MODE=preview
HARNESS_REMOTE_RUNNERS=localhost:8443
HARNESS_REMOTE_RUNNER_TOKEN_localhost=<32-char-hex>
HARNESS_RUNNER_IMAGE=ghcr.io/SJJ-universe/harness-runner:<sha>
HARNESS_REMOTE_FALLBACK=1   # dev-only — re-runs failed remote attempts locally
```

### 10.4 Required readiness rubric extension

A new category gets added to `docs/readiness-rubric.md` (closing G6):

```
2.6 Remote isolation
  ★ — `harness-runner` image builds + scans clean.
  ★★ — A `container-local` workload completes a 3-phase pipeline + emits the expected hooks.
  ★★★ — All G1-G9 integration tests green.
```

Until R1 ships, this category is `0/3`. Until then, the rubric
total stays at 15. After R1, the rubric expands to 18.

---

## 11. Open issues for further design

These are NOT decided in this RFC but flagged for future consideration:

1. **Image signing enforcement**: cosign verification at runner
   startup. Trade-off: hard requirement vs. operator opt-in. Likely
   opt-in for R1, mandatory by R3.
2. **Runner host control plane scaling**: env-only works for ≤10
   runners. Above that, needs a config file or registry. Defer to
   when scale demands.
3. **Cross-orchestrator runner sharing**: today each orchestrator
   has its own pool. Could runners be shared? Defer to Phase 3.
4. **GPU passthrough**: rare workload need; specifying a GPU
   `--gpus all` flag is straightforward but requires kernel support
   discovery. Defer until first request.
5. **Telemetry to operator dashboards**: Prometheus / OTLP for
   runner host metrics. Out of scope for R1; consider for R3+.
6. **Backup of audit ledger**: signed JSONL is replicable to S3 /
   azblob, but the policy (frequency, retention) is operator concern.
   Defer documentation until first compliance use case.

---

## 12. Approval criteria

This RFC is APPROVED when:

1. ✅ All four MF1 §6 open questions are answered (§§1, 3, 4, 5 above).
2. ✅ Runner-host control plane decision documented (§6).
3. ✅ Network egress policy concrete (§7).
4. ✅ Container image specified (§2).
5. ✅ Bootstrap sequence specified (§8).
6. ✅ Failure modes expanded from MF1 §4.2 (§9).
7. ✅ R1 scope explicit (§10).
8. ✅ Cross-linked from MF1 RFC (§4 G10 references this doc).

After approval, **Phase D Round MH** opens with the first R1
implementation slice. Approval = explicit operator say-so + no
outstanding questions in §11 marked "blocking".

---

## 13. Sources

- [`remote-sandbox-rfc.md`](./remote-sandbox-rfc.md) (MF1) — design contract.
- [`remote-mode-design.md`](./remote-mode-design.md) — current threat model.
- [`container-sandbox.md`](./container-sandbox.md) — Docker-specific reference.
- [`harness-architecture.md`](./harness-architecture.md) — current architecture.
- [`security-model.md`](./security-model.md) — Phase 3-S security boundary.
- `src/runtime/evidenceLedger.js` — existing hash-chain ledger.
- `docs/superpowers/specs/2026-04-27-five-priority-roadmap.md` §7 — original P4 brief.
- RFC 5869 (HKDF) — for the key derivation in §4.2 + §5.5.
- RFC 7519 (JWT) — for the token format in §4.
- Docker rootless mode: <https://docs.docker.com/engine/security/rootless/>
- nftables documentation: <https://wiki.nftables.org/>
- cosign / Sigstore: <https://docs.sigstore.dev/cosign/>
- OWASP Container Security cheat sheet — referenced for §2 + §7.

---

## 14. Status of MF1 §6 open questions (post-MG1)

| Open question | MF1 §6 phrasing | MG1 answer | RFC section |
|---|---|---|---|
| 1 | Runtime choice | **Docker** (rootless preferred) | §1 |
| 2 | Hook ingress channel | **WS primary + HTTPS POST fallback** | §3 |
| 3 | JWT issuer | **Orchestrator self-signed (HS256)** | §4 |
| 4 | Audit ledger storage | **Extend evidenceLedger JSONL + HMAC** | §5 |

All four MF1 §6 open questions are answered. MF1 §4 G10 ("Implementation
RFC approved before code starts") is now CLOSEABLE pending operator
sign-off on this document.
