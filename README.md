# JAVIS

Local Mac-first realtime desktop buddy.

## What works in this first build

- Realtime voice loop through OpenAI Realtime WebRTC.
- Resident full-screen capture from macOS with no per-session window picker.
- Live screen-context injection into the active Realtime voice session.
- Soft wake-word behavior inside live voice sessions through `JAVIS_WAKE_WORDS`.
- Wake trigger API for plugging in a local wake-word engine without changing the Realtime flow.
- Resident conversation lifecycle state for connecting/live/error/idle voice sessions, with heartbeats back into presence.
- Silent Realtime preflight context so each voice session starts with current presence, app/browser, screen-frame freshness, work status, and guardrails.
- Silent Realtime work-progress sync while voice is live, so background Codex/Claude/deep tasks stay in context without interrupting the conversation.
- Private screen mode that downscales/blurs frames before they leave the renderer.
- Mac context: frontmost app/window, clipboard summary, active jobs, and pending approvals.
- Passive ambient observe mode: local-only current app/window, browser page metadata, and optional private screen-frame refresh without intervention.
- Local inferred learning profile distilled from passive ambient metadata without calling a model.
- Resident presence state: standby/watching/wake/work/attention status with the latest passive context and intervention guardrails.
- Browser context: supported frontmost browser tab title and URL.
- Browser page reader: read selected text, headings, visible page text, and visible links from supported active tabs.
- Browser control: guarded back/forward/reload/new-tab/close-tab/address/search/open-url actions for supported active browsers.
- Browser DOM control: read visible clickable/fillable page controls through Apple Events or Chrome DevTools, then guarded click/fill/select one element.
- Browser workflows: summarize, extract actions, draft, ask about the current page, search/compare result pages with structured candidate links, open and review one selected result, or synthesize across multiple result pages through quick or background lanes.
- File workflows: list/search local folders, summarize allowed files, ask file-specific questions, or plan folder organization through quick/background lanes.
- Voice-driven current-app control: one tool plans and executes a single click/toggle/fill action through the Accessibility tree and guarded action policy.
- Multi-step local app workflows: preview or execute short sequences such as open app, wait, press UI target, type text, hotkey, and file/Mac actions with one workflow record.
- Current-state app workflow planning: observe frontmost app, Accessibility tree, and screen metadata to turn a natural request into previewable local workflow steps.
- Local task router: picks quick, deep, Codex, or Claude lane before executing or queueing work, with relevant explicit memory context.
- No-model local command router for resident status, screen refresh/observation, Inbox capture/listing, opening apps/URLs, web search, and narrow app workflows such as opening TextEdit/Notes/Obsidian and typing short text when API/model lanes are unavailable.
- Fast lane for lightweight Q&A.
- Deep lane for slower background tasks with persisted logs and cancellation.
- Background CLI tool runner for explicit local commands such as `gh`, `git`, `npm`, Codex CLI, and Claude Code without blocking the voice lane.
- Workflow history for recent browser, voice, and background work.
- Local work briefing for recent progress, blockers, active work, and next actions.
- Local work progress check-ins for background jobs and workflows.
- Unified work-next step that safely chooses one next action across setup, approvals, sessions, Inbox, jobs, and workflows.
- Local work sessions for focus goals, session notes, resume-from-history handoff, automatic evidence from Inbox/jobs/workflows/approvals, spoken check-ins, and deterministic end-of-session summaries.
- Local memory for user-approved preferences, project facts, and durable notes.
- Local Inbox for clipboard/manual captures and pending follow-up items.
- Read-only Inbox triage for prioritizing captures and suggesting quick/background/Codex/Claude lanes.
- Explicit Inbox "do next" processing that sends the highest-priority open capture into the task router.
- Inbox-to-task routing for turning captures into quick/background/Codex/Claude work.
- Continue-from-history workflow routing for follow-up tasks.
- Delegation slots for Codex and Claude Code with visible worker output.
- Small reversible Mac actions: open URL and open app by default.
- Guarded file actions: write files, create folders, copy files, and move/rename files through policy, approval, and local-execution gates.
- Clipboard actions: read, write, and clear clipboard text through policy/audit.
- Tiny draggable always-on-top desktop buddy window.
- Compact pet mode by default; configuration lives in the terminal CUI instead of the desktop pet.
- Pet click starts or stops the realtime voice + screen-context session when the API key is configured.
- Non-intrusive window parking with configurable corner/display placement from the terminal CUI.
- macOS menu bar status item for resident controls and setup shortcuts.
- Global pet park hotkey, defaulting to `Control+Shift+Space`.
- Global clipboard-to-Inbox capture hotkey, defaulting to `Control+Shift+I`.
- Resident system notifications for approvals and background task completion.
- Voice mode defaults to open mic from the pet, with push-to-talk plumbing still available internally.
- Setup/config diagnostics for `.env`, permissions, resident mode, policy, and local workers.
- Setup guide and one-step fix action for opening the current most important blocker.
- Local setup actions for preparing `.env` and opening macOS permission/runtime locations.
- Resident login-start install helper with LaunchAgent status.

