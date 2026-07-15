#!/usr/bin/env node
"use strict";
// 하네스 파이프라인 라이브 데모 서버 — 의존성 0 (Node 내장 모듈만)
//
//   작업 AI(worker)와 비평 AI(critic)를 서로 다른 최저가 모델로 붙여
//   Phase A→F 파이프라인을 실행하고, 진행 상황을 SSE로 스트리밍한다.
//
//   실행:  OPENROUTER_API_KEY=... node server.js
//   또는:  OPENROUTER_KEY_FILE=C:\path\to\openR.env node server.js
//
// 키는 서버에만 있다. 브라우저로는 절대 내려가지 않는다.

const http = require("http");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------- 설정
const PORT = parseInt(process.env.PORT || "4300", 10);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

const API_KEY = (() => {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const f = process.env.OPENROUTER_KEY_FILE;
  if (f && fs.existsSync(f)) return fs.readFileSync(f, "utf-8").trim();
  return "";
})();

// 모델 체인 — 앞에서부터 시도, 429/5xx/빈 응답이면 다음 모델로 폴백.
// 기본값은 2026-07-15 기준 실측: 무료(0원) 2종 우선, 유료 전체 최저가로 마감.
const WORKER_MODELS = (process.env.WORKER_MODELS ||
  "qwen/qwen3-coder:free,google/gemma-4-26b-a4b-it:free,inclusionai/ling-2.6-flash"
).split(",").map((s) => s.trim()).filter(Boolean);
const CRITIC_MODELS = (process.env.CRITIC_MODELS ||
  "meta-llama/llama-3.3-70b-instruct:free,openai/gpt-oss-20b:free,mistralai/mistral-nemo"
).split(",").map((s) => s.trim()).filter(Boolean);

// 공개 데모 가드레일
const RUNS_PER_IP = parseInt(process.env.RUNS_PER_IP || "4", 10);       // 10분당 IP별
const IP_WINDOW_MS = 10 * 60 * 1000;
const DAILY_RUN_CAP = parseInt(process.env.DAILY_RUN_CAP || "150", 10); // 전역 일일
const TASK_MAX_CHARS = 400;
const PHASE_TIMEOUT_MS = 90_000;
const CTX_CLIP = 1200; // 이전 Phase 산출물을 다음 프롬프트에 넣을 때 자르는 길이

// ---------------------------------------------------------------- 파이프라인 정의
// allowedTools는 원본 하네스 policies/default-policy.json의 Phase 게이트를 그대로 옮긴 것.
const clip = (s) => (s && s.length > CTX_CLIP ? s.slice(0, CTX_CLIP) + "\n…(생략)" : s || "");

const WORKER_SYS =
  "너는 하네스 파이프라인 안에서 통제되는 '작업 AI'다. 현재 Phase에서 허용된 도구 밖의 행동은 정책 게이트가 차단한다. " +
  "모든 답변은 한국어로, 지시된 형식과 분량을 정확히 지켜라. 인사말과 사족은 금지.";
const CRITIC_SYS =
  "너는 작업 AI와 다른 모델로 구동되는 독립 '비평 AI'다. 작업 AI의 산출물에서 결함을 찾는 것이 유일한 임무다. " +
  "칭찬은 금지. 모든 답변은 한국어로, 지시된 형식과 분량을 정확히 지켜라.";

