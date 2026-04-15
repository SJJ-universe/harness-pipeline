const fs = require("fs");
const path = require("path");

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", "coverage",
]);

function discoverContextFiles(projectRoot) {
  const files = [];

  // 1. Root-level docs
  for (const name of ["CLAUDE.md", "ARCHITECTURE.md", "README.md", ".cursorrules"]) {
    const p = path.join(projectRoot, name);
    if (fs.existsSync(p)) {
      files.push({ path: p, type: "root-doc", name, size: fs.statSync(p).size });
    }
  }

  // 2. .claude/ directory
  const claudeDir = path.join(projectRoot, ".claude");
  if (fs.existsSync(claudeDir)) {
    // CLAUDE.md inside .claude/
    const claudeMd = path.join(claudeDir, "CLAUDE.md");
    if (fs.existsSync(claudeMd)) {
      files.push({ path: claudeMd, type: "claude-config", name: ".claude/CLAUDE.md", size: fs.statSync(claudeMd).size });
    }

    // launch.json
    const launch = path.join(claudeDir, "launch.json");
    if (fs.existsSync(launch)) {
      files.push({ path: launch, type: "launch-config", name: ".claude/launch.json", size: fs.statSync(launch).size });
    }

    // settings.json
    const settings = path.join(claudeDir, "settings.json");
    if (fs.existsSync(settings)) {
      files.push({ path: settings, type: "settings", name: ".claude/settings.json", size: fs.statSync(settings).size });
    }

    // agents/
    const agentsDir = path.join(claudeDir, "agents");
    if (fs.existsSync(agentsDir)) {
      try {
        for (const f of fs.readdirSync(agentsDir)) {
          if (f.endsWith(".md")) {
            const ap = path.join(agentsDir, f);
            files.push({ path: ap, type: "agent", name: `.claude/agents/${f}`, size: fs.statSync(ap).size });
          }
        }
      } catch (_) {}
    }

    // memory/
    const memoryDir = path.join(claudeDir, "memory");
    if (fs.existsSync(memoryDir)) {
      const memIndex = path.join(memoryDir, "MEMORY.md");
      if (fs.existsSync(memIndex)) {
        files.push({ path: memIndex, type: "memory", name: ".claude/memory/MEMORY.md", size: fs.statSync(memIndex).size });
      }
    }
  }

  // 3. docs/ or documentation/ directory
  for (const docDir of ["docs", "documentation", "doc"]) {
    const dp = path.join(projectRoot, docDir);
    if (fs.existsSync(dp) && fs.statSync(dp).isDirectory()) {
      try {
        const docFiles = fs.readdirSync(dp).filter((f) => f.endsWith(".md"));
        for (const f of docFiles.slice(0, 10)) {
          const fp = path.join(dp, f);
          files.push({ path: fp, type: "documentation", name: `${docDir}/${f}`, size: fs.statSync(fp).size });
        }
      } catch (_) {}
    }
  }

  // 4. Tech stack detection
  const techStack = detectTechStack(projectRoot);

  return { files, techStack, projectRoot };
}

function detectTechStack(projectRoot) {
  const stack = { languages: [], frameworks: [], tools: [] };

  // package.json
  const pkgPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    stack.languages.push("javascript");
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps.typescript) stack.languages.push("typescript");
      if (allDeps.react) stack.frameworks.push("react");
      if (allDeps.next) stack.frameworks.push("nextjs");
      if (allDeps.vue) stack.frameworks.push("vue");
      if (allDeps.express) stack.frameworks.push("express");
      if (allDeps.jest || allDeps.vitest || allDeps.mocha) stack.tools.push("testing");
      if (allDeps.prisma || allDeps["@prisma/client"]) stack.tools.push("prisma");
      if (allDeps.docker || fs.existsSync(path.join(projectRoot, "Dockerfile"))) stack.tools.push("docker");
    } catch (_) {}
  }

  // Python
  for (const pyFile of ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"]) {
    if (fs.existsSync(path.join(projectRoot, pyFile))) {
      stack.languages.push("python");
      break;
    }
  }

  // Go
  if (fs.existsSync(path.join(projectRoot, "go.mod"))) stack.languages.push("go");

  // Rust
  if (fs.existsSync(path.join(projectRoot, "Cargo.toml"))) stack.languages.push("rust");

  // Docker
  if (fs.existsSync(path.join(projectRoot, "Dockerfile")) || fs.existsSync(path.join(projectRoot, "docker-compose.yml"))) {
    stack.tools.push("docker");
  }

  // CI/CD
  if (fs.existsSync(path.join(projectRoot, ".github", "workflows"))) stack.tools.push("github-actions");
  if (fs.existsSync(path.join(projectRoot, ".gitlab-ci.yml"))) stack.tools.push("gitlab-ci");

  return stack;
}

function loadFileContent(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    // Truncate very large files
    return content.length > 10000 ? content.slice(0, 10000) + "\n...(truncated)" : content;
  } catch (_) {
    return null;
  }
}

module.exports = { discoverContextFiles, detectTechStack, loadFileContent };
