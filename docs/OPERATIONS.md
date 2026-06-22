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
npm run resident:stop
npm run resident:uninstall
npm run resident:restart
npm run voice:cleanup
```

Resident stop, install, uninstall, and restart stop stale JAVIS Electron/npm processes from this
project and close old `npm run voice:chat` Terminal loops before loading the LaunchAgent. This
prevents an older process from keeping `JAVIS_API_PORT` open while a newer LaunchAgent instance
appears to be running. `npm run voice:cleanup` only closes stale local voice Terminal loops and
their lock file; it does not stop the resident app.
The Electron app also holds a single-instance lock: if JAVIS is launched again, the existing
resident process records the event and summons the pet instead of starting a second API/window.

Unattended overnight work:

```bash
npm run overnight
npm run overnight:start
npm run keepawake
npm run keepawake:start
npm run keepawake:stop
```

`npm run overnight` is the safe sleep-before-you-leave status pack. It combines resident LaunchAgent state, keep-awake, OpenAI spend guard, the OpenAI egress circuit breaker, local voice fallback, work progress, blockers, and bounded-autopilot posture without calling OpenAI, starting microphone capture, starting Realtime, starting workers, enabling autopilot, capturing screen, or mutating user files. `npm run overnight:start` prepares only the local keep-awake job and then prints the same pack.

Keep-awake starts a launchd-managed `/usr/bin/caffeinate -i -m -s` job under `com.haoge.javis.keepawake` by default. This keeps the Mac available for resident/background work while allowing the display to sleep. Display sleep is not the same as system sleep; a black screen is fine, but closed-lid sleep can still depend on macOS clamshell, power, and external-display conditions. The status command checks both launchd and `pmset` assertions.

## Health

```bash
curl http://127.0.0.1:3417/api/health
```

`/api/health` is intentionally public for local liveness probes. Other local API
endpoints require the runtime token by default. Scripts such as `npm run doctor`,
`npm run config`, and `npm run eval` discover it automatically. For manual curl:

```bash
TOKEN="$(cat "$HOME/Library/Application Support/JAVIS/Runtime/api-token")"
curl -H "X-JAVIS-Token: $TOKEN" http://127.0.0.1:3417/api/readiness
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
curl -H "X-JAVIS-Token: $TOKEN" http://127.0.0.1:3417/api/readiness
curl -H "X-JAVIS-Token: $TOKEN" http://127.0.0.1:3417/api/config/check
curl -H "X-JAVIS-Token: $TOKEN" http://127.0.0.1:3417/api/setup/recovery-bundle
curl -H "X-JAVIS-Token: $TOKEN" http://127.0.0.1:3417/api/setup/guide
curl -H "X-JAVIS-Token: $TOKEN" http://127.0.0.1:3417/api/voice/standby
curl -X POST -H "X-JAVIS-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"execute":false}' http://127.0.0.1:3417/api/voice/standby
curl -H "X-JAVIS-Token: $TOKEN" http://127.0.0.1:3417/api/keep-awake/status
npm run setup:bundle
npm run voice:standby
npm run keepawake
npm run config -- --print-control-readiness
npm run config -- --print-permissions
npm run doctor
```

Readiness checks cover the OpenAI key, microphone, screen capture, Accessibility, local execution, action policy, control mode, runtime storage, queue state, and pending approvals.

`npm run config -- --print-control-readiness` is the short local takeover packet. It summarizes whether voice entry, screen awareness, Mac app control, browser control, file/local actions, Codex, Claude Code, the generic CLI lane, resident hotkeys, perception consent, and multi-agent coordination are ready, then prints the next setup action only when a gate is blocked or limited.

`npm run setup:bundle` is the compact resident landing packet for daily use. It combines resident LaunchAgent state, setup blockers, permission checks, pet/notch state, Realtime recovery, local voice fallback, worker availability, action policy, learning/autopilot state, and the next safe action. It is read-only: it does not open the microphone, call OpenAI, grant macOS permissions, open a browser, or mutate files.

`GET /api/voice/standby` returns the current voice primary action. `POST /api/voice/standby` previews or runs that primary action from the same contract. When Realtime is blocked and local fallback is ready, `execute:false` prepares the quiet typed intake without opening Terminal, and `execute:true` opens the compact pet compose strip; neither path starts microphone capture, uses Realtime, stores raw audio, or spawns a Terminal loop. When Realtime is ready, the POST path still refuses to start a microphone from the server and returns the renderer/microphone confirmation requirement.

The standby contract also includes `promptPack`: one next safe utterance plus a few examples ranked from existing local metadata. It can prioritize `继续刚才那个`, background progress, current browser/page controls, current-app UI controls, capability status, or local distillation depending on what JAVIS already knows. The same prompt pack is mirrored into `/api/pet/status`, wake handoff, `npm run voice:standby`, local `voice:chat` `/voice`, local `voice:chat` `/try`, natural prompt questions such as `我现在可以说什么`, and the compact compose input placeholder. The same surfaces also expose `inputMode.mode=push_to_talk`, `micDefault=push`, and the hold-capsule-or-Space prompt, so the default voice entry remains muted until explicit push-to-talk input. In fallback mode those prompts route through `/api/voice/command` and keep `startsMicrophone:false`, `usesRealtime:false`, `opensTerminal:false`, and model calls off.

The same primary action is available through work-next as `actionId=voice:standby_primary`. `GET /api/work/next?actionId=voice:standby_primary` previews the current voice entry action without side effects; `POST /api/work/next` with `execute:true` and that action id runs it through the same standby contract. This lets Realtime tools, the CUI, and local automation ask for "the current voice entry action" without knowing whether the answer is local fallback or renderer-confirmed Realtime.

The config check adds repeatable setup evidence for `.env`, `.env.example`, resident LaunchAgent installation, runtime files, policy files, and Codex/Claude worker command availability.

The setup guide turns current blockers into one safe next action:

```bash
curl -H "X-JAVIS-Token: $TOKEN" http://127.0.0.1:3417/api/setup/guide
curl -X POST http://127.0.0.1:3417/api/setup/next \
  -H "X-JAVIS-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

`/api/setup/next` only opens the relevant local target, such as `.env` or a macOS permission pane. It does not write API keys, grant permissions, or enable local execution.
Use `{"execute":false}` to preview the next setup action and its safety flags without opening Finder, System Settings, a browser, or mutating local files.

The doctor command calls `/api/doctor/report` and combines health, readiness, resident status, worker availability, workflow storage, queue state, approval state, and safe policy previews. It exits non-zero when blocked unless `-- --allow-blocked` is provided:

```bash
npm run doctor -- --allow-blocked
npm --silent run doctor -- --json --allow-blocked
curl http://127.0.0.1:3417/api/doctor/report
```

Doctor also reports Realtime voice provider health. A configured `OPENAI_API_KEY` is not enough: recent WebRTC session negotiation failures, including HTTP 429 quota/rate-limit and billing errors, show as a warning for up to `JAVIS_REALTIME_PROVIDER_WARNING_MAX_AGE_MS` (24 hours by default). If the error code is `insufficient_quota`, the key has reached OpenAI but the OpenAI project has no usable quota, billing, or rate-limit headroom for Realtime. ChatGPT app subscriptions and OpenAI API Platform billing are separate; API/Realtime usage needs API billing or credits on the project or organization that owns `OPENAI_API_KEY`. Add billing/credits, raise limits, or replace `OPENAI_API_KEY` with a project key that has Realtime quota, then restart JAVIS. This keeps the desktop pet minimal while the terminal CUI and `/api/doctor/report` explain why live voice is not usable.

Use the recovery plan when Realtime reports quota, billing, auth, or provider readiness problems:

```bash
npm run config -- --print-realtime-recovery
curl http://127.0.0.1:3417/api/realtime/provider/recovery
```

In the interactive CUI, option `1B` prints the same plan and can open the OpenAI API billing page after explicit confirmation. Option `SG` prints the OpenAI spend guard: hard lock, daily budget, unattended budget, blocked count, one-request lease state, egress guard state, and recent blocked/allowed attempts. Option `SL` enforces zero-spend lockdown and restarts the resident without deleting `OPENAI_API_KEY`. The recovery plan never starts microphone capture and keeps `/api/voice/command` / `npm run voice:chat` as the local fallback while billing or key changes are pending. The same recovery payload now includes `retryPolicy`, which says whether a no-mic provider probe is due, cooling down, or already running, plus whether the local fallback should be used until the next probe. Provider probes can consume OpenAI API quota, so the default is zero-spend: `JAVIS_OPENAI_HARD_SPEND_LOCK=true`, `JAVIS_OPENAI_CLOUD_MODE=off`, `JAVIS_OPENAI_DAILY_REQUEST_LIMIT=0`, `JAVIS_OPENAI_EGRESS_GUARD=true`, `JAVIS_OPENAI_REQUIRE_SPEND_LEASE=true`, and unattended/autopilot/unscoped OpenAI egress paths are blocked. Local voice-command intake recognizes phrases like `我已经充值好了，帮我重试实时语音 provider probe，先不要开麦` and routes them to the same no-mic provider-probe preview path; actual execution still requires disabling the hard spend lock, setting a positive daily limit, restarting, creating a short-lived one-request spend lease with the exact phrase, and executing before that lease expires.

Before opening a real microphone session, preview the no-mic provider probe. Preview mode makes no OpenAI request. Confirmed run mode creates a renderer WebRTC offer without `getUserMedia`, calls the same OpenAI Realtime provider path with `probe=true`, records HTTP status/error evidence, and closes immediately, but it is intentionally high friction:

```bash
npm run config -- --print-realtime-provider-probe
npm run openai:spend
npm run openai:lockdown
npm run config -- --run-realtime-provider-probe
npm run config -- --run-realtime-provider-probe --confirm-openai-spend --confirm-openai-spend-phrase "SPEND OPENAI"
npm run dogfood:realtime-provider-probe
npm run dogfood:realtime-provider-probe:run
curl -X POST http://127.0.0.1:3417/api/openai/spend-lease \
  -H 'Content-Type: application/json' \
  -d '{"kind":"realtime_provider_probe","source":"manual","confirmOpenAiSpend":true,"confirmOpenAiSpendPhrase":"SPEND OPENAI"}'
curl -X POST http://127.0.0.1:3417/api/realtime/provider/probe \
  -H 'Content-Type: application/json' \
  -d '{"execute":true,"confirmOpenAiSpend":true,"confirmOpenAiSpendPhrase":"SPEND OPENAI","openAiSpendLeaseId":"<one-request lease id>"}'
```

The default `npm run dogfood:realtime-provider-probe` is a preview and makes no OpenAI call. The `:run` script is also safe by default because it does not include the spend phrase or a spend lease. A real provider request requires all of these: `JAVIS_OPENAI_HARD_SPEND_LOCK=false`, `JAVIS_OPENAI_CLOUD_MODE=manual`, `JAVIS_OPENAI_DAILY_REQUEST_LIMIT` above 0, a resident restart, one explicit phrase-confirmed spend lease, and the matching lease id on the execution request. The probe never starts microphone capture, screen capture, raw audio storage, or the live dogfood session. A successful probe proves the key/project/model/voice/provider path is ready; it does not count as a live voice session. The live run still requires `npm run dogfood:realtime-renderer -- --execute --confirm-mic` while the user is present.

