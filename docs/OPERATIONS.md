# JAVIS Operations

## Run Modes

Development:

```bash
npm run dev
```

Built desktop buddy:

```bash
npm run build
npm run start:desktop
```

Login-start resident mode:

```bash
npm run resident:install
npm run resident:uninstall
npm run resident:restart
```

Resident install, uninstall, and restart stop stale JAVIS Electron/npm processes from this project
before loading the LaunchAgent. This prevents an older process from keeping `JAVIS_API_PORT` open
while a newer LaunchAgent instance appears to be running.

## Health

```bash
curl http://127.0.0.1:3417/api/health
```

The health endpoint reports:

- process uptime and version
- configured model lanes
- whether `OPENAI_API_KEY` is present
- whether high-permission local execution is enabled
- queue counts
- runtime storage paths

For setup and permission debugging:

```bash
curl http://127.0.0.1:3417/api/readiness
curl http://127.0.0.1:3417/api/config/check
curl http://127.0.0.1:3417/api/setup/guide
npm run doctor
```

Readiness checks cover the OpenAI key, microphone, screen capture, Accessibility, local execution, action policy, control mode, runtime storage, queue state, and pending approvals.

The config check adds repeatable setup evidence for `.env`, `.env.example`, resident LaunchAgent installation, runtime files, policy files, and Codex/Claude worker command availability.

The setup guide turns current blockers into one safe next action:

```bash
curl http://127.0.0.1:3417/api/setup/guide
curl -X POST http://127.0.0.1:3417/api/setup/next \
  -H 'Content-Type: application/json' \
  -d '{}'
```

`/api/setup/next` only opens the relevant local target, such as `.env` or a macOS permission pane. It does not write API keys, grant permissions, or enable local execution.

The doctor command calls `/api/doctor/report` and combines health, readiness, resident status, worker availability, workflow storage, queue state, approval state, and safe policy previews. It exits non-zero when blocked unless `-- --allow-blocked` is provided:

```bash
npm run doctor -- --allow-blocked
npm --silent run doctor -- --json --allow-blocked
curl http://127.0.0.1:3417/api/doctor/report
```

Doctor also reports Realtime voice provider health. A configured `OPENAI_API_KEY` is not enough: recent WebRTC session negotiation failures, including HTTP 429 quota/rate-limit and billing errors, show as a warning for up to `JAVIS_REALTIME_PROVIDER_WARNING_MAX_AGE_MS` (24 hours by default). This keeps the desktop pet minimal while the terminal CUI and `/api/doctor/report` explain why live voice is not usable.

The evaluation harness is broader than doctor. Doctor checks setup and safety readiness; eval probes product lanes through the live local API with read-only or preview actions, then prints a scorecard:

```bash
npm run eval
npm run eval -- --list
npm run eval -- --only=health,realtime,routing,parallel,collaboration
JAVIS_EVAL_LIVE_WORKERS=true npm run eval -- --only=workers-live
JAVIS_EVAL_REALTIME_DOGFOOD=true npm run eval -- --only=realtime-live-dogfood
npm run dogfood:browser-live-fill
npm run dogfood:productivity-live
npm run eval:json
npm run eval:routing
```

Current eval lanes cover resident health, Realtime voice configuration and preflight context, Realtime shortcut tools, Realtime browser workflow tool evidence, work briefing, explicit memory, Inbox, routing, local skill shortcut confirmation/recall, four-task parallel ownership dogfood, collaboration claims, control-mode gates, perception consent/status, screen privacy rules, browser snapshots, browser workflow previews, app workflow benchmarks, productivity workflow benchmarks, knowledge vault benchmarks, file read/search/plan previews, file workflow benchmarks, creative workflow benchmarks, worker/autopilot observability, Accessibility smoke checks, and local learning/skill-draft preview. `workers-live`, `realtime-live-dogfood`, and `browser-live-fill` are intentionally opt-in because they queue real workers, manipulate a live browser, or create temporary live-session state. The browser live fill dogfood opens a temporary `127.0.0.1` form in a supported browser, runs confirmed `fill_draft`, verifies all fields through the live browser bridge, and confirms the form was not submitted. Worker opt-in checks request `/api/work/progress?includeInternal=true` so internal dogfood batches can be verified without leaking `eval_` or dogfood jobs into the default user-facing voice/pet progress surface. `realtime-live-dogfood` additionally keeps a temporary live conversation state, records a Realtime progress-injection receipt, and verifies the short `spokenSummary` used for voice progress answers. `npm run eval:routing` is a separate labeled-corpus check for deterministic lane classification.

Routine maintenance lives in the terminal CUI instead of the desktop pet:

```bash
npm run config
```

Use option `1. Set OpenAI API key` to paste the key locally with hidden input. It writes `OPENAI_API_KEY` to `.env` and can restart the resident service immediately. Do not paste API keys into chat or logs.

Use option `M. Open Microphone settings` when doctor reports microphone permission denied or voice cannot start. macOS still requires a human toggle in System Settings.

Use option `8. Toggle local execution` only when you want Level 3 local actions enabled. It requires typing `ENABLE` or `DISABLE`, writes `JAVIS_ENABLE_LOCAL_EXEC` to `.env`, and can restart the resident service immediately.

Use option `9. Toggle Level 3 auto-run` to switch Level 3 actions between approval-gated and automatic. Automatic Level 3 covers local file edits, typing into apps, Accessibility clicks, and Codex/Claude delegation. Level 4 actions should still require confirmation.

Use option `10. Toggle trusted local mode` when this Mac is intentionally being used as a high-autonomy local workstation. Enabling it writes `JAVIS_TRUSTED_LOCAL_MODE=true`, aligns Level 3 auto-run, and keeps Level 4 actions confirmation-gated. Doctor reports this as an acknowledged mode instead of a setup warning.

Use option `11. Set control mode` to switch the runtime posture without editing JSON. `observe_only` keeps JAVIS watching and reading but blocks local actions, `ask_before_action` requires approval for Level 2+ actions, and `trusted_local` / `takeover_supervised` stay bounded by action policy.

Use option `33. Show perception consent`, or:

```bash
npm run config -- --print-perception
curl http://127.0.0.1:3417/api/perception/consent
```

This prints the operator-only registry for screen context, voice microphone, ambient observation, browser metadata/page reading, clipboard, Accessibility/app control, local learning, and worker/CLI tools. Each surface reports whether it is enabled, current status, consent/policy gate, raw-content storage posture, local retention, controls, and recent audit event types. Keep this in the terminal CUI/API; the desktop pet should remain a minimal status light. Realtime voice can read the same registry with `get_perception_consent` when the user asks what JAVIS can see, store, or operate.

Use option `F. Show file workflow benchmarks`, or:

```bash
npm run config -- --print-file-benchmarks
curl http://127.0.0.1:3417/api/files/benchmarks
```

This runs preview-only fixture checks for file list/search, organization, rename, semantic conversion redaction, copy-convert, and the `confirm:true` apply gate. It creates a temporary fixture under the project, cleans it up, calls no models, starts no apps, and keeps the evidence in CUI/API instead of the desktop pet.

Use option `K. Show knowledge workflow benchmarks`, or:

```bash
npm run config -- --print-knowledge-benchmarks
curl http://127.0.0.1:3417/api/knowledge/benchmarks
```

This runs fixture-only checks for Obsidian/Markdown knowledge work: vault discovery, Markdown note search, note-create preview, `confirm:true` write gating, and one confirmed write inside a temporary fixture. It cleans the fixture, launches no apps, calls no models, records no workflow history, and does not mutate user notes.

Use option `X. Show MCP server discovery`, or:

```bash
npm run config -- --print-mcp-servers
curl http://127.0.0.1:3417/api/mcp/servers
```

This scans known local JSON configs for Claude Desktop, Claude Code, Cursor, and project `.mcp.json`. It is read-only: it does not start MCP server commands, it shows only command basenames or URL hosts, and it redacts env values plus URL query strings. Realtime voice can call `get_mcp_servers` before deciding whether a task should use Codex, Claude Code, or an MCP-backed workflow.

Use option `W. Preview MCP workflow plan`, or:

```bash
npm run config -- --print-mcp-workflow --task "这个任务应该用哪个 MCP 服务器？先不要执行"
curl -X POST http://127.0.0.1:3417/api/mcp/workflow \
  -H 'Content-Type: application/json' \
  -d '{"task":"Choose the MCP server for this task, but do not execute.","execute":false}'
```

This uses the same sanitized MCP discovery data to select candidate servers and print the next confirmed steps. It is preview-only: it does not start MCP server commands, does not call MCP tools, and still redacts env values plus URL query strings. Realtime voice can call `plan_mcp_workflow` when the user asks which MCP/external tool bridge should handle a concrete task.

Use option `C. Show creative workflow benchmarks`, or:

```bash
npm run config -- --print-creative-benchmarks
curl http://127.0.0.1:3417/api/creative/benchmarks
```

This runs preview-only checks for video-editing and music-production workflows: import planning, export confirmation gates, MIDI/sketch planning, mix planning, prompt previews, and missing asset-path gates. It calls no models, launches no creative apps, performs no UI/file mutations, and records no workflow history.

Use option `U. Show app workflow benchmarks`, or:

```bash
npm run config -- --print-app-benchmarks
curl http://127.0.0.1:3417/api/app/benchmarks
```

This runs preview-only checks for generic Mac app workflows: deterministic open/close planning, typed-text planning, current-app-control planning, explicit multi-step previews, unsafe delete rejection, and no-history/no-app-launch contracts. It calls no models, starts no apps, performs no UI/file mutations, and records no workflow history.

Use option `Y. Show productivity workflow benchmarks`, or:

```bash
npm run config -- --print-productivity-benchmarks
curl http://127.0.0.1:3417/api/productivity/benchmarks
```

This runs preview-only checks for Notes, Reminders, Calendar, and Mail workflows: note capture planning, reminder creation planning, calendar confirmation gates, email draft planning, missing-recipient gates, and email-send blocking. It calls no models, starts no apps, performs no UI/file mutations, sends no messages, and records no workflow history.

For a repeatable productivity live dogfood entrypoint:

```bash
npm run dogfood:productivity-live
npm run dogfood:productivity-live -- --suite
npm run dogfood:productivity-live -- --execute --confirm --title "JAVIS dogfood" --body "Confirmed local note body"
```

Without `--execute --confirm`, the script only calls `/api/productivity/action` in preview mode. `--suite` runs the Notes, Reminders, Calendar, and Mail draft cases together and saves a local JSON evidence packet in `Runtime/productivity-dogfood-archives/`; preview suite runs do not start apps, send messages, mutate files, or record workflow history. With both execution flags, it can create a confirmed Notes note by default, or target Reminders/Calendar/Mail with `--intent`, `--app`, `--action`, and required fields such as `--dueAt`, `--startAt`, `--endAt`, `--recipient`, and `--subject`. Confirmed creation still passes through local execution, control mode, `allow.productivity_app`, macOS Automation/Accessibility permissions, and post-action observation. It never sends Mail, sends Calendar invitations, deletes, or bulk-edits records.

