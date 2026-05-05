# Harness i18n conventions

**Slice I18N-DOC-1 (Phase 2 v2 follow-up, 2026-05-05)**

The harness UI is bilingual (Korean default + English alternative).
Translations live in two flat-object tables:

- `public/js/i18n/ko.js` — Korean values
- `public/js/i18n/en.js` — English values

Three test files enforce the contract:

- `tests/unit/i18n.coverage.test.js` (Slice I, v5)
- `tests/unit/i18n.placeholder-parity.test.js` (I18N-PARITY-1-a)
- `tests/unit/i18n.translation-quality.test.js` (I18N-PARITY-2-a)

This doc is the **human-readable companion** to those tests. New
committers should read this before adding any i18n key. Future
edits to the rules go here AND in the test files in the same
commit.

---

## §1 Key naming

Keys are **dot-namespaced** so related UI surfaces cluster
alphabetically:

```
header.title
btn.codexVerify
btn.codexVerify.title
smart.rec.systemReady.title
smart.rec.systemReady.body
smart.rec.systemReady.cta
policyPack.modeId.standard
policyPack.modeId.public-sector
```

**Conventions**:
- Use camelCase within a segment: `codexVerify`, not `codex_verify`
- Top-level segment is the feature/panel: `smart` / `policyPack` /
  `header`
- Reserve well-known suffixes:
  - `.title` — primary heading
  - `.body` — body text / description
  - `.cta` — call-to-action button label
  - `.aria` — ARIA label (screen-reader-only)
  - `.eng` — explicit English-only variant (e.g.
    `prod.mode.simple.eng = "Simple"`)
- Avoid hyphens in segment names (collision with placeholder regex)

**Bad examples** (rejected by tests):
- `Header.title` (uppercase top segment)
- `header-title` (hyphen splits namespace)
- `header.title.` (trailing dot)
- `header..title` (consecutive dots)

---

## §2 Adding a new key

Add to **both** `ko.js` and `en.js` in the same commit. The coverage
test (`i18n.coverage.test.js`) fails immediately if either is missing.

**Workflow**:
1. Decide the key name (use existing namespace if applicable)
2. Add to `ko.js` with the Korean value
3. Add to `en.js` with the English value (same key, English text)
4. Run `npm run test:unit -- tests/unit/i18n.*` to verify

**Example**:
```js
// ko.js
"smart.rec.newRule.title": "새 추천 카드",
"smart.rec.newRule.body":  "이런 작업이 필요합니다.",

// en.js
"smart.rec.newRule.title": "New recommendation card",
"smart.rec.newRule.body":  "This work is needed.",
```

---

## §3 Placeholders

Templated values use `{name}` syntax. Substitution is done by
`HarnessI18n.t(key, params)`.

**Regex**: `/\{(\w+)\}/g` — letters, digits, underscores only.

**Examples**:
```js
// Single placeholder
"smart.rec.resolveApprovals.title": "승인 요청 {count}개 대기 중"
HarnessI18n.t("...", { count: 3 })  // → "승인 요청 3개 대기 중"

// Multiple placeholders
"policyPack.altDiff.fromHeader": "현재 ({label})"
HarnessI18n.t("...", { label: "Standard" })  // → "현재 (Standard)"
```

**Rules** (enforced by `i18n.placeholder-parity.test.js`):

- Per-key placeholder set parity: `ko[K]` and `en[K]` must use the
  **exact same placeholder names**
- Placeholder names must match `\w+` (no spaces, no hyphens)
- Casing must match across locales: `{mode}` in ko + `{Mode}` in en
  is a bug (substitution would silently fail in en)
- No "looks like placeholder but isn't" patterns: `{ mode }`,
  `{tool-name}`, `{}` are caught and rejected

**Bad examples**:
```js
ko: "{mode} 모드"
en: "{m} mode"           // ← placeholder name drifted
```

```js
ko: "{ count } items"    // ← spaces inside braces invalidate
en: "{count} items"
```

---

## §4 Translation quality

Rules enforced by `i18n.translation-quality.test.js`:

### §4.1 Translated values must use the right script

If `ko[K] !== en[K]`:
- `ko[K]` must contain at least one Hangul character (가–힣)
- `en[K]` must contain at least one Latin letter (A-Z, a-z)

This catches the "ko table got accidentally overwritten with en
value" regression.

### §4.2 Differential rule

