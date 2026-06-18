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
```

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

Readiness checks cover the OpenAI key, microphone, screen capture, Accessibility, local execution, action policy, runtime storage, queue state, and pending approvals.

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

Routine maintenance lives in the terminal CUI instead of the desktop pet:

```bash
npm run config
```

Use option `1. Set OpenAI API key` to paste the key locally with hidden input. It writes `OPENAI_API_KEY` to `.env` and can restart the resident service immediately. Do not paste API keys into chat or logs.

Use option `8. Toggle local execution` only when you want Level 3 local actions enabled. It requires typing `ENABLE` or `DISABLE`, writes `JAVIS_ENABLE_LOCAL_EXEC` to `.env`, and can restart the resident service immediately.

Use option `9. Toggle Level 3 auto-run` to switch Level 3 actions between approval-gated and automatic. Automatic Level 3 covers local file edits, typing into apps, Accessibility clicks, and Codex/Claude delegation. Level 4 actions should still require confirmation.

Use option `10. Toggle trusted local mode` when this Mac is intentionally being used as a high-autonomy local workstation. Enabling it writes `JAVIS_TRUSTED_LOCAL_MODE=true`, aligns Level 3 auto-run, and keeps Level 4 actions confirmation-gated. Doctor reports this as an acknowledged mode instead of a setup warning.

Use option `5. Open Full Disk Access settings` when you want macOS to allow JAVIS/Electron into protected local folders. macOS still requires a human confirmation in System Settings.

The desktop pet is intentionally minimal. It is a small voice capsule on the edge of the screen and avoids showing setup state, diagnostic chips, or configuration controls.

Click the pet to start or stop realtime voice with full-screen context once `OPENAI_API_KEY` is configured. If the key is missing, the pet opens the terminal CUI instead. Screen context is captured by the resident process, so it does not ask which window to share. Inside a live voice session, `JAVIS_WAKE_WORDS` defines soft wake words such as `JAVIS`, `Jarvis`, `贾维斯`, and `小贾`. For true local wake, set `JAVIS_WAKE_ENGINE_CMD` to a command that prints `wake` or one configured wake word; JAVIS will then expose that through `/api/wake/status` and the renderer will start voice automatically.

Right-click the capsule to open the terminal CUI. Keep setup, policy, and diagnostic changes there instead of adding visible desktop controls.

The resident app registers a global pet park hotkey, defaulting to `Control+Shift+Space`. Change it with `JAVIS_TOGGLE_HOTKEY` if macOS or another app already owns that shortcut.

It also registers a clipboard-to-Inbox capture hotkey, defaulting to `Control+Shift+I`. Copy text anywhere, press the capture hotkey, and JAVIS saves the clipboard into local Inbox. Change it with `JAVIS_CAPTURE_HOTKEY`, or set `JAVIS_CAPTURE_HOTKEY=false` to disable it.

The desktop buddy parks itself away from the center of the screen by default. Use CUI option `6. Move pet corner`, or set `JAVIS_WINDOW_PARK_CORNER=bottom-right`, `JAVIS_WINDOW_PARK_DISPLAY=primary`, and `JAVIS_WINDOW_PARK_MARGIN=24` to control placement. Supported corners are `top-left`, `top-right`, `bottom-left`, and `bottom-right`.

JAVIS also creates a macOS menu bar status item. It exposes resident controls without relying on the desktop pet being visible: open the terminal config CUI, park the pet, refresh status, open `.env`, open Screen Recording or Accessibility settings, open the runtime folder, and quit the resident app.

```bash
curl http://127.0.0.1:3417/api/window/state
curl http://127.0.0.1:3417/api/menubar/state
curl http://127.0.0.1:3417/api/notifications/state
curl -X POST http://127.0.0.1:3417/api/config/open-cui
curl -X POST http://127.0.0.1:3417/api/window/mode \
  -H 'Content-Type: application/json' \
  -d '{"mode":"pet","focus":false}'
curl -X POST http://127.0.0.1:3417/api/window/park \
  -H 'Content-Type: application/json' \
  -d '{"corner":"top-right"}'
curl -X POST http://127.0.0.1:3417/api/notifications/test \
  -H 'Content-Type: application/json' \
  -d '{"body":"JAVIS notification check"}'
