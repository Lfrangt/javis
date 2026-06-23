# Issue: AX set_value fails end-to-end on contenteditable composers (index drift + non-deterministic read)

- **Reported:** 2026-06-22
- **Reporter:** Claude (Opus) — verifier lane, end-to-end acceptance of the Gemini-pane fix
- **Pairs with:** `docs/issues/2026-06-17-gemini-pane-ax-targeting.md` (original) and
  `docs/issues/2026-06-18-ax-targeting-verification.md` (harness)
- **Component:** Accessibility execute path (`electron/main.cjs` — `controlCurrentApp`,
  `runAccessibilityNodeAction`)
- **Severity:** Medium — the safety guard fails **closed** (refuses to act, never types
  into the wrong element), so this is a robustness/feature-completeness gap, not a
  safety defect.
- **For:** Codex (owns the AX code; lazy-web-hint read + tiered strategy already landed)

## What was tested

The original issue's acceptance criterion — "typed text lands in the composer and is
verified" — had never been run end-to-end. I built a controlled reproduction instead of
relying on a live Gemini pane:

```bash
# a contenteditable composer (role=textbox, empty AXValue, aria-label "Ask JAVIS"),
# i.e. the same shape as the Gemini composer
open -a "Google Chrome" /tmp/javis_ax_test.html   # see reproduction below
npm run verify:ax -- --require-chromium --execute \
  --instruction "type into the Ask JAVIS box" --content "hello from JAVIS acceptance"
```

## Two intermittent failure modes (both observed on the same page)

1. **`accessibility_role_changed:AXGroup`** — the planner resolved a target at BFS index
   N (with `expectedRole`), but the execute re-walk found a different role (`AXGroup`) at
   index N and the guard correctly refused.
2. **`no_target`** — on other reads the composer node is not exposed at all, so the plan
   recommends `no_target`.

Both are non-deterministic: consecutive reads of the *same* page disagree.

## Root cause (code-grounded)

Two independent AX reads, addressed by walk index, over a non-deterministic substrate:

- `controlCurrentApp` does a **plan** snapshot (`accessibilityActionPlan` →
  `accessibilityTreeSnapshot`) and resolves `target.nodeId` = the 1-based BFS index.
- `runAccessibilityNodeAction` then does a **separate** re-walk and resolves the node by
  that same index, guarding with `expectedRole`/`expectedLabel`.
- Between the two reads, Chrome's web AX tree shifts (contenteditable composers re-layout
  on focus; lazy web-content exposure varies read to read). Index N no longer maps to the
  same element → `accessibility_role_changed`. When the web area is exposed shallowly that
  read, the composer is absent entirely → `no_target`.

The lazy-web-hint tiered read (`readLazyWebHints`) correctly fixed the *per-node cost*
finding from 2026-06-18; it does not address cross-read **index drift**, which is a
separate axis.

## Suggested fix (ranked)

### A. Single-pass resolve-and-act *(highest leverage)*
When `execute:true`, resolve the target **and** perform the action inside one `osascript`
invocation, so there is no second read to drift against. The planner's job becomes "does a
target exist + preview"; the executor re-resolves from scratch in the same pass it acts in.

### B. Stable-attribute re-resolution in the execute walk
Instead of trusting the index, re-find the target in the execute re-walk by matching a
stable signature (role + label + `AXDOMIdentifier` + placeholder), and only act when the
match is unambiguous. Fall back to `no_target` (not a wrong-node action) when ambiguous.
Keeps fail-closed safety while surviving small tree shifts.

### C. Retry-on-drift
On `accessibility_role_changed`/`no_target` during execute, re-snapshot once and re-resolve
(bounded, e.g. 1 retry) before giving up — cheap mitigation for transient layout shifts.

## Reproduction page (`/tmp/javis_ax_test.html`)

```html
<!doctype html><html><head><meta charset="utf-8"><title>JAVIS AX Acceptance</title></head>
<body>
<div id="composer" contenteditable="true" role="textbox" aria-label="Ask JAVIS"
     data-placeholder="Ask JAVIS"></div>
<p>Composer value: <span id="state">(empty)</span></p>
<script>const c=document.getElementById('composer');
c.addEventListener('input',()=>{document.getElementById('state').textContent=c.textContent||'(empty)'});</script>
</body></html>
```

## Acceptance (re-run after fix)

`npm run verify:ax -- --require-chromium --execute` against the page above should reach
`Fix E · execute + verify` = PASS: the composer is targeted, typed into via the keystroke
fallback, and the value re-read (or confirmed focus) verifies it — with no
`accessibility_role_changed` / `no_target` flake across repeated runs.

## Note

The current behavior is **safe** — the `expectedRole` guard prevents typing into the wrong
element. This report is about making the feature *complete* (actually land text on the
contenteditable case it was built for), not about a safety hole.
