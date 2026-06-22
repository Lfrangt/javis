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
  Local agent collaboration ledger
  Local explicit memory store
  Local Inbox store
  Structured audit log
  Control mode posture
  Mac action bridge
  Mac context and clipboard bridge
  Browser context bridge
  MCP server discovery bridge
  Accessibility UI-tree bridge
  Current-app control bridge
  App workflow planner
  App workflow bridge
  Productivity app workflow bridge
  Knowledge vault workflow bridge
  Creative app workflow bridge
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
- Local speech fallback lane: macOS `/usr/bin/say` output for provider-blocked or no-mic states, with `/api/speech/state`, silent `dryRun` previews, explicit short audible dogfood, and no microphone/OpenAI dependency.
- Local voice command lane: `/api/voice/command` accepts a transcript from typed input, future local STT, or a blocked Realtime fallback, attaches metadata-only Mac context (frontmost app/window, browser title/host, screen freshness/privacy, clipboard length only) plus optional bounded Accessibility outline, routes it through the same task router, prepares a short spoken acknowledgement through local speech, and holds quick-lane cloud calls unless explicitly allowed. Realtime health, pet status, work-next, and compact voice handoff all expose this as the no-mic fallback when provider quota/auth/network checks fail. The deterministic local-command layer also handles "continue last voice route" / `继续刚才那个` by selecting the latest executable preview from sanitized voice history and running it through the same work-next recovery policy.
- Local voice entry lane: `/api/pet/status` exposes a compact `localVoice.interaction` contract whose fallback click opens the local typed intake path instead of Terminal, so the parked capsule can stay quiet when Realtime is blocked. The renderer uses a temporary `compose` window mode for a narrow local input strip, then returns to `pet` after a successful send. `npm run voice:chat` remains the explicit CUI/CLI terminal loop for a shell the user already chose, but desktop/API loop requests always redirect to compose and the shared Terminal opener blocks `voice:chat` loop commands so resident actions cannot stack Terminal windows.
- Voice standby prompt-pack lane: `/api/voice/standby`, `/api/pet/status`, wake handoff, the terminal CUI, local `/voice`, local `/try`, natural `prompt_suggestions`, and the compact compose placeholder share one short `promptPack` with the next safe utterance, examples, and no-mic/no-Terminal safety flags. They also share a compact `inputMode` contract for `push_to_talk` (`micDefault=push`, hold capsule or Space, release to send), so every surface treats open-mic as an explicit expanded-control choice. The examples are ranked from existing local metadata: resumable voice routes, active/blocked work, browser activity, cached current-app UI, capability status, and local distillation. This keeps the desktop surface actionable while the detailed provider recovery and routing diagnostics stay in CUI/API.
- Renderer health lane: `/api/renderer/status` and `/api/health.renderer` report whether the desktop layer is loading, ready, recovering, degraded, or missing, plus bounded recovery counters and timestamps. The payload intentionally reports URL kind instead of renderer URLs so runtime tokens never leak through health checks.
- Realtime config snapshot lane: exposes a read-only `/api/realtime/config` check for model/voice, tool inventory, wake/control guardrails, preflight status, and screen privacy without returning the full prompt text.
- Pet session lane: one click starts voice and requests screen sharing, then pushes the first permitted screen frame into Realtime context.
- Conversation state lane: renderer-reported connecting/live/idle/error voice lifecycle with heartbeats so the resident can expose whether it is truly listening.
- Realtime renderer control lane: `/api/realtime/renderer/control` previews or dispatches a local stop request to the renderer so CUI/API can end an active WebRTC voice session without starting microphone capture, opening Terminal, or adding controls to the compact pet.
- Realtime preflight lane: one silent text context pushed into each new voice session with presence, current app/browser, screen freshness, active work, next actions, and guardrails.
- Recent activity lane: `/api/activity/recent`, local `recent_activity`, and Realtime `get_recent_activity` summarize recent app/window/browser metadata from ambient observations so JAVIS can answer "what was I just doing?" without screenshots, page text, clipboard text, or Accessibility trees.
- Browser activity lane: exposes metadata-only recent browser app/host/title activity from ambient observations to presence, CUI, API, Realtime preflight, and the `get_browser_activity` Realtime tool without page text.
- Browser research continuation lane: attaches and persists structured next-step actions to browser `research` workflows for prepared preview links, unvisited result links, failed pages, and promising follow-up links. These are inert workflow arguments until a later explicit browser workflow or work-next call runs them.
- Realtime work-progress lane: while voice is live, sends deduplicated silent `/api/work/progress` updates when background jobs, grouped Codex/Claude/local workers, workflows, or routing records change. The resident exposes a `progressVersion` sequence through status/progress APIs, so the renderer can sync on work changes instead of waiting only for the fixed polling interval. The progress payload includes a short `spokenSummary` for voice answers. The resident records sanitized `/api/realtime/session` negotiation metadata for the OpenAI WebRTC offer/answer, and the renderer reports sanitized `/api/realtime/progress-injection` and `/api/realtime/latency` receipts with WebRTC data-channel metadata, injected progress sequence, click-to-live timing, negotiation timing, and live-to-progress timing. `/api/realtime/evidence` combines those receipts into one checklist and one `gapSummary` for active-session dogfood, including current vs injected progress sequence sync status, how far Realtime is behind, the next missing drill step, the next prompt, and the latest latency quality.
- Realtime tool evidence lane: records a short in-memory ring of `/api/tools/execute` calls for live voice dogfood. It stores tool name, source, timing, success/error state, output shape, and safe shortcut-tool, work-next, delegate-task, collaboration, browser, learning, approval, and demonstration fields; it does not persist full tool arguments or raw tool outputs.
- Realtime dogfood preparation lane: when live evidence is blocked on `needs_live_session`, `GET /api/work/next` previews the no-mic live drill cockpit, and `POST /api/work/next` with explicit execution runs the full no-mic preflight bundle: prompt script, operator tracker, shortcut-recall proof, local archive, acceptance snapshot, and the final mic-confirmed command for the user-run renderer path.
- Lane contract registry lane: deterministic OpenClaw-inspired contracts for realtime/background/Codex/Claude/local/browser/file/app ownership, non-goals, handoff tools, tool posture, and risk boundaries, exposed to API, Realtime tools, briefing, status, and doctor checks.
- Routing speed policy lane: read-only voice-facing policy over Realtime, fast model, background model, Codex, Claude Code, local command, browser, file, and app profiles. It explains latency class, model/tool choice, background/parallel eligibility, and confirmation gates before `route_task` executes anything. Browser/page and file/app tasks keep their owner lane but expose `toolFirst` so Realtime can speak quickly, run structured tools first, and only then hand slow synthesis to background workers.
- Task routing ledger lane: persists each quick/background/Codex/Claude/local routing decision with owner, scope, parallel group, approval requirement, status, result link, and a bounded original task prompt for continuation. Blocked route records can be turned into a work-next recovery envelope that links the relevant job/workflow, recovery action, continuation, copy-result, or inspect target; preview-only background/Codex/Claude/local records expose a `route_preview_execute` candidate so voice/wake fallback can be continued without repeating the request.
- Skill shortcut lane: persists confirmed phrase triggers for previously recalled local skill plans, exposes CUI/API/Realtime voice promotion and deletion, and feeds matched shortcuts back into routing without granting execution permission.
- Parallel task group lane: routes a bounded set of independent tasks under one `parallelGroup`, preserving per-task owner, scope, lane, status, and result link for progress check-ins.
- Agent collaboration ledger lane: persists short-lived scope claims from external Claude Code, Codex, or local CLI workers, with heartbeat/release APIs, suggested next scopes, and conflict counts used by briefing, CUI, voice, doctor, and the parallel ownership guard. Realtime voice can preview, confirm, heartbeat, and release scoped ownership records through compact collaboration tools; those tools only mutate the local ownership ledger and do not start workers or edit files.
- Push-to-talk lane: default Realtime mic posture. The renderer starts sessions with mic tracks disabled in `push` mode, enables them only while the user holds Space, the expanded hold button, or the compact capsule, and commits the audio turn on release. Open mic remains an explicit manual toggle.
- Global hotkey lane: brings the desktop pet back without requiring app focus.
- Tap-to-summon hotkey lane: global `JAVIS_SUMMON_HOTKEY`/`JAVIS_TAP_HOTKEY` wakes JAVIS, parks the capsule at the notch, starts the same pending wake path used by local wake engines, and exposes a read-only wake handoff that tells the pet/CUI whether to try Realtime or route the next request through local voice-command fallback. When Realtime is not ready, summon opens the compact `compose` input immediately instead of waiting for a failed microphone path.
- Wake-command lane: `/api/wake/command` and `npm run wake -- "..."` trigger wake, attach the same read-only handoff, then run local voice-command intake without starting microphone capture or Realtime.
- Capture hotkey lane: saves current clipboard text into local Inbox without opening desktop UI.
- Menu bar lane: resident macOS status item for opening the terminal CUI, parking the pet, seeing current blockers, and jumping to setup locations.
- Config CUI lane: terminal-first setup surface for `.env`, permissions, doctor output, and parking the pet.
- Notification lane: macOS notifications for completed, failed, or cancelled background work plus policy-gated attention alerts for approvals, setup blockers, and Realtime voice errors. Recent sent/suppressed attention history is exposed to the operator API/CUI, not the desktop pet.
- Vision lane: analyzes the latest permitted screen frame.
- Screen privacy lane: stores the resident screen privacy mode plus app/window/browser-host/region privacy rules. Private mode downscales/blurs frames before API/Realtime delivery; app/window/browser-host exclusion rules also filter screen images out of server-side model context, and enabled region rules are pixel-masked in the resident process before resident-captured or renderer-posted frames are stored, returned through the API, or injected into Realtime.
- Live screen-context lane: sends periodic screen image messages into the active Realtime conversation without triggering standalone replies.
- Smart context assembly lane: creates a deterministic per-request context plan before expensive capture, deciding whether to gather resident state, Mac context, screen/vision, Accessibility, browser page/DOM, clipboard text, files, memory, learning, or delegated-worker context.
- Observe lane: combined low-latency voice snapshot over Mac context, optional resident screen capture, optional vision summary, Accessibility outline, jobs, and approvals.
- Presence lane: read-only standby/watch/work/attention state that packages ambient context, wake status, local learning, active work, and intervention guardrails for CUI/API/voice use.
- Pet status lane: `/api/pet/status` is the lightweight notch Dynamic Island contract. The normal pet is 148x40, while the temporary `compose` local-input strip is still small and hides full diagnostics. It exposes only the stable traffic-light signal, capsule color/mode, wake/voice/window state, local no-mic voice standby state, minimal counts, and sanitized screen/privacy metadata, plus a `payloadContract` that lists allowed and forbidden top-level fields with a byte budget and minimum headroom guard; full diagnostics, learning profile, routing history, workflow logs, model identifiers, collaboration ledgers, and raw screen images stay behind `/api/status`, CUI, Realtime tools, or expanded-panel refresh.
- Fast text lane: lightweight Q&A.
- No-model local command lane: deterministic status, Inbox, open-app/open-URL, and web-search commands that run before model routing.
- Task router lane: local deterministic routing from casual requests to local commands, quick, background, Codex, or Claude lanes before execution, with relevant explicit memories, recalled local skill procedures, a persisted `contextPlan`, and `skillRecallPlan` evidence attached when model lanes or queued workers are used.
- Skill shortcut lane: local phrase-to-`skillRecallPlan` recall for repeated successful workflows, managed through `/api/shortcuts`, the terminal CUI, and Realtime voice tools.
- Background lane: slower higher-quality model work.
- Delegation lane: hands code or long tasks to background, Codex, or Claude Code workers with preview-first routing, owner/scope/access metadata, confirmation-gated execution, streamed logs, PID tracking, cancellation, and overlapping write-scope serialization.
- Action lane: small local Mac actions, guarded by allowlists and confirmation.
- Control mode lane: local runtime posture (`observe_only`, `ask_before_action`, `trusted_local`, `takeover_supervised`) that tightens effective action thresholds before actions, CLI jobs, or code-agent workers can run.
- Context lane: frontmost app/window, clipboard summary, active jobs, and pending approvals.
- Config lane: repeatable `.env`, permissions, resident mode, policy, and worker readiness diagnostics.
- Setup guide lane: maps the current setup blockers to the next safe local action, such as opening `.env` or macOS permission settings.
- Doctor lane: one report that validates service health, setup, policy guards, resident mode, workers, storage, queue, workflows, and approvals.
- Browser context lane: current supported browser tab title and URL for webpage-aware tasks.
- Browser activity lane: summarizes recent supported-browser host/title metadata from ambient observations for presence, Realtime preflight context, API, and CUI. It does not store page text and applies the same local learning exclusion controls before summarizing.
- Browser page lane: read-only extraction of selected text, headings, and visible page text from supported active tabs.
- Browser DOM lane: read-only visible control extraction plus guarded one-step click/fill/select actions inside supported active tabs, using browser Apple Events first and Chrome DevTools on `JAVIS_CHROME_DEBUG_PORT` as a fallback.
- Browser workflow lane: page-aware summarize, action extraction, drafting, Q&A, search/research, and guarded form-fill draft planning routed through quick or background lanes.
- Browser recovery lane: route/work-next notices `browser_window_unavailable` blockers and surfaces `browser_recovery:open_supported_browser`, which previews or executes a normal local `open_app` action to focus Google Chrome, rechecks browser readiness after execution, and returns the blocked route retry action before browser work continues.
- Browser benchmark lane: preview-only fixture checks for summarize, action extraction, form-fill draft redaction, compare/search preview, review-result preview, and research continuation contracts. It uses `/api/browser/benchmarks` and the CUI without opening live pages, executing browser actions, or calling models.
- Accessibility tree lane: read-only frontmost or requested-app UI structure for operating non-browser Mac apps through the accessibility model.
- UI planning lane: dry-run target selection and next-action plans from the current or requested app accessibility tree.
- Current-app control lane: voice/API wrapper that plans one UI target in the frontmost or requested app and executes a press or value write through the guarded local action path.
- App workflow planning lane: observes frontmost app/window, Accessibility tree, and latest screen metadata, then turns natural requests into previewable workflow steps.
- App workflow lane: short multi-step Mac workflows that sequence app opens, waits, hotkeys, typed text, current-app controls, browser DOM actions, and file/Mac actions into one auditable workflow record.
- App benchmark lane: preview-only checks for deterministic app planning, typed-text planning, current-app-control planning, explicit multi-step workflow previews, unsafe instruction rejection, and no-history/no-app-launch contracts through `/api/app/benchmarks` and the CUI.
- Productivity app workflow lane: Notes, Reminders, Calendar, and Mail task planning with staged action packs plus native macOS automation for confirmed note, reminder, calendar-event, and Mail-draft creation. Creating records requires explicit fields, `confirm:true`, local execution, control-mode permission, and the `allow.productivity_app` allowlist; sending mail, calendar invitations, deletes, and bulk changes stay blocked or human-reviewed.
- Creative app workflow lane: recognizes video editing and music composition requests, picks likely creative software, records stage action packs for imports, timeline edits, subtitles, MIDI sketches, mix/export previews, and executes one guarded action at a time through app workflow, observe, file workflow, UI planning, or current-app control, followed by screen/UI verification and recovery hints.
- Creative benchmark lane: preview-only fixture checks for video-editing and music-production planning, export confirmation gates, missing asset-path gates, prompt previews, and no-history/no-app-launch contracts through `/api/creative/benchmarks` and the CUI.
- Guarded UI action lane: Level 3 `AXPress` and value-setting actions through policy, approvals, role allowlists, and expected target checks.
- File workflow lane: policy-guarded local file/folder list, search, summarize, Q&A, folder organization, batch rename, and text conversion planning routed through quick or background lanes.
- File organization lane: deterministic by-type folder, batch rename, semantic text-conversion, and copy-convert plans with per-step policy preview, content redaction for generated write plans, explicit apply confirmation, the same approval/local-execution gates before any move/copy/create/write action, and post-apply destination/source verification evidence in workflow history.
- File benchmark lane: preview-only fixture checks for list, search, organization, rename, semantic conversion redaction, copy-convert, and apply-confirmation gates through `/api/files/benchmarks` and the CUI. It creates and deletes a temporary project fixture, does not call models, does not start apps, and does not mutate user files.
- Knowledge vault lane: Obsidian/Markdown vault discovery, read-only note search with snippets/tags/wikilinks, preview-first note creation/append/daily-note plans, read-only MCP server discovery, preview-only MCP workflow planning, local MCP execution approval requests from local JSON configs, approved stdio `tools/list` schema inspection, Realtime voice `plan_mcp_tool_call` approval planning, separately approved stdio `tools/call` execution, confirmed Markdown writes through file policy, `/api/knowledge/*`, `/api/mcp/servers`, `/api/mcp/workflow`, `/api/mcp/tool-call`, CUI benchmarks/discovery/previews, and Realtime tools.
- MCP discovery/planning lane: scans known local Claude Desktop, Claude Code, Cursor, and project `.mcp.json` files without starting server commands. It returns sanitized server names, source config paths, transport, command basename or URL host, args count, env key names only, and a task-to-server preview plan; env values and URL queries stay redacted. When explicitly requested, it can create a local approval record for a selected server/tool pair. Approving a schema request starts a stdio server only long enough to run MCP `initialize` and `tools/list`. Approving a tool-call request starts the stdio server, verifies the tool exists through `tools/list`, runs one `tools/call`, sanitizes text/media/resource/structured results for storage, audits the call, and then stops the process.
- Workflow history lane: user-level workflow records linked to jobs, targets, status, and results.
- Work briefing lane: deterministic status summary over readiness, jobs, workflows, approvals, memories, blockers, proactive workflow follow-ups, and suggested next actions.
- Work progress lane: deterministic spoken-style progress over active collaboration claims, active jobs, recent job results, active/blocked workflows, latest completions, and next actions.
- Work handoff lane: voice-ready synthesis over briefing, progress, active session, collaboration claims, next actions, and workflow continuation suggestions so Realtime can speak a coherent resume/update without assembling raw JSON itself.
- Approval review lane: Realtime voice can inspect pending approvals through redacted summaries, refuse approval without `confirm:true`, reject a specific approval id, or approve one exact id through the existing approval execution path; raw action contents stay out of spoken evidence.
- Bounded autonomy loop lane: `/api/autonomy/run` and Realtime `run_autonomy_loop` compose the existing route, local learning evidence, observe, work-next preview, optional policy-gated execution, progress verification, failed-worker recovery scan, and one explicitly budgeted recovery retry into an auditable envelope. Each run returns `agencyPlan`: a machine-readable primary next action, fallback attempts, blockers, ask-user-only boundaries, and spoken summary, so the agent can keep trying safe alternatives before asking the user. It defaults to preview-only; inferred learning is soft local context only and does not bypass routing, action policy, approvals, or worker recovery gates.
- Autopilot decision lane: read-only status over the unattended resident loop, including the latest decision, current auto-eligible candidate actions, skip reasons, routed failed-job recovery eligibility, and what the loop is waiting for; exposed through API, CUI, and Realtime voice without executing a tick.
- Work next lane: chooses and optionally runs exactly one safe next action across setup, approvals, sessions, Inbox, jobs, routed-work recovery envelopes, workflows, selected workflow continuation previews, and manual Realtime dogfood. It is exposed through API, Realtime voice tools, the interactive CUI, and scriptable CUI commands such as `npm run work:run -- --action-id route:<id>` or `npm run work:run -- --last-voice-route`. Realtime voice blockers carry a structured dogfood guide with the start entrypoint, CUI/API monitor, spoken prompts, and expected evidence such as `get_work_handoff`.
- Work session lane: local focus sessions with a goal, append-only notes/events, resume-from-history handoff, automatic evidence from Inbox/jobs/workflows/approvals, active-session status, spoken check-ins, and deterministic end summaries.
- Inbox lane: persistent local capture queue for clipboard/manual follow-ups that feeds the menu bar, CUI, work briefing, and task routing.
- Inbox triage lane: deterministic read-only priority sorting and lane suggestions over open captures, available from API, local command, voice tool, and panel.
- Inbox next-action lane: explicitly processes the highest-priority open capture by reusing the same Inbox router and marking the item done only when routing succeeds.
- Inbox routing lane: sends captured items through the same quick, background, Codex, or Claude router used by chat and voice, then marks successful captures done with route metadata.
- Workflow continuation lane: previews or creates follow-up workflows from prior records, preserving parent workflow ids and target context while adding related recent workflow records, explicit memory matches, recalled local skills, and inferred learning evidence to the continuation prompt. The same context powers proactive follow-up suggestions in briefing and work-next before any background continuation is queued.
- Workflow delivery lane: copies completed workflow results back to the system clipboard in result-only or Markdown format.
- Memory lane: user-approved local memories for durable preferences, project facts, and notes, with keyword search, task-context injection, and delete.
- Learning lane: optional local inferred profile distilled from passive ambient metadata, with local pause/resume, prompt-inclusion, delete, promote-to-memory, app/site/folder exclusion controls, routing evidence, Record & Replay-inspired `SKILL.md` draft generation, and read-only local skill recall that can change the routed plan without granting action permission.
- Demonstration lane: explicit user-started UI demonstration records with sanitized app/browser/screen/accessibility summaries, deterministic manual-preview playbooks, safe replay plans, confirmation-gated replay runs, confirmation-gated local skill promotion, API/CUI/Realtime voice tools, and delete controls. It stores no screenshots or clipboard text.
- Clipboard lane: local clipboard read/write, guarded by policy and audit logs.
- File lane: local file list/read/search/write/create/copy/move, guarded by allowed roots, risk levels, approvals, local-execution enablement, and audit logs.