```

Resident notifications are enabled by default and can be disabled with `JAVIS_NOTIFICATIONS=false`. They fire for pending approvals and background task completion/failure/cancellation.

For a local work briefing:

```bash
curl http://127.0.0.1:3417/api/briefing
curl http://127.0.0.1:3417/api/work/progress
curl http://127.0.0.1:3417/api/work/next
curl http://127.0.0.1:3417/api/tasks/routing
curl -X POST http://127.0.0.1:3417/api/work/next \
  -H 'Content-Type: application/json' \
  -d '{"execute":true}'
curl -X POST http://127.0.0.1:3417/api/tasks/route \
  -H 'Content-Type: application/json' \
  -d '{"message":"Check this repo with Codex","execute":false}'
```

The briefing combines readiness, routing records, jobs, workflows, approvals, memories, blockers, and deterministic next actions without calling a model. `/api/work/progress` is narrower: it returns a spoken-style update for routed work, background jobs, and workflows, including active work, recent completions, blockers, and next actions.

`/api/tasks/route` persists a routing record for each previewed or executed task. The record is stored in `routing.json` beside `jobs.json` and `workflows.json`, and includes lane, owner, scope, parallel group, approval requirement, status, and result link. Use `/api/tasks/routing` or `/api/tasks/routing/<route-id>` to inspect the ledger.

`/api/work/next` turns the top briefing action into one safe step. GET previews the selected action; POST runs exactly one step, such as opening the next setup target, showing approvals, checking session/progress state, or processing the next Inbox item. It does not approve actions or batch-run tasks.

The terminal CUI and API surface the same briefing. The desktop pet should not show briefing chips or operational controls.

For screen privacy:

```bash
curl http://127.0.0.1:3417/api/screen/privacy
curl -X PUT http://127.0.0.1:3417/api/screen/privacy \
  -H 'Content-Type: application/json' \
  -d '{"mode":"private"}'
curl -X POST http://127.0.0.1:3417/api/screen/capture-now \
  -H 'Content-Type: application/json' \
  -d '{"includeImage":false}'
curl http://127.0.0.1:3417/api/presence
curl http://127.0.0.1:3417/api/conversation/state
curl http://127.0.0.1:3417/api/realtime/context
curl http://127.0.0.1:3417/api/ambient
curl -X POST http://127.0.0.1:3417/api/ambient/sample \
  -H 'Content-Type: application/json' \
  -d '{}'
curl http://127.0.0.1:3417/api/learning
curl -X POST http://127.0.0.1:3417/api/learning/distill \
  -H 'Content-Type: application/json' \
  -d '{}'
curl http://127.0.0.1:3417/api/wake/status
curl -X POST http://127.0.0.1:3417/api/wake/trigger \
  -H 'Content-Type: application/json' \
  -d '{"source":"manual","phrase":"贾维斯"}'
curl -X POST http://127.0.0.1:3417/api/screen/describe \
  -H 'Content-Type: application/json' \
  -d '{"capture":true,"prompt":"Describe the current screen."}'
curl -X DELETE http://127.0.0.1:3417/api/screen/frame
```

`private` mode is the default. It downscales and blurs/pixelates frames before they are sent to the local API or Realtime. `/api/screen/capture-now` refreshes the latest full-screen frame from the resident process without a window picker. Use `{"mode":"clear"}` only when sharper screen context is worth the privacy tradeoff. `/api/conversation/state` tracks the renderer-reported voice lifecycle and heartbeats with a per-session token, so stale closes or heartbeats from an older Realtime connection do not overwrite the active session. `/api/realtime/context` is the silent preflight context sent into new voice sessions when `JAVIS_REALTIME_PREFLIGHT_CONTEXT` is not `false`. While voice is live, the renderer also polls `/api/work/progress` at `VITE_JAVIS_REALTIME_WORK_PROGRESS_SYNC_MS` and sends deduplicated silent updates when background work changes. `/api/presence` is a read-only standby/watch/work/listening summary over conversation state, wake state, ambient metadata, local learning, active jobs, approvals, and guardrails. Ambient observe stores local metadata and can keep the latest private screen frame fresh when `JAVIS_AMBIENT_CAPTURE_SCREEN=true`. Stopping screen context from the buddy clears the latest stored frame; the DELETE endpoint is the manual equivalent.

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

The menu bar item, capture hotkey, and `/api/inbox/capture-clipboard` endpoint can capture the current clipboard text into Inbox. Open Inbox items appear in status, the buddy activity list, and local work briefings. `/api/inbox/triage` is read-only: it sorts open items by priority and age, suggests quick/background/Codex/Claude lanes, and does not execute or mark anything done. `/api/inbox/process-next` is explicit execution: it picks the same top triage item, sends it through the normal router, and marks only that item done if routing succeeds. Routing an Inbox item sends it through the same quick/background/Codex/Claude task router used by voice and chat; successful execution marks the Inbox item done and stores a small route summary on the item.

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
```

