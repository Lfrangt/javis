# JAVIS

Local-first resident AI agent for macOS.

JAVIS is built to stay quietly available on your Mac, take typed or voice requests, use permitted local context, route work to the right tool or model, and leave recoverable evidence for what happened.

The desktop pet and status board are optional surfaces. The product core is the resident local server, CLI/API, router, workers, memory, approvals, and audit trail.

> Early developer prototype. Expect rough edges around Realtime voice setup, macOS permissions, native packaging, and broad app control.

## What Works

- Local resident server on `127.0.0.1`.
- LaunchAgent install/restart/uninstall flow.
- Optional Electron desktop pet that can be shown, hidden, parked, or closed.
- No-microphone typed voice-command fallback.
- Attended OpenAI Realtime voice lane.
- Permissioned screen, browser, app, file, clipboard, and memory context.
- Task routing across quick answers, browser/file/app workflows, terminal commands, Codex, Claude Code, and background workers.
- Local jobs, workflows, Inbox items, memories, approvals, audit logs, status board, and evals.
- Zero-spend startup posture; live provider use is opt-in.

## Quick Start

```bash
npm install
cp .env.example .env
npm run config
npm run doctor
```

Try the no-microphone path first:

```bash
npm run voice -- "What can you do right now?"
npm run voice:chat
```

Run the desktop app in development:

```bash
npm run dev
```

Open the local status board:

```bash
npm run board
```

## Realtime Voice

OpenAI Realtime is treated as a manual, attended lane. JAVIS should not start it silently at boot.

```bash
npm run voice:setup
npm run dogfood:realtime-provider-probe
npm run dogfood:realtime-prepare
npm run dogfood:realtime-live
```

Useful spend controls:

```bash
npm run openai:spend
npm run openai:lockdown
npm run openai:recover
```

## Resident Mode

```bash
npm run resident:install
npm run resident:restart
npm run resident:watchdog:check
npm run resident:uninstall
```

Runtime data lives under:

```text
~/Library/Application Support/JAVIS/Runtime/
```

That directory contains local state such as jobs, workflows, routing history, memories, approvals, audit logs, and the local API token.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run config` | Open the terminal setup/control surface. |
| `npm run doctor` | Check local readiness. |
| `npm run dev` | Run Vite and Electron together. |
| `npm run start:desktop` | Run the built desktop app. |
| `npm run board` | Open the local status board. |
| `npm run voice -- "..."` | Send one no-microphone voice-command request. |
| `npm run voice:chat` | Start the no-microphone command loop. |
| `npm run dogfood:realtime-prepare` | Prepare an attended Realtime dogfood run. |
| `npm run dogfood:realtime-live` | Run the opt-in Realtime live dogfood check. |
| `npm run work:next` | Preview the next safe local action. |
| `npm run agents:preflight` | Preview background-agent capacity. |
| `npm run collab` | Show Codex/Claude collaboration state. |
| `npm run eval` | Run the validation suite. |
| `npm run build` | Build the app. |

## Safety Model

- The local API binds to `127.0.0.1`.
- Protected endpoints use a local runtime token.
- API keys stay in local `.env` or runtime config.
- Startup does not open the microphone.
- Startup does not start Realtime voice.
- Unattended cloud/provider spend is off by default.
- Worker child processes do not inherit provider credentials by default.
- Risky actions, private data exposure, account changes, purchases, sends, deletes, and external side effects require explicit confirmation.
- Local actions should leave evidence the user can inspect.

macOS permissions still have to be approved manually in System Settings.

## Project Map

- `electron/` - resident server, local API, routing, desktop bridge, and macOS integration
- `src/` - optional React desktop surface
- `scripts/` - setup, CUI, dogfood flows, evals, and operations tooling
- `docs/` - product direction, architecture, operations, safety, roadmap, and research

## Docs

- [Goal](docs/GOAL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Operations](docs/OPERATIONS.md)
- [Safety](docs/SAFETY.md)
- [Roadmap](docs/ROADMAP.md)

## Requirements

- macOS
- Node.js and npm
- Xcode command line tools for some macOS/native features
- Optional: OpenAI API key for Realtime voice
- Optional: Codex CLI, Claude Code, Chrome, and other local tools for extra lanes

## License

MIT
