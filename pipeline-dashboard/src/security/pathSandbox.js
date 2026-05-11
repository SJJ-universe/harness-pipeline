const fs = require("fs");
const path = require("path");

class PathSandboxError extends Error {
  constructor(message, code = "PATH_SANDBOX_ERROR") {
    super(message);
    this.name = "PathSandboxError";
    this.code = code;
  }
}

function realpathIfExists(targetPath) {
  try {
    return fs.realpathSync.native(targetPath);
  } catch (_) {
    return null;
  }
}

function normalizeRoot(root) {
  if (!root || typeof root !== "string") {
    throw new PathSandboxError("repo root must be a string", "BAD_ROOT");
  }
  const resolved = path.resolve(root);
  return realpathIfExists(resolved) || resolved;
}

function assertInsideRoot(resolvedPath, root) {
  const normalizedRoot = normalizeRoot(root);
  const relative = path.relative(normalizedRoot, resolvedPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolvedPath;
  }
  // Slice S2 (Phase 3-S): Windows-only case-insensitive belt-and-suspenders.
  // `path.relative` on Win32 is *usually* case-insensitive, but drive
  // letter casing edge cases ("C:\X" vs "c:\x") and prefix mismatches
  // (8.3 short names, mixed-case mounts) can still leak through as
  // bogus "../" results. Re-check with explicit lowercase containment
  // on Windows so a real-world filesystem with "C:\\Users\\SJ\\harness…"
  // and a candidate "c:\\users\\sj\\harness…\\file" is treated as the
  // same path.
  if (process.platform === "win32") {
    const candidate = String(resolvedPath).toLowerCase();
    const baseCi   = String(normalizedRoot).toLowerCase();
    const sepCi    = path.sep.toLowerCase();
    if (candidate === baseCi || candidate.startsWith(baseCi + sepCi)) {
      return resolvedPath;
    }
  }
  throw new PathSandboxError(
    `path escapes orchestrator root: ${resolvedPath}`,
    "PATH_OUTSIDE_ROOT"
  );
}

function resolveInsideRoot(inputPath, root, options = {}) {
  const { mustExist = false, purpose = "path" } = options;
  if (!inputPath || typeof inputPath !== "string") {
    throw new PathSandboxError(`${purpose} must be a non-empty string`, "BAD_PATH");
  }

  const normalizedRoot = normalizeRoot(root);
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(normalizedRoot, inputPath);

  if (mustExist && !fs.existsSync(candidate)) {
    throw new PathSandboxError(`${purpose} does not exist: ${candidate}`, "PATH_NOT_FOUND");
  }

  const existingReal = realpathIfExists(candidate);
  if (existingReal) return assertInsideRoot(existingReal, normalizedRoot);

  const parentReal = realpathIfExists(path.dirname(candidate));
  if (parentReal) assertInsideRoot(parentReal, normalizedRoot);
  return assertInsideRoot(candidate, normalizedRoot);
}

function isInsideRoot(inputPath, root) {
  try {
    resolveInsideRoot(inputPath, root);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  PathSandboxError,
  normalizeRoot,
  resolveInsideRoot,
  isInsideRoot,
};