The desktop renderer also reads Realtime provider health before microphone startup. If recent evidence already shows a known provider problem such as missing key, quota/rate-limit, auth/permission, provider error, or network failure, clicking the pet or triggering wake will not call `getUserMedia`; it shows the blocker and falls back to local speech instead. Realtime health, `/api/pet/status`, `/api/work/next`, and compact voice handoff also expose a structured local fallback pointing to `/api/voice/command`, with a compact `blocker` object for the provider kind/status/next action, so operators can keep routing typed or future local-STT commands while live WebRTC voice is blocked. When the input box already has a prompt, that fallback sends the transcript to `/api/voice/command`, queues background/Codex/Claude/local routes through the normal router, and holds quick-lane cloud calls unless `allowCloudQuick:true` is explicit. Run the no-mic provider probe again after fixing billing or replacing the key so the live microphone path can be retried with fresh provider evidence.

When the compact pet is parked and Realtime is blocked or warning, its fallback click target is the quiet local typed intake path, not a Terminal loop or expanded diagnostic dashboard. `/api/pet/status` exposes `localVoice.interaction.capsuleClick:"open_local_input"` plus `endpoint:"/api/voice/command"` and `opensTerminal:false`; the renderer previews `/api/voice/standby` without executing the standby primary action, then switches to the temporary `compose` window mode and focuses the local input. A successful send returns the window to the 148x40 pet. Operators can still deliberately use the continuous terminal loop by typing `npm run voice:chat` in an existing shell, but `/api/voice/open-local-loop` always redirects to the pet compose strip and reports the Terminal loop as manual-only, even if a caller sends explicit Terminal flags. This keeps the desktop pet compact, starts no microphone, uses no Realtime session, and keeps the heavier diagnostics in the CUI/API.

The compact pet treats warning-level Realtime provider problems differently from full setup failures. If Realtime is warning, such as HTTP 429 quota/rate-limit, and local no-mic voice-command fallback is available, `/api/pet/status` reports `mode:"fallback_ready"` with a yellow ambient traffic light instead of a red interrupt state. The traffic-light reason stays focused on local fallback readiness instead of surfacing routed-work diagnostics in the desktop tooltip. Routine `browser_window_unavailable` preview failures are also kept out of pet attention; operators still see the browser recovery action in `/api/work/next`, `/api/unblock/preview`, and the CUI. The exact quota/key/billing recovery details remain available in `npm run setup:bundle`, `npm run voice:standby`, `/api/status`, and `/api/realtime/provider/recovery`.

Local speech fallback uses macOS `/usr/bin/say` and never starts the microphone or calls OpenAI. Preview it without audio:

```bash
npm run dogfood:local-speech
curl -X POST http://127.0.0.1:3417/api/speech/say \
  -H 'Content-Type: application/json' \
  -d '{"text":"JAVIS local speech preview","dryRun":true}'
```

To intentionally hear the fallback, run `npm run dogfood:local-speech -- --execute --confirm`; the script speaks briefly, then stops the local `say` process. Use `/api/speech/state` and `/api/speech/stop` for direct state and stop controls.

Local voice-command fallback is the no-Realtime intake path. It accepts a transcript, attaches metadata-only Mac context, optionally adds a bounded Accessibility outline, routes it through the normal quick/background/Codex/Claude/local router, and prepares a local spoken acknowledgement without starting a microphone:

```bash
npm run voice -- "帮我看一下当前窗口，判断下一步应该怎么做"
npm run voice:standby
npm run config -- --print-voice-latency
npm run voice:chat
npm run voice:cleanup
npm run config -- --print-local-voice-loop
npm run wake -- "贾维斯，帮我看一下当前窗口，判断下一步应该怎么做"
npm run voice -- --run --include-screen --include-ui "把这个任务交给后台处理"
npm run voice -- --session "把这次本地语音指令写进工作会话"
npm run dogfood:voice-command
curl -X POST http://127.0.0.1:3417/api/voice/command \
  -H "X-JAVIS-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"transcript":"帮我整理当前工作状态，给我一个三步计划，先不要执行。","execute":false,"speak":true,"includeAccessibility":true}'
curl -X POST http://127.0.0.1:3417/api/wake/command \
  -H "X-JAVIS-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"phrase":"贾维斯","transcript":"帮我看一下当前窗口，判断下一步应该怎么做","execute":false,"includeScreen":true,"includeAccessibility":true}'
curl -H "X-JAVIS-Token: $TOKEN" \
  'http://127.0.0.1:3417/api/voice/latency?limit=20&auditLimit=500'
```

By default the acknowledgement is a `/usr/bin/say` dry-run, and this fallback does not attach local memory or inferred learning unless `useMemory:true` is explicit. The user-facing `npm run voice -- "..."` command defaults to metadata-only screen plus bounded UI outline context; add `--no-screen` or `--no-ui` to make it lighter. `npm run voice:chat` keeps the same no-mic local intake open until `/exit` or `/quit`, records sanitized turns into a work session by default, and accepts `--no-session`, `--run`, `--confirm-speak`, `--no-screen`, and `--no-ui` the same way as one-shot voice commands. The resident launch agent and API loop opener never start this Terminal loop; they run from the project directory, redirect loop requests to the pet input, mark the Terminal loop as manual-only, and clear stale project `voice:chat` loops during restart. The loop command itself is single-instance for manual CLI use: a repeated `voice:chat` start reports the existing loop and exits instead of creating another running window. In the interactive CUI, choose `VC` to run that same local loop inside the current CUI, or run `npm run config -- --print-local-voice-loop` for a quickstart without entering the loop. Its context snapshot is metadata-only: frontmost app/window, browser title/host, screen frame freshness/privacy when `includeScreen:true`, clipboard presence/length only, active-job count, approval count, and, when `includeAccessibility:true`, a compact UI outline capped by the existing Accessibility read policy. It does not attach screenshots, raw screen pixels, clipboard text, raw audio, browser page body, full Accessibility nodes, or local learning profile by default. Add `confirmSpeak:true` or CLI `--confirm-speak` only when you intentionally want local audio. If `execute:true` or CLI `--run` is used on a quick-lane question, `/api/voice/command` holds the cloud call unless `allowCloudQuick:true` is also set; background/Codex/Claude/local routes can still be queued through the normal policy gates.

Inside `npm run voice:chat`, `/try`, `/voice`, `/see`, `/status`, `/latency`, `/session`, `/note`, `/app`, `/ui`, `/file`, `/browser`, `/browse`, `/open`, `/delegate`, `/codex`, `/claude`, `/handoff`, `/jobs`, `/progress`, `/next`, `/auto`, `/blockers`, `/unblock`, `/incident`, `/approvals`, and `/history` are local loop commands. `/try` reads `/api/voice/standby` for the current context-ranked next utterance without model calls, screen capture, microphone, Realtime, or Terminal. `/voice` reads `/api/voice/standby` for the current Realtime/live voice blocker, local fallback, and next recovery step. `/latency` reads `/api/voice/latency?limit=20&auditLimit=500` for local voice-command avg/p90/p95 timings, likely bottleneck, slow turns, and next optimization hint from sanitized local audit metadata. `/see` reads `/api/perception/consent?limit=5` for screen/privacy/ambient/browser perception status without capturing a new frame. `/status` defaults to the lightweight `/api/pet/status` payload, `/session` reads/checks in local work sessions and can explicitly `start`, `resume`, `note`, or `end` them, `/note <text>` adds one note to the active local work session, `/app` defaults to `/api/ambient?limit=1` for recent app/screen metadata, `/ui <task>` previews the existing `/api/app/plan` lane for local app/UI workflows, `/file list|search|read ...` calls `/api/files/execute` through the existing local file policy, `/file organize|rename|convert ...` calls `/api/files/workflow` in preview mode for file workflow plans, `/browser` defaults to `/api/browser/activity?limit=4` for recent browser metadata, `/browse [intent] <task>` previews the existing `/api/browser/workflow` lane over the current page, `/jobs` and `/progress` read `/api/work/progress?jobLimit=5&workflowLimit=5`, `/next` defaults to `/api/work/next?compact=true`, `/auto` reads the compact autopilot/agency status through the same voice tool used by Realtime, `/blockers` reads a combined Realtime/approval/job/route/workflow/attention/autopilot blocker packet, `/unblock` reads `/api/unblock/preview` and combines blocker status with a compact work-next preview, `/incident` reads `/api/incident/report` for recent local audit evidence, `/approvals` reads the sanitized pending approval/confirmation queue, and `/handoff` plus `/history` read the voice-ready handoff/history directly. `/session start <goal>`, `/session resume`, `/session end [note]`, and `/note <text>` mutate only the local session store; they do not start microphone capture, use Realtime, open Terminal, capture screen, read clipboard text, execute app actions, or mutate user files. The other slash checks print compact operator output without routing a task, recording a voice session turn, starting microphone capture, using Realtime, or exposing raw logs on the desktop pet. `/try`, `/voice`, `/latency`, `/see`, `/app`, and `/browser` stay fast by default; add `--full-app`, `--full-browser`, or `--full` only when you intentionally want live Accessibility outline or current browser page text. `/jobs` is the fast "what are the background agents doing?" check-in: it summarizes queued/running jobs, workflows, worker groups, recoverable failures, latest completed work, and the next suggested action. `/auto` is the fast "why did or didn't you continue by yourself?" check-in: it explains whether autopilot is enabled, busy, waiting for user presence, cooling down, or has a low-risk action available. `/blockers` is the fast "why are you stuck?" check-in: it reports top blockers and counts without executing actions, resolving approvals, starting workers, opening Terminal, starting Realtime, or capturing screen. `/unblock` is the fast "how can you get unstuck?" check-in: it reports the top blocker, suggested work-next candidate, whether user presence is required, and what can be safely prepared without executing work-next, resolving approvals, starting workers, opening Terminal, starting Realtime, capturing screen, or mutating user files. `/incident` is the fast "who did this / what happened?" check-in: it reports likely causes and compact evidence from local audit metadata without screenshots, clipboard text, browser page text, full Accessibility trees, microphone capture, Realtime, Terminal, or action execution. `/approvals` is the fast "what is waiting for my confirmation?" check-in: it lists pending ids, summaries, risk levels, and next hints without approving, rejecting, executing, opening Terminal, starting Realtime, or capturing screen. `/open <url or search>` is preview-only by default and routes through `/api/voice/command`; start the loop with `--run` only when you want UI/browser workflow/open commands to execute through the normal local action policy. Use `/help` to list the loop commands; add `--full-status`, `--full-next`, or `--full` when you intentionally want full diagnostics.

Natural local voice can also write work-session notes when execution is explicit. Phrases such as `记到当前会话：...`, `给当前会话记一下...`, and `把...写进工作会话` route to `session_note` and append one local session event. Preview mode only reports the local command label; execution mode writes the note and returns safety flags showing no microphone, Realtime, Terminal, screen capture, clipboard text, app action, or user-file mutation.

You can ask about voice connection directly. Transcripts such as `实时语音连上了吗`, `为什么现在不能直接说话`, `麦克风准备好了吗`, and `can you hear me?` route to `voice_status`. This reads the same standby contract as `/voice`, reports Realtime provider status, local fallback, and recovery hints, and stays read-only: it does not start microphone capture, does not create a Realtime session, does not open Terminal, and does not gather screen or Accessibility context.

