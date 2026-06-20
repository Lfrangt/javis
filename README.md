# JAVIS

Local Mac-first realtime desktop buddy.

## What works in this first build

- Realtime voice loop through OpenAI Realtime WebRTC.
- Resident full-screen capture from macOS with no per-session window picker.
- Live screen-context injection into the active Realtime voice session.
- Soft wake-word behavior inside live voice sessions through `JAVIS_WAKE_WORDS`.
- Wake trigger API for plugging in a local wake-word engine without changing the Realtime flow.
- Resident conversation lifecycle state for connecting/live/error/idle voice sessions, with heartbeats back into presence.
- Renderer-recorded Realtime SDP negotiation evidence, so successful or failed real WebRTC starts update `/api/realtime/evidence`.
- Renderer-recorded Realtime voice latency receipts for click-to-live, SDP negotiation, and live-to-progress timing in CUI/API evidence.
- Realtime evidence separates SDP negotiation from renderer live/data-channel state, making dogfood blockers more precise.
- Realtime tool manifest budget in `/api/realtime/config` and the `realtime` eval lane, so startup cost from tool count/schema size stays visible while JAVIS grows more capable.
- Silent Realtime preflight context so each voice session starts with current presence, app/browser, screen-frame freshness, work status, and guardrails.
- Silent Realtime work-progress sync while voice is live, so background Codex/Claude/deep tasks stay in context without interrupting the conversation.
- Realtime tool-call evidence for live voice dogfood, including sanitized shortcut list/candidate/save/forget, work-handoff, compact work-next preview/run, delegate-task preview/confirmation gates, collaboration claim control, autopilot-status, attention-explanation, perception-consent, productivity dogfood archive, and UI-demonstration Record & Replay events in `/api/realtime/evidence`.
- Realtime voice self-diagnostics through `get_realtime_evidence`, so voice can explain whether WebRTC/live progress is connected, what is blocked, and the next dogfood step.
- Realtime attention explanations through `get_attention_explanation`, so voice can briefly explain pet color, quiet/notify decisions, cooldown, and recent attention history without opening a desktop dashboard.
- Manual Realtime dogfood drill for verifying live voice progress, work-handoff, autopilot, attention-explanation, perception-consent, UI-demonstration Record & Replay, and shortcut list/save/recall/forget flows from CUI/API, including a no-mic shortcut recall preparation path through `npm run config -- --prepare-realtime-shortcut-recall --confirm`.
- One-page Realtime dogfood operator brief from CUI/API, showing readiness, next spoken prompt, follow-up prompts, evidence gates, and start/monitor commands without starting microphone capture.
- Next Realtime dogfood prompt helper from CUI/API, with clipboard copy and dry-run support, so operators can manually dogfood live voice without starting microphone capture from automation.
- Realtime dogfood operator session tracker from CUI/API, so a real spoken drill can be started, marked, ended, and audited without turning the desktop pet into a dashboard.
- Realtime voice dogfood-session tools, so the live voice model can inspect, start, mark, and end the same operator drill record while CUI/API evidence proves it did not start microphone capture.
- Realtime dogfood session auto-sync, so evidence-proven drill steps are persisted as sticky progress even after the live voice session disconnects.
- Realtime dogfood archive export and acceptance action plan from CUI/API/voice tools, saving the current brief, evidence, session tracker, and related audit trail as a local JSON packet without starting microphone capture or storing raw audio, while exposing machine-readable previewable/manual next steps so voice and autonomy know what can be prepared before asking for mic confirmation; `npm run dogfood:realtime-acceptance -- --save-archive` saves and checks an archive in one operator step, while the voice acceptance tool returns a compact summary payload and CUI/API keep the full evidence packet for debugging.
- Realtime payload budget audit through `npm run dogfood:realtime-payload` and the `realtime-payload` eval lane, keeping voice-heavy tool outputs compact enough for low-latency conversation.
- Realtime live dogfood preflight through the `realtime-preflight` eval lane, checking renderer/provider readiness, mic-confirmation gates, remaining allowed live-only gaps, manifest budget, and payload budget without starting microphone capture.
- Realtime live drill pack from CUI/API, bundling renderer preflight, the mic-confirmed start command, monitor, prompt, session tracker, archive, and acceptance checks into one read-only operator packet.
- Renderer Realtime dogfood preflight and trigger for opt-in live WebRTC verification: `npm run dogfood:realtime-renderer` previews provider/renderer/prompt readiness without starting mic; `npm run dogfood:realtime-renderer -- --execute --confirm-mic` starts the renderer voice path only after explicit mic confirmation, sends dogfood prompts through the live data channel, and saves local evidence.
- Private screen mode that downscales/blurs frames before they leave the renderer.
- Screen privacy presets for password managers, account/login pages, banking/payment hosts, sensitive system windows, and a notification-strip region mask, with preview/apply APIs and CUI visibility.
- Mac context: frontmost app/window, clipboard summary, active jobs, and pending approvals.
- Passive ambient observe mode: local-only current app/window, metadata-only browser activity summary, and optional private screen-frame refresh without intervention.
- Local inferred learning profile distilled from passive ambient metadata without calling a model, with metadata-only evolution snapshots, pause/resume, prompt-inclusion, delete, promote-to-memory, and app/site/folder exclusion controls.
- Local user-distillation status pack from `/api/learning/distillation`, CUI, and Realtime `get_learning_distillation`, combining inferred habits, recent evolution, explicit UI demonstrations, skill shortcuts, local skills, privacy boundaries, prompt-injection risk, and confirmation-gated next actions without storing raw screenshots, clipboard text, or page bodies; the voice tool returns a compact payload while API/CUI keep the fuller operator packet.
- Record & Replay-inspired local learning: turn the inferred profile plus recent routing/workflow evidence into a reviewable `SKILL.md` draft, explicitly export it to `~/.agents/skills`, turn completed UI demonstrations into safe replay plans, run them only after explicit confirmation through normal app workflow gates, promote proven demonstrations into reviewable local skills after confirmation, expose Realtime evidence for demonstration list/start/capture/finish/replay/draft/save gates, attach recalled local skills as structured `skillRecallPlan` evidence during later task routing, promote confirmed repeats into local skill shortcuts, manage those shortcuts from CUI/API/Realtime voice tools, and pass recalled plans into queued background/Codex/Claude workers.
- Resident presence state: standby/watching/wake/work/attention status with the latest passive context, quiet attention policy, attention-notification throttling, and intervention guardrails.
- Browser context: supported frontmost browser tab title and URL.
- Browser activity: local recent browser host/title timeline from ambient metadata, exposed through API/CUI/presence/Realtime tools without storing page text.
- Unified perception consent/status registry through `/api/perception/consent`, Realtime `get_perception_consent`, and `npm run config -- --print-perception`, covering screen, voice, ambient observation, browser, clipboard, Accessibility/app control, learning, and worker tools without adding desktop pet diagnostics; the Realtime tool returns a compact voice payload while CUI/API keep the full operator registry.
- Browser page reader: read selected text, headings, visible page text, and visible links from supported active tabs.
- Browser control: guarded back/forward/reload/new-tab/close-tab/address/search/open-url actions for supported active browsers.
- Browser DOM control: read visible clickable/fillable page controls through Apple Events or Chrome DevTools, then guarded click/fill/select one element.
- Browser workflows: summarize, extract actions, draft, ask about the current page, search/compare result pages with structured candidate links, open and review one selected result, synthesize across multiple result pages, or recover blocked form-fill drafts with a safe sensitive-field handoff through quick or background lanes.
- Read-only MCP server discovery, preview-only MCP workflow planning, local MCP execution approval requests, approved stdio `tools/list` schema inspection, Realtime voice `plan_mcp_tool_call` approval planning, and separately approved stdio `tools/call` execution for Claude Desktop/Claude Code/Cursor/project JSON configs through API/CUI/voice; env values and URL queries are redacted, previews never start server commands, and tool results are sanitized before storage.
- Realtime voice approval review: `get_pending_approvals` reads summarized pending approvals, and `resolve_approval` can reject or confirm one exact approval id while preserving the local approval gates.
- Explicit local control modes: observe-only, ask-before-action, trusted-local, and supervised-takeover posture on top of the action policy.
- File workflows: list/search local folders, summarize allowed files, ask file-specific questions, or plan folder organization through quick/background lanes.
- Voice-driven current-app control: one tool plans and executes a single click/toggle/fill action through the Accessibility tree and guarded action policy.
- Multi-step local app workflows: preview or execute short sequences such as open app, wait, press UI target, type text, hotkey, and file/Mac actions with one workflow record.
- Current-state app workflow planning: observe frontmost app, Accessibility tree, and screen metadata to turn a natural request into previewable local workflow steps.
- Creative app workflows: recognize video editing and music composition requests, choose a likely NLE/DAW such as Final Cut Pro, DaVinci Resolve, Premiere, iMovie, CapCut, Logic Pro, GarageBand, Ableton Live, FL Studio, or Pro Tools, return stage action packs, and execute one guarded action at a time with post-action screen/UI verification and recovery hints.
- Productivity app dogfood archives: preview or save a four-app Notes/Reminders/Calendar/Mail draft evidence packet from API or Realtime voice tools without starting apps, sending messages, mutating user files, or recording workflow history by default.
- Local task router: picks quick, deep, Codex, or Claude lane before executing or queueing work, with relevant explicit memory context and recalled local skill plans.
- Bounded autonomy loop through `/api/autonomy/run` and Realtime `run_autonomy_loop`: route, expose local learning evidence, observe local context, preview the next workbench action, optionally execute through existing policy gates, verify progress, scan failed-worker recovery, return an `agencyPlan` with primary/fallback next attempts and ask-user-only boundaries, and run one budgeted recovery retry only when `execute:true` and `retry:true` are both explicit.
- OpenClaw-style lane contract registry and voice capability map for realtime/background/Codex/Claude/local/browser/file/app ownership, handoff, collaboration state, and risk boundaries; the Realtime capability tool returns a compact voice payload while API/CUI keep the full map.
- Routing speed policy from API/CUI/Realtime voice, explaining when to answer inline, use the fast model, queue background work, hand code to Codex/Claude, or use browser/file/app tools first with explicit first-tool recommendations; the Realtime tool returns a compact voice payload while API/CUI keep the full profile/sample table.
- Parallel task ownership guard that keeps overlapping write scopes from launching as independent agents.
- Local agent collaboration ledger so external Claude Code, Codex, or CLI workers can claim scoped work, heartbeat, release, get a CUI/API/CLI handoff summary, and avoid overlapping write races.
- Realtime collaboration claim tools (`plan_collaboration_claim`, `heartbeat_collaboration_claim`, `release_collaboration_claim`) so live voice can preview, confirm, refresh, and release Claude Code/Codex ownership records through the same local ledger without starting workers or mutating files.
- Realtime delegated-worker handoff through `delegate_task`: voice previews a scoped background/Codex/Claude task by default, refuses execution without `execute:true` plus `confirm:true`, and then starts workers only through the normal routing, policy, and overlapping-write serialization path.
- No-model local command router for resident status, screen refresh/observation, Inbox capture/listing, opening apps/URLs, web search, and narrow app workflows such as opening TextEdit/Notes/Obsidian and typing short text when API/model lanes are unavailable.
- Fast lane for lightweight Q&A.
- Deep lane for slower background tasks with persisted logs, cancellation, and recalled skill-plan context when routing found a matching local workflow.
- Background CLI tool runner for explicit local commands such as `gh`, `git`, `npm`, Codex CLI, and Claude Code without blocking the voice lane.
- Workflow history for recent browser, voice, and background work.
- Local work briefing for recent progress, blockers, active work, and next actions.
- Local work progress check-ins for background jobs, workflows, grouped Codex/Claude/local worker batches, and recoverable failed-worker plans.
- Realtime voice recovery inspection and targeted recovery for failed workers through `get_worker_recovery` and `run_worker_recovery`, with execution still bounded by normal recovery policy.
- Voice-ready work handoff that compresses readiness, progress, session, collaboration, next actions, and workflow continuation suggestions into one short spoken summary; the Realtime `get_work_handoff` tool returns a compact payload instead of the full briefing/collaboration ledger.
- Unified work-next step that safely chooses one next action across setup, approvals, sessions, Inbox, jobs, workflows, and Realtime dogfood; Realtime blockers include a guided handoff dogfood pack plus a workbench `actionPlan` that separates no-mic preparation from manual live-voice steps, while the Realtime `get_work_next` tool returns a compact voice payload instead of the full workbench JSON.
- Overnight autopilot decision evidence through `/api/autopilot`, CUI status, and Realtime voice `get_autopilot_status`, showing candidate counts, waiting conditions, the selected safe action, skip summaries, and what the resident needs before it can continue unattended; Realtime gets a compact status payload while API/CUI keep the full preview evidence.
- Local work sessions for focus goals, session notes, resume-from-history handoff, automatic evidence from Inbox/jobs/workflows/approvals, spoken check-ins, and deterministic end-of-session summaries.
- Local memory for user-approved preferences, project facts, and durable notes.
- Local Inbox for clipboard/manual captures and pending follow-up items.
- Read-only Inbox triage for prioritizing captures, grouping them by lane/source/priority, suggesting quick/background/Codex/Claude lanes, and returning voice-ready confirmation prompts before execution.
- Explicit Inbox "do next" processing that sends the highest-priority open capture into the task router.
- Inbox-to-task routing for turning captures into quick/background/Codex/Claude work.
- Continue-from-history workflow routing for follow-up tasks, with memory-aware preview prompts over the parent workflow, related recent workflows, explicit memories, local skills, and inferred learning profile/evolution context.
- Proactive workflow follow-up suggestions that turn recent completed or blocked workflows into safe work-next continuation previews before anything is queued.
- Delegation slots for Codex and Claude Code with visible worker output.
- Small reversible Mac actions: open URL and open app by default.
- Guarded file actions: write files, create folders, copy files, and move/rename files through policy, approval, and local-execution gates.
- Clipboard actions: read, write, and clear clipboard text through policy/audit.
- Tiny draggable always-on-top desktop buddy window.
- Compact pet mode by default; configuration lives in the terminal CUI instead of the desktop pet.
- Lightweight `/api/pet/status` endpoint for the desktop capsule: traffic-light mode, wake/voice/window state, and no raw screen image, model list, learning profile, routing history, logs, or runtime data directory.
- Pet click starts or stops the realtime voice + screen-context session when the API key is configured.
- Non-intrusive Dynamic Island-style parking at the Mac notch, with optional corner/display placement from the terminal CUI.
- macOS menu bar status item for resident controls and setup shortcuts.
- Global pet park hotkey, defaulting to `Control+Shift+Space`.
- Global tap-to-summon hotkey, defaulting to `Alt+Space` (`Option+Space` on Mac), which wakes JAVIS and parks it at the Dynamic Island/notch position.
- Global clipboard-to-Inbox capture hotkey, defaulting to `Control+Shift+I`.
- Resident system notifications for approvals and background task completion, with approval/setup/voice attention alerts gated by the quiet attention policy.
- Voice mode defaults to open mic from the pet, with push-to-talk plumbing still available internally.
- Setup/config diagnostics for `.env`, permissions, resident mode, policy, and local workers.
- Local evaluation harness for product-lane regression checks across health, Realtime voice configuration, briefing, memory, Inbox, routing, parallel multi-agent ownership, collaboration, browser, file, control, worker, Accessibility, and learning surfaces.
- Shared AX targeting verifier for Chromium/Gemini side-pane input regressions.
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
The CUI also exposes microphone permission recovery, explicit control-mode switching, Realtime evidence watching or one-shot printing, Realtime dogfood brief/prompt/session/archive controls, voice-ready work handoff printing, next-work execution, overnight autopilot status, one-tick manual advance, learning refresh/evolution, inferred-memory save, learning skill draft preview/export, local skill shortcut review/promotion, and the `JAVIS_AUTOPILOT_ENABLED` toggle for unattended low-risk recovery work.

