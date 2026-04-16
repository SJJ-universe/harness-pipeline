// Context discovery & load routes
const { Router } = require("express");

function createContextRoutes({
  REPO_ROOT,
  validateContextDiscover,
  validateContextLoad,
  resolveInsideRoot,
  discoverContextFiles,
  loadFileContent,
}) {
  const router = Router();

  router.post("/context/discover", (req, res) => {
    let parsed;
    try {
      parsed = validateContextDiscover(req.body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    let projectRoot;
    try {
      projectRoot = parsed.projectRoot
        ? resolveInsideRoot(parsed.projectRoot, REPO_ROOT, { mustExist: true, purpose: "projectRoot" })
        : REPO_ROOT;
    } catch (err) {
      return res.status(err.code === "PATH_OUTSIDE_ROOT" ? 403 : 400).json({ error: err.message });
    }
    const context = discoverContextFiles(projectRoot);
    res.json(context);
  });

  router.post("/context/load", (req, res) => {
    let parsed;
    let safePath;
    try {
      parsed = validateContextLoad(req.body);
      safePath = resolveInsideRoot(parsed.filePath, REPO_ROOT, { mustExist: true, purpose: "filePath" });
    } catch (err) {
      return res.status(err.code === "PATH_OUTSIDE_ROOT" ? 403 : (err.status || 400)).json({ error: err.message });
    }
    const content = loadFileContent(safePath);
    if (content !== null) {
      res.json({ filePath: safePath, content });
    } else {
      res.status(404).json({ error: "File not found" });
    }
  });

  return router;
}

module.exports = { createContextRoutes };
