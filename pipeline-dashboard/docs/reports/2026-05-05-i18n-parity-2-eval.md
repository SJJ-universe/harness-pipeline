# I18N-PARITY-2 — Round closeout (2026-05-05)

**Score**: 120/126 (maintained — see §Cap movement decision)
**Round id**: I18N-PARITY-2
**Plan reference**: §S §S-next-after — "Translation-quality detection — Hangul-in-ko / Latin-in-en mechanical checks (deferred from I18N-PARITY-1)"
**Slices shipped**: I18N-PARITY-2-a / I18N-PARITY-2-b

This round extends the I18N-PARITY-1 placeholder-consistency gate
with **content-quality** checks. The translation-loss class had two
known sub-classes:
1. `{placeholder}` drift — closed by I18N-PARITY-1
2. **Forgotten translations** — ko table accidentally has en value (or
   vice versa) — closed by **this round**

---

## What this round shipped

### I18N-PARITY-2-a — translation-quality + 11 tests

**Files**:
- `tests/unit/i18n.translation-quality.test.js` (NEW, ~290 lines)

**The 11 tests**:

| # | Category | Test | Catches |
|---|---|---|---|
| 1 | Headline | Every translated ko has Hangul | ko["x"] = "Hello" (forgotten translation) |
| 2 | Headline | Every translated en has Latin | en["x"] = "안녕" (en overwritten with ko) |
| 3 | Headline | hangulRatio(ko) > hangulRatio(en) when values differ | Subtler "both have Hangul but ko isn't more Korean" cases |
| 4 | Defensive | No TODO/FIXME/XXX/TBD/TKTK markers | Translator placeholders escaping to production |
| 5 | Defensive | No HTML tags | Plain-text invariant; UI does escaping |
| 6 | Defensive | ko symbols-only ≤ 10 keys | Misuse of i18n keys as symbol storage |
| 7-10 | Anchor | hangulRatio / latinRatio / HANGUL_RE / LATIN_RE behavior | Helpers themselves don't drift |
| 11 | Sanity | Differential rule rejects synthetic bug | The differential rule actually works |

**The "if ko === en, skip" carve-out** is the key design decision —
it tolerates legitimate cases:
- Pure English proper nouns: "English", "Simple", "Pro", "Standard", "Codex READY"
- Korean product terms used in both locales: "일반사용자", "전문사용자"
- URLs: "https://docs.anthropic.com/..."
- Schema strings: "JSON (schema: src/templates/...)"

At authoring time, **0 violations** across all 3 headline rules and
221+ keys. The existing translation table is healthy; this round
establishes the gate so future drift fails fast.

### I18N-PARITY-2-b — closeout + scorecard + sync (this slice)

This file is the closeout. The scorecard trajectory entry is inserted
above the I18N-PARITY-1 banner. `scripts/sync-scorecard.js` refreshes
auto-derived markers (test counts now `3574 unit / 553 integration`
vs `3563 / 553`).

---

## End-to-end behavior change

| Before I18N-PARITY-2 | After I18N-PARITY-2 |
|---|---|
| ko["x"] = "Hello" (overwritten from "안녕"), en["x"] = "Hello". Existing tests pass. Korean operators see "Hello" everywhere. Bug invisible. | Same scenario → fails fast: "1 ko entry(ies) appear to be untranslated (differ from en but contain no Hangul): - 'x': ko='Hello' en='Hello'" |
| Translator placeholders ("TODO: translate") could survive to production | TODO/FIXME/XXX/TBD/TKTK markers detected and reported per locale |
| HTML tags in i18n values silently render as literal text or pose injection risk | Plain-text invariant enforced; no HTML tags allowed |

The harness now has **three complementary i18n gates**:

1. `i18n.coverage.test.js` (Slice I, v5): key set parity + non-empty
2. `i18n.placeholder-parity.test.js` (I18N-PARITY-1): placeholder set parity + suspicious-brace + casing
3. `i18n.translation-quality.test.js` (this round): Hangul/Latin content + differential + TODO/HTML defensive

---

## Test counts + CI

| Suite | Pre-I18N-PARITY-2 | Post-I18N-PARITY-2 | Δ |
|---|:---:|:---:|:---:|
| unit | 3563 | 3574 | +11 |
| integration | 553 | 553 | 0 |
| smoke | 90 | 90 | 0 |
| readiness | 18/18 | 18/18 | 0 |

---

## Cap movement decision — 120/126 maintained

I18N-PARITY-2 ships a tests-only gate. Same rubric position as the
prior 6 follow-up rounds. Honest score remains 120/126.

---

## 5 decisions worth re-reading

1. **The "if ko === en" carve-out**: 10 keys legitimately have
   identical values across locales (proper nouns, product terms,
   URLs, schema strings). Forcing every key to differ would
   require a curated exception list — fragile + maintenance burden.
   The differential check (hangulRatio) handles the remaining
   cases naturally.
2. **Strict `>` not `>=`** in differential test: equal Hangul
   ratios with different values is suspicious (text differs but
   Korean-density is identical?). Real translations make ratios
   diverge.
3. **HANGUL_RE limited to precomposed syllable block (가–힣)**: don't
   need Jamo (ㄱ–ㅎ) — translation values use composed syllables;
   isolated Jamo would be a separate (rarer) signal worth its own
   check.
4. **LATIN_RE strict ASCII**: don't include Latin-1 punctuation or
   extended Latin (é, ü). Harness en values are vanilla ASCII;
   tightening the test catches "en got mojibaked into UTF-8 garbage"
   as a side effect.
5. **TODO marker list explicit**: TODO / FIXME / XXX / TBD / TKTK.
   These are common translator placeholders; the explicit list
   prevents `\bWIP\b` (legitimate work-in-progress) from being
   flagged.

---

## What's deferred / out of scope

- **Translation-quality across multiple locales** — today only ko + en
- **Pluralization quality** — i18n doesn't use ICU plural forms today
- **Profanity / inappropriate content detection** — out-of-scope linguistic check
- **Tone consistency** — does ko consistently use formal vs casual
  speech levels? Hard to mechanically detect.

---

## Per plan §S §S-next-after

After this commit + push, the trajectory shows I18N-PARITY-2 above
I18N-PARITY-1 (paired theme: parity → quality).

Next-round candidates:
- **POL-UI-2 pack switch UI** — runtime mutation, high blast radius
- **Operator runs `harness-start.bat` in production for ≥1 week**
- **External reviewer engagement** — apparatus is fully ready
- **Pixel-diff visual testing** — Playwright/Puppeteer
- **Multi-summary aggregation tool**