The same evidence path is available from the resident API and Realtime tools:

```bash
curl http://127.0.0.1:3417/api/productivity/dogfood/archive
curl -X POST http://127.0.0.1:3417/api/productivity/dogfood/archive \
  -H 'Content-Type: application/json' \
  -d '{"source":"operator_preview"}'
```

Realtime voice can call `get_productivity_dogfood_archive` to inspect the four-app preview and `save_productivity_dogfood_archive` to save a local JSON archive. By default these calls are preview-only; add `execute:true` and `confirm:true` only for an intentional live Mac run after reviewing the preview.

Use option `V. Watch Realtime voice evidence` while dogfooding a real WebRTC voice session. It polls `/api/realtime/evidence` until the chosen timeout and shows a structured `status`, `phase`, `blocker`, checklist, manual dogfood runbook, dogfood drill, `gapSummary`, current-vs-injected work-progress sequence sync, latest latency receipt, recent sanitized Realtime tool-call metadata, shortcut-tool evidence for list/candidate/confirmation/save/forget calls, dogfood-session evidence for `get_realtime_dogfood_session`, `start_realtime_dogfood_session`, `mark_realtime_dogfood_step`, and `end_realtime_dogfood_session`, handoff-tool evidence for `get_work_handoff`, autopilot-tool evidence for `get_autopilot_status`, attention-explanation evidence for `get_attention_explanation`, perception-consent evidence for `get_perception_consent`, local-capability evidence for `get_local_capabilities`, local-learning evidence for `get_learning_profile` and `get_learning_evolution`, browser read/workflow evidence for `read_browser_page` and `run_browser_workflow`, productivity dogfood archive evidence for `save_productivity_dogfood_archive`, and UI-demonstration evidence for `get_ui_demonstrations`, `plan_ui_demonstration_replay`, `draft_ui_demonstration_skill`, and the replay/save confirmation gates. Use option `B. Show Realtime dogfood brief`, `npm run config -- --print-realtime-dogfood-brief`, or `/api/realtime/dogfood/brief` for a one-page operator brief with readiness, gap summary, next prompt, follow-up prompts, evidence gates, and start/monitor commands; this never starts microphone capture. Use option `E. Show Realtime dogfood acceptance`, `npm run dogfood:realtime-acceptance`, `npm run config -- --print-realtime-dogfood-acceptance`, `/api/realtime/dogfood/acceptance`, or the Realtime `get_realtime_dogfood_acceptance` tool to turn current evidence/archive state into grouped pass/gap gates for live voice, passive progress, spoken answers, work/autopilot/attention/perception/capability/learning/browser/productivity tools, UI demonstration learning, shortcut save/recall/forget, and saved local archive; this is read-only and never starts microphone capture. Use option `A. Save Realtime dogfood archive`, `npm run config -- --save-realtime-dogfood-archive`, `GET/POST /api/realtime/dogfood/archive`, or the Realtime `save_realtime_dogfood_archive` tool to preserve the current brief, gap summary, evidence checklist, dogfood-session tracker, and recent related audit events as a local JSON packet in `Runtime/realtime-dogfood-archives/`; this stores no raw audio, includes no screen image, and does not start microphone capture. Use option `D. Start Realtime dogfood drill` to preview and then explicitly start the drill; when confirmed, it uses `/api/realtime/dogfood/start` to summon the pet and schedule a short local read-only progress sample after the renderer reports a live voice session. Use option `R. Run renderer Realtime dogfood`, `npm run dogfood:realtime-renderer -- --execute --confirm-mic`, or `POST /api/realtime/dogfood/renderer/start` with `execute:true` and `confirmMic:true` to trigger the renderer itself to start the real WebRTC voice path, wait for the data channel, send dogfood prompt text through the live Realtime session, report renderer-stage events, save the run archive, and print the acceptance pass/gap summary at the end; add `--require-acceptance` when the script should return nonzero unless every acceptance gate passes, or `--acceptance-only --no-save-archive` to inspect the current acceptance report without starting microphone capture. This path intentionally refuses to run without explicit mic confirmation and the renderer listener stays mounted across its own `idle -> connecting -> live/error` state transitions so the dogfood wait is not cancelled by startup. If the provider returns quota/rate-limit errors, the script prints the `/api/realtime/evidence` blocker and next action instead of reporting only a generic timeout. Use option `P. Copy next Realtime dogfood prompt`, `npm run config -- --print-realtime-dogfood-prompt`, or `/api/realtime/dogfood/prompt` to see the next manual/spoken step; `POST /api/realtime/dogfood/prompt/copy` copies only that prompt text and supports `dryRun:true` for tests, without starting microphone capture. Use option `T. Track Realtime dogfood session`, `npm run config -- --print-realtime-dogfood-session`, or `/api/realtime/dogfood/session` to start, inspect, mark, and end an operator-visible drill record while keeping the desktop pet minimal; live Realtime voice can call the same dogfood-session tools, and those calls are audited without starting microphone capture. Active dogfood sessions auto-sync from current evidence whenever CUI/API/Realtime tools inspect them, and a step that has once been evidence-proven stays as sticky progress in that session even if the live voice session later disconnects. Provider readiness, renderer WebRTC negotiation, renderer live/data-channel state, passive worker-progress injection through the WebRTC data channel, latest progress sequence sync, and the short spoken progress summary remain the core readiness checklist. The renderer records each real SDP offer/answer attempt after applying the answer, and records click-to-live, negotiation, and live-to-progress timing through `/api/realtime/latency`, so `session_negotiated` reflects actual SDP startup, `voice_session_live` proves the renderer reached the live data-channel state, and CUI can show whether the session felt fast or slow. Use option `H. Show spoken work handoff`, or `npm run config -- --print-work-handoff`, to print the exact short handoff that Realtime can use for "where are we / what next" answers. For a scriptable single snapshot, run `npm run config -- --print-realtime-evidence`; for only the guided drill payload, call `/api/realtime/dogfood/drill`. `/api/realtime/dogfood` returns the same runbook without starting microphone capture. `POST /api/realtime/dogfood/prepare` can manually queue a short local read-only progress sample so a live voice session has fresh worker progress to receive. When the evidence reaches `READY`, ask the live voice session: `后台现在怎么样`; to dogfood handoff, ask `现在做到哪了？接下来做什么？` and confirm the monitor shows `get_work_handoff`; to dogfood autopilot status, ask `autopilot 为什么没自己继续跑？` and confirm the monitor shows `get_autopilot_status`; to dogfood attention state, ask `为什么你现在是绿色？为什么刚才没提醒我？` and confirm the monitor shows `get_attention_explanation`; to dogfood perception consent, ask `你现在能看到什么、能操作什么？` and confirm it answers from consent registry evidence; to dogfood local capability routing, ask `你现在能做什么？这个任务应该用哪个工具？` and confirm the monitor shows `get_local_capabilities`; to dogfood local learning, ask `你最近学到了我什么使用习惯？` and confirm the monitor shows privacy-safe `get_learning_profile` evidence, then ask `最近我的使用习惯有什么变化？` and confirm the monitor shows privacy-safe `get_learning_evolution` evidence; to dogfood browser work, ask `帮我看看当前网页，提取下一步操作，先不要提交任何表单。` and confirm the monitor shows `read_browser_page` or safe-preview `run_browser_workflow` evidence; to dogfood productivity app coverage, ask `保存一份生产力四应用 dogfood 证据，先不要执行真实创建。` and confirm the monitor shows safe-preview `save_productivity_dogfood_archive` evidence; to dogfood a demonstrated workflow, ask it to start/capture/finish a short UI demonstration, plan replay, draft a skill, and confirm the monitor shows safe-preview replay, `draft_ui_demonstration_skill`, and confirmation gates before saving or running; to dogfood the operator record, ask it to inspect/start/mark/end the Realtime dogfood session and confirm the monitor shows the four dogfood-session tools with `starts microphone=no`; to dogfood shortcuts, ask it to list saved shortcuts, save a confirmed phrase, use that phrase once so routing records shortcut recall, and forget that phrase while this monitor is open, then save a dogfood archive so the run has a durable local artifact and check the acceptance report before treating the run as passed.

Use option `L. Show local capability map`, `npm run config -- --print-capabilities`, `/api/capabilities`, or the Realtime `get_local_capabilities` tool when JAVIS needs to decide what it can do next. The snapshot is read-only: it summarizes lane contracts, browser/file/app/knowledge/Codex/Claude readiness, current control mode, local execution, guardrails, the collaboration handoff with active owners/conflicts/next coordination action, and the next safe work item without starting microphone capture or running local actions.

In trusted local mode, file write/create/copy/move roots default to the project, Desktop, Documents,
and Downloads. Set `JAVIS_ALLOWED_WRITE_ROOTS` or edit `action-policy.json` in the CUI if you want a
different local scope.

Codex and Claude Code delegation uses the `allow.code_agent` policy block. Failed jobs keep `attempts`,
`failureKind`, and `recoveryPlan` with a redacted diagnostics snapshot in `/api/jobs/<job-id>`, `/api/jobs/recovery`, `/api/work/progress`, and linked routing records, so JAVIS can
diagnose missing commands, disabled local execution, policy blocks, approvals, timeouts, and retry paths
without turning the first failure into a dead end.
Recovery actions are also surfaced through `/api/briefing`, `/api/work/next`, and the Realtime `get_worker_recovery` tool; low-risk diagnostic
actions can be reviewed there without opening a separate UI. Realtime voice dogfood blockers are
surfaced there too: when `/api/realtime/evidence` is stuck at `needs_live_session`, running work-next
uses the same summon/wake path as `Option+Space` and parks the pet at the notch for the live session.
This Realtime voice action is marked manual-only because starting microphone/live voice requires an
explicit user action; overnight autopilot must skip it.
Blocked route records now return a structured route recovery envelope from `/api/work/next`: linked failed jobs expose their existing recovery actions, linked workflows expose continuation/copy-result options, and routes without an executable candidate still include the exact inspect target. You can target a specific route with `GET /api/work/next?actionId=route:<route-id>`. When the recommended route candidate is an existing failed-job recovery action that is already trusted/low-risk eligible, `/api/work/next` also exposes the autopilot decision that allows the unattended loop to run that one recovery candidate.
Retryable failed jobs can be advanced from work-next or `POST /api/jobs/:id/recovery/run` into a
narrower recovery job with the original task, attempts, diagnostics, and log tail attached. Realtime
voice can target the same path through `run_worker_recovery` when the user asks to recover a specific
failed worker. `JAVIS_MAX_RECOVERY_JOB_ATTEMPTS` caps those queued recovery jobs per failed parent job.

