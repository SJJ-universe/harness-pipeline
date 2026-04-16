// Pipeline template routes
const { Router } = require("express");

function createTemplateRoutes({ pipelineTemplates }) {
  const router = Router();

  router.get("/pipeline/templates", (req, res) => {
    res.json(pipelineTemplates);
  });

  router.get("/pipeline/templates/:id", (req, res) => {
    const template = pipelineTemplates[req.params.id];
    if (template) {
      res.json(template);
    } else {
      res.status(404).json({ error: "Template not found" });
    }
  });

  return router;
}

module.exports = { createTemplateRoutes };
