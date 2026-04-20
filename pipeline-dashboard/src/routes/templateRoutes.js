// Pipeline template routes — Slice E (v4) extended.
//
// Builds on the original GET endpoints with POST / DELETE for user-uploadable
// templates. Authentication (x-harness-token) is handled by the outer auth
// middleware; this module only enforces shape + id rules.
//
// Contract:
//   GET    /api/pipeline/templates         → { ...builtins, ...customs }
//   GET    /api/pipeline/templates/:id     → single template (built-in or custom)
//   POST   /api/pipeline/templates         → upsert a custom template
//                                            body: { id, name, phases }
//                                            returns: { id, savedAt }
//   DELETE /api/pipeline/templates/:id     → delete a custom template (404 if
//                                            id is built-in or missing)
//
// Each write fires a `template_registry_reloaded` broadcast so connected
// browsers know to refresh their selector list via GET.

const { Router } = require("express");
const { validateTemplateUpload, validateTemplateId } = require("../security/requestSchemas");

function createTemplateRoutes({ pipelineTemplates, templateStore, broadcast, onRegistryChange }) {
  const router = Router();

  // Resolver: if a store is injected we ask it for the merged view so custom
  // templates show up alongside built-ins. Falling back to the static map
  // keeps existing tests/fixtures that pre-date Slice E working unchanged.
  function _listAll() {
    return templateStore ? templateStore.listAll() : pipelineTemplates;
  }

  router.get("/pipeline/templates", (req, res) => {
    res.json(_listAll());
  });

  router.get("/pipeline/templates/:id", (req, res) => {
    const templates = _listAll();
    const template = templates[req.params.id];
    if (template) {
      res.json(template);
    } else {
      res.status(404).json({ error: "Template not found" });
    }
  });

  // Write endpoints only exist when a store is wired. Without one the
  // dashboard operates in read-only mode (e.g. replay mode, or legacy
  // deployments).
  if (templateStore) {
    router.post("/pipeline/templates", (req, res) => {
      let validated;
      try {
        validated = validateTemplateUpload(req.body);
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message });
      }
      // A user who somehow tries to re-upload a built-in id would have been
      // caught by validateTemplateUpload's regex, but double-check here so
      // future validator changes can't accidentally open this door.
      if (templateStore.isBuiltinId(validated.id)) {
        return res.status(400).json({ error: `cannot overwrite built-in template: ${validated.id}` });
      }
      try {
        const { id, savedAt } = templateStore.upsert(validated);
        if (typeof onRegistryChange === "function") {
          try { onRegistryChange({ kind: "upsert", id }); } catch (_) {}
        }
        if (broadcast) {
          broadcast({
            type: "template_registry_reloaded",
            data: { changed: id, kind: "upsert" },
          });
        }
        res.status(201).json({ id, savedAt });
      } catch (err) {
        res.status(500).json({ error: err.message || "upsert failed" });
      }
    });

    router.delete("/pipeline/templates/:id", (req, res) => {
      let id;
      try {
        id = validateTemplateId(req.params.id);
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message });
      }
      if (templateStore.isBuiltinId(id)) {
        return res.status(400).json({ error: `cannot delete built-in template: ${id}` });
      }
      try {
        const removed = templateStore.remove(id);
        if (!removed) return res.status(404).json({ error: "Template not found" });
        if (typeof onRegistryChange === "function") {
          try { onRegistryChange({ kind: "delete", id }); } catch (_) {}
        }
        if (broadcast) {
          broadcast({
            type: "template_registry_reloaded",
            data: { changed: id, kind: "delete" },
          });
        }
        res.status(204).end();
      } catch (err) {
        res.status(500).json({ error: err.message || "delete failed" });
      }
    });
  }

  return router;
}

module.exports = { createTemplateRoutes };
