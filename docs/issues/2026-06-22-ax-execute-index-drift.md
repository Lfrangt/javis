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

## Update 2026-06-23 — fix C landed; read-timeout is the remaining blocker

Fix C (retry-on-drift) is implemented in `controlCurrentApp` (commit
`5df2079`): on an execute-time `accessibility_role_changed` / `no_target`, it
re-snapshots once (220ms settle) and re-resolves. Verified firing via the
`accessibility_control.no_target_retry` / `…drift_retry` audit events.

But end-to-end acceptance on a **busy** desktop still fails for a more
fundamental reason the retry cannot fix: **`accessibility_tree_read_timeout`**.
On a heavy Chrome (many tabs + competing frontmost apps), the JXA/System Events
walk can't finish within the timeout, so there is no tree to resolve a target
from, and re-snapshotting at the same budget just times out again. Two
observations:

1. Retry-on-drift only helps when the read *succeeds* but the node moved; it is
   useless against a read that never completes.
2. Suggested follow-ups for the read-timeout (Codex owns the read path):
   - ~~On timeout, retry at a reduced budget~~ — **measured and ruled out.**
   - Longer term, the per-node Apple-Event cost is the wall; a native
     `AXUIElement` C-API path (helper) would remove the JXA ceiling entirely.

### Data: `scripts/ax-read-budget-scan.mjs` (run on heavy Chrome, 1 run/budget)

```
budget   avgMs   nodes   composer
 40/6     6084     40       no
 60/8    13081     60       no
 80/10    8625     80       no
```
(120+ returned 0 nodes — Chrome lost frontmost mid-scan; the ~40s sweep outlasts
focus stability on this desktop.)

Two hard numbers: **~150 ms per node** via System Events/JXA, and the composer is
**not reached even at 80 nodes** because Chrome's browser chrome (toolbar/tabs)
fills the first BFS nodes before the web area. So a *reduced*-budget retry is a
dead end — the budget that completes under the timeout (≤~60 nodes) does not
reach the composer, and the budget that reaches it (>120 nodes) cannot complete
in time. The only real fix is to remove the per-node Apple-Event overhead: a
native `AXUIElement` C-API helper (or rooting the walk at `AXWebArea` /
`AXFocusedUIElement` to skip the browser-chrome nodes entirely). Re-run
`node scripts/ax-read-budget-scan.mjs` with a stable single-app target to confirm.

### PROVEN FIX: root the walk at `AXWebArea` (`scripts/ax-webarea-poc.js`)

A standalone JXA PoC that descends to the Chromium `AXWebArea` and BFS-walks from
there, on the same heavy Chrome + contenteditable composer:

```
{"app":"Google Chrome","webAreaFound":true,"findMs":224,"scanMs":221,
 "nodesScanned":3,"composer":{"role":"AXTextArea","scanned":3}}
```

The composer is reached in **3 nodes / ~0.4s total** (224ms to locate the
`AXWebArea` + 221ms to BFS to the composer), versus **8.6s and never reached** from
the window root at an 80-node budget. The contenteditable composer sits ~3 levels
under `AXWebArea`; the window-rooted BFS burns its whole budget on toolbar/tab
chrome before it ever descends into web content.

**Recommended implementation (Codex, AX read path):** in
`accessibilityTreeSnapshot`, when the frontmost app `isChromiumApp`, locate the
`AXWebArea` (shallow descent, cap depth ~12) and use it as the BFS root for web
targets (optionally union with a small pass over native chrome for back/forward
etc.). Keep the existing window-root walk for non-Chromium apps. This removes the
read-timeout wall for the Gemini/contenteditable case entirely and makes the
retry-on-drift (fix C, already landed) actually reach a target to retry against.
PoC is `scripts/ax-webarea-poc.js` — run it with Chrome frontmost to reproduce.

Also note: interactive AX testing on this machine is unreliable because
Chrome/Codex/League keep stealing frontmost between activate and read
(`no_frontmost_app`). A stable single-app target is needed to get a clean PASS.