You can ask about local voice speed directly. Transcripts such as `语音延迟怎么样`, `为什么有点慢`, `哪里慢`, and `voice latency report` route to `voice_latency`. This reads the same local timing metadata as CUI `VL`, `npm run config -- --print-voice-latency`, and `voice:chat` `/latency`, then reports percentiles, likely bottleneck, slow turns, and the next optimization hint. It is read-only local audit analysis: it does not start microphone capture, create a Realtime session, capture screen, read clipboard text, return browser page text or full Accessibility trees, open Terminal, execute actions, or mutate user files.

You can also ask about Realtime dogfood evidence directly. Transcripts such as `实时语音验收还差什么`, `dogfood 证据到哪了`, and `what Realtime acceptance gates are missing?` route to `realtime_dogfood_status`. This reads the same local evidence and acceptance gates as the CUI monitor, reports the next gap, next prompt, provider blocker, and archive state, and stays read-only: it does not start microphone capture, create a Realtime session, save an archive, open Terminal, start workers, or call a cloud model.

You can prepare a live Realtime dogfood drill without opening the microphone. Transcripts such as `准备实时语音验收`, `给我 live drill pack`, and `下一句怎么说` route to `realtime_dogfood_pack`. This reads the live drill pack, renderer/provider readiness, next prompt, monitor/start/acceptance commands, and current acceptance gap. It does not start microphone capture, create a Realtime session, save an archive, open Terminal, start workers, or call a cloud model; the returned live command still requires the user-present `--confirm-mic` path.

You can archive the current Realtime dogfood evidence from local voice. Transcripts such as `保存实时语音验收证据 archive` and `save the Realtime dogfood archive` route to `realtime_dogfood_archive`. Preview mode builds the archive and acceptance snapshot without writing; execution mode saves the local JSON archive under the JAVIS runtime directory. It does not start microphone capture, create a Realtime session, store raw audio, open Terminal, start workers, or call a cloud model.

You can also stage the next live dogfood sentence for speaking. Transcripts such as `把实时语音验收下一句复制到剪贴板` and `copy the next Realtime dogfood prompt` route to `realtime_dogfood_prompt_copy`. Preview mode only reports the prompt; execution mode copies that single prompt to the clipboard. It does not start microphone capture, create a Realtime session, save an archive, open Terminal, start workers, or call a cloud model.

For a full live drill, transcripts such as `把实时语音验收整套脚本复制到剪贴板` and `copy the Realtime dogfood prompt script` route to `realtime_dogfood_script_copy`. Preview mode lists the script and execution mode copies the numbered prompt script from the current live drill pack. It does not start microphone capture, create a Realtime session, save an archive, open Terminal, start workers, or call a cloud model.

You can ask about passive perception directly. Transcripts such as `你现在在看我的屏幕吗`, `最近看到什么窗口`, `现在监控什么`, and `what are you watching?` route to `perception_status`. This reads perception consent, screen privacy, cached-screen metadata, ambient app/window/browser metadata, and Accessibility readiness. It does not capture a new screen frame, return screenshots, read browser page text, read clipboard text, start microphone capture, create a Realtime session, or open Terminal.

You can ask what was recently happening on the Mac without forcing a live screenshot. Transcripts such as `我刚才在电脑上干嘛`, `最近电脑上发生了什么`, and `what was I just doing on the Mac?` route to `recent_activity`. This reads `/api/activity/recent` for a local app/window/browser metadata timeline from ambient observations. It does not capture a new screen frame, return screenshots, read browser page text, read clipboard text, return an Accessibility tree, start microphone capture, create a Realtime session, open Terminal, or call a cloud model.

You can ask about approval blockers directly. Transcripts such as `现在有没有需要我确认的审批`, `哪些动作卡在确认`, `有没有要我点同意`, and `what approvals are waiting for me?` route to `approval_status`. This reads the summarized approval queue, control mode, and effective risk policy. It does not approve, reject, execute actions, start microphone capture, create a Realtime session, open Terminal, capture screen, or mutate user files.

You can ask why JAVIS is blocked directly. Transcripts such as `现在有哪些阻塞卡住了`, `卡在哪里`, `为什么不动`, and `what is blocking you?` route to `blocker_status`. This reads `/api/blockers` and combines Realtime provider state, approvals, worker recovery, blocked workflows, routing attention, and attention policy. Autopilot waiting stays in the returned `autopilot` detail and can be shown as a blocker row with `includeAutopilot=true`, but it is quiet by default. It does not execute actions, resolve approvals, start workers, start microphone capture, use Realtime, open Terminal, capture screen, or mutate user files.

You can also ask how to recover. Transcripts such as `怎么解除这些阻塞`, `下一步能安全准备什么`, and `how can you get unstuck?` route to `unblock_preview`. This reads `/api/unblock/preview`, combines blocker state with a compact work-next preview, and explains the next safe candidate without executing work-next, resolving approvals, starting workers, starting microphone capture, using Realtime, opening Terminal, capturing screen, or mutating user files.

You can ask what happened when JAVIS behaves unexpectedly. Transcripts such as `谁给我开了这么多个窗口`, `谁干的`, `刚才发生了什么`, and `why did Terminal windows open?` route to `incident_report`. This reads `/api/incident/report` for recent local audit metadata across window, Terminal, Realtime, resident, worker, approval, and desktop-pet events. It does not start microphone capture, create a Realtime session, capture screen, read clipboard text, return browser page text, return a full Accessibility tree, execute actions, or open Terminal.

You do not have to remember the slash form for progress. Normal transcripts such as `后台现在怎么样`, `进度怎么样`, `现在做到哪了`, `what is running`, and `what are the agents doing` route to the same read-only `work_progress` fast path. They return a real progress snapshot while keeping the voice command in preview mode, with no microphone start, no Realtime call, and no quick-lane cloud model call.

You can ask about autonomy directly. Transcripts such as `你自己现在能不能继续跑，为什么没自动推进？`, `为什么没继续`, `能不能自己推进`, or `what is autopilot doing?` route to `autopilot_status`. This reads compact autopilot state, candidate counts, waiting conditions, cooldowns, and the next safe action explanation without executing work-next, starting workers, gathering screen context, starting microphone capture, or using Realtime.

You can also ask for capability and permission status naturally. Transcripts such as `你现在能看到什么，能操作什么，权限开了哪些？`, `你能做什么？`, and `what can you see and control?` route to the local `capability_status` fast path. It reads `/api/perception/consent` and the local capability map, then returns a compact status for screen, microphone, ambient observation, browser/page reading, Accessibility/app control, worker tools, local learning, control mode, and guardrails. This check is read-only: it does not start microphone capture, does not call Realtime, does not make a quick-lane cloud model call, and does not grant new permissions by itself.

Browser checks also work as natural local voice commands. `浏览器准备好了吗，默认会看哪个窗口？` routes to `browser_readiness` and only reads the default target/bridge recovery packet. `读一下当前网页` routes to `browser_page` and reads the current page through `/api/browser/page`. `当前网页有哪些按钮和输入框？` routes to `browser_dom` and reads visible controls through `/api/browser/dom`. These paths do not start microphone capture, do not use Realtime, do not make a quick-lane cloud model call, and do not ask the user which window to share; the readiness path also avoids page text and page JavaScript.

When routed browser work fails because no supported browser window is readable, work-next surfaces `browser_recovery:open_supported_browser`. Preview mode reports the local `open_app` plan plus the `route:...` retry action; execution opens or focuses Google Chrome through the normal local action policy, rechecks `/api/browser/readiness`, and returns the follow-up route action so the browser task can be retried without asking which window to use. You can also run `npm run browser:prepare` directly, or call `POST /api/browser/prepare` with `{"execute":true}`, to open/focus the supported browser, ensure a safe `about:blank` target only if needed, and recheck readiness without reading page text, executing page JavaScript, submitting forms, calling OpenAI, or asking which window to use.

Current-app UI checks work the same way for non-browser apps. `当前应用有哪些控件？`, `当前窗口有哪些按钮？`, or `这个界面能点什么？` route to `app_ui` and read a bounded Accessibility outline for the frontmost app. Repeated asks reuse a short same-app/window AX cache so voice follow-ups feel faster; the output marks `cache=live` or `cache=hit`. The response is an operator summary plus a compact control list, not the full AX node payload. It is read-only, does not start microphone capture, does not use Realtime, does not make a quick-lane cloud model call, and keeps clicks/typing behind the existing app workflow / UI action preview and confirmation gates.

You can also ask whether the UI cache is warm without forcing a fresh scan. `界面预热好了吗？`, `当前窗口缓存状态？`, or `is the current app UI cache ready?` route to `app_ui_status` and read only the in-memory prewarm/cache metadata: enabled/running/status, app/window, node count, cache age, and last error. It does not trigger a new AX scan and does not return full nodes.

Simple local app workflows also work as normal transcripts. `打开 Calculator 然后关闭窗口` routes to `app_workflow` and reuses the deterministic safe plan created during local command matching, so preview mode can answer without a second Accessibility scan. It stays preview-only unless `execute:true` or CLI `--run` is explicit; execution still runs through the existing app workflow policy and approval gates.

Inside the same loop, `/agent <task>` previews `/api/autonomy/run` for that task. The chat-loop default is a short preview capped at 4 autonomy steps, enough for route, local learning evidence, safe observation, and one work-next preview without the slower progress/recovery scan. Add `--full-agent`, `--full`, or `--agent-steps <n>` when you intentionally want a deeper autonomy pass. It remains no-mic and preview-only, and summarizes `agencyPlan` without direct shell/UI execution. `/delegate <mode> <task>`, `/codex <task>`, and `/claude <task>` preview the same scoped background/Codex/Claude `delegate_task` handoff used by Realtime voice. Starting the loop with `--run` only reaches the delegate confirmation gate; add `--confirm-delegate` only when you intentionally want to start the worker through existing routing, policy, and overlap-serialization gates. Use `npm run autonomy -- --task "<task>"` for the full non-interactive preview, or `npm run autonomy:run -- --task "<task>"` when you explicitly want one bounded step to run through the existing router, action policy, approval queue, and worker/recovery gates. In the CUI, use `AG` to preview and `AR` to preview then type `RUN`.

You also do not have to use `/delegate` for common worker handoffs. Normal transcripts such as `交给 Codex 检查 docs/ROADMAP.md`, `让 Claude Code 看一下 README.md`, and `把这个任务交给后台慢慢跑: 总结 docs/OPERATIONS.md` route to the same `delegate_task` preview path. Read/inspect/summarize/suggestion phrases default to `read` access; fix/modify/implement/write phrases default to `write` access. If `execute:true` or CLI `--run` is present, the natural delegate still stops at `confirmation_required` and does not start a worker until the explicit delegate confirmation path is used.

If a work session is active, local voice and wake commands append a sanitized `voice_command` event to that session automatically. The event keeps only transcript preview, route/job ids, lane status, metadata-only context summary, and local latency timings. It does not store raw audio, screenshots, clipboard text, browser page bodies, or full Accessibility node payloads. Use CLI `--session` or API `session:true` to start a session automatically when none is active; use `--session-goal "..."` / `sessionGoal` to name it. Use `--no-session` or `session:false` for one-off commands that should not touch the session ledger.

When the session contains a recent executable voice route, the workbench can continue it from the session instead of making the user copy a route id:

```bash
npm run work:next
npm run work:run -- --action-id session:$SESSION_ID
curl -H "X-JAVIS-Token: $TOKEN" "http://127.0.0.1:3417/api/work/next?actionId=session:$SESSION_ID"
curl -X POST http://127.0.0.1:3417/api/work/next \
  -H "X-JAVIS-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"actionId\":\"session:$SESSION_ID\",\"execute\":true,\"source\":\"operator_session_continue\"}"
```

