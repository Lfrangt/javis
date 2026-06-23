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

## External Advantages To Absorb

JAVIS should learn from the current local-agent ecosystem, but adapt those strengths into its own Mac-first, voice-first shape.

- Samuel-style realtime companionship: wake-word or tap-to-talk voice, fast voice replies, permitted screen context, optional system-audio context, smart per-turn context decisions, and consent popups before continuous perception.
- Fazm-style Mac usefulness: native-feeling macOS setup, voice-driven control of browser/apps/documents, workflow learning, and a path toward local speech recognition so basic voice input can work without sending raw audio away when the user chooses local mode.
- OpenClaw-style gateway architecture: one resident control plane for sessions, tools, skills, channels, logs, routing, daemon status, allowlists, and security checks.
- Hermes-style shared core across surfaces: the same agent state must be reachable from the pet, CUI, local API, future richer desktop panels, and optional remote/mobile control, instead of each surface becoming a separate product.
- Maestro-style orchestration: long-running Codex/Claude/deep tasks, worktree-aware isolation, playbooks, event triggers, progress check-ins, and phone-friendly monitoring for unattended work.
- Goodable/Skales/OpenYak-style desktop workspace: low-friction install, BYOK provider choice, optional local models, MCP and skill integrations, artifact-first outputs, file/workspace awareness, and no requirement that the user live in a terminal.
- OpenPets-style shared companion state: the desktop buddy should be able to show status from JAVIS, Codex, Claude Code, browser/file/app workers, and future local tools without becoming a dashboard.
- agent-desktop/browser-use/CUA/UI-TARS-style control reliability: prefer structured Accessibility trees, DOM/CDP bridges, stable element refs, screenshots only when useful, recovery hints, self-verification loops, and benchmarks for real computer-use tasks.
- Security lessons from OpenClaw-class systems: third-party skills, inbound messages, browser sessions, shell commands, and local file actions are untrusted until policy, sandboxing, approvals, and audit logs say otherwise.
- Product lesson from all of them: the user should get finished work, visible ownership, and recoverable history, not just an impressive chat transcript.

## Implementation Commitments

These are not marketing comparisons. They are goals JAVIS should implement.

- Smart context assembly: classify each turn before capturing screen, Accessibility trees, browser text, clipboard, files, memory, or audio, so realtime voice stays fast and private by default.
- Perception consent model: screen watching, background listening, browser reading, clipboard access, and app control each need clear status, toggles, first-use approval, and audit trails.
- The current operator surface for that model is `/api/perception/consent`, Realtime `get_perception_consent`, and `npm run config -- --print-perception`: it belongs in the CUI/local API/voice evidence, not in the tiny desktop pet.
- Control modes: support observe-only, ask-before-action, trusted local low-risk action, and takeover-style supervised execution, with hard stops for sends, deletes, purchases, account changes, and private data exposure.
- Native setup path: provide signed/notarized Mac builds, LaunchAgent resident mode, guided permission setup, self-checks, one-step fixes, and update/recovery flows that do not require manual debugging.
- Local and BYOK model paths: keep OpenAI Realtime as the premium voice lane, while leaving room for local STT/TTS/LLM, Ollama/Rapid-MLX-compatible providers, OpenRouter-style BYOK routing, and offline-capable narrow commands.
- Extreme cloud-spend safety: an API key may exist locally, but cloud spend must default to zero and require hard-lock off, positive budget, exact phrase confirmation, a short-lived one-request lease, guarded OpenAI network egress, runtime key-env isolation, zero-spend memory key vaulting, child-process credential redaction, inline key-env injection blocking, and local audit evidence before any OpenAI request can leave the resident or any background worker can inherit credentials. A runtime emergency lockdown must also be available to clear active leases, vault the callable key from current-process memory, and block current-process spend checks immediately before config reload or restart.
- Skill and tool ecosystem: support curated local skills, MCP servers, browser/file/app tools, validation hooks, versioning, permissions, and safe repair suggestions without silently enabling untrusted code.
- Multi-agent workbench: queue and resume long tasks, spawn isolated workers when scopes are independent, serialize conflicting write scopes, expose logs/results, and let the user continue, cancel, approve, or copy outcomes.
- Reliable desktop automation: use Accessibility/DOM refs before coordinates, attach actions to observed targets, re-observe after stale refs, verify results, and return actionable recovery when an app, page, or permission blocks progress.
- Artifact-first workflows: produce useful files, reports, tables, plans, screenshots, summaries, PRs, folder changes, and clipboard-ready results as first-class outputs linked from workflow history.
- Learning loop with control: turn repeated successful workflows into suggested memories, skills, shortcuts, or playbooks only with user visibility, deletion controls, and evidence of how the learned signal changed routing.
- Remote and mobile observability: eventually allow phone or remote panel check-ins through an authenticated user-owned gateway, while keeping local state, secrets, and approvals under the user's control.
- Evaluation harness: maintain repeatable checks for Realtime voice configuration, voice latency, screen-context usefulness, browser workflow success, app-control safety, file-action policy, worker recovery, and skill sandbox behavior.

## Operating Principles