Use `npm run verify:ax` as a read-only Accessibility targeting smoke test. For the strict Chrome/Gemini side-pane case, focus Chrome and run `npm run verify:ax -- --require-chromium`.

Use `npm run eval` against a running resident for a broader local product-lane scorecard. It uses read-only or preview checks by default and can be scoped with `npm run eval -- --only=health,routing`. The control-mode lane temporarily switches modes, preview-tests the gates, and restores the previous mode. Use `npm run eval:routing` for the labeled lane-classifier corpus. `JAVIS_EVAL_LIVE_WORKERS=true npm run eval -- --only=workers-live` is the opt-in check that queues real read-only Codex, Claude, and local CLI workers.

Local file policy lives in `~/Library/Application Support/JAVIS/Runtime/action-policy.json`; broad Home-directory access can be enabled there while protected macOS folders may still need Full Disk Access approval.
Local autonomy posture lives in `~/Library/Application Support/JAVIS/Runtime/control-mode.json` and is also available through `/api/control/mode`.

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
  protected by the local runtime token except /api/health
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
  /api/window/park      -> move the buddy back to its configured notch/corner position
  /api/window/move      -> move the buddy to explicit screen coordinates
  /api/menubar/state    -> macOS menu bar status item state
  /api/notifications/state -> resident notification support, counters, quiet attention policy, and operator-only attention history
  /api/briefing         -> local status, blockers, recent work, and next actions
  /api/work/progress    -> spoken-style job/workflow progress check-in
  /api/work/handoff     -> voice-ready handoff over readiness, progress, sessions, collaboration, and continuations
  /api/work/next        -> preview or execute one safe next workbench action; Realtime voice uses compact get_work_next for read-only next-step previews and run_work_next only after an explicit execute request