## Runtime State

By default, local runtime state lives in:

```text
~/Library/Application Support/JAVIS/
  Runtime/
    jobs.json
    workflows.json
    routing.json
    collaboration.json
    sessions.json
    demonstrations.json
    shortcuts.json
    memories.json
    learned-profile.json
    inbox.json
    audit.jsonl
    action-policy.json
    control-mode.json
    approvals.json
```

`jobs.json` preserves recent background jobs across restarts. Any job that was queued or running when the process exited is marked failed on next boot so the user can see that it was interrupted.

`workflows.json` preserves recent user-level workflows, such as current-page summaries or background browser tasks. Workflow records store target app/page metadata, status, linked job id, parent workflow id, request text, result summary, and safe structured continuation metadata so JAVIS can explain, continue, or copy recent work back to the clipboard.

`routing.json` preserves user-level lane decisions across quick, background, Codex, Claude, local CLI, browser workflow, file workflow, and continuation paths. Records store lane, owner, scope, parallel group, approval requirement, status, result link, job/workflow ids, and compact result summaries so progress check-ins can explain who owns active work and what the next step is.
Each routing record also stores `contextPlan`, which explains the planned context budget and why screen, vision, Accessibility, browser page/DOM, clipboard text, file, memory, local skills, learning, or delegated-worker context was included or skipped. When local skill recall applies, the record also stores `skillRecallPlan`, which names the recalled skill, recommended tools, worker steps, shortcut candidacy, and confirmation gates.

