// Skill registry routes
const { Router } = require("express");

function createSkillRoutes({ scanSkills, getSkillsByCategory, getSkillsForHarness, getSkillContent, searchSkills }) {
  const router = Router();

  router.get("/skills", (req, res) => {
    if (req.query.category === "grouped") {
      res.json(getSkillsByCategory());
    } else if (req.query.q) {
      res.json(searchSkills(req.query.q));
    } else {
      res.json(scanSkills());
    }
  });

  router.get("/skills/:id", (req, res) => {
    const content = getSkillContent(req.params.id);
    if (content) {
      res.json({ id: req.params.id, content });
    } else {
      res.status(404).json({ error: "Skill not found" });
    }
  });

  router.get("/skills/harness/:type", (req, res) => {
    res.json(getSkillsForHarness(req.params.type));
  });

  return router;
}

module.exports = { createSkillRoutes };