/api/autonomy/run     -> bounded route/learning/observe/preview/verify/recovery-scan loop for one task, with machine-readable agencyPlan
  /api/jobs             -> persisted background job history
  /api/jobs/recovery    -> recoverable failed-job summaries with attempts, diagnostics, child recovery jobs, and recommended next actions
  /api/workflows        -> persisted workflow history with linked jobs and results
  /api/workflows/follow-ups -> proactive continuation suggestions from local workflow history, memory, skills, and learning
  /api/workflows/continue -> preview or run a memory-aware continuation of the latest or specified prior workflow
  /api/workflows/copy-result -> copy the latest or specified workflow result to clipboard
  /api/lanes/contracts -> lane owner/scope/handoff/risk contracts for routing
  /api/memory           -> local memory list/search/create/delete
  /api/learning         -> local inferred profile, controls, exclusions, and prompt-use state
  /api/learning/evolution -> metadata-only recent-vs-baseline local habit change snapshot
  /api/learning/settings -> pause/resume learning, prompt inclusion, and exclusion lists
  /api/learning/remember -> save the inferred learning profile into local memory
  /api/learning/skill-draft -> preview or generate a local Codex skill draft from learning evidence
  /api/learning/skill-draft/save -> explicitly export the draft to ~/.agents/skills
  /api/skills/local     -> read-only search over local user skills for repeatable workflows
  /api/learning/skills  -> read-only local skill recall for learned or demonstrated workflows
  /api/shortcuts        -> local skill shortcut list, candidates, promotion, and deletion
  /api/demonstrations   -> explicit UI demonstration records for repeatable local workflows
  /api/demonstrations/:id/replay/* -> safe replay planning and confirmation-gated execution
  /api/demonstrations/:id/skill-draft* -> preview or confirm-save a local skill from a completed demonstration
  /api/inbox            -> local persistent capture inbox
  /api/inbox/capture-clipboard -> capture current clipboard text into Inbox
  /api/inbox/triage     -> read-only Inbox priority and lane suggestions
  /api/inbox/process-next -> explicitly process the highest-priority open Inbox item
  /api/inbox/:id/route  -> route an Inbox item into quick/deep/Codex/Claude work
  /api/jobs/:id/cancel  -> stop queued/running background work
  /api/audit/recent     -> recent structured audit events
  /api/perception/consent -> local perception/tool surface status, consent gates, storage notes, controls, and audit trails
  /api/actions/policy   -> local automation policy
  /api/actions/execute  -> execute guarded local actions
  /api/observe          -> combined fast observation for voice: Mac context, screen, Accessibility, jobs, approvals
  /api/mac/context      -> frontmost app, clipboard summary, queue, approvals
  /api/ambient          -> recent passive local observation metadata
  /api/ambient/sample   -> take one passive local observation sample
  /api/learning         -> local inferred profile from ambient metadata
  /api/learning/distill -> refresh the local inferred profile now
  /api/learning/skill-draft -> build a reviewable SKILL.md draft from inferred local patterns
  /api/presence         -> resident standby/watch/work state, attention policy, and latest passive context
  /api/pet/status       -> lightweight desktop pet state; full diagnostics remain in /api/status, CUI, or expanded-panel refresh
  /api/attention        -> quiet attention policy for pet color, notifications, cooldown, reasons, and operator-only history
  /api/attention/history -> recent operator-only attention notification sent/suppressed events
  /api/attention/notify -> apply the attention notification gate, with dry-run support for testing
  /api/routing/speed-policy -> read-only model/lane speed policy for realtime vs fast/background/Codex/Claude/tool-first routing, including browser/file/app first-tool hints
  /api/conversation/state -> resident voice conversation lifecycle state
  /api/realtime/context -> silent preflight context for new voice sessions
  /api/realtime/evidence -> live voice dogfood checklist and sanitized tool-call evidence, including work-next preview/execute evidence
  /api/realtime/dogfood/drill -> manual live-voice dogfood drill steps and prompts
  /api/realtime/dogfood/prompt -> next manual live-voice dogfood prompt
  /api/realtime/dogfood/prompt/copy -> copy the next dogfood prompt, with dry-run support
  /api/realtime/dogfood/session -> manual operator session tracker for real live-voice dogfood
  /api/realtime/dogfood/pack -> read-only live drill operator pack with start, monitor, archive, acceptance, and safety gates
  /api/realtime/dogfood/archive -> preview or save a local dogfood evidence archive
  /api/realtime/dogfood/archives -> list saved local dogfood evidence archives
  /api/realtime/dogfood/renderer -> read-only renderer/WebRTC dogfood preflight
  /api/realtime/dogfood/renderer/start -> opt-in renderer/WebRTC dogfood trigger, requires execute:true and confirmMic:true before microphone starts
  /api/realtime/dogfood/start -> manual dogfood drill starter: summon pet and optionally prepare progress after voice is live
  /api/context/plan    -> smart context assembly plan for a user request
  /api/wake/status      -> soft/local wake-word trigger state
  /api/wake/trigger     -> trigger voice start from a local wake engine
  /api/accessibility/tree -> read-only frontmost app UI tree
  /api/accessibility/plan -> dry-run UI control plan from the accessibility tree
  /api/accessibility/control -> plan and execute one guarded current-app UI action
  /api/app/plan        -> observe current state, plan steps, and optionally execute
  /api/app/workflow    -> preview or execute a short multi-step local app workflow
  /api/creative/workflow -> plan/start video-editing or music-composition workflows with stage action packs
  /api/creative/action -> preview or execute one guarded creative workflow action, with verification/recovery hints
  /api/browser/context  -> supported browser tab title and URL
  /api/browser/activity -> metadata-only recent browser host/title activity
  /api/browser/page     -> read-only current browser page text and link extraction
  /api/browser/control  -> guarded current-browser navigation actions
  /api/browser/javascript -> browser JavaScript bridge status
  /api/browser/dom      -> read visible clickable/fillable page controls
  /api/browser/dom-action -> guarded webpage element click/fill/select
  /api/mcp/servers      -> read-only local MCP server discovery with env values redacted
  /api/mcp/workflow     -> preview which MCP server should handle a task or create a local approval request; approval can inspect stdio tool schemas
  /api/mcp/tool-call    -> preview or create approval for one stdio MCP tools/call request with sanitized result storage
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
  /api/tasks/parallel    -> grouped multi-agent routing with ownership serialization
  /api/collaboration     -> local agent scope claims for Codex/Claude/CLI coordination
  /api/tasks             -> background / Codex / Claude queue
  /api/tools/execute     -> tools called by the realtime model
  /api/window/mode       -> pet sizing compatibility endpoint
  /api/window/summon     -> wake and park JAVIS from API/CUI/hotkey
```

The realtime model stays focused on short interaction. `/api/context/plan` creates a deterministic smart context assembly plan before expensive context gathering: status requests stay resident-only, recent browser activity requests the metadata-only `get_browser_activity` tool, browser content tasks request browser/page tools, current-app control requests Accessibility, and screen/vision/file/clipboard context is skipped unless the task asks for it. `observe_now` combines the usual first-look context into one tool call when the plan calls for it: frontmost app/window, browser context, clipboard summary, latest or freshly captured screen metadata, optional vision summary, Accessibility outline, jobs, and approvals. `/api/perception/consent` is the operator-facing registry for what JAVIS can currently see or operate: each surface reports status, consent gate, local retention, raw-content storage posture, controls, and recent audit evidence, while the desktop pet remains just a compact status light. Realtime voice can call `get_perception_consent` when the user asks what JAVIS can see, read, hear, control, store, or why a permission/action is allowed or blocked. When live context is enabled, the resident captures the full primary screen directly and adds that latest frame to the realtime conversation so follow-up voice commands can refer to what is visible without showing a window picker. `JAVIS_SUMMON_HOTKEY` defaults to `Alt+Space` and triggers the same wake path as `/api/wake/trigger`, while `JAVIS_WAKE_ENGINE_CMD` can point at any local wake-word command; when either path triggers wake, the renderer sees `/api/wake/status` and starts the voice session. The renderer reports connecting/live/idle/error voice state and heartbeats to `/api/conversation/state`, so `/api/presence` can move from Watching to Connecting/Listening and back to Watching after the session ends. When a Realtime data channel opens, the renderer also sends one silent `/api/realtime/context` preflight message containing current presence, app/browser, screen-frame freshness, work status, next actions, guardrails, and lane contract guidance; this reduces first-turn tool latency and does not trigger a standalone answer. While voice stays live, the renderer polls `/api/work/progress` and sends silent work-progress updates only when active/background work changes, keeping Codex/Claude/deep task state available without interrupting. `/api/realtime/evidence` also exposes a short in-memory trail of sanitized Realtime tool calls, including shortcut list/candidate/save/forget and perception-consent evidence for live voice dogfood. `get_attention_explanation` gives Realtime a short Chinese spoken summary of attention state, pet color, notification cooldown, and recent operator-only attention history, while the desktop pet continues to consume only compact color/state. Screen privacy defaults to `private`, which downscales and blurs/pixelates frames before they are posted to the local API or Realtime session; API/CUI controls can switch to `clear` when precision matters. The passive ambient observer can keep local metadata about what app/browser page is active, but it does not speak or act by itself. `/api/presence` packages that passive state into a standby/watching/working/attention summary with the latest observed app/browser context and guardrails. When `JAVIS_AMBIENT_LEARNING=true`, the resident distills those local metadata events into a lightweight inferred profile: top apps, browser hosts, active hours, recent contexts, and a short summary. It also exposes a local evolution snapshot so routing and continuation prompts can see how those patterns are changing over recent activity. This distillation is local, model-free, and separate from explicit user-approved memory; only the aggregate summary/signals/evolution hints are eligible for prompt context when `JAVIS_INCLUDE_LEARNING_IN_PROMPTS=true`. Inspired by Codex Record & Replay, /api/learning/skill-draft can turn that inferred profile plus recent routing/workflow evidence into a reviewable `SKILL.md` draft; /api/learning/skill-draft/save requires explicit confirmation and exports to user-level `~/.agents/skills` instead of the GitHub project. Completed skill-plan repeats can also be promoted through `/api/shortcuts/promote` or the Realtime `save_skill_shortcut` tool after confirmation; later matching phrases recall the same `skillRecallPlan` even when broad memory search is disabled, but they do not approve actions or expand permissions. Realtime can list shortcuts, show promotion candidates, save a confirmed phrase, or forget a phrase through the same local store used by the CUI. The model can also ask for current Mac, resident presence, perception consent, attention explanations, browser, recent browser activity, browser DOM controls, lane contracts, collaboration state, file, local memory, local learning profile, local learning evolution, local Inbox, local work sessions, local work briefing, work progress, session check-ins, or Accessibility UI-tree context, start/resume/log/end a work session, capture follow-up items into Inbox, triage Inbox priority/lane suggestions, explicitly process the next Inbox item, route Inbox items into task lanes, inspect recent workflow history, get proactive workflow follow-up suggestions, continue a prior workflow, copy a workflow result back to the clipboard, run current-page browser workflows, search/compare web result pages, review one selected result, synthesize multiple result pages, run local-file workflows, control one current-app UI target, click/fill/select one guarded webpage element, plan a workflow from current Mac state, execute a short local app workflow, or use the local router to decide whether a task should be answered quickly or queued to a deeper lane. Workflow continuation can be previewed without queueing work; the continuation prompt carries the parent workflow, related recent workflows, explicit memory matches, recalled local skills, and inferred learning profile/evolution context when enabled. The briefing and work-next lanes now surface proactive continuation suggestions from that same context, so JAVIS can propose a next artifact or blocker-recovery step without starting background work first. The router first checks safe no-model local commands, so status, work progress, session resume/check-ins, Inbox capture/listing/triage/next processing, app/URL opens, and web search still work when model lanes are unavailable. The router and manual task queue include relevant explicit memories plus the local inferred profile/evolution by default, and can disable this with `useMemory:false`; each routing record stores `contextPlan` and `learningEvidence.evolution` so CUI/API/debug flows can explain which context was used or deliberately skipped. Active `/api/collaboration` write claims from external Claude Code, Codex, or CLI workers seed the parallel ownership guard, so later routed workers serialize instead of editing the same scope. Guarded Accessibility execution is available through Level 3 `ax_press` and `ax_set_value` actions plus the higher-level `control_current_app`, `plan_app_workflow`, and `run_app_workflow` voice tools, guarded browser DOM execution is available through Level 3/4 `dom_click`, `dom_fill`, and `dom_select`, and guarded file execution is available through Level 3 write/create/copy/move actions; all require policy checks, approval when configured, and local execution enablement. File organization has a two-step flow: preview the plan first, then request apply with explicit confirmation. Harder work is put into the queue so spoken conversation stays responsive, and running workers can be inspected or cancelled from the CUI/API.

## Long-Term Direction

- [Goal](docs/GOAL.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Safety](docs/SAFETY.md)
- [Operations](docs/OPERATIONS.md)
- [Reference notes](docs/REFERENCE_NOTES.md)