`collaboration.json` preserves short-lived agent scope claims across resident restarts. External workers can claim an owner/scope/access pair, heartbeat it while editing, and release it when done. Active write claims seed the parallel router's ownership guard so JAVIS avoids launching overlapping Codex/Claude/local workers against the same file or folder.

`sessions.json` preserves local work sessions. Session records store a goal, active/done/cancelled status, local events, source, tags, timestamps, and deterministic summaries. Only one active session is allowed at a time, and the active session is surfaced in status, menu bar, briefing, and the buddy panel.

`demonstrations.json` preserves explicit UI demonstrations started by the user through API/CUI/voice. Records store a goal, short user notes, sanitized current-app/browser context, screen metadata, Accessibility outline summaries, and a deterministic manual-preview playbook. Replay planning converts completed records into app workflow steps that re-observe live UI targets before any later action; replay execution requires explicit confirmation and still enters the normal app workflow, action-policy, control-mode, approval, and audit path. Completed demonstrations can also generate reviewable Codex-style skill drafts, and saving them to the local user skills directory requires explicit confirmation. They do not store screenshots or raw clipboard text.

`shortcuts.json` preserves confirmed local trigger phrases for recalled skill plans. Shortcut candidates are built only from completed routing/job evidence that already carried an applied `skillRecallPlan`; saving a shortcut requires explicit confirmation through CUI/API/Realtime voice tools. Later routing can match the phrase and attach that same plan even when broad memory search is disabled, but the shortcut does not execute the skill, approve a replay, or change action-policy/control-mode gates.

