# JAVIS Roadmap

## Phase 0: Desktop Buddy MVP

- Transparent always-on-top desktop buddy.
- Desktop pet stays visually minimal; configuration moves to terminal CUI.
- Realtime voice session.
- Screen sharing and frame analysis.
- Live screen context in active Realtime sessions.
- Private screen mode with renderer-side downscale/blur before API or Realtime delivery.
- Fast Q&A lane.
- Local task router for quick/deep/Codex/Claude lane selection.
- No-model local commands for resident status, Inbox capture/listing, app/URL open, and web search.
- Background deep lane.
- Codex and Claude Code delegation hooks.
- Login-start resident mode.
- Visible resident LaunchAgent status and install helper.
- macOS menu bar resident controls.
- Global pet hotkey.
- Global tap-to-summon hotkey that wakes JAVIS and parks it at the notch.
- Global clipboard-to-Inbox capture hotkey.
- Resident notifications for approvals and background task completion.
- Push-to-talk voice mode.
- Runtime/tool activity log in CUI/API, not on the desktop pet.
- Desktop pet consumes resident presence as a traffic-light Dynamic Island capsule instead of showing diagnostic chips.

## Phase 1: Reliable Resident Server

- Split the local API service from the Electron buddy UI.
- Add health checks, structured logs, and restart visibility.
- Add readiness diagnostics for setup, permissions, policy, and runtime state.
- Add Mac context visibility for frontmost app/window and clipboard state.
- Add browser context visibility for supported active tabs.
- Add metadata-only local browser activity summaries from ambient observations into presence, Realtime preflight context, Realtime tools, CUI, and API.
- Add read-only active browser page extraction for webpage-aware tasks.
- Persist background task history.
- Persist user-level workflow history with linked jobs and results.
- Add deterministic work briefing over status, blockers, recent work, and next actions, filtering internal eval/doctor evidence out of user-facing Work Next.
- Add deterministic lane contract registry for owner/scope/handoff/risk boundaries before model choice.
- Add deterministic spoken progress check-ins for background jobs and workflows.
- Add unified work-next execution for one safe next action across the local workbench.
- Add local work sessions for focus goals, notes/events, resume handoffs, automatic evidence capture, spoken check-ins, and end-of-session summaries.
- Add safe local command routing before model calls for basic resident operations.
- Persist explicit local memories for user-approved preferences, project facts, and notes.
- Persist a local inferred learning profile from passive ambient metadata, separate from explicit memory.
- Generate reviewable Codex-style skill drafts from local learning, routing, and workflow evidence, with explicit export to user-level `~/.agents/skills`.
- Persist confirmed local skill shortcuts so repeated successful workflows can be recalled by phrase and managed from CUI/API/Realtime voice without turning the desktop pet into a dashboard.
- Persist local Inbox captures for clipboard/manual follow-ups and include them in briefing.
- Add read-only Inbox triage for priority sorting and lane suggestions.
- Add explicit process-next Inbox flow for doing one highest-priority capture at a time.
- Route Inbox captures into quick/background/Codex/Claude work from CUI/API or voice tools.
- Copy workflow results back to the clipboard from CUI/API or voice tools.
- Add cancellable background workers with visible logs, structured failure recovery plans, `/api/jobs/recovery` summaries, and Realtime `get_worker_recovery` access for attempts, diagnostics, recovery child jobs, and recommended next actions.
- Add a multi-agent lane decision record for every routed task: realtime voice, background, Codex, Claude, owner, lane contract, write scope, parallel group, approval requirement, status, and result link.
- Add resident status views and spoken check-ins that report active parallel work by lane, owner, blocker, and next action.
- Add a local config validator with terminal CUI diagnostics.
- Add a setup guide that maps blockers to the next safe local setup action.
- Add signed allowlists for local actions.
- Add file tool runtime for list/read/search/write with risk-aware approvals.

## Phase 2: Practical Computer Workflows

