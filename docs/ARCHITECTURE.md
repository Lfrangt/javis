# JAVIS Architecture

## Current Shape

```text
Electron process
  Local Express API
  Global pet hotkey
  Global clipboard capture hotkey
  macOS menu bar status item
  Terminal config CUI opener
  Resident notification bridge
  Readiness and diagnostics
  Config check diagnostics
  Setup guide and next-action opener
  Doctor self-check report
  Realtime session broker
  Persistent cancellable task queue
  Persistent workflow history
  Local work briefing
  Unified work-next dispatcher
  Local work session store
  Local explicit memory store
  Local Inbox store
  Structured audit log
  Mac action bridge
  Mac context and clipboard bridge
  Browser context bridge
  Accessibility UI-tree bridge
  Current-app control bridge
  App workflow planner
  App workflow bridge
  Desktop buddy window

Renderer
  Minimal pet UI and voice toggle
  Window-state sync
  Voice connection with push-to-talk
  Screen capture
  Screen privacy transform
  Live screen context sync into Realtime
```

## Lanes

- Realtime lane: fast speech-to-speech interaction, short replies, tool calls, started or stopped from the minimal pet when configured.
- Pet session lane: one click starts voice and requests screen sharing, then pushes the first permitted screen frame into Realtime context.
- Push-to-talk lane: keeps resident voice from becoming an always-open microphone.
- Global hotkey lane: brings the desktop pet back without requiring app focus.
- Capture hotkey lane: saves current clipboard text into local Inbox without opening desktop UI.
- Menu bar lane: resident macOS status item for opening the terminal CUI, parking the pet, seeing current blockers, and jumping to setup locations.
- Config CUI lane: terminal-first setup surface for `.env`, permissions, doctor output, and parking the pet.
- Notification lane: macOS notifications for pending approvals and completed, failed, or cancelled background work.
- Vision lane: analyzes the latest permitted screen frame.
- Screen privacy lane: stores the resident screen privacy mode and makes the renderer downscale/blur frames before posting them to the API or Realtime.
- Live screen-context lane: sends periodic screen image messages into the active Realtime conversation without triggering standalone replies.
- Observe lane: combined low-latency voice snapshot over Mac context, optional resident screen capture, optional vision summary, Accessibility outline, jobs, and approvals.
- Presence lane: read-only standby/watch/work/attention state that packages ambient context, wake status, local learning, active work, and intervention guardrails for CUI/API/voice use.
- Fast text lane: lightweight Q&A.
- No-model local command lane: deterministic status, Inbox, open-app/open-URL, and web-search commands that run before model routing.
- Task router lane: local deterministic routing from casual requests to local commands, quick, background, Codex, or Claude lanes before execution, with relevant explicit memories attached to task context when model lanes are used.
- Background lane: slower higher-quality model work.
- Delegation lane: hands code or long tasks to Codex or Claude Code with streamed logs, PID tracking, and cancellation.
- Action lane: small local Mac actions, guarded by allowlists and confirmation.
- Context lane: frontmost app/window, clipboard summary, active jobs, and pending approvals.
- Config lane: repeatable `.env`, permissions, resident mode, policy, and worker readiness diagnostics.
- Setup guide lane: maps the current setup blockers to the next safe local action, such as opening `.env` or macOS permission settings.
- Doctor lane: one report that validates service health, setup, policy guards, resident mode, workers, storage, queue, workflows, and approvals.
- Browser context lane: current supported browser tab title and URL for webpage-aware tasks.
- Browser page lane: read-only extraction of selected text, headings, and visible page text from supported active tabs.
- Browser DOM lane: read-only visible control extraction plus guarded one-step click/fill/select actions inside supported active tabs, using browser Apple Events first and Chrome DevTools on `JAVIS_CHROME_DEBUG_PORT` as a fallback.
- Browser workflow lane: page-aware summarize, action extraction, drafting, and Q&A routed through quick or background lanes.
- Accessibility tree lane: read-only frontmost App UI structure for operating non-browser Mac apps through the accessibility model.
- UI planning lane: dry-run target selection and next-action plans from the current accessibility tree.
- Current-app control lane: voice/API wrapper that plans one UI target and executes a press or value write through the guarded local action path.
- App workflow planning lane: observes frontmost app/window, Accessibility tree, and latest screen metadata, then turns natural requests into previewable workflow steps.
- App workflow lane: short multi-step Mac workflows that sequence app opens, waits, hotkeys, typed text, current-app controls, browser DOM actions, and file/Mac actions into one auditable workflow record.
- Guarded UI action lane: Level 3 `AXPress` and value-setting actions through policy, approvals, role allowlists, and expected target checks.
- File workflow lane: policy-guarded local file/folder list, search, summarize, Q&A, and folder organization planning routed through quick or background lanes.
- File organization lane: deterministic by-type folder plans with per-step policy preview, explicit apply confirmation, and the same approval/local-execution gates before any move/copy/create action.
- Workflow history lane: user-level workflow records linked to jobs, targets, status, and results.
- Work briefing lane: deterministic status summary over readiness, jobs, workflows, approvals, memories, blockers, and suggested next actions.
- Work progress lane: deterministic spoken-style progress over active jobs, recent job results, active/blocked workflows, latest completions, and next actions.
- Work next lane: chooses and optionally runs exactly one safe next action across setup, approvals, sessions, Inbox, jobs, and workflows.
- Work session lane: local focus sessions with a goal, append-only notes/events, resume-from-history handoff, automatic evidence from Inbox/jobs/workflows/approvals, active-session status, spoken check-ins, and deterministic end summaries.
- Inbox lane: persistent local capture queue for clipboard/manual follow-ups that feeds the menu bar, CUI, work briefing, and task routing.
- Inbox triage lane: deterministic read-only priority sorting and lane suggestions over open captures, available from API, local command, voice tool, and panel.
- Inbox next-action lane: explicitly processes the highest-priority open capture by reusing the same Inbox router and marking the item done only when routing succeeds.
- Inbox routing lane: sends captured items through the same quick, background, Codex, or Claude router used by chat and voice, then marks successful captures done with route metadata.
- Workflow continuation lane: creates follow-up workflows from prior records, preserving parent workflow ids and target context.
- Workflow delivery lane: copies completed workflow results back to the system clipboard in result-only or Markdown format.
- Memory lane: user-approved local memories for durable preferences, project facts, and notes, with keyword search, task-context injection, and delete.
- Learning lane: optional local inferred profile distilled from passive ambient metadata, kept separate from user-approved memory.
- Clipboard lane: local clipboard read/write, guarded by policy and audit logs.
- File lane: local file list/read/search/write/create/copy/move, guarded by allowed roots, risk levels, approvals, local-execution enablement, and audit logs.

