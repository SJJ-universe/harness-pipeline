// P0-3 — Unified child process registry.
//
// Replaces the ad-hoc Set instances that server.js used for PTY and Codex
// children. One registry tracks every child we spawn so gracefulShutdown
// can reap them in one place.
//
// Contract:
//   reg.track(child, label?)  — add child, auto-remove on exit/close
//   reg.killAll()             — kill every tracked child, clear the set
//   reg.size()                — number currently tracked
//   reg.snapshot()            — [{ child, label }] for diagnostics

class ChildRegistry {
  constructor() {
    this._entries = new Map(); // child → { label }
  }

  track(child, label) {
    if (!child) return child;
    this._entries.set(child, { label: label || "" });
    const onGone = () => this._entries.delete(child);
    try {
      child.once("exit", onGone);
      child.once("close", onGone);
    } catch (_) {
      // child without EventEmitter → ignore, caller must remove manually
    }
    return child;
  }

  untrack(child) {
    this._entries.delete(child);
  }

  killAll() {
    for (const child of this._entries.keys()) {
      try {
        child.kill();
      } catch (_) {}
    }
    this._entries.clear();
  }

  size() {
    return this._entries.size;
  }

  snapshot() {
    return Array.from(this._entries.entries()).map(([child, meta]) => ({
      child,
      label: meta.label,
    }));
  }
}

module.exports = { ChildRegistry };
