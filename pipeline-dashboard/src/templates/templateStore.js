// Custom pipeline template storage — Slice E (v4).
//
// User-uploaded pipeline templates live in `.harness/templates.json` (outside
// of the git-tracked pipeline-templates.json so uploads never dirty the repo).
// At server startup we merge the built-in templates with the custom ones;
// subsequent uploads / deletes rewrite the custom file atomically and emit a
// `template_registry_reloaded` broadcast so connected clients re-fetch the
// selector list.
//
// Safety posture:
//   - Single-file footprint: all uploads target ONE path inside the repo's
//     .harness directory. No template path or filename is derived from user
//     input, so path traversal attacks have no surface.
//   - Atomic write: we write to `<path>.tmp-<pid>-<ts>` and then rename, so
//     a crash mid-write never leaves a corrupt manifest.
//   - Backups: before each rename we copy the previous manifest to
//     `.harness/templates-backup/<timestamp>.json` (rolling, best-effort).
//   - Built-ins are immutable: the store never returns built-in ids in
//     `listCustom()` and `remove()` rejects non-custom ids.

const fs = require("fs");
const path = require("path");

const CUSTOM_ID_RE = /^custom-[a-z0-9_-]{1,40}$/;

function createTemplateStore({ repoRoot, builtins } = {}) {
  if (!repoRoot || typeof repoRoot !== "string") {
    throw new Error("templateStore: repoRoot is required");
  }
  const harnessDir = path.join(repoRoot, ".harness");
  const filePath = path.join(harnessDir, "templates.json");
  const backupDir = path.join(harnessDir, "templates-backup");
  const builtInIds = new Set(Object.keys(builtins || {}));

  // Keep an in-memory cache so hot requests don't hit disk repeatedly.
  // Invalidation is coarse: every write resets it.
  let _cache = null;

  function _ensureDirs() {
    if (!fs.existsSync(harnessDir)) fs.mkdirSync(harnessDir, { recursive: true });
  }

  function _readRaw() {
    if (_cache) return _cache;
    try {
      if (!fs.existsSync(filePath)) {
        _cache = {};
        return _cache;
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        _cache = {};
        return _cache;
      }
      // Defensive: drop anything that isn't a valid custom id. The server
      // re-runs the upload validator before merging, but a corrupt file
      // shouldn't break startup.
      const cleaned = {};
      for (const [id, template] of Object.entries(parsed)) {
        if (typeof id !== "string" || !CUSTOM_ID_RE.test(id)) continue;
        if (!template || typeof template !== "object") continue;
        cleaned[id] = template;
      }
      _cache = cleaned;
      return _cache;
    } catch (_) {
      // Corrupt JSON — fall back to empty rather than crashing the server.
      _cache = {};
      return _cache;
    }
  }

  function _writeRaw(next) {
    _ensureDirs();
    // Back up the previous manifest so manual recovery is possible if a
    // legitimate template is accidentally overwritten.
    if (fs.existsSync(filePath)) {
      try {
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        fs.copyFileSync(filePath, path.join(backupDir, `${stamp}.json`));
      } catch (_) { /* best-effort */ }
    }
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf-8");
    fs.renameSync(tmp, filePath);
    _cache = next;
  }

  return {
    filePath,
    backupDir,

    /**
     * Return the custom-template map only (no built-ins). Used by tests
     * and the UI to render the "custom" section of the selector.
     */
    listCustom() {
      return { ..._readRaw() };
    },

    /**
     * Return the full merged template map: built-ins first, then customs
     * overlaid on top. Built-in ids can NEVER be overridden (validator
     * rejects them upstream), but we double-check here.
     */
    listAll() {
      const custom = _readRaw();
      const merged = { ...(builtins || {}) };
      for (const [id, template] of Object.entries(custom)) {
        if (builtInIds.has(id)) continue; // paranoia: built-ins stay intact
        merged[id] = template;
      }
      return merged;
    },

    isCustomId(id) {
      return typeof id === "string" && CUSTOM_ID_RE.test(id);
    },

    isBuiltinId(id) {
      return builtInIds.has(id);
    },

    /**
     * Upsert a validated template. Caller is expected to have run
     * `validateTemplateUpload` from requestSchemas.js first — this store
     * does not re-validate shape, only id legality.
     */
    upsert(template) {
      if (!template || typeof template !== "object" || !template.id) {
        throw new Error("upsert: template must have an id");
      }
      if (!CUSTOM_ID_RE.test(template.id)) {
        throw new Error(`upsert: id must match /^custom-[a-z0-9_-]{1,40}$/`);
      }
      if (builtInIds.has(template.id)) {
        throw new Error(`upsert: cannot overwrite built-in template: ${template.id}`);
      }
      const next = { ..._readRaw(), [template.id]: template };
      _writeRaw(next);
      return { id: template.id, savedAt: Date.now() };
    },

    remove(id) {
      if (!CUSTOM_ID_RE.test(id)) {
        throw new Error(`remove: not a custom id: ${id}`);
      }
      const current = _readRaw();
      if (!(id in current)) return false;
      const next = { ...current };
      delete next[id];
      _writeRaw(next);
      return true;
    },

    /**
     * For tests: wipe the custom map entirely.
     */
    _resetForTest() {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
      _cache = null;
    },
  };
}

module.exports = { createTemplateStore, CUSTOM_ID_RE };
