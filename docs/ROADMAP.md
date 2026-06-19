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

## Phase 1: Reliable Resident Server

- Split the local API service from the Electron buddy UI.
- Add health checks, structured logs, and restart visibility.
- Add readiness diagnostics for setup, permissions, policy, and runtime state.
- Add Mac context visibility for frontmost app/window and clipboard state.
- Add browser context visibility for supported active tabs.
- Add read-only active browser page extraction for webpage-aware tasks.
- Persist background task history.
- Persist user-level workflow history with linked jobs and results.
- Add deterministic work briefing over status, blockers, recent work, and next actions.
- Add deterministic lane contract registry for owner/scope/handoff/risk boundaries before model choice.
- Add deterministic spoken progress check-ins for background jobs and workflows.
- Add unified work-next execution for one safe next action across the local workbench.
- Add local work sessions for focus goals, notes/events, resume handoffs, automatic evidence capture, spoken check-ins, and end-of-session summaries.
- Add safe local command routing before model calls for basic resident operations.
- Persist explicit local memories for user-approved preferences, project facts, and notes.
- Persist a local inferred learning profile from passive ambient metadata, separate from explicit memory.
- Generate reviewable Codex-style skill drafts from local learning, routing, and workflow evidence, with explicit export to user-level `~/.agents/skills`.
- Persist local Inbox captures for clipboard/manual follow-ups and include them in briefing.
- Add read-only Inbox triage for priority sorting and lane suggestions.
- Add explicit process-next Inbox flow for doing one highest-priority capture at a time.
- Route Inbox captures into quick/background/Codex/Claude work from CUI/API or voice tools.
- Copy workflow results back to the clipboard from CUI/API or voice tools.
- Add cancellable background workers with visible logs.
- Add a multi-agent lane decision record for every routed task: realtime voice, background, Codex, Claude, owner, lane contract, write scope, parallel group, approval requirement, status, and result link.
- Add resident status views and spoken check-ins that report active parallel work by lane, owner, blocker, and next action.
- Add a local config validator with terminal CUI diagnostics.
- Add a setup guide that maps blockers to the next safe local setup action.
- Add signed allowlists for local actions.
- Add file tool runtime for list/read/search/write with risk-aware approvals.

## Phase 2: Practical Computer Workflows

- Browser task workflows: current build supports current-page summarize, action extraction, drafting, Q&A, guarded DOM click/fill/select, search/compare result-page capture loops with structured candidate links, guarded result-page review, and guarded multi-page research synthesis; next, add deeper iterative research loops and fill-draft loops.
- Accessibility tree workflows: current build supports read-only UI tree inspection, dry-run UI target planning, guarded Level 3 AX press/value-action plumbing, one-step current-app control, current-state workflow planning, and short multi-step app workflows; next, richer permissioned app-specific workflows.
- File workflows: current build supports list/search/summarize/Q&A plus guarded by-type organization plans and Level 3 create/copy/move/rename actions; next, richer rename/convert plans and batch execution UX.
- Calendar, email, notes, and reminders through explicit connectors or local apps.
- Obsidian/MCP bridge for notes and knowledge work.
- Creative app bridge: current build recognizes video editing and music composition tasks, chooses common NLE/DAW apps, records stage action packs for imports, timeline edits, subtitles, MIDI sketches, mix/export previews, executes one guarded action at a time, and performs post-action screen/UI verification with recovery hints; next, add app-specific result checks for Final Cut Pro, Resolve, Logic, GarageBand, and Ableton.
- Coding workflows through Codex and Claude Code with clear owner/scope boundaries, progress updates, and parallel routing for independent work. Current build records per-task ownership metadata and serializes overlapping write scopes instead of launching competing agents against the same files; `npm run eval -- --only=parallel` dogfoods two read-only investigations plus two overlapping scoped documentation edits and verifies owner/scope/status/result-link metadata.
- Live worker dogfood is opt-in: `JAVIS_EVAL_LIVE_WORKERS=true npm run eval -- --only=workers-live` queues real read-only Codex, Claude, and local CLI jobs, then verifies job logs, attempts, cancel state, and `/api/work/progress` recent job links.
- Realtime worker dogfood: `JAVIS_EVAL_REALTIME_DOGFOOD=true npm run eval -- --only=realtime-live-dogfood` keeps a live conversation state, queues Codex/Claude/local read-only workers, records `realtime.progress_injection`, and verifies `spokenSummary` is short enough for voice progress answers.
- Verifiable next task: run the same flow through a real renderer/WebRTC voice session until `/api/realtime/evidence.readyForVoiceProgressQuestion` is true, then ask “后台现在怎么样” and confirm the grouped summary is heard.

## Phase 3: Natural Collaboration

- Wake-word or push-to-talk mode.
- Better interruption handling.
- Ongoing screen context with privacy zones: current build supports a global private/clear screen mode; next, add selectable app/window/region redaction.
- Task memory scoped to the local machine: current build supports explicit local memories plus a controllable local inferred learning profile with pause/resume, prompt inclusion, exclusions, deletion, promotion to memory, routing evidence, and reviewable skill draft generation; next, richer retrieval inside workflows and true record/replay capture of demonstrated UI sequences.
- Capture queue scoped to the local machine: current build supports persistent Inbox items, read-only triage, explicit process-next, and routing them into work lanes; next, add spoken confirmation policies and richer triage grouping.
- Work sessions scoped to the local machine: current build supports start/resume/status/note/check-in/end plus automatic evidence from Inbox, jobs, workflows, and approvals; next, improve spoken handoff quality.
- Long-running work status scoped to the local machine: current build supports deterministic progress check-ins over jobs and workflows; next, stream richer live updates into active voice sessions.
- Continue-from-history prompts over recent workflow records and memory-aware follow-up prompts.

## Phase 4: Trust And Autonomy

- Per-action risk levels.
- User approval queue for sensitive operations.
- Replayable audit log.
- Dry-run mode for local automation.
- Evaluation suite for voice latency, task success, and safety behavior.
