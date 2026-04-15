const fs = require("fs");
const path = require("path");
const { resolveInside } = require("./executor/path-guard");

const SKILLS_DIR = path.join(process.env.HOME || process.env.USERPROFILE, ".claude", "skills");
const CATEGORIES_FILE = path.join(__dirname, "skill-categories.json");

let cachedSkills = null;
let cachedCategories = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

function loadCategories() {
  if (!cachedCategories) {
    cachedCategories = JSON.parse(fs.readFileSync(CATEGORIES_FILE, "utf-8"));
  }
  return cachedCategories;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep > 0) {
      const key = line.slice(0, sep).trim();
      const val = line.slice(sep + 1).trim().replace(/^["']|["']$/g, "");
      fm[key] = val;
    }
  }
  return fm;
}

function scanSkills() {
  const now = Date.now();
  if (cachedSkills && now - cacheTime < CACHE_TTL) return cachedSkills;

  const skills = [];
  try {
    const dirs = fs.readdirSync(SKILLS_DIR);
    for (const dir of dirs) {
      const skillPath = path.join(SKILLS_DIR, dir, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;

      try {
        const content = fs.readFileSync(skillPath, "utf-8");
        const fm = parseFrontmatter(content);
        skills.push({
          id: dir,
          name: fm.name || dir,
          description: fm.description || "",
          path: skillPath,
        });
      } catch (_) {
        skills.push({ id: dir, name: dir, description: "", path: skillPath });
      }
    }
  } catch (_) {}

  cachedSkills = skills;
  cacheTime = now;
  return skills;
}

function getSkillsByCategory() {
  const skills = scanSkills();
  const cats = loadCategories();
  const result = {};

  for (const [catId, cat] of Object.entries(cats.categories)) {
    result[catId] = {
      label: cat.label,
      icon: cat.icon,
      description: cat.description,
      skills: cat.skills
        .map((sid) => skills.find((s) => s.id === sid))
        .filter(Boolean),
    };
  }

  // Uncategorized
  const allCategorized = new Set(
    Object.values(cats.categories).flatMap((c) => c.skills)
  );
  const uncategorized = skills.filter((s) => !allCategorized.has(s.id));
  if (uncategorized.length > 0) {
    result.other = {
      label: "Other",
      icon: "📁",
      description: "미분류 스킬",
      skills: uncategorized,
    };
  }

  return result;
}

function getSkillsForHarness(harnessType) {
  const cats = loadCategories();
  const skills = scanSkills();
  const mapping = cats.harnessMapping[harnessType] || [];
  return mapping.map((sid) => skills.find((s) => s.id === sid)).filter(Boolean);
}

function getSkillContent(skillId) {
  let skillPath;
  try {
    skillPath = resolveInside(SKILLS_DIR, skillId, "SKILL.md");
  } catch (e) {
    if (e && e.code === "EPATHESCAPE") return null;
    throw e;
  }
  try {
    return fs.readFileSync(skillPath, "utf-8");
  } catch (_) {
    return null;
  }
}

function searchSkills(query) {
  const skills = scanSkills();
  const q = query.toLowerCase();
  return skills.filter(
    (s) =>
      s.id.includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
  );
}

module.exports = {
  scanSkills,
  getSkillsByCategory,
  getSkillsForHarness,
  getSkillContent,
  searchSkills,
};