High-permission actions such as typing into the active app and hotkeys are disabled until `JAVIS_ENABLE_LOCAL_EXEC=true` is set.

## Run

```bash
cp .env.example .env
npm run config
npm run dev
```

Use the terminal CUI to paste `OPENAI_API_KEY` locally. It hides the input, writes only to `.env`, and can restart the resident service so the key is loaded. Do not paste API keys into chat.

The same CUI can explicitly toggle `JAVIS_ENABLE_LOCAL_EXEC` for Level 3 local actions after typing `ENABLE` or `DISABLE`.
It can also enable `JAVIS_TRUSTED_LOCAL_MODE` after typing `TRUST`; this acknowledges that automatic Level 3 local actions are intentional while Level 4 sends, purchases, deletes, form submissions, and account changes still require confirmation.
The CUI also exposes next-work execution, overnight autopilot status, one-tick manual advance, learning refresh, inferred-memory save, and the `JAVIS_AUTOPILOT_ENABLED` toggle for unattended low-risk recovery work.

Local file policy lives in `~/Library/Application Support/JAVIS/Runtime/action-policy.json`; broad Home-directory access can be enabled there while protected macOS folders may still need Full Disk Access approval.

macOS will ask for microphone and screen recording permissions the first time those features are used.

## Resident Mode

For a login-start version that runs from the built app instead of the Vite dev server:

```bash
npm run resident:install
```

Install/restart first stops stale JAVIS Electron processes from this project and any project-owned listener on the configured API port, so the LaunchAgent does not leave an older API server behind.

To remove it:

```bash
npm run resident:uninstall
```

## Architecture

```text
Electron renderer
  minimal desktop pet
        |
        v
Local Express service on 127.0.0.1:3417
  /api/health           -> resident server health and storage state
  /api/readiness        -> setup, permission, policy, and runtime checks
  /api/config/check     -> setup files, resident mode, permissions, policy, and worker readiness
  /api/config/open-cui  -> open the terminal configuration window
  /api/doctor/report    -> complete maintenance self-check report
  /api/setup/guide      -> setup blocker guide and next local action
  /api/setup/next       -> open the current most important setup target
  /api/sessions         -> local work session list/start/resume/event/check-in/end
  /api/setup/actions    -> low-risk local setup helpers
  /api/resident/status  -> LaunchAgent install/load status
  /api/window/state     -> pet mode, position, and global hotkey status
  /api/window/park      -> move the buddy back to its configured corner
  /api/window/move      -> move the buddy to explicit screen coordinates
  /api/menubar/state    -> macOS menu bar status item state
  /api/notifications/state -> resident notification support and counters
  /api/briefing         -> local status, blockers, recent work, and next actions
  /api/work/progress    -> spoken-style job/workflow progress check-in
  /api/work/next        -> preview or execute one safe next workbench action
  /api/jobs             -> persisted background job history
  /api/workflows        -> persisted workflow history with linked jobs and results
  /api/workflows/continue -> continue the latest or specified prior workflow
  /api/workflows/copy-result -> copy the latest or specified workflow result to clipboard
  /api/memory           -> local memory list/search/create/delete
  /api/learning/remember -> save the inferred learning profile into local memory
  /api/inbox            -> local persistent capture inbox
  /api/inbox/capture-clipboard -> capture current clipboard text into Inbox
  /api/inbox/triage     -> read-only Inbox priority and lane suggestions
  /api/inbox/process-next -> explicitly process the highest-priority open Inbox item
  /api/inbox/:id/route  -> route an Inbox item into quick/deep/Codex/Claude work
  /api/jobs/:id/cancel  -> stop queued/running background work
  /api/audit/recent     -> recent structured audit events
  /api/actions/policy   -> local automation policy
  /api/actions/execute  -> execute guarded local actions
  /api/observe          -> combined fast observation for voice: Mac context, screen, Accessibility, jobs, approvals
  /api/mac/context      -> frontmost app, clipboard summary, queue, approvals
  /api/ambient          -> recent passive local observation metadata
  /api/ambient/sample   -> take one passive local observation sample
  /api/learning         -> local inferred profile from ambient metadata
  /api/learning/distill -> refresh the local inferred profile now
  /api/presence         -> resident standby/watch/work state and latest passive context
  /api/conversation/state -> resident voice conversation lifecycle state
  /api/realtime/context -> silent preflight context for new voice sessions
  /api/wake/status      -> soft/local wake-word trigger state
  /api/wake/trigger     -> trigger voice start from a local wake engine
  /api/accessibility/tree -> read-only frontmost app UI tree
  /api/accessibility/plan -> dry-run UI control plan from the accessibility tree
  /api/accessibility/control -> plan and execute one guarded current-app UI action
  /api/app/plan        -> observe current state, plan steps, and optionally execute
  /api/app/workflow    -> preview or execute a short multi-step local app workflow
  /api/browser/context  -> supported browser tab title and URL
  /api/browser/page     -> read-only current browser page text and link extraction
  /api/browser/control  -> guarded current-browser navigation actions
  /api/browser/javascript -> browser JavaScript bridge status
  /api/browser/dom      -> read visible clickable/fillable page controls
  /api/browser/dom-action -> guarded webpage element click/fill/select
  /api/browser/workflow -> summarize, extract actions, draft, ask, act, search, compare, review one result, or research multiple result pages
  /api/cli/run          -> queue an explicit local CLI command as a background job
  /api/files/execute    -> local file tool execution
  /api/files/plan       -> preview a policy-aware folder organization plan
  /api/files/plan/apply -> request confirmed execution/approvals for a file plan
  /api/files/workflow   -> local file/folder workflows and organization plans
  /api/approvals        -> local action approval queue
  /api/realtime/session  -> OpenAI Realtime WebRTC session
  /api/chat/quick        -> fast model lane
  /api/screen/describe   -> vision lane over latest screen frame
  /api/screen/capture-now -> resident-side screen frame refresh
  /api/screen/privacy    -> screen context privacy mode
  /api/tasks/route       -> local command + quick/deep/Codex/Claude task routing
  /api/tasks             -> background / Codex / Claude queue
  /api/tools/execute     -> tools called by the realtime model
  /api/window/mode       -> pet sizing compatibility endpoint
```

