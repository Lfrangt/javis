# Verification: Gemini-pane AX targeting fix

- **Date:** 2026-06-18
- **Author:** Claude (Opus) — verifier lane, collaborating with Codex (which owns the `electron/main.cjs` fix)
- **Pairs with:** `docs/issues/2026-06-17-gemini-pane-ax-targeting.md`
- **Harness:** `scripts/verify-ax-targeting.mjs`

## How to run

JAVIS must be running (resident or `npm run desktop`). Focus the app you want to
test (for the real case: Chrome with the Gemini pane docked on the right, on a
**live, non-discarded** tab), then:

```bash
# read-only smoke test; skips Gemini-specific assertions unless Chromium is frontmost
npm run verify:ax

# strict Chrome/Gemini acceptance mode
npm run verify:ax -- --require-chromium

# read-only: reads the AX tree, previews the set_value target, performs nothing
node scripts/verify-ax-targeting.mjs

# target a specific phrasing
node scripts/verify-ax-targeting.mjs --instruction "type into the Gemini box"

# actually type + verify (needs Level 3 local exec enabled)
node scripts/verify-ax-targeting.mjs --execute --content "hello from JAVIS"
npm run verify:ax -- --execute --content "hello from JAVIS"

# machine-readable
node scripts/verify-ax-targeting.mjs --json
```

Token/port are auto-discovered the same way as `scripts/doctor.mjs`
(`JAVIS_API_TOKEN[_FILE]`, `Runtime/api-token`, `JAVIS_API_PORT`).

## What each check maps to (issue fixes A–E)

| Check | Issue fix | Pass means |
|-------|-----------|------------|
| `AX tree read` | — | `/api/accessibility/tree` returns nodes |
| `Fix A · Chromium web AX activated` | A | `chromiumAccessibilityActivated === true` on Chromium frontmost |
| `Fix B · walk budget reaches editables` | B | tree not truncated (right-docked composer not starved) |
| `Fix D · editable composer exposed with label` | D | an editable node with a composer-like label (gemini/ask/message) is present |
| `Target selection (plan)` | B/D | `/api/accessibility/plan` recommends an editable, not no_target |
| `Fix C · set_value resolves the editable` | C | `/api/accessibility/control` (preview) resolves a settable target, not `no_target` |
| `Fix E · execute + verify` | E | `--execute` types and the value is verified (focus-gated, never blind) |

## Field findings (runtime, 2026-06-18)

Run against the live resident service at `http://127.0.0.1:3417`:

1. **Fix A confirmed working at runtime.** With Chrome frontmost,
   `chromiumAccessibilityActivated === true` — `AXManualAccessibility` /
   `AXEnhancedUserInterface` is being set before the read. Good.
2. **Budget 240/9 is not a perf regression on normal trees.** Native/small trees
   (ghostty ~10 nodes, a normal page) read well under the 12s snapshot timeout.
3. **Open edge case — discarded Chrome tabs hang the AX read.** Reading a
   **suspended/discarded** Chrome tab ("闲置标签页 · 已释放 N MB", web content
   process released) produced `accessibility_tree_read_timeout` on the control
   path while the tree itself reported only ~30 shallow nodes. This is
   environmental, not the core Gemini fix, but worth a small robustness pass:
   - detect a discarded tab (shallow `AXWebArea` + the "已释放/Discarded" hint) and
     return a clear recovery hint ("reload the tab, then retry") instead of a 12s
     hang, **or**
   - lower the snapshot timeout for the control/plan path and retry once.

## Status of the core fix (to confirm once Codex's diff lands)

The real acceptance test (issue's Acceptance criteria) must be run by a human on a
**live** Chrome tab with the Gemini pane docked right and privacy mode on:

- `GET /api/accessibility/tree` exposes the Gemini composer with a usable role + label.
- `POST /api/accessibility/control {action:"set_value"}` (preview) resolves **that**
  node, not `no_target` / a wrong field.
- `--execute` types into the Gemini input and the value re-read verifies it.
- No regression on native (non-Chromium) targeting; Chrome not left stuck in
  screen-reader mode.

Run `node scripts/verify-ax-targeting.mjs --execute` on that page to check all of
the above in one shot.