## Runtime State

By default, local runtime state lives in:

```text
~/Library/Application Support/JAVIS/
  Runtime/
    jobs.json
    workflows.json
    sessions.json
    memories.json
    learned-profile.json
    inbox.json
    audit.jsonl
    action-policy.json
    approvals.json
```

`jobs.json` preserves recent background jobs across restarts. Any job that was queued or running when the process exited is marked failed on next boot so the user can see that it was interrupted.

`workflows.json` preserves recent user-level workflows, such as current-page summaries or background browser tasks. Workflow records store target app/page metadata, status, linked job id, parent workflow id, request text, and result summary so JAVIS can explain, continue, or copy recent work back to the clipboard.

`sessions.json` preserves local work sessions. Session records store a goal, active/done/cancelled status, local events, source, tags, timestamps, and deterministic summaries. Only one active session is allowed at a time, and the active session is surfaced in status, menu bar, briefing, and the buddy panel.

`memories.json` preserves explicit local memories only when the user asks JAVIS to remember something. Memory records store text, kind, scope, tags, source, and timestamps, and can be searched or deleted through the local API.

`learned-profile.json` preserves the optional inferred local profile from ambient metadata. It stores aggregate app/browser/context patterns and a short local summary, not screenshots, clipboard text, or user-approved memory claims.

`inbox.json` preserves local Inbox captures for pending follow-up items. Records store title, body, status, priority, source, tags, route metadata, and timestamps. Open items feed the resident status, menu bar, buddy panel, briefing next-action list, read-only triage output, and explicit next-action processing; routed items retain the selected lane, queued job id when present, and a short output summary.

Running jobs keep their latest log in `jobs.json`. Codex and Claude workers are launched in their own process group so cancellation can stop the worker tree instead of only the shell wrapper.

`audit.jsonl` records structured process, job, tool, and local-action events for debugging and later replay/audit work.

`action-policy.json` controls which local actions can run automatically, which require approval, and whether actions should run in dry-run mode.

`approvals.json` stores pending and historical approvals for higher-risk local actions.

## Direction

The current MVP keeps API and desktop UI in one Electron process for speed. The long-term direction is to split them:

```text
javis-server
  local API, queue, tools, logs, permissions

javis-buddy
  transparent desktop companion UI

javis-workers
  Codex, Claude Code, browser, file, and app-specific task runners
```

This split lets the server stay resident even if the buddy UI is restarted.