The realtime model stays focused on short interaction. `observe_now` combines the usual first-look context into one tool call: frontmost app/window, browser context, clipboard summary, latest or freshly captured screen metadata, optional vision summary, Accessibility outline, jobs, and approvals. When live context is enabled, the resident captures the full primary screen directly and adds that latest frame to the realtime conversation so follow-up voice commands can refer to what is visible without showing a window picker. `JAVIS_WAKE_ENGINE_CMD` can point at any local wake-word command; when that command prints `wake` or a configured wake word, the renderer sees `/api/wake/status` and starts the voice session. The renderer reports connecting/live/idle/error voice state and heartbeats to `/api/conversation/state`, so `/api/presence` can move from Watching to Connecting/Listening and back to Watching after the session ends. When a Realtime data channel opens, the renderer also sends one silent `/api/realtime/context` preflight message containing current presence, app/browser, screen-frame freshness, active work, next actions, and guardrails; this reduces first-turn tool latency and does not trigger a standalone answer. While voice stays live, the renderer polls `/api/work/progress` and sends silent work-progress updates only when active/background work changes, keeping Codex/Claude/deep task state available without interrupting. Screen privacy defaults to `private`, which downscales and blurs/pixelates frames before they are posted to the local API or Realtime session; API/CUI controls can switch to `clear` when precision matters. The passive ambient observer can keep local metadata about what app/browser page is active, but it does not speak or act by itself. `/api/presence` packages that passive state into a standby/watching/working/attention summary with the latest observed app/browser context and guardrails. When `JAVIS_AMBIENT_LEARNING=true`, the resident distills those local metadata events into a lightweight inferred profile: top apps, browser hosts, active hours, recent contexts, and a short summary. This distillation is local, model-free, and separate from explicit user-approved memory; only the aggregate summary/signals are eligible for prompt context when `JAVIS_INCLUDE_LEARNING_IN_PROMPTS=true`. The model can also ask for current Mac, resident presence, browser, browser DOM controls, file, local memory, local learning profile, local Inbox, local work sessions, local work briefing, work progress, session check-ins, or Accessibility UI-tree context, start/resume/log/end a work session, capture follow-up items into Inbox, triage Inbox priority/lane suggestions, explicitly process the next Inbox item, route Inbox items into task lanes, inspect recent workflow history, continue a prior workflow, copy a workflow result back to the clipboard, run current-page browser workflows, search/compare web result pages, review one selected result, synthesize multiple result pages, run local-file workflows, control one current-app UI target, click/fill/select one guarded webpage element, plan a workflow from current Mac state, execute a short local app workflow, or use the local router to decide whether a task should be answered quickly or queued to a deeper lane. The router first checks safe no-model local commands, so status, work progress, session resume/check-ins, Inbox capture/listing/triage/next processing, app/URL opens, and web search still work when model lanes are unavailable. The router and manual task queue include relevant explicit memories and the local inferred profile by default, and can disable this with `useMemory:false`. Guarded Accessibility execution is available through Level 3 `ax_press` and `ax_set_value` actions plus the higher-level `control_current_app`, `plan_app_workflow`, and `run_app_workflow` voice tools, guarded browser DOM execution is available through Level 3/4 `dom_click`, `dom_fill`, and `dom_select`, and guarded file execution is available through Level 3 write/create/copy/move actions; all require policy checks, approval when configured, and local execution enablement. File organization has a two-step flow: preview the plan first, then request apply with explicit confirmation. Harder work is put into the queue so spoken conversation stays responsive, and running workers can be inspected or cancelled from the CUI/API.

## Long-Term Direction

- [Goal](docs/GOAL.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Safety](docs/SAFETY.md)
- [Operations](docs/OPERATIONS.md)
- [Reference notes](docs/REFERENCE_NOTES.md)