Use option `14. Show next work item`, or `npm run config -- --print-work-next`, to preview the current `/api/work/next` action from the CUI.

Use CUI option `27. Show collaboration handoff`, `npm run config -- --print-collaboration-handoff`,
`npm run collab -- handoff`, or `GET /api/collaboration/handoff` when Codex, Claude Code, or
a local CLI worker is sharing the repo. The handoff summarizes active owners, write scopes,
heartbeat/release commands, conflict pairs, and the next safe coordination action; Realtime
`get_collaboration_state` returns the same handoff alongside the raw claim ledger.

Use option `15. Run next work item` to preview and then execute the current workbench action after
typing `RUN`. This is the manual path for recovering blocked jobs or routed work, processing the top Inbox item,
checking progress, summoning a real Realtime voice dogfood session, or delivering a completed workflow result without memorizing HTTP calls. Realtime voice actions print a small guide with the pet/hotkey start path, CUI monitor, the prompts `后台现在怎么样` and `现在做到哪了？接下来做什么？`, and the expected `get_work_handoff` evidence. Internal
smoke/verification workflows are not offered as deliverable results.

Use option `16. Show autopilot status`, or `npm run config -- --print-autopilot`, to see the resident overnight loop, last tick, last result,
the current decision preview, candidate auto-run counts, explicit waiting conditions, and the next workbench action without opening a separate UI.

Use option `17. Run one autopilot tick` to preview and then manually advance the resident loop once.
It calls `/api/autopilot/tick` and requires typing `RUN` before executing.

Use option `18. Toggle overnight autopilot` to write `JAVIS_AUTOPILOT_ENABLED` in `.env`. Enabling it
also aligns local execution, trusted local mode, and Level 3 auto-run so the resident can keep making
low-risk progress while unattended. The resident autopilot executes only low-risk recovery diagnostics,
trusted routed failed-job recovery candidates, and blocked app workflows that the local safe planner can re-plan; it skips while voice is active or
another background job is running. When multiple work-next actions exist, autopilot skips manual-only
items, including Realtime voice dogfood, and executes the first action that passes its auto-executable guard.
`/api/autopilot` exposes the same structured decision preview so unattended runs leave evidence for
why an action ran, why it skipped, which candidates were auto-executable, and what condition JAVIS is waiting on.
If no user-visible action is auto-executable, it can run a cooldown-gated read-only maintenance snapshot
that records resident health, doctor/readiness state, worker progress, learning status, Realtime status,
and collaboration state as an internal workflow. Tune the cooldown with `JAVIS_AUTOPILOT_MAINTENANCE_MIN_INTERVAL_MS`.

Use options `19`-`26` for local learning maintenance: refresh the inferred profile, save it as an
explicit local memory, pause/resume learning, manage exclusions, delete inferred learning data, inspect
the local metadata-only learning evolution snapshot, preview a Codex-style skill draft, or export that
draft to `~/.agents/skills` after typing `SAVE`.

Use option `24. Show learning evolution`, or:

```bash
npm run config -- --print-learning-evolution
curl http://127.0.0.1:3417/api/learning/evolution
```

This compares recent passive app/browser/window metadata against an older local baseline and returns a
short inferred-change summary. It stores no screenshots, clipboard text, or page bodies, and Realtime
voice reads the same snapshot through `get_learning_evolution` when asked what has changed recently.

Use option `31. Show browser activity`, or `npm run config -- --print-browser-activity`, to inspect the local browser activity summary. Realtime voice can ask for the same data through `get_browser_activity`. This is metadata-only: app, host, title, timestamp, and redacted URL context from ambient observations. It does not store page text, and learning exclusions for apps/sites/folders are applied before the activity summary is built.

Use option `28. Show UI demonstrations` to inspect explicit local demonstrations. Demonstrations are user-started records for repeatable UI workflows; they store notes plus sanitized app/browser/screen/accessibility summaries and a manual-preview playbook, not screenshots or raw clipboard text. Completed demonstrations can become replay plans or reviewable local skill drafts; saving a draft to `~/.agents/skills` requires explicit confirmation.

Use option `29. Show skill shortcuts` to inspect saved local trigger phrases for recalled skill plans. Use option `30. Promote shortcut candidate` to turn a completed, successful `skillRecallPlan` route/job into a shortcut after typing `SAVE`. Shortcuts affect future routing context only; action policy and confirmation gates stay unchanged.

Use option `5. Open Full Disk Access settings` when you want macOS to allow JAVIS/Electron into protected local folders. macOS still requires a human confirmation in System Settings.

The desktop pet is intentionally minimal. It is a small voice capsule on the edge of the screen and avoids showing setup state, diagnostic chips, or configuration controls. In compact mode it consumes `/api/presence` and maps the resident state to traffic-light dots: red for attention/setup, yellow for waking/working, green for ready/standby, and green+yellow for observing or listening.

Click the pet to start or stop realtime voice with full-screen context once `OPENAI_API_KEY` is configured. If the key is missing, the pet opens the terminal CUI instead. Screen context is captured by the resident process, so it does not ask which window to share. Inside a live voice session, `JAVIS_WAKE_WORDS` defines soft wake words such as `JAVIS`, `Jarvis`, `贾维斯`, and `小贾`. For true local wake, set `JAVIS_WAKE_ENGINE_CMD` to a command that prints `wake` or one configured wake word; JAVIS will then expose that through `/api/wake/status` and the renderer will start voice automatically.

Right-click the capsule to open the terminal CUI. Keep setup, policy, and diagnostic changes there instead of adding visible desktop controls.

The resident app registers a global pet park hotkey, defaulting to `Control+Shift+Space`. Change it with `JAVIS_TOGGLE_HOTKEY` if macOS or another app already owns that shortcut.

It also registers a tap-to-summon hotkey, defaulting to `Alt+Space` (`Option+Space` on Mac). Pressing it wakes JAVIS, parks the capsule at the notch/Dynamic Island position, and lets the renderer start the voice session through the same `/api/wake/status` path used by a local wake engine. Change it with `JAVIS_SUMMON_HOTKEY` or `JAVIS_TAP_HOTKEY`, or set either value to `false` to disable it.

It also registers a clipboard-to-Inbox capture hotkey, defaulting to `Control+Shift+I`. Copy text anywhere, press the capture hotkey, and JAVIS saves the clipboard into local Inbox. Change it with `JAVIS_CAPTURE_HOTKEY`, or set `JAVIS_CAPTURE_HOTKEY=false` to disable it.

The desktop buddy parks itself at the Mac notch by default, using a Dynamic Island-style capsule. Use CUI option `6. Move pet position`, or set `JAVIS_WINDOW_PARK_CORNER=notch`, `JAVIS_WINDOW_PARK_DISPLAY=primary`, and `JAVIS_WINDOW_NOTCH_TOP_OFFSET=5` to control the notch placement. Supported positions are `notch`, `top-left`, `top-right`, `bottom-left`, and `bottom-right`; corner placement still uses `JAVIS_WINDOW_PARK_MARGIN`.

JAVIS also creates a macOS menu bar status item. It exposes resident controls without relying on the desktop pet being visible: open the terminal config CUI, park the pet, refresh status, open `.env`, open Screen Recording or Accessibility settings, open the runtime folder, and quit the resident app.

```bash
curl http://127.0.0.1:3417/api/window/state
curl http://127.0.0.1:3417/api/menubar/state
curl http://127.0.0.1:3417/api/notifications/state
curl http://127.0.0.1:3417/api/attention
curl http://127.0.0.1:3417/api/attention/history
curl -X POST http://127.0.0.1:3417/api/attention/notify \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true,"source":"operator"}'
curl -X POST http://127.0.0.1:3417/api/config/open-cui
curl -X POST http://127.0.0.1:3417/api/window/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"pet","focus":false}'
curl -X POST http://127.0.0.1:3417/api/window/park \
  -H 'Content-Type: application/json' \
  -d '{"corner":"notch"}'
curl -X POST http://127.0.0.1:3417/api/window/summon \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:3417/api/notifications/test \
  -H 'Content-Type: application/json' \
  -d '{"body":"JAVIS notification check"}'
```

Resident notifications are enabled by default and can be disabled with `JAVIS_NOTIFICATIONS=false`. They fire for pending approvals and background task completion/failure/cancellation. Pending approvals, setup blockers, and Realtime voice errors pass through the quiet attention gate before a system notification is sent, so ordinary task/test notifications do not reset the attention cooldown. `/api/attention`, `/api/attention/history`, `/api/attention/notify`, and `npm run config -- --print-attention` expose whether JAVIS should stay quiet, wait through the notification cooldown, or notify because a high-priority approval/setup/voice issue needs attention. Attention history is operator-only API/CUI evidence; the desktop pet should keep using only compact level/color state.

For a local work briefing:

```bash
curl http://127.0.0.1:3417/api/briefing
curl http://127.0.0.1:3417/api/work/progress
curl http://127.0.0.1:3417/api/work/handoff
curl http://127.0.0.1:3417/api/work/next
curl http://127.0.0.1:3417/api/workflows/follow-ups
curl http://127.0.0.1:3417/api/lanes/contracts
curl http://127.0.0.1:3417/api/tasks/routing
curl -X POST http://127.0.0.1:3417/api/work/next \
  -H 'Content-Type: application/json' \
  -d '{"execute":true}'
curl -X POST http://127.0.0.1:3417/api/tasks/route \
  -H 'Content-Type: application/json' \
  -d '{"message":"Check this repo with Codex","execute":false}'
curl -X POST http://127.0.0.1:3417/api/tasks/parallel \
  -H 'Content-Type: application/json' \
  -d '{"execute":true,"parallelGroup":"research-batch","tasks":[{"task":"Inspect docs for stale setup notes","mode":"background","owner":"background","scope":"docs read-only"},{"task":"Review code owner boundaries","mode":"codex","owner":"codex","scope":"repo read-only"}]}'
curl http://127.0.0.1:3417/api/collaboration
curl -X POST http://127.0.0.1:3417/api/collaboration/claims \
  -H 'Content-Type: application/json' \
  -d '{"agent":"claude-code","owner":"Claude Code","lane":"claude","scope":"docs/OPERATIONS.md","access":"write","task":"Update operations docs","ttlMs":1800000}'
curl -X POST http://127.0.0.1:3417/api/collaboration/claims/<claim-id>/heartbeat \
  -H 'Content-Type: application/json' \
  -d '{"ttlMs":1800000}'
curl -X POST http://127.0.0.1:3417/api/collaboration/claims/<claim-id>/release \
  -H 'Content-Type: application/json' \
  -d '{"status":"done"}'
npm run collab -- status
npm run collab -- claim --agent claude-code --owner "Claude Code" --lane claude --scope "docs/OPERATIONS.md" --task "Update operations docs"
npm run collab -- heartbeat <claim-id>
npm run collab -- release <claim-id> --status done --result "Docs updated"
curl -X POST http://127.0.0.1:3417/api/browser/workflow \
  -H 'Content-Type: application/json' \
  -d '{"intent":"search","query":"OpenAI Realtime API docs","mode":"quick"}'
curl -X POST http://127.0.0.1:3417/api/browser/workflow \
  -H 'Content-Type: application/json' \
  -d '{"intent":"compare","queries":["OpenAI Realtime API docs","WebRTC voice agent examples"],"mode":"background"}'
curl -X POST http://127.0.0.1:3417/api/browser/workflow \
  -H 'Content-Type: application/json' \
  -d '{"intent":"review_result","query":"OpenAI Realtime API docs","resultIndex":1,"mode":"quick"}'
curl -X POST http://127.0.0.1:3417/api/browser/workflow \
  -H 'Content-Type: application/json' \
  -d '{"intent":"research","query":"OpenAI Realtime API voice agent WebRTC docs","maxPages":2,"mode":"quick"}'
npm run config -- --print-browser-benchmarks
curl http://127.0.0.1:3417/api/browser/benchmarks
```