If the session has no executable voice route, executing the session action records a sanitized `session_check_in` event instead. This keeps the long-running work timeline recoverable without starting Realtime, microphone capture, raw audio storage, screenshots, clipboard text, or full Accessibility payload storage.

`npm run wake -- "..."` is the one-shot wake path. It records the wake phrase, returns the same read-only handoff evidence as `/api/wake/status`, then routes the transcript through local voice-command intake. It does not start microphone capture or Realtime.

To continue the latest executable voice preview by voice/text instead of copying a route id, send `继续刚才那个` or `continue last voice route` through `/api/voice/command` with `execute:true`. This uses sanitized voice history to find the latest executable preview route, then runs it through `/api/work/next`; quick-lane previews still stay held unless explicitly rerouted or cloud quick execution is allowed.

When a local voice or wake command is preview-only, the response includes `route.routing.id`. Continue that prepared route from the terminal/API instead of repeating the request:

```bash
npm run work:next
npm run work:run -- --action-id route:$ROUTE_ID
npm run work:run -- --last-voice-route
curl -H "X-JAVIS-Token: $TOKEN" "http://127.0.0.1:3417/api/work/next?actionId=route:$ROUTE_ID"
curl -X POST http://127.0.0.1:3417/api/work/next \
  -H "X-JAVIS-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"actionId\":\"route:$ROUTE_ID\",\"execute\":true,\"source\":\"operator_route_continue\"}"
```

Background, Codex, Claude, and local preview routes expose a `route_preview_execute` recovery candidate. Quick-lane previews remain held locally unless the operator explicitly reroutes them or allows quick cloud execution.

Recent local voice-command intake can be inspected without opening raw logs:

```bash
npm run config -- --print-voice-history
curl -H "X-JAVIS-Token: $TOKEN" "http://127.0.0.1:3417/api/voice/history?limit=10"
```

The history is local and sanitized for recovery/debugging: it keeps transcript previews, transcript length, lane/status, route/job/workflow ids, and metadata-only context summaries. It does not store or return raw audio, screenshots, clipboard text, browser page bodies, or full Accessibility node payloads.

The tiny desktop pet can also read a compact `localVoice` state from `/api/pet/status`. It is not a log viewer: it only says whether no-mic typed voice-command intake is on standby or acting as fallback, lists `/api/voice/command`, `npm run voice -- "..."`, and the history command, includes a small provider `blocker` when Realtime is unavailable, and includes at most the latest sanitized transcript preview plus metadata summary.

The evaluation harness is broader than doctor. Doctor checks setup and safety readiness; eval probes product lanes through the live local API with read-only or preview actions, then prints a scorecard:

```bash
npm run eval
npm run eval -- --list
npm run eval -- --only=health,realtime,routing,parallel,collaboration
npm run eval -- --only=realtime-preflight
JAVIS_EVAL_LIVE_WORKERS=true npm run eval -- --only=workers-live
JAVIS_EVAL_REALTIME_DOGFOOD=true npm run eval -- --only=realtime-live-dogfood
npm run dogfood:browser-live-fill
npm run dogfood:local-speech
npm run dogfood:voice-command
npm run dogfood:productivity-live
npm run dogfood:realtime-payload
npm run eval:json
npm run eval:routing
```

Current eval lanes cover resident health, renderer load/recovery health, local speech fallback, local voice-command fallback, Realtime voice configuration, Realtime tool manifest startup budget, live dogfood preflight, preflight context, Realtime shortcut tools, Realtime recent-activity/browser workflow tool evidence, Realtime delegate-task confirmation gates, Realtime voice payload budget, work briefing, explicit memory, Inbox, routing, local skill shortcut confirmation/recall, four-task parallel ownership dogfood, collaboration claims, control-mode gates, perception consent/status, screen privacy rules, browser snapshots, browser workflow previews, app workflow benchmarks, productivity workflow benchmarks, knowledge vault benchmarks, file read/search/plan previews, file workflow benchmarks, creative workflow benchmarks, worker/autopilot observability, Accessibility smoke checks, and local learning/distillation/skill-draft preview. Run `npm run eval -- --only=realtime-preflight` immediately before a real voice dogfood run; it verifies renderer/provider readiness, mic-confirmation gates, allowed pre-live acceptance gaps, manifest budget, and payload budget without starting microphone capture. `npm run dogfood:local-speech` is the quick local TTS fallback preflight and is silent unless explicitly run with `--execute --confirm`; `npm run dogfood:voice-command` previews the no-Realtime transcript-to-route path and spoken acknowledgement. `npm run dogfood:realtime-payload` is the quick read-only payload-size audit for voice-heavy Realtime tools. `/api/renderer/status` and the `renderer` field in `/api/health` expose whether the desktop layer is loaded, loading, recovering, or degraded without returning renderer URLs or API tokens. `/api/realtime/config` exposes `toolManifestBudget` so tool count/schema growth remains visible before it slows live voice startup. `workers-live`, `realtime-live-dogfood`, and `browser-live-fill` are intentionally opt-in because they queue real workers, manipulate a live browser, or create temporary live-session state. The browser live fill dogfood opens a temporary `127.0.0.1` form in a supported browser, runs confirmed `fill_draft`, verifies all fields through the live browser bridge, runs one confirmed safe `/api/browser/dom-action` click after a live DOM re-observe, runs one natural-language `/api/browser/workflow` `act` click through model planning or local fallback, and confirms none of those paths submitted the form. Worker opt-in checks request `/api/work/progress?includeInternal=true` so internal dogfood batches can be verified without leaking `eval_` or dogfood jobs into the default user-facing voice/pet progress surface. `realtime-live-dogfood` additionally keeps a temporary live conversation state, records a Realtime progress-injection receipt, and verifies the short `spokenSummary` used for voice progress answers. `npm run eval:routing` is a separate labeled-corpus check for deterministic lane classification.

`realtime-preflight` is provider-state aware. When the provider is genuinely ready, it requires ready renderer/pack/evidence states. When the latest provider evidence is `provider_unverified` after restart or `quota_or_rate_limit` after a failed probe, it reports warnings instead of local failures only if the recovery plan is active, local no-mic voice-command fallback is available, the renderer/pack will not start microphone capture, and live start still requires explicit `confirmMic:true`.

Routine maintenance lives in the terminal CUI instead of the desktop pet:

```bash
npm run config
```

Use option `I. Show permission matrix`, or:

```bash
npm run config -- --print-permissions
```

This prints the current local permission and tool readiness matrix in one place:
macOS Microphone, Screen Recording, Accessibility, Full Disk Access guidance,
notifications, screen privacy, local execution, trusted local mode, action
policy, allowed write roots, Codex, Claude Code, generic CLI policy, browser
reading/control, Chrome DevTools bridge, Mac app control, resident LaunchAgent,
and the tap/capture hotkeys. The matrix is read-only. It does not grant macOS
privacy permissions or change `.env`; use the numbered CUI actions below when a
row tells you what to open or toggle.

Use option `1. Set / replace OpenAI API key` to paste the key locally with hidden input. It writes `OPENAI_API_KEY` to `.env` and can restart the resident service immediately. Do not paste API keys into chat or logs. If the CUI says `OpenAI key: present` and `OpenAI provider: quota/rate-limit`, the API is already connected locally; check OpenAI billing/limits for that project or replace the key with one that has Realtime quota.

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

This prints the operator-only registry for screen context, voice microphone, ambient observation, browser metadata/page reading, clipboard, Accessibility/app control, local learning, and worker/CLI tools. Each surface reports whether it is enabled, current status, consent/policy gate, raw-content storage posture, local retention, controls, and recent audit event types. Keep this in the terminal CUI/API; the desktop pet should remain a minimal status light. Realtime voice can read the same registry with `get_perception_consent` when the user asks what JAVIS can see, store, or operate, but it receives a compact voice payload instead of the full audit/control table.

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
npm run config -- --print-mcp-workflow --task "准备调用这个 MCP 工具" --server "pencil" --tool "list_tools" --request-approval
curl -X POST http://127.0.0.1:3417/api/mcp/workflow \
  -H 'Content-Type: application/json' \
  -d '{"task":"Choose the MCP server for this task, but do not execute.","execute":false}'
```

This uses the same sanitized MCP discovery data to select candidate servers and print the next confirmed steps. It is preview-only by default: it does not start MCP server commands, does not call MCP tools, and still redacts env values plus URL query strings. Passing `execute:true` plus `requestApproval:true`, a `serverName`, and a `toolName` creates a local pending approval request. Approving a stdio MCP workflow request can briefly start that server, send MCP `initialize`, send `notifications/initialized`, run `tools/list`, return sanitized tool schemas, and stop the process. Realtime voice can call `plan_mcp_workflow` when the user asks which MCP/external tool bridge should handle a concrete task.

Use option `Z. Preview MCP tool call`, or the tool-call preview command, when you want one actual MCP invocation:

```bash
npm run config -- --print-mcp-tool-call --task "读取 Pencil 状态" --server "pencil" --tool "get_guidelines" --arguments '{}'
npm run config -- --print-mcp-tool-call --task "读取 Pencil 状态" --server "pencil" --tool "get_guidelines" --arguments '{}' --request-approval
curl -X POST http://127.0.0.1:3417/api/mcp/tool-call \
  -H 'Content-Type: application/json' \
  -d '{"serverName":"pencil","toolName":"get_guidelines","toolArguments":{},"execute":true,"requestApproval":true}'
