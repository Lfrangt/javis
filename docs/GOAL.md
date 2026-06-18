# JAVIS Goal

Build a resident Mac agent that feels like a desktop companion and helps finish computer work through natural voice collaboration.

## Product Promise

JAVIS should stay quietly present on the desktop, listen when invited, understand the current screen when permitted, route work to the right model or tool, and help complete tasks that can be performed on the computer.

## North Star

A user can say what they want done, keep working normally, and JAVIS either answers immediately, watches the relevant screen context, or delegates a longer task to a background worker without breaking the flow.

## Reference Model

JAVIS is a realtime voice-first, local-Mac version of the OpenClaw-style personal agent: a resident gateway that can listen, see permitted computer context, route work, call tools, and persist progress.

The goal is not to copy OpenClaw's UI. The desktop surface should stay almost invisible: a tiny notch/dynamic-island light or pet state. Configuration, permissions, logs, routing detail, and diagnostics belong in the terminal CUI and local API.

The OpenClaw ideas worth adopting are:

- A single resident gateway/server that owns local state, tools, sessions, routing, and device permissions.
- A repeatable agent loop: intake, context assembly, model/lane selection, tool execution, streaming progress, persistence, and replayable audit logs.
- Explicit lane contracts before model choice, so every task has a clear owner, scope, risk boundary, and handoff path.
- Specialist lanes and delegates for browser, file, Mac app control, code work, research, and background jobs, instead of one model trying to do everything.
- Parallelism only when scopes are independent, with conflict serialization when files, accounts, approvals, secrets, or irreversible actions are shared.
- Local-first trust: user-owned API keys, local runtime state, explicit memories, optional inferred learning, and clear permission boundaries.

## Operating Principles

- Voice smoothness comes first. The realtime lane keeps conversation flowing with short spoken responses, lightweight screen awareness, and immediate status updates.
- Hard work runs behind the voice. Research, coding, browser workflows, file organization, and multi-step automations should move to background lanes without blocking conversation.
- The router chooses a lane before choosing a model. Simple answers use fast models or deterministic local commands; deep work uses stronger models, Codex, Claude Code, browser workers, or file/app workflows.
- Workers should be adversarial and persistent. When a task is possible, the worker should search, inspect evidence, retry, try alternate tools, and produce a useful result instead of giving up early.
- Escalation is reserved for real boundaries: missing user intent, missing credentials, private/irreversible actions, external account blocks, or conflicts that cannot be resolved safely.
- The user should see ownership, not noise. Progress check-ins should say who owns the work, what is running, what is blocked, and what the next safe action is.

## Local User Distillation

JAVIS should become more personally useful the longer it lives on the Mac. It should distill the user's habits into a local, evolving profile that helps it predict preferred workflows, phrasing, tools, timing, apps, files, browser contexts, and tolerance for autonomy.

This learning system is part of the product, not a hidden analytics feature:

- Long-term tracking stays local by default. Raw runtime data, ambient metadata, learned summaries, and explicit memories live under the local JAVIS runtime directory unless the user explicitly exports or syncs them later.
- Learning is layered. Explicit user-approved memory stores durable facts and preferences; passive learning distills app/window/browser/task/session patterns; workflow history records what was attempted, what succeeded, and what failed.
- The distilled profile should be compact and useful: work rhythms, commonly used apps/sites/folders, recurring task types, preferred response style, preferred automation aggressiveness, common blockers, and successful recovery strategies.
- The profile should improve routing and behavior. Realtime should know when to stay short, background workers should know what evidence style the user expects, and local automation should learn preferred safe defaults without skipping approval boundaries.
- Bionic evolution means measurable adaptation over time: JAVIS should compare recent behavior against older learned patterns, update confidence, forget stale habits, and explain what changed when asked.
- The user must keep control. There must be CUI/API controls to view learned signals, pause/resume learning, delete learned profile data, promote a learned signal into explicit memory, or exclude sensitive apps/sites/folders.
- Learning must not justify unsafe action. Learned habits can reduce friction for low-risk defaults, but private, irreversible, financial, account, delete, send, or install actions still require explicit intent and the normal policy gates.

## Multi-Agent Execution Model

- Realtime voice handles latency-sensitive collaboration: quick Q&A, screen-aware clarification, spoken progress check-ins, approval prompts, and small reversible local actions that need the user's immediate context.
- Background workers handle durable non-blocking work: Inbox triage, deep research, file/workflow plans, long-running status checks, and jobs that need pause, resume, cancellation, logs, and evidence.
- Codex and Claude handle repo-bound or code-heavy work: implementation, tests, review, documentation updates, issue investigation, and scoped edits with explicit ownership.
- Browser, file, and Mac-app workers handle their own tool surfaces through scoped capabilities, audit logs, and policy checks.
- Parallel execution is allowed only for independent work scopes: separate repos, separate files, separate research tracks, or read-only investigations. Shared files, secrets, irreversible actions, and user approvals serialize through one visible owner.
- Next verifiable engineering task: turn the existing ambient learning profile into a controllable local user-distillation loop with CUI/API view, pause/resume, delete, promote-to-memory, excluded app/site/folder controls, and prompt/routing evidence that shows how learned habits affected a decision.

## Scope

- Voice-first interaction.
- Mac screen awareness with explicit permission.
- Fast lane for lightweight conversation.
- Deep lane for slow, high-quality work.
- Delegation to Codex and Claude Code for code-heavy tasks.
- Safe local automation for reversible actions first.
- Browser, file, current-app, and CLI automation through scoped worker lanes.
- Creative software workflows for video editing, subtitles, color, music composition, DAW arranging, mixing, and export preparation, starting with stage action packs and guarded app control.
- OpenClaw-inspired gateway, agent loop, specialist lane, and delegate architecture adapted for realtime voice on macOS.
- Local long-term user-distillation that makes JAVIS more personally adapted over time while keeping learned data on this Mac.
- Human confirmation before irreversible, private, or high-impact actions.

## Non-Goals For Now

- Copying OpenClaw's interface or becoming a noisy dashboard.
- Fully autonomous purchases, messages, deletes, or account changes.
- Cross-device sync.
- Cloud-hosted personal memory.
- Hidden analytics or cloud behavior profiling.
- Replacing the operating system permission model.