The briefing combines readiness, routing records, jobs, workflows, approvals, memories, blockers, and deterministic next actions without calling a model. `/api/work/progress` is narrower: it returns a spoken-style update for routed work, background jobs, grouped Codex/Claude/local worker batches, and workflows, including active work, recent completions, blockers, recovery hints, and next actions. `/api/work/handoff` is the voice-friendly version for Realtime and remote surfaces: it compresses readiness, progress, the active work session, collaboration claims, next actions, and proactive workflow continuations into one short `spokenSummary`. Use `workerGroups` / `workerSummary` when a voice or remote surface needs compact multi-agent progress instead of raw job rows.

`/api/browser/benchmarks` and CUI option `G. Show browser workflow benchmarks` run preview-only fixture checks for browser summarize, action extraction, form-fill draft redaction, compare/search preview, review-result preview, and research continuation metadata. They do not open a live browser page, execute browser actions, call a model, store raw fixture page text, or start voice; use them before broadening browser automation or debugging browser workflow regressions.

`/api/workflows/follow-ups` proposes continuation candidates from recent completed or blocked workflows. Each suggestion carries the selected parent workflow, a continuation instruction, memory/skill/related-workflow counts, and a `continue:<workflow-id>` action id. Browser `research` workflows can also carry a persisted `browserWorkflow.body` with the next URL/search set to review. Pass the action id to `/api/work/next?actionId=...` for a safe preview, or POST it to `/api/work/next` with `"execute":true` when you want the resident to queue or run the continuation through the normal workbench gates.

`/api/lanes/contracts` exposes the runtime owner/scope/handoff/risk contract for each lane. The Realtime tool `get_lane_contracts` uses the same registry, so the voice model can check boundaries before deciding whether to answer quickly, delegate to background, call Codex/Claude, or use browser/file/app/local tool surfaces.

`/api/context/plan` creates a smart context assembly plan for a request before JAVIS captures expensive or sensitive context. It explains whether the task needs resident state, Mac context, screen/vision, Accessibility, browser page/DOM, clipboard text, files, memory, learning, delegated-worker context, or local execution. Use it when tuning voice latency and privacy:

```bash
curl -X POST http://127.0.0.1:3417/api/context/plan \
  -H 'Content-Type: application/json' \
  -d '{"message":"总结当前网页并提取关键链接","useMemory":false}'
curl -X POST http://127.0.0.1:3417/api/context/plan \
  -H 'Content-Type: application/json' \
  -d '{"message":"点击当前应用里的搜索框并输入 JAVIS","useMemory":false}'
```

`/api/tasks/route` persists a routing record for each previewed or executed task. Direct quick chat, voice delegation, explicit CLI runs, browser workflows, file workflows, and continuation workflows also write routing records. The record is stored in `routing.json` beside `jobs.json` and `workflows.json`, and includes lane, owner, scope, parallel group, approval requirement, status, blocker/next-action context, result link, `contextPlan` evidence showing which context was used or skipped for speed/privacy, and `skillRecallPlan` evidence when a matching local `SKILL.md` changed the routed plan. Executed background/Codex/Claude jobs also store the same `skillRecallPlan` in `jobs.json`, log that the recalled plan is being used, and expose the skill name in work progress groups. Use `/api/tasks/routing`, `/api/tasks/routing/<route-id>`, or `/api/jobs/<job-id>` to inspect the evidence. Internal `eval` / `doctor` route, workflow, and worker records stay in the ledgers for evidence, but do not appear as active Work Next or spoken progress items.

`/api/tasks/parallel` accepts up to `JAVIS_MAX_PARALLEL_TASKS` independent task items and assigns them to one `parallelGroup`. Each item can specify its own `mode`, `owner`, `scope`, `access`, and `ownershipKey`; explicit `command` items queue through the guarded local CLI lane. The parallel router records an `ownership` block on each route and serializes overlapping write scopes instead of launching competing Codex/Claude/local workers against the same file or folder. This is the API surface for splitting work across background, Codex, Claude, and local workers while keeping progress check-ins coherent.

`/api/collaboration` is for external workers that are not launched by JAVIS, such as a separate Claude Code session. A worker should create a claim before editing, heartbeat it during long work, and release it when finished. Claims expire automatically after `JAVIS_COLLABORATION_CLAIM_TTL_MS` if the worker disappears. Active write claims seed `/api/tasks/parallel`, so a later Codex/Claude/local task that overlaps the claimed scope is serialized instead of started in parallel.

When Claude Code is working beside Codex, ask it to use the collaboration commands above before editing. The CUI option `26. Show collaboration claims` should show its active scope, and overlapping write scopes will be reported as conflicts instead of silently running competing agents on the same files.

For local Claude Code/Codex sessions, prefer `npm run collab -- claim ...` over manual curl. It auto-discovers the local API token, prints the claim id, and gives the matching heartbeat/release commands.

`/api/demonstrations` is the Record & Replay-style local learning surface. It is explicit and local: start a demonstration, capture one or more current UI states, finish it into a manual-preview playbook, and delete it when no longer useful.
Realtime voice exposes the same surface through `get_ui_demonstrations`, `start_ui_demonstration`, `capture_ui_demonstration_step`, and `finish_ui_demonstration`; say “贾维斯，开始记录这个流程”, “记录这一步”, then “结束记录” while demonstrating the workflow.
Completed demonstrations can also become safe replay plans through `/api/demonstrations/<id>/replay/plan` or the `plan_ui_demonstration_replay` voice tool. Run them only through `/api/demonstrations/<id>/replay/run` or `run_ui_demonstration_replay` after explicit confirmation. The replay never reuses coordinates and still passes through normal app workflow, action-policy, control-mode, approval, and audit gates.
Completed demonstrations can also become reviewable local skills through `/api/demonstrations/<id>/skill-draft` or `draft_ui_demonstration_skill`. Save them only through `/api/demonstrations/<id>/skill-draft/save` or `save_ui_demonstration_skill` after explicit confirmation; saving writes a `SKILL.md` under `~/.agents/skills` and does not grant new permissions.
Realtime evidence now groups those UI-demonstration calls separately, and the guided Realtime dogfood drill treats one demonstrated workflow as a first-class required step. The monitor should show the observed actions, whether replay stayed preview-only and re-observed live UI, whether a skill draft was produced, whether save/run was blocked by a confirmation gate, and whether no screenshots or raw clipboard text were stored.
Saved local skills can be recalled through `/api/skills/local`, `/api/learning/skills`, or `search_local_skills`. JAVIS also attaches matching skill summaries and a structured `skillRecallPlan` to later task routing prompts, queued worker prompts, job logs, and ledger records when memory use is enabled, so a repeated demonstrated workflow can influence execution without skipping confirmation gates.

Confirmed skill shortcuts live in `shortcuts.json` and are managed through `/api/shortcuts`. `/api/shortcuts/candidates` only lists completed route/job evidence that already carried an eligible `skillRecallPlan`; `/api/shortcuts/promote` returns a confirmation-required response unless `confirm:true` is supplied. Realtime voice uses the same store through `get_skill_shortcuts`, `get_skill_shortcut_candidates`, `save_skill_shortcut`, and `forget_skill_shortcut`; the save tool also requires `confirm:true` after the user confirms the exact phrase. A later task that includes the saved phrase recalls the plan even with `"useMemory":false`, but it still does not execute a replay, approve a mutation, or expand local permissions.

```bash
curl -X POST http://127.0.0.1:3417/api/demonstrations/start \
  -H 'Content-Type: application/json' \
  -d '{"title":"Invoice export flow","goal":"Show JAVIS how I export monthly invoices","captureInitial":true}'
curl -X POST http://127.0.0.1:3417/api/demonstrations/<id>/capture \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"Open the export menu and choose CSV"}'
curl -X POST http://127.0.0.1:3417/api/demonstrations/<id>/finish \
  -H 'Content-Type: application/json' \
  -d '{"status":"done"}'
curl -X POST http://127.0.0.1:3417/api/demonstrations/<id>/replay/plan \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"Prepare safe replay only"}'
curl -X POST http://127.0.0.1:3417/api/demonstrations/<id>/replay/run \
  -H 'Content-Type: application/json' \
  -d '{"execute":false}'
curl -X POST http://127.0.0.1:3417/api/demonstrations/<id>/replay/run \
  -H 'Content-Type: application/json' \
  -d '{"execute":true,"confirm":true}'
curl -X POST http://127.0.0.1:3417/api/demonstrations/<id>/skill-draft \
  -H 'Content-Type: application/json' \
  -d '{"title":"Invoice export skill"}'
curl -X POST http://127.0.0.1:3417/api/demonstrations/<id>/skill-draft/save \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true}'
curl 'http://127.0.0.1:3417/api/skills/local?query=invoice%20export&kind=demonstration'
curl http://127.0.0.1:3417/api/shortcuts
curl http://127.0.0.1:3417/api/shortcuts/candidates
curl -X POST http://127.0.0.1:3417/api/shortcuts/promote \
  -H 'Content-Type: application/json' \
  -d '{"routeId":"<route-id>","phrase":"invoice export","confirm":true}'
curl http://127.0.0.1:3417/api/demonstrations
```

`/api/browser/workflow` supports `search`, `compare`, `review_result`, and `research` intents in addition to current-page workflows. Search/compare navigate the active supported browser to Google result pages and capture those result pages. `review_result` opens one explicit URL or selected result link through the guarded `open_url` path, then reads the target page. `research` opens several explicit URLs or selected result links in sequence and synthesizes their read-only page snapshots. Research responses also include `continuation.nextActions`, which can be fed into a later explicit `research` workflow to keep investigating unvisited result links, retry failed pages with a longer wait, or follow promising links from reviewed pages. Browser workflows do not click page controls, type into arbitrary fields, submit forms, or make account changes by themselves.