const PIPELINE = [
  {
    id: "A", name: "컨텍스트 수집", role: "worker", maxTokens: 450,
    tools: ["Read", "Glob", "Grep", "Agent", "TodoWrite"],
    prompt: (task) =>
      `작업 지시: "${task}"\n\n지금은 읽기 전용 단계다. 이 작업의 (1) 목표 (2) 제약·전제 (3) 구현 전에 확인해야 할 정보 2가지를 간결한 불릿 목록으로 정리하라. 전체 8줄 이내.`,
  },
  {
    id: "B", name: "계획 수립", role: "worker", maxTokens: 600,
    tools: ["Read", "Glob", "Grep", "TodoWrite", "Write"],
    prompt: (task, out) =>
      `작업 지시: "${task}"\n\nPhase A 정리:\n${clip(out.A)}\n\n단계별 실행 계획을 번호 목록으로 세워라. 각 단계는 무엇을 만들고 어떻게 검증하는지 한 줄씩. 마지막 줄은 "검증 기준:"으로 시작하는 한 줄. 전체 10줄 이내.`,
  },
  {
    id: "C", name: "계획 비평", role: "critic", maxTokens: 450,
    tools: [],
    prompt: (task, out) =>
      `작업 지시: "${task}"\n\n작업 AI가 세운 계획:\n${clip(out.B)}\n\n이 계획의 허점을 엣지케이스·보안·성능 관점에서 정확히 3가지 지적하라. 각 항목은 "[상|중|하] 지적 내용" 형식 한 줄. 전체 100단어 이내.`,
  },
  {
    id: "D", name: "계획 보완", role: "worker", maxTokens: 600,
    tools: ["Read", "Glob", "Grep", "TodoWrite", "Write", "Edit"],
    prompt: (task, out) =>
      `원래 계획:\n${clip(out.B)}\n\n비평 AI의 지적:\n${clip(out.C)}\n\n지적을 반영해 계획을 수정하라. 바뀐 부분에는 줄 끝에 "(보완)"을 붙여라. 번호 목록, 전체 10줄 이내.`,
  },
  {
    id: "E", name: "실행 — 코드 작성", role: "worker", maxTokens: 950,
    tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "TodoWrite"],
    prompt: (task, out) =>
      `작업 지시: "${task}"\n\n확정된 계획:\n${clip(out.D)}\n\n계획대로 단일 파일 코드를 작성하라. 주석은 한국어, 60줄 이내, 코드 블록(\`\`\`)으로만 답하라. 코드 밖 설명 금지.`,
  },
  {
    id: "F", name: "검증·판정", role: "critic", maxTokens: 450,
    tools: ["Read", "Bash", "Glob", "Grep"],
    prompt: (task, out) =>
      `작업 지시: "${task}"\n\n작업 AI가 제출한 코드:\n${clip(out.E)}\n\n코드를 검증하라. 첫 줄은 반드시 "판정: 적합" 또는 "판정: 보완 필요" 중 하나. 이어서 근거 3가지를 불릿으로, 마지막 줄에 개선 제안 1가지. 전체 8줄 이내.`,
  },
];

// ---------------------------------------------------------------- OpenRouter 호출
async function callChain(chain, system, user, maxTokens, signal) {
  let lastErr = "";
  for (const model of chain) {
    const started = Date.now();
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/SJJ-universe/harness-pipeline",
          "X-Title": "Harness Pipeline Demo",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: maxTokens,
          temperature: 0.4,
        }),
      });
      if (!res.ok) {
        lastErr = `${model}: HTTP ${res.status}`;
        continue; // 어떤 실패든 체인의 다음 모델로
      }
      const json = await res.json();
      const content = (json.choices?.[0]?.message?.content || "").trim();
      if (!content) { lastErr = `${model}: 빈 응답`; continue; }
      return {
        model,
        content,
        ms: Date.now() - started,
        tokens: json.usage ? (json.usage.prompt_tokens || 0) + (json.usage.completion_tokens || 0) : 0,
      };
    } catch (e) {
      if (signal?.aborted) throw new Error("aborted");
      lastErr = `${model}: ${e.message}`;
    }
  }
  throw new Error(`모든 모델 폴백 실패 (${lastErr})`);
}

// ---------------------------------------------------------------- 가드레일 상태
const ipHits = new Map(); // ip -> [timestamps]
let dailyCount = 0;
let dailyDate = new Date().toDateString();