```

`/api/mcp/tool-call` previews are safe and do not start servers. Approving a stdio tool-call request starts the server, verifies the tool exists with `tools/list`, sends exactly one `tools/call`, sanitizes text/media/resource/structured results before storing them in the approval record, audits the attempt, and stops the process. If the external MCP server or backing app is unavailable, the approval result records that failure with stderr capped and env values redacted.
Realtime voice can call `plan_mcp_tool_call` for the same preview/approval path. In voice, a plain preview stays non-executing; `execute:true` plus `requestApproval:true` only creates a local approval record. The actual server start and one-shot `tools/call` still happen later through the approval queue.

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

Use option `V. Watch Realtime voice evidence` while dogfooding a real WebRTC voice session. It polls `/api/realtime/evidence` until the chosen timeout and shows a structured `status`, `phase`, `blocker`, checklist, manual dogfood runbook, dogfood drill, `gapSummary`, current-vs-injected work-progress sequence sync, latest latency receipt, recent sanitized Realtime tool-call metadata, shortcut-tool evidence for list/candidate/confirmation/save/forget calls, dogfood-session evidence for `get_realtime_dogfood_session`, `start_realtime_dogfood_session`, `mark_realtime_dogfood_step`, and `end_realtime_dogfood_session`, handoff-tool evidence for `get_work_handoff`, work-next evidence for read-only `get_work_next` previews and explicit `run_work_next` executions, delegation evidence for `delegate_task` previews, confirmation gates, queued workers, and serialized scopes, approval-review evidence for `get_pending_approvals` and `resolve_approval`, collaboration claim-control evidence for `get_collaboration_state`, `plan_collaboration_claim`, `heartbeat_collaboration_claim`, and `release_collaboration_claim`, autopilot-tool evidence for `get_autopilot_status`, attention-explanation evidence for `get_attention_explanation`, perception-consent evidence for `get_perception_consent`, local-capability evidence for `get_local_capabilities`, local-learning evidence for `get_learning_profile`, `get_learning_evolution`, and `get_learning_distillation`, browser read/workflow evidence for `read_browser_page` and `run_browser_workflow`, productivity dogfood archive evidence for `save_productivity_dogfood_archive`, and UI-demonstration evidence for `get_ui_demonstrations`, `plan_ui_demonstration_replay`, `draft_ui_demonstration_skill`, and the replay/save confirmation gates. Use option `O. Show Realtime live drill pack`, `npm run config -- --print-realtime-dogfood-pack`, or `/api/realtime/dogfood/pack` for the full read-only operator packet: renderer preflight, mic-confirmed start command, monitor, next prompt, session tracker, archive, acceptance, `actionPlan`, and safety gates in one place. Use option `B. Show Realtime dogfood brief`, `npm run config -- --print-realtime-dogfood-brief`, or `/api/realtime/dogfood/brief` for a one-page operator brief with readiness, gap summary, next prompt, follow-up prompts, evidence gates, and start/monitor commands; this never starts microphone capture. Use option `E. Show Realtime dogfood acceptance`, `npm run dogfood:realtime-acceptance`, `npm run config -- --print-realtime-dogfood-acceptance`, `/api/realtime/dogfood/acceptance`, or the Realtime `get_realtime_dogfood_acceptance` tool to turn current evidence/archive state into grouped pass/gap gates and a machine-readable `actionPlan` that separates read-only/preparable steps from manual live-voice/mic-confirmed steps for live voice, passive progress, spoken answers, work/work-next/delegation/autopilot/attention/perception/capability/approval/collaboration/learning/browser/productivity tools, UI demonstration learning, shortcut save/recall/forget, and saved local archive; this is read-only and never starts microphone capture. Add `--save-archive` to `npm run dogfood:realtime-acceptance -- --save-archive` or `npm run config -- --print-realtime-dogfood-acceptance --save-archive` when the operator wants acceptance to create the local archive and satisfy the audit-trail gate in one step. Run `npm run config -- --prepare-realtime-shortcut-recall` to preview the shortcut recall dogfood gate, then add `--confirm` to save one local dogfood shortcut and route that phrase as a preview through `/api/realtime/dogfood/shortcut-recall`; this writes only local shortcut/routing JSON evidence, starts no microphone, starts no worker, and executes no task. The CUI/API acceptance routes keep the full evidence packet for debugging, while the Realtime voice tool returns a compact summary payload with the next gap, limited blockers, safety flags, and response-size metadata. Use option `A. Save Realtime dogfood archive`, `npm run config -- --save-realtime-dogfood-archive`, `GET/POST /api/realtime/dogfood/archive`, or the Realtime `save_realtime_dogfood_archive` tool to preserve the current brief, gap summary, evidence checklist, dogfood-session tracker, and recent related audit events as a local JSON packet in `Runtime/realtime-dogfood-archives/`; this stores no raw audio, includes no screen image, and does not start microphone capture. Use option `D. Start Realtime dogfood drill` to preview and then explicitly start the drill; when confirmed, it uses `/api/realtime/dogfood/start` to summon the pet and schedule a short local read-only progress sample after the renderer reports a live voice session. Use option `R. Run renderer Realtime dogfood`, `npm run dogfood:realtime-renderer`, or `GET /api/realtime/dogfood/renderer` to inspect provider/renderer/prompt readiness first without starting microphone capture; use `npm run dogfood:realtime-prepare` or `npm run dogfood:realtime-renderer -- --prepare-live` to start a no-mic live-run prep cockpit that loads the full prompt script, starts or reuses the local operator tracker, optionally saves a local prep archive, and prints the monitor plus final mic-confirmed command; then use `npm run dogfood:realtime-renderer -- --execute --confirm-mic`, or `POST /api/realtime/dogfood/renderer/start` with `execute:true` and `confirmMic:true`, to trigger the renderer itself to start the real WebRTC voice path, wait for the data channel, send dogfood prompt text through the live Realtime session, report renderer-stage events, save the run archive, and print the acceptance pass/gap summary at the end; add `--prompt-script` when the preview or live run should use the full dogfood prompt script, add `--require-acceptance` when the script should automatically load that full script, keep the live session open, and poll `/api/realtime/dogfood/acceptance` until every gate passes instead of using the default short smoke-run auto-stop, and add `--acceptance-only --no-save-archive` to inspect the current acceptance report without starting microphone capture. This path intentionally refuses to run without explicit mic confirmation and the renderer listener stays mounted across its own `idle -> connecting -> live/error` state transitions so the dogfood wait is not cancelled by startup. If the provider returns quota/rate-limit errors, the script prints the `/api/realtime/evidence` blocker and next action instead of reporting only a generic timeout. Use option `P. Copy next Realtime dogfood prompt`, `npm run config -- --print-realtime-dogfood-prompt`, or `/api/realtime/dogfood/prompt` to see the next manual/spoken step; `POST /api/realtime/dogfood/prompt/copy` copies only that prompt text and supports `dryRun:true` for tests, without starting microphone capture. Use option `T. Track Realtime dogfood session`, `npm run config -- --print-realtime-dogfood-session`, or `/api/realtime/dogfood/session` to start, inspect, mark, and end an operator-visible drill record while keeping the desktop pet minimal; live Realtime voice can call the same dogfood-session tools, and those calls are audited without starting microphone capture. Active dogfood sessions auto-sync from current evidence whenever CUI/API/Realtime tools inspect them, and a step that has once been evidence-proven stays as sticky progress in that session even if the live voice session later disconnects. Provider readiness, renderer WebRTC negotiation, renderer live/data-channel state, passive worker-progress injection through the WebRTC data channel, latest progress sequence sync, and the short spoken progress summary remain the core readiness checklist. The renderer records each real SDP offer/answer attempt after applying the answer, and records click-to-live, negotiation, and live-to-progress timing through `/api/realtime/latency`, so `session_negotiated` reflects actual SDP startup, `voice_session_live` proves the renderer reached the live data-channel state, and CUI can show whether the session felt fast or slow. Use option `H. Show spoken work handoff`, or `npm run config -- --print-work-handoff`, to print the exact short handoff that Realtime can use for "where are we / what next" answers. For a scriptable single snapshot, run `npm run config -- --print-realtime-evidence`; for only the guided drill payload, call `/api/realtime/dogfood/drill`. `/api/realtime/dogfood` returns the same runbook without starting microphone capture. `POST /api/realtime/dogfood/prepare` can manually queue a short local read-only progress sample so a live voice session has fresh worker progress to receive. When the evidence reaches `READY`, ask the live voice session: `后台现在怎么样`; to dogfood handoff, ask `现在做到哪了？接下来做什么？` and confirm the monitor shows `get_work_handoff`; to dogfood work-next preview, ask `下一步能做什么？先预览，不要执行。` and confirm the monitor shows `get_work_next` with `safe-preview=yes`; to dogfood delegated workers, ask `把 docs/ROADMAP.md 的只读检查委派给 Codex，先预览，不要执行。`, then ask `准备执行刚才那个 Codex 委派任务，但我还没有确认。` and confirm the monitor shows `delegate_task` preview plus `confirmation_required` with no worker started; to dogfood approval review, create a safe pending approval, ask `现在有哪些待审批？`, then ask it to reject that exact test approval and confirm the monitor shows `get_pending_approvals`, the `resolve_approval` confirmation gate, and the reject result; to dogfood collaboration control, ask `把 docs/ROADMAP.md 分给 Claude Code，先预览协作占用，不要创建。`, then confirm creation, ask it to refresh the heartbeat, and ask it to mark the claim done/release it; confirm the monitor shows the collaboration tools with `safe=yes` and no worker/file mutation; to dogfood autopilot status, ask `autopilot 为什么没自己继续跑？` and confirm the monitor shows `get_autopilot_status`; to dogfood attention state, ask `为什么你现在是绿色？为什么刚才没提醒我？` and confirm the monitor shows `get_attention_explanation`; to dogfood perception consent, ask `你现在能看到什么、能操作什么？` and confirm it answers from consent registry evidence; to dogfood local capability routing, ask `你现在能做什么？这个任务应该用哪个工具？` and confirm the monitor shows `get_local_capabilities`; to dogfood local learning, ask `你最近学到了我什么使用习惯？` and confirm the monitor shows privacy-safe `get_learning_profile` evidence, then ask `最近我的使用习惯有什么变化？` and confirm the monitor shows privacy-safe `get_learning_evolution` evidence; to dogfood browser work, ask `帮我看看当前网页，提取下一步操作，先不要提交任何表单。` and confirm the monitor shows `read_browser_page` or safe-preview `run_browser_workflow` evidence; to dogfood productivity app coverage, ask `保存一份生产力四应用 dogfood 证据，先不要执行真实创建。` and confirm the monitor shows safe-preview `save_productivity_dogfood_archive` evidence; to dogfood a demonstrated workflow, ask it to start/capture/finish a short UI demonstration, plan replay, draft a skill, and confirm the monitor shows safe-preview replay, `draft_ui_demonstration_skill`, and confirmation gates before saving or running; to dogfood the operator record, ask it to inspect/start/mark/end the Realtime dogfood session and confirm the monitor shows the four dogfood-session tools with `starts microphone=no`; to dogfood shortcuts, ask it to list saved shortcuts, save a confirmed phrase, use that phrase once so routing records shortcut recall, and forget that phrase while this monitor is open, then save a dogfood archive so the run has a durable local artifact and check the acceptance report before treating the run as passed.

Use option `RX. Stop renderer Realtime voice`, `npm run config -- --print-realtime-renderer-control`, `npm run config -- --stop-realtime-voice`, or `/api/realtime/renderer/control` when a live renderer/WebRTC voice session should be shut down from CUI/API. Preview mode is read-only; execution only dispatches a stop request to the already-loaded renderer and waits for the renderer to call its existing cleanup path. It does not start microphone capture, start a new Realtime session, store raw audio, open Terminal, or add controls to the tiny desktop pet.

The resident Realtime watchdog uses the same stop path automatically when a renderer voice session appears stuck. By default it checks every 15 seconds, stops connecting sessions after 60 seconds, stops live sessions whose renderer heartbeat is older than 45 seconds, and stops live sessions that exceed 10 minutes. Tune with `JAVIS_REALTIME_RENDERER_WATCHDOG_INTERVAL_MS`, `JAVIS_REALTIME_RENDERER_WATCHDOG_CONNECTING_MAX_MS`, `JAVIS_REALTIME_RENDERER_WATCHDOG_HEARTBEAT_MAX_MS`, `JAVIS_REALTIME_RENDERER_WATCHDOG_LIVE_MAX_MS`, or disable with `JAVIS_REALTIME_RENDERER_WATCHDOG=false`. `npm run config -- --print-realtime-renderer-control` shows watchdog state, reason, thresholds, and stop count. The watchdog is stop-only: it does not start microphone capture, create Realtime sessions, store raw audio, open Terminal, capture screen, or run user tasks.

Use CUI option `Y`, `npm run config -- --prepare-realtime-dogfood-preflight --confirm`, or `POST /api/realtime/dogfood/preflight-bundle` when the operator wants JAVIS to do every no-mic Realtime dogfood prep step in one pass: prepare the live-run cockpit, start or reuse the operator tracker, prove shortcut recall, save the local archive, and print the final mic-confirmed live command. This path writes only local JSON evidence and still leaves real microphone/WebRTC startup to the explicit live command.

Use option `L. Show local capability map`, `npm run config -- --print-capabilities`, `/api/capabilities`, or the Realtime `get_local_capabilities` tool when JAVIS needs to decide what it can do next. The snapshot is read-only: it summarizes lane contracts, browser/file/app/knowledge/Codex/Claude readiness, current control mode, local execution, guardrails, the collaboration handoff with active owners/conflicts/next coordination action, and the next safe work item without starting microphone capture or running local actions. CUI/API keep the full capability map for inspection; the Realtime tool returns a compact summary payload with response-size metadata so live voice gets the useful routing hints without ingesting the full lane/collaboration ledger.

Use option `S. Show routing speed policy`, `npm run config -- --print-routing-speed-policy`, `/api/routing/speed-policy`, or the Realtime `get_routing_speed_policy` tool when JAVIS needs to explain speed/model routing. It is read-only: it shows the Realtime voice front door, fast model, background model, Codex, Claude Code, local-command, browser, and file/app profiles with latency class, model/tool choice, background/parallel eligibility, and the confirmation gates that still apply. When the message is about the current page, local files, or Mac apps, the decision includes `tool-first` and `first-tools` lines so the voice layer can use browser/file/app tools before queueing slow synthesis. CUI/API keep the full profile/sample table; the Realtime tool returns a compact voice payload with response-size metadata.

In trusted local mode, file write/create/copy/move roots default to the project, Desktop, Documents,
and Downloads. Set `JAVIS_ALLOWED_WRITE_ROOTS` or edit `action-policy.json` in the CUI if you want a
different local scope.

Codex and Claude Code delegation uses the `allow.code_agent` policy block. Failed jobs keep `attempts`,
`failureKind`, and `recoveryPlan` with a redacted diagnostics snapshot in `/api/jobs/<job-id>`, `/api/jobs/recovery`, `/api/work/progress`, and linked routing records, so JAVIS can
diagnose missing commands, disabled local execution, policy blocks, approvals, timeouts, and retry paths
without turning the first failure into a dead end.
`/api/tasks/delegate` is preview-first for voice and API callers: `execute:true` still stops at
`confirmation_required` until `confirm:true` is provided. Once confirmed, duplicate requests with the
same task, owner, scope, access, mode, and parallel group reuse an existing queued/running delegated job
instead of starting a second worker.
Recovery actions are also surfaced through `/api/briefing`, `/api/work/next`, and the Realtime `get_worker_recovery` tool; low-risk diagnostic
actions can be reviewed there without opening a separate UI. Realtime voice dogfood blockers are
surfaced there too: when `/api/realtime/evidence` is stuck at `needs_live_session`, running work-next
uses the same no-mic Realtime preparation cockpit as `npm run dogfood:realtime-prepare`: it loads the
full prompt script, starts or reuses the operator tracker, can save local prep evidence, and prints the
final mic-confirmed renderer command. This Realtime voice action remains manual-only because starting
microphone/live voice requires an explicit user action; overnight autopilot must skip the actual live start.
Blocked route records now return a structured route recovery envelope from `/api/work/next`: linked failed jobs expose their existing recovery actions, linked workflows expose continuation/copy-result options, browser fill drafts expose a `browser_fill_sensitive_handoff` summary with safe prepared-field counts and sensitive/manual fields redacted, and routes without an executable candidate still include the exact inspect target. You can target a specific route with `GET /api/work/next?actionId=route:<route-id>`. Realtime voice uses `get_work_next` for the same read-only preview when the user asks what single step should happen next, but its tool payload is intentionally compact for voice latency and omits full briefing/workflow/job records; `run_work_next` is reserved for explicit "run/execute/continue" requests. If the current setup issue is the Realtime provider, `GET /api/work/next?actionId=readiness:realtime_voice_provider` previews the no-mic provider probe without calling OpenAI, and `POST /api/work/next` with `execute:true` runs that same no-mic probe through the existing renderer path without starting microphone capture. For the manual Realtime voice dogfood blocker, `GET /api/work/next?actionId=realtime_voice:needs_live_session` keeps the no-mic preview lightweight, while `POST /api/work/next` with `execute:true` and that `actionId` runs the full no-mic preflight bundle: live-run cockpit, operator tracker, shortcut-recall proof, saved archive, acceptance snapshot, and final mic-confirmed live command. When the recommended route candidate is an existing failed-job recovery action that is already trusted/low-risk eligible, `/api/work/next` also exposes the autopilot decision that allows the unattended loop to run that one recovery candidate.
Local learning habit candidates can also be reviewed through work-next without making them the default next task: first inspect `/api/learning/distillation`, then call `GET /api/work/next?actionId=learning_habit:<candidate-id>`. The preview is local, metadata-only, read-only, no-autosave, no-permission-grant, and no-execution; even a `POST /api/work/next` execute request is downgraded to a review explanation until the user explicitly promotes the candidate into a demonstration, shortcut, skill, or memory through its own confirmation gate.
Retryable failed jobs can be advanced from work-next or `POST /api/jobs/:id/recovery/run` into a
narrower recovery job with the original task, attempts, diagnostics, and log tail attached. Realtime
voice can target the same path through `run_worker_recovery` when the user asks to recover a specific
failed worker. `JAVIS_MAX_RECOVERY_JOB_ATTEMPTS` caps those queued recovery jobs per failed parent job.

Use option `14. Show next work item`, `npm run work:next`, or `npm run config -- --print-work-next`, to preview the current `/api/work/next` action from the CUI. Use `npm run work:run` to execute the current action non-interactively, `npm run work:run -- --action-id route:<route-id>` to continue a specific routed preview, or `npm run work:run -- --last-voice-route` to continue the latest executable preview from local voice history through the same policy gates.

Use `POST /api/autonomy/run` when JAVIS should think through a task as a bounded local loop instead of a single route decision. The default is preview-only: it routes the task, exposes whether local inferred learning was attached as soft context, observes local Mac context without clipboard text or default screen capture, previews one work-next action, verifies current progress, and scans failed-worker recovery candidates. The response includes `agencyPlan` with a primary next action, fallback attempts, blockers, `askUserOnlyFor` boundaries, `selfRecoveryPlan`, and a short spoken summary; Realtime should read that before asking the user to solve a recoverable problem. `selfRecoveryPlan` keeps the posture as `ask_last`: inspect existing evidence, try an alternate browser/file/app/background lane, preview scoped Codex/Claude delegation for repo work, and retry one low-risk recoverable worker before escalating to the user. Passing `execute:true` still uses the normal task router, action policy, approval queue, workers, and recovery gates; the loop does not run shell commands or UI actions directly. Passing `retry:true` or `autoRecover:true` with `execute:true` lets the loop run one budgeted recovery action through the existing worker recovery runner, capped by `maxRecoveryAttempts` and `JAVIS_MAX_RECOVERY_JOB_ATTEMPTS`. Learning evidence is local metadata only and never grants permission or changes policy thresholds.

Use CUI option `27. Show collaboration handoff`, `npm run config -- --print-collaboration-handoff`,
`npm run config -- --print-collaboration-suggestions`, `npm run collab -- handoff`,
`npm run collab -- handoff --markdown --agent claude-code`,
`npm run collab -- handoff --write --agent claude-code`,
`GET /api/collaboration/handoff`, or `GET /api/collaboration/suggestions` when Codex, Claude Code, or
a local CLI worker is sharing the repo. The handoff summarizes active owners, write scopes,
heartbeat/release commands, conflict pairs, suggested non-overlapping scopes with ready-to-run claim
commands, and the next safe coordination action. The markdown/write variants create a pasteable or
saved local handoff packet for an external Claude Code session, including ground rules, active claims,
suggested scopes, claim commands, and verification commands; Realtime `get_collaboration_state`
returns the same handoff alongside the raw claim ledger.

Use option `15. Run next work item` to preview and then execute the current workbench action after
typing `RUN`. This is the manual path for recovering blocked jobs or routed work, processing the top Inbox item,
checking progress, preparing a real Realtime voice dogfood session, or delivering a completed workflow result without memorizing HTTP calls. Realtime voice actions print a small guide with the no-mic preparation path, CUI monitor, the prompts `后台现在怎么样` and `现在做到哪了？接下来做什么？`, and the expected `get_work_handoff` evidence. Internal
smoke/verification workflows are not offered as deliverable results.

When `/api/blockers`, `/unblock`, or natural blocker questions find browser work blocked by `browser_window_unavailable`, the operator-facing blocker is `browser_recovery` with the same "open or focus Google Chrome" recovery used by `/api/work/next`. The compact pet still stays quiet for routine browser preview misses; the actionable recovery stays in CUI/API and voice blocker status.

Use option `16. Show autopilot status`, or `npm run config -- --print-autopilot`, to see the resident overnight loop, last tick, last result,
the current decision preview, candidate auto-run counts, explicit waiting conditions, and the next workbench action without opening a separate UI.
Realtime `get_autopilot_status` returns the same decision in a compact voice payload with response-size metadata; use the CUI/API status when you need the full decision preview and candidate detail.

Use option `17. Run one autopilot tick` to preview and then manually advance the resident loop once.
It calls `/api/autopilot/tick` and requires typing `RUN` before executing.
API callers can also post `{ "execute": false }` to `/api/autopilot/tick` for a read-only tick
preview. That preview returns the selected candidate, decision, and safety summary, but does not set
autopilot busy/running, increment tick/skipped/executed counters, update `lastDecision`, open Terminal,
start microphone/Realtime, start workers, mutate files, send messages, or call work-next.

Use option `18. Toggle overnight autopilot` to write `JAVIS_AUTOPILOT_ENABLED` in `.env`. Enabling it
also aligns local execution, trusted local mode, and Level 3 auto-run so the resident can keep making
low-risk progress while unattended. The resident autopilot executes only low-risk recovery diagnostics,
trusted routed failed-job recovery candidates, and blocked app workflows that the local safe planner can re-plan; it skips while voice is active or
another background job is running. When multiple work-next actions exist, autopilot skips manual-only
items, including Realtime voice dogfood, and executes the first action that passes its auto-executable guard.
When Realtime live voice is the first manual-only blocker, autopilot may still execute the separate
`realtime_voice:prepare_preflight_bundle` fallback. That fallback writes local no-mic preparation
evidence and acceptance/archive state, but it is explicitly marked `startsMicrophone=false`,
`startsWorkers=false`, and `executesTask=false`; the actual live voice start remains gated by the
desktop pet/summon hotkey plus the `--confirm-mic` renderer command.
Fresh no-mic Realtime preflight evidence is not repeated on every unattended tick; tune that cooldown
with `JAVIS_REALTIME_PREFLIGHT_FRESH_MS` when a faster or slower dogfood cadence is needed.
`/api/autopilot` exposes the same structured decision preview so unattended runs leave evidence for
why an action ran, why it skipped, which candidates were auto-executable, and what condition JAVIS is waiting on.
If no user-visible action is auto-executable, it can run a cooldown-gated read-only maintenance snapshot
that records resident health, doctor/readiness state, worker progress, learning status, Realtime status,
and collaboration state as an internal workflow. Tune the cooldown with `JAVIS_AUTOPILOT_MAINTENANCE_MIN_INTERVAL_MS`.
Record & Replay teaching packets are also no-recording local JSON preparation artifacts; autopilot can
save one when stale, and reports the cooldown with `record_replay_teaching_fresh` while it is fresh.
Tune that freshness window with `JAVIS_RECORD_REPLAY_TEACHING_FRESH_MS`.

Use options `19`-`26` for local learning maintenance: refresh the inferred profile, save it as an
explicit local memory, pause/resume learning, manage exclusions, delete inferred learning data, inspect
the local metadata-only learning evolution snapshot, preview a Codex-style skill draft, or export that
draft to `~/.agents/skills` after typing `SAVE`.

Treat Record & Replay-style learning as a confirmation workflow, not as silent permission escalation.
JAVIS may use local ambient metadata to suggest habit candidates and may record an explicit UI
demonstration when the user starts that flow, but reusable replay, shortcut save, memory promotion, and
skill export must stay behind the existing preview/confirm gates. The intended path is: observe or record
sanitized local steps, draft a replay plan or skill, show the user what would be reused, then save/export
only after confirmation.

Work-next may also offer `record_replay:prepare_teaching_packet`. Running it saves a local JSON teaching
packet under the runtime directory with the best current habit candidate, suggested voice prompts, relevant
demonstration/replay/skill endpoints, and the safety boundaries for teaching JAVIS a workflow. It does not
start microphone capture, start UI demonstration recording, launch workers, replay UI actions, save skills,
save shortcuts, promote memory, or grant permissions. Autopilot may run this preparation once per freshness
window because it only writes local evidence; the user still has to explicitly start the real demonstration.
Use `npm run config -- --print-record-replay-teaching` to inspect the current preview plus the latest saved
packet, or `npm run config -- --save-record-replay-teaching` to write a fresh local packet from the terminal
CUI without starting recording. Realtime voice can call `get_record_replay_teaching_packet` for the same
flow: default calls only preview the teaching packet, and `save:true` writes local JSON evidence while still
starting no microphone, no UI recording, no workers, no replay, no skill export, no shortcut save, no memory
promotion, and no permission changes.

Use option `24. Show learning evolution`, or:

```bash
npm run config -- --print-learning-evolution
curl http://127.0.0.1:3417/api/learning/evolution
```

This compares recent passive app/browser/window metadata against an older local baseline and returns a
short inferred-change summary. It stores no screenshots, clipboard text, or page bodies, and Realtime
voice reads the same snapshot through `get_learning_evolution` when asked what has changed recently.

Use option `J. Show learning distillation`, or:

```bash
npm run config -- --print-learning-distillation
curl http://127.0.0.1:3417/api/learning/distillation
```

This is the operator-facing local user-distillation packet: inferred habit profile, recent changes,
explicit UI demonstrations, skill shortcuts, matching local skills, privacy boundaries, prompt-injection
risk, reusable habit candidates, and confirmation-gated next actions. Habit candidates turn repeated
metadata patterns or explicit workflow artifacts into reviewable suggestions such as "record this
workflow", "preview this demonstration skill", or "save this shortcut phrase"; they never auto-save,
grant permission, or execute actions. It is read-only, local-first, model-free, and stores no raw
screenshots, clipboard text, or page bodies.
Realtime voice can call `get_learning_distillation` for the same information as a compact payload when
the user asks what JAVIS has learned, what changed recently, or which learned workflows are reusable.

Use option `BR. Show browser readiness`, or `npm run browser:ready`, to inspect the default browser target, current browser context, CDP bridge status, recovery actions, and browser safety contract. Use option `BP. Prepare browser target`, or `npm run browser:prepare`, when you want JAVIS to open/focus the supported browser and recheck readiness. The readiness packet is intentionally read-only; prepare may start/focus a browser and create a safe blank tab, but it does not execute page JavaScript, read page text, click controls, call OpenAI, or ask which window to use. Browser work defaults to the frontmost supported browser tab, then the first running supported browser tab; explicit page text, DOM reads, and actions still go through `/api/browser/page`, `/api/browser/dom`, and `/api/browser/dom-action`.

Use option `31. Show browser activity`, or `npm run config -- --print-browser-activity`, to inspect the local browser activity summary. Realtime voice can ask for the same data through `get_browser_activity`. This is metadata-only: app, host, title, timestamp, and redacted URL context from ambient observations. It does not store page text, and learning exclusions for apps/sites/folders are applied before the activity summary is built.

Use option `28. Show UI demonstrations` to inspect explicit local demonstrations. Demonstrations are user-started records for repeatable UI workflows; they store notes plus sanitized app/browser/screen/accessibility summaries and a manual-preview playbook, not screenshots or raw clipboard text. Completed demonstrations can become replay plans or reviewable local skill drafts; saving a draft to `~/.agents/skills` requires explicit confirmation.

Use option `29. Show skill shortcuts` to inspect saved local trigger phrases for recalled skill plans. Use option `30. Promote shortcut candidate` to turn a completed, successful `skillRecallPlan` route/job into a shortcut after typing `SAVE`. Shortcuts affect future routing context only; action policy and confirmation gates stay unchanged.

Use option `5. Open Full Disk Access settings` when you want macOS to allow JAVIS/Electron into protected local folders. macOS still requires a human confirmation in System Settings.

The desktop pet is intentionally minimal. It is a 148x40 Dynamic Island-style voice capsule parked at the Mac notch by default and avoids showing setup state, diagnostic chips, or configuration controls. When Realtime is blocked, it may temporarily widen into the `compose` strip for one local typed turn, then return to the compact capsule after sending. In compact mode it consumes the lightweight `/api/pet/status` payload and maps the resident state to traffic-light dots: red for attention/setup, yellow for waking/working, green for ready/standby, and green+yellow for observing or listening. Full doctor/config/briefing/context details stay in the terminal CUI, `/api/status`, Realtime tools, or the slower expanded-panel refresh.

Click the pet to start or stop realtime voice with full-screen context once `OPENAI_API_KEY` is configured. If the key is missing, the pet opens the terminal CUI instead. Realtime voice defaults to push-to-talk: after the session is live, hold the compact capsule or press Space to speak, then release to send the audio turn. The expanded controls can still toggle open-mic mode when you intentionally want it. Screen context is captured by the resident process, so it does not ask which window to share. Inside a live voice session, `JAVIS_WAKE_WORDS` defines soft wake words such as `JAVIS`, `Jarvis`, `贾维斯`, and `小贾`. For true local wake, set `JAVIS_WAKE_ENGINE_CMD` to a command that prints `wake` or one configured wake word; JAVIS will then expose that through `/api/wake/status` and the renderer will start voice automatically.

Right-click the capsule to open the terminal CUI. Keep setup, policy, and diagnostic changes there instead of adding visible desktop controls.

The resident app registers a global pet park hotkey, defaulting to `Control+Shift+Space`. Change it with `JAVIS_TOGGLE_HOTKEY` if macOS or another app already owns that shortcut.

It also registers a tap-to-summon hotkey, defaulting to `Alt+Space` (`Option+Space` on Mac). Pressing it wakes JAVIS and parks the capsule at the notch/Dynamic Island position. If Realtime is ready, the renderer can start the voice session through the same `/api/wake/status` path used by a local wake engine; if Realtime is blocked or unverified, the resident opens the compact `compose` input immediately so the user can type the local fallback turn without waiting for a failed microphone path. Change it with `JAVIS_SUMMON_HOTKEY` or `JAVIS_TAP_HOTKEY`, or set either value to `false` to disable it.

It also registers a clipboard-to-Inbox capture hotkey, defaulting to `Control+Shift+I`. Copy text anywhere, press the capture hotkey, and JAVIS saves the clipboard into local Inbox. Change it with `JAVIS_CAPTURE_HOTKEY`, or set `JAVIS_CAPTURE_HOTKEY=false` to disable it.

The desktop buddy parks itself at the Mac notch by default, using a Dynamic Island-style capsule. Use CUI option `6. Move pet position`, or set `JAVIS_WINDOW_PARK_CORNER=notch`, `JAVIS_WINDOW_PARK_DISPLAY=primary`, and `JAVIS_WINDOW_NOTCH_TOP_OFFSET=5` to control the notch placement. Supported positions are `notch`, `top-left`, `top-right`, `bottom-left`, and `bottom-right`; corner placement still uses `JAVIS_WINDOW_PARK_MARGIN`.

JAVIS also creates a macOS menu bar status item. It exposes resident controls without relying on the desktop pet being visible: open the terminal config CUI, park the pet, refresh status, open `.env`, open Screen Recording or Accessibility settings, open the runtime folder, and quit the resident app.

```bash
curl http://127.0.0.1:3417/api/window/state
curl http://127.0.0.1:3417/api/pet/status
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
npm run browser:ready
curl http://127.0.0.1:3417/api/browser/readiness
npm run config -- --print-browser-benchmarks
curl http://127.0.0.1:3417/api/browser/benchmarks
```

The briefing combines readiness, routing records, jobs, workflows, approvals, memories, blockers, and deterministic next actions without calling a model. `/api/work/progress` is narrower: it returns a spoken-style update for routed work, background jobs, grouped Codex/Claude/local worker batches, and workflows, including active work, recent completions, blockers, recovery hints, and next actions. `/api/work/handoff` is the voice-friendly version for Realtime and remote surfaces: it compresses readiness, progress, the active work session, collaboration claims, next actions, and proactive workflow continuations into one short `spokenSummary`. The resident API can still return the richer handoff object, while the Realtime `get_work_handoff` tool uses a compact payload with response-size metadata so live voice does not ingest the full briefing or collaboration ledger. Use `workerGroups` / `workerSummary` when a voice or remote surface needs compact multi-agent progress instead of raw job rows.

`/api/browser/benchmarks` and CUI option `G. Show browser workflow benchmarks` run preview-only fixture checks for browser summarize, action extraction, DOM action safety contracts, submit-like DOM execute gates, form-fill draft redaction, compare/search preview, review-result preview, and research continuation metadata. They do not open a live browser page, execute browser actions, call a model, store raw fixture page text, or start voice; use them before broadening browser automation or debugging browser workflow regressions.

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

`/api/tasks` is the direct task-queue surface for voice, pet, CUI, and future remote panels. `GET /api/tasks`
returns recent jobs plus the preview-first queue policy. `POST /api/tasks` now uses the same guarded delegation
path as `/api/tasks/delegate`: requests preview by default, `execute:true` stops at `confirmation_required` until
`confirm:true` is supplied, and confirmed duplicate active tasks with the same task/owner/scope/access/mode/group
reuse the existing queued/running job instead of starting another worker.

`/api/tasks/route` persists a routing record for each previewed or executed task. Direct quick chat, voice delegation, direct task-queue requests, explicit CLI runs, browser workflows, file workflows, and continuation workflows also write routing records. The record is stored in `routing.json` beside `jobs.json` and `workflows.json`, and includes lane, owner, scope, parallel group, approval requirement, status, blocker/next-action context, result link, `contextPlan` evidence showing which context was used or skipped for speed/privacy, and `skillRecallPlan` evidence when a matching local `SKILL.md` changed the routed plan. Executed background/Codex/Claude jobs also store the same `skillRecallPlan` in `jobs.json`, log that the recalled plan is being used, and expose the skill name in work progress groups. Use `/api/tasks`, `/api/tasks/routing`, `/api/tasks/routing/<route-id>`, or `/api/jobs/<job-id>` to inspect the evidence. Internal `eval` / `doctor` route, workflow, and worker records stay in the ledgers for evidence, but do not appear as active Work Next or spoken progress items.

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

`/api/work/next` turns the top briefing action into one safe step. GET previews the selected action; POST runs exactly one step, such as opening the next setup target, showing approvals, checking session/progress state, processing the next Inbox item, or manually summoning the Realtime dogfood drill. Realtime next actions include a structured dogfood guide and workbench `actionPlan` instead of a vague blocker, so voice/autopilot can see no-mic preparation steps separately from manual live-voice gates. Voice can also call the read-only `get_realtime_evidence` tool to explain the current WebRTC/session/progress blocker and next dogfood step. It does not approve actions or batch-run tasks.

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

`/api/wake/status` includes a read-only `handoff` object. It does not start the microphone; it tells the renderer/CUI whether wake should try Realtime or use the local no-mic `/api/voice/command` path, including the `npm run voice -- "..."` command when Realtime is blocked. Use `npm run config -- --print-wake-handoff` for the terminal view. The handoff keeps the desktop pet minimal: no logs, screenshots, clipboard text, raw audio, or full Accessibility nodes are returned.
`/api/wake/trigger` only marks a pending wake invite and returns that same safe handoff. It does not start microphone capture, create a Realtime session, open Terminal, execute commands, or mutate local files; the renderer/user action still chooses the actual voice/local fallback path.

Realtime can also call `get_attention_explanation` through `/api/tools/execute` when the user asks why the pet is green/yellow/red, why JAVIS stayed quiet, or what the last attention notification did. That tool returns a short Chinese `spokenSummary` plus read-only policy/history evidence; it does not add any diagnostics to the desktop pet. Realtime can call `get_perception_consent` when the user asks what JAVIS can currently see, read, hear, control, store, or why a permission/action is allowed or blocked.

For a real voice progress run, keep `npm run config` open on option `V` while the desktop renderer voice session is live and a background worker batch is changing state. The monitor should show the latest work-progress sequence moving from `pending` or `stale` to `synced`, then move from pending to `READY`; then the voice model should answer the grouped worker summary without forcing the worker progress injection to become an assistant response by itself.

Learning controls are local. `paused:true` stops future learning distillation, `includeInPrompts:false` keeps the profile on disk but prevents prompt injection, and exclusions keep matching apps/sites/folder-like contexts out of future ambient samples and distillation. Routing records include `learningEvidence` so you can see whether inferred habits were attached to a task prompt. `/api/learning/skill-draft` follows the Codex Record & Replay shape by turning inferred habits plus recent routing/workflow evidence into a reviewable `SKILL.md` draft; it does not write files. `/api/learning/skill-draft/save` requires `confirm:true` and writes to user-level `~/.agents/skills`, not the open-source repo.

`sensitive_defaults` is the recommended always-on preset for ambient screen watching. It adds deterministic app, window-title, browser-host, and top-right notification-strip region rules for password managers, account/login pages, payment and banking hosts, recovery-code windows, and security settings. Use the dry-run call first to inspect exactly which rules would be added; applying it is idempotent and does not grant any new action permissions.

`private` mode is the default. It downscales and blurs/pixelates frames before they are sent to the local API or Realtime. `/api/screen/privacy` also stores app/window/browser-host/region rules and recommended presets. Enabled app/window/browser-host `exclude` rules block screen images from server-side quick, observe, vision, and Realtime preflight model context when the current context matches; enabled region rules are applied as resident-side pixel masks before resident-captured or renderer-posted frames are stored, returned, or injected into Realtime. `/api/screen/privacy/region-mask-preview` runs a synthetic local image check for that mask path without reading the real desktop. `/api/screen/capture-now` refreshes the latest full-screen frame from the resident process without a window picker. Use `{"mode":"clear"}` only when sharper screen context is worth the privacy tradeoff. `/api/conversation/state` tracks the renderer-reported voice lifecycle and heartbeats with a per-session token, so stale closes or heartbeats from an older Realtime connection do not overwrite the active session. `/api/realtime/context` is the silent preflight context sent into new voice sessions when `JAVIS_REALTIME_PREFLIGHT_CONTEXT` is not `false`. While voice is live, the renderer also polls `/api/work/progress` at `VITE_JAVIS_REALTIME_WORK_PROGRESS_SYNC_MS` and sends deduplicated silent updates when background work changes. `/api/presence` is a read-only standby/watch/work/listening summary over conversation state, wake state, ambient metadata, local learning, active jobs, approvals, guardrails, and the same quiet attention policy exposed by `/api/attention`; its `intervention` block must remain passive-by-default and require user intent. The desktop pet should consume compact `attention.level` and `attention.petState` rather than show diagnostics. Ambient observe stores local metadata and can keep the latest private screen frame fresh when `JAVIS_AMBIENT_CAPTURE_SCREEN=true`. Stopping screen context from the buddy clears the latest stored frame; the DELETE endpoint is the manual equivalent.

When `JAVIS_AMBIENT_PREWARM_APP_UI` is not `false`, ambient observe also warms the frontmost app's bounded Accessibility outline into a short in-memory cache. This makes follow-up local voice questions such as `这个界面能点什么？` answer from `cache=hit` instead of waiting for a fresh AX scan. The prewarm cache is not written into ambient history; `/api/ambient` exposes only metadata such as app, window title, node count, age, and status.

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
  -d '{}'
curl -X POST http://127.0.0.1:3417/api/inbox/process-next \
  -H 'Content-Type: application/json' \
  -d '{"execute":true,"confirm":true}'
curl -X POST http://127.0.0.1:3417/api/inbox \
  -H 'Content-Type: application/json' \
  -d '{"title":"Follow up with the supplier","body":"Check the latest quote and delivery window.","priority":2}'
curl -X POST http://127.0.0.1:3417/api/inbox/<item-id>/complete \
  -H 'Content-Type: application/json' \
  -d '{}'
curl -X POST http://127.0.0.1:3417/api/inbox/<item-id>/route \
  -H 'Content-Type: application/json' \
  -d '{"execute":true,"confirm":true,"mode":"background"}'
```