- Browser task workflows: current build supports current-page summarize, action extraction, drafting, Q&A, guarded DOM click/fill/select, search/compare result-page capture loops with structured candidate links, guarded result-page review, and guarded multi-page research synthesis; next, add deeper iterative research loops and fill-draft loops.
- Accessibility tree workflows: current build supports read-only UI tree inspection, lazy Chromium web-hint reads, fast no-window fallback, dry-run UI target planning, guarded Level 3 AX press/value-action plumbing, one-step current-app control, current-state workflow planning, and short multi-step app workflows; next, richer permissioned app-specific workflows.
- File workflows: current build supports list/search/summarize/Q&A plus guarded by-type organization plans and Level 3 create/copy/move/rename actions; next, richer rename/convert plans and batch execution UX.
- Calendar, email, notes, and reminders through explicit connectors or local apps.
- Obsidian/MCP bridge for notes and knowledge work.
- Creative app bridge: current build recognizes video editing and music composition tasks, chooses common NLE/DAW apps, records stage action packs for imports, timeline edits, subtitles, MIDI sketches, mix/export previews, executes one guarded action at a time, and performs post-action screen/UI verification with recovery hints; next, add app-specific result checks for Final Cut Pro, Resolve, Logic, GarageBand, and Ableton.
- Coding workflows through Codex and Claude Code with clear owner/scope boundaries, progress updates, and parallel routing for independent work. Current build records per-task ownership metadata, exposes `npm run collab` for external Claude Code/Codex claim-heartbeat-release coordination, and serializes overlapping write scopes instead of launching competing agents against the same files; `npm run eval -- --only=parallel,collaboration` dogfoods read-only investigations, scoped documentation conflicts, and collaboration CLI status evidence.
- Live worker dogfood is opt-in: `JAVIS_EVAL_LIVE_WORKERS=true npm run eval -- --only=workers-live` queues real read-only Codex, Claude, and local CLI jobs, then verifies job logs, attempts, cancel state, and explicit internal `/api/work/progress` recent job links while default progress stays user-facing.
- Overnight autopilot: current build skips manual-only actions such as microphone/live-voice start, records structured decision evidence with candidate counts, skip summaries, and explicit waiting conditions, exposes that evidence to Realtime voice/CUI, advances eligible recovery work, and falls back to a cooldown-gated read-only maintenance snapshot when no user-visible action is auto-executable.
- Realtime worker dogfood: `JAVIS_EVAL_REALTIME_DOGFOOD=true npm run eval -- --only=realtime-live-dogfood` keeps a live conversation state, queues Codex/Claude/local read-only workers, records `realtime.progress_injection`, verifies grouped internal worker progress, and checks `spokenSummary` is short enough for voice progress answers.
- Realtime voice evidence monitor: current CUI option `V. Watch Realtime voice evidence` watches the real renderer/WebRTC evidence checklist, including structured status/phase/blocker output, renderer-recorded SDP offer/answer evidence, renderer live/data-channel state, current-vs-injected work-progress sequence sync, a guided `/api/realtime/dogfood/drill` checklist, recent sanitized Realtime tool-call metadata, work-handoff evidence for `get_work_handoff`, autopilot-status evidence for `get_autopilot_status`, attention-explanation evidence for `get_attention_explanation`, shortcut list/candidate/save/forget evidence, Realtime dogfood-session voice tool evidence for inspect/start/mark/end calls, and the `/api/realtime/dogfood` manual runbook. Realtime voice can call `get_realtime_evidence` to explain whether live WebRTC/progress is connected, what is blocked, and the next dogfood step, and can call `get_realtime_dogfood_session`, `start_realtime_dogfood_session`, `mark_realtime_dogfood_step`, and `end_realtime_dogfood_session` to maintain the same operator drill record without starting microphone capture. CUI option `D. Start Realtime dogfood drill` and `/api/realtime/dogfood/start` explicitly summon the pet and can schedule a short local read-only progress sample after the renderer reports a live voice session. CUI option `P. Copy next Realtime dogfood prompt`, `npm run config -- --print-realtime-dogfood-prompt`, `/api/realtime/dogfood/prompt`, and the dry-run copy API give operators the next manual/spoken prompt without starting microphone capture. CUI option `T. Track Realtime dogfood session`, `/api/realtime/dogfood/session`, and the step mark/end APIs keep a local operator record for real spoken drills while keeping the desktop pet free of diagnostics; active session snapshots now auto-sync current evidence into sticky persisted step progress, so completed evidence remains visible after voice disconnects. `/api/work/next` uses the same manual start path when the blocker is `needs_live_session` and now carries a structured dogfood guide with start, monitor, prompt, and expected-evidence instructions; this action is manual-only so unattended autopilot never starts microphone/live voice, and no desktop pet diagnostics are added.
- Verifiable next task: run the guided drill through a real renderer/WebRTC voice session with the CUI evidence monitor open until the drill marks progress answer, handoff tool call, autopilot status tool call, attention explanation tool call, shortcut list/save/recall/forget, and routed shortcut recall as ready.

