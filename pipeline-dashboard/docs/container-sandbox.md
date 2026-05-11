# Container Sandbox Design

> **See also**: [`remote-sandbox-rfc.md`](./remote-sandbox-rfc.md) §2
> (Phase D Round MF) generalizes this Docker-specific sketch into a
> runtime-agnostic isolation model with sandbox classes (`none` /
> `container-strict` / `vm-strict`). The runtime choice (docker vs.
> podman vs. kata vs. firecracker) deferred to the implementation RFC.
> This file remains the Docker-specific implementation reference.

## Purpose

Isolate Claude/Codex runner subprocesses in containers to prevent:
- File system escape beyond project root
- Environment variable leakage
- Resource exhaustion (CPU, memory, disk)
- Network access to internal services

## Runner Isolation Requirements

| Resource | Limit | Rationale |
|----------|-------|-----------|
| CPU | 2 cores | Prevent runner from starving dashboard |
| Memory | 2 GB | Prevent OOM on host |
| Timeout | 300s (Codex), 180s (Claude) | Already enforced in runners |
| Network | Outbound only to API endpoints | Block local network scanning |
| Filesystem | Read-only source, writable /workspace | Prevent source corruption |

## Docker Sandbox Design

```dockerfile
# Dockerfile.orchestrator-runner
FROM node:22-slim
WORKDIR /workspace
COPY --chown=node:node . /src:ro
USER node
ENV NODE_ENV=production
ENTRYPOINT ["node"]
```

### Volume Mounts
- `/src` — project source (read-only bind mount)
- `/workspace` — writable workspace for runner output

### Resource Limits
```yaml
deploy:
  resources:
    limits:
      cpus: "2.0"
      memory: 2G
```

### Network Policy
- Allow: outbound to OpenAI API, Anthropic API
- Block: localhost, internal services, metadata endpoints (169.254.169.254)

## Implementation Phases

1. Document design (this file) — no code changes
2. Create `Dockerfile.orchestrator-runner` + `docker-compose.runner.yml`
3. Modify `codex-runner.js` and `claude-runner.js` to spawn in container when `ORCHESTRATOR_CONTAINER_MODE=1`
4. Integration test: container runner produces same output as direct spawn