`/api/app/plan` observes the current Mac context and Accessibility tree, then turns a natural-language instruction into steps. It uses deterministic rules for common commands and can fall back to the fast model for harder planning.

`/api/app/workflow` records one app workflow with per-step results. Supported step types are `open_app`, `open_url`, `wait`, `control_current_app`, `hotkey`, `type_text`, `mac_action`, and `file_action`. Each action step still uses the normal policy and audit path; `execute:false` previews the sequence.

For explicit local memory:

```bash
curl -X POST http://127.0.0.1:3417/api/memory \
  -H 'Content-Type: application/json' \
  -d '{"kind":"preference","scope":"local","text":"Use concise Chinese status updates.","tags":["style"]}'
curl "http://127.0.0.1:3417/api/memory?query=Chinese&limit=5"
```

Memory records are stored locally in the runtime directory and should only be created for user-approved durable notes.

For inferred local learning:

```bash
curl http://127.0.0.1:3417/api/learning
curl -X POST http://127.0.0.1:3417/api/learning/distill \
  -H 'Content-Type: application/json' \
  -d '{}'
```

`JAVIS_AMBIENT_LEARNING=true` distills passive ambient metadata into `learned-profile.json`. It stores aggregate app/browser/context patterns only and does not call a model. `JAVIS_INCLUDE_LEARNING_IN_PROMPTS=false` keeps that profile out of task prompts while still allowing local inspection.

For a file-organization dry run:

```bash
curl -X POST http://127.0.0.1:3417/api/files/plan \
  -H 'Content-Type: application/json' \
  -d '{"path":".","maxMoves":10}'
```

The plan endpoint only previews create-directory and move-file steps. Actual file mutations still use the Level 3 action path and current policy. Applying a plan requires explicit confirmation:

```bash
curl -X POST http://127.0.0.1:3417/api/files/plan/apply \
  -H 'Content-Type: application/json' \
  -d '{"path":".","maxMoves":10,"confirm":true}'
```

With `JAVIS_ENABLE_LOCAL_EXEC=false`, the apply endpoint reports blocked steps and does not move files.

Low-risk setup actions are also available:

```bash
curl -X POST http://127.0.0.1:3417/api/setup/actions \
  -H 'Content-Type: application/json' \
  -d '{"action":"prepare_env_file"}'
curl -X POST http://127.0.0.1:3417/api/setup/actions \
  -H 'Content-Type: application/json' \
  -d '{"action":"open_screen_settings"}'
```

Supported setup actions: `prepare_env_file`, `open_screen_settings`, `open_accessibility_settings`, `open_microphone_settings`, `open_runtime_dir`, and `open_action_policy`.

Resident status:

```bash
curl http://127.0.0.1:3417/api/resident/status
curl -X POST http://127.0.0.1:3417/api/setup/actions \
  -H 'Content-Type: application/json' \
  -d '{"action":"install_resident_agent"}'
```

`install_resident_agent` writes the LaunchAgent plist for the next login. It does not start a second Electron process beside the currently running manual process.

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
  -d '{"corner":"bottom-right","display":"primary"}'
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

Supported intents: `list`, `search`, `summarize`, and `ask`.

`list` and `search` can complete locally without a model key. `summarize` and `ask` read allowed file/folder context, then use quick/background/Codex/Claude routing.

## Browser Workflows

Run a workflow over the current supported browser tab:

```bash
curl -X POST http://127.0.0.1:3417/api/browser/workflow \
  -H 'Content-Type: application/json' \
  -d '{"intent":"extract_actions","mode":"background","instruction":"Find deadlines and follow-up tasks.","maxChars":30000}'
```

Supported intents: `summarize`, `extract_actions`, `draft`, and `ask`.

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
nodes, and captures web hints such as placeholder text, DOM role, DOM id, class list, editable state,
and focus state. This makes side panes and web textboxes easier to target without bypassing the
same Level 3 action policy used by `ax_press` and `ax_set_value`.

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

Supported modes:

- `quick`: call the fast model immediately.
- `background`: queue the slower model lane.
- `codex` or `claude`: queue the local code-agent worker with the page context.

## Continue From History

Continue the latest workflow:

```bash
curl -X POST http://127.0.0.1:3417/api/workflows/continue \
  -H 'Content-Type: application/json' \
  -d '{"mode":"background","instruction":"Take the next useful step."}'
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