## Phase 3: Natural Collaboration

- Wake-word or push-to-talk mode.
- Better interruption handling.
- Ongoing screen context with privacy zones: current build supports a global private/clear screen mode; next, add selectable app/window/region redaction.
- Task memory scoped to the local machine: current build supports explicit local memories plus a controllable local inferred learning profile with pause/resume, prompt inclusion, exclusions, deletion, promotion to memory, routing evidence, reviewable skill draft generation, explicit UI demonstration records available from API/CUI/Realtime voice that turn sanitized app/browser/accessibility captures into manual-preview playbooks, safe replay plans, confirmation-gated replay runs, confirmation-gated local skill drafts, read-only local skill recall that writes structured `skillRecallPlan` evidence into task routing and queued worker execution, and confirmed local shortcut phrases for repeated successful skill plans with CUI/API/Realtime list/save/forget controls plus short Realtime tool-call evidence; next, dogfood shortcut recall and save/forget from a real live voice session.
- Capture queue scoped to the local machine: current build supports persistent Inbox items, read-only triage with lane/source/priority grouping, voice-ready confirmation policies, explicit process-next, and routing them into work lanes; next, dogfood spoken confirmation from a real live voice session.
- Work sessions scoped to the local machine: current build supports start/resume/status/note/check-in/end plus automatic evidence from Inbox, jobs, workflows, approvals, and a voice-ready work handoff over progress/session/collaboration/next actions; `/api/realtime/evidence` now shows whether live voice actually called `get_work_handoff`; next, dogfood the handoff in a real live voice session.
- Long-running work status scoped to the local machine: current build supports deterministic progress check-ins over jobs and workflows plus a work-progress sequence that lets active Realtime voice sessions sync grouped worker updates when job/workflow/routing state changes; `/api/realtime/evidence` reports whether the voice layer has the current sequence or is stale; next, make those live updates richer and more app-specific.
- Presence status scoped to the local machine: current build exposes standby/watch/work/listening state, quiet attention policy, compact pet-state mapping for the traffic-light pet, policy-gated attention notification throttling for approvals/setup/voice errors, operator-only attention history in API/CUI without desktop pet diagnostics, and Realtime `get_attention_explanation` for short spoken attention explanations; next, dogfood the explanation in a real live Realtime session.
- Continue-from-history prompts: current build previews and runs workflow continuations with parent workflow context, related recent workflow records, explicit memories, local skill recall, inferred learning evidence, proactive follow-up suggestions in briefing/work-next, and short spoken handoffs that mention continuation candidates; next, use those handoffs during live Realtime dogfood.

## Phase 4: Trust And Autonomy

- Per-action risk levels.
- User approval queue for sensitive operations.
- Replayable audit log.
- Dry-run mode for local automation.
- Evaluation suite for voice latency, task success, and safety behavior.
