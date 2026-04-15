// P0-2 — File access sandbox.
//
// Three primitives:
//   - isInside(root, candidate)           → bool, pure path math
//   - resolveInside(root, ...segments)    → joined absolute path, throws EPATHESCAPE on escape
//   - realpathInside(root, candidate)     → fs.realpathSync then containment check,
//                                           returns null on ENOENT, throws EPATHESCAPE
//                                           on symlink/absolute escape
//
// Windows is case-insensitive on the filesystem, so containment compares are
// lower-cased on win32. On POSIX hosts compares are exact.

const fs = require("fs");
const path = require("path");

function normalizeForCompare(p) {
  const abs = path.resolve(p);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

function isInside(root, candidate) {
  if (!root || !candidate) return false;
  const r = normalizeForCompare(root);
  const c = normalizeForCompare(candidate);
  if (c === r) return true;
  return c.startsWith(r + path.sep);
}

function pathEscapeError(message) {
  const err = new Error(message);
  err.code = "EPATHESCAPE";
  return err;
}

function resolveInside(root, ...segments) {
  const rAbs = path.resolve(root);
  const combined = path.resolve(rAbs, ...segments);
  if (!isInside(rAbs, combined)) {
    throw pathEscapeError(
      `path_escape: ${combined} is outside sandbox ${rAbs}`
    );
  }
  return combined;
}

function realpathInside(root, candidate) {
  const rAbs = path.resolve(root);
  let real;
  try {
    real = fs.realpathSync(path.resolve(candidate));
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
  if (!isInside(rAbs, real)) {
    throw pathEscapeError(
      `path_escape: realpath ${real} escapes sandbox ${rAbs}`
    );
  }
  return real;
}

module.exports = { isInside, resolveInside, realpathInside };