`/api/work/next` turns the top briefing action into one safe step. GET previews the selected action; POST runs exactly one step, such as opening the next setup target, showing approvals, checking session/progress state, processing the next Inbox item, or manually summoning the Realtime dogfood drill. Realtime next actions include a structured dogfood guide instead of a vague blocker. Voice can also call the read-only `get_realtime_evidence` tool to explain the current WebRTC/session/progress blocker and next dogfood step. It does not approve actions or batch-run tasks.

The terminal CUI and API surface the same briefing. The desktop pet should not show briefing chips or operational controls.

For screen privacy:

```bash
curl http://127.0.0.1:3417/api/screen/privacy
curl -X PUT http://127.0.0.1:3417/api/screen/privacy \
  -H 'Content-Type: application/json' \
  -d '{"mode":"private"}'
curl -X POST http://127.0.0.1:3417/api/screen/privacy/rules \
  -H 'Content-Type: application/json' \
  -d '{"kind":"app","value":"Notes","match":"exact","effect":"exclude","label":"Hide Notes from model screen context"}'
curl -X POST http://127.0.0.1:3417/api/screen/privacy/check \
  -H 'Content-Type: application/json' \
  -d '{"context":{"frontmost":{"app":"Notes","windowTitle":"Private note"}}}'
curl -X POST http://127.0.0.1:3417/api/screen/privacy/region-mask-preview \
  -H 'Content-Type: application/json' \
  -d '{"width":64,"height":64}'
curl http://127.0.0.1:3417/api/screen/privacy/region-presets
curl http://127.0.0.1:3417/api/screen/privacy/region-presets/notch_band
curl -X POST http://127.0.0.1:3417/api/screen/privacy/region-presets/notch_band/apply \
  -H 'Content-Type: application/json' \
  -d '{"source":"operator"}'
curl http://127.0.0.1:3417/api/screen/privacy/presets
curl http://127.0.0.1:3417/api/screen/privacy/presets/sensitive_defaults
curl -X POST http://127.0.0.1:3417/api/screen/privacy/presets/sensitive_defaults/apply \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true}'
curl -X POST http://127.0.0.1:3417/api/screen/privacy/presets/sensitive_defaults/apply \
  -H 'Content-Type: application/json' \
  -d '{"source":"operator"}'
npm run config -- --print-screen-privacy
npm run config -- --print-screen-region-presets
npm run config -- --add-screen-region-mask notch_band
npm run config -- --preview-screen-privacy-preset
npm run config -- --apply-screen-privacy-preset
curl -X POST http://127.0.0.1:3417/api/tools/execute \
  -H 'Content-Type: application/json' \
  -d '{"name":"get_screen_privacy","arguments":{"includeRules":true}}'
curl -X POST http://127.0.0.1:3417/api/tools/execute \
  -H 'Content-Type: application/json' \
  -d '{"name":"apply_screen_privacy_region_preset","arguments":{"id":"notch_band"}}'
curl -X POST http://127.0.0.1:3417/api/setup/actions \
  -H 'Content-Type: application/json' \
  -d '{"action":"apply_screen_privacy_sensitive_defaults"}'
curl -X POST http://127.0.0.1:3417/api/screen/capture-now \
  -H 'Content-Type: application/json' \
  -d '{"includeImage":false}'
curl http://127.0.0.1:3417/api/presence
curl http://127.0.0.1:3417/api/attention
curl http://127.0.0.1:3417/api/conversation/state
curl http://127.0.0.1:3417/api/realtime/context
curl http://127.0.0.1:3417/api/realtime/evidence
curl http://127.0.0.1:3417/api/realtime/dogfood
curl -X POST http://127.0.0.1:3417/api/realtime/dogfood/prepare \
  -H 'Content-Type: application/json' \
  -d '{"execute":true,"durationMs":45000}'
# /api/realtime/evidence returns status/phase/checklist/blocker and a manual-only dogfood runbook.
# Realtime voice exposes the same evidence through get_realtime_evidence when asked why live voice is stuck.
curl -X POST http://127.0.0.1:3417/api/realtime/session-negotiation \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true,"source":"manual","micMode":"open","offerBytes":1200,"answerBytes":2200,"statusCode":200,"ok":true,"durationMs":300}'
curl -X POST http://127.0.0.1:3417/api/realtime/progress-injection \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true,"source":"manual","transport":"webrtc-datachannel","dataChannelReadyState":"open","eventType":"conversation.item.create","forcedResponse":false,"contextLength":120,"contextPreview":"Worker summary: ...","workerSummary":"1 worker group(s)"}'
curl http://127.0.0.1:3417/api/ambient
curl -X POST http://127.0.0.1:3417/api/ambient/sample \
  -H 'Content-Type: application/json' \
  -d '{}'
curl http://127.0.0.1:3417/api/learning
curl -X PUT http://127.0.0.1:3417/api/learning/settings \
  -H 'Content-Type: application/json' \
  -d '{"paused":false,"includeInPrompts":true}'
curl -X POST http://127.0.0.1:3417/api/learning/exclusions \
  -H 'Content-Type: application/json' \
  -d '{"kind":"site","value":"example.com"}'
curl -X POST http://127.0.0.1:3417/api/learning/distill \
  -H 'Content-Type: application/json' \
  -d '{}'
curl http://127.0.0.1:3417/api/learning/skill-draft
curl -X POST http://127.0.0.1:3417/api/learning/skill-draft/save \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true}'
curl -X DELETE http://127.0.0.1:3417/api/learning \
  -H 'Content-Type: application/json' \
  -d '{"clearAmbient":false,"keepControls":true}'
curl http://127.0.0.1:3417/api/wake/status
curl -X POST http://127.0.0.1:3417/api/wake/trigger \
  -H 'Content-Type: application/json' \
  -d '{"source":"manual","phrase":"贾维斯"}'
curl -X POST http://127.0.0.1:3417/api/screen/describe \
  -H 'Content-Type: application/json' \
  -d '{"capture":true,"prompt":"Describe the current screen."}'
curl -X DELETE http://127.0.0.1:3417/api/screen/frame
```

Realtime can also call `get_attention_explanation` through `/api/tools/execute` when the user asks why the pet is green/yellow/red, why JAVIS stayed quiet, or what the last attention notification did. That tool returns a short Chinese `spokenSummary` plus read-only policy/history evidence; it does not add any diagnostics to the desktop pet. Realtime can call `get_perception_consent` when the user asks what JAVIS can currently see, read, hear, control, store, or why a permission/action is allowed or blocked.

For a real voice progress run, keep `npm run config` open on option `V` while the desktop renderer voice session is live and a background worker batch is changing state. The monitor should show the latest work-progress sequence moving from `pending` or `stale` to `synced`, then move from pending to `READY`; then the voice model should answer the grouped worker summary without forcing the worker progress injection to become an assistant response by itself.

Learning controls are local. `paused:true` stops future learning distillation, `includeInPrompts:false` keeps the profile on disk but prevents prompt injection, and exclusions keep matching apps/sites/folder-like contexts out of future ambient samples and distillation. Routing records include `learningEvidence` so you can see whether inferred habits were attached to a task prompt. `/api/learning/skill-draft` follows the Codex Record & Replay shape by turning inferred habits plus recent routing/workflow evidence into a reviewable `SKILL.md` draft; it does not write files. `/api/learning/skill-draft/save` requires `confirm:true` and writes to user-level `~/.agents/skills`, not the open-source repo.

`sensitive_defaults` is the recommended always-on preset for ambient screen watching. It adds deterministic app, window-title, browser-host, and top-right notification-strip region rules for password managers, account/login pages, payment and banking hosts, recovery-code windows, and security settings. Use the dry-run call first to inspect exactly which rules would be added; applying it is idempotent and does not grant any new action permissions.

`private` mode is the default. It downscales and blurs/pixelates frames before they are sent to the local API or Realtime. `/api/screen/privacy` also stores app/window/browser-host/region rules and recommended presets. Enabled app/window/browser-host `exclude` rules block screen images from server-side quick, observe, vision, and Realtime preflight model context when the current context matches; enabled region rules are applied as resident-side pixel masks before resident-captured or renderer-posted frames are stored, returned, or injected into Realtime. `/api/screen/privacy/region-mask-preview` runs a synthetic local image check for that mask path without reading the real desktop. `/api/screen/capture-now` refreshes the latest full-screen frame from the resident process without a window picker. Use `{"mode":"clear"}` only when sharper screen context is worth the privacy tradeoff. `/api/conversation/state` tracks the renderer-reported voice lifecycle and heartbeats with a per-session token, so stale closes or heartbeats from an older Realtime connection do not overwrite the active session. `/api/realtime/context` is the silent preflight context sent into new voice sessions when `JAVIS_REALTIME_PREFLIGHT_CONTEXT` is not `false`. While voice is live, the renderer also polls `/api/work/progress` at `VITE_JAVIS_REALTIME_WORK_PROGRESS_SYNC_MS` and sends deduplicated silent updates when background work changes. `/api/presence` is a read-only standby/watch/work/listening summary over conversation state, wake state, ambient metadata, local learning, active jobs, approvals, guardrails, and the same quiet attention policy exposed by `/api/attention`; its `intervention` block must remain passive-by-default and require user intent. The desktop pet should consume compact `attention.level` and `attention.petState` rather than show diagnostics. Ambient observe stores local metadata and can keep the latest private screen frame fresh when `JAVIS_AMBIENT_CAPTURE_SCREEN=true`. Stopping screen context from the buddy clears the latest stored frame; the DELETE endpoint is the manual equivalent.

For local work sessions:

```bash
curl http://127.0.0.1:3417/api/sessions
curl -X POST http://127.0.0.1:3417/api/sessions/start \
  -H 'Content-Type: application/json' \
  -d '{"goal":"Finish the JAVIS session workflow"}'
curl -X POST http://127.0.0.1:3417/api/sessions/resume \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:3417/api/sessions/<session-id>/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"note","text":"Implemented local session persistence."}'
curl http://127.0.0.1:3417/api/sessions/check-in
curl -X POST http://127.0.0.1:3417/api/sessions/<session-id>/end \
  -H 'Content-Type: application/json' \
  -d '{"note":"Ready for verification."}'
```

Only one session is active at a time. Active sessions appear in status, briefing, the menu bar, and the buddy activity list. While a session is active, Inbox captures/routes, job creation/completion, workflow creation/status changes, and approval events are appended automatically as local evidence. `/api/sessions/resume` creates a new active session from the latest completed session and records the prior summary as a `resume` event. `/api/sessions/check-in` returns a concise spoken-style progress update with recent events and next actions without calling a model. Ending a session creates a deterministic local summary without calling a model.

For the local Inbox:

```bash
curl http://127.0.0.1:3417/api/inbox
curl -X POST http://127.0.0.1:3417/api/inbox/capture-clipboard \
  -H 'Content-Type: application/json' \
  -d '{}'
curl http://127.0.0.1:3417/api/inbox/triage
curl -X POST http://127.0.0.1:3417/api/inbox/process-next \
  -H 'Content-Type: application/json' \
  -d '{"execute":true}'
curl -X POST http://127.0.0.1:3417/api/inbox \
  -H 'Content-Type: application/json' \
  -d '{"title":"Follow up with the supplier","body":"Check the latest quote and delivery window.","priority":2}'
curl -X POST http://127.0.0.1:3417/api/inbox/<item-id>/complete \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:3417/api/inbox/<item-id>/route \
  -H 'Content-Type: application/json' \
  -d '{"execute":true,"mode":"background"}'
```

The menu bar item, capture hotkey, and `/api/inbox/capture-clipboard` endpoint can capture the current clipboard text into Inbox. Open Inbox items appear in status, the buddy activity list, and local work briefings. `/api/inbox/triage` is read-only: it sorts open items by priority and age, groups them by lane/source/priority, suggests quick/background/Codex/Claude lanes, and returns `spokenSummary` plus per-item `confirmationPolicy.spokenPrompt` for voice. Use `npm run config -- --print-inbox-triage` for the same grouped view in CUI. Triage does not execute or mark anything done. `/api/inbox/process-next` is explicit execution: it picks the same top triage item, returns the confirmation policy, sends it through the normal router, and marks only that item done if routing succeeds. Routing an Inbox item sends it through the same quick/background/Codex/Claude task router used by voice and chat; successful execution marks the Inbox item done and stores a small route summary on the item.

For local task routing:

```bash
curl -X POST http://127.0.0.1:3417/api/tasks/route \
  -H 'Content-Type: application/json' \
  -d '{"message":"修复这个 React bug 并跑测试","execute":false}'
```

Set `execute:true` to let JAVIS answer in the quick lane or queue the selected background/Codex/Claude lane. Relevant explicit memories are included by default; add `"useMemory":false` when a request should ignore local memory.

The router also handles safe no-model local commands before calling any model:

```bash
curl -X POST http://127.0.0.1:3417/api/tasks/route \
  -H 'Content-Type: application/json' \
  -d '{"message":"状态","execute":true}'
curl -X POST http://127.0.0.1:3417/api/tasks/route \
  -H 'Content-Type: application/json' \
  -d '{"message":"start session: Prepare tomorrow work","execute":true}'
curl -X POST http://127.0.0.1:3417/api/tasks/route \
  -H 'Content-Type: application/json' \
  -d '{"message":"session note: First checkpoint recorded","execute":true}'
curl -X POST http://127.0.0.1:3417/api/tasks/route \
  -H 'Content-Type: application/json' \
  -d '{"message":"inbox: Follow up on the supplier quote","execute":true}'
curl -X POST http://127.0.0.1:3417/api/tasks/route \
  -H 'Content-Type: application/json' \
  -d '{"message":"google GPT Realtime 2 docs","execute":false}'
```

Supported local command families: resident status/briefing, work session start/status/note/end, Inbox listing/triage/process-next, text or clipboard capture into Inbox, opening explicit `http/https` URLs, opening allowed apps, opening Google searches, browser navigation, and explicit CLI commands prefixed with `run command:` or `运行命令:`. App/URL/browser/CLI actions still go through the action policy.

For current-app UI control:

```bash
curl -X POST http://127.0.0.1:3417/api/accessibility/control \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"click the OK button","execute":false}'
curl -X POST http://127.0.0.1:3417/api/accessibility/control \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"fill the search field","action":"set_value","content":"JAVIS","execute":true}'
```

The control endpoint first reads the current Accessibility tree, chooses one target, then executes through the same Level 3 local action policy as `ax_press` and `ax_set_value`. Use `execute:false` to inspect the selected target without clicking or typing.
For direct `ax_set_value` calls, native text roles such as `AXTextField` can use `expectedRole` and `expectedLabel`; broad web roles such as `AXGroup`, `AXStaticText`, or `AXWebArea` must also include editable evidence observed from `/api/accessibility/plan` or `/api/accessibility/tree`.

For a short multi-step local app workflow:

```bash
curl -X POST http://127.0.0.1:3417/api/app/plan \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"打开 Calculator 然后关闭窗口","execute":false}'
curl -X POST http://127.0.0.1:3417/api/app/workflow \
  -H 'Content-Type: application/json' \
  -d '{"title":"Calculator close preview","execute":false,"steps":[{"type":"open_app","app":"Calculator"},{"type":"wait","ms":800},{"type":"control_current_app","instruction":"按关闭按钮"}]}'
curl -X POST http://127.0.0.1:3417/api/app/workflow \
  -H 'Content-Type: application/json' \
  -d '{"title":"Calculator close","execute":true,"steps":[{"type":"open_app","app":"Calculator"},{"type":"wait","ms":800},{"type":"control_current_app","instruction":"按关闭按钮"}]}'
curl http://127.0.0.1:3417/api/app/benchmarks
```

`/api/app/plan` observes the current Mac context and Accessibility tree, then turns a natural-language instruction into steps. It uses deterministic rules for common commands and can fall back to the fast model for harder planning.

`/api/app/workflow` records one app workflow with per-step results. Supported step types are `open_app`, `open_url`, `wait`, `control_current_app`, `hotkey`, `type_text`, `mac_action`, and `file_action`. Each action step still uses the normal policy and audit path; `execute:false` previews the sequence.

`/api/app/benchmarks` runs preview-only generic app-workflow contract checks. It does not launch apps, click UI, type text, call models, mutate files, or write workflow history.

If a workflow pauses for an action approval, the pending approval stores a continuation with the
remaining workflow steps. Approving that action executes the approved step and then continues the
remaining steps until the workflow finishes, blocks, or hits another approval.

For everyday productivity app work:

```bash
curl -X POST http://127.0.0.1:3417/api/productivity/workflow \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"把今天的产品灵感写进 Notes，先规划新建笔记","intent":"note_capture","stage":"create","execute":false}'
curl -X POST http://127.0.0.1:3417/api/productivity/action \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"下周一 10 点和产品设计开会，先创建 Calendar 事件草稿","intent":"calendar_event","stage":"create","actionId":"create_event","execute":true,"confirm":false}'
curl http://127.0.0.1:3417/api/productivity/benchmarks
```

`/api/productivity/workflow` recognizes Notes, Reminders, Calendar, and Mail requests and returns a staged action pack. `/api/productivity/action` previews or executes exactly one action from that pack. Creating notes, reminders, calendar events, or email drafts requires the required fields plus `confirm:true`; sending email, sending calendar invites, deletes, and bulk edits stay blocked or require human review.
Confirmed creation uses native macOS automation where available: Notes notes, Reminders reminders, Calendar events, and visible Mail drafts. Dates must be explicit machine-readable date/time strings such as `2026-06-20T17:00:00`; free-form relative dates should be clarified before execution. Every confirmed native action still passes local execution, control mode, `allow.productivity_app`, macOS permissions, audit logging, and post-action observation.

`npm run dogfood:productivity-live -- --suite --json`, `GET/POST /api/productivity/dogfood/archive`, and the Realtime `get_productivity_dogfood_archive` / `save_productivity_dogfood_archive` tools are the repeatable four-app evidence paths. They save a local archive under `Runtime/productivity-dogfood-archives/` by default and return the archive path, safety markers, per-app status, workflow IDs, approval IDs, missing requirements, and recovery hints. Add `--execute --confirm` or `execute:true, confirm:true` only for an intentional live Mac run; Mail remains draft-only and no send path is exposed.

For Obsidian/Markdown knowledge work:

```bash
curl http://127.0.0.1:3417/api/knowledge/vaults
curl -X POST http://127.0.0.1:3417/api/knowledge/search \
  -H 'Content-Type: application/json' \
  -d '{"vaultPath":"/path/to/vault","query":"agent loop"}'
curl -X POST http://127.0.0.1:3417/api/knowledge/workflow \
  -H 'Content-Type: application/json' \
  -d '{"vaultPath":"/path/to/vault","intent":"create_note","title":"JAVIS idea","body":"Draft note body","execute":false}'
```

Set `JAVIS_OBSIDIAN_VAULTS` or `JAVIS_KNOWLEDGE_VAULTS` to comma-separated vault paths for deterministic discovery. Search is read-only and returns Markdown paths/snippets/tags/wikilinks. Creating, appending, or daily-note writes preview first; execution requires `execute:true` and `confirm:true`, then uses the normal file write policy and allowed roots.

For creative software work:

```bash
curl -X POST http://127.0.0.1:3417/api/creative/workflow \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"帮我剪辑一个短视频，先用 Final Cut Pro 规划导入素材流程","intent":"video_edit","stage":"import","execute":false}'
curl -X POST http://127.0.0.1:3417/api/creative/workflow \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"用 GarageBand 做一个 30 秒 demo，先规划 MIDI 草稿步骤","intent":"music_compose","stage":"sketch","execute":false}'
curl -X POST http://127.0.0.1:3417/api/creative/action \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"帮我剪辑一个短视频，先用 Final Cut Pro 规划导入素材流程","intent":"video_edit","stage":"import","actionId":"observe_project","execute":true,"verify":true}'
curl -X POST http://127.0.0.1:3417/api/creative/action \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"帮我剪辑一个短视频，先用 Final Cut Pro 规划导入素材流程","intent":"video_edit","stage":"import","actionId":"open_import_ui","execute":true,"confirm":false}'
```

`/api/creative/workflow` recognizes video editing and music composition requests, ranks common creative apps, records stage action packs, and can open/focus/observe the selected app with `execute:true`. `/api/creative/action` previews or executes one action from that pack. Each `actionPack` separates low-risk automatic actions such as opening the app and observing the project from confirmation-required actions such as imports, timeline edits, MIDI entry, mix changes, and export panels. It does not save, export, upload, or blindly edit the timeline/session; those steps should be handled through observe/current-app control with explicit confirmation.

Executed creative actions run a post-action verification pass by default. The response includes `verification.status`, observed app/UI signals, and `recoveryHints`; pass `verify:false` when you need a faster preview or already have fresh screen context.

For explicit local memory:

```bash
curl -X POST http://127.0.0.1:3417/api/memory \
  -H 'Content-Type: application/json' \
  -d '{"kind":"preference","scope":"local","text":"Use concise Chinese status updates.","tags":["style"]}'
curl "http://127.0.0.1:3417/api/memory?query=Chinese&limit=5"
```

Memory records are stored locally in the runtime directory. User-created memories are explicit durable
notes; memories with `source:"learning"` are inferred local context and should be treated as weaker
than user-confirmed preferences.

For inferred local learning:

```bash
curl http://127.0.0.1:3417/api/learning
curl -X POST http://127.0.0.1:3417/api/learning/distill \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:3417/api/learning/remember \
  -H 'Content-Type: application/json' \
  -d '{}'
curl http://127.0.0.1:3417/api/learning/evolution
curl http://127.0.0.1:3417/api/learning/skill-draft
```

`JAVIS_AMBIENT_LEARNING=true` distills passive ambient metadata into `learned-profile.json`. It stores aggregate app/browser/context patterns only and does not call a model. `GET /api/learning/evolution` compares recent local metadata with an older local baseline and returns only aggregate changes. `POST /api/learning/remember` upserts that aggregate profile into one searchable local memory tagged `ambient-profile`; it does not create duplicate memories on every run. `GET /api/learning/skill-draft` turns the same aggregate profile plus recent work evidence into a reviewable Codex skill draft for repeatable local workflows. `JAVIS_INCLUDE_LEARNING_IN_PROMPTS=false` keeps that profile out of task prompts while still allowing local inspection.

For a file-plan dry run:

```bash
curl -X POST http://127.0.0.1:3417/api/files/plan \
  -H 'Content-Type: application/json' \
  -d '{"path":".","intent":"organize","maxMoves":10}'
```

`intent:"rename"` previews batch `move_file` steps without executing them:

```bash
curl -X POST http://127.0.0.1:3417/api/files/plan \
  -H 'Content-Type: application/json' \
  -d '{"path":"~/Downloads","intent":"rename","extensions":[".png"],"template":"screenshot-{index}{ext}","maxFiles":20}'
```

`intent:"convert"` previews non-destructive conversions. Supported text formats (`.txt`, `.md`, `.html`, `.json`, `.csv`, `.tsv`) use deterministic local semantic conversion by default and return a redacted `write_file` plan:

```bash
curl -X POST http://127.0.0.1:3417/api/files/plan \
  -H 'Content-Type: application/json' \
  -d '{"path":"~/Documents","intent":"convert","extensions":[".txt"],"targetExtension":".md","maxFiles":10}'
```

Use `conversionMode:"copy"` when you only want an extension-only copy-convert plan:

```bash
curl -X POST http://127.0.0.1:3417/api/files/plan \
  -H 'Content-Type: application/json' \
  -d '{"path":"~/Documents","intent":"convert","extensions":[".txt"],"targetExtension":".bak","conversionMode":"copy","maxFiles":10}'
```

The plan endpoint only previews create-directory, move-file, copy-file, or write-file steps. Actual file mutations still use the Level 3 action path and current policy. Applying a plan requires explicit confirmation:

```bash
curl -X POST http://127.0.0.1:3417/api/files/plan/apply \
  -H 'Content-Type: application/json' \
  -d '{"path":".","intent":"organize","maxMoves":10,"confirm":true}'
```

Apply results include per-step `verification` evidence. Directory creation checks that the directory exists, writes compare generated content hashes, copies compare destination bytes and hashes with the source, and moves also verify that the source path disappeared.

With `JAVIS_ENABLE_LOCAL_EXEC=false`, the apply endpoint reports blocked steps and does not move files.

Low-risk setup actions are also available:

```bash
curl -X POST http://127.0.0.1:3417/api/setup/actions \
  -H 'Content-Type: application/json' \
  -d '{"action":"prepare_env_file"}'
curl -X POST http://127.0.0.1:3417/api/setup/actions \
  -H 'Content-Type: application/json' \
  -d '{"action":"open_screen_settings"}'
curl -X POST http://127.0.0.1:3417/api/setup/actions \
  -H 'Content-Type: application/json' \
  -d '{"action":"open_microphone_settings"}'
```

Supported setup actions: `prepare_env_file`, `open_microphone_settings`, `open_screen_settings`, `open_accessibility_settings`, `open_full_disk_access_settings`, `open_runtime_dir`, `open_action_policy`, `install_resident_agent`, and `uninstall_resident_agent`.

Resident status:

```bash
curl http://127.0.0.1:3417/api/resident/status
curl -X POST http://127.0.0.1:3417/api/setup/actions \
  -H 'Content-Type: application/json' \
  -d '{"action":"install_resident_agent"}'
```

`install_resident_agent` writes the LaunchAgent plist for the next login. The resident scripts stop
stale project-owned Electron/npm processes before loading the LaunchAgent, so a previous manual or
orphaned process should not keep the API port bound to older code.

## Runtime Data

Default data directory:

```text
~/Library/Application Support/JAVIS/Runtime
```

Files:

- `jobs.json`: recent background job history.
- `workflows.json`: recent user-level workflow history with linked jobs and results.
- `sessions.json`: local focus sessions with goals, notes, and deterministic summaries.
- `inbox.json`: local capture inbox for clipboard/manual follow-ups.
- `audit.jsonl`: structured process, job, tool, and action events.
- `action-policy.json`: local automation policy.
- `approvals.json`: pending and historical local action approvals.

Override the directory with:

```bash
JAVIS_DATA_DIR=/path/to/data npm run start:desktop
```

## Useful Checks

```bash
curl http://127.0.0.1:3417/api/jobs
curl http://127.0.0.1:3417/api/workflows
curl http://127.0.0.1:3417/api/readiness
curl http://127.0.0.1:3417/api/config/check
curl http://127.0.0.1:3417/api/doctor/report
curl http://127.0.0.1:3417/api/resident/status
curl -X POST http://127.0.0.1:3417/api/setup/actions \
  -H 'Content-Type: application/json' \
  -d '{"action":"prepare_env_file"}'
curl http://127.0.0.1:3417/api/jobs/<job-id>
curl http://127.0.0.1:3417/api/workflows/<workflow-id>
curl -X POST http://127.0.0.1:3417/api/workflows/continue \
  -H 'Content-Type: application/json' \
  -d '{"mode":"background","instruction":"Continue with the next useful step."}'
curl -X POST http://127.0.0.1:3417/api/workflows/continue \
  -H 'Content-Type: application/json' \
  -d '{"preview":true,"execute":false,"instruction":"Show the next follow-up step before queueing it."}'
curl -X POST http://127.0.0.1:3417/api/workflows/<workflow-id>/continue \
  -H 'Content-Type: application/json' \
  -d '{"mode":"quick","instruction":"Explain what happened and what to do next."}'
curl -X POST http://127.0.0.1:3417/api/workflows/<workflow-id>/copy-result \
  -H 'Content-Type: application/json' \
  -d '{"format":"markdown"}'
curl -X POST http://127.0.0.1:3417/api/tasks/route \
  -H 'Content-Type: application/json' \
  -d '{"message":"状态","execute":true}'
curl http://127.0.0.1:3417/api/sessions
curl http://127.0.0.1:3417/api/inbox
curl -X POST http://127.0.0.1:3417/api/inbox \
  -H 'Content-Type: application/json' \
  -d '{"fromClipboard":true,"priority":3}'
curl -X POST http://127.0.0.1:3417/api/inbox/<item-id>/route \
  -H 'Content-Type: application/json' \
  -d '{"execute":false}'
curl -X POST http://127.0.0.1:3417/api/jobs/<job-id>/cancel \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Not now"}'
curl http://127.0.0.1:3417/api/audit/recent
curl http://127.0.0.1:3417/api/actions/policy
curl http://127.0.0.1:3417/api/control/mode
curl -X PUT http://127.0.0.1:3417/api/control/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"observe_only"}'
curl -X POST http://127.0.0.1:3417/api/observe \
  -H 'Content-Type: application/json' \
  -d '{"captureScreen":true,"includeAccessibility":true,"describeScreen":false}'
curl http://127.0.0.1:3417/api/mac/context
curl 'http://127.0.0.1:3417/api/accessibility/tree?maxNodes=80&maxDepth=5'
curl -X POST http://127.0.0.1:3417/api/accessibility/plan \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"Find the safest next UI target.","maxNodes":100,"maxDepth":6}'
curl -X POST http://127.0.0.1:3417/api/actions/preview \
  -H 'Content-Type: application/json' \
  -d '{"action":"ax_press","nodeId":"12","expectedRole":"AXButton","expectedLabel":"Export","maxNodes":100,"maxDepth":6}'
curl http://127.0.0.1:3417/api/browser/context
curl http://127.0.0.1:3417/api/browser/activity
curl 'http://127.0.0.1:3417/api/browser/page?maxChars=12000'
curl -X POST http://127.0.0.1:3417/api/browser/control \
  -H 'Content-Type: application/json' \
  -d '{"action":"reload"}'
curl http://127.0.0.1:3417/api/browser/javascript
curl 'http://127.0.0.1:3417/api/browser/dom?limit=40'
curl -X POST http://127.0.0.1:3417/api/browser/dom-action \
  -H 'Content-Type: application/json' \
  -d '{"action":"click","query":"Search","execute":false}'
curl -X POST http://127.0.0.1:3417/api/browser/workflow \
  -H 'Content-Type: application/json' \
  -d '{"intent":"summarize","mode":"quick","maxChars":12000}'
curl -X POST http://127.0.0.1:3417/api/cli/run \
  -H 'Content-Type: application/json' \
  -d '{"command":"npm run lint","title":"Lint project"}'
curl http://127.0.0.1:3417/api/approvals
curl -X POST http://127.0.0.1:3417/api/actions/execute \
  -H 'Content-Type: application/json' \
  -d '{"action":"read_clipboard"}'
curl -X POST http://127.0.0.1:3417/api/files/execute \
  -H 'Content-Type: application/json' \
  -d '{"action":"list_directory","path":"."}'
curl -X POST http://127.0.0.1:3417/api/files/workflow \
  -H 'Content-Type: application/json' \
  -d '{"intent":"list","path":".","mode":"quick","maxEntries":40}'
curl -X DELETE http://127.0.0.1:3417/api/jobs/<job-id>
curl -X DELETE http://127.0.0.1:3417/api/approvals/<approval-id>
curl -X POST http://127.0.0.1:3417/api/window/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"pet"}'
curl -X POST http://127.0.0.1:3417/api/window/park \
  -H 'Content-Type: application/json' \
  -d '{"corner":"notch","display":"primary"}'
curl -X POST http://127.0.0.1:3417/api/window/move \
  -H 'Content-Type: application/json' \
  -d '{"x":24,"y":760}'
```

## Action Policy

Preview a local action without executing it:

```bash
curl -X POST http://127.0.0.1:3417/api/actions/preview \
  -H 'Content-Type: application/json' \
  -d '{"action":"open_url","value":"https://example.com"}'
```

Enable dry-run mode:

```bash
curl -X PUT http://127.0.0.1:3417/api/actions/policy \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true}'
```

Read the clipboard through the policy layer:

```bash
curl -X POST http://127.0.0.1:3417/api/actions/execute \
  -H 'Content-Type: application/json' \
  -d '{"action":"read_clipboard"}'
```

Write prepared text to the clipboard:

```bash
curl -X POST http://127.0.0.1:3417/api/actions/execute \
  -H 'Content-Type: application/json' \
  -d '{"action":"write_clipboard","content":"hello"}'
```

Clear the clipboard:

```bash
curl -X POST http://127.0.0.1:3417/api/actions/execute \
  -H 'Content-Type: application/json' \
  -d '{"action":"clear_clipboard"}'
```

Approve or reject a pending action:

```bash
curl -X POST http://127.0.0.1:3417/api/approvals/<approval-id>/approve
curl -X POST http://127.0.0.1:3417/api/approvals/<approval-id>/reject \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Not now"}'
```

## File Tools

List a directory:

```bash
curl -X POST http://127.0.0.1:3417/api/files/execute \
  -H 'Content-Type: application/json' \
  -d '{"action":"list_directory","path":".","maxEntries":20}'
```

Read a file:

```bash
curl -X POST http://127.0.0.1:3417/api/files/execute \
  -H 'Content-Type: application/json' \
  -d '{"action":"read_file","path":"README.md"}'
```

Search files:

```bash
curl -X POST http://127.0.0.1:3417/api/files/execute \
  -H 'Content-Type: application/json' \
  -d '{"action":"search_files","path":"docs","query":"approval"}'
```

Preview a write:

```bash
curl -X POST http://127.0.0.1:3417/api/actions/preview \
  -H 'Content-Type: application/json' \
  -d '{"action":"write_file","path":"tmp/example.txt","content":"hello","overwrite":true}'
```

`write_file` is Level 3. By default it requires approval and `JAVIS_ENABLE_LOCAL_EXEC=true`.

## File Workflows

Run a read-only workflow over an allowed local path:

```bash
curl -X POST http://127.0.0.1:3417/api/files/workflow \
  -H 'Content-Type: application/json' \
  -d '{"intent":"search","path":"docs","query":"workflow","mode":"quick","maxResults":20}'
```

Supported intents: `list`, `search`, `summarize`, `ask`, `organize`, `rename`, and `convert`.

`list`, `search`, `organize`, `rename`, and supported text `convert` plans can complete locally without a model key. `summarize` and `ask` read allowed file/folder context, then use quick/background/Codex/Claude routing.

## Browser Workflows

Run a workflow over the current supported browser tab:

```bash
curl -X POST http://127.0.0.1:3417/api/browser/workflow \
  -H 'Content-Type: application/json' \
  -d '{"intent":"extract_actions","mode":"background","instruction":"Find deadlines and follow-up tasks.","maxChars":30000}'
```

Supported intents: `summarize`, `extract_actions`, `draft`, `ask`, `act`, `fill_draft`, `search`, `compare`, `review_result`, and `research`.

For form-fill drafts, JAVIS matches supplied fields against visible DOM controls and previews the fill/select plan. Execution requires `execute:true` and `confirm:true`, fixture DOM can only preview, and confirmed live execution returns `verification` plus `recovery` objects with matched-field counts, unmatched selectors, and next safe actions but not raw filled values:

```bash
curl -X POST http://127.0.0.1:3417/api/browser/fill-draft \
  -H 'Content-Type: application/json' \
  -d '{"fields":{"Name":"Haoge","Email":"haoge@example.com"},"execute":false}'
```

For webpage controls:

```bash
curl 'http://127.0.0.1:3417/api/browser/dom?limit=40'
curl -X POST http://127.0.0.1:3417/api/browser/dom-action \
  -H 'Content-Type: application/json' \
  -d '{"action":"fill","query":"Search","value":"Jarvis agent","execute":false}'
```

`/api/browser/dom` is read-only and returns visible clickable/fillable controls with selectors. `/api/browser/dom-action` runs one guarded `click`, `fill`, or `select`. Use `execute:false` to preview; real execution still uses local execution, policy, approvals, and audit logs.

Browser DOM control can use Chrome/Safari Apple Events JavaScript. For Chrome, enable `显示 > 开发者 > 允许 Apple 事件中的 JavaScript`, or restart Chrome with a local DevTools port that matches `JAVIS_CHROME_DEBUG_PORT`:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222
```

`/api/browser/javascript` reports the active bridge and any Apple Events/CDP error.

## Accessibility UI Tree

Read the current frontmost app UI tree:

```bash
curl 'http://127.0.0.1:3417/api/accessibility/tree?maxNodes=240&maxDepth=9'
```

Create a dry-run UI control plan:

```bash
curl -X POST http://127.0.0.1:3417/api/accessibility/plan \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"Click the export button if it is visible.","maxNodes":100,"maxDepth":6}'
```

The CUI/API flow exposes this as `tree` -> `plan` -> `guard` -> `act`:

For Chromium browsers, the tree reader attempts to enable the web accessibility tree before walking
nodes, then lazily captures web hints such as placeholder text, DOM role, DOM id, class list,
editable state, and focus state for likely editable/actionable candidates. This makes side panes and web textboxes easier to target without bypassing the
same Level 3 action policy used by `ax_press` and `ax_set_value`.
AX tree reads and action JXA calls default to a 25s timeout (`JAVIS_AX_TREE_TIMEOUT_MS` and
`JAVIS_AX_ACTION_TIMEOUT_MS`, capped at 60s) so suspended or complex Chromium pages do not fail
before the app has exposed a usable accessibility tree.
If Chromium exposes only menu bars and no usable window/content AX root, the tree reader now returns
`no_accessibility_window` quickly instead of walking the menu tree until timeout; browser DOM/CDP
tools should handle webpage work in that state.

For the Gemini/Chromium side-pane targeting regression, use the shared verifier:

```bash
npm run verify:ax
npm run verify:ax -- --require-chromium
npm run verify:ax -- --execute --content "hello from JAVIS"
```

The default command is a read-only smoke test and skips Gemini-specific assertions when Chromium is
not frontmost. `--require-chromium` is the strict acceptance path for Chrome/Gemini. `--execute`
actually writes to the target field and still goes through Level 3 local-execution policy.

- `UI`: read the current frontmost app tree.
- `Plan`: identify a likely target from the tree.
- `Guard`: preview the guarded action through policy.
- `Act`: request execution through `/api/actions/execute`; Level 3 gates and approvals still apply.

Tree reading and planning are read-only. `Act` does not bypass policy, approvals, local execution enablement, or Accessibility permission.

Preview a guarded accessibility press:

```bash
curl -X POST http://127.0.0.1:3417/api/actions/preview \
  -H 'Content-Type: application/json' \
  -d '{"action":"ax_press","nodeId":"12","expectedRole":"AXButton","expectedLabel":"Export","maxNodes":100,"maxDepth":6}'
```

Preview a guarded accessibility value write:

```bash
curl -X POST http://127.0.0.1:3417/api/actions/preview \
  -H 'Content-Type: application/json' \
  -d '{"action":"ax_set_value","nodeId":"18","expectedRole":"AXTextField","expectedLabel":"Search","content":"query","maxNodes":100,"maxDepth":6}'
```

Execution uses `POST /api/actions/execute` with the same payload, but these actions are Level 3 and require local execution enablement, approval, and Accessibility permission.
For a Chromium contenteditable exposed as a broad web role, include an evidence string such as `"expectedEditableEvidence":"contenteditable textbox"`; execution still re-reads the live target and refuses to write if that evidence is no longer present.

Supported modes:

- `quick`: call the fast model immediately.
- `background`: queue the slower model lane.
- `codex` or `claude`: queue the local code-agent worker with the page context.

## Continue From History

Continuation first builds a prompt from the parent workflow, related recent workflows, explicit memory
matches, recalled local skills, and local inferred learning profile/evolution hints when prompt inclusion is enabled.
Use `preview:true` or `execute:false` to inspect that context without queueing work.

Continue the latest workflow:

```bash
curl -X POST http://127.0.0.1:3417/api/workflows/continue \
  -H 'Content-Type: application/json' \
  -d '{"mode":"background","instruction":"Take the next useful step."}'
```

Preview the continuation prompt without queueing work:

```bash
curl -X POST http://127.0.0.1:3417/api/workflows/continue \
  -H 'Content-Type: application/json' \
  -d '{"preview":true,"execute":false,"instruction":"Take the next useful step."}'
```

Continue a specific workflow:

```bash
curl -X POST http://127.0.0.1:3417/api/workflows/<workflow-id>/continue \
  -H 'Content-Type: application/json' \
  -d '{"mode":"quick","instruction":"Summarize what happened and the next action."}'
```

Copy the latest workflow result to the system clipboard:

```bash
curl -X POST http://127.0.0.1:3417/api/workflows/copy-result \
  -H 'Content-Type: application/json' \
  -d '{"format":"markdown"}'
```

Copy a specific workflow result:

```bash
curl -X POST http://127.0.0.1:3417/api/workflows/<workflow-id>/copy-result \
  -H 'Content-Type: application/json' \
  -d '{"format":"result"}'
```

Formats:

- `result`: generated result text only.
- `markdown`: title, status, target, and generated result.

## Restart Behavior

Jobs are persisted after creation and on every status transition. If JAVIS exits while a job is queued or running, that job is marked failed on the next launch with an interruption note.

Running Codex, Claude, and explicit CLI jobs write stdout/stderr into the job log while they run. Use the buddy panel or `POST /api/jobs/<job-id>/cancel` to stop queued or running work.

## Live Worker Dogfood

Use the live worker dogfood scripts when you need proof that JAVIS can actually delegate work to Codex, Claude, and local CLI lanes instead of only previewing routes:

```bash
npm run dogfood:workers-live
npm run dogfood:realtime-live
```

`dogfood:workers-live` queues real read-only Codex, Claude, and local CLI jobs, waits for completion, and verifies logs, attempts, cancellation state, recent job surfacing, and grouped worker progress.

`dogfood:realtime-live` simulates a live Realtime conversation state without starting microphone capture, queues the same read-only worker mix, builds passive Realtime progress context, records `realtime.progress_injection`, and verifies the spoken progress summary is short enough for voice.

These scripts are intentionally opt-in because they run local worker commands. The built-in tasks are read-only and explicitly tell Codex/Claude/local CLI not to write files, edit files, or commit.

## Resident Pet Load

The desktop pet should stay quiet and cheap while it is parked. The renderer polls `GET /api/pet/status` every 5 seconds for traffic-light state, voice/session state, window position, approvals, inbox/session counts, and a small job snapshot.

Full diagnostics stay out of the pet. `GET /api/status`, `/api/doctor/report`, `/api/config/check`, `/api/mac/context`, and `/api/briefing` are reserved for manual refresh, the terminal CUI, or the expanded panel, which refreshes those details at a slow cadence.

Resident screen context is also throttled. A manual screen start captures immediately; after that, the renderer refreshes screen context every 15 seconds during a live voice session and every 2 minutes while merely observing. Periodic screen refreshes must not call full status/doctor refreshes.