function checkLimits(ip) {
  const today = new Date().toDateString();
  if (today !== dailyDate) { dailyDate = today; dailyCount = 0; }
  if (dailyCount >= DAILY_RUN_CAP) return "오늘 데모 사용량이 모두 소진되었습니다. 내일 다시 시도하세요.";
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= RUNS_PER_IP) return "요청이 너무 잦습니다. 10분 후 다시 시도하세요.";
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) ipHits.clear(); // ponytail: 단순 메모리 상한, 필요해지면 LRU
  dailyCount++;
  return null;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// ---------------------------------------------------------------- SSE 파이프라인 실행
async function handleRun(req, res) {
  if (!API_KEY) return sendJson(res, 503, { error: "서버에 OPENROUTER_API_KEY가 설정되지 않았습니다." });
  if (process.env.DEMO_DISABLED === "1") return sendJson(res, 503, { error: "데모가 일시 중지 상태입니다." });

  const limitMsg = checkLimits(clientIp(req));
  if (limitMsg) return sendJson(res, 429, { error: limitMsg });

  let body = "";
  req.setEncoding("utf-8");
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2048) return sendJson(res, 413, { error: "요청이 너무 큽니다." });
  }
  let task = "";
  try { task = String(JSON.parse(body).task || ""); } catch { /* fallthrough */ }
  task = task.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ").trim();
  if (task.length < 4 || task.length > TASK_MAX_CHARS)
    return sendJson(res, 400, { error: `작업 지시는 4~${TASK_MAX_CHARS}자여야 합니다.` });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  const abort = new AbortController();
  req.on("close", () => abort.abort());

  send("run_meta", {
    phases: PIPELINE.map((p) => ({ id: p.id, name: p.name, role: p.role, tools: p.tools })),
    workerChain: WORKER_MODELS, criticChain: CRITIC_MODELS,
  });

  const out = {};
  let totalTokens = 0;
  try {
    for (const phase of PIPELINE) {
      if (abort.signal.aborted) break;
      const chain = phase.role === "worker" ? WORKER_MODELS : CRITIC_MODELS;
      send("phase_start", { id: phase.id, name: phase.name, role: phase.role, tools: phase.tools });

      const timer = setTimeout(() => abort.abort(), PHASE_TIMEOUT_MS);
      const result = await callChain(
        chain, phase.role === "worker" ? WORKER_SYS : CRITIC_SYS,
        phase.prompt(task, out), phase.maxTokens, abort.signal
      );
      clearTimeout(timer);

      out[phase.id] = result.content;
      totalTokens += result.tokens;
      // 지시 내용은 서버 로그에 남기지 않는다 — 길이와 소요시간만.
      console.log(`[run] phase=${phase.id} model=${result.model} ms=${result.ms} tokens=${result.tokens}`);
      send("phase_done", {
        id: phase.id, model: result.model, ms: result.ms,
        tokens: result.tokens, content: result.content,
      });
    }
    if (!abort.signal.aborted) {
      const verdictLine = (out.F || "").split("\n")[0] || "";
      send("run_done", {
        verdict: /적합/.test(verdictLine) && !/보완/.test(verdictLine) ? "PASS" : "REVISE",
        verdictLine, totalTokens,
      });
    }
  } catch (e) {
    if (!abort.signal.aborted) send("run_error", { error: e.message });
  } finally {
    clearInterval(ping);
    res.end();
  }
}

// ---------------------------------------------------------------- 정적 서빙 + 라우팅
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

function sendJson(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": buf.length });
  res.end(buf);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) return sendJson(res, 404, { error: "not found" });
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/health")
    return sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  if (req.method === "GET" && url.pathname === "/api/config")
    return sendJson(res, 200, {
      workerChain: WORKER_MODELS, criticChain: CRITIC_MODELS,
      dailyRemaining: Math.max(0, DAILY_RUN_CAP - dailyCount), keyConfigured: Boolean(API_KEY),
    });
  if (req.method === "POST" && url.pathname === "/api/run") return void handleRun(req, res);
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(res, url.pathname);
  sendJson(res, 405, { error: "method not allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`harness demo listening on http://${HOST}:${PORT} (key: ${API_KEY ? "configured" : "MISSING"})`);
});