- Voice smoothness comes first. The realtime lane keeps conversation flowing with short spoken responses, lightweight screen awareness, and immediate status updates.
- Speed claims must be measured. Realtime dogfood records click-to-live, negotiation, and live-to-progress latency in CUI/API evidence before changing models or architecture.
- Hard work runs behind the voice. Research, coding, browser workflows, file organization, and multi-step automations should move to background lanes without blocking conversation.
- The router chooses a lane before choosing a model. Simple answers use fast models or deterministic local commands; deep work uses stronger models, Codex, Claude Code, browser workers, or file/app workflows.
- Workers should be adversarial and persistent. When a task is possible, the worker should search, inspect evidence, retry, try alternate tools, and produce a useful result instead of giving up early.
- Autonomy should ask last. For recoverable problems, JAVIS should inspect existing evidence, try another safe browser/file/app/background lane, preview scoped Codex/Claude delegation, or use worker recovery before returning the problem to the user.
- Failed workers should expose targeted recovery actions that can be previewed, spoken, or queued through the same policy gates instead of relying on a generic "try again" prompt.
- Escalation is reserved for real boundaries: missing user intent, missing credentials, private/irreversible actions, external account blocks, or conflicts that cannot be resolved safely.
- The user should see ownership, not noise. Progress check-ins should say who owns the work, what is running, what is blocked, and what the next safe action is.
- Finished artifacts matter more than conversation volume. A successful workflow should leave behind an inspectable result, log, decision, file, or next action.
- Privacy and speed are product features. JAVIS should avoid expensive context gathering when the current request does not need it.
- Permission UX is part of reliability. A blocked microphone, screen, accessibility, browser, file, or automation permission should produce a clear next action instead of a vague failure.

## Local User Distillation

JAVIS should become more personally useful the longer it lives on the Mac. It should distill the user's habits into a local, evolving profile that helps it predict preferred workflows, phrasing, tools, timing, apps, files, browser contexts, and tolerance for autonomy.

This learning system is part of the product, not a hidden analytics feature:

- Long-term tracking stays local by default. Raw runtime data, ambient metadata, learned summaries, and explicit memories live under the local JAVIS runtime directory unless the user explicitly exports or syncs them later.
- Learning is layered. Explicit user-approved memory stores durable facts and preferences; passive learning distills app/window/browser/task/session patterns; workflow history records what was attempted, what succeeded, and what failed.
- Repeatable UI workflows are explicit artifacts. A demonstrated workflow should leave a local demonstration record, safe replay preview, reviewable skill draft, Realtime evidence, and confirmation gates before any replay run or skill save.
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
- Next verifiable engineering task: prepare the full live drill first through `npm run dogfood:realtime-prepare` or `/api/work/next?actionId=realtime_voice:needs_live_session`, which loads the prompt script, starts or reuses the operator tracker, saves local prep/archive evidence, and prints the final mic-confirmed command without starting microphone capture. Then run the guided Realtime dogfood drill from a real renderer/WebRTC voice session, using the opt-in renderer trigger `npm run dogfood:realtime-renderer -- --execute --confirm-mic`, CUI option `R`, or `POST /api/realtime/dogfood/renderer/start` with `execute:true` and `confirmMic:true` to prove the renderer can start the actual WebRTC voice path, then using Realtime tools `get_realtime_dogfood_session`, `start_realtime_dogfood_session`, `mark_realtime_dogfood_step`, `end_realtime_dogfood_session`, and `save_realtime_dogfood_archive` or CUI option `T` for an operator drill record that auto-syncs sticky evidence progress, CUI option `B` or `/api/realtime/dogfood/brief` for the one-page live dogfood brief, CUI option `A` or `POST /api/realtime/dogfood/archive` for the local evidence archive, CUI option `P` or `/api/realtime/dogfood/prompt` for the next spoken/manual prompt, and CUI option `V` for evidence, until the spoken progress answer, work handoff, autopilot status, attention explanation, perception consent, one UI demonstration Record & Replay sequence, dogfood-session inspect/start/mark/end calls, shortcut list/save/forget tool calls, confirmation gate, routed shortcut recall, and a saved local dogfood archive are all marked ready in local evidence.

## Scope

- Voice-first interaction.
- Mac screen and optional system-audio awareness with explicit permission.
- Fast lane for lightweight conversation.
- Deep lane for slow, high-quality work.
- Delegation to Codex and Claude Code for code-heavy tasks.
- Safe local automation for reversible actions first, then richer supervised app/browser/file workflows.
- Browser, file, current-app, and CLI automation through scoped worker lanes.
- Creative software workflows for video editing, subtitles, color, music composition, DAW arranging, mixing, and export preparation, starting with stage action packs and guarded app control.
- OpenClaw-inspired gateway, agent loop, specialist lane, and delegate architecture adapted for realtime voice on macOS.
- Hermes/Maestro-inspired multi-surface and multi-agent management, with the pet, CUI, local API, worker logs, and future panels sharing one core state.
- Skill, MCP, and local tool extension with explicit trust, validation, permissions, versioning, and auditability.
- Native Mac setup, resident operation, self-checks, updates, and recovery flows that make JAVIS usable without hand-editing internals.
- Local/BYOK model support where practical, including local voice and narrow offline commands as lower-risk fallback paths.
- Artifact-first workflows that return files, reports, tables, PRs, workflow records, copied results, or clear next actions.
- Optional remote/mobile observability through a user-owned authenticated gateway after local reliability and safety are solid.
- Local long-term user-distillation that makes JAVIS more personally adapted over time while keeping learned data on this Mac.
- Human confirmation before irreversible, private, or high-impact actions.

## Non-Goals For Now

- Copying OpenClaw's interface or becoming a noisy dashboard.
- Copying any one external project wholesale; JAVIS should absorb the useful patterns while staying a quiet Mac companion.
- Fully autonomous purchases, messages, deletes, or account changes.
- Cloud-owned cross-device sync or remote control before the local Mac gateway is reliable, authenticated, and permissioned.
- Cloud-hosted personal memory.
- Hidden analytics or cloud behavior profiling.
- Replacing the operating system permission model.
- Always-on raw recording without an explicit user-controlled mode, visible status, and retention policy.
