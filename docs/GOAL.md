# JAVIS Goal

Build a resident Mac agent that feels like a desktop companion and helps finish computer work through natural voice collaboration.

## Product Promise

JAVIS should stay quietly present on the desktop, listen when invited, understand the current screen when permitted, route work to the right model or tool, and help complete tasks that can be performed on the computer.

## North Star

A user can say what they want done, keep working normally, and JAVIS either answers immediately, watches the relevant screen context, or delegates a longer task to a background worker without breaking the flow.

## Multi-Agent Execution Model

- Realtime voice handles latency-sensitive collaboration: quick Q&A, screen-aware clarification, spoken progress check-ins, approval prompts, and small reversible local actions that need the user's immediate context.
- Background workers handle durable non-blocking work: Inbox triage, deep research, file/workflow plans, long-running status checks, and jobs that need pause, resume, cancellation, logs, and evidence.
- Codex and Claude handle repo-bound or code-heavy work: implementation, tests, review, documentation updates, issue investigation, and scoped edits with explicit ownership.
- Parallel execution is allowed only for independent work scopes: separate repos, separate files, separate research tracks, or read-only investigations. Shared files, secrets, irreversible actions, and user approvals serialize through one visible owner.
- Next verifiable engineering task: persist a lane decision record for every routed task with lane, owner, scope, parallel group, approval requirement, status, and result link, then surface it in history and spoken check-ins.

## Scope

- Voice-first interaction.
- Mac screen awareness with explicit permission.
- Fast lane for lightweight conversation.
- Deep lane for slow, high-quality work.
- Delegation to Codex and Claude Code for code-heavy tasks.
- Safe local automation for reversible actions first.
- Human confirmation before irreversible, private, or high-impact actions.

## Non-Goals For Now

- Fully autonomous purchases, messages, deletes, or account changes.
- Cross-device sync.
- Cloud-hosted personal memory.
- Replacing the operating system permission model.
