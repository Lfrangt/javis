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
- Add deterministic spoken progress check-ins for background jobs and workflows.
- Add unified work-next execution for one safe next action across the local workbench.
- Add local work sessions for focus goals, notes/events, resume handoffs, automatic evidence capture, spoken check-ins, and end-of-session summaries.
- Add safe local command routing before model calls for basic resident operations.
- Persist explicit local memories for user-approved preferences, project facts, and notes.
- Persist a local inferred learning profile from passive ambient metadata, separate from explicit memory.
- Persist local Inbox captures for clipboard/manual follow-ups and include them in briefing.
- Add read-only Inbox triage for priority sorting and lane suggestions.
- Add explicit process-next Inbox flow for doing one highest-priority capture at a time.
- Route Inbox captures into quick/background/Codex/Claude work from CUI/API or voice tools.
- Copy workflow results back to the clipboard from CUI/API or voice tools.
- Add cancellable background workers with visible logs.
- Add a local config validator with terminal CUI diagnostics.
- Add a setup guide that maps blockers to the next safe local setup action.
- Add signed allowlists for local actions.
- Add file tool runtime for list/read/search/write with risk-aware approvals.

## Phase 2: Practical Computer Workflows

- Browser task workflows: current-page summarize, action extraction, drafting, and Q&A; next, search/compare/fill-draft loops.
- Accessibility tree workflows: current build supports read-only UI tree inspection, dry-run UI target planning, guarded Level 3 AX press/value-action plumbing, one-step current-app control, current-state workflow planning, and short multi-step app workflows; next, richer permissioned app-specific workflows.
- File workflows: current build supports list/search/summarize/Q&A plus guarded by-type organization plans and Level 3 create/copy/move/rename actions; next, richer rename/convert plans and batch execution UX.
- Calendar, email, notes, and reminders through explicit connectors or local apps.
- Obsidian/MCP bridge for notes and knowledge work.
- Creative app bridge experiments, starting with read-only/dry-run control plans.
- Coding workflows through Codex and Claude Code with clear ownership and progress updates.

## Phase 3: Natural Collaboration

- Wake-word or push-to-talk mode.
- Better interruption handling.
- Ongoing screen context with privacy zones: current build supports a global private/clear screen mode; next, add selectable app/window/region redaction.
- Task memory scoped to the local machine: current build supports explicit local memories and an optional local inferred learning profile; next, richer retrieval inside workflows.
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
