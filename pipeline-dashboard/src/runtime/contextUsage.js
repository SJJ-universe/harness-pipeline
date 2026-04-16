function extractContextUsage(payload = {}) {
  const candidates = [
    payload.context_usage,
    payload.contextUsage,
    payload.usage?.context,
    payload.usage?.context_usage,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const used =
      Number(candidate.used ?? candidate.input_tokens ?? candidate.tokens ?? candidate.current);
    const limit = Number(candidate.limit ?? candidate.max ?? candidate.capacity);
    if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) {
      const ratio = used / limit;
      return { used, limit, ratio, percent: Math.round(ratio * 100) };
    }
  }
  return null;
}

function alarmForUsage(usage) {
  if (!usage) return null;
  if (usage.ratio >= 0.95) return { level: "block", message: "context usage is above 95%" };
  if (usage.ratio >= 0.85) return { level: "suggest_compaction", message: "context usage is above 85%" };
  if (usage.ratio >= 0.70) return { level: "warning", message: "context usage is above 70%" };
  return null;
}

module.exports = { alarmForUsage, extractContextUsage };