`memories.json` preserves explicit local memories only when the user asks JAVIS to remember something. Memory records store text, kind, scope, tags, source, and timestamps, and can be searched or deleted through the local API.

`learned-profile.json` preserves the optional inferred local profile from ambient metadata. It stores aggregate app/browser/context patterns and a short local summary, not screenshots, clipboard text, or user-approved memory claims. Skill drafts are generated on demand from this profile plus recent routing/workflow records; saving a draft writes to the user-level `~/.agents/skills` directory only after explicit confirmation. Later task routing can read those local `SKILL.md` files, including demonstration-derived skills, as reusable procedures without treating them as permission to act.

`inbox.json` preserves local Inbox captures for pending follow-up items. Records store title, body, status, priority, source, tags, route metadata, and timestamps. Open items feed the resident status, menu bar, buddy panel, briefing next-action list, read-only triage output, and explicit next-action processing; routed items retain the selected lane, queued job id when present, and a short output summary.

Running jobs keep their latest log in `jobs.json`. Jobs launched from a routed task also retain `skillRecallPlan` when one was available, and worker prompts/logs include that plan as reusable procedure context without turning it into permission. Codex and Claude workers are launched in their own process group so cancellation can stop the worker tree instead of only the shell wrapper.

`audit.jsonl` records structured process, job, tool, and local-action events for debugging and later replay/audit work. The resident keeps the current audit log bounded by rotating oversized logs into timestamped local archives and retaining only a recent tail in the active file; `/api/audit/status` reports the current size, limit, retained tail size, and archive count. Realtime tool-call evidence is intentionally shorter-lived in memory; only compact audit metadata is persisted.

`action-policy.json` controls which local actions can run automatically, which require approval, and whether actions should run in dry-run mode.

`control-mode.json` stores the current runtime autonomy posture. It never expands allowlists or file roots; it only tightens effective thresholds before Mac actions, browser/Accessibility actions, CLI jobs, and Codex/Claude workers run.

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
