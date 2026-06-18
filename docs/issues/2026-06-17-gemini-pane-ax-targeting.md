# Issue: Gemini side-pane input not targetable via macOS Accessibility tree

- **Reported:** 2026-06-17
- **Reporter:** Khalil (field report)
- **Component:** Accessibility tree lane / current-app control lane (`electron/main.cjs`)
- **Severity:** Medium — blocks reliable `set_value` targeting in Chromium web content
- **For:** Codex / Claude Code investigation + fix

## Summary

On a mock-exam page in Google Chrome, the **right-side Gemini input field** is not exposed
(or not selectable) in the macOS Accessibility (AX) tree that JAVIS reads. As a result JAVIS
cannot reliably **select** that field as an action target. Blindly typing into whatever has
focus *sometimes* works, but deterministic target selection (`ax_set_value` on the Gemini
input) fails.

## Environment / context

- App under control: **Google Chrome** (Chromium web content, not native Cocoa UI).
- Page: mock-exam page with a **Gemini assistant pane docked on the right**.
- JAVIS **screen privacy mode is on** (`private`), so screen-frame context is downscaled/blurred
  and only a limited set of AX nodes is effectively visible to the planner.
- Observed behavior:
  - Typing into the currently focused field **sometimes works**.
  - **Target selection fails** — JAVIS can't find/pick the Gemini textarea node to act on.

## Why this happens (root cause, code-grounded)

The AX tree is read by JXA via System Events and walked with `uiElements()`:

- `accessibilityTreeSnapshot()` — `electron/main.cjs:2404`
- DFS walk + node/depth budget — `electron/main.cjs:2546` (`walk()`), guard `if (nodes.length >= maxNodes) return` at `:2547`
- Default budget — `read_accessibility_tree: { maxNodes: 120, maxDepth: 6 }` — `electron/main.cjs:101`
- `set_value` role allowlist — `['AXComboBox','AXSearchField','AXTextArea','AXTextField']` — `electron/main.cjs:108`
- Target scoring/label matching — `scoreAccessibilityNode()` / `matchedAccessibilityTokens()` — `electron/main.cjs:2675`, `:2688`

Five compounding causes:

1. **Chromium lazily exposes its web-content AX tree.** Chrome does not fully build the web-area
   accessibility tree for an AT client unless an assistive technology is detected, i.e. unless the
   AX attribute `AXManualAccessibility` (or `AXEnhancedUserInterface`) is set to `true` on the Chrome
   application element. JAVIS never sets this, so `System Events` often sees only the browser chrome
   (toolbar/tabs) plus a shallow/empty `AXWebArea`. → "only limited AX nodes are visible."

2. **Node/depth budget truncates before reaching the Gemini input.** The walk is depth-first with a
   hard `maxNodes: 120` / `maxDepth: 6` cap (`:101`, `:2547`). Chromium nests the actual editable far
   down: `AXWebArea → AXGroup → … → AXTextArea`. A docked Gemini pane on the **right** generally comes
   **later** in tree order, so the left-side exam content exhausts the 120-node budget first and the
   Gemini textarea is cut (`truncated: true`). Privacy mode makes the effective visible set even smaller.

3. **The Gemini input's AX role often isn't in the allowlist.** Gemini's composer is typically a
   `contenteditable` rich editor (a `<rich-textarea>`/`role="textbox"` web component), which can surface
   as `AXTextArea` — but in many builds it surfaces as a generic `AXGroup`/`AXStaticText` (or a textbox
   without the `AXTextArea` subrole). `ax_set_value` only accepts `AXComboBox/AXSearchField/AXTextArea/AXTextField`
   (`:108`), so even when the node *is* present it gets filtered out as a non-target.

4. **Label/placeholder text isn't matched.** Gemini's composer usually has an empty `AXName` and carries
   its hint in `AXPlaceholderValue` (e.g. "Ask Gemini"). `matchedAccessibilityTokens()` only reads
   `name/description/value` (`:2676`) — it never reads `AXPlaceholderValue`, `AXTitleUIElement`, or
   `AXDOMIdentifier`. So an instruction like "type into the Gemini box" matches **zero** tokens, the
   node's score is penalized (`:2695`), and it's not selected even when visible.