The menu bar item, capture hotkey, and `/api/inbox/capture-clipboard` endpoint can capture the current clipboard text into Inbox. Open Inbox items appear in status, the buddy activity list, and local work briefings. `/api/inbox/triage` is read-only: it sorts open items by priority and age, groups them by lane/source/priority, suggests quick/background/Codex/Claude lanes, and returns `spokenSummary` plus per-item `confirmationPolicy.spokenPrompt` for voice. Use `npm run config -- --print-inbox-triage` for the same grouped view in CUI. Triage does not execute or mark anything done. `/api/inbox/process-next` and `/api/inbox/<item-id>/route` are preview-first: no body or `execute:false` returns the selected item, lane plan, and confirmation policy without routing or marking done; `execute:true` returns `confirmation_required` until `confirm:true` is supplied. Confirmed execution sends exactly one Inbox item through the same quick/background/Codex/Claude task router used by voice and chat; successful execution marks that item done and stores a small route summary on the item.

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
  -d '{"app":"TextEdit","instruction":"fill the main text area","action":"set_value","content":"JAVIS","execute":true}'
```

The control endpoint first reads the current Accessibility tree, or a specified app's tree when `app` is provided, chooses one target, then executes through the same Level 3 local action policy as `ax_press` and `ax_set_value`. Use `execute:false` to inspect the selected target without clicking or typing.
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

`npm run dogfood:productivity-live -- --suite --json`, `GET/POST /api/productivity/dogfood/archive`, `/api/work/next?actionId=productivity_dogfood:save_archive`, and the Realtime `get_productivity_dogfood_archive` / `save_productivity_dogfood_archive` tools are the repeatable four-app evidence paths. They save a local archive under `Runtime/productivity-dogfood-archives/` by default and return the archive path, safety markers, per-app status, workflow IDs, approval IDs, missing requirements, and recovery hints. Work-next/autopilot only save the preview-only form: no app launch, no productivity action execution, no message send, and no user file/record mutation. `JAVIS_PRODUCTIVITY_DOGFOOD_FRESH_MS` controls the cooldown before unattended autopilot saves another preview archive. Add `--execute --confirm` or `execute:true, confirm:true` only for an intentional live Mac run through the direct productivity dogfood entrypoints; Mail remains draft-only and no send path is exposed.

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
- `audit.jsonl`: structured process, job, tool, and action events. It is bounded by `JAVIS_AUDIT_MAX_BYTES` (default 64MB), keeps a recent tail in the active file with `JAVIS_AUDIT_RETAIN_BYTES` (default 4MB), and retains timestamped local archives up to `JAVIS_AUDIT_ARCHIVE_LIMIT` (default 3). Check `/api/audit/status` or `GET /api/health` storage details for current size and archive count.
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

DOM actions are preview-first and re-observed before execution. A preview returns a
`safety` block showing `preflightReobserve=true`, `reobserveTiming=before_execute`,
and `executesFormSubmitByDefault=false`. During a confirmed live action, JAVIS
re-reads the current DOM target immediately before clicking/filling/selecting, then
records `browser_dom.reobserved` in the audit trail. Submit/send/pay/delete/login
style targets are promoted to Level 4 and require explicit confirmation instead of
running by default. The fixture execute-gate benchmark sends a submit-like DOM target
through `execute:true`, re-observes it, and still returns `executed=false` with
`submit execute gate=yes`, proving the default path does not submit forms.
When the operator explicitly passes `confirm:true`, the same API marks the
approval request as satisfied before the final live execution attempt; fixture
benchmarks still stop at `executed=false` with `confirmed fixture gate=yes`, so
the confirmation plumbing can be checked without touching a real tab.

Browser DOM control can use Chrome/Safari Apple Events JavaScript. For Chrome, enable `显示 > 开发者 > 允许 Apple 事件中的 JavaScript`, or restart Chrome with a local DevTools port that matches `JAVIS_CHROME_DEBUG_PORT`:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222
```