If `ko[K] !== en[K]`:
- `hangulRatio(ko[K]) > hangulRatio(en[K])` (strict greater-than)

Real translations make ratios diverge naturally. Equal ratios
on different values is suspicious.

### §4.3 ko === en carve-out

When `ko[K] === en[K]`, the rules above are skipped. This tolerates
legitimate cases:

- **Pure English proper nouns**: "English", "Simple", "Pro",
  "Standard", "Codex READY"
- **Korean product terms used in both locales**: "일반사용자",
  "전문사용자"
- **URLs**: "https://docs.anthropic.com/...",
  "https://github.com/openai/codex#authentication"
- **Schema strings**: "JSON (schema: src/templates/...)"

If you find yourself wanting to add a key where `ko === en` outside
these patterns, reconsider — you might be losing a translation.

### §4.4 Forbidden content

These patterns are rejected in either locale's values:

- **Translator placeholders**: `\bTODO\b`, `\bFIXME\b`, `\bXXX\b`,
  `\bTBD\b`, `\bTKTK\b` (case-insensitive)
- **HTML tags**: any `<tag...>` pattern (UI builds DOM from values
  as plain text; HTML in values would either render literal or
  pose injection risk if a panel inadvertently uses innerHTML)
- **Leading/trailing whitespace**: panels concat with explicit
  separators

---

## §5 Sanity thresholds

Beyond per-key rules, two table-level thresholds catch large-scale
regressions:

| Threshold | Rule | What it catches |
|---|---|---|
| `≥ 200 keys` | Total key count must not drop below 200 | Block-level deletion (someone removed an entire feature's i18n) |
| `< 20% identical` | `ko[K] === en[K]` for fewer than 20% of keys | Block-level sync (ko table got overwritten with en values, or vice versa) |
| `≤ 10 symbols-only` | ko entries with no Hangul AND no Latin (just symbols like "▶ ✓") capped at 10 | Misuse of i18n keys as symbol storage |

---

## §6 Test runner workflow

When adding or editing i18n keys:

```bash
cd pipeline-dashboard
npm run test:unit -- tests/unit/i18n
```

This runs all 3 i18n test files. Each gives structured failure
messages:

- `i18n.coverage`: lists missing keys per locale
- `i18n.placeholder-parity`: collects ALL drift in one fail message
  (not fail-fast — fix all in one commit)
- `i18n.translation-quality`: lists every Hangul/Latin violation
  with from→to detail

---

## §7 Adding new locales

The harness today supports `ko` + `en` only. If a future round adds
`ja` or `zh`:

1. Add `public/js/i18n/<locale>.js` with the same key set
2. Update `i18n.coverage.test.js` to compare 3+ locales
3. Update `i18n.placeholder-parity.test.js` to verify placeholder
   parity across all locales
4. Update `i18n.translation-quality.test.js` to verify locale-
   specific script (Japanese kana / kanji ranges, Chinese CJK
   ranges)
5. Update `public/js/i18n.js` to load the new locale and expose
   `HarnessI18n.setLocale("ja")`

This is a **structural change**, not a key-add — coordinate with
the test contract owners before shipping.

---

## §8 Common pitfalls

These mistakes are caught by the tests but are easy to make:

| Mistake | Caught by | Fix |
|---|---|---|
| Forget to add the key to en.js | `i18n.coverage` | Add it |
| Use `{Mode}` in en but `{mode}` in ko | `i18n.placeholder-parity` | Pick one casing globally |
| Type the value in the wrong locale | `i18n.translation-quality` | Swap them |
| Leave "TODO: translate" in a value | `i18n.translation-quality` | Translate it |
| Add a hyphen to a placeholder name | `i18n.placeholder-parity` | Use `_` or camelCase |
| Add HTML markup in a value | `i18n.translation-quality` | Keep values plain text |

---

## §9 References

- `tests/unit/i18n.coverage.test.js` (Slice I, v5)
- `tests/unit/i18n.placeholder-parity.test.js` (I18N-PARITY-1-a)
- `tests/unit/i18n.translation-quality.test.js` (I18N-PARITY-2-a)
- `public/js/i18n.js` — runtime `HarnessI18n.t()` implementation
- `public/js/i18n/ko.js` — Korean table
- `public/js/i18n/en.js` — English table

Closeout reports for context:
- `docs/reports/2026-05-05-i18n-parity-1-eval.md`
- `docs/reports/2026-05-05-i18n-parity-2-eval.md`