5. **Typing-to-active-field is a different path.** Keystroke typing goes through System Events
   `keystroke` (`electron/main.cjs:8465`), which targets whatever is focused regardless of AX node
   discovery. This is exactly why **typing sometimes works but target selection fails** — they don't
   share the same node-resolution logic.

## Reproduction

1. Open a Chrome page with the Gemini side pane docked on the right; focus is elsewhere.
2. Ensure JAVIS screen privacy mode is `private`.
3. `curl 'http://127.0.0.1:3417/api/accessibility/tree?maxNodes=120&maxDepth=6'`
   → observe `truncated: true`, a shallow/empty `AXWebArea`, and **no** `AXTextArea` for the Gemini composer.
4. `POST /api/accessibility/control {"instruction":"type into the Gemini box","action":"set_value","content":"hi","execute":false}`
   → `recommended.type: "no_target"` (or a wrong target).

## Suggested fixes (ranked)

### A. Activate Chromium web accessibility before reading the tree *(highest leverage)*
Before snapshotting when the frontmost app is a Chromium browser, set
`AXManualAccessibility = true` (and/or `AXEnhancedUserInterface = true`) on the app's AX element,
then read. This is what makes Chrome expose the full web AX tree to an AT client. Gate it to the
Chromium app list already in code (`electron/main.cjs:2306`, `:3150`, `:4511`) and consider resetting
it afterward to avoid leaving Chrome in screen-reader mode.

### B. Make the walker reach deep editables under privacy/limited conditions
- Raise `maxNodes`/`maxDepth` specifically for Chromium web content, **or** add a focused/targeted pass:
  after a shallow read, do a second bounded walk rooted at the `AXWebArea` (or the focused element via
  `AXFocusedUIElement`) so the Gemini composer isn't starved by left-side content.
- Prefer breadth toward focused/editable subtrees instead of pure left-to-right DFS so a docked
  right-side pane isn't always last.

### C. Recognize contenteditable / textbox roles as settable targets
- Extend `ax_set_value` `allowedRoles` (`:108`) to accept web textboxes: treat
  `AXTextArea`/`AXTextField` **plus** elements whose `roleDescription`/subrole indicate an editable
  textbox (e.g. role `AXGroup`/`AXStaticText` with `AXDOMRole`/`role=textbox` or `AXEditableText`).
- When the role is a web contenteditable, fall back to **focus + keystroke** (path at `:8465`) instead
  of `setValue`, since contenteditable nodes often reject AX `setValue`.

### D. Match placeholder/title/DOM hints
- In `readNode()` (`:2506`) also capture `AXPlaceholderValue`, `AXTitleUIElement` (its text),
  `AXDOMIdentifier`, and `AXDOMClassList`; include them in `accessibilityNodeSearchText()` (`:2652`)
  and `matchedAccessibilityTokens()` (`:2676`). This lets "Gemini" / "Ask Gemini" actually match.

### E. Honor focus + verify
- Ensure focus events are supported: set `AXFocused = true` on the resolved target (or `AXPress` to
  focus) before writing, and re-read the node's `value` after write to confirm the set succeeded
  (close the loop in `runAccessibilityNodeAction`, `electron/main.cjs:3518`).

## Acceptance criteria

- With the Gemini pane docked right and privacy mode on, `GET /api/accessibility/tree` exposes a
  node for the Gemini composer with a usable role + label.
- `POST /api/accessibility/control` with `action: "set_value"` resolves **that** node as the
  recommended target (not "no_target", not a wrong field) and, on `execute:true`, the typed text
  lands in the Gemini input and is verified by a value re-read.
- No regression to native-app (non-Chromium) targeting, and Chrome is not left stuck in
  screen-reader mode after the read.

## Notes for the investigator

- Quick confirmation of cause A: with Chrome frontmost, run
  `osascript -e 'tell application "System Events" to tell process "Google Chrome" to set value of attribute "AXManualAccessibility" to true'`
  then re-read the tree and check whether the `AXWebArea` now populates and the Gemini `AXTextArea`
  appears. If it does, A is the primary fix.
- All action paths must keep the existing Level 3 policy / approval / `JAVIS_ENABLE_LOCAL_EXEC`
  gates — see `docs/SAFETY.md`. No fix should bypass `ax_set_value` guards (`electron/main.cjs:3518`).