`/api/browser/javascript` reports the active bridge and any Apple Events/CDP error.

## Accessibility UI Tree

Read the current frontmost app UI tree, or target a specific running app:

```bash
curl 'http://127.0.0.1:3417/api/accessibility/tree?maxNodes=240&maxDepth=9'
curl 'http://127.0.0.1:3417/api/accessibility/tree?app=TextEdit&maxNodes=240&maxDepth=9'
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

The desktop pet should stay quiet and cheap while it is parked. The renderer polls `GET /api/pet/status` every 5 seconds for traffic-light state, voice/session state, window position, approvals, inbox/session counts, and a small job snapshot. The payload includes a `payloadContract` with allowed top-level keys, forbidden top-level keys, `maxTargetBytes`, `outputBytes`, and a minimum `headroomBytes` guard. Resident eval fails if the compact lane exceeds its budget, has less than 500 bytes of headroom, or lets raw screen images, model lists, learning/routing history, workflow logs/results, collaboration ledgers, or runtime data paths slip into the pet lane.

Full diagnostics stay out of the pet. `GET /api/status`, `/api/doctor/report`, `/api/config/check`, `/api/mac/context`, and `/api/briefing` are reserved for manual refresh, the terminal CUI, or the expanded panel, which refreshes those details at a slow cadence.

Resident screen context is also throttled. A manual screen start captures immediately; after that, the renderer refreshes screen context every 15 seconds during a live voice session and every 2 minutes while merely observing. Periodic screen refreshes must not call full status/doctor refreshes.
